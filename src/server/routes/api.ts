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
import {
  type Equipped,
  STARTER_ACCESSORY,
  STARTER_FACE,
  STARTER_PAIR,
  getItem,
  ownsItem,
} from '../../shared/items.js';
import { awardFor } from '../../shared/points.js';
import { isValidChoice, isValidGuess } from '../../shared/scoring.js';
import type {
  ApiError,
  AvatarRequest,
  AvatarResponse,
  BoardRange,
  BoxResponse,
  CommentRequest,
  CommentResponse,
  DailyPointer,
  EarningsResponse,
  JoinResponse,
  PlayerBoardResponse,
  StateResponse,
  VoteRequest,
} from '../../shared/types.js';
import { royaltyFor } from '../../shared/coins.js';
import { toDayKey } from '../../shared/day.js';
import { BOX_PRICE, COINS_COMMENT, JOIN_FREE_ROLLS, REPLAY_MODE } from '../../shared/config.js';
import {
  equipAvatar,
  readAvatar,
  readBlobVisibility,
  readInventory,
  setShowBlob,
} from '../core/avatars.js';
import { openBox } from '../core/boxes.js';
import { creditCoins, readCoins } from '../core/coins.js';
import { getDailyQuestionId } from '../core/daily.js';
import { logEarning, markEarningsSeen, readEarnings } from '../core/earnings.js';
import { claimJoin, declineJoin, readJoinState } from '../core/join.js';
import { readPlayerBoard } from '../core/leaderboard.js';
import { isMenuPost } from '../core/menuPost.js';
import { readPushState, setPushOptIn } from '../core/push.js';
import {
  type QuestionRecord,
  getQuestion,
  getQuestionIdForPost,
  toPublicQuestion,
} from '../core/questions.js';
import { EMPTY_USER, getUser, projectStats, recordPlay } from '../core/users.js';
import {
  buildReveal,
  castVote,
  claimComment,
  getStoredVote,
  recordComment,
} from '../core/votes.js';
import { trackComment } from '../core/commentRewards.js';

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
  // Whether the menu offers the room that asks a question. One boolean about
  // the viewer, settled the same way `canVote` is and carrying nothing else —
  // not how many of today's three are left, and nothing about anybody else.
  const canSubmit = Boolean(userId);

  if (!questionId) {
    if (await isMenuPost(postId)) {
      return c.json<StateResponse>({ kind: 'menu', stats, canSubmit });
    }
    return c.json<ApiError>({ error: 'No question on this post.' }, 404);
  }

  const question = await getQuestion(questionId);
  if (!question) return c.json<ApiError>({ error: 'That question is gone.' }, 404);

  // Two independent reads, so they go together rather than one after the other.
  const [vote, authorAvatar] = await Promise.all([
    userId ? getStoredVote(questionId, userId) : null,
    authorAvatarFor(question),
  ]);

  // The only path to a tally.
  const reveal = vote && userId ? await buildReveal(question, vote, userId, stats) : null;

  return c.json<StateResponse>({
    kind: 'question',
    question: toPublicQuestion(question),
    reveal,
    stats,
    canVote: Boolean(userId) && question.lockedAt === 0,
    canSubmit,
    authorAvatar,
  });
});

/**
 * The blob shown in front of `asked by u/…`.
 *
 * House questions have no author line, so they get nothing rather than the
 * starter pair — the absence is what the client renders, not a default blob
 * beside a name that is not there. A community question written before the
 * author id was stored lands in the same place.
 */
