import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { snipeGet } from "../utils/client.js";
import { ok, err, type DomainHandler } from "../utils/types.js";

const tools: Tool[] = [
  {
    name: "snipeit_models_list",
    description: "List asset models",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit:           { type: "number" },
        offset:          { type: "number" },
        search:          { type: "string" },
        category_id:     { type: "number" },
        manufacturer_id: { type: "number" },
        sort:            { type: "string" },
        order:           { type: "string", enum: ["asc", "desc"] },
      },
    },
  },
  {
    name: "snipeit_models_get",
    description: "Get an asset model by ID",
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
      case "snipeit_models_list":
        return ok(await snipeGet("/models", args as Record<string, string | number>));
      case "snipeit_models_get":
        return ok(await snipeGet(`/models/${args.id}`));
      default:
        return err(`Unknown models tool: ${toolName}`);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export const modelsHandler: DomainHandler = {
  getTools: () => tools,
  handleCall,
};
