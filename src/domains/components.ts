import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { snipeGet, snipePost, snipePatch } from "../utils/client.js";
import { ok, err, idOf, pick, READ_ONLY, type DomainHandler } from "../utils/types.js";

const CHECKOUT_FIELDS = ["assigned_to", "assigned_qty", "note"] as const;
const CHECKIN_FIELDS = ["checkin_qty", "note"] as const;
const CREATE_FIELDS = [
  "name",
  "qty",
  "category_id",
  "serial",
  "order_number",
  "purchase_cost",
  "purchase_date",
  "company_id",
  "location_id",
  "min_amt",
  "notes",
] as const;
const UPDATE_FIELDS = CREATE_FIELDS;

const tools: Tool[] = [
  {
    name: "snipeit_components_list",
    description: "List components (RAM, drives, etc. installed into assets) with optional filters",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object" as const,
      properties: {
        limit:       { type: "number", description: "Max results (default 50)" },
        offset:      { type: "number", description: "Pagination offset" },
        search:      { type: "string", description: "Search term" },
        category_id: { type: "number" },
        company_id:  { type: "number" },
        location_id: { type: "number" },
        sort:        { type: "string" },
        order:       { type: "string", enum: ["asc", "desc"] },
      },
    },
  },
  {
    name: "snipeit_components_get",
    description: "Get a component by ID (includes qty and remaining availability)",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "number", description: "Component ID" } },
      required: ["id"],
    },
  },
  {
    name: "snipeit_components_assets",
    description:
      "List assets a component is installed in. Each row's ID is the assignment row ID needed for snipeit_components_checkin.",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "number", description: "Component ID" } },
      required: ["id"],
    },
  },
  {
    name: "snipeit_components_checkout",
    description: "Check out units of a component to an asset (components attach to assets, not users)",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        id:           { type: "number", description: "Component ID" },
        assigned_to:  { type: "number", description: "Asset ID to install into" },
        assigned_qty: { type: "number", description: "Quantity to check out (default 1)" },
        note:         { type: "string", description: "Optional checkout note" },
      },
      required: ["id", "assigned_to"],
    },
  },
  {
    name: "snipeit_components_checkin",
    description:
      "Check in component units from an asset. Takes the assignment row ID (from snipeit_components_assets), NOT the component ID.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object" as const,
      properties: {
        component_asset_id: { type: "number", description: "Assignment row ID from snipeit_components_assets" },
        checkin_qty:        { type: "number", description: "Quantity to check in (default 1)" },
        note:               { type: "string", description: "Optional check-in note" },
      },
      required: ["component_asset_id"],
    },
  },
  {
    name: "snipeit_components_create",
    description: "Create a new component",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        name:          { type: "string", description: "Component name" },
        qty:           { type: "number", description: "Total quantity" },
        category_id:   { type: "number", description: "Category ID" },
        serial:        { type: "string" },
        order_number:  { type: "string" },
        purchase_cost: { type: "number" },
        purchase_date: { type: "string", description: "Purchase date (YYYY-MM-DD)" },
        company_id:    { type: "number" },
        location_id:   { type: "number" },
        min_amt:       { type: "number", description: "Minimum quantity before low-stock alert" },
        notes:         { type: "string" },
      },
      required: ["name", "qty", "category_id"],
    },
  },
  {
    name: "snipeit_components_update",
    description: "Update fields on an existing component (overwrites existing values)",
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: {
      type: "object" as const,
      properties: {
        id:            { type: "number", description: "Component ID" },
        name:          { type: "string" },
        qty:           { type: "number" },
        category_id:   { type: "number" },
        serial:        { type: "string" },
        order_number:  { type: "string" },
        purchase_cost: { type: "number" },
        purchase_date: { type: "string" },
        company_id:    { type: "number" },
        location_id:   { type: "number" },
        min_amt:       { type: "number" },
        notes:         { type: "string" },
      },
      required: ["id"],
    },
  },
];

async function handleCall(toolName: string, args: Record<string, unknown>) {
  try {
    switch (toolName) {
      case "snipeit_components_list":
        return ok(await snipeGet("/components", args as Record<string, string | number>));
      case "snipeit_components_get":
        return ok(await snipeGet(`/components/${idOf(args)}`));
      case "snipeit_components_assets":
        return ok(await snipeGet(`/components/${idOf(args)}/assets`));
      case "snipeit_components_checkout":
        return ok(
          await snipePost(`/components/${idOf(args)}/checkout`, pick(args, CHECKOUT_FIELDS))
        );
      case "snipeit_components_checkin":
        return ok(
          await snipePost(
            `/components/${idOf(args, "component_asset_id")}/checkin`,
            pick(args, CHECKIN_FIELDS)
          )
        );
      case "snipeit_components_create":
        return ok(await snipePost("/components", pick(args, CREATE_FIELDS)));
      case "snipeit_components_update":
        return ok(await snipePatch(`/components/${idOf(args)}`, pick(args, UPDATE_FIELDS)));
      default:
        return err(`Unknown components tool: ${toolName}`);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export const componentsHandler: DomainHandler = {
  getTools: () => tools,
  handleCall,
};
