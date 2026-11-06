/**
 * Server-side access policy.
 *
 * Everything here is enforced by code in the request path (the client and the
 * MCP call handler) — never by tool descriptions or by asking the model to
 * behave. All defaults fail closed:
 *
 *   SNIPEIT_WRITE_TOOLS          empty  -> read-only server
 *   SNIPEIT_ALLOWED_COMPANY_IDS  unset  -> no company restriction (warned at startup)
 *   SNIPEIT_EXTRA_FIELDS         empty  -> only the built-in field allowlist
 *
 * The environment is read once (first `getPolicy()` call, done at startup).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { ConfigError, PolicyError } from "./errors.js";

// ───────────────────────────── resources & fields ─────────────────────────────

export type Resource =
  | "hardware"
  | "users"
  | "licenses"
  | "license_seats"
  | "accessories"
  | "accessory_checkouts"
  | "consumables"
  | "consumable_users"
  | "components"
  | "component_assets"
  | "locations"
  | "models"
  | "categories"
  | "manufacturers"
  | "statuslabels"
  | "activity";

/**
 * How an allowlisted field is emitted:
 *  - "v"             scalar, or a Snipe-IT date object ({datetime|date, formatted}); any other object is dropped
 *  - "count"         like "v", but an instance-wide aggregate: dropped on reference data while company scope is active
 *  - "ref"           nested reference reduced to REF_KEYS (scalars only); a scalar value passes through
 *  - string[]        nested reference reduced to exactly these keys
 *  - "custom_fields" Snipe-IT custom field map reduced to {name: {value}}
 */
export type FieldSpec = "v" | "count" | "ref" | "custom_fields" | readonly string[];
type FieldMap = Readonly<Record<string, FieldSpec>>;

const REF_KEYS = ["id", "name", "type", "asset_tag", "serial", "username"] as const;
const STATUS_KEYS = ["id", "name", "status_type", "status_meta"] as const;
const STAMPS = { created_at: "v", updated_at: "v" } as const;

/**
 * Default-visible fields per resource. Anything not listed is dropped.
 * Deliberately absent everywhere: notes, custom_fields, purchase cost, order
 * numbers, supplier data; license product_key / license_name / license_email;
 * user phone, address, employee number, manager, permissions, 2FA, avatar,
 * last login, activation and LDAP flags.
 */
