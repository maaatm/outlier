/**
 * Player-submitted open questions.
 *
 * An open question becomes its own interactive post, playable immediately with
 * the same UI and reveal as the Daily. It counts toward the streak and pays
 * points like any other question, it accumulates real vote data, it enters the
 * promotion queue automatically, and it pays its author coins.
 *
 * **Three a day.** Submission was uncapped while the only door to it was a
 * subreddit menu item most players never open. The room in the app puts it one
 * tap from the front door — including the pinned menu post, where somebody who
 * has never played lands — so uncapped stopped meaning "rarely used" and started
 * meaning an unbounded source of real posts on the subreddit attached to the
 * lowest-friction control in the game. `SUBMISSIONS_PER_DAY` is the bound, and
 * it is a UTC-day allowance rather than a cooldown so that three questions in
 * one sitting is a normal thing to do.
 *
 * Two guards, and they are not the same guard. The allowance is the rate limit.
 * The fingerprint below is not: it refuses an *identical* question from the same
 * player inside a short window, because nothing here is idempotent and a client
 * retrying a request that timed out after the post went up would otherwise
 * create a second post and be paid a second time. Two different questions a
 * second apart are both fine, and always were.
 *
 * The order the guards run in is the whole of what makes them fair, and it is
 * the same rule in both directions: **nothing a player is refused for costs them
 * anything.** The allowance is checked before validation and consumed after it,
 * so a question the filter turns away is not one of the three. It is consumed
 * before the post call rather than after, because a post that throws must not be
 * retryable without limit — a failed post costing one of three is the safe
 * direction.
 *
 * +10 coins per submission is still capped separately by
 * `COIN_ELIGIBLE_SUBMISSIONS_PER_DAY`, which is `Infinity` in `config.ts` and now
 * sits behind an allowance three times smaller than anything it would refuse. It
 * stays because it caps the *reward* and never the submission, and because the
 * allowance is a number a designer may well move.
 */

import { context, redis, reddit } from '@devvit/web/server';

import {
  OPEN_QUESTION_FLAIR,
  SUBMISSIONS_PER_DAY,
  SUBMISSION_COUNT_TTL_SECONDS,
  SUBMISSION_DEDUPE_SECONDS,
} from '../../shared/config.js';
import { toDayKey } from '../../shared/day.js';
import {
  normalizeLabel,
  normalizeQuestionText,
  normalizeTitle,
  submissionFingerprint,
  validateSubmission,
} from '../../shared/validate.js';
import { awardSubmissionCoins } from './coins.js';
import { currentSubredditName } from './daily.js';
import { filterText } from './filter.js';
import { applyFlair } from './flair.js';
import { keys } from './keys.js';
import { linkQuestionToPost, newCommunityQuestionId, writeQuestion } from './questions.js';
import { enqueuePending } from './queue.js';

export type SubmitOutcome =
  | { status: 'ok'; questionId: string; postId: string; permalink: string; coins: number }
  | { status: 'rejected'; reason: string }
  /** The same question, from the same player, seconds ago. Not a rate limit. */
  | { status: 'duplicate'; reason: string }
  /** Today's allowance is spent. This one *is* the rate limit. */
  | { status: 'limited'; reason: string };

/**
 * Claim this exact submission for the dedupe window.
 *
 * `hSetNX` because the claim has to be atomic to be worth anything: the case it
 * exists for is two identical requests in flight at once, which is precisely the
 * case an `exists`-then-`set` would let through. It is the same primitive the
 * vote dedupe and the daily claim are built on.
 *
 * The TTL is refreshed on every claim, so a busy player's earlier fingerprints
 * live slightly longer than the window promises. Harmless: the guard only ever
 * refuses a repeat of something they themselves just sent.
 */
async function claimSubmission(userId: string, fingerprint: string): Promise<boolean> {
  const key = keys.submissionRecent(userId);
  const claimed = await redis.hSetNX(key, fingerprint, '1');
  await redis.expire(key, SUBMISSION_DEDUPE_SECONDS);
  return claimed === 1;
}

/**
 * How many of today's questions this player has left.
 *
 * A read rather than a claim, so it is safe to ask before there is anything to
 * submit: the room asks to decide what to say, and the menu item asks to decide
 * whether to open the form at all. What actually spends one is
 * `countSubmission`, below.
 */
export async function remainingSubmissions(userId: string): Promise<number> {
  const posted = Number(await redis.get(keys.submissionCount(userId, toDayKey()))) || 0;
  return Math.max(0, SUBMISSIONS_PER_DAY - posted);
}

/**
 * Spend one of today's.
 *
 * `incrBy` rather than a read and a write back: two submissions in flight at
 * once would otherwise both read two-of-three remaining and both take the third.
 * The expiry is reset on every increment, which is why it only has to outlive a
 * day rather than land on midnight — the day in the key is what bounds the
 * count, and the TTL is only there so old keys clean themselves up.
 */