async function authorAvatarFor(question: QuestionRecord): Promise<Equipped | null> {
  if (question.source !== 'community' || !question.authorId) return null;
  return readAvatar(question.authorId);
}

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
    return c.json<ApiError>({ error: 'This one is closed for voting.' }, 423);
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

  // Paid to the author of the question, not to the player who answered it. A
  // house question has no author, and `creditCoins` treats an empty id as
  // nobody to pay rather than as an error.
  //
  // It is keyed on the count this vote produced, so exactly one vote in the
  // question's life pays each coin — no watermark, and no way for two votes
  // landing together to both pay it.
  const royalty = royaltyFor(result.voteCount);
  if (royalty > 0 && question.authorId) {
    await creditCoins(question.authorId, royalty);
    await logEarning(question.authorId, 'royalty', royalty, result.voteCount);
  }

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

  const text = buildComment(toPublicQuestion(question), reveal, normalizeNote(body.note));

  // The claim, not the `reveal.commented` read above it, is what guards the
  // payment. A read taken several awaits ago is a double payment waiting for two
  // taps; this is the same atomic claim `voted:` uses.
  if (!(await claimComment(questionId, userId))) {
    return c.json<ApiError>({ error: 'You have already posted this one.' }, 409);
  }

  const comment = await reddit.submitComment({
    id: (question.postId || body.postId) as T3,
    text,
    runAs: 'USER',
  });

  await recordComment(questionId, userId, comment.id);

  // Track before paying. A tracked comment that was not paid for is a comment
  // that earns its upvote bonus anyway; a paid comment that was not tracked
  // silently never earns one.
  await trackComment(userId, comment.id);

  const coins = await creditCoins(userId, COINS_COMMENT);
  await logEarning(userId, 'comment', COINS_COMMENT);

  return c.json<CommentResponse>({
    ok: true,
    permalink: comment.permalink,
    earned: COINS_COMMENT,
    coins,
  });
});

/**
 * Join the subreddit, and take the box that comes with it.
 *
 * The subscribe goes **first**, because it is the thing the player actually
 * asked for and it is idempotent — Reddit's own call is a no-op for somebody
 * already subscribed. But it does not get to sink the request, and that is the
 * bug this route shipped with: one throw out of Reddit answered the tap with a
 * 500, claimed nothing, and left the offer standing — so every retry ran the
 * same call, failed the same way, and the button was dead for that account for
 * good.
 *
 * So the call is attempted and its failure is recorded rather than raised. The
 * grant is ours to give and the subscription is not: Devvit exposes no way to
 * read subscription state back, this app already accepts that it cannot know
 * who is subscribed, and a box in the wardrobe is worth more to the player than
 * a refusal they can do nothing about. `subscribed: false` is what keeps that
 * honest — the reveal says the box landed and the subscription did not, rather
 * than quietly claiming a join that never happened.
 *
 * The grant is once per account, and `claimJoin` is what makes it once however
 * many taps arrive together.
 *
 * `{ decline: true }` is the same decision answered the other way. It stops the
 * offer firing on a reveal and does not stop a later claim — which is why the
 * answer and the claim are two fields rather than one.
 */
api.post('/api/join', async (c) => {
  const userId = context.userId;
  if (!userId) return c.json<ApiError>({ error: 'Sign in first.' }, 401);

  const body = await c.req.json<{ decline?: boolean }>().catch(() => null);

  if (body?.decline === true) {
    await declineJoin(userId);
    const state = await readJoinState(userId);
    return c.json<JoinResponse>({
      joined: state.joined,
      granted: false,
      freeRolls: state.freeRolls,
      // Nothing was asked of Reddit, so there is nothing to report either way.
      subscribed: false,
    });
  }

  let subscribed = true;
  try {
    await reddit.subscribeToCurrentSubreddit();
  } catch (failure) {
    // The only signal there will ever be that this half did not happen: the
    // call returns `void` and the state behind it is private. Logged loudly
    // here, because the response can say that it failed and never why.
    subscribed = false;
    console.error('subscribeToCurrentSubreddit failed', failure);
  }

  const claim = await claimJoin(userId, JOIN_FREE_ROLLS);

  if (claim.status === 'granted') await logEarning(userId, 'join', 0);

  return c.json<JoinResponse>({
    joined: true,
    granted: claim.status === 'granted',
    freeRolls: claim.freeRolls,
    subscribed,
  });
});

