/**
 * What a posted comment earns after it has been posted.
 *
 * One coin per upvote, capped at `COMMENT_UPVOTE_COIN_CAP` per comment, for
 * `COMMENT_TRACK_HOURS` from posting. The rules are pure and live in
 * `shared/coins.ts`; what is here is the tracking, the sweep, and the one Reddit
 * call the whole feature turns on.
 *
 * Two keys hold the state:
 *
 *   comments:tracked  zset  "{userId}:{commentId}" -> posted at
 *   comments:paid     hash  commentId -> coins already paid
 *
 * The second is the watermark, and it is what makes every other decision here
 * safe: a settle pays the *difference* between what the score owes now and what
 * has already been paid, so a run that skips a comment costs it an hour of
 * latency and never a coin, and a run that fires twice pays nothing the second
 * time.
 */

import { redis, reddit } from '@devvit/web/server';
import type { T1 } from '@devvit/web/shared';

import { commentIsSettled, commentUpvoteDue } from '../../shared/coins.js';
import { COMMENT_SWEEP_BATCH, COMMENT_TRACK_HOURS } from '../../shared/config.js';
import { creditCoins } from './coins.js';
import { logEarning } from './earnings.js';
import { keys } from './keys.js';

/** Put a comment into the accrual window. Called once, from the comment route. */
export async function trackComment(userId: string, commentId: string): Promise<void> {
  await redis.zAdd(keys.commentsTracked, {
    member: `${userId}:${commentId}`,
    score: Date.now(),
  });
}

/**
 * Pay a comment the difference between what its upvotes owe and what it has
 * been paid. Answers what was paid, and whether the entry is done.
 */
async function settle(userId: string, commentId: string): Promise<{ paid: number; done: boolean }> {
  const comment = await reddit.getCommentById(commentId as T1);
  const alreadyPaid = Number(await redis.hGet(keys.commentsPaid, commentId)) || 0;
  const due = commentUpvoteDue(comment.score, alreadyPaid);

  if (due > 0) {
    const total = alreadyPaid + due;
    // The watermark moves before the coins do. A crash between the two costs a
    // player coins they were owed; the other order pays them twice, every sweep,
    // forever.
    await redis.hSet(keys.commentsPaid, { [commentId]: String(total) });
    await creditCoins(userId, due);
    await logEarning(userId, 'upvotes', due, Math.max(0, comment.score - 1));
    return { paid: due, done: commentIsSettled(total) };
  }

  return { paid: 0, done: commentIsSettled(alreadyPaid) };
}

/** Stop tracking, and forget the watermark with it. */
async function drop(member: string, commentId: string): Promise<void> {
  await redis.zRem(keys.commentsTracked, [member]);
  await redis.hDel(keys.commentsPaid, [commentId]);
}

/**
 * The member is `${userId}:${commentId}` and both halves are Reddit `t2_`/`t1_`
 * ids containing no colon, so the first colon is unambiguous.
 */
function splitMember(member: string): { userId: string; commentId: string } | null {
  const at = member.indexOf(':');
  if (at <= 0 || at === member.length - 1) return null;
  return { userId: member.slice(0, at), commentId: member.slice(at + 1) };
}

export type SweepResult = { paid: number; settled: number };

/**
 * Two passes, and they are not the same pass.
 *
 * **Expiring** is everything past the window. Each gets one last settle and is
 * then dropped, so a comment that gained its upvotes on the second day is still
 * paid for them before it leaves.
 *
 * **Fresh** is the newest `COMMENT_SWEEP_BATCH` inside the window, because that
 * is where upvotes actually arrive — a Reddit comment gets most of its score in
 * the first few hours. A comment in the middle that is missed by this pass is
 * not missed by the expiring one.
 *
 * The batch is what makes a busy subreddit affordable: this reads one comment
 * per Reddit API call, and a Daily with four hundred comments is four hundred
 * calls if nothing bounds it. The watermark in `comments:paid` is what makes
 * bounding it safe — every settle pays the difference, so a skipped run costs a
 * player an hour of latency and never a coin.
 *
 * Failures on individual comments are swallowed, the way `refresh-queue`
 * swallows a deleted post: one removed comment must not cost the whole run.
 */
export async function sweepCommentRewards(now = Date.now()): Promise<SweepResult> {
  const cutoff = now - COMMENT_TRACK_HOURS * 60 * 60 * 1000;

  const [expiring, fresh] = await Promise.all([
    redis.zRange(keys.commentsTracked, 0, cutoff, { by: 'score' }),
    // Reversed by score takes the high end first — this is a range from `now`
    // back down to the cutoff, newest out first, and handing it the two bounds
    // the other way round returns nothing at all.
    redis.zRange(keys.commentsTracked, now, cutoff, {
      by: 'score',
      reverse: true,
      limit: { offset: 0, count: COMMENT_SWEEP_BATCH },
    }),
  ]);

  const result: SweepResult = { paid: 0, settled: 0 };
  // Which pass a member came from decides whether it leaves afterwards, and one
  // on the boundary can come back from both. Settling it twice would pay nothing
  // the second time — the watermark sees to that — but it would still be a
  // wasted Reddit call.
  const past = new Set(expiring.map((entry) => entry.member));
  const seen = new Set<string>();

  for (const { member } of [...expiring, ...fresh]) {
    if (seen.has(member)) continue;
    seen.add(member);

    const split = splitMember(member);
    // A member that is not a pair is a row nothing can be done with. Dropping it
    // is the only way it ever leaves.
    if (!split) {
      await redis.zRem(keys.commentsTracked, [member]);
      continue;
    }

    const expired = past.has(member);

    try {
      const { paid, done } = await settle(split.userId, split.commentId);
      result.paid += paid;
      // Expired or at the ceiling: either way it can earn nothing more, and a
      // comment that can earn nothing more is an API call per sweep for no
      // reason.
      if (expired || done) {
        await drop(member, split.commentId);
        result.settled++;
      }
    } catch (error) {
      console.error(`sweep-comments: skipping ${member}`, error);
      // A comment Reddit will not hand back is usually a deleted one, and it is
      // never coming back. Past the window it goes, so the set stays bounded.
      if (expired) {
        await drop(member, split.commentId);
        result.settled++;
      }
    }
  }

  return result;
}
