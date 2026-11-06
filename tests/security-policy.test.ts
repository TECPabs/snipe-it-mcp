import { describe, it, expect, vi, afterEach } from "vitest";
import {
  HIDDEN,
  accessory,
  asset,
  jsonResponse,
  license,
  loadServer,
  mockApi,
  parse,
  requests,
  textOf,
  user,
  writesSent,
} from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const DENIED = "Record not found or not permitted.";
type Rows = { total: number; rows: Array<Record<string, unknown>>; truncated?: boolean };

// ───────────────────────────────── write gating ─────────────────────────────────

describe("write tools (SNIPEIT_WRITE_TOOLS)", () => {
  it("default is a read-only server: no write tool is listed", async () => {
    const { listTools } = await loadServer();
    const tools = await listTools();

    expect(tools.length).toBeGreaterThan(20);
    for (const tool of tools) expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
    const names = tools.map((t) => t.name);
    expect(names).toContain("snipeit_hardware_list");
    expect(names).not.toContain("snipeit_hardware_checkout");
    expect(names).not.toContain("snipeit_accessories_create");
  });

  it("a disabled write tool is rejected by the call handler and nothing is sent", async () => {
    const fetchMock = mockApi({});
    const { callTool } = await loadServer();

    const result = await callTool("snipeit_hardware_checkout", {
      id: 1,
      checkout_to_type: "user",
      assigned_user: 2,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/disabled by server policy/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enables exactly the named tools", async () => {
    const fetchMock = mockApi({
      "POST /api/v1/hardware/1/checkin": { status: "success", messages: "Asset checked in", payload: { asset: "TAG-1" } },
    });
    const { listTools, callTool } = await loadServer({ SNIPEIT_WRITE_TOOLS: "snipeit_hardware_checkin" });
    const names = (await listTools()).map((t) => t.name);

    expect(names).toContain("snipeit_hardware_checkin");
    expect(names).not.toContain("snipeit_hardware_checkout");
    expect(names).not.toContain("snipeit_hardware_update");

    const denied = await callTool("snipeit_hardware_update", { id: 1, name: "x" });
    expect(textOf(denied)).toMatch(/disabled by server policy/);
    expect(fetchMock).not.toHaveBeenCalled();

    const allowed = await callTool("snipeit_hardware_checkin", { id: 1 });
    expect(allowed.isError).toBeUndefined();
    expect(writesSent(fetchMock)).toEqual(["POST /api/v1/hardware/1/checkin"]);
  });

  it('"*" enables every write tool', async () => {
    const { listTools } = await loadServer({ SNIPEIT_WRITE_TOOLS: "*" });
    const names = (await listTools()).map((t) => t.name);
    expect(names).toContain("snipeit_hardware_checkout");
    expect(names).toContain("snipeit_components_update");
  });

  it("classifies write tools from annotations: every tool not marked read-only is gated", async () => {
    const { getAllTools } = await import("../src/domains/index.js");
    const all = await getAllTools();
    const writeNames = all.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name);
    expect(writeNames.length).toBeGreaterThanOrEqual(16);

    const { listTools, callTool } = await loadServer();
    const listed = new Set((await listTools()).map((t) => t.name));
    for (const name of writeNames) {
      expect(listed.has(name), name).toBe(false);
      expect(textOf(await callTool(name, { id: 1 })), name).toMatch(/disabled by server policy/);
    }
  });

  it("the client refuses POST/PATCH outside an enabled write tool, even with writes enabled", async () => {
    const fetchMock = mockApi({});
    const { client, policy } = await loadServer({ SNIPEIT_WRITE_TOOLS: "*" });

    // No tool context at all.
    await expect(client.snipePost("/hardware/1/checkin", {})).rejects.toThrow(/Write refused by server policy/);
    await expect(client.snipePatch("/hardware/1", { name: "x" })).rejects.toThrow(/Write refused by server policy/);

    // Inside a tool that is (mis-)annotated read-only: still refused — fail closed.
    const misAnnotated = { name: "snipeit_hardware_checkin", annotations: { readOnlyHint: true } };
    await expect(
      policy.runInToolContext(misAnnotated, () => client.snipePost("/hardware/1/checkin", {}))
    ).rejects.toThrow(/Write refused by server policy/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the client refuses a write from a write tool that is not enabled", async () => {
    const fetchMock = mockApi({});
    const { client, policy } = await loadServer({ SNIPEIT_WRITE_TOOLS: "snipeit_hardware_checkin" });
    const other = { name: "snipeit_hardware_update", annotations: { readOnlyHint: false } };

    await expect(
      policy.runInToolContext(other, () => client.snipePatch("/hardware/1", { name: "x" }))
    ).rejects.toThrow(/Write refused by server policy/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("denies API paths that are not on the route allowlist", async () => {
    const fetchMock = mockApi({});
    const { client, policy } = await loadServer({ SNIPEIT_WRITE_TOOLS: "*" });
    const tool = { name: "snipeit_hardware_update", annotations: { readOnlyHint: false } };

    await expect(client.snipeGet("/settings/backups")).rejects.toThrow(/not on the allowlist/);
    await expect(client.snipeGet("/users/1/../../settings")).rejects.toThrow(/not on the allowlist/);
    await expect(client.snipeGet("/hardware?filter=x")).rejects.toThrow(/not on the allowlist/);
    // Dot segments would be collapsed by URL parsing into a different endpoint.
    for (const tag of ["..", ".", "%2e%2e", "%2E."]) {
      await expect(client.snipeGet(`/hardware/bytag/${tag}`), tag).rejects.toThrow(/not on the allowlist/);
    }
    await expect(
      policy.runInToolContext(tool, () => client.snipePost("/users", { username: "x" }))
    ).rejects.toThrow(/not on the allowlist/);
    await expect(
      policy.runInToolContext(tool, () => client.snipePatch("/licenses/1", { seats: 999 }))
    ).rejects.toThrow(/not on the allowlist/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to start when the policy environment is invalid", async () => {
    await expect(
      (await loadServer({ SNIPEIT_WRITE_TOOLS: "snipeit_hardware_chekout" })).createMcpServer()
    ).rejects.toThrow(/unknown tool/);
    await expect(
      (await loadServer({ SNIPEIT_WRITE_TOOLS: "*, snipeit_hardware_checkin" })).createMcpServer()
    ).rejects.toThrow(/SNIPEIT_WRITE_TOOLS/);
    await expect(
      (await loadServer({ SNIPEIT_ALLOWED_COMPANY_IDS: "1,abc" })).createMcpServer()
    ).rejects.toThrow(/SNIPEIT_ALLOWED_COMPANY_IDS/);
    await expect(
      (await loadServer({ SNIPEIT_ALLOWED_COMPANY_IDS: "," })).createMcpServer()
    ).rejects.toThrow(/SNIPEIT_ALLOWED_COMPANY_IDS/);
    await expect((await loadServer()).createMcpServer()).resolves.toBeDefined();
  });
});

// ──────────────────────────────── company scope ─────────────────────────────────

describe("company scope (SNIPEIT_ALLOWED_COMPANY_IDS)", () => {
  it("filters list rows on company.id and does not reveal filtered rows in total", async () => {
    // Upstream ignores the company filter and returns everything.
    const fetchMock = mockApi({
      "GET /api/v1/hardware": {
        total: 4,
        rows: [asset(1, 1), asset(2, 2, { name: "OTHERCO-PC" }), asset(3, null, { name: "NOCO-PC" }), asset(4, 1)],
      },
    });
    const { callTool } = await loadServer({ SNIPEIT_ALLOWED_COMPANY_IDS: "1" });

    const result = await callTool("snipeit_hardware_list", {});
    const data = parse<Rows>(result);

    expect(data.rows.map((r) => r.id)).toEqual([1, 4]);
    expect(data.total).toBe(2);
    expect(textOf(result)).not.toMatch(/OTHERCO|NOCO/);
    // The upstream filter is passed as an optimisation.
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("company_id")).toBe("1");
  });

  it("uses exact upstream totals when the upstream honours the company filter", async () => {
    mockApi({
      "GET /api/v1/hardware": (url: URL) => {
        expect(url.searchParams.get("company_id")).toBe("1");
        return { total: 137, rows: [asset(1, 1), asset(4, 1)] };
      },
    });
    const { callTool } = await loadServer({ SNIPEIT_ALLOWED_COMPANY_IDS: "1" });
    const data = parse<Rows>(await callTool("snipeit_hardware_list", { limit: 2 }));
    expect(data.total).toBe(137);
    expect(data.rows).toHaveLength(2);
  });

  it("pages across several permitted companies with one upstream query each", async () => {
    const inventory: Record<string, ReturnType<typeof asset>[]> = {
      "1": [asset(11, 1), asset(12, 1), asset(13, 1)],
      "3": [asset(31, 3), asset(32, 3)],
    };
    const fetchMock = mockApi({
      "GET /api/v1/hardware": (url: URL) => {
        const all = inventory[url.searchParams.get("company_id") ?? ""] ?? [asset(99, 2)];
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? 50);
        return { total: all.length, rows: all.slice(offset, offset + limit) };
      },
    });
    const { callTool } = await loadServer({ SNIPEIT_ALLOWED_COMPANY_IDS: "3,1" });

    const page1 = parse<Rows>(await callTool("snipeit_hardware_list", { limit: 2, offset: 0 }));
    const page2 = parse<Rows>(await callTool("snipeit_hardware_list", { limit: 2, offset: 2 }));
    const page3 = parse<Rows>(await callTool("snipeit_hardware_list", { limit: 2, offset: 4 }));

    expect(page1.total).toBe(5);
    expect(page1.rows.map((r) => r.id)).toEqual([11, 12]);
    expect(page2.rows.map((r) => r.id)).toEqual([13, 31]);
    expect(page3.rows.map((r) => r.id)).toEqual([32]);
    for (const [input] of fetchMock.mock.calls) {
      expect(["1", "3"]).toContain(new URL(String(input)).searchParams.get("company_id"));
    }
  });

  it("returns nothing when the caller asks for a company outside the scope", async () => {
    const fetchMock = mockApi({ "GET /api/v1/hardware": { total: 1, rows: [asset(2, 2)] } });
    const { callTool } = await loadServer({ SNIPEIT_ALLOWED_COMPANY_IDS: "1" });

    const data = parse<Rows>(await callTool("snipeit_accessories_list", { company_id: 2 }));
    expect(data).toEqual({ total: 0, rows: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("denies direct-ID gets of out-of-scope records, indistinguishably from a real 404", async () => {
    mockApi({
      "GET /api/v1/hardware/1": asset(1, 1),
      "GET /api/v1/hardware/2": asset(2, 2, { name: "OTHERCO-PC" }),
      "GET /api/v1/hardware/3": asset(3, null),
      "GET /api/v1/hardware/5": { status: "error", messages: "Asset not found", payload: null },
      "GET /api/v1/hardware/6": jsonResponse({ message: "Forbidden" }, { status: 403 }),
      // id 404 is not routed: the mock answers HTTP 404
    });
    const { callTool } = await loadServer({ SNIPEIT_ALLOWED_COMPANY_IDS: "1" });

    expect(parse(await callTool("snipeit_hardware_get", { id: 1 })).id).toBe(1);

    const outcomes = [];
    for (const id of [2, 3, 5, 6, 404]) {
      const result = await callTool("snipeit_hardware_get", { id });
      expect(result.isError, String(id)).toBe(true);
      outcomes.push(textOf(result));
    }
    expect(new Set(outcomes)).toEqual(new Set([DENIED]));
  });

  it("applies the same check to lookups by tag and by serial", async () => {
    mockApi({
      "GET /api/v1/hardware/bytag/TAG-2": asset(2, 2, { name: "OTHERCO-PC" }),
      "GET /api/v1/hardware/bytag/TAG-1": asset(1, 1),
      "GET /api/v1/hardware/byserial/SER-X": { total: 2, rows: [asset(1, 1), asset(2, 2, { name: "OTHERCO-PC" })] },
    });
    const { callTool } = await loadServer({ SNIPEIT_ALLOWED_COMPANY_IDS: "1" });

    expect(textOf(await callTool("snipeit_hardware_by_tag", { asset_tag: "TAG-2" }))).toBe(DENIED);
    expect(parse(await callTool("snipeit_hardware_by_tag", { asset_tag: "TAG-1" })).id).toBe(1);

    const bySerial = await callTool("snipeit_hardware_by_serial", { serial: "SER-X" });
    expect(parse<Rows>(bySerial)).toMatchObject({ total: 1, rows: [{ id: 1 }] });
    expect(textOf(bySerial)).not.toMatch(/OTHERCO/);
  });

  it("checks the parent record before any sub-resource is fetched", async () => {
    const fetchMock = mockApi({
      "GET /api/v1/licenses/2": license(2, 2),
      "GET /api/v1/licenses/2/seats": { total: 1, rows: [{ id: 1, assigned_user: { id: 5, name: "OTHERCO-USER" } }] },
      "GET /api/v1/accessories/2": accessory(2, 2),
      "GET /api/v1/accessories/2/checkedout": { total: 1, rows: [{ assigned_pivot_id: 9, id: 5, name: "OTHERCO-USER" }] },
      "GET /api/v1/users/2": user(2, 2),
      "GET /api/v1/users/2/assets": { total: 1, rows: [asset(1, 1)] },
      "GET /api/v1/users/2/accessories": { total: 1, rows: [accessory(1, 1)] },
      "GET /api/v1/users/2/licenses": { total: 1, rows: [license(1, 1)] },
      // Snipe-IT v6 locations carry no company at all -> out of scope while restricted.
      "GET /api/v1/locations/4": { id: 4, name: "HQ", address: "ADDRESS-HIDDEN" },
      "GET /api/v1/locations/4/assets": { total: 1, rows: [asset(1, 1)] },
      "GET /api/v1/consumables/2": { id: 2, name: "Toner", company: { id: 2, name: "Company 2" } },
      "GET /api/v1/components/2": { id: 2, name: "RAM", company: { id: 2, name: "Company 2" } },
    });
    const { callTool } = await loadServer({ SNIPEIT_ALLOWED_COMPANY_IDS: "1" });

    const calls: Array<[string, Record<string, unknown>]> = [
      ["snipeit_licenses_seats", { id: 2 }],
      ["snipeit_accessories_checkedout", { id: 2 }],
      ["snipeit_users_assets", { id: 2 }],
      ["snipeit_users_accessories", { id: 2 }],
      ["snipeit_users_licenses", { id: 2 }],
      ["snipeit_locations_assets", { id: 4 }],
      ["snipeit_locations_get", { id: 4 }],
      ["snipeit_consumables_users", { id: 2 }],
      ["snipeit_components_assets", { id: 2 }],
      ["snipeit_licenses_seats", { id: 777 }], // does not exist at all
    ];
    for (const [name, args] of calls) {
      const result = await callTool(name, args);
      expect(result.isError, name).toBe(true);
      expect(textOf(result), name).toBe(DENIED);
    }
    // Only parent records were ever requested — no sub-resource endpoint was touched.
    for (const r of requests(fetchMock)) expect(r).toMatch(/^GET \/api\/v1\/[a-z]+\/\d+$/);
  });

  it("serves sub-resources of in-scope parents, still filtering rows that carry a company", async () => {
    mockApi({
      "GET /api/v1/users/1": user(1, 1),
      "GET /api/v1/users/1/assets": { total: 2, rows: [asset(1, 1), asset(2, 2, { name: "OTHERCO-PC" })] },
      "GET /api/v1/licenses/1": license(1, 1),
      "GET /api/v1/licenses/1/seats": {
        total: 1,
        rows: [{ id: 3, license_id: 1, assigned_user: { id: 5, name: "User 5", email: "SEAT-EMAIL-HIDDEN" }, notes: "NOTES-HIDDEN" }],
      },
    });
    const { callTool } = await loadServer({ SNIPEIT_ALLOWED_COMPANY_IDS: "1" });

    const assets = await callTool("snipeit_users_assets", { id: 1 });
    expect(parse<Rows>(assets)).toMatchObject({ total: 1, rows: [{ id: 1 }] });
    expect(textOf(assets)).not.toMatch(/OTHERCO/);

    const seats = await callTool("snipeit_licenses_seats", { id: 1 });
    expect(parse<Rows>(seats).rows).toEqual([{ id: 3, license_id: 1, assigned_user: { id: 5, name: "User 5" } }]);
  });

  it("filters assets-by-status-label and audit reports row by row", async () => {
    mockApi({
      "GET /api/v1/statuslabels/2/assetlist": { total: 3, rows: [asset(1, 1), asset(2, 2), asset(3, null)] },
      "GET /api/v1/hardware/audit/due": { total: 2, rows: [asset(2, 2), asset(4, 1)] },
      "GET /api/v1/hardware/audit/overdue": { total: 1, rows: [asset(2, 2, { name: "OTHERCO-PC" })] },
    });
    const { callTool } = await loadServer({ SNIPEIT_ALLOWED_COMPANY_IDS: "1" });

    expect(parse<Rows>(await callTool("snipeit_statuslabels_assets", { id: 2 }))).toMatchObject({
      total: 1,
      rows: [{ id: 1 }],
    });
    expect(parse<Rows>(await callTool("snipeit_reports_audit_due", {}))).toMatchObject({ total: 1, rows: [{ id: 4 }] });
    const overdue = await callTool("snipeit_reports_audit_overdue", {});
    expect(parse<Rows>(overdue)).toEqual({ total: 0, rows: [] });
    expect(textOf(overdue)).not.toMatch(/OTHERCO/);
  });

  it("scopes the low-stock report", async () => {
    mockApi({
      "GET /api/v1/accessories": {
        total: 2,
        rows: [
          accessory(1, 1, { min_qty: 5, remaining_qty: 1 }),
          accessory(2, 2, { name: "OTHERCO-DOCK", min_qty: 5, remaining_qty: 0 }),
        ],
      },
    });
    const { callTool } = await loadServer({ SNIPEIT_ALLOWED_COMPANY_IDS: "1" });

    const result = await callTool("snipeit_reports_low_stock", { type: "accessories" });
    const data = parse<{ total_low: number; accessories: Array<{ id: number }> }>(result);
    expect(data.total_low).toBe(1);
    expect(data.accessories.map((a) => a.id)).toEqual([1]);
    expect(textOf(result)).not.toMatch(/OTHERCO/);
  });

  it("disables the activity report while scope is active — hidden, rejected, and refused by the client", async () => {
    const fetchMock = mockApi({ "GET /api/v1/reports/activity": { total: 1, rows: [{ id: 1, note: "OTHERCO" }] } });
    const { listTools, callTool, client } = await loadServer({ SNIPEIT_ALLOWED_COMPANY_IDS: "1" });

    expect((await listTools()).map((t) => t.name)).not.toContain("snipeit_reports_activity");
    const result = await callTool("snipeit_reports_activity", {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/disabled by server policy/);
    await expect(client.snipeGet("/reports/activity")).rejects.toThrow(/refused by server policy/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps reference data available, without instance-wide counts", async () => {
    mockApi({
      "GET /api/v1/categories": { total: 1, rows: [{ id: 1, name: "Laptops", category_type: "asset", assets_count: 940, eula: "EULA-HIDDEN" }] },
      "GET /api/v1/models/3": { id: 3, name: "Latitude 5440", assets_count: 412, notes: "NOTES-HIDDEN", manufacturer: { id: 1, name: "Dell" } },
    });
    const { callTool } = await loadServer({ SNIPEIT_ALLOWED_COMPANY_IDS: "1" });

    expect(parse<Rows>(await callTool("snipeit_categories_list", {}))).toEqual({
      total: 1,
      rows: [{ id: 1, name: "Laptops", category_type: "asset" }],
    });
    expect(parse(await callTool("snipeit_models_get", { id: 3 }))).toEqual({
      id: 3,
      name: "Latitude 5440",
      manufacturer: { id: 1, name: "Dell" },
    });
  });

  describe("writes", () => {
    const scoped = { SNIPEIT_ALLOWED_COMPANY_IDS: "1", SNIPEIT_WRITE_TOOLS: "*" };
    const records = {
      "GET /api/v1/hardware/1": asset(1, 1),
      "GET /api/v1/hardware/2": asset(2, 2),
      "GET /api/v1/hardware/bytag/TAG-1": asset(1, 1),
      "GET /api/v1/hardware/bytag/TAG-2": asset(2, 2),
      "GET /api/v1/users/1": user(1, 1),
      "GET /api/v1/users/2": user(2, 2),
      "GET /api/v1/accessories/1": accessory(1, 1),
      "GET /api/v1/accessories/2": accessory(2, 2),
      "GET /api/v1/accessories/1/checkedout": { total: 1, rows: [{ assigned_pivot_id: 42, id: 1, name: "User 1" }] },
      "GET /api/v1/accessories/2/checkedout": { total: 1, rows: [{ assigned_pivot_id: 77, id: 2, name: "User 2" }] },
      "GET /api/v1/components/1": { id: 1, name: "RAM", company: { id: 1, name: "Company 1" } },
      "GET /api/v1/locations/4": { id: 4, name: "HQ" },
      "GET /api/v1/locations/8": { id: 8, name: "Branch", company: { id: 1, name: "Company 1" } },
    };
    const success = { status: "success", messages: "ok", payload: { id: 1 } };
    const writeRoutes = {
      "PATCH /api/v1/hardware/1": success,
      "PATCH /api/v1/hardware/2": success,
      "POST /api/v1/hardware": success,
      "POST /api/v1/hardware/audit": success,
      "POST /api/v1/hardware/1/checkout": success,
      "POST /api/v1/hardware/2/checkout": success,
      "POST /api/v1/hardware/1/checkin": success,
      "POST /api/v1/hardware/2/checkin": success,
      "POST /api/v1/accessories/1/checkout": success,
      "POST /api/v1/accessories/42/checkin": success,
      "POST /api/v1/accessories/77/checkin": success,
      "POST /api/v1/accessories": success,
      "PATCH /api/v1/accessories/1": success,
      "POST /api/v1/components/1/checkout": success,
    };

    it.each<[string, string, Record<string, unknown>]>([
      ["update of an out-of-scope asset", "snipeit_hardware_update", { id: 2, name: "pwned" }],
      ["update of a non-existent asset", "snipeit_hardware_update", { id: 999, name: "x" }],
      ["checkin of an out-of-scope asset", "snipeit_hardware_checkin", { id: 2 }],
      ["checkout of an out-of-scope asset", "snipeit_hardware_checkout", { id: 2, checkout_to_type: "user", assigned_user: 1 }],
      ["checkout to an out-of-scope user", "snipeit_hardware_checkout", { id: 1, checkout_to_type: "user", assigned_user: 2 }],
      ["checkout to an out-of-scope asset", "snipeit_hardware_checkout", { id: 1, checkout_to_type: "asset", assigned_asset: 2 }],
      ["checkout to a location with no company", "snipeit_hardware_checkout", { id: 1, checkout_to_type: "location", assigned_location: 4 }],
      ["audit of an out-of-scope asset tag", "snipeit_hardware_audit", { asset_tag: "TAG-2" }],
      ["audit that moves an asset to an out-of-scope location", "snipeit_hardware_audit", { asset_tag: "TAG-1", location_id: 4 }],
      ["update that moves an asset to an out-of-scope location", "snipeit_hardware_update", { id: 1, location_id: 4 }],
      ["create in another company", "snipeit_hardware_create", { asset_tag: "N1", status_id: 1, model_id: 1, company_id: 2 }],
      ["accessory checkout to an out-of-scope user", "snipeit_accessories_checkout", { id: 1, assigned_to: 2 }],
      ["accessory update that moves it to another company", "snipeit_accessories_update", { id: 1, company_id: 2 }],
      ["accessory checkin without naming the accessory", "snipeit_accessories_checkin", { assigned_pivot_id: 42 }],
      ["accessory checkin of a row belonging to another accessory", "snipeit_accessories_checkin", { assigned_pivot_id: 77, id: 1 }],
      ["accessory checkin under an out-of-scope accessory", "snipeit_accessories_checkin", { assigned_pivot_id: 77, id: 2 }],
      ["component checkout into an out-of-scope asset", "snipeit_components_checkout", { id: 1, assigned_to: 2 }],
    ])("refuses %s before any POST/PATCH is sent", async (_label, tool, args) => {
      const fetchMock = mockApi({ ...records, ...writeRoutes });
      const { callTool } = await loadServer(scoped);

      const result = await callTool(tool, args);

      expect(result.isError).toBe(true);
      expect(writesSent(fetchMock)).toEqual([]);
    });

    it("reports out-of-scope write targets with the generic not-found-or-not-permitted error", async () => {
      mockApi({ ...records, ...writeRoutes });
      const { callTool } = await loadServer(scoped);
      expect(textOf(await callTool("snipeit_hardware_update", { id: 2, name: "x" }))).toBe(DENIED);
      expect(textOf(await callTool("snipeit_hardware_update", { id: 999, name: "x" }))).toBe(DENIED);
    });

    it("allows writes whose target and checkout target are both in scope", async () => {
      const fetchMock = mockApi({ ...records, ...writeRoutes });
      const { callTool } = await loadServer(scoped);

      const results = [
        await callTool("snipeit_hardware_checkout", { id: 1, checkout_to_type: "user", assigned_user: 1 }),
        await callTool("snipeit_hardware_checkout", { id: 1, checkout_to_type: "location", assigned_location: 8 }),
        await callTool("snipeit_hardware_audit", { asset_tag: "TAG-1" }),
        await callTool("snipeit_accessories_checkin", { assigned_pivot_id: 42, id: 1 }),
        await callTool("snipeit_components_checkout", { id: 1, assigned_to: 1 }),
      ];
      for (const r of results) expect(r.isError, textOf(r)).toBeUndefined();
      expect(writesSent(fetchMock)).toEqual([
        "POST /api/v1/hardware/1/checkout",
        "POST /api/v1/hardware/1/checkout",
        "POST /api/v1/hardware/audit",
        "POST /api/v1/accessories/42/checkin",
        "POST /api/v1/components/1/checkout",
      ]);
    });

    it("creates records inside the permitted company", async () => {
      const fetchMock = mockApi({ ...records, ...writeRoutes });
      const { callTool } = await loadServer(scoped);

      await callTool("snipeit_hardware_create", { asset_tag: "N1", status_id: 1, model_id: 1 });
      const [, init] = fetchMock.mock.calls.find(([, i]) => (i as RequestInit).method === "POST")!;
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        asset_tag: "N1",
        status_id: 1,
        model_id: 1,
        company_id: 1,
      });
    });

    it("requires an explicit permitted company on create when several are permitted", async () => {
      const fetchMock = mockApi({ ...records, ...writeRoutes });
      const { callTool } = await loadServer({ ...scoped, SNIPEIT_ALLOWED_COMPANY_IDS: "1,3" });

      const missing = await callTool("snipeit_accessories_create", { name: "Dock", qty: 1, category_id: 6 });
      expect(missing.isError).toBe(true);
      expect(textOf(missing)).toMatch(/company_id is required/);
      expect(writesSent(fetchMock)).toEqual([]);

      const ok = await callTool("snipeit_accessories_create", { name: "Dock", qty: 1, category_id: 6, company_id: 3 });
      expect(ok.isError).toBeUndefined();
      expect(writesSent(fetchMock)).toEqual(["POST /api/v1/accessories"]);
    });
  });
});

// ─────────────────────────────── field allowlist ────────────────────────────────

describe("field allowlist", () => {
  it("hardware list and get expose identification fields only", async () => {
    mockApi({
      "GET /api/v1/hardware": { total: 1, rows: [asset(1, 1)] },
      "GET /api/v1/hardware/1": asset(1, 1),
    });
    const { callTool } = await loadServer();

    const list = await callTool("snipeit_hardware_list", {});
    const get = await callTool("snipeit_hardware_get", { id: 1 });
    for (const result of [list, get]) expect(textOf(result)).not.toMatch(HIDDEN);

    const record = parse(get);
    expect(record).toEqual(parse<Rows>(list).rows[0]);
    expect(record).toEqual({
      id: 1,
      name: "PC-1",
      asset_tag: "TAG-1",
      serial: "SER-1",
      model: { id: 3, name: "Latitude 5440" },
      model_number: "L5440",
      category: { id: 1, name: "Laptops" },
      manufacturer: { id: 1, name: "Dell" },
      status_label: { id: 2, name: "Ready to Deploy", status_type: "deployable", status_meta: "deployable" },
      company: { id: 1, name: "Company 1" },
      location: { id: 4, name: "HQ" },
      rtd_location: { id: 4, name: "HQ" },
      assigned_to: { id: 7, name: "John Doe", type: "user", username: "jdoe" },
      purchase_date: "2025-01-01",
      warranty_months: "36 months",
      warranty_expires: "2028-01-01",
      last_audit_date: "2026-01-01 10:00:00",
      next_audit_date: "2027-01-01",
      created_at: "2025-01-02 10:00:00",
      updated_at: "2026-02-03 10:00:00",
    });
    for (const key of ["notes", "custom_fields", "purchase_cost", "order_number", "supplier", "book_value", "image"]) {
      expect(record, key).not.toHaveProperty(key);
    }
  });

  it("licenses never expose product_key, licensed-to name/email, notes or cost", async () => {
    mockApi({
      "GET /api/v1/licenses": { total: 1, rows: [license(1, 1)] },
      "GET /api/v1/licenses/1": license(1, 1),
      "GET /api/v1/users/5": user(5, 1),
      "GET /api/v1/users/5/licenses": { total: 1, rows: [license(1, 1)] },
    });
    const { callTool } = await loadServer();

    const results = [
      await callTool("snipeit_licenses_list", {}),
      await callTool("snipeit_licenses_get", { id: 1 }),
      await callTool("snipeit_users_licenses", { id: 5 }),
    ];
    for (const result of results) {
      expect(result.isError).toBeUndefined();
      expect(textOf(result)).not.toMatch(HIDDEN);
      expect(textOf(result)).not.toMatch(/product_key|license_name|license_email|notes|purchase_cost/);
    }
    expect(parse(results[1])).toEqual({
      id: 1,
      name: "Office 1",
      company: { id: 1, name: "Company 1" },
      manufacturer: { id: 2, name: "Microsoft" },
      category: { id: 8, name: "Software" },
      seats: 10,
      free_seats_count: 4,
      reassignable: true,
      maintained: false,
      purchase_date: "2025-05-05",
      expiration_date: "2027-05-05",
      created_at: "2025-05-06 10:00:00",
      updated_at: "2025-05-07 10:00:00",
    });
  });

  it("users never expose phone, address, employee number, manager, permissions, 2FA, avatar or last login", async () => {
    mockApi({
      "GET /api/v1/users": { total: 1, rows: [user(5, 1)] },
      "GET /api/v1/users/5": user(5, 1),
    });
    const { callTool } = await loadServer();

    const list = await callTool("snipeit_users_list", {});
    const get = await callTool("snipeit_users_get", { id: 5 });
    for (const result of [list, get]) {
      expect(textOf(result)).not.toMatch(HIDDEN);
      expect(textOf(result)).not.toMatch(
        /phone|address|city|state|zip|country|employee_num|manager|permissions|two_factor|avatar|last_login|notes|activated|ldap_import/
      );
    }
    expect(parse(get)).toEqual({
      id: 5,
      name: "User 5",
      first_name: "User",
      last_name: "5",
      username: "user5",
      email: "user5@example.com",
      jobtitle: "Technician",
      department: { id: 5, name: "Service" },
      location: { id: 4, name: "HQ" },
      company: { id: 1, name: "Company 1" },
      assets_count: 2,
      licenses_count: 1,
      accessories_count: 0,
      consumables_count: 0,
      created_at: "2024-01-01 10:00:00",
      updated_at: "2026-01-01 10:00:00",
    });
  });

  it("reports and sub-resource lists are filtered the same way", async () => {
    mockApi({
      "GET /api/v1/hardware/audit/due": { total: 1, rows: [asset(1, 1)] },
      "GET /api/v1/hardware/audit/overdue": { total: 1, rows: [asset(2, 1)] },
      "GET /api/v1/statuslabels/2/assetlist": { total: 1, rows: [asset(3, 1)] },
      "GET /api/v1/locations/4/assets": { total: 1, rows: [asset(4, 1)] },
      "GET /api/v1/users/5/assets": { total: 1, rows: [asset(5, 1)] },
      "GET /api/v1/users/5/accessories": { total: 1, rows: [accessory(1, 1)] },
      "GET /api/v1/accessories": { total: 1, rows: [accessory(1, 1, { remaining_qty: 0 })] },
      "GET /api/v1/accessories/1/checkedout": {
        total: 1,
        rows: [{ assigned_pivot_id: 42, id: 5, username: "user5", name: "User 5", employee_number: "EMPNUM-HIDDEN", checkout_notes: "NOTES-HIDDEN", last_checkout: { datetime: "2026-01-01 09:00:00", formatted: "x" } }],
      },
      "GET /api/v1/reports/activity": {
        total: 1,
        rows: [{
          id: 9, action_type: "update", note: "NOTES-HIDDEN", remote_ip: "IP-HIDDEN", user_agent: "UA-HIDDEN",
          log_meta: { product_key: { old: "OLDKEY-HIDDEN", new: "NEWKEY-HIDDEN" } },
          item: { id: 1, name: "PC-1", type: "asset" }, admin: { id: 2, name: "Admin", first_name: "A", last_name: "D" },
          target: { id: 5, name: "User 5", type: "user" }, created_at: { datetime: "2026-01-01 09:00:00", formatted: "x" },
        }],
      },
    });
    const { callTool } = await loadServer();

    const calls: Array<[string, Record<string, unknown>]> = [
      ["snipeit_reports_audit_due", {}],
      ["snipeit_reports_audit_overdue", {}],
      ["snipeit_statuslabels_assets", { id: 2 }],
      ["snipeit_locations_assets", { id: 4 }],
      ["snipeit_users_assets", { id: 5 }],
      ["snipeit_users_accessories", { id: 5 }],
      ["snipeit_reports_low_stock", { type: "accessories" }],
      ["snipeit_accessories_checkedout", { id: 1 }],
      ["snipeit_reports_activity", {}],
    ];
    for (const [name, args] of calls) {
      const result = await callTool(name, args);
      expect(result.isError, `${name}: ${textOf(result)}`).toBeUndefined();
      expect(textOf(result), name).not.toMatch(HIDDEN);
      expect(textOf(result), name).not.toMatch(/notes|custom_fields|purchase_cost|log_meta|remote_ip/);
      expect(textOf(result).length, name).toBeGreaterThan(20);
    }

    expect(parse<Rows>(await callTool("snipeit_reports_activity", {})).rows[0]).toEqual({
      id: 9,
      action_type: "update",
      item: { id: 1, name: "PC-1", type: "asset" },
      target: { id: 5, name: "User 5", type: "user" },
      admin: { id: 2, name: "Admin" },
      created_at: "2026-01-01 09:00:00",
    });
    expect(parse<Rows>(await callTool("snipeit_accessories_checkedout", { id: 1 })).rows[0]).toEqual({
      assigned_pivot_id: 42,
      id: 5,
      username: "user5",
      name: "User 5",
      last_checkout: "2026-01-01 09:00:00",
    });
  });

  it("write responses are filtered: the raw payload row loses notes, cost and custom columns", async () => {
    mockApi({
      "PATCH /api/v1/hardware/1": {
        status: "success",
        messages: "Asset updated successfully. See https://snipe.example.com/hardware/1",
        payload: {
          id: 1, name: "PC-1", asset_tag: "TAG-1", serial: "SER-1", model_id: 3, status_id: 2,
          company_id: 1, location_id: 4, assigned_to: 7, assigned_type: "App\\Models\\User",
          notes: "NOTES-HIDDEN", purchase_cost: "COST-HIDDEN", order_number: "ORDER-HIDDEN",
          _snipeit_mac_1: "CUSTOMFIELD-HIDDEN", supplier_id: 9, user_id: 1,
          created_at: "2025-01-02 10:00:00",
        },
      },
      "POST /api/v1/hardware/1/checkout": { status: "success", messages: "Asset checked out", payload: { asset: "TAG-1" } },
      "POST /api/v1/accessories": {
        status: "success",
        messages: "Accessory created",
        payload: { id: 12, name: "Dock", qty: 3, notes: "NOTES-HIDDEN", purchase_cost: "COST-HIDDEN", order_number: "ORDER-HIDDEN" },
      },
    });
    const { callTool } = await loadServer({ SNIPEIT_WRITE_TOOLS: "*" });

    const update = await callTool("snipeit_hardware_update", { id: 1, notes: "new note", purchase_cost: 5 });
    expect(textOf(update)).not.toMatch(HIDDEN);
    expect(parse(update)).toEqual({
      status: "success",
      messages: "Asset updated successfully. See [url removed]",
      payload: {
        id: 1, name: "PC-1", asset_tag: "TAG-1", serial: "SER-1", model_id: 3, status_id: 2,
        company_id: 1, location_id: 4, assigned_to: 7, assigned_type: "App\\Models\\User",
        created_at: "2025-01-02 10:00:00",
      },
    });

    const checkout = await callTool("snipeit_hardware_checkout", { id: 1, checkout_to_type: "user", assigned_user: 7 });
    expect(parse(checkout)).toEqual({ status: "success", messages: "Asset checked out", payload: { asset: "TAG-1" } });

    const create = await callTool("snipeit_accessories_create", { name: "Dock", qty: 3, category_id: 6 });
    expect(textOf(create)).not.toMatch(HIDDEN);
    expect(parse<{ payload: unknown }>(create).payload).toEqual({ id: 12, name: "Dock", qty: 3 });
  });

  it("drops objects smuggled into scalar fields and unknown keys of nested references", async () => {
    mockApi({
      "GET /api/v1/hardware/1": {
        id: 1,
        name: { html: "NESTED-HIDDEN" },
        serial: ["ARRAY-HIDDEN"],
        company: { id: 1, name: "Company 1", notes: "NOTES-HIDDEN", address: { street: "ADDRESS-HIDDEN" } },
        location: { id: 4, name: { deep: "NESTED-HIDDEN" } },
        brand_new_upstream_field: "FUTURE-HIDDEN",
      },
    });
    const { callTool } = await loadServer();
    expect(parse(await callTool("snipeit_hardware_get", { id: 1 }))).toEqual({
      id: 1,
      company: { id: 1, name: "Company 1" },
      location: { id: 4 },
    });
  });

  describe("SNIPEIT_EXTRA_FIELDS", () => {
    it("adds back only the named, unlockable fields", async () => {
      mockApi({ "GET /api/v1/hardware/1": asset(1, 1), "GET /api/v1/users/5": user(5, 1) });
      const { callTool } = await loadServer({ SNIPEIT_EXTRA_FIELDS: "hardware.custom_fields, hardware.notes" });

      const record = parse(await callTool("snipeit_hardware_get", { id: 1 }));
      expect(record.custom_fields).toEqual({ "MAC Address": "CUSTOMFIELD-HIDDEN" });
      expect(record.notes).toBe("NOTES-HIDDEN door code 4471");
      expect(record).not.toHaveProperty("purchase_cost");
      expect(record).not.toHaveProperty("order_number");
      // Unlocking a hardware field does not unlock anything on users.
      expect(textOf(await callTool("snipeit_users_get", { id: 5 }))).not.toMatch(HIDDEN);
    });

    it.each([
      "licenses.product_key",
      "users.permissions",
      "users.two_factor_enrolled",
      "activity.log_meta",
      "hardware.bogus",
      "nosuchresource.notes",
      "hardware",
      "hardware.notes.extra",
      "license_seats.notes",
    ])("refuses to start with %s", async (entry) => {
      const { createMcpServer, policy } = await loadServer({ SNIPEIT_EXTRA_FIELDS: `hardware.notes,${entry}` });
      await expect(createMcpServer()).rejects.toThrow(/SNIPEIT_EXTRA_FIELDS/);
      expect(() => policy.getPolicy()).toThrow(/cannot be unlocked/);
    });

    it("product_key stays hidden whatever else is unlocked", async () => {
      mockApi({ "GET /api/v1/licenses/1": license(1, 1) });
      const { callTool } = await loadServer({
        SNIPEIT_EXTRA_FIELDS: "licenses.notes,licenses.license_name,licenses.license_email,licenses.purchase_cost",
      });
      const result = await callTool("snipeit_licenses_get", { id: 1 });
      expect(textOf(result)).toMatch(/LICENSENAME-HIDDEN/);
      expect(textOf(result)).not.toMatch(/product_key|PRODUCTKEY/);
    });
  });

  describe("hidden fields cannot be probed through query parameters", () => {
    it("forwards only allowlisted query parameters and visible sort fields", async () => {
      const fetchMock = mockApi({ "GET /api/v1/hardware": { total: 0, rows: [] } });
      const { callTool } = await loadServer();

      await callTool("snipeit_hardware_list", {
        limit: 5,
        status_id: 2,
        sort: "purchase_cost",
        order: "desc; drop",
        filter: '{"notes":"door code"}',
        deleted: "true",
        nested: { a: 1 },
      });
      await callTool("snipeit_hardware_list", { sort: "asset_tag", order: "asc", limit: 100000 });

      const first = new URL(String(fetchMock.mock.calls[0][0])).searchParams;
      expect([...first.keys()].sort()).toEqual(["limit", "status_id"]);
      const second = new URL(String(fetchMock.mock.calls[1][0])).searchParams;
      expect(Object.fromEntries(second)).toEqual({ sort: "asset_tag", order: "asc", limit: "500" });
    });

    it("search only returns rows that match on a visible field", async () => {
      // Upstream matched the term against the hidden product_key of license 2.
      mockApi({
        "GET /api/v1/licenses": (url: URL) =>
          url.searchParams.get("search") === "PRODUCTKEY-HIDDEN-AAAAA"
            ? { total: 1, rows: [license(2, 1)] }
            : { total: 2, rows: [license(1, 1, { name: "Visio Pro" }), license(2, 1, { notes: "visio add-on" })] },
      });
      const { callTool } = await loadServer();

      const probe = await callTool("snipeit_licenses_list", { search: "PRODUCTKEY-HIDDEN-AAAAA" });
      expect(parse<Rows>(probe)).toEqual({ total: 0, rows: [] });

      const visible = parse<Rows>(await callTool("snipeit_licenses_list", { search: "visio" }));
      expect(visible.total).toBe(1);
      expect(visible.rows.map((r) => r.id)).toEqual([1]);
    });
  });
});
