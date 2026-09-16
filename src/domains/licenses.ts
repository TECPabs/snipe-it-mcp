import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { snipeGet } from "../utils/client.js";
import { ok, err, idOf, READ_ONLY, type DomainHandler } from "../utils/types.js";

const tools: Tool[] = [
  {
    name: "snipeit_licenses_list",
    description: "List software licenses",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit:       { type: "number" },
        offset:      { type: "number" },
        search:      { type: "string" },
        company_id:  { type: "number" },
        category_id: { type: "number" },
        sort:        { type: "string" },
        order:       { type: "string", enum: ["asc", "desc"] },
      },
    },
  },
  {
    name: "snipeit_licenses_get",
    description: "Get a license by ID",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "number" } },
      required: ["id"],
    },
  },
  {
    name: "snipeit_licenses_seats",
    description: "List all seats for a license (who has it assigned)",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "number", description: "License ID" } },
      required: ["id"],
    },
  },
];

async function handleCall(toolName: string, args: Record<string, unknown>) {
  try {
    switch (toolName) {
      case "snipeit_licenses_list":
        return ok(await snipeGet("/licenses", args as Record<string, string | number>));
      case "snipeit_licenses_get":
        return ok(await snipeGet(`/licenses/${idOf(args)}`));
      case "snipeit_licenses_seats":
        return ok(await snipeGet(`/licenses/${idOf(args)}/seats`));
      default:
        return err(`Unknown licenses tool: ${toolName}`);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export const licensesHandler: DomainHandler = {
  getTools: () => tools.map((t) => ({ ...t, annotations: READ_ONLY })),
  handleCall,
};
