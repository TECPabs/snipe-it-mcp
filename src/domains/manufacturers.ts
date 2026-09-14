import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { snipeGet } from "../utils/client.js";
import { ok, err, type DomainHandler } from "../utils/types.js";

const tools: Tool[] = [
  {
    name: "snipeit_manufacturers_list",
    description: "List manufacturers",
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
    name: "snipeit_manufacturers_get",
    description: "Get a manufacturer by ID",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "number" } },
      required: ["id"],
    },
  },
];

async function handleCall(toolName: string, args: Record<string, unknown>) {
  try {
    switch (toolName) {
      case "snipeit_manufacturers_list":
        return ok(await snipeGet("/manufacturers", args as Record<string, string | number>));
      case "snipeit_manufacturers_get":
        return ok(await snipeGet(`/manufacturers/${args.id}`));
      default:
        return err(`Unknown manufacturers tool: ${toolName}`);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export const manufacturersHandler: DomainHandler = {
  getTools: () => tools,
  handleCall,
};
