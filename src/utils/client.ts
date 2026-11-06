/**
 * Snipe-IT HTTP client.
 *
 * Two layers:
 *   1. `rawRequest` — transport. Private to this module. Validated base URL,
 *      bearer auth, timeout, one 429 retry, and errors that never contain an
 *      upstream response body.
 *   2. `snipeGet` / `snipePost` / `snipePatch` — the ONLY way the rest of the
 *      server can reach Snipe-IT. Each call is matched against the route
 *      allowlist and then has the access policy applied: write gating, company
 *      scope, and the per-resource field allowlist. What these functions
 *      return has already been filtered; callers cannot get an unfiltered
 *      record.
 */
import { logger } from "./logger.js";
import {
  ConfigError,
  InputError,
  PolicyError,
  SnipeApiError,
  newCorrelationId,
  notFoundOrDenied,
  sanitizeMessages,
  sanitizeText,
} from "./errors.js";
import {
  COMMON_WRITE_REFS,
  COMPANY_SCOPED,
  MAX_LIMIT,
  assertWriteContext,
  cleanQuery,
  companyIdOf,
  getPolicy,
  inScope,
  matchGetRoute,
  matchWriteRoute,
  matchesVisibleSearch,
  projectRecord,
  type GetRoute,
  type QueryParams,
  type Resource,
  type WriteRoute,
} from "./policy.js";

// ─────────────────────────────── configuration ────────────────────────────────

interface SnipeClient {
  baseUrl: string;
  host: string;
  token: string;
}

let _client: SnipeClient | null = null;

const TIMEOUT_MS = Number(process.env.SNIPEIT_TIMEOUT_MS) || 30_000;
const MAX_429_WAIT_S = 30;
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface ValidatedUrl {
  /** Origin + optional sub-path, no trailing slash. */
  baseUrl: string;
  /** host[:port], safe to display. */
  host: string;
  /** Plain http:// to a non-loopback host, accepted only by explicit operator opt-in. */
  insecure: boolean;
}

/**
 * Validate SNIPEIT_URL. Throws ConfigError (never echoing the raw value, which
 * may contain credentials) unless the URL parses, carries no embedded
 * credentials, and is HTTPS — or plain HTTP to a loopback host, or plain HTTP
 * with the operator's explicit opt-in.
 */
export function validateBaseUrl(raw: string, allowInsecureHttp: boolean): ValidatedUrl {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new ConfigError("SNIPEIT_URL is not a valid URL (expected e.g. https://snipe.example.com).");
  }
  if (u.username || u.password) {
    throw new ConfigError(
      "SNIPEIT_URL must not contain embedded credentials (user:pass@host). Use SNIPEIT_API_TOKEN."
    );
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new ConfigError("SNIPEIT_URL must be an https:// URL.");
  }
  if (u.search || u.hash) {
    throw new ConfigError("SNIPEIT_URL must not contain a query string or fragment.");
  }
  let insecure = false;
  if (u.protocol === "http:" && !LOOPBACK_HOSTS.has(u.hostname)) {
    if (!allowInsecureHttp) {
      throw new ConfigError(
        "SNIPEIT_URL must use https:// — over plain http:// the API token would be sent unencrypted. " +
          "http:// is accepted only for localhost / 127.0.0.1 / [::1], or when the operator sets " +
          "SNIPEIT_ALLOW_INSECURE_HTTP=true."
      );
    }
    insecure = true;
  }
  return { baseUrl: `${u.origin}${u.pathname.replace(/\/+$/, "")}`, host: u.host, insecure };
}

function allowInsecureHttp(): boolean {
  return process.env.SNIPEIT_ALLOW_INSECURE_HTTP?.trim().toLowerCase() === "true";
}

