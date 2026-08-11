/**
 * Day boundaries are UTC everywhere, matching the post schedule. Local time
 * would make "did I miss a day?" ambiguous for anyone not on UTC, so it is
 * never used — not on the client either.
 */

/** `YYYY-MM-DD` in UTC. */
export type DayKey = string;

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
