#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp-server.js";
import { logger } from "./utils/logger.js";

async function main() {
  logger.info("Starting Snipe-IT MCP server");
  const server = await createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Snipe-IT MCP server connected via stdio");
}

main().catch((e) => {
  process.stderr.write(`Fatal: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