/**
 * Where the coins came from — the last few, newest first.
 *
 * **Reading it is what "seen" means.** `markEarningsSeen` runs as a side effect
 * of rendering, because a separate acknowledge endpoint would be a second round
 * trip to say what the first one already said. The dot on the menu goes out with
 * this response and not before it.
 *
 * Only the record room calls it, so it is a fetch on entering that room rather
 * than another field on `/api/state` for every screen to pay for.
 *
 * A signed-out reader gets an empty ledger rather than a 401: there is nothing
 * to show and nothing to refuse, and the room renders the ways-to-earn table on
 * exactly this shape.
 */
api.get('/api/earnings', async (c) => {
  const userId = context.userId;
  if (!userId) return c.json<EarningsResponse>({ entries: [], coins: 0 });

  const [entries, coins] = await Promise.all([readEarnings(userId), readCoins(userId)]);
  await markEarningsSeen(userId);

  return c.json<EarningsResponse>({ entries, coins });
});

/**
 * What this player is wearing, what they own, what they can spend, and who may
 * see the result.
 *
 * A signed-out reader gets the starter pair and no way to save one — the same
 * shape as `canVote` on the question state, so the client branches on a field
 * rather than on the shape of what came back.
 *
 * The balance rides along because the wardrobe is where it is spent, and
 * `showBlob` because Your record is where it is changed. Both are one more
 * field on a response those screens already wait for, rather than a second
 * fetch — and a settings endpoint for one boolean would be a third.
 */
api.get('/api/avatar', async (c) => {
  const userId = context.userId;
  if (!userId) {
    return c.json<AvatarResponse>({
      ...STARTER_PAIR,
      owned: [STARTER_FACE.id, STARTER_ACCESSORY.id],
      coins: 0,
      canSave: false,
      // Nothing to show and nowhere to show it: a signed-out reader has never
      // voted on anything, so they are in no crowd either way.
      showBlob: true,
      // Nothing to spend without an account to hold it.
      freeRolls: 0,
      // Nobody to reach and nobody to ask. The switch does not render on a
      // response that cannot be saved anyway, but the fields are here because
      // the shape is one shape.
      push: false,
      pushAvailable: false,
    });
  }

  const [equipped, owned, coins, visibility, join, push] = await Promise.all([
    readAvatar(userId),
    readInventory(userId),
    readCoins(userId),
    readBlobVisibility(userId),
    readJoinState(userId),
    // Read from Reddit every time rather than cached anywhere, which is the
    // whole reason the switch can be trusted: a player who turned this off in
    // Reddit's own settings sees it off here on the next open.
    readPushState(userId),
  ]);
  return c.json<AvatarResponse>({
    ...equipped,
    owned,
    coins,
    canSave: true,
    showBlob: visibility.showBlob,
    freeRolls: join.freeRolls,
    push: push.optedIn,
    pushAvailable: push.available,
  });
});

/**
 * Put a pair on, or decide who gets to see it.
 *
 * Two things arrive here rather than one, and neither is required: the wardrobe
 * sends a pair, the reveal's first-run notice sends `showBlob`, and Your record
 * sends `showBlob` on its own. The notice does not know what the player is
 * wearing and should not have to go and find out just to be allowed to speak,
 * so the pair is optional — but a request carrying neither is a mistake and is
 * refused rather than answered.
 *
 * Both ids are checked against the catalogue **and against the slot they were
 * sent in**, so a face id in the accessory field is a 400 rather than a blob
 * wearing its own eyes as a hat.
 *
 * Ownership is real: an item the player does not own is a 403, starters always
 * pass, and the rule is the pure `ownsItem` the wardrobe uses to decide what its
 * steppers walk — so a client in step with the server never sees this error, and
 * a client that is not cannot talk its way past it. The inventory is read once
 * and used for both the check and the response.
 */
