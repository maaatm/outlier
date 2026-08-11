/**
 * Scheduler task endpoints, wired to cron in `devvit.json`.
 *
 *   post-daily     00:00 UTC  resolve the source, post the Daily, write daily:{date}
 *   lock-daily     00:00 UTC  lock yesterday's post, freeze tallies, sticky the summary
 *   refresh-queue  hourly     re-score the pending queue from live post upvotes
 *
 * Both midnight jobs are idempotent, so the order they fire in does not matter:
 * `lock-daily` works on yesterday's key and `post-daily` on today's.
 */

import { reddit } from '@devvit/web/server';
import type { T3 } from '@devvit/web/shared';
import { Hono } from 'hono';

import { previousDay, toDayKey } from '../../shared/day.js';
import { lockDaily, postDaily } from '../core/daily.js';
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
  } else {
    console.log(`post-daily: ${result.day} -> ${result.questionId} on ${result.postId}`);
  }
  return c.json({});
});

taskRoutes.post('/internal/tasks/lock-daily', async (c) => {
  const result = await lockDaily(previousDay());
  console.log(`lock-daily: ${result.day} ${result.status}`);
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
