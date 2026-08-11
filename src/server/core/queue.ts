/**
 * The promotion queue.
 *
 * Community questions enter `queue:pending` scored by the upvotes on their open
 * post. A moderator moves them to `queue:approved`. Only approved questions can
 * take the Daily slot — unmoderated content never reaches the flagship post.
 */

import { redis } from '@devvit/web/server';

import { MOD_QUEUE_PAGE_SIZE, PROMOTION_THRESHOLD } from '../../shared/config.js';
import type { QueueEntry } from '../../shared/types.js';
import { keys } from './keys.js';
import { getQuestion } from './questions.js';

export async function enqueuePending(questionId: string, upvotes = 1): Promise<void> {
  await redis.zAdd(keys.queuePending, { member: questionId, score: upvotes });
}

export async function setPendingScore(questionId: string, upvotes: number): Promise<void> {
  await redis.zAdd(keys.queuePending, { member: questionId, score: upvotes });
}

export async function setApprovedScore(questionId: string, upvotes: number): Promise<void> {
  await redis.zAdd(keys.queueApproved, { member: questionId, score: upvotes });
}

export async function approve(questionId: string): Promise<boolean> {
  const score = await redis.zScore(keys.queuePending, questionId);
  if (score === undefined) return false;
  await redis.zAdd(keys.queueApproved, { member: questionId, score });
  await redis.zRem(keys.queuePending, [questionId]);
  return true;
}

export async function reject(questionId: string): Promise<boolean> {
  const removed = await redis.zRem(keys.queuePending, [questionId]);
  return removed > 0;
}

/** Take a question out of the running once it has had its day. */
export async function retire(questionId: string): Promise<void> {
  await redis.zRem(keys.queueApproved, [questionId]);
  await redis.zRem(keys.queuePending, [questionId]);
}

async function readTop(key: string, count: number): Promise<QueueEntry[]> {
  const members = await redis.zRange(key, 0, count - 1, { by: 'rank', reverse: true });
  const entries: QueueEntry[] = [];

  for (const { member, score } of members) {
    const question = await getQuestion(member);
    if (!question) {
      // The question record is gone; do not leave a dangling queue entry.
      await redis.zRem(key, [member]);
      continue;
    }
    entries.push({
      id: question.id,
      text: question.text,
      labelA: question.labelA,
      labelB: question.labelB,
      authorName: question.authorName,
      upvotes: score,
      postId: question.postId,
      createdAt: question.createdAt,
    });
  }
  return entries;
}

export function listPending(count: number = MOD_QUEUE_PAGE_SIZE): Promise<QueueEntry[]> {
  return readTop(keys.queuePending, count);
}

export function listApproved(count: number = MOD_QUEUE_PAGE_SIZE): Promise<QueueEntry[]> {
  return readTop(keys.queueApproved, count);
}

/** Every pending id, so the hourly job can re-score the whole set. */
export async function allPendingIds(): Promise<string[]> {
  const members = await redis.zRange(keys.queuePending, 0, -1, { by: 'rank' });
  return members.map((m) => m.member);
}

export async function allApprovedIds(): Promise<string[]> {
  const members = await redis.zRange(keys.queueApproved, 0, -1, { by: 'rank' });
  return members.map((m) => m.member);
}

/**
 * The best approved question that clears the promotion threshold, or null when
 * nothing qualifies and the house pool should supply the Daily instead.
 *
 * A question that has already run as a Daily is skipped and retired rather than
 * returned, so a popular question cannot occupy the slot twice.
 */
export async function nextPromotable(): Promise<string | null> {
  const members = await redis.zRange(keys.queueApproved, 0, MOD_QUEUE_PAGE_SIZE - 1, {
    by: 'rank',
    reverse: true,
  });

  for (const { member, score } of members) {
    if (score < PROMOTION_THRESHOLD) break; // Sorted descending: nothing below will pass either.
    const question = await getQuestion(member);
    if (!question) {
      await redis.zRem(keys.queueApproved, [member]);
      continue;
    }
    if (question.dailyDate !== '') {
      await retire(member);
      continue;
    }
    return member;
  }
  return null;
}