api.post('/api/avatar', async (c) => {
  const userId = context.userId;
  if (!userId) return c.json<ApiError>({ error: 'Sign in to change your counter.' }, 401);

  const body = await c.req.json<Partial<AvatarRequest>>().catch(() => null);
  if (!body) return c.json<ApiError>({ error: 'Malformed request.' }, 400);

  // Destructured so the type narrowing below survives: a check on `body.face`
  // does not travel, a check on a const does.
  const { face: faceId, accessory: accessoryId, showBlob, push } = body;
  const wantsPair = faceId !== undefined || accessoryId !== undefined;
  const wantsVisibility = typeof showBlob === 'boolean';
  const wantsPush = typeof push === 'boolean';

  // Half a pair is not a request to change one layer — the wardrobe always
  // sends both — and a request asking for nothing at all is a client that has
  // gone wrong rather than one being economical.
  if (!wantsPair && !wantsVisibility && !wantsPush) {
    return c.json<ApiError>({ error: 'Malformed request.' }, 400);
  }
  if (wantsPair && (typeof faceId !== 'string' || typeof accessoryId !== 'string')) {
    return c.json<ApiError>({ error: 'Malformed request.' }, 400);
  }

  const face = typeof faceId === 'string' ? getItem(faceId, 'face') : undefined;
  const accessory = typeof accessoryId === 'string' ? getItem(accessoryId, 'accessory') : undefined;
  if (wantsPair && (!face || !accessory)) {
    return c.json<ApiError>({ error: 'That does not go in that slot.' }, 400);
  }

  // One wave, whichever half of the request arrived: the response says what the
  // player is wearing, owns, can spend and has chosen, and three of those four
  // are unchanged by either write.
  const [worn, owned, coins, visibility, join, pushState] = await Promise.all([
    readAvatar(userId),
    readInventory(userId),
    readCoins(userId),
    readBlobVisibility(userId),
    readJoinState(userId),
    readPushState(userId),
  ]);

  if (face && accessory && (!ownsItem(owned, face) || !ownsItem(owned, accessory))) {
    return c.json<ApiError>({ error: 'You do not have that one yet.' }, 403);
  }

  const equipped: Equipped = face && accessory ? { face: face.id, accessory: accessory.id } : worn;

  const [, , pushed] = await Promise.all([
    face && accessory ? equipAvatar(userId, equipped) : undefined,
    wantsVisibility ? setShowBlob(userId, showBlob) : undefined,
    wantsPush ? setPushOptIn(userId, push) : undefined,
  ]);

  return c.json<AvatarResponse>({
    ...equipped,
    owned,
    coins,
    canSave: true,
    // What was asked for, not a re-read of what was just written.
    showBlob: wantsVisibility ? showBlob : visibility.showBlob,
    freeRolls: join.freeRolls,
    /*
     * And here, the opposite: what the write *answered with*, not what was
     * asked for. This is the one setting in the app whose write can be refused
     * by something other than us — Reddit holds the opt-in ledger and an
     * experimental plugin may decline or fail — so echoing the request back
     * would be a switch that shows a choice the player did not get.
     */
    push: pushed ? pushed.optedIn : pushState.optedIn,
    pushAvailable: pushed ? pushed.available : pushState.available,
  });
});

/**
 * Open a gift box.
 *
 * The server rolls and the client animates. A client-side roll is a client-side
 * inventory — see the header on `core/boxes.ts` for what makes the debit and the
 * grant one operation.
 *
 * Nothing about a tally, a question or another player is reachable from here.
 */
api.post('/api/box/open', async (c) => {
  const userId = context.userId;
  if (!userId) return c.json<ApiError>({ error: 'Sign in to open a box.' }, 401);

  const outcome = await openBox(userId);

  if (outcome.status === 'poor') {
    return c.json<ApiError>(
      { error: `A box costs ${BOX_PRICE}. You have ${outcome.coins}.` },
      402
    );
  }
  if (outcome.status === 'busy') {
    return c.json<ApiError>({ error: 'Something changed while the box was opening. Try again.' }, 409);
  }

  return c.json<BoxResponse>({
    item: outcome.item.id,
    duplicate: outcome.duplicate,
    refunded: outcome.refunded,
    coins: outcome.coins,
    free: outcome.free,
    freeRolls: outcome.freeRolls,
  });
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
