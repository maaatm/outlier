/**
 * Player records: the streak, the points, and the lifetime totals.
 *
 * The streak is the habit metric — consecutive UTC days on which the player
 * submitted at least one vote. Every question counts toward it: the Daily, an
 * open question somebody submitted, or one played out of the archive. Missing a
 * day resets it to zero. `bestStreak` remembers how far it got and is never
 * reduced, so a lapse costs the run without erasing the record of it.
 *
 * Points are per vote rather than per day, so a second question answered the
 * same day still pays even though the streak has already moved.
 *
 * `weekPoints` is the same points counted again inside the current ISO week,
 * for the weekly leaderboard. It is a field on the record rather than a
 * `zIncrBy` on the board because the board score carries a tiebreak fraction
 * that increments cannot be trusted to add up — see `shared/board.ts`.
 *
 * Day boundaries are UTC, matching the post schedule. Local time is never
 * consulted, on either side of the wire.
 */

import { context, redis, reddit } from '@devvit/web/server';

import { boardScore, daysSinceLaunch } from '../../shared/board.js';
import { WEEK_BOARD_TTL_SECONDS } from '../../shared/config.js';
import { daysBetween, fromDayKey, toDayKey, toWeekKey } from '../../shared/day.js';
import type { PlayerStats } from '../../shared/types.js';
import { keys } from './keys.js';

export type UserRecord = {
  streak: number;
  bestStreak: number;
  lastPlayedDay: string;
  points: number;
  totalPlayed: number;
  totalHits: number;
  /** Points banked inside `weekKey`. Reset, not carried, when the week turns. */
  weekPoints: number;
  /** `YYYY-Www` the weekly total belongs to. Empty on a record that predates it. */
  weekKey: string;
};

export const EMPTY_USER: UserRecord = {
  streak: 0,
  bestStreak: 0,
  lastPlayedDay: '',
  points: 0,
  totalPlayed: 0,
  totalHits: 0,
  weekPoints: 0,
  weekKey: '',
};

export async function getUser(userId: string): Promise<UserRecord> {
  const raw = await redis.hGetAll(keys.user(userId));
  if (!raw || Object.keys(raw).length === 0) return { ...EMPTY_USER };

  // `playStreak` is this field's old name, still on records written before
  // points existed. Read both, write only the new one.
  const streak = Number(raw.streak ?? raw.playStreak ?? 0) || 0;

  return {
    streak,
    // A record from before `bestStreak` existed still has a best: the run it is
    // on. Without the floor an old player's best would open at zero.
    bestStreak: Math.max(Number(raw.bestStreak ?? 0) || 0, streak),
    lastPlayedDay: raw.lastPlayedDay ?? '',
    points: Number(raw.points ?? 0) || 0,
    totalPlayed: Number(raw.totalPlayed ?? 0) || 0,
    totalHits: Number(raw.totalHits ?? 0) || 0,
    // A record written before the weekly board existed has no week on it. It
    // reads as a week that has since turned, so the next vote opens a fresh
    // one rather than back-dating a lifetime total into this week.
    weekPoints: Number(raw.weekPoints ?? 0) || 0,
    weekKey: raw.weekKey ?? '',
  };
}

/**
 * What the header shows before today's vote.
 *
 * A streak that has already lapsed is reported as zero rather than as its stale
 * value: if you last played three days ago, your streak is gone, and the header
 * should not keep advertising it until you play again. Yesterday still counts —
 * today is not over yet. `bestStreak` and `points` are banked and are never
 * projected away.
 */
export function projectStats(record: UserRecord, today: string = toDayKey()): PlayerStats {
  const lapsed = record.lastPlayedDay !== '' && daysBetween(record.lastPlayedDay, today) > 1;
  return {
    streak: lapsed ? 0 : record.streak,
    bestStreak: record.bestStreak,
    points: record.points,
    totalPlayed: record.totalPlayed,
    totalHits: record.totalHits,
    extendedToday: record.lastPlayedDay === today,
  };
}

/** What one vote did, as far as the record is concerned. */
export type Play = {
  /** `error <= HIT_THRESHOLD`. Feeds the read rate, not the streak. */
  hit: boolean;
  points: number;
};

/**
 * Fold one vote into a record. Pure, so both rules are testable without Redis.
 *
 * Two rules, deliberately different: points and the lifetime totals move on
 * every vote, and the streak moves once per day.
 */
