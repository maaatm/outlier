/**
 * The player-facing API.
 *
 * The rule that shapes this file: `GET /api/state` must not leak vote counts to
 * anyone who has not voted. `StateResponse.reveal` is the only carrier of a
 * `Tally`, and it is populated from the `voted:` hash and nothing else.
 */

import { context, reddit } from '@devvit/web/server';
import type { T3 } from '@devvit/web/shared';
import { Hono } from 'hono';

import { buildComment, normalizeNote } from '../../shared/comment.js';
import { isValidChoice, isValidGuess } from '../../shared/scoring.js';
import type {
  ApiError,
  CommentRequest,
  CommentResponse,
  LeaderboardResponse,
  StateResponse,
  VoteRequest,
} from '../../shared/types.js';
import { toDayKey } from '../../shared/day.js';
import { getQuestion, getQuestionIdForPost, toPublicQuestion } from '../core/questions.js';
import { misjudgedLeaderboard } from '../core/stats.js';
import { getUser, projectStreaks, recordDailyPlay } from '../core/users.js';
import { buildReveal, castVote, getStoredVote, recordComment } from '../core/votes.js';

export const api = new Hono();

/**
 * Current question, whether this user has voted, their prior answer if so, and
 * live tallies **only** if they have voted.
 *
 * A player returning to a post they already answered always lands on the
 * completed reveal — never a blank form, never a second chance to vote.
 */
api.get('/api/state/:postId', async (c) => {
  const postId = c.req.param('postId');

  const questionId = await getQuestionIdForPost(postId);
  if (!questionId) return c.json<ApiError>({ error: 'No question on this post.' }, 404);

  const question = await getQuestion(questionId);
  if (!question) return c.json<ApiError>({ error: 'That question is gone.' }, 404);

  const userId = context.userId;
  const record = userId ? await getUser(userId) : null;
  const streaks = projectStreaks(
    record ?? { playStreak: 0, readStreak: 0, lastPlayedDay: '', totalPlayed: 0, totalHits: 0 }
  );

  const vote = userId ? await getStoredVote(questionId, userId) : null;

  // The only path to a tally.
  const reveal = vote && userId ? await buildReveal(question, vote, userId, streaks) : null;

  return c.json<StateResponse>({
    question: toPublicQuestion(question),
    reveal,
    streaks,
    canVote: Boolean(userId) && question.lockedAt === 0,
  });
});

/** Lock in an answer and a guess. This is where the tally first becomes visible. */
api.post('/api/vote', async (c) => {
  const userId = context.userId;
  if (!userId) return c.json<ApiError>({ error: 'Sign in to play.' }, 401);

  const body = await c.req.json<Partial<VoteRequest>>().catch(() => null);
  if (!body || typeof body.postId !== 'string') {
    return c.json<ApiError>({ error: 'Malformed vote.' }, 400);
  }
  if (!isValidGuess(body.guess)) {
    return c.json<ApiError>({ error: 'Guess must be a whole number from 0 to 100.' }, 400);
  }
  if (!isValidChoice(body.choice)) {
    return c.json<ApiError>({ error: 'Pick one of the two answers.' }, 400);
  }

  const questionId = await getQuestionIdForPost(body.postId);
  if (!questionId) return c.json<ApiError>({ error: 'No question on this post.' }, 404);

  const question = await getQuestion(questionId);
  if (!question) return c.json<ApiError>({ error: 'That question is gone.' }, 404);
  if (question.lockedAt > 0) {
    return c.json<ApiError>({ error: 'Voting closed on this one.' }, 423);
  }

  const result = await castVote(questionId, userId, body.choice, body.guess);

  if (result.status === 'duplicate') {
    const streaks = projectStreaks(await getUser(userId));
    const reveal = await buildReveal(question, result.vote, userId, streaks);
    return c.json<ApiError>({ error: 'You have already answered this one.', reveal }, 409);
  }

  // Only the Daily moves streaks. Open questions accumulate votes and nothing else.
  const streaks = question.dailyDate
    ? await recordDailyPlay(userId, result.hit, question.dailyDate)
    : projectStreaks(await getUser(userId));

  const reveal = await buildReveal(question, result.vote, userId, streaks);
  return c.json(reveal);
});

/** Post the generated comment. One tap, no typing, one comment per question. */
api.post('/api/comment', async (c) => {
  const userId = context.userId;
  if (!userId) return c.json<ApiError>({ error: 'Sign in to comment.' }, 401);

  const body = await c.req.json<Partial<CommentRequest>>().catch(() => null);
  if (!body || typeof body.postId !== 'string') {
    return c.json<ApiError>({ error: 'Malformed request.' }, 400);
  }

  const questionId = await getQuestionIdForPost(body.postId);
  if (!questionId) return c.json<ApiError>({ error: 'No question on this post.' }, 404);

  const question = await getQuestion(questionId);
  if (!question) return c.json<ApiError>({ error: 'That question is gone.' }, 404);

  // Recomputed from stored state — the client does not get to say what it scored.
  const vote = await getStoredVote(questionId, userId);
  if (!vote) return c.json<ApiError>({ error: 'Answer first, then post.' }, 403);

  const streaks = projectStreaks(await getUser(userId));
  const reveal = await buildReveal(question, vote, userId, streaks);
  if (reveal.commented) {
    return c.json<ApiError>({ error: 'You have already posted this one.' }, 409);
  }

  const text = buildComment(toPublicQuestion(question), reveal, normalizeNote(body.note));

  const comment = await reddit.submitComment({
    id: (question.postId || body.postId) as T3,
    text,
    runAs: 'USER',
  });

  await recordComment(questionId, userId, comment.id);
  return c.json<CommentResponse>({ ok: true, permalink: comment.permalink });
});

/** The most misjudged questions ever. Safe to read without having voted. */
api.get('/api/leaderboard', async (c) => {
  return c.json<LeaderboardResponse>({ entries: await misjudgedLeaderboard() });
});

/** Today's UTC day, so the client never has to consult a local clock. */
api.get('/api/today', (c) => c.json({ day: toDayKey() }));
