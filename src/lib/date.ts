const isoLocalDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function formatLocalDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`;
}

export function getRelativeDateString(
  daysOffset: number,
  baseDate = new Date(),
): string {
  const localDate = new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate() + daysOffset,
  );

  return formatLocalDate(localDate);
}

export function parseLocalDate(dateStr: string): Date | null {
  if (!isoLocalDatePattern.test(dateStr)) {
    return null;
  }

  const [yearRaw, monthRaw, dayRaw] = dateStr.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

export function isIsoLocalDateString(value: unknown): value is string {
  return typeof value === "string" && parseLocalDate(value) !== null;
}

export function requireLocalDate(value: string, pointer = "#/expiresAt"): string {
  if (!isIsoLocalDateString(value)) {
    throw new Error(`Invalid local date at ${pointer}`);
  }

  return value;
}

export function calculateDaysLeft(expiresAt: string, baseDate = new Date()): number {
  const todayLocal = new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
  );
  const targetLocal = parseLocalDate(expiresAt);

  if (!targetLocal) {
    return 0;
  }

  return Math.round((targetLocal.getTime() - todayLocal.getTime()) / 86_400_000);
}

export function toRfc3339(date: Date | string): string {
  const parsed = typeof date === "string" ? new Date(date) : date;
  return parsed.toISOString();
}

export function parseOptionalDateTime(value: string | undefined): Date | undefined {
  if (value === undefined) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid RFC 3339 datetime");
  }

  return date;
}
