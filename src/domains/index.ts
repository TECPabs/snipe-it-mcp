import type { DomainHandler } from "../utils/types.js";

const cache = new Map<string, DomainHandler>();

async function loadHandler(domain: string): Promise<DomainHandler> {
  const cached = cache.get(domain);
  if (cached) return cached;

  let handler: DomainHandler;
  switch (domain) {
    case "hardware":      { const m = await import("./hardware.js");      handler = m.hardwareHandler; break; }
    case "users":         { const m = await import("./users.js");         handler = m.usersHandler; break; }
    case "locations":     { const m = await import("./locations.js");     handler = m.locationsHandler; break; }
    case "licenses":      { const m = await import("./licenses.js");      handler = m.licensesHandler; break; }
    case "models":        { const m = await import("./models.js");        handler = m.modelsHandler; break; }
    case "categories":    { const m = await import("./categories.js");    handler = m.categoriesHandler; break; }
    case "manufacturers": { const m = await import("./manufacturers.js"); handler = m.manufacturersHandler; break; }
    case "statuslabels":  { const m = await import("./statuslabels.js");  handler = m.statuslabelsHandler; break; }
    default:
      throw new Error(`Unknown domain: ${domain}`);
  }

  cache.set(domain, handler);
  return handler;
}

export const DOMAINS = ["hardware", "users", "locations", "licenses", "models", "categories", "manufacturers", "statuslabels"] as const;

export async function getDomainHandler(toolName: string): Promise<DomainHandler | null> {
  for (const domain of DOMAINS) {
    if (toolName.startsWith(`snipeit_${domain}_`)) {
      return loadHandler(domain);
    }
  }
  return null;
}

export async function getAllTools() {
  const allTools = [];
  for (const domain of DOMAINS) {
    const handler = await loadHandler(domain);
    allTools.push(...handler.getTools());
  }
  return allTools;
}
