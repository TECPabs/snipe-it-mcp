import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export type CallToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export interface DomainHandler {
  getTools(): Tool[];
  handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult>;
}

export function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function err(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
