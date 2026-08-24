/**
 * Erasing one player, everything the app knows about them.
 *
 * A moderator names an account and this takes it apart: the record, the two
 * ledgers, the wardrobe, both leaderboards, the name, the blob, every vote they
 * ever cast, and the mark those votes left on the questions they were cast on.
 * It is the only destructive tool in the app, it is deliberately unreachable by
 * a player, and it is deliberately reachable in two modes — see `Mode` below.
 *
 * ## Three tiers, and the scan that is not available
 *
 * Player data sits in three shapes, and only the first two can be reached by
 * name:
 *
 *  1. **Keys that are entirely theirs.** `user:`, `earn:`, `inv:`, `sub:recent:`
 *     and `sub:count:` — a `del` each, and the whole key goes.
 *  2. **One row inside a shared key.** `avatars`, `users:names`, both point
 *     boards, and the `comments:tracked`/`comments:paid` pair. An `hDel` or a
 *     `zRem` each.
 *  3. **One row per question they touched.** `voted:`, `guesses:`, `recent:`
 *     and `commented:` are keyed by *question*, so there is no key here to
 *     derive from a userId — and Devvit's Redis has no `SCAN` to find them
 *     with.
 *
 * So tier three is walked over an index. `stats:misjudged` is one: `finishVote`
 * writes every question there on every vote, and nothing removes an entry except
 * the leaderboard's own sweep of records that no longer exist. Any question this
 * player can have voted on is therefore in it. The two queues are unioned in
 * beside it, which adds the questions that have been submitted but never
 * answered — they hold no vote, but they can hold this player's byline.
 *
 * ## The reversal is exact
 *
 * `voted:{questionId}` stores `"a:45:21"` — choice, guess, and the error the
 * points were paid on. Those are precisely the three values `tallyVote` and
 * `finishVote` moved counters by, which is what makes undoing a vote subtraction
 * rather than re-derivation: `a`/`b` by one, `guessSum` by the guess,
 * `guessCount` by one, `errSum` by the banked error, and the histogram bucket
 * the guess fell in — read back through `bucketFor`, the same function the write
 * used, so the decrement cannot land in a different bucket than the increment
 * did.
 *
 * A two-field value is a vote from before points existed and has no banked
 * error. Its `guessCount` still comes down and its `errSum` cannot, so the
 * misjudged score is *recomputed* from whatever survives rather than left
 * standing on a count that has moved under it. That is the one place the
 * arithmetic is approximate, and it is approximate in a bounded, stated way.
 *
 * ## The safe direction to fail
 *
 * `hDel(voted:{questionId}, [userId])` is the claim, and it is the exact mirror
 * of the `hSetNX` that recorded the vote in the first place: it answers how many
 * fields it actually removed, and the counters move only when that is one. So
 * two wipes racing each other, or one wipe re-run after a crash, decrement once
 * between them.
 *
 * Everything else here is a delete, which is idempotent by nature. The whole
 * tool is therefore safe to run twice, and running it again is the correct
 * response to a run that fell over halfway — a half-finished wipe leaves a tally
 * counting a vote by nobody, which is exactly the state the app would be in if
 * this file did not reverse counters at all.
 *
 * ## What is deliberately not touched
 *
 * **The Reddit posts and comments.** A submitted question posts `runAs: 'USER'`
 * and a shared reveal comments as the player, so both are the player's own
 * content on Reddit, under their own name, and Reddit is where they are deleted.
 * What this can do is drop the byline the *app* stores — `authorId` and
 * `authorName` on `q:{id}` — so their name stops being rendered on the question
 * by this app. The question itself stays: it is live, other people have answered
 * it, and deleting the record would leave a playable post with nothing behind
 * it.
 *
 * **Other players' data.** Nothing here reads or writes another account's
 * record. The aggregates that move are counts, not people.
 */

import { reddit, redis } from '@devvit/web/server';

import { WIPE_DAY_LOOKBACK, WIPE_SCAN_BATCH, WIPE_WEEK_LOOKBACK } from '../../shared/config.js';
import { addDays, fromDayKey, toDayKey, toWeekKey } from '../../shared/day.js';
import { chunk } from '../../shared/push.js';
import { decodeVote } from '../../shared/vote.js';
import { keys, userFields, voteFields } from './keys.js';
import { bucketFor } from './votes.js';

/**
 * Count first, or delete.
 *
 * One function walks the data and one flag decides whether it writes, so the
 * preview cannot drift from the wipe by being a second implementation of the
 * same walk — it *is* the walk, with its hands behind its back. The form opens
 * on `preview` for the obvious reason: this is the one irreversible thing a
 * moderator can do from a menu, and it should take two deliberate passes rather
 * than one mistaken tap.
 */
