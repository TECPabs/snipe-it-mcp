#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp-server.js";
import { validateConfigAtStartup } from "./utils/client.js";
import { describePolicy } from "./utils/policy.js";
import { logger } from "./utils/logger.js";

async function main() {
  logger.info("Starting Snipe-IT MCP server");

  // Validate configuration before accepting any request. A configured-but-
  // invalid URL or an invalid policy setting throws here and exits non-zero.
  const configured = validateConfigAtStartup();
  const server = await createMcpServer();

  if (!configured) {
    logger.warn("SNIPEIT_URL and SNIPEIT_API_TOKEN are not both set — every tool will fail until they are.");
  }
  const policy = describePolicy();
  logger.info(`Write tools: ${policy.writes}`);
  if (policy.companyScope === "unrestricted") {
    logger.warn(
      "SNIPEIT_ALLOWED_COMPANY_IDS is not set — company scope is UNRESTRICTED: this server can read " +
        "every company's records that the API token can see."
    );
  } else {
    logger.info("Company scope: restricted to the configured company IDs");
  }
  if (policy.extraFields.length > 0) {
    logger.warn(`Extra fields unlocked by operator: ${policy.extraFields.join(", ")}`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Snipe-IT MCP server connected via stdio");
}

main().catch((e) => {
  // Through the logger (stderr), so central redaction applies to whatever the error carries.
  logger.error(`Fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
