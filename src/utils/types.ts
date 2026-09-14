import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export type CallToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export interface DomainHandler {
  getTools(): Tool[];
  handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult>;
}

/**
 * Shrink Snipe-IT API payloads before returning them to the model:
 * - drop null/empty-string fields and `available_actions`
 * - collapse `{datetime|date, formatted}` objects to the raw value
 * - collapse `custom_fields` to a flat {name: value} map, dropping empties
 */
export function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compact);
  if (value === null || typeof value !== "object") return value;

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (
    keys.length > 0 &&
    keys.every((k) => k === "datetime" || k === "date" || k === "formatted") &&
    ("datetime" in obj || "date" in obj)
  ) {
    return obj.datetime ?? obj.date;
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === "") continue;
    if (k === "available_actions") continue;
    if (k === "custom_fields" && typeof v === "object" && !Array.isArray(v)) {
      const cf: Record<string, unknown> = {};
      for (const [name, field] of Object.entries(v as Record<string, unknown>)) {
        const fieldValue = (field as { value?: unknown } | null)?.value;
        if (fieldValue !== null && fieldValue !== undefined && fieldValue !== "") {
          cf[name] = fieldValue;
        }
      }
      if (Object.keys(cf).length > 0) out[k] = cf;
      continue;
    }
    out[k] = compact(v);
  }
  return out;
}

/** Validate and coerce an integer ID argument before it is interpolated into a URL path. */
export function idOf(args: Record<string, unknown>, key = "id"): number {
  const v = args[key];
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid ${key}: expected a positive integer, got ${JSON.stringify(v)}`);
  }
  return n;
}

export function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(compact(data), null, 2) }] };
}

export function err(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
