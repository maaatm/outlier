/**
 * The coin ledger, where it touches Redis.
 *
 * The rules themselves are pure and live in `shared/coins.ts`; this is the part
 * that reads and writes `user:{userId}`. Two of the four ways to earn are here —
 * posting a question and having one promoted — because neither of them is a
 * vote and so neither passes through `recordPlay`.
 *
 * Everything credits with `hIncrBy`. A balance is the one number in this app
 * that two requests can move at once — a vote paying the daily award while a box
 * is being opened — and an increment is the only way to add to it without
 * reading a total that may be stale by the time it is written back.
 *
 * `points` is never read or written here, or anywhere else in the economy.
 */

import { redis } from '@devvit/web/server';

import { submissionAward } from '../../shared/coins.js';
import { toDayKey } from '../../shared/day.js';
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

  if (award.coins > 0) await creditCoins(userId, award.coins);
  return award.coins;
}
