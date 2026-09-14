import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { snipeGet } from "../utils/client.js";
import { ok, err, type DomainHandler } from "../utils/types.js";

const tools: Tool[] = [
  {
    name: "snipeit_categories_list",
    description: "List asset categories",
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
    name: "snipeit_categories_get",
    description: "Get a category by ID",
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
      case "snipeit_categories_list":
        return ok(await snipeGet("/categories", args as Record<string, string | number>));
      case "snipeit_categories_get":
        return ok(await snipeGet(`/categories/${args.id}`));
      default:
        return err(`Unknown categories tool: ${toolName}`);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export const categoriesHandler: DomainHandler = {
  getTools: () => tools,
  handleCall,
};
