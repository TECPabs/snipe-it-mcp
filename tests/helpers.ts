import { vi } from "vitest";

export const BASE = "https://snipe.example.com";
export const TOKEN = "test-token-3f9a1c7e5b2d";

const MANAGED_ENV = [
  "SNIPEIT_URL",
  "SNIPEIT_API_TOKEN",
  "SNIPEIT_WRITE_TOOLS",
  "SNIPEIT_ALLOWED_COMPANY_IDS",
  "SNIPEIT_EXTRA_FIELDS",
  "SNIPEIT_ALLOW_INSECURE_HTTP",
  "LOG_LEVEL",
];

/**
 * Load a fresh copy of the server modules under a given environment. The
 * policy and client configuration are read once per module instance, so each
 * call gets its own (vi.resetModules) — exactly like a new process would.
 */
export async function loadServer(env: Record<string, string | undefined> = {}) {
  for (const key of MANAGED_ENV) delete process.env[key];
  const merged: Record<string, string | undefined> = {
    SNIPEIT_URL: BASE,
    SNIPEIT_API_TOKEN: TOKEN,
    ...env,
  };
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined) process.env[k] = v;
  }
  vi.resetModules();
  const server = await import("../src/mcp-server.js");
  const client = await import("../src/utils/client.js");
  const policy = await import("../src/utils/policy.js");
  const errors = await import("../src/utils/errors.js");
  return { ...server, client, policy, errors };
}

export function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

type RouteReply = unknown | ((url: URL, init: RequestInit) => unknown);

/**
 * A fetch mock driven by a `"METHOD /api/v1/path"` table. A reply may be a JSON
 * body, a Response, or a function of the request. Anything not in the table
 * answers like Snipe-IT does for a missing record (HTTP 404).
 */
export function mockApi(routes: Record<string, RouteReply>) {
  const mock = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const key = `${init.method ?? "GET"} ${url.pathname}`;
    if (!(key in routes)) return jsonResponse({ message: "Not Found" }, { status: 404 });
    const reply = routes[key];
    const value = typeof reply === "function" ? reply(url, init) : reply;
    return value instanceof Response ? value : jsonResponse(value);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** `"METHOD /path"` for every request the mock received, in order. */
export function requests(mock: ReturnType<typeof mockApi>): string[] {
  return mock.mock.calls.map(([input, init]) => {
    const url = new URL(String(input));
    return `${(init as RequestInit | undefined)?.method ?? "GET"} ${url.pathname}`;
  });
}

export function writesSent(mock: ReturnType<typeof mockApi>): string[] {
  return requests(mock).filter((r) => !r.startsWith("GET "));
}

export function textOf(result: { content: Array<{ text: string }> }): string {
  return result.content[0].text;
}

export function parse<T = Record<string, unknown>>(result: { content: Array<{ text: string }> }): T {
  return JSON.parse(textOf(result)) as T;
}

/** Capture everything written to stderr while the returned handle is active. */
export function captureStderr() {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  });
  return {
    output: () => chunks.join(""),
    restore: () => spy.mockRestore(),
  };
}

// ───────────────────────── upstream fixtures (full, unfiltered) ─────────────────────────

const stamp = (d: string) => ({ datetime: `${d} 10:00:00`, formatted: `${d} 10:00AM` });
const company = (id: number | null) => (id === null ? null : { id, name: `Company ${id}` });

