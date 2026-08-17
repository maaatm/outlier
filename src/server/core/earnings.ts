/**
 * The earnings ledger, where it touches Redis.
 *
 * One zset per player holding their last `EARNINGS_LOG_SIZE` coin events, and
 * two counters on the user hash that answer "has anything arrived since you last
 * looked". The rules and the copy are pure and live in `shared/earnings.ts`.
 *
 * This is deliberately not the thing that pays. `creditCoins` moves the balance
 * and this records why, which means a payment that succeeds and a log line that
 * fails costs a receipt rather than the coins — the right way round — and it
 * means the ledger can be added to a path without that path learning anything
 * about zsets.
 */

import { redis } from '@devvit/web/server';

import { EARNINGS_LOG_SIZE } from '../../shared/config.js';
import { type Earning, type EarnReason, decodeEarning, encodeEarning } from '../../shared/earnings.js';
import { keys, userFields } from './keys.js';

/**
 * Record one coin event.
 *
 * `earnSeq` is bumped in the same breath, because the marker on the menu is
 * "something arrived since you last looked" and this is where something
 * arrives.
 */
export async function logEarning(
  userId: string,
  reason: EarnReason,
  coins: number,
  detail = 0
): Promise<void> {
  // Nobody to bill it to. A house question taking the Daily slot has no author,
  // and that is a normal Tuesday rather than something to throw over — the same
  // answer `creditCoins` gives to the same question.
  if (!userId) return;

  const key = keys.earnings(userId);
  const at = Date.now();

  await redis.zAdd(key, { member: encodeEarning({ reason, coins, at, detail }), score: at });
  // Trim after the add, never beside it — racing them can leave the window one
  // entry over the cap. The same reasoning as `rememberVoter`.
  await redis.zRemRangeByRank(key, 0, -(EARNINGS_LOG_SIZE + 1));
  await redis.hIncrBy(keys.user(userId), userFields.earnSeq, 1);
}

/**
 * The ledger, newest first.
 *
 * Undecodable entries are dropped rather than thrown over: one row written by a
 * format that has since changed must not cost the player the other seven.
 */
export async function readEarnings(userId: string): Promise<Earning[]> {
  // Reversed by rank, so the newest is row one — the same read `topPending` in
  // `queue.ts` makes, and the order the screen wants without a sort here.
  const raw = await redis.zRange(keys.earnings(userId), 0, EARNINGS_LOG_SIZE - 1, {
    by: 'rank',
    reverse: true,
  });

  const entries: Earning[] = [];
  for (const { member } of raw) {
    const earning = decodeEarning(member);
    if (earning) entries.push(earning);
  }
  return entries;
}

/**
 * Called when the ledger is rendered. Reading it is what "seen" means.
 *
 * `earnSeen` is set to whatever `earnSeq` says right now rather than
 * incremented, so an earning that lands mid-render is either counted as seen or
 * still marked — never double counted, and never able to leave the dot lit
 * forever.
 */
export async function markEarningsSeen(userId: string): Promise<void> {
  const key = keys.user(userId);
  const seq = Number(await redis.hGet(key, userFields.earnSeq)) || 0;
  await redis.hSet(key, { [userFields.earnSeen]: String(seq) });
}
