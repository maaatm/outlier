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
  COINS_PER_COMMENT_UPVOTE,
  COINS_STREAK_BONUS,
  COIN_ELIGIBLE_SUBMISSIONS_PER_DAY,
  COINS_SUBMISSION,
  COMMENT_UPVOTE_COIN_CAP,
  DUPLICATE_REFUND_FRACTION,
  ROYALTY_COIN_CAP,
  ROYALTY_VOTES_PER_COIN,
  STREAK_BONUS_EVERY,
} from './config.js';

/** What the day's first vote paid, split by what paid it. */
export type DayAward = {
  /** Turning up. Paid on every day's first vote. */
  daily: number;
  /** The seventh-day bonus, or zero. */
  streak: number;
};

/**
 * What the day's first vote pays, given the streak it just moved to.
 *
 * The bonus is keyed on the *new* streak value, so it pays on the day the
 * streak reaches seven rather than the day after, and a streak that reset to 1
 * starts counting toward the next one from there.
 *
 * The two halves are reported apart rather than summed, because the ledger says
 * where a coin came from and "turned up today" and "7 days in a row" are two
 * different answers. Callers that only want the balance add them.
 */
export function coinsForNewDay(streak: number): DayAward {
  const bonus = streak > 0 && streak % STREAK_BONUS_EVERY === 0 ? COINS_STREAK_BONUS : 0;
  return { daily: COINS_FIRST_VOTE, streak: bonus };
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

/**
 * What a comment's upvotes owe, in total, given its current score.
 *
 * Reddit scores a comment 1 on submission — that is the author's own automatic
 * upvote and is not an endorsement by anybody. Subtracting it is what makes
 * "+3" mean three people rather than two people and yourself.
 *
 * Total owed rather than an increment, so the caller pays the difference from
 * the watermark. The clamp at zero matters: a comment that is downvoted below
 * its own upvote owes nothing, and nothing is ever taken back.
 */
export function commentUpvoteOwed(score: number): number {
  const upvotes = Math.max(0, score - 1);
  return Math.min(upvotes * COINS_PER_COMMENT_UPVOTE, COMMENT_UPVOTE_COIN_CAP);
}

/** What is still to pay, given what has been. Never negative. */
export function commentUpvoteDue(score: number, paid: number): number {
  return Math.max(0, commentUpvoteOwed(score) - paid);
}

/** A comment at the ceiling stops being worth an API call. */
export function commentIsSettled(paid: number): boolean {
  return paid >= COMMENT_UPVOTE_COIN_CAP;
}

/**
 * What the vote that took a question to `voteCount` answers owes its author.
 *
 * Keyed on the count *this vote produced* rather than on a running total, which
 * is what removes the need for a watermark: `hIncrBy` hands back a different
 * number to every vote, so exactly one vote in the app's history ever observes
 * each multiple of a hundred. No second key, no read-then-write, and no way for
 * two votes landing together to both pay the same coin.
 */
export function royaltyFor(voteCount: number): number {
  // `0 % 100 === 0` is the same trap `coinsForNewDay` guards at zero. No vote
  // ever produces a count of nothing, and a rule that paid for one would be a
  // coin conjured by a question nobody has answered.
  if (voteCount <= 0) return 0;
  if (voteCount % ROYALTY_VOTES_PER_COIN !== 0) return 0;
  if (voteCount > ROYALTY_VOTES_PER_COIN * ROYALTY_COIN_CAP) return 0;
  return 1;
}
