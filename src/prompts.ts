import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListPromptsRequestSchema, GetPromptRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const PROMPTS = [
  {
    name: "asset-audit-report",
    description: "Summarize all assets grouped by location and status",
    arguments: [],
  },
  {
    name: "expiring-licenses",
    description: "Find licenses expiring within the next 90 days",
    arguments: [
      { name: "days", description: "Days ahead to check (default 90)", required: false },
    ],
  },
  {
    name: "unassigned-assets",
    description: "List all assets with no current assignee",
    arguments: [],
  },
];

const PROMPT_TEMPLATES: Record<string, string> = {
  "asset-audit-report": `Use snipeit_locations_list to get all locations, then snipeit_hardware_list with each location_id to count assets. Use snipeit_statuslabels_list to get status labels. Present a summary table: Location | Total Assets | By Status. Highlight any locations with a high proportion of assets in a non-deployable status.`,

  "expiring-licenses": `Use snipeit_licenses_list to get all licenses. Filter for any where the expiration_date is within {{days}} days from today. For each expiring license, use snipeit_licenses_seats to show who currently has it assigned. Present a table: License Name | Seats Used | Seats Available | Expiration Date | Assigned Users.`,

  "unassigned-assets": `Use snipeit_hardware_list with status filter to find all deployable (Ready to Deploy) assets that have no assigned user. Group by category using snipeit_categories_list for names. Present: Category | Asset Tag | Model | Location | Last Audit Date.`,
};

export function registerPrompts(server: Server): void {
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: PROMPTS,
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const template = PROMPT_TEMPLATES[name];
    if (!template) throw new Error(`Unknown prompt: ${name}`);

    let text = template;
    if (args) {
      for (const [key, value] of Object.entries(args)) {
        text = text.replace(new RegExp(`{{${key}}}`, "g"), String(value));
      }
    }
    text = text.replace(/{{days}}/g, "90");

    return {
      description: PROMPTS.find((p) => p.name === name)?.description ?? name,
      messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
    };
  });
}
