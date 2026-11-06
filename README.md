# Snipe-IT MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server for [Snipe-IT](https://snipeitapp.com) — lets Claude query and manage your IT assets, users, locations, licenses, and more via natural language.

Built and maintained by [TEC Building Systems LLC](https://github.com/TECPabs). Community contributions welcome!

---

## Quick Start

```jsonc
// claude_desktop_config.json  (or ~/.claude/settings.json for Claude Code)
{
  "mcpServers": {
    "snipeit": {
      "command": "npx",
      "args": ["-y", "@tecpabs/snipe-it-mcp"],
      "env": {
        "SNIPEIT_URL": "https://your-snipeit-instance.com",
        "SNIPEIT_API_TOKEN": "your-api-token-here"
      }
    }
  }
}
```

Get your API token from **Snipe-IT → Profile → API**.

> **Secure by default:** the server starts **read-only** and returns only an
> allowlisted set of fields. Enabling write tools, restricting the server to
> specific companies, and unlocking extra fields are all explicit operator
> settings — see [Security configuration](#security-configuration).

---

## Configuration

| Variable | Required | Description |
|---|---|---|
| `SNIPEIT_URL` | Yes | Base URL of your Snipe-IT instance. Must be `https://` (see [Security configuration](#security-configuration)) |
| `SNIPEIT_API_TOKEN` | Yes | Bearer token from your Snipe-IT profile |
| `SNIPEIT_WRITE_TOOLS` | No | Write tools to enable: comma-separated names or `*`. **Default: none (read-only)** |
| `SNIPEIT_ALLOWED_COMPANY_IDS` | No | Restrict the server to these Snipe-IT company IDs. Default: unrestricted |
| `SNIPEIT_EXTRA_FIELDS` | No | Extra response fields to unlock, as `resource.field`. Default: none |
| `SNIPEIT_ALLOW_INSECURE_HTTP` | No | `true` to allow plain `http://` to a non-loopback host. Default: off |
| `LOG_LEVEL` | No | `debug`, `info` (default), `warn`, `error` |
| `SNIPEIT_TIMEOUT_MS` | No | Request timeout in milliseconds (default `30000`) |

---

## Available Tools

> Tools that create, update, check out, check in or audit are **write tools**: they
> are hidden and refused unless enabled with `SNIPEIT_WRITE_TOOLS`.
> `snipeit_reports_activity` is unavailable while `SNIPEIT_ALLOWED_COMPANY_IDS` is set.

### Meta
| Tool | Description |
|---|---|
| `snipeit_status` | Check connection and credentials |
| `snipeit_navigate` | Discover available domains |

### Hardware (Assets)
| Tool | Description |
|---|---|
| `snipeit_hardware_list` | List assets with filters (status, category, location, search) |
| `snipeit_hardware_get` | Get asset by ID |
| `snipeit_hardware_by_tag` | Get asset by asset tag |
| `snipeit_hardware_by_serial` | Get asset(s) by serial number |
| `snipeit_hardware_checkin` | Check in an asset |
| `snipeit_hardware_checkout` | Check out to user, location, or asset |
| `snipeit_hardware_audit` | Record an asset audit |
| `snipeit_hardware_create` | Create a new asset |
| `snipeit_hardware_update` | Update asset fields |

### Users
| Tool | Description |
|---|---|
| `snipeit_users_list` | List users |
| `snipeit_users_get` | Get user by ID |
| `snipeit_users_assets` | List assets assigned to a user |
| `snipeit_users_accessories` | List accessories checked out to a user |
| `snipeit_users_licenses` | List licenses assigned to a user |

### Locations
| Tool | Description |
|---|---|
| `snipeit_locations_list` | List locations |
| `snipeit_locations_get` | Get location by ID |
| `snipeit_locations_assets` | List assets at a location |

### Licenses
| Tool | Description |
|---|---|
| `snipeit_licenses_list` | List licenses |
| `snipeit_licenses_get` | Get license by ID |
| `snipeit_licenses_seats` | List seat assignments |

### Accessories
| Tool | Description |
|---|---|
| `snipeit_accessories_list` | List accessories with filters |
| `snipeit_accessories_get` | Get accessory by ID |
| `snipeit_accessories_checkedout` | Who has an accessory (rows include the `assigned_pivot_id` used for check-in) |
| `snipeit_accessories_checkout` | Check out a unit to a user |
| `snipeit_accessories_checkin` | Check in a unit (takes the assignment row ID, not the accessory ID) |
| `snipeit_accessories_create` / `snipeit_accessories_update` | Create / update accessories |

### Consumables
| Tool | Description |
|---|---|
| `snipeit_consumables_list` | List consumables with filters |
| `snipeit_consumables_get` | Get consumable by ID |
| `snipeit_consumables_users` | Users a consumable has been issued to |
| `snipeit_consumables_checkout` | Issue a unit to a user (no check-in — consumed) |
| `snipeit_consumables_create` / `snipeit_consumables_update` | Create / update consumables |

### Components
| Tool | Description |
|---|---|
| `snipeit_components_list` | List components with filters |
| `snipeit_components_get` | Get component by ID |
| `snipeit_components_assets` | Assets a component is installed in |
| `snipeit_components_checkout` | Check out units to an asset |
| `snipeit_components_checkin` | Check in units (takes the assignment row ID) |
| `snipeit_components_create` / `snipeit_components_update` | Create / update components |

### Reports
| Tool | Description |
|---|---|
| `snipeit_reports_activity` | Activity audit trail (checkouts, checkins, updates, audits) filterable by item or user |
| `snipeit_reports_audit_due` | Assets whose scheduled audit is due soon |
| `snipeit_reports_audit_overdue` | Assets whose audit date has passed |
| `snipeit_reports_low_stock` | Accessories/consumables/components below their minimum quantity (computed) |

> Snipe-IT's web-UI "Custom Reports" CSV builder and depreciation report have no REST
> API equivalents, so they are not exposed here.

### Models, Categories, Manufacturers, Status Labels
| Tool | Description |
|---|---|
| `snipeit_models_list` / `snipeit_models_get` | Asset models |
| `snipeit_categories_list` / `snipeit_categories_get` | Categories |
| `snipeit_manufacturers_list` / `snipeit_manufacturers_get` | Manufacturers |
| `snipeit_statuslabels_list` / `snipeit_statuslabels_get` | Status labels |
| `snipeit_statuslabels_assets` | Assets with a given status |

> **Note:** responses are filtered to a per-resource field allowlist (see
> [Security configuration](#security-configuration)) and then compacted —
> null/empty fields and redundant `formatted` date strings are stripped. If
> `hardware.custom_fields` is unlocked, it is flattened to a `{name: value}` map.

---

## Built-in Prompts

Use these with Claude's prompt selector:

- **`asset-audit-report`** — Summarize all assets by location and status
- **`expiring-licenses`** — Find licenses expiring soon
- **`unassigned-assets`** — List deployable assets with no assignee

---

## Local Development

```bash
git clone https://github.com/TECPabs/snipe-it-mcp.git
cd snipe-it-mcp
npm install
npm run build

# Point Claude Code at your local build:
# command: node, args: ["D:/Claude/snipe-it-mcp/dist/index.js"]
```

---

## Releasing

Releases are published to npm automatically by GitHub Actions when a version tag
is pushed (via [npm trusted publishing](https://docs.npmjs.com/trusted-publishers),
so no npm tokens are stored in CI):

```bash
npm version minor        # or patch / major — bumps package.json and creates the vX.Y.Z tag
git push --follow-tags
```

The workflow refuses to publish if the tag doesn't match `package.json`, and the
`prepublishOnly` script runs build + tests + lint before any upload.

---

## Security configuration

Every restriction in this section is enforced by the server's own code on every
request — not by tool descriptions and not by instructions to the model. All
defaults fail closed, and an invalid setting stops the server at startup with a
non-zero exit code and a clear message on stderr.

| Variable | Default | Effect |
|---|---|---|
| `SNIPEIT_URL` | required | Must be `https://`. See [Transport](#transport). |
| `SNIPEIT_ALLOW_INSECURE_HTTP` | unset | `true` accepts plain `http://` for a non-loopback host and logs a loud warning. Isolated labs only. |
| `SNIPEIT_WRITE_TOOLS` | empty = **read-only server** | Comma-separated write-tool names to enable, or `*` for all. |
| `SNIPEIT_ALLOWED_COMPANY_IDS` | unset = no company restriction (warning logged at startup) | Comma-separated Snipe-IT company IDs the server may read and change. |
| `SNIPEIT_EXTRA_FIELDS` | empty = built-in field allowlist only | Comma-separated `resource.field` entries to add back to responses. |

A placeholder-only [`.env.example`](.env.example) lists all of them.

### Transport

- `SNIPEIT_URL` is rejected unless it is `https://`. Plain `http://` is accepted
  only for `localhost`, `127.0.0.1` or `[::1]`, or with
  `SNIPEIT_ALLOW_INSECURE_HTTP=true`.
- URLs that do not parse, contain embedded credentials (`user:pass@host`), or
  carry a query string or fragment are rejected.
- HTTP redirects are never followed (a redirect could downgrade to `http://` or
  leave the configured host). Set `SNIPEIT_URL` to the final address.

### Write tools — `SNIPEIT_WRITE_TOOLS`

The server is **read-only unless you opt in**. A tool is a write tool when it is
not annotated `readOnlyHint: true`; there is no separate hand-kept list.

```jsonc
"SNIPEIT_WRITE_TOOLS": "snipeit_hardware_checkout,snipeit_hardware_checkin"   // or "*"
```

- Write tools that are not enabled are absent from `tools/list` **and** rejected
  by the call handler (`... is disabled by server policy`).
- Defence in depth: the HTTP client itself refuses every `POST`/`PATCH` unless the
  call is running inside an enabled write tool, so a mis-annotated tool cannot write.
- A name that is not a real tool stops the server at startup (typo protection).
- Only API paths on a built-in route allowlist can be called at all.

### Company scope — `SNIPEIT_ALLOWED_COMPANY_IDS`

When set, the server only shows and changes records whose `company.id` is in the
list. **A record with no company is out of scope.**

| Path | Enforcement |
|---|---|
| Lists and searches | Every row is checked on its own `company.id`. `company_id` is also sent upstream as an optimisation, but the row check is the authority. `total` only ever counts rows you are permitted to see. |
| Get by ID / tag / serial | Fetched, then checked. An out-of-scope record returns `Record not found or not permitted.` — identical to a record that does not exist. |
| Sub-resources (license seats, accessory check-outs, consumable users, component assets, a user's assets / accessories / licenses, a location's assets) | The parent record's company is checked first; nothing is fetched for an out-of-scope parent. Rows that carry their own company are filtered again. |
| Writes | The target record, any check-out target (user / asset / location), any `location_id`, and any `company_id` in the body are all verified **before** the request is sent. New records are created in the permitted company (required explicitly when several are permitted). |
| Reference data (categories, manufacturers, models, status labels) | Not company-specific, so still available — but instance-wide `*_count` fields are removed. |
| `snipeit_reports_activity` | **Disabled** while scope is active: activity rows carry no company and embed changed values of arbitrary fields, so they cannot be scoped soundly. |

Things to know before turning it on:

- **Locations are treated as company-owned.** Snipe-IT releases whose locations
  have no `company` (v6.x) therefore expose no locations while scope is active:
  the location tools return nothing, and check-outs to a location or writes that
  set `location_id` are refused. Assets still show their location as `{id, name}`.
- **Check-ins by assignment row** (`snipeit_accessories_checkin`,
  `snipeit_components_checkin`) additionally require `id` — the accessory /
  component the row belongs to — so the server can verify the row's owner.
- Nested references on an in-scope record (for example `assigned_to`) are shown
  as `{id, name, …}` without a scope check of their own.
- This complements, and does not replace, a least-privilege API token and the
  *Full Multiple Companies Support* setting in Snipe-IT.

### Field allowlist — what responses contain

Every response — lists, single records, sub-resources, reports and the `payload`
of write responses — passes through one central per-resource allowlist. Anything
not listed is dropped, including fields added by future Snipe-IT versions. Nested
references are reduced to `{id, name}` plus `type` / `asset_tag` / `serial` /
`username` where present.

| Resource | Fields returned by default |
|---|---|
| `hardware` | id, name, asset_tag, serial, model, model_number, category, manufacturer, status_label, company, location, rtd_location, assigned_to, purchase_date, warranty_months, warranty_expires, asset_eol_date, eol, last_audit_date, next_audit_date, last_checkout, last_checkin, expected_checkin, user_can_checkout, created_at, updated_at, deleted_at |
| `users` | id, name, first_name, last_name, username, email, jobtitle, department, location, company, assets_count, licenses_count, accessories_count, consumables_count, created_at, updated_at, deleted_at |
| `licenses` | id, name, company, manufacturer, category, seats, free_seats_count, min_amt, reassignable, maintained, purchase_date, expiration_date, termination_date, user_can_checkout, created_at, updated_at, deleted_at |
| license seats | id, license_id, name, assigned_user, assigned_asset, location, reassignable, user_can_checkout |
| `accessories` | id, name, model_number, company, manufacturer, category, location, qty, min_qty, min_amt, remaining_qty, remaining, users_count, checkouts_count, purchase_date, user_can_checkout, created_at, updated_at |
| accessory check-outs | assigned_pivot_id, id, name, username, first_name, last_name, type, assigned_to, last_checkout, created_at |
| `consumables` | id, name, item_no, model_number, company, manufacturer, category, location, qty, min_qty, min_amt, remaining_qty, remaining, purchase_date, user_can_checkout, created_at, updated_at |
| consumable users | id, name, user, admin, created_at |
| `components` | id, name, serial, company, category, location, qty, min_qty, min_amt, remaining_qty, remaining, purchase_date, user_can_checkout, created_at, updated_at |
| component assets | assigned_pivot_id, id, name, asset_tag, qty, type, created_at |
| `locations` | id, name, parent, company, assets_count, assigned_assets_count, rtd_assets_count, users_count, created_at, updated_at |
| `models` | id, name, model_number, manufacturer, category, eol, min_amt, requestable, assets_count, created_at, updated_at, deleted_at |
| `categories` | id, name, category_type, item_count, assets_count, accessories_count, consumables_count, components_count, licenses_count, created_at, updated_at |
| `manufacturers` | id, name, url, support_url, support_phone, support_email, warranty_lookup_url, assets_count, licenses_count, consumables_count, accessories_count, created_at, updated_at, deleted_at |
| `statuslabels` | id, name, type, default_label, assets_count, created_at, updated_at |
| `activity` | id, action_type, action_date, next_audit_date, item, target, admin, location, created_at, updated_at |

**Never returned by default:** license `product_key`, `license_name`,
`license_email`; `notes` on every resource; `custom_fields`; purchase cost, order
numbers and supplier data; user phone, address, city, state, zip, country,
employee number, manager, permissions, two-factor fields, avatar, last login,
notes, activation and LDAP flags; activity `note`, `log_meta`, IP and user agent.

Because the `search`, `sort` and `filter` parameters of the Snipe-IT API also
reach hidden columns, the server closes those side channels too: only a fixed set
of query parameters is forwarded, `sort` is limited to visible fields, and a
`search` result row is returned only if the term matches a field you can
actually see.

#### `SNIPEIT_EXTRA_FIELDS`

The one operator-controlled extension. Each entry is `resource.field` and must
come from this list — anything else stops the server at startup:

| Resource | Unlockable fields |
|---|---|
| `hardware` | custom_fields, notes, order_number, purchase_cost, book_value, supplier, requestable, byod, age, checkin_counter, checkout_counter, requests_counter |
| `users` | phone, employee_num, manager, address, city, state, zip, country, notes, last_login, activated, ldap_import, vip, start_date, end_date |
| `licenses` | notes, order_number, purchase_order, purchase_cost, supplier, license_name, license_email, depreciation |
| `accessories`, `consumables`, `components` | notes, order_number, purchase_cost, supplier |
| `locations` | address, address2, city, state, zip, country, phone, fax, manager, currency |
| `models` | notes, depreciation, fieldset |
| `statuslabels` | notes, color |
| `activity` | note |

`licenses.product_key` can **never** be unlocked, nor can user permissions,
two-factor fields, avatars, or the `log_meta` of the activity report.

```jsonc
"SNIPEIT_EXTRA_FIELDS": "hardware.custom_fields,hardware.notes"
```

### Errors and logging

- Upstream response bodies (HTML, stack traces, JSON) are never placed in an
  error. A failed request becomes `Snipe-IT request failed (HTTP 404) [ref: a1b2c3d4]`;
  the same correlation ID is written to stderr with the method, path and status
  only.
- Snipe-IT `{"status":"error","messages":…}` text is passed on only after
  sanitizing: one line, `field: message` pairs, bounded length and count, with
  URLs, SQL, file paths and anything token-like removed.
- `snipeit_status` returns only connected / not connected and the instance host.
- Logs go to stderr and pass through central redaction: values of keys matching
  `token|authorization|password|secret|api_key|cookie`, `Bearer …` strings and the
  live API token are replaced, and string length and nesting depth are capped.
  `LOG_LEVEL=debug` logs the method, the path and query parameter **names** —
  never values, headers or bodies.

### Still your responsibility

- **Use a least-privilege API token.** Snipe-IT tokens inherit every permission of
  the user who created them. Create a dedicated user (e.g. `claude-mcp`) with only
  the permissions you want Claude to have and generate the token from that
  account, not from a superadmin. The settings above limit what this server will
  do with the token; they do not limit the token itself.
- **Write tools send only their documented fields.** Bodies for create, update,
  checkout, checkin, and audit are filtered against an allowlist, so unexpected
  extra arguments are never forwarded to the API.
- **Treat asset data as untrusted.** Names stored in Snipe-IT are shown to the
  model; anyone who can edit them can attempt prompt injection. Keep write
  confirmation enabled in your MCP client.

### Upgrading from 1.4.x

These defaults are intentionally stricter than earlier releases:

- All write tools are disabled until listed in `SNIPEIT_WRITE_TOOLS`.
- Responses no longer include `notes`, `custom_fields`, cost / order / supplier
  data, license keys or user contact and HR fields (see `SNIPEIT_EXTRA_FIELDS`).
- An `http://` `SNIPEIT_URL` for a non-loopback host stops the server at startup,
  and redirects are no longer followed.
- `snipeit_status` no longer reports `total_assets`, and error messages no longer
  contain upstream response text.
- Query parameters that are not part of a tool's documented inputs are dropped,
  and `search` only returns rows that match on a visible field.

---

## Contributing

Pull requests welcome! Areas that would benefit from community help:

- Companies and departments lookups
- License seat checkout/checkin
- Asset maintenance records
- Custom fields support (writing; reading is available via `SNIPEIT_EXTRA_FIELDS=hardware.custom_fields`)
- Bulk operations

Please open an issue first for major changes.

---

## License

MIT — see [LICENSE](LICENSE)
