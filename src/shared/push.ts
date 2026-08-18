/**
 * What a notification says, who it is sent to in one go, and who gets asked.
 *
 * The pure half of push. Nothing here reaches Reddit or Redis, which is what
 * lets the copy and the gates be tested — `server/core/push.ts` is the other
 * side of that seam and is the only file that touches the plugin.
 *
 * **No copy in this file carries a count, a percentage or a tally.** A
 * notification is by definition delivered to somebody who has not voted on the
 * question it is about — it is the thing telling them the question exists — so
 * anything derived from the split would hand them the answer before the game
 * asked them for it. See the invariant on `server/core/votes.ts`. The question
 * text is public the moment the post is created; nothing else about that
 * question is. The one number that appears anywhere here is the coin award on
 * the promotion notice, which is what the author was paid and is about them.
 */

import { PUSH_ASK_AFTER_STREAK, PUSH_BODY_MAX_LENGTH } from './config.js';

/** What one notification reads as. Both halves are plain text — no templating. */
export type PushCopy = {
  title: string;
  body: string;
};

/**
 * The same three characters `fitTitle` trims Reddit's 300 with, and for the
 * same reason: something was cut and the reader should be able to tell.
 */
const ELLIPSIS = '...';

/**
 * A question, cut to what a notification will show of it.
 *
 * Not `fitTitle` and not factored out of it, though the two do the same job at
 * different lengths. `fitTitle` cuts at the character, because a post title is
 * refused by Reddit past 300 and mid-word is better than refused. A
 * notification body is read on a lock screen at a glance, so it is cut back to
 * the last whole word instead — the two rules are different rules, and sharing
 * a helper between them would mean one of them stopped being what it is.
 *
 * The ellipsis is inside the budget, not on top of it: what comes back is never
 * longer than `PUSH_BODY_MAX_LENGTH`, which is the property the tests pin.
 */
export function fitPushBody(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= PUSH_BODY_MAX_LENGTH) return trimmed;

  const cut = trimmed.slice(0, PUSH_BODY_MAX_LENGTH - ELLIPSIS.length);
  const boundary = cut.lastIndexOf(' ');

  // One word longer than the whole budget has no boundary to cut back to, and
  // cutting back to nothing would be a notification that says only "...".
  const kept = boundary > 0 ? cut.slice(0, boundary) : cut;
  return `${kept.trimEnd()}${ELLIPSIS}`;
}

/**
 * The broadcast: today's question is up.
 *
 * The title says what happened and the body is the question itself, because the
 * question is the reason to open the app and a second sentence about the game
 * would push it off the line.
 */
export function dailyPushCopy(questionText: string): PushCopy {
  return { title: "Today's Outlier is up", body: fitPushBody(questionText) };
}

/**
 * The one sent to a single person: their question took the Daily slot.
 *
 * It carries the coin award because that is the part they were not present for
 * — the question was chosen while they were somewhere else, and the receipt is
 * the news. It is the only number any notification in this game carries.
 */
export function promotionPushCopy(questionText: string, coins: number): PushCopy {
  return {
    title: "Your question is today's Outlier",
    body: `${fitPushBody(questionText)} +${coins} coins.`,
  };
}

/**
 * Cut a list into batches of at most `size`.
 *
 * Four lines, and here rather than inline because two of the four cases are
 * ones a fan-out gets wrong quietly: an empty list must produce no batches
 * rather than one empty batch that is then enqueued to nobody, and a `size` of
 * zero must not produce an infinite loop. Zero answers with nothing, because a
 * batch that holds nothing cannot hold anybody — the alternative, one batch of
 * everything, would be a recipient list past Reddit's cap and refused whole.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) return [];
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    batches.push(items.slice(start, start + size));
  }
  return batches;
}

/** Every gate on the one-time ask, in one place so the caller reads as a fact. */
export type PushAskInput = {
  /** `PUSH_ENABLED`. */
  enabled: boolean;
  /** The plugin answered. A feature that cannot be offered is not offered. */
  available: boolean;
  /** Reddit's ledger already says yes, so there is nothing to ask. */
  optedIn: boolean;
  /** `pushAsked` on the user hash. Ours to know, and what stops a second ask. */
  asked: boolean;
  /** The blob notice is firing on this same reveal. */
  blobNotice: boolean;
  streak: number;
};

/**
 * Ask this player, once, whether they want to be told when the next Daily is up.
 *
 * A predicate rather than five conditions at the call site, so `buildReveal`
 * assigns a field instead of holding an argument. The `blobNotice` gate is the
 * one that is not about push at all: two consent questions on one reveal reads
 * as a permissions wizard, and both get dismissed unread.
 */
export function shouldAskForPush(input: PushAskInput): boolean {
  return (
    input.enabled &&
    input.available &&
    !input.optedIn &&
    !input.asked &&
    !input.blobNotice &&
    input.streak >= PUSH_ASK_AFTER_STREAK
  );
}
