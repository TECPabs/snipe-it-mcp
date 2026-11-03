import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

process.env.SNIPEIT_URL = "https://snipe.example.com";
process.env.SNIPEIT_API_TOKEN = "test-token";

const { reportsHandler } = await import("../src/domains/reports.js");

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("reports endpoints", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("activity report hits /reports/activity with filters as query params", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ total: 0, rows: [] }));
    await reportsHandler.handleCall("snipeit_reports_activity", {
      item_type: "asset",
      item_id: 42,
      limit: 10,
    });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/api/v1/reports/activity");
    expect(url.searchParams.get("item_type")).toBe("asset");
    expect(url.searchParams.get("item_id")).toBe("42");
  });

  it("audit due/overdue hit their hardware endpoints", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ total: 0, rows: [] }));
    await reportsHandler.handleCall("snipeit_reports_audit_due", {});
    await reportsHandler.handleCall("snipeit_reports_audit_overdue", {});

    expect(fetchMock.mock.calls[0][0]).toContain("/api/v1/hardware/audit/due");
    expect(fetchMock.mock.calls[1][0]).toContain("/api/v1/hardware/audit/overdue");
  });
});

describe("low-stock report", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("flags items below minimum across the differing field names", async () => {
    // accessories page: min_qty + remaining_qty
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        total: 3,
        rows: [
          { id: 1, name: "OK item", qty: 7, min_qty: 3, remaining_qty: 5 },
          { id: 2, name: "Low item", qty: 67, min_qty: 3, remaining_qty: 2, location: { name: "Row 22" } },
          { id: 3, name: "No minimum", qty: 1, remaining_qty: 0 },
        ],
      })
    );
    // consumables page: min_amt + remaining_qty
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ total: 1, rows: [{ id: 9, name: "Toner", qty: 4, min_amt: 2, remaining_qty: 1 }] })
    );
    // components page: min_amt + remaining
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ total: 1, rows: [{ id: 5, name: "RAM", qty: 10, min_amt: 4, remaining: 4 }] })
    );

    const result = await reportsHandler.handleCall("snipeit_reports_low_stock", { type: "all" });
    const data = JSON.parse(result.content[0].text);

    expect(data.total_low).toBe(2);
    expect(data.accessories).toHaveLength(1);
    expect(data.accessories[0]).toMatchObject({ id: 2, remaining: 2, min: 3, location: "Row 22" });
    expect(data.consumables[0]).toMatchObject({ id: 9, remaining: 1, min: 2 });
    expect(data.components).toHaveLength(0); // remaining 4 is not below min 4
  });

  it("pages through large inventories until total is reached", async () => {
    const page = (start: number, n: number, total: number) =>
      jsonResponse({
        total,
        rows: Array.from({ length: n }, (_, i) => ({
          id: start + i,
          name: `Item ${start + i}`,
          qty: 1,
          min_qty: 1,
          remaining_qty: start + i === 501 ? 0 : 1,
        })),
      });

    fetchMock.mockResolvedValueOnce(page(1, 500, 600)).mockResolvedValueOnce(page(501, 100, 600));

    const result = await reportsHandler.handleCall("snipeit_reports_low_stock", {
      type: "accessories",
    });
    const data = JSON.parse(result.content[0].text);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = new URL(fetchMock.mock.calls[1][0] as string);
    expect(second.searchParams.get("offset")).toBe("500");
    expect(data.total_low).toBe(1);
    expect(data.accessories[0].id).toBe(501);
  });

  it("scans only the requested type", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ total: 0, rows: [] }));
    const result = await reportsHandler.handleCall("snipeit_reports_low_stock", {
      type: "components",
    });
    const data = JSON.parse(result.content[0].text);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/v1/components");
    expect(data.accessories).toBeUndefined();
  });
});
