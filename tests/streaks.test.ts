import { describe, expect, it } from 'vitest';

import { addDays, daysBetween, previousDay, toDayKey } from '../src/shared/day.js';
import { advance, projectStreaks, type UserRecord } from '../src/server/core/users.js';

const fresh = (): UserRecord => ({
  playStreak: 0,
  readStreak: 0,
  lastPlayedDay: '',
  totalPlayed: 0,
  totalHits: 0,
});

const on = (day: string, playStreak: number, readStreak: number): UserRecord => ({
  playStreak,
  readStreak,
  lastPlayedDay: day,
  totalPlayed: playStreak,
  totalHits: readStreak,
});

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

  it('is unaffected by daylight saving, because it never uses local time', () => {
    // The Sunday the UK springs forward. Still exactly one UTC day.
    expect(daysBetween('2026-03-28', '2026-03-29')).toBe(1);
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
  });

  it('steps back a day', () => {
    expect(previousDay('2026-01-01')).toBe('2025-12-31');
  });
});

describe('advancing a streak', () => {
  it('starts both counters at one on a first hit', () => {
    const next = advance(fresh(), true, '2026-04-01');
    expect(next.playStreak).toBe(1);
    expect(next.readStreak).toBe(1);
    expect(next.totalPlayed).toBe(1);
    expect(next.totalHits).toBe(1);
  });

  it('starts the play streak but not the read streak on a first miss', () => {
    const next = advance(fresh(), false, '2026-04-01');
    expect(next.playStreak).toBe(1);
    expect(next.readStreak).toBe(0);
  });

  it('extends both on consecutive days', () => {
    const next = advance(on('2026-04-01', 3, 3), true, '2026-04-02');
    expect(next.playStreak).toBe(4);
    expect(next.readStreak).toBe(4);
  });

  it('keeps the play streak but resets the read streak on a miss', () => {
    const next = advance(on('2026-04-01', 9, 9), false, '2026-04-02');
    expect(next.playStreak).toBe(10);
    expect(next.readStreak).toBe(0);
  });

  it('resets both after a missed day', () => {
    const next = advance(on('2026-04-01', 12, 12), true, '2026-04-03');
    expect(next.playStreak).toBe(1);
    expect(next.readStreak).toBe(1);
  });

  it('resets the play streak to one and the read streak to zero on a lapsed miss', () => {
    const next = advance(on('2026-04-01', 12, 12), false, '2026-04-05');
    expect(next.playStreak).toBe(1);
    expect(next.readStreak).toBe(0);
  });

  it('does nothing on a second play the same day', () => {
    const record = on('2026-04-02', 5, 5);
    expect(advance(record, true, '2026-04-02')).toBe(record);
    expect(advance(record, false, '2026-04-02')).toBe(record);
  });

  it('never rewinds when an older Daily is played after a newer one', () => {
    // Possible if a lock runs late and yesterday's post is still open. Answering
    // an extra question must not cost the player their streak.
    const record = on('2026-04-05', 9, 6);
    const next = advance(record, true, '2026-04-04');

    expect(next.lastPlayedDay).toBe('2026-04-05');
    expect(next.playStreak).toBe(9);
    expect(next.readStreak).toBe(6);
    expect(next.totalPlayed).toBe(record.totalPlayed + 1);
    expect(next.totalHits).toBe(record.totalHits + 1);
  });

  it('still counts a miss on an older Daily without resetting the read streak', () => {
    const next = advance(on('2026-04-05', 9, 6), false, '2026-04-03');
    expect(next.readStreak).toBe(6);
    expect(next.totalHits).toBe(6);
    expect(next.totalPlayed).toBe(10);
  });

  it('carries a read streak through a gap only by resetting it', () => {
    const day1 = advance(fresh(), true, '2026-04-01');
    const day2 = advance(day1, true, '2026-04-02');
    const day4 = advance(day2, true, '2026-04-04');
    expect(day2.readStreak).toBe(2);
    expect(day4.readStreak).toBe(1);
    expect(day4.totalHits).toBe(3);
  });
});

describe('projecting a streak for the header', () => {
  it('shows a live streak on the day it was set', () => {
    const view = projectStreaks(on('2026-04-02', 7, 7), '2026-04-02');
    expect(view.playStreak).toBe(7);
    expect(view.extendedToday).toBe(true);
  });

  it('still shows the streak the day after — today is not over', () => {
    const view = projectStreaks(on('2026-04-01', 7, 7), '2026-04-02');
    expect(view.playStreak).toBe(7);
    expect(view.extendedToday).toBe(false);
  });

  it('reports a lapsed streak as gone rather than as its stale value', () => {
    const view = projectStreaks(on('2026-04-01', 7, 7), '2026-04-05');
    expect(view.playStreak).toBe(0);
    expect(view.readStreak).toBe(0);
  });

  it('keeps the lifetime totals even once a streak lapses', () => {
    const view = projectStreaks(on('2026-04-01', 7, 4), '2026-04-05');
    expect(view.totalPlayed).toBe(7);
    expect(view.totalHits).toBe(4);
  });
});