function getClient(): SnipeClient {
  if (_client) return _client;
  const rawUrl = process.env.SNIPEIT_URL?.trim();
  const token = process.env.SNIPEIT_API_TOKEN?.trim();
  if (!rawUrl || !token) {
    throw new ConfigError(
      "Missing required env vars: SNIPEIT_URL and SNIPEIT_API_TOKEN must be set."
    );
  }
  if (/\s/.test(token)) {
    throw new ConfigError("SNIPEIT_API_TOKEN must not contain whitespace.");
  }
  const { baseUrl, host, insecure } = validateBaseUrl(rawUrl, allowInsecureHttp());
  if (insecure) {
    logger.warn(
      "SECURITY WARNING: SNIPEIT_ALLOW_INSECURE_HTTP=true — the Snipe-IT API token and all asset data " +
        "are sent UNENCRYPTED over plain http:// on every request. Use https:// outside an isolated lab."
    );
  }
  _client = { baseUrl, host, token };
  return _client;
}

export function isConfigured(): boolean {
  return !!(process.env.SNIPEIT_URL?.trim() && process.env.SNIPEIT_API_TOKEN?.trim());
}

/**
 * Startup check. Returns false when the server is simply not configured yet
 * (tools will report that); throws ConfigError when a URL IS configured but is
 * not acceptable, so the process can exit instead of failing on first use.
 */
export function validateConfigAtStartup(): boolean {
  if (isConfigured()) {
    getClient();
    return true;
  }
  const rawUrl = process.env.SNIPEIT_URL?.trim();
  if (rawUrl) validateBaseUrl(rawUrl, allowInsecureHttp());
  return false;
}

/** host[:port] of the configured instance — never the full URL. */
export function getInstanceHost(): string {
  return getClient().host;
}

// ───────────────────────────────── transport ──────────────────────────────────

type Method = "GET" | "POST" | "PATCH";

function failure(
  kind: SnipeApiError["kind"],
  method: Method,
  logPath: string,
  status: number | undefined,
  message: (ref: string) => string
): SnipeApiError {
  const ref = newCorrelationId();
  // Correlation ID, method, path (no query string) and status — nothing else.
  logger.error("Snipe-IT request failed", { ref, method, path: logPath, status: status ?? kind });
  return new SnipeApiError(message(ref), kind, ref, status);
}

