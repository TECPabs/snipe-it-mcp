import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getAllTools, getDomainHandler } from "./domains/index.js";
import { registerPrompts } from "./prompts.js";
import { isConfigured, getBaseUrl, snipeGet } from "./utils/client.js";
import { ok, err } from "./utils/types.js";
import { logger } from "./utils/logger.js";

const META_TOOLS = [
  {
    name: "snipeit_status",
    description: "Check Snipe-IT connection status and API credentials",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "snipeit_navigate",
    description: "Discover available tool domains and capabilities",
    inputSchema: { type: "object" as const, properties: {} },
  },
];

let _toolCache: Awaited<ReturnType<typeof getAllTools>> | null = null;

export async function createMcpServer(): Promise<Server> {
  const server = new Server(
    { name: "snipe-it-mcp", version: "1.0.0" },
    { capabilities: { tools: {}, prompts: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (!_toolCache) _toolCache = await getAllTools();
    return { tools: [...META_TOOLS, ..._toolCache] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const safeArgs = (args ?? {}) as Record<string, unknown>;

    logger.debug("tool call", { name });

    if (name === "snipeit_status") {
      if (!isConfigured()) {
        return err("Snipe-IT credentials not configured. Set SNIPEIT_URL and SNIPEIT_API_TOKEN.");
      }
      try {
        const data = await snipeGet("/hardware", { limit: 1 }) as { total?: number };
        return ok({
          status: "connected",
          instance: getBaseUrl(),
          total_assets: data.total ?? "unknown",
          message: "Snipe-IT MCP server is running. Use snipeit_navigate to explore available tools.",
        });
      } catch (e) {
        return err(`Connection failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (name === "snipeit_navigate") {
      return ok({
        domains: {
          hardware:      "Assets — list, get, create, update, check in/out, audit",
          users:         "Users — list, get, assets assigned to user",
          locations:     "Locations — list, get, assets at location",
          licenses:      "Licenses — list, get, seat assignments",
          models:        "Asset models — list, get",
          categories:    "Categories — list, get",
          manufacturers: "Manufacturers — list, get",
          statuslabels:  "Status labels — list, get, assets by status",
        },
        tip: "All tools follow the pattern snipeit_{domain}_{action}. Use snipeit_hardware_list to start.",
      });
    }

    const handler = await getDomainHandler(name);
    if (!handler) return err(`Unknown tool: ${name}`);
    return handler.handleCall(name, safeArgs);
  });

  registerPrompts(server);

  return server;
}