/** A Snipe-IT asset exactly as the API returns it, including everything the server must hide. */
export function asset(id: number, companyId: number | null, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `PC-${id}`,
    asset_tag: `TAG-${id}`,
    serial: `SER-${id}`,
    model: { id: 3, name: "Latitude 5440" },
    model_number: "L5440",
    status_label: { id: 2, name: "Ready to Deploy", status_type: "deployable", status_meta: "deployable" },
    category: { id: 1, name: "Laptops" },
    manufacturer: { id: 1, name: "Dell" },
    supplier: { id: 9, name: "SUPPLIER-HIDDEN" },
    notes: "NOTES-HIDDEN door code 4471",
    order_number: "ORDER-HIDDEN",
    purchase_cost: "COST-HIDDEN",
    book_value: "BOOKVALUE-HIDDEN",
    company: company(companyId),
    location: { id: 4, name: "HQ" },
    rtd_location: { id: 4, name: "HQ" },
    image: "https://snipe.example.com/uploads/IMAGE-HIDDEN.png",
    assigned_to: {
      id: 7,
      username: "jdoe",
      name: "John Doe",
      first_name: "John",
      last_name: "Doe",
      email: "ASSIGNEE-EMAIL-HIDDEN@example.com",
      employee_number: "EMPNUM-HIDDEN",
      type: "user",
    },
    warranty_months: "36 months",
    warranty_expires: { date: "2028-01-01", formatted: "2028-01-01" },
    purchase_date: { date: "2025-01-01", formatted: "2025-01-01" },
    last_audit_date: stamp("2026-01-01"),
    next_audit_date: { date: "2027-01-01", formatted: "2027-01-01" },
    created_at: stamp("2025-01-02"),
    updated_at: stamp("2026-02-03"),
    custom_fields: {
      "MAC Address": { field: "_snipeit_mac_1", value: "CUSTOMFIELD-HIDDEN", field_format: "MAC" },
    },
    available_actions: { checkout: true, update: true },
    ...extra,
  };
}

export function user(id: number, companyId: number | null, extra: Record<string, unknown> = {}) {
  return {
    id,
    avatar: "https://snipe.example.com/AVATAR-HIDDEN.png",
    name: `User ${id}`,
    first_name: "User",
    last_name: String(id),
    username: `user${id}`,
    email: `user${id}@example.com`,
    employee_num: "EMPNUM-HIDDEN",
    manager: { id: 99, name: "MANAGER-HIDDEN" },
    jobtitle: "Technician",
    phone: "PHONE-HIDDEN",
    website: "https://WEBSITE-HIDDEN.example.com",
    address: "ADDRESS-HIDDEN",
    city: "CITY-HIDDEN",
    state: "STATE-HIDDEN",
    country: "COUNTRY-HIDDEN",
    zip: "ZIP-HIDDEN",
    department: { id: 5, name: "Service" },
    location: { id: 4, name: "HQ" },
    notes: "NOTES-HIDDEN",
    permissions: { superuser: "PERMISSIONS-HIDDEN" },
    activated: true,
    ldap_import: false,
    two_factor_enrolled: false,
    two_factor_optin: false,
    assets_count: 2,
    licenses_count: 1,
    accessories_count: 0,
    consumables_count: 0,
    company: company(companyId),
    last_login: stamp("2026-03-03"),
    created_at: stamp("2024-01-01"),
    updated_at: stamp("2026-01-01"),
    ...extra,
  };
}

export function license(id: number, companyId: number | null, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `Office ${id}`,
    company: company(companyId),
    manufacturer: { id: 2, name: "Microsoft" },
    product_key: "PRODUCTKEY-HIDDEN-AAAAA-BBBBB",
    order_number: "ORDER-HIDDEN",
    purchase_order: "PO-HIDDEN",
    purchase_date: { date: "2025-05-05", formatted: "2025-05-05" },
    purchase_cost: "COST-HIDDEN",
    notes: "NOTES-HIDDEN",
    expiration_date: { date: "2027-05-05", formatted: "2027-05-05" },
    seats: 10,
    free_seats_count: 4,
    license_name: "LICENSENAME-HIDDEN",
    license_email: "LICENSEEMAIL-HIDDEN@example.com",
    reassignable: true,
    maintained: false,
    supplier: { id: 9, name: "SUPPLIER-HIDDEN" },
    category: { id: 8, name: "Software" },
    created_at: stamp("2025-05-06"),
    updated_at: stamp("2025-05-07"),
    ...extra,
  };
}

export function accessory(id: number, companyId: number | null, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `Dock ${id}`,
    company: company(companyId),
    manufacturer: { id: 1, name: "Dell" },
    supplier: { id: 9, name: "SUPPLIER-HIDDEN" },
    model_number: "WD19",
    category: { id: 6, name: "Docks" },
    location: { id: 4, name: "HQ" },
    notes: "NOTES-HIDDEN",
    qty: 10,
    purchase_cost: "COST-HIDDEN",
    order_number: "ORDER-HIDDEN",
    min_qty: 2,
    remaining_qty: 5,
    created_at: stamp("2025-01-01"),
    updated_at: stamp("2025-01-02"),
    ...extra,
  };
}

/** Every marker string that must never reach a tool result under the default policy. */
export const HIDDEN = /HIDDEN/;
