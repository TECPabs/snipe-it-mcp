import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { snipeGet } from "../utils/client.js";
import { ok, err, idOf, READ_ONLY, type DomainHandler } from "../utils/types.js";

const tools: Tool[] = [
  {
    name: "snipeit_statuslabels_list",
    description: "List status labels",
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
    name: "snipeit_statuslabels_get",
    description: "Get a status label by ID",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "number" } },
      required: ["id"],
    },
  },
  {
    name: "snipeit_statuslabels_assets",
    description: "List assets with a given status label",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "number", description: "Status label ID" } },
      required: ["id"],
    },
  },
];

async function handleCall(toolName: string, args: Record<string, unknown>) {
  try {
    switch (toolName) {
      case "snipeit_statuslabels_list":
        return ok(await snipeGet("/statuslabels", args as Record<string, string | number>));
      case "snipeit_statuslabels_get":
        return ok(await snipeGet(`/statuslabels/${idOf(args)}`));
      case "snipeit_statuslabels_assets":
        return ok(await snipeGet(`/statuslabels/${idOf(args)}/assetlist`));
      default:
        return err(`Unknown statuslabels tool: ${toolName}`);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export const statuslabelsHandler: DomainHandler = {
  getTools: () => tools.map((t) => ({ ...t, annotations: READ_ONLY })),
  handleCall,
};
