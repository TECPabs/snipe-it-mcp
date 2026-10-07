import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { snipeGet, snipePost, snipePatch } from "../utils/client.js";
import { ok, err, idOf, pick, READ_ONLY, type DomainHandler } from "../utils/types.js";

const CHECKOUT_FIELDS = ["assigned_to", "checkout_qty", "note"] as const;
const CHECKIN_FIELDS = ["note"] as const;
const CREATE_FIELDS = [
  "name",
  "qty",
  "category_id",
  "order_number",
  "purchase_cost",
  "purchase_date",
  "model_number",
  "company_id",
  "location_id",
  "manufacturer_id",
  "supplier_id",
  "min_amt",
  "notes",
] as const;
const UPDATE_FIELDS = CREATE_FIELDS;

const tools: Tool[] = [
  {
    name: "snipeit_accessories_list",
    description: "List accessories (keyboards, mice, cables, etc.) with optional filters",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object" as const,
      properties: {
        limit:           { type: "number", description: "Max results (default 50)" },
        offset:          { type: "number", description: "Pagination offset" },
        search:          { type: "string", description: "Search term" },
        category_id:     { type: "number" },
        company_id:      { type: "number" },
        manufacturer_id: { type: "number" },
        sort:            { type: "string" },
        order:           { type: "string", enum: ["asc", "desc"] },
      },
    },
  },
  {
    name: "snipeit_accessories_get",
    description: "Get an accessory by ID (includes qty and remaining availability)",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "number", description: "Accessory ID" } },
      required: ["id"],
    },
  },
  {
    name: "snipeit_accessories_checkedout",
    description:
      "List who an accessory is checked out to. Each row includes assigned_pivot_id, which is the ID needed for snipeit_accessories_checkin.",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "number", description: "Accessory ID" } },
      required: ["id"],
    },
  },
  {
    name: "snipeit_accessories_checkout",
    description: "Check out one unit of an accessory to a user",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        id:           { type: "number", description: "Accessory ID" },
        assigned_to:  { type: "number", description: "User ID to assign to" },
        checkout_qty: { type: "number", description: "Quantity to check out (default 1)" },
        note:         { type: "string", description: "Optional checkout note" },
      },
      required: ["id", "assigned_to"],
    },
  },
  {
    name: "snipeit_accessories_checkin",
    description:
      "Check in an accessory unit. Takes the assigned_pivot_id of the assignment row (from snipeit_accessories_checkedout), NOT the accessory ID.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object" as const,
      properties: {
        assigned_pivot_id: { type: "number", description: "Assignment row ID from the checkedout list" },
        note:              { type: "string", description: "Optional check-in note" },
      },
      required: ["assigned_pivot_id"],
    },
  },
  {
    name: "snipeit_accessories_create",
    description: "Create a new accessory",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        name:            { type: "string", description: "Accessory name" },
        qty:             { type: "number", description: "Total quantity" },
        category_id:     { type: "number", description: "Category ID" },
        order_number:    { type: "string" },
        purchase_cost:   { type: "number" },
        purchase_date:   { type: "string", description: "Purchase date (YYYY-MM-DD)" },
        model_number:    { type: "string" },
        company_id:      { type: "number" },
        location_id:     { type: "number" },
        manufacturer_id: { type: "number" },
        supplier_id:     { type: "number" },
        min_amt:         { type: "number", description: "Minimum quantity before low-stock alert" },
        notes:           { type: "string" },
      },
      required: ["name", "qty", "category_id"],
    },
  },
  {
    name: "snipeit_accessories_update",
    description: "Update fields on an existing accessory (overwrites existing values)",
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: {
      type: "object" as const,
      properties: {
        id:              { type: "number", description: "Accessory ID" },
        name:            { type: "string" },
        qty:             { type: "number" },
        category_id:     { type: "number" },
        order_number:    { type: "string" },
        purchase_cost:   { type: "number" },
        purchase_date:   { type: "string" },
        model_number:    { type: "string" },
        company_id:      { type: "number" },
        location_id:     { type: "number" },
        manufacturer_id: { type: "number" },
        supplier_id:     { type: "number" },
        min_amt:         { type: "number" },
        notes:           { type: "string" },
      },
      required: ["id"],
    },
  },
];

async function handleCall(toolName: string, args: Record<string, unknown>) {
  try {
    switch (toolName) {
      case "snipeit_accessories_list":
        return ok(await snipeGet("/accessories", args as Record<string, string | number>));
      case "snipeit_accessories_get":
        return ok(await snipeGet(`/accessories/${idOf(args)}`));
      case "snipeit_accessories_checkedout":
        return ok(await snipeGet(`/accessories/${idOf(args)}/checkedout`));
      case "snipeit_accessories_checkout":
        return ok(
          await snipePost(`/accessories/${idOf(args)}/checkout`, pick(args, CHECKOUT_FIELDS))
        );
      case "snipeit_accessories_checkin":
        return ok(
          await snipePost(
            `/accessories/${idOf(args, "assigned_pivot_id")}/checkin`,
            pick(args, CHECKIN_FIELDS)
          )
        );
      case "snipeit_accessories_create":
        return ok(await snipePost("/accessories", pick(args, CREATE_FIELDS)));
      case "snipeit_accessories_update":
        return ok(await snipePatch(`/accessories/${idOf(args)}`, pick(args, UPDATE_FIELDS)));
      default:
        return err(`Unknown accessories tool: ${toolName}`);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export const accessoriesHandler: DomainHandler = {
  getTools: () => tools,
  handleCall,
};
