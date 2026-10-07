import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { snipeGet, snipePost, snipePatch } from "../utils/client.js";
import { ok, err, idOf, pick, READ_ONLY, type DomainHandler } from "../utils/types.js";

const CHECKOUT_FIELDS = ["assigned_to", "note"] as const;
const CREATE_FIELDS = [
  "name",
  "qty",
  "category_id",
  "order_number",
  "purchase_cost",
  "purchase_date",
  "model_number",
  "item_no",
  "company_id",
  "location_id",
  "manufacturer_id",
  "min_amt",
  "notes",
] as const;
const UPDATE_FIELDS = CREATE_FIELDS;

const tools: Tool[] = [
  {
    name: "snipeit_consumables_list",
    description: "List consumables (toner, batteries, etc.) with optional filters",
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
    name: "snipeit_consumables_get",
    description: "Get a consumable by ID (includes qty and remaining availability)",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "number", description: "Consumable ID" } },
      required: ["id"],
    },
  },
  {
    name: "snipeit_consumables_users",
    description: "List users a consumable has been issued to",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "number", description: "Consumable ID" } },
      required: ["id"],
    },
  },
  {
    name: "snipeit_consumables_checkout",
    description:
      "Issue one unit of a consumable to a user. Consumables are consumed — there is no check-in.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        id:          { type: "number", description: "Consumable ID" },
        assigned_to: { type: "number", description: "User ID to issue to" },
        note:        { type: "string", description: "Optional note" },
      },
      required: ["id", "assigned_to"],
    },
  },
  {
    name: "snipeit_consumables_create",
    description: "Create a new consumable",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        name:            { type: "string", description: "Consumable name" },
        qty:             { type: "number", description: "Total quantity" },
        category_id:     { type: "number", description: "Category ID" },
        order_number:    { type: "string" },
        purchase_cost:   { type: "number" },
        purchase_date:   { type: "string", description: "Purchase date (YYYY-MM-DD)" },
        model_number:    { type: "string" },
        item_no:         { type: "string", description: "Item number" },
        company_id:      { type: "number" },
        location_id:     { type: "number" },
        manufacturer_id: { type: "number" },
        min_amt:         { type: "number", description: "Minimum quantity before low-stock alert" },
        notes:           { type: "string" },
      },
      required: ["name", "qty", "category_id"],
    },
  },
  {
    name: "snipeit_consumables_update",
    description: "Update fields on an existing consumable (overwrites existing values)",
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: {
      type: "object" as const,
      properties: {
        id:              { type: "number", description: "Consumable ID" },
        name:            { type: "string" },
        qty:             { type: "number" },
        category_id:     { type: "number" },
        order_number:    { type: "string" },
        purchase_cost:   { type: "number" },
        purchase_date:   { type: "string" },
        model_number:    { type: "string" },
        item_no:         { type: "string" },
        company_id:      { type: "number" },
        location_id:     { type: "number" },
        manufacturer_id: { type: "number" },
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
      case "snipeit_consumables_list":
        return ok(await snipeGet("/consumables", args as Record<string, string | number>));
      case "snipeit_consumables_get":
        return ok(await snipeGet(`/consumables/${idOf(args)}`));
      case "snipeit_consumables_users":
        return ok(await snipeGet(`/consumables/view/${idOf(args)}/users`));
      case "snipeit_consumables_checkout":
        return ok(
          await snipePost(`/consumables/${idOf(args)}/checkout`, pick(args, CHECKOUT_FIELDS))
        );
      case "snipeit_consumables_create":
        return ok(await snipePost("/consumables", pick(args, CREATE_FIELDS)));
      case "snipeit_consumables_update":
        return ok(await snipePatch(`/consumables/${idOf(args)}`, pick(args, UPDATE_FIELDS)));
      default:
        return err(`Unknown consumables tool: ${toolName}`);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export const consumablesHandler: DomainHandler = {
  getTools: () => tools,
  handleCall,
};
