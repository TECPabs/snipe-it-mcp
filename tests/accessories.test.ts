import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

process.env.SNIPEIT_URL = "https://snipe.example.com";
process.env.SNIPEIT_API_TOKEN = "test-token";
// Write tools are disabled by default; these tests exercise them, so enable them.
process.env.SNIPEIT_WRITE_TOOLS = "*";
delete process.env.SNIPEIT_ALLOWED_COMPANY_IDS;

const { callTool } = await import("../src/mcp-server.js");

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("accessories and components checkin routing", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse({ status: "success" }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accessory checkin uses the assignment row ID in the path, not an accessory id", async () => {
    await callTool("snipeit_accessories_checkin", {
      assigned_pivot_id: 42,
      note: "returned",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://snipe.example.com/api/v1/accessories/42/checkin");
    expect(JSON.parse(init.body as string)).toEqual({ note: "returned" });
  });

  it("accessory checkout posts to the accessory ID with allowlisted fields only", async () => {
    await callTool("snipeit_accessories_checkout", {
      id: 7,
      assigned_to: 3,
      note: "new hire",
      qty: 999,
      status_id: 1,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://snipe.example.com/api/v1/accessories/7/checkout");
    expect(JSON.parse(init.body as string)).toEqual({ assigned_to: 3, note: "new hire" });
  });

  it("component checkin uses the assignment row ID in the path", async () => {
    await callTool("snipeit_components_checkin", {
      component_asset_id: 11,
      checkin_qty: 2,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://snipe.example.com/api/v1/components/11/checkin");
    expect(JSON.parse(init.body as string)).toEqual({ checkin_qty: 2 });
  });

  it("rejects a checkin without the assignment row ID", async () => {
    const result = await callTool("snipeit_accessories_checkin", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/assigned_pivot_id/);
  });
});
