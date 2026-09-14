import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { snipeGet } from "../utils/client.js";
import { ok, err, idOf, type DomainHandler } from "../utils/types.js";

const tools: Tool[] = [
  {
    name: "snipeit_locations_list",
    description: "List all locations",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit:  { type: "number" },
        offset: { type: "number" },
        search: { type: "string" },
        sort:   { type: "string" },
        order:  { type: "string", enum: ["asc", "desc"] },
      },
    },
  },
  {
    name: "snipeit_locations_get",
    description: "Get a location by ID",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "number" } },
      required: ["id"],
    },
  },
  {
    name: "snipeit_locations_assets",
    description: "List assets at a location",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "number", description: "Location ID" } },
      required: ["id"],
    },
  },
];

async function handleCall(toolName: string, args: Record<string, unknown>) {
  try {
    switch (toolName) {
      case "snipeit_locations_list":
        return ok(await snipeGet("/locations", args as Record<string, string | number>));
      case "snipeit_locations_get":
        return ok(await snipeGet(`/locations/${idOf(args)}`));
      case "snipeit_locations_assets":
        return ok(await snipeGet(`/locations/${idOf(args)}/assets`));
      default:
        return err(`Unknown locations tool: ${toolName}`);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export const locationsHandler: DomainHandler = {
  getTools: () => tools,
  handleCall,
};