export function advance(record: UserRecord, play: Play, today: string): UserRecord {
  // The week is derived from the day rather than passed in, so there is one
  // clock in this function and the weekly total cannot drift out of step with
  // the daily one.
  const weekKey = toWeekKey(fromDayKey(today));

  const banked = {
    points: record.points + play.points,
    totalPlayed: record.totalPlayed + 1,
    totalHits: record.totalHits + (play.hit ? 1 : 0),
    weekKey,
    // A new week starts at this vote, not at the total carried into it: the
    // weekly board is points banked *this week*, which is the whole reason it
    // bounds the archive.
    weekPoints: (record.weekKey === weekKey ? record.weekPoints : 0) + play.points,
  };

  // Already counted today. The second question of the day pays, but one day is
  // one day however many questions are in it.
  if (record.lastPlayedDay === today) return { ...record, ...banked };

  const gap = record.lastPlayedDay === '' ? Infinity : daysBetween(record.lastPlayedDay, today);

  // A vote dated before the last one counted. Only reachable through a clock
  // that went backwards, since the caller always passes today — but if it
  // happens it must not rewind `lastPlayedDay`, or the next real day would read
  // as a gap and destroy a live streak.
  if (gap < 0) return { ...record, ...banked };

  const streak = gap === 1 ? record.streak + 1 : 1;

  return {
    ...banked,
    streak,
    bestStreak: Math.max(record.bestStreak, streak),
    lastPlayedDay: today,
  };
}

/**
 * Record a vote against a player. Every vote calls this — the Daily, an open
 * question, or one played out of the archive, all on the day it was cast.
 *
 * This is the only place either leaderboard is written. It is already the one
 * function that knows the new totals, and a second writer would be a second
 * chance for a board to disagree with the record behind it.
 */
export async function recordPlay(
  userId: string,
  play: Play,
  today: string = toDayKey()
): Promise<PlayerStats> {
  const record = await getUser(userId);
  const next = advance(record, play, today);

  await redis.hSet(keys.user(userId), {
    streak: String(next.streak),
    bestStreak: String(next.bestStreak),
    lastPlayedDay: next.lastPlayedDay,
    points: String(next.points),
    totalPlayed: String(next.totalPlayed),
    totalHits: String(next.totalHits),
    weekPoints: String(next.weekPoints),
    weekKey: next.weekKey,
  });

  await writeBoards(userId, next, record.weekKey !== next.weekKey, today);
  await rememberName(userId);

  return {
    streak: next.streak,
    bestStreak: next.bestStreak,
    points: next.points,
    totalPlayed: next.totalPlayed,
    totalHits: next.totalHits,
    extendedToday: next.lastPlayedDay === today,
  };
}

/**
 * Put the new totals on both boards.
 *
 * Both are `zAdd` rather than `zIncrBy`, because the score is not the points —
 * it is the points with a tiebreak fraction under them, and an increment cannot
 * carry that fraction correctly. The record above is what the totals are read
 * off, so the boards are always set to a value rather than nudged toward one.
 *
 * `openedWeek` is this player's first vote of the week, which is necessarily
 * also the first write to a brand new week key by *somebody*. That is where the
 * TTL is set, so a closed week expires without a sweep job.
 */
async function writeBoards(
  userId: string,
  next: UserRecord,
  openedWeek: boolean,
  today: string
): Promise<void> {
  const age = daysSinceLaunch(today);
  const weekKey = keys.pointsWeek(next.weekKey);

  await redis.zAdd(weekKey, { member: userId, score: boardScore(next.weekPoints, age) });
  if (openedWeek) await redis.expire(weekKey, WEEK_BOARD_TTL_SECONDS);

  await redis.zAdd(keys.pointsAll, { member: userId, score: boardScore(next.points, age) });
}

/**
 * Once per player, forever. One extra `hGet` on the vote path buys one API call
 * in a player's entire lifetime.
 *
 * Reddit usernames change rarely and a stale name on a board is cosmetic, so
 * nothing here ever refreshes one. Deleted and suspended accounts are handled
 * lazily at render time instead — see the read path in `routes/api.ts`.
 */
async function rememberName(userId: string): Promise<void> {
  if (await redis.hGet(keys.names, userId)) return;

  // `context.username` is already there on a vote; the API call is the fallback
  // for the paths where it is not.
  const name = context.username ?? (await reddit.getCurrentUsername());
  if (name) await redis.hSet(keys.names, { [userId]: name });
}
