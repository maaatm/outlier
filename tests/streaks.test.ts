import { afterEach, describe, expect, it } from 'vitest';

import { addDays, daysBetween, previousDay, toDayKey } from '../src/shared/day.js';
import { advance, projectStats, type Play, type UserRecord } from '../src/server/core/users.js';

/** A vote worth the base rate and nothing else, for tests that are about days. */
const play: Play = { hit: false, points: 10 };
const hit: Play = { hit: true, points: 60 };

const fresh = (): UserRecord => ({
  streak: 0,
  bestStreak: 0,
  lastPlayedDay: '',
  points: 0,
  totalPlayed: 0,
  totalHits: 0,
});

const on = (day: string, streak: number, bestStreak: number = streak): UserRecord => ({
  streak,
  bestStreak,
  lastPlayedDay: day,
  points: 100,
  totalPlayed: streak,
  totalHits: 0,
});

/** Answer one question a day, starting from nothing. */
const run = (days: string[], record: UserRecord = fresh()): UserRecord =>
  days.reduce((acc, day) => advance(acc, play, day), record);

describe('UTC day keys', () => {
  it('formats as YYYY-MM-DD in UTC regardless of the local clock', () => {
    // 23:30 UTC on the 1st is still the 1st, even where it is already the 2nd.
    expect(toDayKey(new Date('2026-03-01T23:30:00Z'))).toBe('2026-03-01');
    expect(toDayKey(new Date('2026-03-02T00:30:00Z'))).toBe('2026-03-02');
  });

  it('counts whole days across month and year boundaries', () => {
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
    expect(daysBetween('2026-01-05', '2026-01-01')).toBe(-4);
  });

  it('steps back a day', () => {
    expect(previousDay('2026-01-01')).toBe('2025-12-31');
  });
});

/*
 * The day key is UTC by construction — `toISOString` cannot be anything else —
 * so these do not catch a bug in the code as written. They exist because the
 * obvious refactor is to reach for `getFullYear()/getMonth()/getDate()`, and
 * every one of these assertions flips the moment somebody does. Node re-reads
 * `process.env.TZ` on each Date operation, so setting it here really does move
 * the local clock.
 */
describe('timezone boundaries', () => {
  const original = process.env.TZ;
  afterEach(() => {
    process.env.TZ = original;
  });

  it('keys the UTC day east of the line, where the local date has run ahead', () => {
    // Kiritimati is UTC+14: 11:00 UTC on the 1st is already 01:00 on the 2nd there.
    process.env.TZ = 'Pacific/Kiritimati';
    const instant = new Date('2026-04-01T11:00:00Z');
    expect(instant.getDate()).toBe(2); // the local clock says the 2nd
    expect(toDayKey(instant)).toBe('2026-04-01'); // the streak says the 1st
  });

  it('keys the UTC day west of the line, where the local date lags behind', () => {
    // Niue is UTC-11: 02:00 UTC on the 2nd is still 15:00 on the 1st there.
    process.env.TZ = 'Pacific/Niue';
    const instant = new Date('2026-04-02T02:00:00Z');
    expect(instant.getDate()).toBe(1);
    expect(toDayKey(instant)).toBe('2026-04-02');
  });

  it('does not let a local midnight count as a second day', () => {
    process.env.TZ = 'Pacific/Kiritimati';
    // Two votes three hours apart. They straddle local midnight but not UTC
    // midnight, so they are one day and the streak moves once.
    const before = toDayKey(new Date('2026-04-01T09:00:00Z')); // 23:00 local, 1st
    const after = toDayKey(new Date('2026-04-01T12:00:00Z')); // 02:00 local, 2nd
    expect(before).toBe(after);

    const first = advance(on('2026-03-31', 4), play, before);
    const second = advance(first, play, after);
    expect(first.streak).toBe(5);
    expect(second.streak).toBe(5);
    expect(second.totalPlayed).toBe(first.totalPlayed + 1);
  });

  it('does not let a local midnight break a run of UTC days', () => {
    process.env.TZ = 'Pacific/Niue';
    // Consecutive UTC days that all fall on the same local date until 13:00.
    const record = run([
      toDayKey(new Date('2026-04-01T02:00:00Z')),
      toDayKey(new Date('2026-04-02T02:00:00Z')),
      toDayKey(new Date('2026-04-03T02:00:00Z')),
    ]);
    expect(record.streak).toBe(3);
  });

  it('measures the gap in UTC days, wherever the record was written', () => {
    process.env.TZ = 'Asia/Kathmandu'; // UTC+05:45, an offset that is not a whole hour
    expect(daysBetween('2026-04-01', '2026-04-02')).toBe(1);
    expect(addDays('2026-04-01', 1)).toBe('2026-04-02');
    expect(advance(on('2026-04-01', 6), play, '2026-04-02').streak).toBe(7);
  });
});

