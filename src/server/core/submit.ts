/**
 * Player-submitted open questions.
 *
 * An open question becomes its own interactive post, playable immediately with
 * the same UI and reveal as the Daily. It counts toward the streak and pays
 * points like any other question, it accumulates real vote data, and it enters
 * the promotion queue automatically.
 */

import { context, redis, reddit } from '@devvit/web/server';

import { OPEN_QUESTION_FLAIR, SUBMISSION_COOLDOWN_SECONDS } from '../../shared/config.js';
import { normalizeLabel, normalizeQuestionText, validateSubmission } from '../../shared/validate.js';
import { currentSubredditName } from './daily.js';
import { filterQuestionText } from './filter.js';
import { keys } from './keys.js';
import { linkQuestionToPost, newCommunityQuestionId, writeQuestion } from './questions.js';
import { enqueuePending } from './queue.js';

export type SubmitOutcome =
  | { status: 'ok'; questionId: string; postId: string; permalink: string }
  | { status: 'rejected'; reason: string }
  | { status: 'cooldown'; reason: string };

/**
 * The rate limit is a Redis key with a TTL, checked here and nowhere else. It is
 * deliberately not a client-side concern — the client cannot be trusted to hold
 * a limit that costs it nothing to ignore.
 */
export async function checkCooldown(userId: string): Promise<boolean> {
  return (await redis.exists(keys.submissionCooldown(userId))) > 0;
}

async function startCooldown(userId: string): Promise<void> {
  await redis.set(keys.submissionCooldown(userId), String(Date.now()), {
    expiration: new Date(Date.now() + SUBMISSION_COOLDOWN_SECONDS * 1000),
  });
}

export async function submitOpenQuestion(input: {
  text: string;
  labelA: string;
  labelB: string;
}): Promise<SubmitOutcome> {
  const userId = context.userId;
  if (!userId) return { status: 'rejected', reason: 'Sign in to submit a question.' };

  if (await checkCooldown(userId)) {
    return {
      status: 'cooldown',
      reason: 'One question per day. Yours is already in the queue — try again tomorrow.',
    };
  }

  const text = normalizeQuestionText(input.text);
  const labelA = normalizeLabel(input.labelA, 'Yes');
  const labelB = normalizeLabel(input.labelB, 'No');

  const valid = validateSubmission(text, labelA, labelB);
  if (!valid.ok) return { status: 'rejected', reason: valid.reason };

  const filtered = filterQuestionText(text);
  if (!filtered.ok) return { status: 'rejected', reason: filtered.reason };

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

  // The cooldown starts before the post call, so a submission that fails
  // halfway cannot be retried into a flood.
  await startCooldown(userId);

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

  return { status: 'ok', questionId, postId: post.id, permalink: post.permalink };
}
