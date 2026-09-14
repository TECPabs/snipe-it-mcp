import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { snipeGet } from "../utils/client.js";
import { ok, err, type DomainHandler } from "../utils/types.js";

const tools: Tool[] = [
  {
    name: "snipeit_users_list",
    description: "List users with optional search/filter",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit:    { type: "number" },
        offset:   { type: "number" },
        search:   { type: "string", description: "Search by name, username, or email" },
        sort:     { type: "string" },
        order:    { type: "string", enum: ["asc", "desc"] },
        company_id: { type: "number" },
        location_id: { type: "number" },
      },
    },
  },
  {
    name: "snipeit_users_get",
    description: "Get a user by ID",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "number" } },
      required: ["id"],
    },
  },
  {
    name: "snipeit_users_assets",
    description: "List all assets assigned to a user",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "number", description: "User ID" } },
      required: ["id"],
    },
  },
];

async function handleCall(toolName: string, args: Record<string, unknown>) {
  try {
    switch (toolName) {
      case "snipeit_users_list":
        return ok(await snipeGet("/users", args as Record<string, string | number>));
      case "snipeit_users_get":
        return ok(await snipeGet(`/users/${args.id}`));
      case "snipeit_users_assets":
        return ok(await snipeGet(`/users/${args.id}/assets`));
      default:
        return err(`Unknown users tool: ${toolName}`);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export const usersHandler: DomainHandler = {
  getTools: () => tools,
  handleCall,
};
