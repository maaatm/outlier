/**
 * The coin rules, on the pure side of the seam.
 *
 * Coins are the spendable balance and `points` is the score. Nothing in this
 * file — or in anything that calls it — reads or returns a point. The two
 * ledgers share the `user:{userId}` hash and nothing else: crediting coins is
 * another field on an `hSet` that was already going out, not a second key and a
 * second round trip.
 *
 * The rates themselves live in `config.ts` with the other tunables, the same way
 * the accuracy bands in `points.ts` do. What is here is when they apply.
 */

import {
  BOX_PRICE,
  COINS_FIRST_VOTE,
  COINS_STREAK_BONUS,
  COIN_ELIGIBLE_SUBMISSIONS_PER_DAY,
  COINS_SUBMISSION,
  DUPLICATE_REFUND_FRACTION,
  STREAK_BONUS_EVERY,
} from './config.js';

/**
 * What the day's first vote pays, given the streak it just moved to.
 *
 * The bonus is keyed on the *new* streak value, so it pays on the day the
 * streak reaches seven rather than the day after, and a streak that reset to 1
 * starts counting toward the next one from there.
 */
export function coinsForNewDay(streak: number): number {
  const bonus = streak > 0 && streak % STREAK_BONUS_EVERY === 0 ? COINS_STREAK_BONUS : 0;
  return COINS_FIRST_VOTE + bonus;
}

/** The submission counter as it stands on the user hash, and what it pays. */
export type SubmissionAward = {
  /** The UTC day `subCount` belongs to. */
  subDay: string;
  /** Submissions made on `subDay`, including this one. */
  subCount: number;
  coins: number;
};

/**
 * Fold one submission into the day's count.
 *
 * The count exists only to bound the *reward*. Submission is uncapped, and this
 * never refuses one — a flood costs the farmer nothing but earns them nothing
 * either, past the limit. `limit` is a defaulted parameter rather than a
 * constant read inside, which is what makes turning the valve on a one-line
 * change to `config.ts` instead of a change to this function.
 *
 * The day turning over resets the count rather than carrying it, the same way
 * `weekKey`/`weekPoints` handle a new week in `users.ts`.
 */
export function submissionAward(
  subDay: string,
  subCount: number,
  today: string,
  limit: number = COIN_ELIGIBLE_SUBMISSIONS_PER_DAY
): SubmissionAward {
  const count = (subDay === today ? subCount : 0) + 1;
  return {
    subDay: today,
    subCount: count,
    coins: count <= limit ? COINS_SUBMISSION : 0,
  };
}

/** What a duplicate pays back. Rounded, because coins are whole things. */
export function duplicateRefund(price: number = BOX_PRICE): number {
  return Math.round(price * DUPLICATE_REFUND_FRACTION);
}
