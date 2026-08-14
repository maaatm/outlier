/**
 * Player-submitted open questions.
 *
 * An open question becomes its own interactive post, playable immediately with
 * the same UI and reveal as the Daily. It counts toward the streak and pays
 * points like any other question, it accumulates real vote data, it enters the
 * promotion queue automatically, and it pays its author coins.
 *
 * **Submission is uncapped.** The one-per-24h cooldown that used to live here is
 * gone: more questions is the goal for now. Two things follow from that, and
 * both are deliberate.
 *
 * The first is that +10 coins on an uncapped action is an unbounded coin source
 * whose side effect is a real Reddit post every time — so the pressure lands on
 * the subreddit's front page and the mod queue, not just on the economy. Every
 * filter that exists catches slurs, links and off-limits topics; none of them
 * catches *boring*, and boring is what a coin farm produces.
 * `COIN_ELIGIBLE_SUBMISSIONS_PER_DAY` is the valve for that, wired here and
 * `Infinity` in `config.ts`, so capping the reward is a one-line config change
 * rather than a code change. It caps the reward and never the submission.
 *
 * The second is that the cooldown was also, incidentally, the thing stopping a
 * half-failed submission from being retried into a flood — nothing below is
 * idempotent, so a client retrying a request that timed out after the post went
 * up would create a second post and be paid a second time. The dedupe guard
 * replaces that specific protection and nothing else: it refuses an *identical*
 * submission from the same player inside a short window, and two different
 * questions a second apart are both fine.
 */

import { context, redis, reddit } from '@devvit/web/server';

import { OPEN_QUESTION_FLAIR, SUBMISSION_DEDUPE_SECONDS } from '../../shared/config.js';
import {
  normalizeLabel,
  normalizeQuestionText,
  submissionFingerprint,
  validateSubmission,
} from '../../shared/validate.js';
import { awardSubmissionCoins } from './coins.js';
import { currentSubredditName } from './daily.js';
import { filterQuestionText } from './filter.js';
import { keys } from './keys.js';
import { linkQuestionToPost, newCommunityQuestionId, writeQuestion } from './questions.js';
import { enqueuePending } from './queue.js';

export type SubmitOutcome =
  | { status: 'ok'; questionId: string; postId: string; permalink: string; coins: number }
  | { status: 'rejected'; reason: string }
  /** The same question, from the same player, seconds ago. Not a rate limit. */
  | { status: 'duplicate'; reason: string };

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

export async function submitOpenQuestion(input: {
  text: string;
  labelA: string;
  labelB: string;
}): Promise<SubmitOutcome> {
  const userId = context.userId;
  if (!userId) return { status: 'rejected', reason: 'Sign in to submit a question.' };

  const text = normalizeQuestionText(input.text);
  const labelA = normalizeLabel(input.labelA, 'Yes');
  const labelB = normalizeLabel(input.labelB, 'No');

  const valid = validateSubmission(text, labelA, labelB);
  if (!valid.ok) return { status: 'rejected', reason: valid.reason };

  const filtered = filterQuestionText(text);
  if (!filtered.ok) return { status: 'rejected', reason: filtered.reason };

  // Claimed before the post is created, which is the only order that helps: a
  // submission that fails after the post went up must not be retryable into a
  // second post.
  if (!(await claimSubmission(userId, submissionFingerprint(text, labelA, labelB)))) {
    return {
      status: 'duplicate',
      reason: 'That question is already on its way up. Ask a different one.',
    };
  }

  const authorName = context.username ?? (await reddit.getCurrentUsername()) ?? '';
  const questionId = newCommunityQuestionId();

  await writeQuestion({
    id: questionId,
    text,
    labelA,
    labelB,
    authorId: userId,
    authorName,
    source: 'community',
  });

  const post = await reddit.submitCustomPost({
    subredditName: await currentSubredditName(),
    title: text,
    flairText: OPEN_QUESTION_FLAIR,
    runAs: 'USER',
    userGeneratedContent: { text },
    textFallback: {
      text: `${text}\n\nAnswer, then guess what percentage of people agreed with you.`,
    },
  });

  await linkQuestionToPost(questionId, post.id, post.permalink);
  await enqueuePending(questionId, 1);

  // Paid once the post exists, so a submission that fell over on the way there
  // pays nothing.
  const coins = await awardSubmissionCoins(userId);

  return { status: 'ok', questionId, postId: post.id, permalink: post.permalink, coins };
}
