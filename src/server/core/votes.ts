/**
 * The vote engine.
 *
 * One invariant governs this file: **a player who has not voted never learns
 * the tally.** If they could read the current percentage off the wire, the guess
 * would be free and the game would have no second axis. Nothing here returns a
 * `Tally` except through `buildReveal`, and `buildReveal` is only ever reached
 * by way of the `voted:` hash.
 */

import { redis } from '@devvit/web/server';

import { buildComment } from '../../shared/comment.js';
import { HISTOGRAM_BUCKETS, PROVISIONAL_VOTE_FLOOR } from '../../shared/config.js';
import { scoreVote } from '../../shared/scoring.js';
import type { Choice, Reveal, Streaks, Tally } from '../../shared/types.js';
import { keys, voteFields } from './keys.js';
import { type QuestionRecord, toPublicQuestion } from './questions.js';

/** What a player's stored vote decodes to. */
export type StoredVote = {
  choice: Choice;
  guess: number;
};

/** `"a:45"` — the format the data model pins down. */
function encodeVote(choice: Choice, guess: number): string {
  return `${choice}:${guess}`;
}

function decodeVote(raw: string | undefined | null): StoredVote | null {
  if (!raw) return null;
  const [choice, guessText] = raw.split(':');
  if (choice !== 'a' && choice !== 'b') return null;
  const guess = Number(guessText);
  if (!Number.isInteger(guess) || guess < 0 || guess > 100) return null;
  return { choice, guess };
}

export function bucketFor(guess: number): number {
  return Math.min(HISTOGRAM_BUCKETS - 1, Math.floor(guess / (100 / HISTOGRAM_BUCKETS)));
}

export async function getStoredVote(
  questionId: string,
  userId: string
): Promise<StoredVote | null> {
  return decodeVote(await redis.hGet(keys.voted(questionId), userId));
}

async function readTally(questionId: string): Promise<Tally> {
  const raw = await redis.hGetAll(keys.votes(questionId));
  const a = Number(raw?.[voteFields.a] ?? 0) || 0;
  const b = Number(raw?.[voteFields.b] ?? 0) || 0;
  return { a, b, total: a + b };
}

async function readHistogram(questionId: string): Promise<number[]> {
  const raw = await redis.hGetAll(keys.histogram(questionId));
  const out: number[] = [];
  for (let i = 0; i < HISTOGRAM_BUCKETS; i++) {
    out.push(Number(raw?.[String(i)] ?? 0) || 0);
  }
  return out;
}

async function hasCommented(questionId: string, userId: string): Promise<boolean> {
  return Boolean(await redis.hGet(keys.commented(questionId), userId));
}

/**
 * Build the reveal a player has earned.
 *
 * Everything except the streak counters is recomputed from the live tally, so a
 * player who reopens the post sees the crowd as it stands now rather than a
 * fossil of the moment they voted. Streaks are banked at vote time and are not
 * recomputed here — a day already counted stays counted.
 */
export async function buildReveal(
  question: QuestionRecord,
  vote: StoredVote,
  userId: string,
  streaks?: Streaks
): Promise<Reveal> {
  const [tally, histogram, commented] = await Promise.all([
    readTally(question.id),
    readHistogram(question.id),
    hasCommented(question.id, userId),
  ]);

  const score = scoreVote(tally, vote.choice, vote.guess);

  const reveal: Reveal = {
    choice: vote.choice,
    guess: vote.guess,
    actual: score.actual,
    error: score.error,
    hit: score.hit,
    minority: score.minority,
    badge: score.badge,
    tally,
    dotsWithYou: score.dotsWithYou,
    histogram,
    provisional: tally.total < PROVISIONAL_VOTE_FLOOR,
    commentPreview: '',
    commented,
  };
  if (streaks) reveal.streaks = streaks;

  // Generated last: the comment quotes the numbers above it.
  reveal.commentPreview = buildComment(toPublicQuestion(question), reveal);
  return reveal;
}

export type CastResult =
  | { status: 'ok'; vote: StoredVote; error: number; hit: boolean }
  | { status: 'duplicate'; vote: StoredVote };

/**
 * Record a vote, once.
 *
 * `hSetNX` is the whole dedupe: it claims the user's slot atomically, so two
 * taps racing each other can only produce one winner. The counters move only
 * after the claim succeeds. If anything fails after the claim, the vote is
 * recorded but uncounted — the safe direction to fail in, since the alternative
 * is a player inflating a tally by retrying.
 */
export async function castVote(
  questionId: string,
  userId: string,
  choice: Choice,
  guess: number
): Promise<CastResult> {
  const claimed = await redis.hSetNX(keys.voted(questionId), userId, encodeVote(choice, guess));

  if (claimed === 0) {
    const existing = await getStoredVote(questionId, userId);
    // A malformed stored value should not lock a player out forever.
    if (!existing) {
      await redis.hSet(keys.voted(questionId), { [userId]: encodeVote(choice, guess) });
    } else {
      return { status: 'duplicate', vote: existing };
    }
  }

  await Promise.all([
    redis.hIncrBy(keys.votes(questionId), choice === 'a' ? voteFields.a : voteFields.b, 1),
    redis.hIncrBy(keys.votes(questionId), voteFields.guessSum, guess),
    redis.hIncrBy(keys.votes(questionId), voteFields.guessCount, 1),
    redis.zAdd(keys.guesses(questionId), { member: userId, score: guess }),
    redis.hIncrBy(keys.histogram(questionId), String(bucketFor(guess)), 1),
  ]);

  // Scored against the tally that includes this vote — you are one of the crowd.
  const tally = await readTally(questionId);
  const score = scoreVote(tally, choice, guess);

  const errSum = await redis.hIncrBy(keys.votes(questionId), voteFields.errSum, score.error);
  const count = Number((await redis.hGet(keys.votes(questionId), voteFields.guessCount)) ?? 0) || 1;
  await redis.zAdd(keys.misjudged, { member: questionId, score: errSum / count });

  return { status: 'ok', vote: { choice, guess }, error: score.error, hit: score.hit };
}

export async function recordComment(
  questionId: string,
  userId: string,
  commentId: string
): Promise<void> {
  await redis.hSet(keys.commented(questionId), { [userId]: commentId });
}

/** Final numbers for the sticky summary the locking job posts. */
export async function readFinalTally(questionId: string): Promise<Tally> {
  return readTally(questionId);
}

export async function readAverageError(questionId: string): Promise<number | null> {
  const raw = await redis.hGetAll(keys.votes(questionId));
  const count = Number(raw?.[voteFields.guessCount] ?? 0) || 0;
  if (count === 0) return null;
  return (Number(raw?.[voteFields.errSum] ?? 0) || 0) / count;
}
