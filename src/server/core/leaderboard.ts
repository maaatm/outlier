/**
 * The player leaderboard: who has banked the most points, this week or ever.
 *
 * Both boards are plain zsets of `userId -> boardScore`, written by `recordPlay`
 * and read here. Nothing is cached: a page is a range read, one name lookup and
 * a rank, which is cheap enough to serve on every menu open.
 *
 * Deleted and suspended accounts are handled where they surface rather than by a
 * sweep job — a member whose name is missing from `users:names` *and* whose
 * account no longer resolves is dropped from the board on the read that found
 * it. The board is small and the miss is rare, so the cost falls on nobody.
 */

import { reddit, redis } from '@devvit/web/server';
import type { T2 } from '@devvit/web/shared';

import { boardPoints } from '../../shared/board.js';
import { PLAYER_BOARD_SIZE } from '../../shared/config.js';
import { toWeekKey } from '../../shared/day.js';
import type { BoardRange, PlayerBoardEntry, PlayerBoardResponse } from '../../shared/types.js';
import { keys } from './keys.js';

/** The zset a range reads from. The weekly key is derived, never stored. */
export function boardKey(range: BoardRange): string {
  return range === 'all' ? keys.pointsAll : keys.pointsWeek(toWeekKey());
}

/**
 * A page of the board, plus where the viewer stands on it.
 *
 * `you` is what makes the board worth reopening for everyone outside the top
 * ten: a board you are absent from is a board you stop looking at.
 */
export async function readPlayerBoard(
  range: BoardRange,
  userId?: string
): Promise<PlayerBoardResponse> {
  const key = boardKey(range);

  const ranked = await redis.zRange(key, 0, PLAYER_BOARD_SIZE - 1, {
    by: 'rank',
    reverse: true,
  });

  return {
    range,
    rows: await namedRows(key, ranked),
    you: userId ? await standing(key, userId) : null,
  };
}

/** Attach a username to each member, dropping the ones that no longer exist. */
async function namedRows(
  key: string,
  ranked: { member: string; score: number }[]
): Promise<PlayerBoardEntry[]> {
  if (ranked.length === 0) return [];

  const names = await redis.hMGet(
    keys.names,
    ranked.map((entry) => entry.member)
  );

  const rows: PlayerBoardEntry[] = [];
  for (const [index, entry] of ranked.entries()) {
    const name = names[index] ?? (await resolveName(key, entry.member));
    if (!name) continue;

    // Numbered by position in what survived, so a dropped member does not
    // leave a hole in the ranks — the next read would not have had one.
    rows.push({
      rank: rows.length + 1,
      userId: entry.member,
      name,
      points: boardPoints(entry.score),
    });
  }

  return rows;
}

/**
 * The name behind a member the hash has never seen.
 *
 * Reachable two ways: a player who banked points before names were stored, and
 * an account that has since gone. The first is worth one API call and a
 * backfill; the second is what the `zRem` is for.
 */
async function resolveName(key: string, userId: string): Promise<string> {
  const user = await reddit.getUserById(userId as T2).catch(() => undefined);

  if (!user) {
    await redis.zRem(key, [userId]);
    return '';
  }

  await redis.hSet(keys.names, { [userId]: user.username });
  return user.username;
}

/**
 * Where one player sits on the board.
 *
 * `zRank` counts from the bottom, so the rank a reader recognises is the card
 * minus it. That single lookup is only unambiguous because the tiebreak is
 * folded into the score — with tied scores there would be no way to tell how
 * many of the players level with you sit above you, and Devvit's Redis has no
 * `zCount` to ask with.
 */
async function standing(
  key: string,
  userId: string
): Promise<{ rank: number; points: number } | null> {
  const rank = await redis.zRank(key, userId);
  if (rank === undefined) return null;

  const score = await redis.zScore(key, userId);
  if (score === undefined) return null;

  return { rank: (await redis.zCard(key)) - rank, points: boardPoints(score) };
}
