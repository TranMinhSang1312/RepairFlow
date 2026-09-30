const DEFAULT_TIME_ZONE = "Asia/Ho_Chi_Minh";

type DateTimeParts = { year: number; month: number; day: number; hour: number; minute: number };

function dateTimeParts(value: Date, timeZone: string): DateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(value).map(({ type, value: part }) => [type, part]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function validTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

export function formatShopDateTime(
  value: string | Date | null | undefined,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Không xác định";
  try {
    return new Intl.DateTimeFormat("vi-VN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("vi-VN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: DEFAULT_TIME_ZONE,
    }).format(date);
  }
}

export function formatShopDate(
  value: string | Date | null | undefined,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Không xác định";
  try {
    return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("vi-VN", {
      dateStyle: "medium",
      timeZone: DEFAULT_TIME_ZONE,
    }).format(date);
  }
}

/** Formats an instant for a `datetime-local` input in the shop's timezone. */
export function formatShopDateTimeLocal(
  value: string | Date | null | undefined,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = dateTimeParts(date, validTimeZone(timeZone));
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

/** Parses a `datetime-local` wall-clock value in the shop's timezone to an instant. */
export function parseShopDateTimeLocal(value: string, timeZone = DEFAULT_TIME_ZONE): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const wallClock = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  if (!Number.isFinite(wallClock)) return null;

  let instant = new Date(wallClock);
  const zone = validTimeZone(timeZone);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = dateTimeParts(instant, zone);
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    instant = new Date(instant.getTime() + (wallClock - represented));
  }
  return Number.isNaN(instant.getTime()) ? null : instant;
}