export const FIELD_ALLOWLIST: Readonly<Record<Resource, FieldMap>> = {
  hardware: {
    id: "v", name: "v", asset_tag: "v", serial: "v",
    model: "ref", model_number: "v", category: "ref", manufacturer: "ref",
    status_label: STATUS_KEYS, company: "ref", location: "ref", rtd_location: "ref",
    assigned_to: "ref",
    purchase_date: "v", warranty_months: "v", warranty_expires: "v",
    asset_eol_date: "v", eol: "v",
    last_audit_date: "v", next_audit_date: "v",
    last_checkout: "v", last_checkin: "v", expected_checkin: "v",
    user_can_checkout: "v", deleted_at: "v", ...STAMPS,
  },
  users: {
    id: "v", name: "v", first_name: "v", last_name: "v", username: "v", email: "v",
    jobtitle: "v", department: "ref", location: "ref", company: "ref",
    assets_count: "v", licenses_count: "v", accessories_count: "v", consumables_count: "v",
    deleted_at: "v", ...STAMPS,
  },
  licenses: {
    id: "v", name: "v", company: "ref", manufacturer: "ref", category: "ref",
    seats: "v", free_seats_count: "v", min_amt: "v", reassignable: "v", maintained: "v",
    purchase_date: "v", expiration_date: "v", termination_date: "v",
    user_can_checkout: "v", deleted_at: "v", ...STAMPS,
  },
  license_seats: {
    id: "v", license_id: "v", name: "v",
    assigned_user: "ref", assigned_asset: "ref", location: "ref",
    reassignable: "v", user_can_checkout: "v",
  },
  accessories: {
    id: "v", name: "v", model_number: "v",
    company: "ref", manufacturer: "ref", category: "ref", location: "ref",
    qty: "v", min_qty: "v", min_amt: "v", remaining_qty: "v", remaining: "v",
    users_count: "v", checkouts_count: "v",
    purchase_date: "v", user_can_checkout: "v", ...STAMPS,
  },
  accessory_checkouts: {
    assigned_pivot_id: "v", id: "v", name: "v", username: "v",
    first_name: "v", last_name: "v", type: "v", assigned_to: "ref",
    last_checkout: "v", created_at: "v",
  },
  consumables: {
    id: "v", name: "v", item_no: "v", model_number: "v",
    company: "ref", manufacturer: "ref", category: "ref", location: "ref",
    qty: "v", min_qty: "v", min_amt: "v", remaining_qty: "v", remaining: "v",
    purchase_date: "v", user_can_checkout: "v", ...STAMPS,
  },
  consumable_users: {
    id: "v", name: "ref", user: "ref", admin: "ref", created_at: "v",
  },
  components: {
    id: "v", name: "v", serial: "v",
    company: "ref", category: "ref", location: "ref",
    qty: "v", min_qty: "v", min_amt: "v", remaining_qty: "v", remaining: "v",
    purchase_date: "v", user_can_checkout: "v", ...STAMPS,
  },
  component_assets: {
    assigned_pivot_id: "v", id: "v", name: "v", asset_tag: "v",
    qty: "v", type: "v", created_at: "v",
  },
  locations: {
    id: "v", name: "v", parent: "ref", company: "ref",
    assets_count: "v", assigned_assets_count: "v", rtd_assets_count: "v", users_count: "v",
    ...STAMPS,
  },
  models: {
    id: "v", name: "v", model_number: "v", manufacturer: "ref", category: "ref",
    eol: "v", min_amt: "v", requestable: "v", assets_count: "count",
    deleted_at: "v", ...STAMPS,
  },
  categories: {
    id: "v", name: "v", category_type: "v",
    item_count: "count", assets_count: "count", accessories_count: "count",
    consumables_count: "count", components_count: "count", licenses_count: "count",
    ...STAMPS,
  },
  manufacturers: {
    id: "v", name: "v", url: "v", support_url: "v", support_phone: "v",
    support_email: "v", warranty_lookup_url: "v",
    assets_count: "count", licenses_count: "count",
    consumables_count: "count", accessories_count: "count",
    deleted_at: "v", ...STAMPS,
  },
  statuslabels: {
    id: "v", name: "v", type: "v", default_label: "v", assets_count: "count", ...STAMPS,
  },
  activity: {
    id: "v", action_type: "v", action_date: "v", next_audit_date: "v",
    item: "ref", target: "ref", admin: "ref", location: "ref", ...STAMPS,
  },
};

/**
 * The only fields an operator may add back with SNIPEIT_EXTRA_FIELDS.
 * This is itself an allowlist: a field that is not here cannot be unlocked.
 * `licenses.product_key`, user permissions / 2FA / avatar and the activity
 * report's `log_meta` are intentionally not unlockable.
 */
export const UNLOCKABLE_FIELDS: Readonly<Partial<Record<Resource, FieldMap>>> = {
  hardware: {
    custom_fields: "custom_fields", notes: "v", order_number: "v", purchase_cost: "v",
    book_value: "v", supplier: "ref", requestable: "v", byod: "v", age: "v",
    checkin_counter: "v", checkout_counter: "v", requests_counter: "v",
  },
  users: {
    phone: "v", employee_num: "v", manager: "ref", address: "v", city: "v", state: "v",
    zip: "v", country: "v", notes: "v", last_login: "v", activated: "v", ldap_import: "v",
    vip: "v", start_date: "v", end_date: "v",
  },
  licenses: {
    notes: "v", order_number: "v", purchase_order: "v", purchase_cost: "v",
    supplier: "ref", license_name: "v", license_email: "v", depreciation: "ref",
  },
  accessories: { notes: "v", order_number: "v", purchase_cost: "v", supplier: "ref" },
  consumables: { notes: "v", order_number: "v", purchase_cost: "v", supplier: "ref" },
  components: { notes: "v", order_number: "v", purchase_cost: "v", supplier: "ref" },
  locations: {
    address: "v", address2: "v", city: "v", state: "v", zip: "v", country: "v",
    phone: "v", fax: "v", manager: "ref", currency: "v",
  },
  models: { notes: "v", depreciation: "ref", fieldset: "ref" },
  statuslabels: { notes: "v", color: "v" },
  activity: { note: "v" },
};

