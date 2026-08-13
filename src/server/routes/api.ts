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
import { awardFor } from '../../shared/points.js';
import { isValidChoice, isValidGuess } from '../../shared/scoring.js';
import type {
  ApiError,
  BoardRange,
  CommentRequest,
  CommentResponse,
  DailyPointer,
  MisjudgedResponse,
  PlayerBoardResponse,
  StateResponse,
  VoteRequest,
} from '../../shared/types.js';
import { toDayKey } from '../../shared/day.js';
import { REPLAY_MODE } from '../../shared/config.js';
import { getDailyQuestionId } from '../core/daily.js';
import { readPlayerBoard } from '../core/leaderboard.js';
import { isMenuPost } from '../core/menuPost.js';
import { getQuestion, getQuestionIdForPost, toPublicQuestion } from '../core/questions.js';
import { misjudgedLeaderboard } from '../core/stats.js';
import { EMPTY_USER, getUser, projectStats, recordPlay } from '../core/users.js';
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
  const userId = context.userId;
  const stats = projectStats(userId ? await getUser(userId) : EMPTY_USER);

  // No question on this post. The pinned menu post is the legitimate reason for
  // that, so it is checked here rather than on every load of a playable post.
  if (!questionId) {
    if (await isMenuPost(postId)) return c.json<StateResponse>({ kind: 'menu', stats });
    return c.json<ApiError>({ error: 'No question on this post.' }, 404);
  }

  const question = await getQuestion(questionId);
  if (!question) return c.json<ApiError>({ error: 'That question is gone.' }, 404);

  const vote = userId ? await getStoredVote(questionId, userId) : null;

  // The only path to a tally.
  const reveal = vote && userId ? await buildReveal(question, vote, userId, stats) : null;

  return c.json<StateResponse>({
    kind: 'question',
    question: toPublicQuestion(question),
    reveal,
    stats,
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

  // A second attempt never pays twice: the claim in `castVote` fails before
  // anything is awarded, and this path only reads.
  if (result.status === 'duplicate') {
    const stats = projectStats(await getUser(userId));
    const reveal = await buildReveal(question, result.vote, userId, stats);
    return c.json<ApiError>({ error: 'You have already answered this one.', reveal }, 409);
  }

  // Every question counts: the Daily, an open question somebody submitted, or
  // one played out of the archive. The day is the day the vote was cast rather
  // than the day the question ran, or an archived puzzle would back-date the
  // streak to a day the player did not play.
  const award = awardFor(result.error);
  const stats = await recordPlay(userId, { hit: result.hit, points: award.total });

  const reveal = await buildReveal(question, result.vote, userId, stats);
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
  let vote = await getStoredVote(questionId, userId);

  // Under REPLAY_MODE no vote was stored, so the answer comes back with the
  // request. Only the answer: the split, the error and the badge are still
  // derived from the live tally on this side of the wire.
  if (!vote && REPLAY_MODE && isValidChoice(body.choice) && isValidGuess(body.guess)) {
    vote = { choice: body.choice, guess: body.guess };
  }

  if (!vote) return c.json<ApiError>({ error: 'Answer first, then post.' }, 403);

  const stats = projectStats(await getUser(userId));
  const reveal = await buildReveal(question, vote, userId, stats);
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
api.get('/api/leaderboard/questions', async (c) => {
  return c.json<MisjudgedResponse>({ entries: await misjudgedLeaderboard() });
});

/**
 * Who has banked the most points — this week by default, or all time.
 *
 * **This route returns no per-question data of any kind.** Points, and the
 * streaks and rates beside them elsewhere, are per-player aggregates across
 * every question that player ever answered: none of them narrows down how an
 * individual answered an individual question, and no shape here can carry a
 * `Tally`. That is what makes a board safe to hand to somebody who has not
 * voted — see the invariant on this file and in `votes.ts`.
 *
 * Unrecognised `range` values fall back to the weekly board rather than
 * erroring. There are two boards and a mistyped query is not worth a 400.
 */
api.get('/api/leaderboard/players', async (c) => {
  const range: BoardRange = c.req.query('range') === 'all' ? 'all' : 'week';
  return c.json<PlayerBoardResponse>(await readPlayerBoard(range, context.userId));
});

/** Today's UTC day, so the client never has to consult a local clock. */
api.get('/api/today', (c) => c.json({ day: toDayKey() }));

/**
 * Where today's Daily is, so the menu can offer a way to it.
 *
 * **This route returns no tally.** It answers with a state and somewhere to go,
 * and it never carries a count, a reveal, or the question text. Deciding
 * `voted` reads `voted:{questionId}` for this user, which is a boolean about
 * *them* rather than anything about the crowd — it is coerced to one here so
 * nothing downstream can widen it back into a number.
 *
 * `from` is the postId the menu is open on, taken as a parameter rather than
 * inferred: the pinned menu post carries no question, so there is no `post:`
 * lookup to lean on.
 */
api.get('/api/daily', async (c) => {
  const day = toDayKey();

  const questionId = await getDailyQuestionId(day);
  if (!questionId) return c.json<DailyPointer>({ day, state: 'none' });

  const question = await getQuestion(questionId);
  if (!question?.postId) return c.json<DailyPointer>({ day, state: 'none' });

  // Standing on it already. Settled before the vote is read, because whether
  // they answered changes nothing about a post they are looking at.
  if (c.req.query('from') === question.postId) {
    return c.json<DailyPointer>({ day, state: 'here', postId: question.postId });
  }

  const permalink = question.permalink || (await permalinkFor(question.postId));
  // Nowhere to send them. A Daily whose post has gone reads the same as no
  // Daily at all, because for the purpose of this one button it is.
  if (!permalink) return c.json<DailyPointer>({ day, state: 'none' });

  const userId = context.userId;
  const voted = Boolean(userId && (await getStoredVote(questionId, userId)));

  return c.json<DailyPointer>({
    day,
    state: voted ? 'voted' : 'playable',
    postId: question.postId,
    permalink,
  });
});

/**
 * The fallback for question records written before the permalink was cached on
 * the hash. Costs a round trip, so it only runs for those.
 */
async function permalinkFor(postId: string): Promise<string> {
  try {
    return (await reddit.getPostById(postId as T3)).permalink;
  } catch {
    return '';
  }
}
