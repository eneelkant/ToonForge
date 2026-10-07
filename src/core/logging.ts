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
    const line = {
      ts: new Date().toISOString(),
      level,
      component: this.component,
      message,
      ...fields,
    };
    const payload = JSON.stringify(line);
    if (level === "error") {
      console.error(payload);
    } else if (level === "warn") {
      console.warn(payload);
    } else {
      console.log(payload);
    }
  }
}

export const rootLogger = new Logger("toonforge");
