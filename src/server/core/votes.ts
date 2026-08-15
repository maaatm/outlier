/**
 * The vote engine.
 *
 * One invariant governs this file: **a player who has not voted never learns
 * the tally.** If they could read the current percentage off the wire, the guess
 * would be free and the game would have no second axis. Nothing here returns a
 * `Tally` except through `buildReveal`, and `buildReveal` is only ever reached
 * by way of the `voted:` hash.
 *
 * A second thing now travels on the same shape and is worth stating next to it:
 * **the reveal carries other people's answers.** Up to ten players appear in
 * the crowd on the side they actually chose, read from this question's `voted:`
 * hash. That is deliberately the narrowest disclosure that makes the feature
 * work — it happens only for players whose stored preference allows it, checked
 * at render time so revoking it is retroactive, and only for a viewer who has
 * already voted and therefore already holds the tally those ten answers are a
 * part of. Nothing about who else answered exists anywhere but here. See
 * `core/cameos.ts` for the three rules and the shape that enforces them.
 */

import { redis } from '@devvit/web/server';

import { buildComment } from '../../shared/comment.js';
import {
  HISTOGRAM_BUCKETS,
  PROVISIONAL_VOTE_FLOOR,
  RECENT_VOTER_CAP,
  REPLAY_MODE,
} from '../../shared/config.js';
import { awardFor } from '../../shared/points.js';
import { scoreVote } from '../../shared/scoring.js';
import type { Choice, PlayerStats, Reveal, Tally } from '../../shared/types.js';
import { type StoredVote, decodeVote, encodeVote } from '../../shared/vote.js';
import { readBlobVisibility } from './avatars.js';
import { readCameos } from './cameos.js';
import { keys, voteFields } from './keys.js';
import { type QuestionRecord, toPublicQuestion } from './questions.js';

export type { StoredVote };

export function bucketFor(guess: number): number {
  return Math.min(HISTOGRAM_BUCKETS - 1, Math.floor(guess / (100 / HISTOGRAM_BUCKETS)));
}

export async function getStoredVote(
  questionId: string,
  userId: string
): Promise<StoredVote | null> {
  // In replay mode nothing was ever stored, so every visit is a fresh one.
  if (REPLAY_MODE) return null;
  return decodeVote(await redis.hGet(keys.voted(questionId), userId));
}

export async function readTally(questionId: string): Promise<Tally> {
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
  // Replay mode forgets the comment too, so the whole slide stays playable.
  if (REPLAY_MODE) return false;
  return Boolean(await redis.hGet(keys.commented(questionId), userId));
}

/**
 * Build the reveal a player has earned.
 *
 * Everything except the counters and the award is recomputed from the live
 * tally, so a player who reopens the post sees the crowd as it stands now rather
 * than a fossil of the moment they voted. The streak and the points are banked
 * at vote time and are not recomputed here — a day already counted stays
 * counted, and points already paid stay paid.
 *
 * The cameos are recomputed the same way and for a second reason: an opt-out is
 * only retroactive if nothing about who was in the crowd was ever written down.
 * They join the existing fan-out rather than following it — this screen is the
 * one moment in the app worth spending on, and paying for it in serial round
 * trips is the one way to spend it badly.
 */
export async function buildReveal(
  question: QuestionRecord,
  vote: StoredVote,
  userId: string,
  stats: PlayerStats
): Promise<Reveal> {
  const [tally, histogram, commented, cameos, visibility] = await Promise.all([
    readTally(question.id),
    readHistogram(question.id),
    hasCommented(question.id, userId),
    readCameos(question.id, userId),
    readBlobVisibility(userId),
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
    // Paid on the error banked with the vote. Falling back to the live error
    // covers the two cases where none was banked: REPLAY_MODE, and votes cast
    // before points existed.
    award: awardFor(vote.error ?? score.error),
    stats,
    commentPreview: '',
    commented,
    cameos,
    // The first reveal where their own blob was eligible to appear is the
    // screen this belongs on, and it is this one — they voted, so they are in
    // the window already. Anything later would be telling them after the fact.
    blobNotice: !visibility.told,
  };

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
  if (REPLAY_MODE) {
    // Nothing is claimed and nothing is remembered, so the next open starts
    // over. See the warning on REPLAY_MODE — this is the dedupe guard, off, and
    // with it off the same account can bank points repeatedly.
    await tallyVote(questionId, choice, guess);
    return finishVote(questionId, userId, choice, guess);
  }

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
    tallyVote(questionId, choice, guess),
    redis.zAdd(keys.guesses(questionId), { member: userId, score: guess }),
    rememberVoter(questionId, userId),
  ]);

  return finishVote(questionId, userId, choice, guess);
}

/**
 * Keep this voter in the question's recent window, for the reveal's cameos.
 *
 * It sits on the same branch as `guesses:` — after the claim, beside the write
 * that records the guess — so the vote path gains one more parallel write
 * rather than one more round trip, and so it is not written under REPLAY_MODE.
 * That is the correct behaviour rather than an oversight: with the flag on
 * nothing is written to `voted:` either, so there would be no side to draw a
 * cameo on. The feature is simply absent in a replay subreddit, and correct the
 * moment the flag flips. No branch here checks it.
 *
 * The trim follows the add rather than running beside it. Racing them would let
 * a `zAdd` land after the trim and leave the window one member over the cap
 * until somebody else voted — harmless, and avoidable for nothing.
 */
async function rememberVoter(questionId: string, userId: string): Promise<void> {
  await redis.zAdd(keys.recent(questionId), { member: userId, score: Date.now() });
  await redis.zRemRangeByRank(keys.recent(questionId), 0, -(RECENT_VOTER_CAP + 1));
}

/** The counters every vote moves, whether or not the voter is remembered. */
async function tallyVote(questionId: string, choice: Choice, guess: number): Promise<void> {
  await Promise.all([
    redis.hIncrBy(keys.votes(questionId), choice === 'a' ? voteFields.a : voteFields.b, 1),
    redis.hIncrBy(keys.votes(questionId), voteFields.guessSum, guess),
    redis.hIncrBy(keys.votes(questionId), voteFields.guessCount, 1),
    redis.hIncrBy(keys.histogram(questionId), String(bucketFor(guess)), 1),
  ]);
}

/** Score against the tally that includes this vote — you are one of the crowd. */
async function finishVote(
  questionId: string,
  userId: string,
  choice: Choice,
  guess: number
): Promise<CastResult> {
  const tally = await readTally(questionId);
  const score = scoreVote(tally, choice, guess);

  // Bank the error next to the vote, so reopening the post reports the award
  // that was actually paid rather than one re-derived from a crowd that has
  // moved since. Safe to write over the claim: it has already been won, and the
  // value only gains a field. Nothing is stored under REPLAY_MODE.
  if (!REPLAY_MODE) {
    await redis.hSet(keys.voted(questionId), {
      [userId]: encodeVote(choice, guess, score.error),
    });
  }

  const errSum = await redis.hIncrBy(keys.votes(questionId), voteFields.errSum, score.error);
  const count = Number((await redis.hGet(keys.votes(questionId), voteFields.guessCount)) ?? 0) || 1;
  await redis.zAdd(keys.misjudged, { member: questionId, score: errSum / count });

  return {
    status: 'ok',
    vote: { choice, guess, error: score.error },
    error: score.error,
    hit: score.hit,
  };
}

export async function recordComment(
  questionId: string,
  userId: string,
  commentId: string
): Promise<void> {
  await redis.hSet(keys.commented(questionId), { [userId]: commentId });
}
