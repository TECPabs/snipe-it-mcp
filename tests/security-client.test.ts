import { describe, it, expect, vi, afterEach } from "vitest";
import { BASE, TOKEN, captureStderr, jsonResponse, loadServer, mockApi, parse, textOf } from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SNIPEIT_URL validation", () => {
  it("rejects a plain http:// URL to a non-loopback host before any request is made", async () => {
    const fetchMock = mockApi({});
    const { client } = await loadServer({ SNIPEIT_URL: "http://snipe.example.com" });

    await expect(client.snipeGet("/hardware")).rejects.toThrow(/must use https:\/\//);
    expect(() => client.validateConfigAtStartup()).toThrow(/must use https:\/\//);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["http://localhost:8000", "http://127.0.0.1", "http://[::1]:8080"])(
    "accepts plain http for the loopback host %s",
    async (url) => {
      const fetchMock = mockApi({ "GET /api/v1/hardware": { total: 0, rows: [] } });
      const { client } = await loadServer({ SNIPEIT_URL: url });

      expect(client.validateConfigAtStartup()).toBe(true);
      await client.snipeGet("/hardware");
      expect(String(fetchMock.mock.calls[0][0])).toBe(`${url}/api/v1/hardware`);
    }
  );

  it("accepts plain http with the explicit operator opt-in, and warns loudly exactly once", async () => {
    const fetchMock = mockApi({ "GET /api/v1/hardware": { total: 0, rows: [] } });
    const { client } = await loadServer({
      SNIPEIT_URL: "http://snipe.example.com",
      SNIPEIT_ALLOW_INSECURE_HTTP: "true",
    });
    const stderr = captureStderr();

    await client.snipeGet("/hardware");
    await client.snipeGet("/hardware");

    stderr.restore();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(stderr.output().match(/SECURITY WARNING/g)).toHaveLength(1);
    expect(stderr.output()).toMatch(/UNENCRYPTED/);
  });

  it("does not treat other values of the opt-in as consent", async () => {
    const { client } = await loadServer({
      SNIPEIT_URL: "http://snipe.example.com",
      SNIPEIT_ALLOW_INSECURE_HTTP: "1",
    });
    await expect(client.snipeGet("/hardware")).rejects.toThrow(/must use https:\/\//);
  });

  it("rejects URLs that do not parse or are not http(s)", async () => {
    for (const bad of ["snipe.example.com", "not a url", "ftp://snipe.example.com", "localhost:8000"]) {
      const { client } = await loadServer({ SNIPEIT_URL: bad });
      await expect(client.snipeGet("/hardware"), bad).rejects.toThrow(/SNIPEIT_URL/);
    }
  });

  it("rejects embedded credentials without echoing them", async () => {
    const { client } = await loadServer({ SNIPEIT_URL: "https://admin:hunter2pw@snipe.example.com" });
    const error = await client.snipeGet("/hardware").catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/embedded credentials/);
    expect((error as Error).message).not.toMatch(/hunter2pw|admin/);
    expect(() => client.validateConfigAtStartup()).toThrow(/embedded credentials/);
  });

  it("rejects a base URL carrying a query string", async () => {
    const { client } = await loadServer({ SNIPEIT_URL: "https://snipe.example.com/?x=1" });
    await expect(client.snipeGet("/hardware")).rejects.toThrow(/query string/);
  });

  it("validates a configured URL at startup even when the token is missing", async () => {
    const { client } = await loadServer({
      SNIPEIT_URL: "http://snipe.example.com",
      SNIPEIT_API_TOKEN: undefined,
    });
    expect(() => client.validateConfigAtStartup()).toThrow(/must use https:\/\//);
  });

  it("rejects a missing token", async () => {
    const fetchMock = mockApi({});
    const { client } = await loadServer({ SNIPEIT_API_TOKEN: undefined });

    expect(client.validateConfigAtStartup()).toBe(false);
    await expect(client.snipeGet("/hardware")).rejects.toThrow(/SNIPEIT_API_TOKEN must be set/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never follows redirects", async () => {
    const fetchMock = mockApi({ "GET /api/v1/hardware": { total: 0, rows: [] } });
    const { client } = await loadServer();
    await client.snipeGet("/hardware");
    expect((fetchMock.mock.calls[0][1] as RequestInit).redirect).toBe("manual");
  });
});

describe("upstream error sanitization", () => {
  const LEAKY_BODY =
    "<html><body><h1>Whoops</h1><pre>PDOException: SQLSTATE[42S02] select * from users " +
    "in /var/www/snipeit/app/Http/Kernel.php:42 APP_KEY=base64:LEAKEDAPPKEY</pre></body></html>";

  it.each([401, 403, 500])("HTTP %i becomes status + correlation ID with none of the body", async (status) => {
    mockApi({ "GET /api/v1/hardware/5": new Response(LEAKY_BODY, { status }) });
    const { client, errors } = await loadServer();
    const stderr = captureStderr();

    const error = await client.snipeGet("/hardware/5").catch((e: unknown) => e);
    stderr.restore();

    expect(error).toBeInstanceOf(errors.SnipeApiError);
    const e = error as InstanceType<typeof errors.SnipeApiError>;
    expect(e.status).toBe(status);
    expect(e.correlationId).toMatch(/^[0-9a-f]{8}$/);
    expect(e.message).toBe(`Snipe-IT request failed (HTTP ${status}) [ref: ${e.correlationId}]`);
    expect(e.message).not.toMatch(/Whoops|SQLSTATE|Kernel|LEAKED|html/);

    // The same correlation ID is logged with method, path and status — and nothing from the body.
    const log = stderr.output();
    expect(log).toContain(e.correlationId);
    expect(log).toContain('"method":"GET"');
    expect(log).toContain('"path":"/api/v1/hardware/5"');
    expect(log).toContain(`"status":${status}`);
    expect(log).not.toMatch(/Whoops|SQLSTATE|Kernel|LEAKED/);
  });

  it("does not surface a JSON error body from a 5xx response", async () => {
    mockApi({
      "GET /api/v1/hardware": jsonResponse(
        { status: "error", messages: "SQLSTATE[HY000] connection to db01.internal failed", trace: ["LEAKED-FRAME"] },
        { status: 500 }
      ),
    });
    const { client } = await loadServer();
    const error = (await client.snipeGet("/hardware").catch((e: Error) => e)) as Error;
    expect(error.message).toMatch(/^Snipe-IT request failed \(HTTP 500\) \[ref: [0-9a-f]{8}\]$/);
  });

  it("surfaces sanitized validation messages from a 4xx Snipe-IT error payload", async () => {
    mockApi({
      "GET /api/v1/hardware": jsonResponse(
        { status: "error", messages: { asset_tag: ["The asset tag has already been taken."] } },
        { status: 422 }
      ),
    });
    const { client } = await loadServer();
    await expect(client.snipeGet("/hardware")).rejects.toThrow(
      /^Snipe-IT request failed \(HTTP 422\): asset_tag: The asset tag has already been taken\. \[ref: [0-9a-f]{8}\]$/
    );
  });

  it("non-JSON responses give a generic message with no body excerpt", async () => {
    mockApi({ "GET /api/v1/hardware": new Response("<html>LEAKED login page</html>", { status: 200 }) });
    const { client } = await loadServer();
    const error = (await client.snipeGet("/hardware").catch((e: Error) => e)) as Error;
    expect(error.message).toMatch(/^Snipe-IT returned a non-JSON response \(HTTP 200\) \[ref: [0-9a-f]{8}\]$/);
    expect(error.message).not.toMatch(/LEAKED|html/);
  });

  it("sanitizes Snipe-IT status:error messages (string form)", async () => {
    mockApi({
      "GET /api/v1/hardware": {
        status: "error",
        messages:
          "Checkout failed\nsee https://snipe.example.com/admin/secret?token=abc for details. " +
          `Bearer ${TOKEN} SQLSTATE[23000]: Integrity constraint violation: select * from assets where id = 1`,
      },
    });
    const { client } = await loadServer();
    const error = (await client.snipeGet("/hardware").catch((e: Error) => e)) as Error;

    expect(error.message).toMatch(/^Snipe-IT error: Checkout failed see \[url removed\]/);
    expect(error.message).toMatch(/\[ref: [0-9a-f]{8}\]$/);
    expect(error.message).not.toMatch(/\n/);
    expect(error.message).not.toMatch(/https?:|SQLSTATE|Integrity|select \*/i);
    expect(error.message).not.toContain(TOKEN);
  });

  it("sanitizes object-form messages into bounded field: message pairs", async () => {
    const messages: Record<string, string[]> = {};
    for (let i = 0; i < 12; i++) messages[`field_${i}`] = [`problem ${i} ${"x ".repeat(300)}`];
    mockApi({ "GET /api/v1/hardware": { status: "error", messages } });
    const { client } = await loadServer();
    const error = (await client.snipeGet("/hardware").catch((e: Error) => e)) as Error;

    expect(error.message).toContain("field_0: problem 0");
    expect(error.message).toContain("field_4: problem 4");
    expect(error.message).not.toContain("field_5");
    // 5 messages x ~200 chars, plus framing
    expect(error.message.length).toBeLessThan(1300);
  });

  it("strips tokens, paths and long opaque strings from messages", async () => {
    const { errors } = await loadServer();
    const out = errors.sanitizeMessages(
      "Failed api_key=sk_live_abcdef in /var/www/snipeit/storage/logs/laravel.log " +
        "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiIxIn0.c2lnbmF0dXJl done"
    );
    expect(out).not.toMatch(/sk_live|\/var\/www|eyJ0eXAi/);
    expect(out).toMatch(/^Failed/);
    expect(errors.sanitizeMessages(undefined)).toBe("request rejected");
    expect(errors.sanitizeMessages({ nested: { deep: { secret: "x" } } })).toBe("request rejected");
  });

  it("network failures do not expose the underlying error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(
        Object.assign(new TypeError("fetch failed"), {
          cause: new Error("connect ECONNREFUSED 10.20.30.40:443"),
        })
      )
    );
    const { client } = await loadServer();
    const error = (await client.snipeGet("/hardware").catch((e: Error) => e)) as Error;
    expect(error.message).toMatch(/^Snipe-IT request failed \(network error\) \[ref: [0-9a-f]{8}\]$/);
  });

  it("timeout errors name the path but never the query string", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("timed out"), { name: "TimeoutError" }))
    );
    const { client } = await loadServer();
    const error = (await client
      .snipeGet("/hardware", { search: "QUERYVALUE-SECRET" })
      .catch((e: Error) => e)) as Error;

    expect(error.message).toMatch(/timed out after \d+ms \(GET \/api\/v1\/hardware\) \[ref: [0-9a-f]{8}\]/);
    expect(error.message).not.toMatch(/QUERYVALUE|search|\?/);
  });
});

