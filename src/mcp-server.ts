import { createRequire } from "node:module";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { getAllTools, getDomainHandler } from "./domains/index.js";
import { registerPrompts } from "./prompts.js";
import { isConfigured, getInstanceHost, checkConnection } from "./utils/client.js";
import { SafeError } from "./utils/errors.js";
import {
  assertKnownWriteTools,
  describePolicy,
  getPolicy,
  runInToolContext,
  toolDenial,
} from "./utils/policy.js";
import { ok, err, fail, type CallToolResult } from "./utils/types.js";
import { logger } from "./utils/logger.js";

// Works from both src/ (tests) and dist/ (runtime) — package.json is one level up either way.
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const META_TOOLS: Tool[] = [
  {
    name: "snipeit_status",
    description: "Check Snipe-IT connection status and API credentials",
    inputSchema: { type: "object" as const, properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "snipeit_navigate",
    description: "Discover available tool domains and capabilities",
    inputSchema: { type: "object" as const, properties: {} },
    annotations: { readOnlyHint: true },
  },
];

let _registry: Map<string, Tool> | null = null;

/** Every tool the code defines, keyed by name — before policy is applied. */
async function registry(): Promise<Map<string, Tool>> {
  if (!_registry) {
    const all = [...META_TOOLS, ...(await getAllTools())];
    _registry = new Map(all.map((t) => [t.name, t]));
  }
  return _registry;
}

/** The tools this server advertises: everything the policy does not disable. */
export async function listTools(): Promise<Tool[]> {
  return [...(await registry()).values()].filter((t) => toolDenial(t) === null);
}

async function statusTool(): Promise<CallToolResult> {
  if (!isConfigured()) {
    return err("Snipe-IT credentials not configured. Set SNIPEIT_URL and SNIPEIT_API_TOKEN.");
  }
  // Connected / not connected and the instance host — nothing else from upstream.
  let instance: string | undefined;
  try {
    instance = getInstanceHost();
    await checkConnection();
    return ok({ status: "connected", instance });
  } catch (e) {
    const reason = e instanceof SafeError ? e.message : "unexpected error";
    return {
      ...ok({ status: "not_connected", ...(instance ? { instance } : {}), reason }),
      isError: true,
    };
  }
}

function navigateTool(): CallToolResult {
  const policy = describePolicy();
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
      accessories:   "Accessories — list, get, who has them, check out/in, create, update",
      consumables:   "Consumables — list, get, issued-to list, issue to user, create, update",
      components:    "Components — list, get, installed-in list, check out/in, create, update",
      reports:       "Reports — activity audit trail, audits due/overdue, low-stock report",
    },
    server_policy: {
      write_tools: policy.writes,
      company_scope: policy.companyScope,
      note: "Only the tools in tools/list are available. Tools disabled by server policy cannot be called, and responses contain only the fields the server permits.",
    },
    tip: "All tools follow the pattern snipeit_{domain}_{action}. Use snipeit_hardware_list to start.",
  });
}

/**
 * Execute one tool call under the server policy. This is the single entry
 * point for tool execution: it rejects tools the policy disables (whether or
 * not the client ever saw them in tools/list) and runs the handler inside the
 * tool context the client uses to authorise writes.
 */
export async function callTool(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  try {
    logger.debug("tool call", { name });

    const tool = (await registry()).get(name);
    if (!tool) return err(`Unknown tool: ${name}`);

    const denial = toolDenial(tool);
    if (denial) return err(denial);

    return await runInToolContext(tool, async () => {
      if (name === "snipeit_status") return statusTool();
      if (name === "snipeit_navigate") return navigateTool();
      const handler = await getDomainHandler(name);
      if (!handler) return err(`Unknown tool: ${name}`);
      return handler.handleCall(name, args);
    });
  } catch (e) {
    return fail(e);
  }
}

export async function createMcpServer(): Promise<Server> {
  // Fail startup on an invalid policy rather than on first use.
  getPolicy();
  assertKnownWriteTools([...(await registry()).values()]);

  const server = new Server(
    { name: "snipe-it-mcp", version },
    { capabilities: { tools: {}, prompts: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await listTools() }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return callTool(name, (args ?? {}) as Record<string, unknown>);
  });

  registerPrompts(server);

  return server;
}