export async function countSubmission(userId: string): Promise<void> {
  const key = keys.submissionCount(userId, toDayKey());
  await redis.incrBy(key, 1);
  await redis.expire(key, SUBMISSION_COUNT_TTL_SECONDS);
}

export async function submitOpenQuestion(input: {
  text: string;
  labelA: string;
  labelB: string;
  /** Empty means the question text is the title, the way every record used to. */
  title?: string;
}): Promise<SubmitOutcome> {
  const userId = context.userId;
  if (!userId) return { status: 'rejected', reason: 'Sign in to submit a question.' };

  // Checked before anything is validated, so somebody with nothing left today
  // is told so rather than told their question is fine and then refused.
  if ((await remainingSubmissions(userId)) <= 0) {
    return {
      status: 'limited',
      reason: `That is ${SUBMISSIONS_PER_DAY} for today. The count starts over at midnight UTC.`,
    };
  }

  const text = normalizeQuestionText(input.text);
  const labelA = normalizeLabel(input.labelA, 'Yes');
  const labelB = normalizeLabel(input.labelB, 'No');
  const typedTitle = input.title ?? '';

  const valid = validateSubmission(text, labelA, labelB, typedTitle);
  if (!valid.ok) return { status: 'rejected', reason: valid.reason };

  const filtered = filterText(text, 'question');
  if (!filtered.ok) return { status: 'rejected', reason: filtered.reason };

  const title = normalizeTitle(typedTitle, text);

  // The title goes through the same filter as the question, and this is the
  // point of having one: a title field that skipped it would be an unfiltered
  // path to a real post made under the player's own account — on the half of the
  // post the feed actually shows. Skipped only when it fell back to the
  // question, which is the same string and has just passed the same check.
  if (title !== text) {
    const filteredTitle = filterText(title, 'title');
    if (!filteredTitle.ok) return { status: 'rejected', reason: filteredTitle.reason };
  }

  // Claimed before the post is created, which is the only order that helps: a
  // submission that fails after the post went up must not be retryable into a
  // second post.
  if (!(await claimSubmission(userId, submissionFingerprint(text, labelA, labelB)))) {
    return {
      status: 'duplicate',
      reason: 'That one is already on its way up. Try a different question.',
    };
  }

  const authorName = context.username ?? (await reddit.getCurrentUsername()) ?? '';
  const questionId = newCommunityQuestionId();

  // Spent here rather than after the post, and everything above this line is a
  // refusal that costs nothing. Past this point the alternative is a post call
  // that can be retried without limit, and a failed post costing one of three is
  // the safer of the two directions.
  await countSubmission(userId);

  await writeQuestion({
    id: questionId,
    text,
    title,
    labelA,
    labelB,
    authorId: userId,
    authorName,
    source: 'community',
  });

  const subredditName = await currentSubredditName();

  let post;
  try {
    post = await reddit.submitCustomPost({
      subredditName,
      title,
      runAs: 'USER',
      // What Reddit's safety review reads. The title is user-authored content
      // that is not otherwise in here, and it is only left out when it is the
      // question repeated.
      userGeneratedContent: { text: title === text ? text : `${title}\n\n${text}` },
      textFallback: {
        text: `${text}\n\nAnswer, then guess what percentage of people agreed with you.`,
      },
    });
  } catch (error) {
    // The record is written first on purpose — a post that went up with no
    // question behind it is a live post that answers "no question on this post",
    // which is the worse of the two half-states and the one that cannot be
    // cleaned up. This is the other half: a post call that throws leaves a
    // `q:{id}` hash with no post, no `post:` mapping and no way to reach it.
    // Rare through a subreddit menu, routine once the button is in the app and
    // people retry. Dropping it is the whole of the cleanup — nothing else has
    // been written yet, and the queue has not been told about it.
    //
    // The dedupe claim is deliberately *not* released. A throw is not proof the
    // post failed — a timeout can leave one standing — and the allowance already
    // bounds the retries.
    console.error('submit-question: post failed, dropping the orphan record', error);
    await redis.del(keys.question(questionId));
    return {
      status: 'rejected',
      reason: 'Reddit would not take that post. Nothing went up, so try again in a moment.',
    };
  }

  await linkQuestionToPost(questionId, post.id, post.permalink);
  await enqueuePending(questionId, 1);

  // Paid once the post exists, so a submission that fell over on the way there
  // pays nothing.
  const coins = await awardSubmissionCoins(userId);

  // Last, after the post is reachable, queued and paid for. The label rode
  // inside the submit as `flairText` until Devvit 0.14.1 took the app account's
  // moderator scope away, which turned a cosmetic flair into something that
  // could refuse a player's question outright and spend one of their three for
  // the day on nothing. Out here it is expected to fail and costs the player
  // nothing when it does — see `core/flair.ts`.
  await applyFlair(subredditName, post.id, OPEN_QUESTION_FLAIR);

  return { status: 'ok', questionId, postId: post.id, permalink: post.permalink, coins };
}
