export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogFields {
  workflowId?: string;
  projectId?: string;
  videoId?: string;
  agentId?: string;
  component?: string;
  [key: string]: unknown;
}

export class Logger {
  constructor(
    private readonly component: string,
    private readonly minLevel: LogLevel = (process.env.TOONFORGE_LOG_LEVEL as LogLevel) || "info",
  ) {}

  child(component: string): Logger {
    return new Logger(`${this.component}.${component}`, this.minLevel);
  }

  debug(message: string, fields?: LogFields): void {
    this.write("debug", message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.write("info", message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.write("warn", message, fields);
  }

  error(message: string, fields?: LogFields): void {
    this.write("error", message, fields);
  }

  private write(level: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const safeFields = sanitizeLogValue(fields ?? {}) as Record<string, unknown>;
    const line = {
      ts: new Date().toISOString(),
      level,
      component: this.component,
      message: sanitizeLogValue(message),
      ...safeFields,
    };
    // stderr keeps stdout free for CLI JSON and MCP JSON-RPC.
    console.error(JSON.stringify(line));
  }
}

function sanitizeLogValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeLogValue(item));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = /token|secret|password|api[_-]?key|authorization|credential/i.test(key)
        ? "[REDACTED]"
        : sanitizeLogValue(inner);
    }
    return out;
  }
  if (typeof value === "string") {
    return value
      .replace(/bearer\s+\S+/gi, "Bearer [REDACTED]")
      .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
  }
  return value;
}

export const rootLogger = new Logger("toonforge");
