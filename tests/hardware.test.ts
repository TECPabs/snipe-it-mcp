import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

process.env.SNIPEIT_URL = "https://snipe.example.com";
process.env.SNIPEIT_API_TOKEN = "test-token";

const { hardwareHandler } = await import("../src/domains/hardware.js");

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("hardware write allowlists", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse({ status: "success" }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("strips unadvertised fields from checkout bodies", async () => {
    await hardwareHandler.handleCall("snipeit_hardware_checkout", {
      id: 1,
      checkout_to_type: "user",
      assigned_user: 2,
      note: "issued",
      requestable: true,
      status_id: 99,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ checkout_to_type: "user", assigned_user: 2, note: "issued" });
  });

  it("strips unadvertised fields from create bodies", async () => {
    await hardwareHandler.handleCall("snipeit_hardware_create", {
      asset_tag: "A100",
      status_id: 1,
      model_id: 2,
      deleted_at: "2020-01-01",
      user_id: 1,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ asset_tag: "A100", status_id: 1, model_id: 2 });
  });

  it("never sends the path id inside the update body", async () => {
    await hardwareHandler.handleCall("snipeit_hardware_update", { id: 5, name: "PC-05" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://snipe.example.com/api/v1/hardware/5");
    expect(JSON.parse(init.body as string)).toEqual({ name: "PC-05" });
  });
});

describe("hardware tool annotations", () => {
  it("marks reads read-only and writes non-read-only", () => {
    const byName = new Map(hardwareHandler.getTools().map((t) => [t.name, t.annotations]));
    expect(byName.get("snipeit_hardware_list")?.readOnlyHint).toBe(true);
    expect(byName.get("snipeit_hardware_get")?.readOnlyHint).toBe(true);
    expect(byName.get("snipeit_hardware_checkout")?.readOnlyHint).toBe(false);
    expect(byName.get("snipeit_hardware_update")?.readOnlyHint).toBe(false);
    expect(byName.get("snipeit_hardware_update")?.destructiveHint).toBe(true);
  });
});