/**
 * Write responses carry the raw database row in `payload` (flat `*_id` columns
 * rather than nested references). These scalar columns are allowed there in
 * addition to the resource's own allowlist; everything else is dropped.
 */
const WRITE_PAYLOAD_FIELDS: FieldMap = {
  model_id: "v", status_id: "v", company_id: "v", location_id: "v", rtd_location_id: "v",
  category_id: "v", manufacturer_id: "v", assigned_type: "v", asset: "v", model: "v",
};

/** Resources whose records belong to a company. Everything else is reference data. */
export const COMPANY_SCOPED: ReadonlySet<Resource> = new Set<Resource>([
  "hardware", "users", "licenses", "accessories", "consumables", "components", "locations",
]);

// ───────────────────────────────── policy ─────────────────────────────────────

export interface Policy {
  /** SNIPEIT_WRITE_TOOLS=* */
  readonly writeAll: boolean;
  /** Explicitly enabled write tool names. */
  readonly writeTools: ReadonlySet<string>;
  /** null = no company restriction. */
  readonly allowedCompanyIds: ReadonlySet<number> | null;
  /** Operator-unlocked fields, already validated against UNLOCKABLE_FIELDS. */
  readonly extraFields: Readonly<Partial<Record<Resource, FieldMap>>>;
}

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parse and validate the policy environment. Throws ConfigError on anything it does not understand. */
export function loadPolicy(env: NodeJS.ProcessEnv = process.env): Policy {
  // Write tools
  const writeEntries = csv(env.SNIPEIT_WRITE_TOOLS);
  const writeAll = writeEntries.includes("*");
  if (writeAll && writeEntries.length > 1) {
    throw new ConfigError('SNIPEIT_WRITE_TOOLS: use either "*" or a list of tool names, not both.');
  }
  for (const name of writeEntries) {
    if (name !== "*" && !/^snipeit_[a-z_]+$/.test(name)) {
      throw new ConfigError(`SNIPEIT_WRITE_TOOLS: "${name.slice(0, 60)}" is not a valid tool name.`);
    }
  }

  // Company scope
  let allowedCompanyIds: Set<number> | null = null;
  const companyEntries = csv(env.SNIPEIT_ALLOWED_COMPANY_IDS);
  if ((env.SNIPEIT_ALLOWED_COMPANY_IDS ?? "").trim() !== "") {
    allowedCompanyIds = new Set();
    for (const entry of companyEntries) {
      if (!/^[1-9]\d{0,9}$/.test(entry)) {
        throw new ConfigError(
          `SNIPEIT_ALLOWED_COMPANY_IDS: "${entry.slice(0, 20)}" is not a positive integer company ID.`
        );
      }
      allowedCompanyIds.add(Number(entry));
    }
    if (allowedCompanyIds.size === 0) {
      throw new ConfigError("SNIPEIT_ALLOWED_COMPANY_IDS is set but contains no company IDs.");
    }
  }

  // Extra fields
  const extraFields: Partial<Record<Resource, Record<string, FieldSpec>>> = {};
  for (const entry of csv(env.SNIPEIT_EXTRA_FIELDS)) {
    const [resource, field, ...rest] = entry.split(".");
    const unlockable = UNLOCKABLE_FIELDS[resource as Resource];
    const spec = rest.length === 0 && field && unlockable && Object.hasOwn(unlockable, field)
      ? unlockable[field]
      : undefined;
    if (!spec) {
      throw new ConfigError(
        `SNIPEIT_EXTRA_FIELDS: "${entry.slice(0, 60)}" cannot be unlocked. ` +
          'Use "resource.field" with a field from the documented unlockable list ' +
          "(licenses.product_key can never be unlocked)."
      );
    }
    (extraFields[resource as Resource] ??= {})[field] = spec;
  }

  return { writeAll, writeTools: new Set(writeEntries.filter((n) => n !== "*")), allowedCompanyIds, extraFields };
}

let _policy: Policy | null = null;

export function getPolicy(): Policy {
  return (_policy ??= loadPolicy());
}

export function scopeActive(): boolean {
  return getPolicy().allowedCompanyIds !== null;
}

// ─────────────────────────────── tool gating ──────────────────────────────────

export interface ToolLike {
  name: string;
  annotations?: { readOnlyHint?: boolean };
}

