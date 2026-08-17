/**
 * The coin ledger, where it touches Redis.
 *
 * The rules themselves are pure and live in `shared/coins.ts`; this is the part
 * that reads and writes `user:{userId}`. `creditCoins` is the one writer every
 * earn goes through, and one of the earns is here — posting a question — because
 * it is not a vote and so does not pass through `recordPlay`.
 *
 * Everything credits with `hIncrBy`. A balance is the one number in this app
 * that two requests can move at once — a vote paying the daily award while a box
 * is being opened — and an increment is the only way to add to it without
 * reading a total that may be stale by the time it is written back.
 *
 * `points` is never read or written here, or anywhere else in the economy.
 */

import { reddit, redis } from '@devvit/web/server';

import { submissionAward } from '../../shared/coins.js';
import { toDayKey } from '../../shared/day.js';
import { logEarning } from './earnings.js';
import { keys, userFields } from './keys.js';

export async function readCoins(userId: string): Promise<number> {
  return Number(await redis.hGet(keys.user(userId), userFields.coins)) || 0;
}

/**
 * Add to a balance. Returns the balance afterwards.
 *
 * Paying nobody is not an error and not a write. A house question taking the
 * Daily slot has no author to credit, which is a normal Tuesday rather than
 * something to throw over — and an empty id must not become a read of `user:`,
 * a key belonging to nobody.
 */
export async function creditCoins(userId: string, amount: number): Promise<number> {
  if (!userId) return 0;
  if (amount <= 0) return readCoins(userId);
  return redis.hIncrBy(keys.user(userId), userFields.coins, amount);
}

export type GrantOutcome =
  | { status: 'granted'; userId: string; username: string; coins: number }
  | { status: 'unknown'; username: string };

/**
 * Put coins in somebody's account by name. Moderators only — see the route.
 *
 * A testing and moderation affordance rather than part of the economy: the four
 * ways to earn are the economy, and this is the way to stand up a balance
 * without playing for a fortnight to get one. It is deliberately the only path
 * that creates coins out of nothing, and it is deliberately not reachable by a
 * player.
 *
 * The username has to be resolved to a `t2_` id, because a display name is not
 * an identity and every key in this app is keyed by id. A name Reddit does not
 * know is reported back rather than thrown: a typo in a form field is a typo,
 * not a server error.
 *
 * Granting to somebody who has never played writes a `user:` hash holding only a
 * balance. That is a valid record — `getUser` fills the rest with zeros — and it
 * puts them on no leaderboard, because the boards are written from points.
 */
export async function grantCoins(username: string, amount: number): Promise<GrantOutcome> {
  const name = username.trim().replace(/^\/?u\//i, '');

  const user = await reddit.getUserByUsername(name).catch(() => undefined);
  if (!user) return { status: 'unknown', username: name };

  return {
    status: 'granted',
    userId: user.id,
    username: user.username,
    coins: await creditCoins(user.id, amount),
  };
}

/**
 * Pay for a submission, if this one is still eligible.
 *
 * The count is tracked per UTC day on the same hash, the way `weekKey` and
 * `weekPoints` track the week — the day turning over resets it rather than
 * carrying it. Submission itself is uncapped and this never refuses one; the cap
 * is on the *reward*, and it is off by default.
 *
 * Read-then-write on the counter, which is not atomic: two submissions racing
 * each other could both read the same count and both pay. That is a coin, once,
 * in the rare case where a player fires two questions at the same instant — and
 * making it atomic would cost every submission a transaction to defend a limit
 * that is `Infinity` by default.
 */
export async function awardSubmissionCoins(
  userId: string,
  today: string = toDayKey()
): Promise<number> {
  const raw = await redis.hMGet(keys.user(userId), [userFields.subDay, userFields.subCount]);
  const award = submissionAward(raw[0] ?? '', Number(raw[1] ?? 0) || 0, today);

  await redis.hSet(keys.user(userId), {
    [userFields.subDay]: award.subDay,
    [userFields.subCount]: String(award.subCount),
  });

  if (award.coins > 0) {
    await creditCoins(userId, award.coins);
    await logEarning(userId, 'submission', award.coins);
  }
  return award.coins;
}
