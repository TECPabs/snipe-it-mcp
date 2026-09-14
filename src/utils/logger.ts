const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

const envLevel = process.env.LOG_LEVEL;
const current: Level = envLevel && envLevel in LEVELS ? (envLevel as Level) : "info";

function log(level: Level, message: string, ctx?: unknown): void {
  if (LEVELS[level] < LEVELS[current]) return;
  const line = ctx !== undefined
    ? `[${level.toUpperCase()}] ${message} ${JSON.stringify(ctx)}`
    : `[${level.toUpperCase()}] ${message}`;
  process.stderr.write(line + "\n");
}

export const logger = {
  debug: (msg: string, ctx?: unknown) => log("debug", msg, ctx),
  info:  (msg: string, ctx?: unknown) => log("info",  msg, ctx),
  warn:  (msg: string, ctx?: unknown) => log("warn",  msg, ctx),
  error: (msg: string, ctx?: unknown) => log("error", msg, ctx),
};
