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

---

## Configuration

| Variable | Required | Description |
|---|---|---|
| `SNIPEIT_URL` | Yes | Base URL of your Snipe-IT instance |
| `SNIPEIT_API_TOKEN` | Yes | Bearer token from your Snipe-IT profile |
| `LOG_LEVEL` | No | `debug`, `info` (default), `warn`, `error` |
| `SNIPEIT_TIMEOUT_MS` | No | Request timeout in milliseconds (default `30000`) |

---

## Available Tools

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

### Models, Categories, Manufacturers, Status Labels
| Tool | Description |
|---|---|
| `snipeit_models_list` / `snipeit_models_get` | Asset models |
| `snipeit_categories_list` / `snipeit_categories_get` | Categories |
| `snipeit_manufacturers_list` / `snipeit_manufacturers_get` | Manufacturers |
| `snipeit_statuslabels_list` / `snipeit_statuslabels_get` | Status labels |
| `snipeit_statuslabels_assets` | Assets with a given status |

> **Note:** responses are compacted before being returned to the model — null/empty
> fields, `available_actions`, and redundant `formatted` date strings are stripped,
> and `custom_fields` is flattened to a simple `{name: value}` map. This keeps
> large asset lists cheap without losing information.

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

## Security Notes

- **Use a least-privilege API token.** Snipe-IT tokens inherit every permission of the
  user who created them. Create a dedicated user (e.g. `claude-mcp`) with only the
  permissions you want Claude to have — view, checkout/checkin, create/edit assets —
  and generate the token from that account, not from a superadmin.
- **Use HTTPS.** The server logs a warning at startup if `SNIPEIT_URL` is plain
  `http://`, since the bearer token would be sent unencrypted.
- **Write tools send only their documented fields.** Bodies for create, update,
  checkout, checkin, and audit are filtered against an allowlist, so unexpected
  extra arguments are never forwarded to the API.
- **Tools carry MCP annotations** (`readOnlyHint`/`destructiveHint`) so clients can
  auto-approve reads while still confirming writes.
- **Treat asset data as untrusted.** Notes and names stored in Snipe-IT are shown to
  the model; anyone who can edit them can attempt prompt injection. Keep write
  confirmation enabled in your MCP client.

---

## Contributing

Pull requests welcome! Areas that would benefit from community help:

- Accessories, consumables, and components domains
- Asset maintenance records
- Custom fields support (writing; reading is already flattened into responses)
- Bulk operations
- License seat checkout/checkin

Please open an issue first for major changes.

---

## License

MIT — see [LICENSE](LICENSE)
