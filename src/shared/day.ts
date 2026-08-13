/**
 * Day boundaries are UTC everywhere, matching the post schedule. Local time
 * would make "did I miss a day?" ambiguous for anyone not on UTC, so it is
 * never used — not on the client either.
 */

/** `YYYY-MM-DD` in UTC. */
export type DayKey = string;

/** `YYYY-Www` in UTC, ISO-8601. The week a board is keyed by. */
export type WeekKey = string;

export function toDayKey(date: Date = new Date()): DayKey {
  return date.toISOString().slice(0, 10);
}

export function fromDayKey(day: DayKey): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** Whole days from `a` to `b`. Negative when `b` is earlier. */
export function daysBetween(a: DayKey, b: DayKey): number {
  const ms = fromDayKey(b).getTime() - fromDayKey(a).getTime();
  return Math.round(ms / 86_400_000);
}

export function addDays(day: DayKey, delta: number): DayKey {
  return toDayKey(new Date(fromDayKey(day).getTime() + delta * 86_400_000));
}

export function previousDay(day: DayKey = toDayKey()): DayKey {
  return addDays(day, -1);
}

export function isDayKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(fromDayKey(value).getTime());
}

/**
 * `YYYY-Www` in UTC, the same way `toDayKey` is UTC.
 *
 * ISO-8601: weeks run Monday to Sunday, and a week belongs to the year that its
 * Thursday falls in. So the year in the key is not always the year of the date
 * handed in — 1 January 2021 was a Friday and belongs to `2020-W53`, and 30
 * December 2019 was a Monday and belongs to `2020-W01`. Both directions are
 * tested, because a board keyed by the wrong year would silently split one week
 * across two keys.
 */
export function toWeekKey(date: Date = new Date()): WeekKey {
  // The Thursday of this date's week. Everything else is read off it, which is
  // what makes the year come out right at both ends of a January.
  const thursday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  thursday.setUTCDate(thursday.getUTCDate() - mondayIndex(thursday) + 3);

  // 4 January is in week 1 by definition, so the Thursday of its week is the
  // Thursday of week 1 — and week numbers are whole weeks out from there.
  const year = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - mondayIndex(firstThursday) + 3);

  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Day of the week with Monday as 0, which is the week ISO-8601 counts. */
function mondayIndex(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}