/** Tools that cannot be company-scoped soundly; hidden and refused while scope is active. */
const UNSCOPABLE_TOOLS: ReadonlySet<string> = new Set(["snipeit_reports_activity"]);

/** A tool is a write tool unless it is explicitly annotated read-only. */
export function isWriteTool(tool: ToolLike): boolean {
  return tool.annotations?.readOnlyHint !== true;
}

export function isWriteEnabled(name: string): boolean {
  const p = getPolicy();
  return p.writeAll || p.writeTools.has(name);
}

/** Why a tool is unavailable under the current policy, or null if it may be listed and called. */
export function toolDenial(tool: ToolLike): string | null {
  if (isWriteTool(tool) && !isWriteEnabled(tool.name)) {
    return `Tool ${tool.name} is disabled by server policy: this write tool is not enabled on this server.`;
  }
  if (scopeActive() && UNSCOPABLE_TOOLS.has(tool.name)) {
    return `Tool ${tool.name} is disabled by server policy: it cannot be restricted to the permitted companies.`;
  }
  return null;
}

/** Fail startup on a SNIPEIT_WRITE_TOOLS entry that names no existing tool (typo protection). */
export function assertKnownWriteTools(tools: readonly ToolLike[]): void {
  const known = new Set(tools.map((t) => t.name));
  for (const name of getPolicy().writeTools) {
    if (!known.has(name)) {
      throw new ConfigError(`SNIPEIT_WRITE_TOOLS: unknown tool "${name}".`);
    }
  }
}

interface ToolContext {
  readonly tool: string;
  readonly allowWrite: boolean;
}

const toolContext = new AsyncLocalStorage<ToolContext>();

/**
 * Run a tool handler inside its policy context. Write permission is derived
 * here from the tool's own annotations and the policy — callers cannot grant it.
 */
export function runInToolContext<T>(tool: ToolLike, fn: () => Promise<T>): Promise<T> {
  const allowWrite = isWriteTool(tool) && isWriteEnabled(tool.name);
  return toolContext.run({ tool: tool.name, allowWrite }, fn);
}

/**
 * Called by the client before any POST/PATCH. Refuses unless the current async
 * context is an enabled write tool, so a tool that is mis-annotated as
 * read-only (or code running outside any tool) can never write.
 */
export function assertWriteContext(): void {
  const ctx = toolContext.getStore();
  if (!ctx?.allowWrite) {
    throw new PolicyError(
      "Write refused by server policy: this request is not running inside an enabled write tool."
    );
  }
}

// ───────────────────────────── company scope ──────────────────────────────────

type Row = Record<string, unknown>;

