import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { snipeGet, snipePost, snipePatch } from "../utils/client.js";
import { ok, err, idOf, pick, READ_ONLY, type DomainHandler } from "../utils/types.js";

const CHECKIN_FIELDS = ["note"] as const;
const CHECKOUT_FIELDS = [
  "assigned_user",
  "assigned_location",
  "assigned_asset",
  "checkout_to_type",
  "note",
  "expected_checkin",
] as const;
const AUDIT_FIELDS = ["asset_tag", "location_id", "note"] as const;
const CREATE_FIELDS = [
  "asset_tag",
  "status_id",
  "model_id",
  "name",
  "serial",
  "notes",
  "purchase_date",
  "purchase_cost",
  "location_id",
  "company_id",
] as const;
const UPDATE_FIELDS = [
  "name",
  "serial",
  "notes",
  "status_id",
  "model_id",
  "location_id",
  "purchase_date",
  "purchase_cost",
] as const;

const tools: Tool[] = [
  {
    name: "snipeit_hardware_list",
    description: "List hardware assets with optional filters",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object" as const,
      properties: {
        limit:       { type: "number", description: "Max results (default 50)" },
        offset:      { type: "number", description: "Pagination offset" },
        search:      { type: "string", description: "Search term (asset tag, serial, name)" },
        status:      { type: "string", description: "Filter by status label name" },
        status_id:   { type: "number", description: "Filter by status label ID" },
        category_id: { type: "number", description: "Filter by category ID" },
        location_id: { type: "number", description: "Filter by location ID" },
        assigned_to: { type: "number", description: "Filter by assigned user ID" },
        sort:        { type: "string", description: "Sort field (e.g. created_at, name)" },
        order:       { type: "string", enum: ["asc", "desc"], description: "Sort order" },
      },
    },
  },
  {
    name: "snipeit_hardware_get",
    description: "Get a hardware asset by ID",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "number", description: "Asset ID" } },
      required: ["id"],
    },
  },
  {
    name: "snipeit_hardware_by_tag",
    description: "Get a hardware asset by asset tag",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object" as const,
      properties: { asset_tag: { type: "string", description: "Asset tag" } },
      required: ["asset_tag"],
    },
  },
  {
    name: "snipeit_hardware_by_serial",
    description: "Get hardware asset(s) by serial number",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object" as const,
      properties: { serial: { type: "string", description: "Serial number" } },
      required: ["serial"],
    },
  },
  {
    name: "snipeit_hardware_checkin",
    description: "Check in an asset (unassign it)",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object" as const,
      properties: {
        id:   { type: "number", description: "Asset ID" },
        note: { type: "string", description: "Optional check-in note" },
      },
      required: ["id"],
    },
  },
  {
    name: "snipeit_hardware_checkout",
    description: "Check out an asset to a user, location, or another asset",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        id:              { type: "number", description: "Asset ID" },
        assigned_user:   { type: "number", description: "User ID to assign to" },
        assigned_location: { type: "number", description: "Location ID to assign to" },
        assigned_asset:  { type: "number", description: "Asset ID to assign to" },
        checkout_to_type: { type: "string", enum: ["user", "location", "asset"], description: "Assignee type" },
        note:            { type: "string", description: "Optional checkout note" },
        expected_checkin: { type: "string", description: "Expected check-in date (YYYY-MM-DD)" },
      },
      required: ["id", "checkout_to_type"],
    },
  },
  {
    name: "snipeit_hardware_audit",
    description: "Record an audit on an asset",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        asset_tag:   { type: "string", description: "Asset tag" },
        location_id: { type: "number", description: "Location ID where asset was found" },
        note:        { type: "string", description: "Audit note" },
      },
      required: ["asset_tag"],
    },
  },
  {
    name: "snipeit_hardware_create",
    description: "Create a new hardware asset",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        asset_tag:    { type: "string", description: "Unique asset tag" },
        status_id:    { type: "number", description: "Status label ID" },
        model_id:     { type: "number", description: "Asset model ID" },
        name:         { type: "string", description: "Asset name" },
        serial:       { type: "string", description: "Serial number" },
        notes:        { type: "string", description: "Notes" },
        purchase_date: { type: "string", description: "Purchase date (YYYY-MM-DD)" },
        purchase_cost: { type: "number", description: "Purchase cost" },
        location_id:  { type: "number", description: "Location ID" },
        company_id:   { type: "number", description: "Company ID" },
      },
      required: ["asset_tag", "status_id", "model_id"],
    },
  },
  {
    name: "snipeit_hardware_update",
    description: "Update fields on an existing asset (overwrites existing values)",
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: {
      type: "object" as const,
      properties: {
        id:           { type: "number", description: "Asset ID" },
        name:         { type: "string" },
        serial:       { type: "string" },
        notes:        { type: "string" },
        status_id:    { type: "number" },
        model_id:     { type: "number" },
        location_id:  { type: "number" },
        purchase_date: { type: "string" },
        purchase_cost: { type: "number" },
      },
      required: ["id"],
    },
  },
];

async function handleCall(toolName: string, args: Record<string, unknown>) {
  try {
    switch (toolName) {
      case "snipeit_hardware_list":
        return ok(await snipeGet("/hardware", args as Record<string, string | number>));
      case "snipeit_hardware_get":
        return ok(await snipeGet(`/hardware/${idOf(args)}`));
      case "snipeit_hardware_by_tag":
        return ok(await snipeGet(`/hardware/bytag/${encodeURIComponent(String(args.asset_tag))}`));
      case "snipeit_hardware_by_serial":
        return ok(await snipeGet(`/hardware/byserial/${encodeURIComponent(String(args.serial))}`));
      case "snipeit_hardware_checkin":
        return ok(await snipePost(`/hardware/${idOf(args)}/checkin`, pick(args, CHECKIN_FIELDS)));
      case "snipeit_hardware_checkout":
        return ok(await snipePost(`/hardware/${idOf(args)}/checkout`, pick(args, CHECKOUT_FIELDS)));
      case "snipeit_hardware_audit":
        return ok(await snipePost("/hardware/audit", pick(args, AUDIT_FIELDS)));
      case "snipeit_hardware_create":
        return ok(await snipePost("/hardware", pick(args, CREATE_FIELDS)));
      case "snipeit_hardware_update":
        return ok(await snipePatch(`/hardware/${idOf(args)}`, pick(args, UPDATE_FIELDS)));
      default:
        return err(`Unknown hardware tool: ${toolName}`);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export const hardwareHandler: DomainHandler = {
  getTools: () => tools,
  handleCall,
};
