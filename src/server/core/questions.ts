/** Reading and writing question records. */

import { redis } from '@devvit/web/server';

import { toDayKey } from '../../shared/day.js';
import type { Question, QuestionSource } from '../../shared/types.js';
import { keys } from './keys.js';

export type QuestionRecord = {
  id: string;
  text: string;
  /**
   * The Reddit post's title.
   *
   * Its own field rather than a second use of `text`, because the two stopped
   * being the same string when the room let players write one. Empty on every
   * record written before that, which means the same thing it has always meant:
   * the question was the title.
   */
  title: string;
  labelA: string;
  labelB: string;
  authorId: string;
  authorName: string;
  source: QuestionSource;
  createdAt: number;
  /** The post this question is played on. Set once the post exists. */
  postId: string;
  /**
   * The post's permalink, cached at link time.
   *
   * `submitCustomPost` hands one back for free, so storing it here saves a
   * `reddit.getPostById` on every menu open. Empty on records written before it
   * was cached, which is why every reader needs a fallback.
   */
  permalink: string;
  /** Epoch ms when the Daily was locked, or 0 while it is still open. */
  lockedAt: number;
  /** `YYYY-MM-DD` when this ran as a Daily, or '' for an open question. */
  dailyDate: string;
};

export type NewQuestion = {
  id: string;
  text: string;
  title: string;
  labelA: string;
  labelB: string;
  authorId: string;
  authorName: string;
  source: QuestionSource;
};

export async function writeQuestion(question: NewQuestion): Promise<void> {
  await redis.hSet(keys.question(question.id), {
    text: question.text,
    title: question.title,
    labelA: question.labelA,
    labelB: question.labelB,
    authorId: question.authorId,
    authorName: question.authorName,
    source: question.source,
    createdAt: String(Date.now()),
    postId: '',
    permalink: '',
    lockedAt: '0',
    dailyDate: '',
  });
}

export async function getQuestion(questionId: string): Promise<QuestionRecord | null> {
  const raw = await redis.hGetAll(keys.question(questionId));
  if (!raw || !raw.text) return null;
  return {
    id: questionId,
    text: raw.text,
    title: raw.title ?? '',
    labelA: raw.labelA || 'Yes',
    labelB: raw.labelB || 'No',
    authorId: raw.authorId ?? '',
    authorName: raw.authorName ?? '',
    source: raw.source === 'community' ? 'community' : 'house',
    createdAt: Number(raw.createdAt ?? 0),
    postId: raw.postId ?? '',
    permalink: raw.permalink ?? '',
    lockedAt: Number(raw.lockedAt ?? 0),
    dailyDate: raw.dailyDate ?? '',
  };
}

/**
 * Bind a question to the post it is played on, in both directions.
 *
 * The permalink rides along because the caller is holding the `Post` that just
 * came back from `submitCustomPost` and it costs nothing to write here — where
 * reading it later costs a `reddit.getPostById` on every menu open.
 */
export async function linkQuestionToPost(
  questionId: string,
  postId: string,
  permalink: string
): Promise<void> {
  await Promise.all([
    redis.set(keys.post(postId), questionId),
    redis.hSet(keys.question(questionId), { postId, permalink }),
  ]);
}

export async function getQuestionIdForPost(postId: string): Promise<string | null> {
  return (await redis.get(keys.post(postId))) ?? null;
}

export async function markAsDaily(questionId: string, day: string): Promise<void> {
  await redis.hSet(keys.question(questionId), { dailyDate: day });
}

/**
 * Close a question for good.
 *
 * Nothing calls this on a schedule. Yesterday's Daily stays open — it still
 * counts toward a streak — so closing one is a deliberate act for a question
 * that turned out to be a problem, not part of the daily cycle.
 */
export async function lockQuestion(questionId: string): Promise<void> {
  await redis.hSet(keys.question(questionId), { lockedAt: String(Date.now()) });
}

/**
 * The public projection. Author id and timestamps never cross the wire.
 *
 * Neither does the title. The client renders `question.text`; the title is a
 * Reddit artifact — where the post sits in a feed — rather than game content,
 * and this projection is deliberately narrow.
 *
 * `isToday` is resolved here rather than on the client for the usual reason: the
 * client has no business reading a local clock to decide what "today" means.
 */
export function toPublicQuestion(record: QuestionRecord, today: string = toDayKey()): Question {
  const question: Question = {
    id: record.id,
    text: record.text,
    labelA: record.labelA,
    labelB: record.labelB,
    source: record.source,
    isDaily: record.dailyDate !== '',
    isToday: record.dailyDate !== '' && record.dailyDate === today,
    locked: record.lockedAt > 0,
  };
  if (record.source === 'community' && record.authorName) {
    question.authorName = record.authorName;
  }
  if (record.dailyDate) {
    question.dailyDate = record.dailyDate;
  }
  return question;
}

/** Ids are opaque, but they are also used in keys, so keep them boring. */
export function newCommunityQuestionId(): string {
  const stamp = Date.now().toString(36);
  const salt = Math.floor(Math.random() * 0x1000000)
    .toString(36)
    .padStart(5, '0');
  return `c${stamp}${salt}`;
}
