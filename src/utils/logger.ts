/**
 * stderr logger with central redaction.
 *
 * Every message and context object passes through `redact()` before it is
 * written, so a call site cannot leak a credential or dump a full record even
 * if it tries to:
 *   - values of keys that look sensitive are replaced
 *   - `Bearer <...>`, JWTs, `key=value` secrets and the live SNIPEIT_API_TOKEN
 *     are scrubbed from every string
 *   - strings, arrays, object width and nesting depth are capped
 */
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /token|authorization|password|secret|api[_-]?key|cookie/i;
const SENSITIVE_PAIR =
  /((?:token|authorization|password|secret|api[_-]?key|cookie)[\w-]*["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi;

const MAX_STRING = 300;
const MAX_DEPTH = 3;
const MAX_KEYS = 20;
const MAX_ITEMS = 10;
const MAX_LINE = 2000;

function currentLevel(): Level {
  const envLevel = process.env.LOG_LEVEL;
  return envLevel && envLevel in LEVELS ? (envLevel as Level) : "info";
}

function scrub(s: string): string {
  let out = s;
  const token = process.env.SNIPEIT_API_TOKEN?.trim();
  if (token && token.length >= 4) out = out.split(token).join(REDACTED);
  out = out.replace(/Bearer\s+[^\s"',;]+/gi, `Bearer ${REDACTED}`);
  out = out.replace(/eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){0,2}/g, REDACTED);
  out = out.replace(SENSITIVE_PAIR, `$1${REDACTED}`);
  return out;
}

/** Scrub secrets from a string, then cap its length (in that order, so a cut can't expose a partial secret). */
export function redactString(s: string, max = MAX_STRING): string {
  const out = scrub(s);
  return out.length > max ? `${out.slice(0, max)}…[truncated]` : out;
}

/** Return a redacted, size-bounded copy of any value. Safe to JSON.stringify. */
export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (value === undefined) return undefined;
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return `[${typeof value}]`;

  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? "[Array]" : "[Object]";

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((v) => redact(v, depth + 1));
    if (value.length > MAX_ITEMS) items.push(`…(+${value.length - MAX_ITEMS} more)`);
    return items;
  }

  const out: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [k, v] of entries.slice(0, MAX_KEYS)) {
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, depth + 1);
  }
  if (entries.length > MAX_KEYS) out["…"] = `+${entries.length - MAX_KEYS} more keys`;
  return out;
}

function log(level: Level, message: string, ctx?: unknown): void {
  if (LEVELS[level] < LEVELS[currentLevel()]) return;
  let line = `[${level.toUpperCase()}] ${redactString(message, MAX_LINE)}`;
  if (ctx !== undefined) {
    let serialized: string;
    try {
      serialized = JSON.stringify(redact(ctx)) ?? "";
    } catch {
      serialized = "[unserializable context]";
    }
    line += ` ${serialized}`;
  }
  // Final pass over the assembled line: belt and braces for the live token.
  line = redactString(line, MAX_LINE);
  process.stderr.write(line + "\n");
}

export const logger = {
  debug: (msg: string, ctx?: unknown) => log("debug", msg, ctx),
  info:  (msg: string, ctx?: unknown) => log("info",  msg, ctx),
  warn:  (msg: string, ctx?: unknown) => log("warn",  msg, ctx),
  error: (msg: string, ctx?: unknown) => log("error", msg, ctx),
};
