/**
 * What a coin event is called, what it says, and how it is written down.
 *
 * The same job `badges.ts` and `points.ts` do: an id, its words, and nothing
 * else. Nothing here reads Redis, pays anybody, or knows what a zset is —
 * `server/core/earnings.ts` is the half that does.
 *
 * The ledger exists because the economy paid four things silently. A payout the
 * player never sees is not an incentive, and two of the earns this shipped
 * beside — a comment's upvotes and a question's royalties — arrive hours or days
 * after the thing that earned them, on no screen at all. This is that screen's
 * vocabulary.
 */

export type EarnReason =
  | 'daily' // first vote of the day
  | 'streak' // every seventh consecutive day
  | 'submission' // a question posted
  | 'promotion' // a question taking the Daily slot
  | 'comment' // the generated comment, posted
  | 'upvotes' // that comment, upvoted
  | 'royalty' // somebody answered a question you wrote
  | 'join'; // the free roll, which pays a roll and not coins

export type Earning = {
  reason: EarnReason;
  /** Coins. Zero for `join`, which pays in rolls. */
  coins: number;
  at: number;
  /** One number the line needs — the upvote count, the vote count. Optional. */
  detail: number;
};

/**
 * What each line says.
 *
 * Written as a sentence about what *you* did, not as a transaction record: the
 * ledger is read by somebody asking "where did that come from", and "8 upvotes
 * on your comment" answers it where "COMMENT_UPVOTE_BONUS" does not.
 */
export const EARN_COPY: Record<EarnReason, (detail: number) => string> = {
  daily: () => 'turned up today',
  streak: (days) => `${days} days in a row`,
  submission: () => 'asked a question',
  promotion: () => 'your question became the Daily',
  comment: () => 'posted your comment',
  upvotes: (votes) => `${votes} ${votes === 1 ? 'upvote' : 'upvotes'} on your comment`,
  royalty: (votes) => `${votes} people answered your question`,
  join: () => 'joined the subreddit',
};

/** Every reason there is, for a decode that has to check one against the list. */
const REASONS = new Set<string>(Object.keys(EARN_COPY));

function isReason(raw: string | undefined): raw is EarnReason {
  return raw !== undefined && REASONS.has(raw);
}

/**
 * `"1739..:upvotes:8:12"` — at, reason, coins, detail.
 *
 * Encoded rather than JSON for the same reason `encodeVote` is: this is a zset
 * member, it is written on paths that are already doing work, and a colon-joined
 * quadruple is both smaller and easier to eyeball in redis-cli.
 *
 * `at` leads because it is what keeps members unique — two earnings of the same
 * reason in the same millisecond are not reachable, since every reason is behind
 * a once-per-question or once-per-day guard.
 */
export function encodeEarning(e: Earning): string {
  return `${e.at}:${e.reason}:${e.coins}:${e.detail}`;
}

/**
 * A decode that fails returns null and the entry is skipped, so a format change
 * never breaks a screen — the same tolerance `decodeVote` has, and for the same
 * reason: one bad row must not cost a player the whole ledger.
 */
export function decodeEarning(raw: string | undefined | null): Earning | null {
  if (!raw) return null;

  const [atText, reason, coinsText, detailText] = raw.split(':');
  if (!isReason(reason)) return null;

  const at = Number(atText);
  const coins = Number(coinsText);
  const detail = Number(detailText);
  if (!Number.isFinite(at) || at <= 0) return null;
  // A payout is never negative and never a fraction: nothing is ever taken back,
  // and coins are whole things.
  if (!Number.isInteger(coins) || coins < 0) return null;
  if (!Number.isInteger(detail) || detail < 0) return null;

  return { reason, coins, at, detail };
}