describe("logging", () => {
  it("at LOG_LEVEL=debug logs method, path and query parameter names — never values, bodies or the token", async () => {
    mockApi({
      "GET /api/v1/hardware": { total: 0, rows: [] },
      "POST /api/v1/hardware/1/checkin": { status: "success", messages: "ok", payload: { asset: "TAG-1" } },
      "GET /api/v1/hardware/9": new Response("UPSTREAM-BODY-SECRET", { status: 500 }),
    });
    const { client, callTool } = await loadServer({ LOG_LEVEL: "debug", SNIPEIT_WRITE_TOOLS: "*" });
    const stderr = captureStderr();

    await client.snipeGet("/hardware", { search: "QUERYVALUE-SECRET", limit: 5, status: "STATUSVALUE-SECRET" });
    await callTool("snipeit_hardware_checkin", { id: 1, note: "BODYVALUE-SECRET" });
    await callTool("snipeit_hardware_get", { id: 9 });

    stderr.restore();
    const log = stderr.output();

    expect(log).toContain("[DEBUG] GET /api/v1/hardware");
    expect(log).toContain('"query":["search","status","limit","offset"]');
    expect(log).toContain("[DEBUG] POST /api/v1/hardware/1/checkin");
    expect(log).toContain("[ERROR] Snipe-IT request failed");

    expect(log).not.toContain(TOKEN);
    expect(log).not.toMatch(/Bearer/i);
    expect(log).not.toMatch(/QUERYVALUE-SECRET|STATUSVALUE-SECRET|BODYVALUE-SECRET|UPSTREAM-BODY-SECRET/);
    expect(log).not.toContain("?");
  });

  it("redacts sensitive keys, bearer strings and the live token wherever they appear", async () => {
    await loadServer({ LOG_LEVEL: "debug" });
    const { logger, redact } = await import("../src/utils/logger.js");
    const stderr = captureStderr();

    logger.info(`calling with Authorization: Bearer ${TOKEN}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Cookie: "session=abc", Accept: "application/json" },
      api_key: "k-123",
      apiKey: "k-456",
      password: "pw",
      client_secret: "cs",
      nested: { url: `${BASE}/api/v1/hardware?api_token=${TOKEN}`, note: `raw ${TOKEN} inside` },
    });
    logger.error(`Fatal: token was ${TOKEN}`);

    stderr.restore();
    const log = stderr.output();
    expect(log).not.toContain(TOKEN);
    expect(log).not.toMatch(/k-123|k-456|"pw"|"cs"|session=abc/);
    expect(log).toContain("[REDACTED]");
    expect(log).toContain('"Accept":"application/json"');

    expect(redact({ token: "x", refresh_token: "y", safe: 1 })).toEqual({
      token: "[REDACTED]",
      refresh_token: "[REDACTED]",
      safe: 1,
    });
  });

  it("caps string length, collection size and nesting depth so records cannot be dumped", async () => {
    await loadServer();
    const { redact } = await import("../src/utils/logger.js");

    const long = redact("a".repeat(5000)) as string;
    expect(long.length).toBeLessThan(400);
    expect(long).toMatch(/\[truncated\]$/);

    const deep = redact({ a: { b: { c: { d: { e: "DEEP-VALUE" } } } } });
    expect(JSON.stringify(deep)).not.toContain("DEEP-VALUE");

    const wide = redact({ rows: Array.from({ length: 500 }, (_, i) => ({ id: i })) }) as { rows: unknown[] };
    expect(wide.rows.length).toBeLessThanOrEqual(11);

    const err = redact(new Error(`boom ${TOKEN}`)) as { message: string; stack?: string };
    expect(err.message).toBe("boom [REDACTED]");
    expect(err.stack).toBeUndefined();
  });

  it("unexpected internal errors reach the client only as a correlation ID", async () => {
    const { callTool } = await loadServer();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ total: 1, rows: [{ id: 1 }] })));
    const types = await import("../src/utils/types.js");
    const stderr = captureStderr();
    const result = types.fail(new TypeError(`internal detail ${TOKEN} at C:\\app\\secret.ts`));
    stderr.restore();

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Internal error \[ref: [0-9a-f]{8}\]$/);
    expect(stderr.output()).not.toContain(TOKEN);
    // sanity: a normal call still works in this module instance
    expect((await callTool("snipeit_hardware_list", {})).isError).toBeUndefined();
  });
});

describe("snipeit_status", () => {
  it("reports only connected + instance host", async () => {
    mockApi({ "GET /sub/api/v1/hardware": { total: 4321, rows: [{ id: 1, name: "LEAKED-ASSET" }] } });
    const { callTool } = await loadServer({ SNIPEIT_URL: "https://snipe.example.com/sub/" });

    const result = await callTool("snipeit_status");
    expect(result.isError).toBeUndefined();
    expect(parse(result)).toEqual({ status: "connected", instance: "snipe.example.com" });
  });

  it("reports not connected with only the sanitized failure", async () => {
    mockApi({ "GET /api/v1/hardware": new Response("<html>LEAKED stack trace</html>", { status: 401 }) });
    const { callTool } = await loadServer();

    const result = await callTool("snipeit_status");
    expect(result.isError).toBe(true);
    const body = parse<{ status: string; instance: string; reason: string }>(result);
    expect(body.status).toBe("not_connected");
    expect(body.instance).toBe("snipe.example.com");
    expect(body.reason).toMatch(/^Snipe-IT request failed \(HTTP 401\) \[ref: [0-9a-f]{8}\]$/);
    expect(textOf(result)).not.toMatch(/LEAKED|html/);
  });

  it("reports a rejected configuration without contacting anything", async () => {
    const fetchMock = mockApi({});
    const { callTool } = await loadServer({ SNIPEIT_URL: "http://snipe.example.com" });

    const result = await callTool("snipeit_status");
    expect(result.isError).toBe(true);
    expect(parse<{ status: string }>(result).status).toBe("not_connected");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
