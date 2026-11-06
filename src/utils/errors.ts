import { randomBytes } from "node:crypto";

/**
 * Base class for errors whose message is safe to return to the MCP client.
 * Anything that is NOT a SafeError is treated as internal and replaced with a
 * generic message + correlation ID before it leaves the server (see `fail()`).
 */
export class SafeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Invalid or missing server configuration (environment variables). */
export class ConfigError extends SafeError {}

/** A request was refused by server-side access policy. */
export class PolicyError extends SafeError {}

/** Invalid tool arguments. */
export class InputError extends SafeError {}

export type SnipeFailure = "http" | "application" | "non_json" | "timeout" | "network";

/**
 * An upstream Snipe-IT failure. Never carries the response body: only the HTTP
 * status, a correlation ID that is also written to stderr, and (for Snipe-IT's
 * own `status:"error"` payloads) a sanitized message.
 */
export class SnipeApiError extends SafeError {
  constructor(
    message: string,
    readonly kind: SnipeFailure,
    readonly correlationId: string,
    readonly status?: number
  ) {
    super(message);
  }
}

/** Deliberately identical for "does not exist" and "exists but out of scope". */
export const NOT_FOUND_OR_DENIED = "Record not found or not permitted.";

export function notFoundOrDenied(): PolicyError {
  return new PolicyError(NOT_FOUND_OR_DENIED);
}

export function newCorrelationId(): string {
  return randomBytes(4).toString("hex");
}

const MAX_MESSAGE_CHARS = 200;
const MAX_MESSAGES = 5;
const MAX_VALUES_PER_FIELD = 3;

/**
 * Reduce one upstream message to a short single line with nothing that looks
 * like markup, SQL, a URL, a filesystem path, or a credential.
 */
export function sanitizeText(input: unknown): string {
  if (typeof input !== "string" && typeof input !== "number" && typeof input !== "boolean") {
    return "";
  }
  let t = String(input);
  const token = process.env.SNIPEIT_API_TOKEN;
  if (token && token.length >= 4) t = t.split(token).join("[redacted]");

  t = t.replace(/<[^>]*>/g, " "); // HTML tags
  t = t.replace(/[\u0000-\u001f\u007f]+/g, " "); // newlines / control chars -> single line
  t = t.replace(/SQLSTATE[\s\S]*$/i, "[details removed]");
  t = t.replace(/\(?\bSQL\s*:[\s\S]*$/i, "[details removed]");
  t = t.replace(
    /\b(?:select\s[\s\S]*?\sfrom|insert\s+into|update\s+\S+\s+set|delete\s+from)\s[\s\S]*$/i,
    "[details removed]"
  );
  t = t.replace(/\s#\d+\s[\s\S]*$/, " [details removed]"); // stack frames
  t = t.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[url removed]");
  t = t.replace(/Bearer\s+\S+/gi, "[redacted]");
  t = t.replace(/eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){0,2}/g, "[redacted]"); // JWT
  t = t.replace(
    /\b((?:api[_-]?)?(?:token|key|password|passwd|secret|authorization|cookie))\b\s*[:=]\s*\S+/gi,
    "$1 [redacted]"
  );
  t = t.replace(/[A-Za-z0-9+/_=-]{32,}/g, "[redacted]"); // long opaque strings
  t = t.replace(/(?:[A-Za-z]:\\|\/)(?:[\w.@-]+[\\/]){2,}[\w.@-]*(?::\d+)?/g, "[path removed]");
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > MAX_MESSAGE_CHARS) t = `${t.slice(0, MAX_MESSAGE_CHARS)}…`;
  return t;
}

function sanitizeFieldName(name: string): string {
  return name.replace(/[^\w.-]/g, "").slice(0, 40) || "field";
}

/**
 * Sanitize the `messages` value of a Snipe-IT `{"status":"error"}` payload.
 * - string  -> one sanitized line
 * - array   -> up to MAX_MESSAGES sanitized lines
 * - object  -> up to MAX_MESSAGES `field: message` pairs
 * Anything else (or an empty result) becomes a generic phrase.
 */
export function sanitizeMessages(messages: unknown): string {
  const parts: string[] = [];

  const valuesOf = (v: unknown): string =>
    (Array.isArray(v) ? v : [v])
      .slice(0, MAX_VALUES_PER_FIELD)
      .map(sanitizeText)
      .filter(Boolean)
      .join(", ");

  if (Array.isArray(messages)) {
    for (const m of messages.slice(0, MAX_MESSAGES)) {
      const s = sanitizeText(m);
      if (s) parts.push(s);
    }
  } else if (messages !== null && typeof messages === "object") {
    for (const [field, value] of Object.entries(messages).slice(0, MAX_MESSAGES)) {
      const s = valuesOf(value);
      if (s) parts.push(`${sanitizeFieldName(field)}: ${s}`);
    }
  } else {
    const s = sanitizeText(messages);
    if (s) parts.push(s);
  }

  return parts.length > 0 ? parts.join("; ") : "request rejected";
}
