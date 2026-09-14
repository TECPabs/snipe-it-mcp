import { logger } from "./logger.js";

interface SnipeClient {
  baseUrl: string;
  token: string;
}

let _client: SnipeClient | null = null;

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

export async function snipeGet(
  path: string,
  params?: Record<string, string | number | boolean>
): Promise<unknown> {
  const { baseUrl, token } = getClient();
  const url = new URL(`${baseUrl}/api/v1${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
  }
  logger.debug("GET", { url: url.toString() });
  const res = await fetch(url.toString(), { headers: headers(token) });
  if (!res.ok) throw new Error(`Snipe-IT API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function snipePost(path: string, body: unknown): Promise<unknown> {
  const { baseUrl, token } = getClient();
  const url = `${baseUrl}/api/v1${path}`;
  logger.debug("POST", { url });
  const res = await fetch(url, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Snipe-IT API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function snipePatch(path: string, body: unknown): Promise<unknown> {
  const { baseUrl, token } = getClient();
  const url = `${baseUrl}/api/v1${path}`;
  logger.debug("PATCH", { url });
  const res = await fetch(url, {
    method: "PATCH",
    headers: headers(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Snipe-IT API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export function getBaseUrl(): string {
  return getClient().baseUrl;
}

export function isConfigured(): boolean {
  return !!(process.env.SNIPEIT_URL && process.env.SNIPEIT_API_TOKEN);
}
