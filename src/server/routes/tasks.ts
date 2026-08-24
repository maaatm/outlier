/**
 * Scheduler task endpoints, wired to cron in `devvit.json`.
 *
 *   post-daily       00:00 UTC  resolve the source, post the Daily, write daily:{date}
 *   summarize-daily  00:00 UTC  comment where yesterday's split stands, stickied where the
 *                              app is allowed to. Voting stays open.
 *   refresh-queue    hourly     re-score the pending queue from live post upvotes
 *   sweep-comments   hourly     pay tracked comments what their upvotes owe
 *
 * Both midnight jobs are idempotent, so the order they fire in does not matter:
 * `summarize-daily` works on yesterday's key and `post-daily` on today's.
 */

import { reddit } from '@devvit/web/server';
import type { T3 } from '@devvit/web/shared';
import { Hono } from 'hono';

import { previousDay, toDayKey } from '../../shared/day.js';
import { sweepCommentRewards } from '../core/commentRewards.js';
import { postDaily, summarizeDaily } from '../core/daily.js';
import { broadcastDaily, notifyPromotedAuthor } from '../core/push.js';
import { getQuestion } from '../core/questions.js';
import {
  allApprovedIds,
  allPendingIds,
  setApprovedScore,
  setPendingScore,
} from '../core/queue.js';

export const taskRoutes = new Hono();

taskRoutes.post('/internal/tasks/post-daily', async (c) => {
  const result = await postDaily(toDayKey());
  if (result.status === 'exists') {
    console.log(`post-daily: ${result.day} already has a question, nothing to do`);
    return c.json({});
  }

  console.log(`post-daily: ${result.day} -> ${result.questionId} on ${result.postId}`);

  /*
   * The notifications, after the post exists and never before it.
   *
   * The author goes first, so that a run dying between the two leaves the one
   * person with a specific reason to hear having heard — and because their
   * notice is what replaces their copy of the broadcast, which is what
   * `promotedAuthorId` is doing on the second call.
   *
   * **No `try`/`catch` here on purpose.** Both of these swallow their own
   * failures — see the header on `core/push.ts` — and a catch around them would
   * be a second one, catching nothing, implying they might throw.
   */
  await notifyPromotedAuthor(result.promotedAuthorId, result.postId, result.questionText);
  await broadcastDaily(result.postId, result.questionText, result.promotedAuthorId || undefined);

  return c.json({});
});

taskRoutes.post('/internal/tasks/summarize-daily', async (c) => {
  const result = await summarizeDaily(previousDay());
  const detail =
    result.status === 'summarized'
      ? result.distinguished
        ? 'stickied'
        : 'not stickied'
      : result.reason;
  console.log(`summarize-daily: ${result.day} ${result.status} (${detail})`);
  return c.json({});
});

/**
 * Re-score the queues from live post upvotes.
 *
 * Failures on individual posts are swallowed: a deleted post should cost its own
 * entry a refresh, not the whole run.
 */
taskRoutes.post('/internal/tasks/refresh-queue', async (c) => {
  const [pending, approved] = await Promise.all([allPendingIds(), allApprovedIds()]);

  let refreshed = 0;
  for (const [ids, write] of [
    [pending, setPendingScore],
    [approved, setApprovedScore],
  ] as const) {
    for (const questionId of ids) {
      try {
        const question = await getQuestion(questionId);
        if (!question?.postId) continue;
        const post = await reddit.getPostById(question.postId as T3);
        await write(questionId, post.score);
        refreshed++;
      } catch (error) {
        console.error(`refresh-queue: skipping ${questionId}`, error);
      }
    }
  }

  console.log(`refresh-queue: rescored ${refreshed} questions`);
  return c.json({});
});

/**
 * Pay tracked comments what their upvotes owe.
 *
 * Its own task rather than a second half of `refresh-queue`: they touch
 * different data, and a throw in one must not take the other's run with it.
 */
taskRoutes.post('/internal/tasks/sweep-comments', async (c) => {
  const result = await sweepCommentRewards();
  console.log(`sweep-comments: paid ${result.paid} coins, settled ${result.settled}`);
  return c.json({});
});

/** First install: get a Daily up rather than making the subreddit wait for midnight. */
taskRoutes.post('/internal/triggers/install', async (c) => {
  try {
    const result = await postDaily(toDayKey());
    console.log(`install: daily ${result.status} for ${result.day}`);
  } catch (error) {
    console.error('install: could not post the first Daily', error);
  }
  return c.json({});
});
