import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

process.env.SNIPEIT_URL = "https://snipe.example.com/";
process.env.SNIPEIT_API_TOKEN = "test-token";

const { snipeGet, snipePost } = await import("../src/utils/client.js");

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("strips trailing slash from base URL and sends bearer auth", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ total: 0, rows: [] }));
    await snipeGet("/hardware", { limit: 1 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://snipe.example.com/api/v1/hardware?limit=1");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
  });

  it("omits empty query params", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await snipeGet("/hardware", { limit: 5, search: "" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://snipe.example.com/api/v1/hardware?limit=5");
  });

  it("throws on HTTP error statuses", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));
    await expect(snipeGet("/hardware")).rejects.toThrow(/401/);
  });

  it("throws on HTTP 200 responses carrying a Snipe-IT error payload", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: "error", messages: "Asset is not available for checkout" })
    );
    await expect(snipePost("/hardware/1/checkout", { assigned_user: 2 })).rejects.toThrow(
      /Asset is not available for checkout/
    );
  });

  it("stringifies structured error messages", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: "error", messages: { asset_tag: ["already taken"] } })
    );
    await expect(snipePost("/hardware", {})).rejects.toThrow(/already taken/);
  });

  it("throws a clear error on non-JSON responses", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>login page</html>", { status: 200 }));
    await expect(snipeGet("/hardware")).rejects.toThrow(/non-JSON/);
  });

  it("retries once after a 429, honoring retry-after", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response("Too Many Requests", { status: 429, headers: { "retry-after": "0" } })
      )
      .mockResolvedValueOnce(jsonResponse({ total: 1 }));

    const result = (await snipeGet("/hardware")) as { total: number };
    expect(result.total).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