/*
 * The transitions that break naive local-time day math. In 2026: the US springs
 * forward on 8 March and falls back on 1 November; the EU springs forward on
 * 29 March and falls back on 25 October.
 */
describe('daylight saving', () => {
  const original = process.env.TZ;
  afterEach(() => {
    process.env.TZ = original;
  });

  it('counts the 23-hour local day as one day', () => {
    process.env.TZ = 'America/New_York';
    expect(daysBetween('2026-03-07', '2026-03-08')).toBe(1);
    expect(daysBetween('2026-03-08', '2026-03-09')).toBe(1);
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
  });

  it('counts the 25-hour local day as one day', () => {
    process.env.TZ = 'America/New_York';
    expect(daysBetween('2026-10-31', '2026-11-01')).toBe(1);
    expect(daysBetween('2026-11-01', '2026-11-02')).toBe(1);
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
  });

  it('keeps a streak alive across the spring-forward night', () => {
    process.env.TZ = 'America/New_York';
    const record = run(['2026-03-07', '2026-03-08', '2026-03-09'], on('2026-03-06', 10));
    expect(record.streak).toBe(13);
  });

  it('keeps a streak alive across the fall-back night', () => {
    process.env.TZ = 'America/New_York';
    const record = run(['2026-10-31', '2026-11-01', '2026-11-02'], on('2026-10-30', 10));
    expect(record.streak).toBe(13);
  });

  it('does not gain or lose a day on the European transitions either', () => {
    process.env.TZ = 'Europe/London';
    expect(daysBetween('2026-03-28', '2026-03-29')).toBe(1);
    expect(daysBetween('2026-10-24', '2026-10-25')).toBe(1);
    expect(run(['2026-03-28', '2026-03-29']).streak).toBe(2);
    expect(run(['2026-10-24', '2026-10-25']).streak).toBe(2);
  });

  it('still ends a streak that skipped the transition day', () => {
    // The hour the clocks move is not a grace period for a missed day.
    process.env.TZ = 'America/New_York';
    const record = advance(on('2026-03-07', 12), play, '2026-03-09');
    expect(record.streak).toBe(1);
    expect(record.bestStreak).toBe(12);
  });
});