function isPlainObject(v: unknown): v is Row {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** The company ID a transformed Snipe-IT record belongs to, or null if it has none. */
export function companyIdOf(record: unknown): number | null {
  if (!isPlainObject(record) || !isPlainObject(record.company)) return null;
  const id = Number(record.company.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** True when no restriction is active, or the record belongs to a permitted company. */
export function inScope(record: unknown): boolean {
  const allowed = getPolicy().allowedCompanyIds;
  if (allowed === null) return true;
  const id = companyIdOf(record);
  return id !== null && allowed.has(id);
}

// ───────────────────────────── field projection ───────────────────────────────

function fieldMapFor(resource: Resource, payload: boolean): FieldMap {
  const extra = getPolicy().extraFields[resource];
  return {
    ...(payload ? WRITE_PAYLOAD_FIELDS : {}),
    ...FIELD_ALLOWLIST[resource],
    ...(extra ?? {}),
  };
}

/** Field names a caller may see (and therefore sort by) for a resource. */
export function visibleFields(resource: Resource): ReadonlySet<string> {
  return new Set(Object.keys(fieldMapFor(resource, false)));
}

function isScalar(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

const DATE_KEYS = new Set(["datetime", "date", "formatted"]);

function scalarOrDate(v: unknown): unknown {
  if (isScalar(v)) return v;
  if (isPlainObject(v)) {
    const keys = Object.keys(v);
    if (
      keys.length > 0 &&
      keys.every((k) => DATE_KEYS.has(k) && (v[k] === null || isScalar(v[k]))) &&
      ("datetime" in v || "date" in v)
    ) {
      return v;
    }
  }
  return undefined;
}

function reduceRef(v: unknown, keys: readonly string[]): unknown {
  if (isScalar(v)) return v;
  if (!isPlainObject(v)) return undefined;
  const out: Row = {};
  for (const k of keys) {
    if (isScalar(v[k])) out[k] = v[k];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function reduceCustomFields(v: unknown): unknown {
  if (!isPlainObject(v)) return undefined;
  const out: Row = {};
  for (const [name, field] of Object.entries(v)) {
    const value = isPlainObject(field) ? field.value : undefined;
    if (isScalar(value)) out[name] = { value };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * THE central output filter: reduce one Snipe-IT record to the fields allowed
 * for its resource type. Applied by the client to every list row, single
 * record, sub-resource row, report row and write-response payload.
 */
export function projectRecord(
  resource: Resource,
  record: unknown,
  opts: { payload?: boolean } = {}
): Row {
  const out: Row = {};
  if (!isPlainObject(record)) return out;
  const fields = fieldMapFor(resource, opts.payload === true);
  const dropCounts = scopeActive() && !COMPANY_SCOPED.has(resource);

  for (const [key, spec] of Object.entries(fields)) {
    if (!Object.hasOwn(record, key)) continue;
    const raw = record[key];
    let value: unknown;
    if (spec === "v") value = scalarOrDate(raw);
    else if (spec === "count") value = dropCounts ? undefined : scalarOrDate(raw);
    else if (spec === "ref") value = reduceRef(raw, REF_KEYS);
    else if (spec === "custom_fields") value = reduceCustomFields(raw);
    else value = reduceRef(raw, spec);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

// ───────────────────────────── query parameters ───────────────────────────────

export type QueryParams = Record<string, string | number | boolean>;

/**
 * The only query parameters forwarded upstream. Free-form parameters such as
 * Snipe-IT's `filter` would let a caller probe hidden columns.
 */
const QUERY_ALLOWLIST: ReadonlySet<string> = new Set([
  "limit", "offset", "search", "sort", "order",
  "status", "status_id", "category_id", "location_id", "assigned_to",
  "company_id", "manufacturer_id", "model_id",
  "item_type", "item_id", "target_type", "target_id", "action_type",
]);

export const MAX_LIMIT = 500;

/** Drop unknown parameters, non-scalar values, and sorting by a field the caller cannot see. */
export function cleanQuery(resource: Resource, params: Record<string, unknown> | undefined): QueryParams {
  const out: QueryParams = {};
  if (!params) return out;
  const sortable = visibleFields(resource);
  for (const [k, v] of Object.entries(params)) {
    if (!QUERY_ALLOWLIST.has(k) || !isScalar(v) || v === "") continue;
    if (k === "limit" || k === "offset") {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) continue;
      out[k] = k === "limit" ? Math.min(n, MAX_LIMIT) : n;
      continue;
    }
    if (k === "sort" && !sortable.has(String(v))) continue;
    if (k === "order" && v !== "asc" && v !== "desc") continue;
    out[k] = v;
  }
  return out;
}

function foldText(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function collectText(value: unknown, into: string[]): void {
  if (isScalar(value)) into.push(foldText(String(value)));
  else if (Array.isArray(value)) value.forEach((v) => collectText(v, into));
  else if (isPlainObject(value)) Object.values(value).forEach((v) => collectText(v, into));
}

/**
 * Snipe-IT's `search` also matches columns this server hides (notes, product
 * keys, order numbers, custom fields). To stop `search` being used as an oracle
 * on hidden data, a row is only kept when the term is found in a field the
 * caller can actually see. Terms may be combined with " OR ", as upstream.
 */
export function matchesVisibleSearch(projected: Row, search: string): boolean {
  const terms = search
    .split(/\s+OR\s+/)
    .map((t) => foldText(t.trim()))
    .filter(Boolean);
  if (terms.length === 0) return true;
  const haystack: string[] = [];
  collectText(projected, haystack);
  return terms.some((term) => haystack.some((text) => text.includes(term)));
}

// ─────────────────────────────── route table ──────────────────────────────────

export interface GetRoute {
  readonly pattern: RegExp;
  readonly kind: "list" | "record";
  /** Resource type of the record / of each row (selects the field allowlist). */
  readonly resource: Resource;
  /** Sub-resource: the parent record (ID = first capture group) whose company is checked first. */
  readonly parent?: Resource;
  /**
   * How rows are scoped while a company restriction is active:
   *  - "company": each row is checked on its own company.id
   *  - "parent":  rows carry no company; the parent check is the authority
   *  - "none":    reference data, not company-specific
   */
  readonly rows: "company" | "parent" | "none";
  /** The upstream list endpoint honours ?company_id= (allows exact totals and paging). */
  readonly companyFilter?: boolean;
  /** Top-level list with a default page size (sub-resource lists return everything). */
  readonly paged?: boolean;
  /** Cannot be scoped soundly: refused outright while a company restriction is active. */
  readonly denyWhenScoped?: boolean;
}

const ID = "(\\d+)";
const SEG = "([^/?#]+)";
const re = (p: string) => new RegExp(`^${p}$`);

function crud(resource: Resource, companyFilter: boolean): GetRoute[] {
  const scoped = COMPANY_SCOPED.has(resource);
  return [
    {
      pattern: re(`/${resource}`), kind: "list", resource, paged: true,
      rows: scoped ? "company" : "none", companyFilter: scoped && companyFilter,
    },
    { pattern: re(`/${resource}/${ID}`), kind: "record", resource, rows: scoped ? "company" : "none" },
  ];
}

/** Every GET path the server may call. A path that matches nothing here is denied. */
export const GET_ROUTES: readonly GetRoute[] = [
  ...crud("hardware", true),
  { pattern: re(`/hardware/bytag/${SEG}`), kind: "record", resource: "hardware", rows: "company" },
  { pattern: re(`/hardware/byserial/${SEG}`), kind: "list", resource: "hardware", rows: "company" },
  { pattern: re("/hardware/audit/(?:due|overdue)"), kind: "list", resource: "hardware", rows: "company", paged: true },

  ...crud("users", true),
  { pattern: re(`/users/${ID}/assets`), kind: "list", resource: "hardware", parent: "users", rows: "company" },
  { pattern: re(`/users/${ID}/accessories`), kind: "list", resource: "accessories", parent: "users", rows: "company" },
  { pattern: re(`/users/${ID}/licenses`), kind: "list", resource: "licenses", parent: "users", rows: "company" },

  ...crud("locations", false),
  { pattern: re(`/locations/${ID}/assets`), kind: "list", resource: "hardware", parent: "locations", rows: "company" },

  ...crud("licenses", true),
  { pattern: re(`/licenses/${ID}/seats`), kind: "list", resource: "license_seats", parent: "licenses", rows: "parent" },

  ...crud("accessories", true),
  { pattern: re(`/accessories/${ID}/checkedout`), kind: "list", resource: "accessory_checkouts", parent: "accessories", rows: "parent" },

  ...crud("consumables", true),
  { pattern: re(`/consumables/view/${ID}/users`), kind: "list", resource: "consumable_users", parent: "consumables", rows: "parent" },

  ...crud("components", true),
  { pattern: re(`/components/${ID}/assets`), kind: "list", resource: "component_assets", parent: "components", rows: "parent" },

  ...crud("statuslabels", false),
  { pattern: re(`/statuslabels/${ID}/assetlist`), kind: "list", resource: "hardware", rows: "company", paged: true },
  ...crud("models", false),
  ...crud("categories", false),
  ...crud("manufacturers", false),

  // The activity log has no company on its rows and embeds changed values of
  // arbitrary fields, so it cannot be scoped: refused while scope is active.
  { pattern: re("/reports/activity"), kind: "list", resource: "activity", rows: "none", paged: true, denyWhenScoped: true },
];

export interface WriteRoute {
  readonly method: "POST" | "PATCH";
  readonly pattern: RegExp;
  /** Resource being written (selects the scope check and the payload allowlist). */
  readonly resource: Resource;
  /**
   * How the record being written is identified for the company check:
   *  - "create":    no existing record; body.company_id must be a permitted company
   *  - "id":        first capture group is the record ID
   *  - "asset_tag": body.asset_tag names the asset
   *  - "pivot":     first capture group is an assignment-row ID; the caller must also
   *                 supply the parent record ID, and the row must belong to it
   */
  readonly target: "create" | "id" | "asset_tag" | "pivot";
  /** Body fields that reference another record which must also be in scope. */
  readonly refs?: Readonly<Record<string, Resource>>;
  /** For "pivot" targets: the parent's sub-resource list that contains the assignment rows. */
  readonly pivotList?: string;
}

/** Every POST/PATCH path the server may call. A path that matches nothing here is denied. */
export const WRITE_ROUTES: readonly WriteRoute[] = [
  { method: "POST", pattern: re("/hardware"), resource: "hardware", target: "create" },
  { method: "PATCH", pattern: re(`/hardware/${ID}`), resource: "hardware", target: "id" },
  { method: "POST", pattern: re(`/hardware/${ID}/checkin`), resource: "hardware", target: "id" },
  {
    method: "POST", pattern: re(`/hardware/${ID}/checkout`), resource: "hardware", target: "id",
    refs: { assigned_user: "users", assigned_asset: "hardware", assigned_location: "locations" },
  },
  { method: "POST", pattern: re("/hardware/audit"), resource: "hardware", target: "asset_tag" },

  { method: "POST", pattern: re("/accessories"), resource: "accessories", target: "create" },
  { method: "PATCH", pattern: re(`/accessories/${ID}`), resource: "accessories", target: "id" },
  { method: "POST", pattern: re(`/accessories/${ID}/checkout`), resource: "accessories", target: "id", refs: { assigned_to: "users" } },
  { method: "POST", pattern: re(`/accessories/${ID}/checkin`), resource: "accessories", target: "pivot", pivotList: "checkedout" },

  { method: "POST", pattern: re("/consumables"), resource: "consumables", target: "create" },
  { method: "PATCH", pattern: re(`/consumables/${ID}`), resource: "consumables", target: "id" },
  { method: "POST", pattern: re(`/consumables/${ID}/checkout`), resource: "consumables", target: "id", refs: { assigned_to: "users" } },

  { method: "POST", pattern: re("/components"), resource: "components", target: "create" },
  { method: "PATCH", pattern: re(`/components/${ID}`), resource: "components", target: "id" },
  { method: "POST", pattern: re(`/components/${ID}/checkout`), resource: "components", target: "id", refs: { assigned_to: "hardware" } },
  { method: "POST", pattern: re(`/components/${ID}/checkin`), resource: "components", target: "pivot", pivotList: "assets" },
];

/** Body fields checked on every write, whatever the route. */
export const COMMON_WRITE_REFS: Readonly<Record<string, Resource>> = { location_id: "locations" };

const NOT_ALLOWLISTED = "Request refused by server policy: API path is not on the allowlist.";

/**
 * Dot segments ("..", ".", and their percent-encoded forms) are collapsed by
 * URL parsing, which would turn an allowlisted-looking path into a different
 * endpoint. Refuse them outright.
 */
function assertNoDotSegments(path: string): void {
  if (/(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i.test(path) || path.includes("\\")) {
    throw new PolicyError(NOT_ALLOWLISTED);
  }
}

export function matchGetRoute(path: string): { route: GetRoute; id?: string } {
  assertNoDotSegments(path);
  for (const route of GET_ROUTES) {
    const m = route.pattern.exec(path);
    if (m) return { route, id: m[1] };
  }
  throw new PolicyError(NOT_ALLOWLISTED);
}

export function matchWriteRoute(method: "POST" | "PATCH", path: string): { route: WriteRoute; id?: string } {
  assertNoDotSegments(path);
  for (const route of WRITE_ROUTES) {
    if (route.method !== method) continue;
    const m = route.pattern.exec(path);
    if (m) return { route, id: m[1] };
  }
  throw new PolicyError(NOT_ALLOWLISTED);
}

/** One-paragraph description of the active policy for the startup log (no secrets, no IDs). */
export function describePolicy(): { writes: string; companyScope: string; extraFields: string[] } {
  const p = getPolicy();
  return {
    writes: p.writeAll
      ? "all write tools enabled"
      : p.writeTools.size > 0
        ? `enabled: ${[...p.writeTools].sort().join(", ")}`
        : "disabled (read-only server)",
    companyScope: p.allowedCompanyIds ? "restricted" : "unrestricted",
    extraFields: Object.entries(p.extraFields).flatMap(([r, fields]) =>
      Object.keys(fields ?? {}).map((f) => `${r}.${f}`)
    ),
  };
}