export type Mode = 'preview' | 'wipe';

/** What was found, and — in `wipe` mode — therefore what went. */
export type PlayerSurvey = {
  userId: string;
  username: string;
  /** Banked points. Gone either way: the record and both boards go with it. */
  points: number;
  coins: number;
  streak: number;
  totalPlayed: number;
  /** Items owned outright. Starters are owned implicitly and are not in here. */
  items: number;
  /** Questions holding a vote by this player. */
  votes: number;
  /** Questions whose stored byline is this player's. */
  authored: number;
  /** Comments still inside their accrual window. */
  comments: number;
  /** Questions walked to find the two counts above. */
  scanned: number;
};

export type WipeOutcome =
  | { status: 'unknown'; username: string }
  | { status: 'previewed'; survey: PlayerSurvey }
  | { status: 'wiped'; survey: PlayerSurvey };

/**
 * Resolve a username to the `t2_` id every key in this app is actually keyed by.
 *
 * The same normalisation and the same failure mode as `grantCoins`: a leading
 * `u/` is stripped, and a name Reddit does not know is reported back rather than
 * thrown, because a typo in a form field is a typo and not a server error.
 *
 * Reddit is asked rather than `users:names`, deliberately. The local hash holds
 * only players who have voted since names started being stored, and somebody who
 * has coins but no votes — a grant, a submission — is not in it. Resolving
 * against Reddit means this tool can reach every account the app has ever
 * written a byte for.
 */
