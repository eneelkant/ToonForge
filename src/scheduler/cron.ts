import { ToonForgeError } from "../core/errors.js";

export interface DailyCron {
  minute: number;
  hour: number;
  expression: string;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function parseDailyCron(expression: string): DailyCron {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw invalidCron(expression);
  }
  const minute = parts[0] ?? "";
  const hour = parts[1] ?? "";
  const dom = parts[2];
  const month = parts[3];
  const dow = parts[4];
  if (dom !== "*" || month !== "*" || dow !== "*") {
    throw invalidCron(expression);
  }
  if (!/^\d{1,2}$/.test(minute) || !/^\d{1,2}$/.test(hour)) {
    throw invalidCron(expression);
  }
  const minuteN = Number(minute);
  const hourN = Number(hour);
  if (minuteN > 59 || hourN > 23) throw invalidCron(expression);
  return { minute: minuteN, hour: hourN, expression };
}

function invalidCron(expression: string): ToonForgeError {
  return new ToonForgeError({
    code: "CONFIG_INVALID",
    message: `Unsupported cron "${expression}". Use a daily expression: "<minute> <hour> * * *"`,
    component: "scheduler.cron",
  });
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    throw new ToonForgeError({
      code: "CONFIG_INVALID",
      message: `Invalid IANA timezone: ${timeZone}`,
      component: "scheduler.cron",
    });
  }
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

/** Convert a wall-clock time to one UTC instant. Returns null when that local time does not exist. */
export function zonedWallTimeToUtc(
  wall: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string,
): Date | null {
  const utcGuess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0);
  const first = utcGuess - zoneOffsetMs(new Date(utcGuess), timeZone);
  const corrected = utcGuess - zoneOffsetMs(new Date(first), timeZone);
  const seen = zonedParts(new Date(corrected), timeZone);
  if (seen.year !== wall.year || seen.month !== wall.month || seen.day !== wall.day) return null;
  if (seen.hour !== wall.hour || seen.minute !== wall.minute) return null;
  return new Date(corrected);
}

function addLocalDays(parts: ZonedParts, days: number): { year: number; month: number; day: number } {
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

/** Next UTC instant strictly after `after` for a daily local cron. One instant per local civil day. */
export function nextDailyUtc(cron: DailyCron, timeZone: string, after: Date): Date {
  const start = zonedParts(after, timeZone);
  for (let offset = 0; offset <= 366; offset += 1) {
    const day = addLocalDays(start, offset);
    const utc = zonedWallTimeToUtc({ ...day, hour: cron.hour, minute: cron.minute }, timeZone);
    if (utc && utc.getTime() > after.getTime()) return utc;
  }
  throw new ToonForgeError({
    code: "CONFIG_INVALID",
    message: `No schedule occurrence within a year for ${cron.expression} in ${timeZone}`,
    component: "scheduler.cron",
  });
}

export function localSlotId(channelId: string, timeZone: string, utc: Date): string {
  const parts = zonedParts(utc, timeZone);
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  const hour = String(parts.hour).padStart(2, "0");
  const minute = String(parts.minute).padStart(2, "0");
  return `${channelId}:${parts.year}-${month}-${day}T${hour}:${minute}`;
}