describe('advancing a streak', () => {
  it('starts at one on a first vote', () => {
    const next = advance(fresh(), play, '2026-04-01');
    expect(next.streak).toBe(1);
    expect(next.bestStreak).toBe(1);
    expect(next.lastPlayedDay).toBe('2026-04-01');
    expect(next.totalPlayed).toBe(1);
  });

  it('extends on consecutive days', () => {
    expect(run(['2026-04-01', '2026-04-02', '2026-04-03']).streak).toBe(3);
  });

  it('extends across a month boundary', () => {
    expect(run(['2026-04-29', '2026-04-30', '2026-05-01']).streak).toBe(3);
  });

  it('extends across a year boundary', () => {
    expect(run(['2025-12-30', '2025-12-31', '2026-01-01']).streak).toBe(3);
  });

  it('extends across a leap day', () => {
    expect(run(['2028-02-28', '2028-02-29', '2028-03-01']).streak).toBe(3);
  });

  it('resets to one after a single missed day', () => {
    const next = advance(on('2026-04-01', 12), play, '2026-04-03');
    expect(next.streak).toBe(1);
  });

  it('keeps the best streak through a missed day', () => {
    const next = advance(on('2026-04-01', 12), play, '2026-04-03');
    expect(next.bestStreak).toBe(12);
  });

  it('keeps the best streak through a long absence', () => {
    const next = advance(on('2026-04-01', 30), play, '2026-09-14');
    expect(next.streak).toBe(1);
    expect(next.bestStreak).toBe(30);
  });

  it('raises the best streak only once the current one passes it', () => {
    const record = run(['2026-04-10', '2026-04-11'], on('2026-04-09', 1, 7));
    expect(record.streak).toBe(3);
    expect(record.bestStreak).toBe(7);

    const later = run(['2026-04-12', '2026-04-13', '2026-04-14', '2026-04-15'], record);
    expect(later.streak).toBe(7);
    expect(later.bestStreak).toBe(7);

    const beyond = advance(later, play, '2026-04-16');
    expect(beyond.streak).toBe(8);
    expect(beyond.bestStreak).toBe(8);
  });

  it('leaves the streak alone on a second question the same day', () => {
    const first = advance(on('2026-04-01', 4), play, '2026-04-02');
    const second = advance(first, play, '2026-04-02');
    expect(first.streak).toBe(5);
    expect(second.streak).toBe(5);
    expect(second.lastPlayedDay).toBe('2026-04-02');
  });

  it('never rewinds when an older question is played after a newer one', () => {
    // Possible from the archive, or if a lock runs late and yesterday's post is
    // still open. Answering an extra question must not cost a streak.
    const record = on('2026-04-05', 9);
    const next = advance(record, play, '2026-04-04');

    expect(next.lastPlayedDay).toBe('2026-04-05');
    expect(next.streak).toBe(9);
    expect(next.totalPlayed).toBe(record.totalPlayed + 1);
  });
});

describe('points and totals', () => {
  it('pays every vote, including the second one in a day', () => {
    const first = advance(fresh(), hit, '2026-04-01');
    const second = advance(first, play, '2026-04-01');
    expect(first.points).toBe(60);
    expect(second.points).toBe(70);
    expect(second.totalPlayed).toBe(2);
  });

  it('pays a vote that reset the streak just the same', () => {
    const next = advance(on('2026-04-01', 12), hit, '2026-04-09');
    expect(next.streak).toBe(1);
    expect(next.points).toBe(160);
  });

  it('pays a back-dated vote without moving the day', () => {
    const next = advance(on('2026-04-05', 9), hit, '2026-04-03');
    expect(next.points).toBe(160);
    expect(next.totalHits).toBe(1);
    expect(next.lastPlayedDay).toBe('2026-04-05');
  });

  it('counts hits separately from days played', () => {
    let record = advance(fresh(), hit, '2026-04-01');
    record = advance(record, play, '2026-04-02');
    record = advance(record, hit, '2026-04-02');
    expect(record.totalPlayed).toBe(3);
    expect(record.totalHits).toBe(2);
    expect(record.streak).toBe(2);
  });
});

describe('projecting stats for the header', () => {
  it('shows a live streak on the day it was set', () => {
    const view = projectStats(on('2026-04-02', 7), '2026-04-02');
    expect(view.streak).toBe(7);
    expect(view.extendedToday).toBe(true);
  });

  it('still shows the streak the day after — today is not over', () => {
    const view = projectStats(on('2026-04-01', 7), '2026-04-02');
    expect(view.streak).toBe(7);
    expect(view.extendedToday).toBe(false);
  });

  it('reports a lapsed streak as gone rather than as its stale value', () => {
    const view = projectStats(on('2026-04-01', 7), '2026-04-05');
    expect(view.streak).toBe(0);
    expect(view.extendedToday).toBe(false);
  });

  it('keeps the best streak and the points once a streak lapses', () => {
    const view = projectStats(on('2026-04-01', 7), '2026-04-05');
    expect(view.bestStreak).toBe(7);
    expect(view.points).toBe(100);
  });

  it('shows nothing for a player who has never voted', () => {
    const view = projectStats(fresh(), '2026-04-05');
    expect(view.streak).toBe(0);
    expect(view.bestStreak).toBe(0);
    expect(view.extendedToday).toBe(false);
  });
});
