import { logger } from "./logger.js";

interface SnipeClient {
  baseUrl: string;
  token: string;
}

let _client: SnipeClient | null = null;

const TIMEOUT_MS = Number(process.env.SNIPEIT_TIMEOUT_MS) || 30_000;
const MAX_429_WAIT_S = 30;

function getClient(): SnipeClient {
  if (_client) return _client;
  const baseUrl = process.env.SNIPEIT_URL?.replace(/\/$/, "");
  const token = process.env.SNIPEIT_API_TOKEN;
  if (!baseUrl || !token) {
    throw new Error(
      "Missing required env vars: SNIPEIT_URL and SNIPEIT_API_TOKEN must be set."
    );
  }
  _client = { baseUrl, token };
  return _client;
}

function headers(token: string): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function truncate(text: string, max = 500): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function request(
  method: "GET" | "POST" | "PATCH",
  url: string,
  body?: unknown
): Promise<unknown> {
  const { token } = getClient();
  logger.debug(method, { url });

  const doFetch = () =>
    fetch(url, {
      method,
      headers: headers(token),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  let res: Response;
  try {
    res = await doFetch();
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after"));
      const waitS = Number.isFinite(ra) ? Math.min(ra, MAX_429_WAIT_S) : 5;
      logger.warn("Rate limited by Snipe-IT, retrying", { waitS });
      await new Promise((r) => setTimeout(r, waitS * 1000));
      res = await doFetch();
    }
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new Error(`Snipe-IT request timed out after ${TIMEOUT_MS}ms (${method} ${url})`);
    }
    throw e;
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Snipe-IT API error ${res.status}: ${truncate(text)}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Snipe-IT returned non-JSON response (HTTP ${res.status}): ${truncate(text)}`);
  }

  // Snipe-IT reports many failures (validation, permissions, bad checkout)
  // as HTTP 200 with {"status": "error", "messages": ...} in the body.
  const maybeErr = data as { status?: unknown; messages?: unknown };
  if (maybeErr?.status === "error") {
    const messages =
      typeof maybeErr.messages === "string"
        ? maybeErr.messages
        : JSON.stringify(maybeErr.messages);
    throw new Error(`Snipe-IT error: ${messages}`);
  }

  return data;
}

export async function snipeGet(
  path: string,
  params?: Record<string, string | number | boolean>
): Promise<unknown> {
  const { baseUrl } = getClient();
  const url = new URL(`${baseUrl}/api/v1${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
  }
  return request("GET", url.toString());
}

export async function snipePost(path: string, body: unknown): Promise<unknown> {
  const { baseUrl } = getClient();
  return request("POST", `${baseUrl}/api/v1${path}`, body);
}

export async function snipePatch(path: string, body: unknown): Promise<unknown> {
  const { baseUrl } = getClient();
  return request("PATCH", `${baseUrl}/api/v1${path}`, body);
}

export function getBaseUrl(): string {
  return getClient().baseUrl;
}

export function isConfigured(): boolean {
  return !!(process.env.SNIPEIT_URL && process.env.SNIPEIT_API_TOKEN);
}
