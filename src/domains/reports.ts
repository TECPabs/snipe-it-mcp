import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { snipeGet } from "../utils/client.js";
import { ok, err, READ_ONLY, type DomainHandler } from "../utils/types.js";

const tools: Tool[] = [
  {
    name: "snipeit_reports_activity",
    description:
      "Activity report — the audit trail of checkouts, checkins, creates, updates, and audits. Filter by item or user to answer 'what happened to X' or 'what did Y do'.",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object" as const,
      properties: {
        limit:       { type: "number", description: "Max results (default 50)" },
        offset:      { type: "number", description: "Pagination offset" },
        search:      { type: "string", description: "Search term" },
        item_type:   { type: "string", description: "Item type, e.g. asset, accessory, consumable, component, license, user" },
        item_id:     { type: "number", description: "Item ID (requires item_type)" },
        target_type: { type: "string", description: "Target type the action was performed on, e.g. user, asset, location" },
        target_id:   { type: "number", description: "Target ID (requires target_type)" },
        action_type: { type: "string", description: "Action, e.g. checkout, 'checkin from', update, add, delete, audit" },
        sort:        { type: "string" },
        order:       { type: "string", enum: ["asc", "desc"] },
      },
    },
  },
  {
    name: "snipeit_reports_audit_due",
    description: "List assets whose scheduled audit is due soon (per the instance's audit warning threshold)",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object" as const,
      properties: {
        limit:  { type: "number", description: "Max results (default 50)" },
        offset: { type: "number", description: "Pagination offset" },
      },
    },
  },
  {
    name: "snipeit_reports_audit_overdue",
    description: "List assets whose scheduled audit date has already passed",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object" as const,
      properties: {
        limit:  { type: "number", description: "Max results (default 50)" },
        offset: { type: "number", description: "Pagination offset" },
      },
    },
  },
  {
    name: "snipeit_reports_low_stock",
    description:
      "Low-stock report: accessories, consumables, and components where remaining stock is below the item's configured minimum quantity. Computed by scanning the full inventory.",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object" as const,
      properties: {
        type: {
          type: "string",
          enum: ["accessories", "consumables", "components", "all"],
          description: "Which inventory type to scan (default all)",
        },
      },
    },
  },
];

interface InventoryRow {
  id?: number;
  name?: string;
  model_number?: string;
  qty?: number;
  min_qty?: number;
  min_amt?: number;
  remaining_qty?: number;
  remaining?: number;
  location?: { id?: number; name?: string };
  category?: { id?: number; name?: string };
}

interface LowStockRow {
  id: number | undefined;
  name: string | undefined;
  model_number?: string;
  category?: string;
  location?: string;
  qty: number | undefined;
  remaining: number;
  min: number;
}

const PAGE_SIZE = 500;
const MAX_PAGES = 10;

async function scanLowStock(path: string): Promise<LowStockRow[]> {
  const low: LowStockRow[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = (await snipeGet(path, { limit: PAGE_SIZE, offset })) as {
      total?: number;
      rows?: InventoryRow[];
    };
    const rows = data.rows ?? [];
    for (const row of rows) {
      const min = row.min_qty ?? row.min_amt;
      const remaining = row.remaining_qty ?? row.remaining;
      if (typeof min === "number" && min > 0 && typeof remaining === "number" && remaining < min) {
        low.push({
          id: row.id,
          name: row.name,
          ...(row.model_number ? { model_number: row.model_number } : {}),
          ...(row.category?.name ? { category: row.category.name } : {}),
          ...(row.location?.name ? { location: row.location.name } : {}),
          qty: row.qty,
          remaining,
          min,
        });
      }
    }
    offset += rows.length;
    if (rows.length === 0 || offset >= (data.total ?? 0)) break;
  }
  return low;
}

async function handleCall(toolName: string, args: Record<string, unknown>) {
  try {
    switch (toolName) {
      case "snipeit_reports_activity":
        return ok(await snipeGet("/reports/activity", args as Record<string, string | number>));
      case "snipeit_reports_audit_due":
        return ok(await snipeGet("/hardware/audit/due", args as Record<string, string | number>));
      case "snipeit_reports_audit_overdue":
        return ok(await snipeGet("/hardware/audit/overdue", args as Record<string, string | number>));
      case "snipeit_reports_low_stock": {
        const type = typeof args.type === "string" ? args.type : "all";
        const result: Record<string, unknown> = {};
        let total = 0;
        if (type === "all" || type === "accessories") {
          const rows = await scanLowStock("/accessories");
          result.accessories = rows;
          total += rows.length;
        }
        if (type === "all" || type === "consumables") {
          const rows = await scanLowStock("/consumables");
          result.consumables = rows;
          total += rows.length;
        }
        if (type === "all" || type === "components") {
          const rows = await scanLowStock("/components");
          result.components = rows;
          total += rows.length;
        }
        return ok({ total_low: total, ...result });
      }
      default:
        return err(`Unknown reports tool: ${toolName}`);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export const reportsHandler: DomainHandler = {
  getTools: () => tools,
  handleCall,
};
