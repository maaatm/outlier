/**
 * Player records and the two streaks.
 *
 * `playStreak` is the habit metric: consecutive days with a Daily submission.
 * `readStreak` is the brag metric: consecutive Dailies read to within the hit
 * threshold. Both reset on a missed day.
 *
 * Day boundaries are UTC, matching the post schedule. Local time is never
 * consulted, on either side of the wire.
 */

import { redis } from '@devvit/web/server';

import { daysBetween, toDayKey } from '../../shared/day.js';
import type { Streaks } from '../../shared/types.js';
import { keys } from './keys.js';

export type UserRecord = {
  playStreak: number;
  readStreak: number;
  lastPlayedDay: string;
  totalPlayed: number;
  totalHits: number;
};

const EMPTY: UserRecord = {
  playStreak: 0,
  readStreak: 0,
  lastPlayedDay: '',
  totalPlayed: 0,
  totalHits: 0,
};

export async function getUser(userId: string): Promise<UserRecord> {
  const raw = await redis.hGetAll(keys.user(userId));
  if (!raw || Object.keys(raw).length === 0) return { ...EMPTY };
  return {
    playStreak: Number(raw.playStreak ?? 0) || 0,
    readStreak: Number(raw.readStreak ?? 0) || 0,
    lastPlayedDay: raw.lastPlayedDay ?? '',
    totalPlayed: Number(raw.totalPlayed ?? 0) || 0,
    totalHits: Number(raw.totalHits ?? 0) || 0,
  };
}

/**
 * What the header shows before today's vote.
 *
 * A streak that has already lapsed is reported as zero rather than as its stale
 * value: if you last played three days ago, your streak is gone, and the header
 * should not keep advertising it until you play again. Yesterday still counts —
 * today is not over yet.
 */
export function projectStreaks(record: UserRecord, today: string = toDayKey()): Streaks {
  const lapsed =
    record.lastPlayedDay !== '' && daysBetween(record.lastPlayedDay, today) > 1;
  return {
    playStreak: lapsed ? 0 : record.playStreak,
    readStreak: lapsed ? 0 : record.readStreak,
    totalPlayed: record.totalPlayed,
    totalHits: record.totalHits,
    extendedToday: record.lastPlayedDay === today,
  };
}

/**
 * Advance the streaks for a Daily submission. Pure, so the rule is testable
 * without Redis.
 */
export function advance(record: UserRecord, hit: boolean, today: string): UserRecord {
  // Already counted today. Nothing moves — one Daily is one day.
  if (record.lastPlayedDay === today) return record;

  const gap = record.lastPlayedDay === '' ? Infinity : daysBetween(record.lastPlayedDay, today);

  // An older Daily played after a newer one — possible if a lock is late and
  // yesterday's post is still open. It counts toward the totals, but it must not
  // rewind `lastPlayedDay`, or answering an extra question would destroy a
  // streak instead of adding to it.
  if (gap < 0) {
    return {
      ...record,
      totalPlayed: record.totalPlayed + 1,
      totalHits: record.totalHits + (hit ? 1 : 0),
    };
  }

  const consecutive = gap === 1;

  return {
    playStreak: consecutive ? record.playStreak + 1 : 1,
    readStreak: hit ? (consecutive ? record.readStreak : 0) + 1 : 0,
    lastPlayedDay: today,
    totalPlayed: record.totalPlayed + 1,
    totalHits: record.totalHits + (hit ? 1 : 0),
  };
}

/** Only Dailies move the streaks. Open questions never call this. */
export async function recordDailyPlay(
  userId: string,
  hit: boolean,
  today: string = toDayKey()
): Promise<Streaks> {
  const current = await getUser(userId);
  const next = advance(current, hit, today);

  if (next !== current) {
    await redis.hSet(keys.user(userId), {
      playStreak: String(next.playStreak),
      readStreak: String(next.readStreak),
      lastPlayedDay: next.lastPlayedDay,
      totalPlayed: String(next.totalPlayed),
      totalHits: String(next.totalHits),
    });
  }

  return {
    playStreak: next.playStreak,
    readStreak: next.readStreak,
    totalPlayed: next.totalPlayed,
    totalHits: next.totalHits,
    extendedToday: true,
  };
}