async function rawRequest(
  method: Method,
  path: string,
  params?: QueryParams,
  body?: unknown
): Promise<unknown> {
  const { baseUrl, token } = getClient();
  const url = new URL(`${baseUrl}/api/v1${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  const logPath = url.pathname;
  // Method and path only; query parameter NAMES, never values. No headers, no bodies.
  logger.debug(`${method} ${logPath}`, { query: [...url.searchParams.keys()] });

  const doFetch = () =>
    fetch(url.toString(), {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      // Never follow a redirect: it could downgrade to http:// or leave the configured host.
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  let res: Response;
  let text: string;
  try {
    res = await doFetch();
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after"));
      const waitS = Number.isFinite(ra) ? Math.min(Math.max(ra, 0), MAX_429_WAIT_S) : 5;
      logger.warn("Rate limited by Snipe-IT, retrying", { waitS });
      await new Promise((r) => setTimeout(r, waitS * 1000));
      res = await doFetch();
    }
    text = await res.text();
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      throw failure("timeout", method, logPath, undefined,
        (ref) => `Snipe-IT request timed out after ${TIMEOUT_MS}ms (${method} ${logPath}) [ref: ${ref}]`);
    }
    throw failure("network", method, logPath, undefined,
      (ref) => `Snipe-IT request failed (network error) [ref: ${ref}]`);
  }

  let data: unknown;
  let parsed = false;
  try {
    data = JSON.parse(text);
    parsed = true;
  } catch {
    // handled below — the body is never surfaced
  }
  const errorPayload =
    parsed && data !== null && typeof data === "object" && (data as { status?: unknown }).status === "error"
      ? sanitizeMessages((data as { messages?: unknown }).messages)
      : null;

  if (!res.ok) {
    const status = res.status;
    // Snipe-IT's own validation messages are useful on 4xx; 5xx bodies are never surfaced.
    const detail = errorPayload && status >= 400 && status < 500 ? `: ${errorPayload}` : "";
    const hint = status >= 300 && status < 400 ? " — redirects are not followed; check SNIPEIT_URL" : "";
    throw failure("http", method, logPath, status,
      (ref) => `Snipe-IT request failed (HTTP ${status})${detail}${hint} [ref: ${ref}]`);
  }

  if (!parsed) {
    throw failure("non_json", method, logPath, res.status,
      (ref) => `Snipe-IT returned a non-JSON response (HTTP ${res.status}) [ref: ${ref}]`);
  }

  // Snipe-IT reports many failures (validation, permissions, bad checkout)
  // as HTTP 200 with {"status": "error", "messages": ...} in the body.
  if (errorPayload !== null) {
    throw failure("application", method, logPath, res.status,
      (ref) => `Snipe-IT error: ${errorPayload} [ref: ${ref}]`);
  }

  return data;
}

/** Connectivity + credential check for snipeit_status. Returns nothing: no upstream data leaves this call. */
export async function checkConnection(): Promise<void> {
  await rawRequest("GET", "/hardware", { limit: 1 });
}

// ──────────────────────────── policy enforcement ──────────────────────────────

type Row = Record<string, unknown>;

interface ListResult {
  total: number;
  rows: Row[];
  /** Set when a server-side scan hit its page cap before reaching the end. */
  truncated?: true;
}

const SCAN_PAGE_SIZE = MAX_LIMIT;
const SCAN_MAX_PAGES = 20;
const DEFAULT_PAGE_SIZE = 50;

function rowsOf(data: unknown): Row[] {
  const rows = Array.isArray(data) ? data : (data as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows)
    ? rows.filter((r): r is Row => r !== null && typeof r === "object" && !Array.isArray(r))
    : [];
}

function totalOf(data: unknown, fallback: number): number {
  const total = (data as { total?: unknown } | null)?.total;
  return typeof total === "number" && Number.isFinite(total) ? total : fallback;
}

function positiveInt(value: unknown, what: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new InputError(`Invalid ${what}: expected a positive integer.`);
  }
  return n;
}

/**
 * While company scope is active, "the record does not exist" and "the record
 * exists but belongs to another company" must be indistinguishable.
 */
function isAbsentOrForbidden(e: unknown): boolean {
  return (
    e instanceof SnipeApiError &&
    (e.kind === "application" || (e.kind === "http" && (e.status === 403 || e.status === 404)))
  );
}

/** Fetch a record of a company-scoped resource and require it to be in scope. Returns the raw record. */
async function fetchInScope(path: string): Promise<unknown> {
  let data: unknown;
  try {
    data = await rawRequest("GET", path);
  } catch (e) {
    if (isAbsentOrForbidden(e)) throw notFoundOrDenied();
    throw e;
  }
  if (!inScope(data)) throw notFoundOrDenied();
  return data;
}

/** Require `/<resource>/<id>` to be in scope (no-op for reference data or when scope is inactive). */
async function assertRecordInScope(resource: Resource, id: number): Promise<void> {
  if (getPolicy().allowedCompanyIds === null || !COMPANY_SCOPED.has(resource)) return;
  await fetchInScope(`/${resource}/${id}`);
}

/** Read every page of an upstream list, keeping the rows that pass `keep`. */
async function scanAll(
  path: string,
  params: QueryParams,
  keep: (row: Row) => boolean
): Promise<{ rows: Row[]; truncated: boolean }> {
  const rows: Row[] = [];
  let offset = 0;
  for (let page = 0; page < SCAN_MAX_PAGES; page++) {
    const data = await rawRequest("GET", path, { ...params, limit: SCAN_PAGE_SIZE, offset });
    const got = rowsOf(data);
    for (const row of got) if (keep(row)) rows.push(row);
    offset += got.length;
    if (got.length === 0 || offset >= totalOf(data, 0)) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

async function guardedList(route: GetRoute, path: string, rawParams?: Record<string, unknown>): Promise<ListResult> {
  const allowed = getPolicy().allowedCompanyIds;
  const query = cleanQuery(route.resource, rawParams);
  const project = (row: Row) => projectRecord(route.resource, row);

  const search = query.search !== undefined ? String(query.search) : undefined;
  const scoped = allowed !== null && route.rows === "company";

  // Fast path: nothing to filter row by row — one upstream request, upstream paging and total.
  if (!scoped && search === undefined) {
    const data = await rawRequest("GET", path, query);
    const rows = rowsOf(data);
    return { total: totalOf(data, rows.length), rows: rows.map(project) };
  }

  const { offset: rawOffset, limit: rawLimit, ...filters } = query;
  const offset = typeof rawOffset === "number" ? rawOffset : 0;
  const limit = typeof rawLimit === "number" ? rawLimit : route.paged ? DEFAULT_PAGE_SIZE : Infinity;

  // One upstream query per permitted company where the endpoint can filter by
  // company; otherwise a single unfiltered query. Either way the row-by-row
  // check below is the authority — the upstream filter is only an optimisation.
  let variants: Array<{ params: QueryParams; companyId?: number }>;
  if (scoped && route.companyFilter) {
    const requested = filters.company_id;
    const ids =
      requested === undefined
        ? [...allowed].sort((a, b) => a - b)
        : allowed.has(Number(requested)) ? [Number(requested)] : [];
    variants = ids.map((id) => ({ params: { ...filters, company_id: id }, companyId: id }));
  } else if (scoped) {
    const requested = filters.company_id;
    delete filters.company_id;
    variants = requested === undefined || allowed.has(Number(requested)) ? [{ params: filters }] : [];
  } else {
    variants = [{ params: filters }];
  }

  const rowAllowed = (row: Row, companyId?: number): boolean => {
    if (scoped) {
      const id = companyIdOf(row);
      if (id === null || !allowed.has(id)) return false;
      if (companyId !== undefined && id !== companyId) return false;
    }
    return search === undefined || matchesVisibleSearch(project(row), search);
  };

  // Exact paging without a full scan: possible when every variant is a
  // company-filtered upstream query and no search post-filter applies.
  if (scoped && route.companyFilter && search === undefined) {
    const rows: Row[] = [];
    let cumulative = 0;
    let trusted = true;
    for (const v of variants) {
      const need = limit - rows.length;
      const localOffset = Math.max(0, offset - cumulative);
      const data = await rawRequest("GET", path, {
        ...v.params,
        offset: localOffset,
        limit: Math.min(Math.max(need, 1), MAX_LIMIT),
      });
      const total = totalOf(data, 0);
      const got = need > 0 && localOffset < total ? rowsOf(data) : [];
      const kept = got.filter((r) => rowAllowed(r, v.companyId));
      // Upstream returned rows outside the company it was asked for: its total
      // counts rows we must not reveal, so fall back to counting what we return.
      if (kept.length !== got.length) trusted = false;
      rows.push(...kept.slice(0, Math.max(need, 0)));
      cumulative += total;
    }
    return { total: trusted ? cumulative : rows.length, rows: rows.map(project) };
  }

  // Otherwise: scan, filter, then page over the filtered set so that `total`
  // and offsets only ever describe rows the caller is allowed to see.
  const kept: Row[] = [];
  let truncated = false;
  for (const v of variants) {
    const result = await scanAll(path, v.params, (r) => rowAllowed(r, v.companyId));
    kept.push(...result.rows);
    truncated ||= result.truncated;
  }
  const page = kept.slice(offset, limit === Infinity ? undefined : offset + limit).map(project);
  return { total: kept.length, rows: page, ...(truncated ? { truncated: true as const } : {}) };
}

/**
 * GET a Snipe-IT API path. The path must be on the route allowlist. The result
 * is already company-scoped and reduced to the field allowlist.
 */
export async function snipeGet(path: string, params?: Record<string, unknown>): Promise<unknown> {
  const { route, id } = matchGetRoute(path);
  const scopeOn = getPolicy().allowedCompanyIds !== null;

  if (scopeOn && route.denyWhenScoped) {
    throw new PolicyError(
      "Request refused by server policy: this data cannot be restricted to the permitted companies."
    );
  }

  if (route.kind === "record") {
    const data =
      scopeOn && COMPANY_SCOPED.has(route.resource)
        ? await fetchInScope(path)
        : await rawRequest("GET", path);
    return projectRecord(route.resource, data);
  }

  if (route.parent) await assertRecordInScope(route.parent, positiveInt(id, "id"));
  return guardedList(route, path, params);
}

export interface WriteOptions {
  /**
   * For check-ins addressed by assignment-row ID: the ID of the accessory /
   * component the row belongs to. Required while company scope is active.
   */
  parentId?: unknown;
}

/** All company-scope checks for a write. Runs BEFORE anything is sent; returns the body to send. */
async function precheckWrite(
  route: WriteRoute,
  id: string | undefined,
  body: Row,
  opts: WriteOptions
): Promise<Row> {
  const allowed = getPolicy().allowedCompanyIds;
  if (allowed === null) return body;
  const out = { ...body };

  // The company a record is created in / moved to must itself be permitted.
  if (out.company_id !== undefined) {
    if (!allowed.has(Number(out.company_id))) throw notFoundOrDenied();
  } else if (route.target === "create") {
    if (allowed.size !== 1) {
      throw new InputError("company_id is required and must be one of the companies this server is permitted to manage.");
    }
    out.company_id = [...allowed][0];
  }

  // The record being written.
  if (route.target === "id") {
    await assertRecordInScope(route.resource, positiveInt(id, "id"));
  } else if (route.target === "asset_tag") {
    if (typeof out.asset_tag !== "string" || out.asset_tag === "") {
      throw new InputError("asset_tag is required.");
    }
    await fetchInScope(`/hardware/bytag/${encodeURIComponent(out.asset_tag)}`);
  } else if (route.target === "pivot") {
    if (opts.parentId === undefined || opts.parentId === null) {
      throw new InputError(
        `id (the ${route.resource} record the assignment belongs to) is required while this server restricts company scope.`
      );
    }
    const parentId = positiveInt(opts.parentId, "id");
    const pivotId = positiveInt(id, "assignment row ID");
    await assertRecordInScope(route.resource, parentId);
    const { rows } = await scanAll(`/${route.resource}/${parentId}/${route.pivotList}`, {}, (row) =>
      Number("assigned_pivot_id" in row ? row.assigned_pivot_id : row.id) === pivotId
    );
    if (rows.length === 0) throw notFoundOrDenied();
  }

  // Any other record the write points at (checkout targets, location).
  for (const [field, resource] of Object.entries({ ...COMMON_WRITE_REFS, ...(route.refs ?? {}) })) {
    if (out[field] === undefined) continue;
    await assertRecordInScope(resource, positiveInt(out[field], field));
  }
  return out;
}

async function guardedWrite(
  method: "POST" | "PATCH",
  path: string,
  body: unknown,
  opts: WriteOptions
): Promise<unknown> {
  // 1. Only an enabled write tool may write at all.
  assertWriteContext();
  // 2. Only known write paths.
  const { route, id } = matchWriteRoute(method, path);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new InputError("Request body must be an object.");
  }
  // 3. Company scope — verified before anything is sent.
  const outBody = await precheckWrite(route, id, body as Row, opts);

  const data = await rawRequest(method, path, undefined, outBody);

  // 4. Write responses go through the same field allowlist as reads.
  const res = (data ?? {}) as { status?: unknown; messages?: unknown; payload?: unknown };
  const out: Row = {};
  if (typeof res.status === "string") out.status = sanitizeText(res.status);
  if (res.messages !== undefined && res.messages !== null) out.messages = sanitizeMessages(res.messages);
  const payload = projectRecord(route.resource, res.payload, { payload: true });
  if (Object.keys(payload).length > 0) out.payload = payload;
  return out;
}

/** POST to a Snipe-IT API path. Refused unless running inside an enabled write tool. */
export async function snipePost(path: string, body: unknown, opts: WriteOptions = {}): Promise<unknown> {
  return guardedWrite("POST", path, body, opts);
}

/** PATCH a Snipe-IT API path. Refused unless running inside an enabled write tool. */
export async function snipePatch(path: string, body: unknown, opts: WriteOptions = {}): Promise<unknown> {
  return guardedWrite("PATCH", path, body, opts);
}