async function resolvePlayer(username: string): Promise<{ userId: string; username: string } | null> {
  const name = username.trim().replace(/^\/?u\//i, '');
  if (!name) return null;

  const user = await reddit.getUserByUsername(name).catch(() => undefined);
  if (!user) return null;
  return { userId: user.id, username: user.username };
}

/**
 * The whole tool: resolve, walk, and — in `wipe` mode — erase.
 *
 * Question rows go before account keys. Neither order is required for
 * correctness, since every step is idempotent and the resolution above does not
 * read anything this deletes, but this way a run that dies partway has already
 * done the expensive half and the re-run is cheap.
 */
export async function wipePlayer(username: string, mode: Mode): Promise<WipeOutcome> {
  const player = await resolvePlayer(username);
  if (!player) return { status: 'unknown', username: username.trim().replace(/^\/?u\//i, '') };

  const { userId } = player;

  const record = await readRecordSummary(userId);
  const questions = await walkQuestions(userId, mode);
  const comments = await walkComments(userId, mode);

  if (mode === 'wipe') await eraseAccount(userId);

  const survey: PlayerSurvey = {
    userId,
    username: player.username,
    ...record,
    ...questions,
    comments,
  };

  if (mode === 'preview') return { status: 'previewed', survey };

  // A destructive moderator action should leave a trace somewhere the app's own
  // logs can be read, because the thing it destroyed is the only other record
  // that it happened. Who ran it is in the route, which is where the moderator
  // check is.
  console.log(
    `wipe-player: erased ${player.username} (${userId}) — ` +
      `${survey.votes} votes over ${survey.scanned} questions, ${survey.authored} bylines, ` +
      `${survey.comments} tracked comments, ${survey.points} points, ${survey.coins} coins`
  );

  return { status: 'wiped', survey };
}

/** The headline numbers, read before anything is deleted so they can be reported. */
async function readRecordSummary(
  userId: string
): Promise<Pick<PlayerSurvey, 'points' | 'coins' | 'streak' | 'totalPlayed' | 'items'>> {
  const [raw, inventory] = await Promise.all([
    redis.hGetAll(keys.user(userId)),
    redis.hGetAll(keys.inventory(userId)),
  ]);

  return {
    points: Number(raw?.points ?? 0) || 0,
    coins: Number(raw?.[userFields.coins] ?? 0) || 0,
    streak: Number(raw?.streak ?? 0) || 0,
    totalPlayed: Number(raw?.totalPlayed ?? 0) || 0,
    items: Object.keys(inventory ?? {}).length,
  };
}

/**
 * Every question this player might have touched.
 *
 * Three range reads unioned: `stats:misjudged` holds every question that has
 * ever been voted on, and the two queues add the ones that have been submitted
 * and not yet answered. A question in none of them has no vote and no queue
 * entry — a house question still waiting in the pool, or one whose post failed —
 * and there is nothing of this player's on it.
 */
async function questionIndex(): Promise<string[]> {
  const [misjudged, pending, approved] = await Promise.all([
    redis.zRange(keys.misjudged, 0, -1, { by: 'rank' }),
    redis.zRange(keys.queuePending, 0, -1, { by: 'rank' }),
    redis.zRange(keys.queueApproved, 0, -1, { by: 'rank' }),
  ]);

  const ids = new Set<string>();
  for (const { member } of [...misjudged, ...pending, ...approved]) ids.add(member);
  return [...ids];
}

/**
 * Walk the index, and take this player off every question they are on.
 *
 * `WIPE_SCAN_BATCH` questions at a time, each costing two reads — the stored
 * vote and the byline — so a wave is a hundred parallel reads and the waves run
 * one after another. The alternative is every question in the subreddit's
 * history in flight at once, which is a way to turn a moderator action into an
 * outage.
 */
async function walkQuestions(
  userId: string,
  mode: Mode
): Promise<Pick<PlayerSurvey, 'votes' | 'authored' | 'scanned'>> {
  const index = await questionIndex();
  let votes = 0;
  let authored = 0;

  for (const batch of chunk(index, WIPE_SCAN_BATCH)) {
    const found = await Promise.all(
      batch.map(async (questionId) => {
        const [vote, authorId] = await Promise.all([
          redis.hGet(keys.voted(questionId), userId),
          redis.hGet(keys.question(questionId), 'authorId'),
        ]);
        return { questionId, vote, mine: authorId === userId };
      })
    );

    for (const { vote, mine } of found) {
      if (vote) votes++;
      if (mine) authored++;
    }

    if (mode !== 'wipe') continue;

    // The erasures go out across the batch rather than one question after
    // another. Nothing in a batch shares a key — every key here is per-question,
    // and the two that are not take a different member each — so the only thing
    // serialising them would buy is a wipe that takes four round trips per vote
    // and times out on anybody who has played for a month.
    await Promise.all(
      found.map(async ({ questionId, vote, mine }) => {
        if (vote) await eraseVote(questionId, userId, vote);
        if (mine) await clearByline(questionId);
      })
    );
  }

  return { votes, authored, scanned: index.length };
}

/**
 * Take one vote off one question, and undo what it did to the question's
 * counters.
 *
 * The `hDel` is the claim. It answers how many fields it removed, and everything
 * below it happens only when that is one — so a second wipe, or a re-run after a
 * crash, finds the row already gone and decrements nothing. This is the same
 * guarantee `castVote` gets from `hSetNX`, read the other way round.
 *
 * The row is deleted *before* the counters move rather than after, which is the
 * safe direction: dying in between leaves a tally that counts a vote belonging to
 * nobody, which is a cosmetic drift of one and is exactly the state the app
 * would be in if counters were never reversed at all. The other order — decrement
 * first, delete second — can be interrupted into a tally that has been
 * decremented twice for one vote, and there is nothing left to detect it with.
 *
 * Nothing here clamps at zero, and that is deliberate. A counter can only go
 * negative if the vote was claimed and never counted — `castVote` takes the
 * `hSetNX` first and tallies after, so a process that died in between leaves
 * exactly that, and its own comment calls it the safe direction to fail in. This
 * carries that pre-existing shortfall one step further rather than inventing it,
 * and the alternative is a read-then-write on every counter of every question to
 * defend against a half-state that a re-post of the tally would fix anyway.
 */
async function eraseVote(questionId: string, userId: string, raw: string): Promise<void> {
  const claimed = await redis.hDel(keys.voted(questionId), [userId]);
  if (claimed === 0) return;

  // The player's own rows on this question, none of which any counter depends
  // on: the distribution entry, the cameo window, and the comment claim.
  await Promise.all([
    redis.zRem(keys.guesses(questionId), [userId]),
    redis.zRem(keys.recent(questionId), [userId]),
    redis.hDel(keys.commented(questionId), [userId]),
  ]);

  const vote = decodeVote(raw);
  // A row that will not decode is a row nothing can be subtracted from. It is
  // gone, which is the part that matters; the counters keep a vote by nobody,
  // which is the same drift a half-finished run leaves and is preferable to
  // guessing at which side and which bucket to decrement.
  if (!vote) return;

  const votesKey = keys.votes(questionId);
  const [, , guessCount] = await Promise.all([
    redis.hIncrBy(votesKey, vote.choice === 'a' ? voteFields.a : voteFields.b, -1),
    redis.hIncrBy(votesKey, voteFields.guessSum, -vote.guess),
    redis.hIncrBy(votesKey, voteFields.guessCount, -1),
    // Read back through the same function the write used, so the decrement
    // cannot land in a different bucket than the increment did.
    redis.hIncrBy(keys.histogram(questionId), String(bucketFor(vote.guess)), -1),
  ]);

  // Votes cast before points existed banked no error, so there is nothing exact
  // to subtract. The score below is recomputed from whatever survives either
  // way, which is what keeps an unsubtractable error from silently inflating the
  // average over a count that has come down.
  const errSum =
    vote.error === undefined
      ? Number(await redis.hGet(votesKey, voteFields.errSum)) || 0
      : await redis.hIncrBy(votesKey, voteFields.errSum, -vote.error);

  await rescoreMisjudged(questionId, errSum, guessCount);
}

/**
 * Put the question back on the misjudged board at its average without this vote,
 * or take it off entirely.
 *
 * `guessCount` at zero is the last vote leaving: there is no average to rank and
 * dividing by it would write a `NaN` score onto a board a moderator reads. The
 * clamp on `errSum` guards the same shape from the other side — an error that
 * could not be subtracted cannot push the sum below zero and turn an average
 * negative.
 */
async function rescoreMisjudged(
  questionId: string,
  errSum: number,
  guessCount: number
): Promise<void> {
  if (guessCount <= 0) {
    await redis.zRem(keys.misjudged, [questionId]);
    return;
  }
  await redis.zAdd(keys.misjudged, {
    member: questionId,
    score: Math.max(0, errSum) / guessCount,
  });
}

/**
 * Drop the byline the app stores, leaving the question itself alone.
 *
 * `toPublicQuestion` only emits `authorName` when it is non-empty, so clearing
 * it renders the question with no author rather than with a blank one — the same
 * thing a house question does, and a shape the client already handles. The
 * Reddit post keeps its real author, because it is a real post the player made
 * under their own account and this app cannot and should not rewrite that.
 */
async function clearByline(questionId: string): Promise<void> {
  await redis.hSet(keys.question(questionId), { authorId: '', authorName: '' });
}

/**
 * Stop tracking this player's comments, and forget what they were paid.
 *
 * The zset is bounded — entries leave on a comment's final settle or the moment
 * it can earn nothing more — so reading it whole is one round trip over a set
 * the hourly sweep already reads in full. The member is `"{userId}:{commentId}"`
 * and neither half can contain a colon, so the prefix test is unambiguous.
 *
 * Dropping the pair is what stops a wiped player being paid again by the next
 * sweep. The comments themselves stay on Reddit, where they are the player's to
 * delete.
 */
async function walkComments(userId: string, mode: Mode): Promise<number> {
  const tracked = await redis.zRange(keys.commentsTracked, 0, -1, { by: 'rank' });
  const prefix = `${userId}:`;
  const mine = tracked.map((entry) => entry.member).filter((member) => member.startsWith(prefix));

  if (mode === 'wipe' && mine.length > 0) {
    await redis.zRem(keys.commentsTracked, mine);
    await redis.hDel(
      keys.commentsPaid,
      mine.map((member) => member.slice(prefix.length))
    );
  }

  return mine.length;
}

/**
 * Everything left: the keys that are wholly theirs, and their row in the shared
 * ones.
 *
 * The two families with a TTL cannot be found by scanning and cannot be derived
 * from the record — which is being deleted in the same breath — so their names
 * are rebuilt from the calendar. `WIPE_DAY_LOOKBACK` and `WIPE_WEEK_LOOKBACK`
 * are each computed from the TTL they cover, so neither can drift out of step
 * with it. Deleting a key that expired days ago costs nothing and answers zero.
 */
async function eraseAccount(userId: string): Promise<void> {
  const today = toDayKey();

  const days: string[] = [];
  for (let back = 0; back < WIPE_DAY_LOOKBACK; back++) days.push(addDays(today, -back));

  const weeks: string[] = [];
  for (let back = 0; back < WIPE_WEEK_LOOKBACK; back++) {
    weeks.push(toWeekKey(fromDayKey(addDays(today, -7 * back))));
  }

  await Promise.all([
    // Tier one: the whole key is theirs.
    redis.del(keys.user(userId)),
    redis.del(keys.earnings(userId)),
    redis.del(keys.inventory(userId)),
    redis.del(keys.submissionRecent(userId)),
    ...days.map((day) => redis.del(keys.submissionCount(userId, day))),

    // Tier two: one row inside a key everybody shares.
    redis.hDel(keys.avatars, [userId]),
    redis.hDel(keys.names, [userId]),
    redis.zRem(keys.pointsAll, [userId]),
    ...weeks.map((week) => redis.zRem(keys.pointsWeek(week), [userId])),
  ]);
}
