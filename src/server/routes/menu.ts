/**
 * Menu item endpoints. Each returns a `UiResponse` telling the Reddit client
 * what to do next — usually open a form, sometimes just show a toast.
 */

import { context, reddit } from '@devvit/web/server';
import type { UiResponse } from '@devvit/web/shared';
import { Hono } from 'hono';

import { LABEL_MAX_LENGTH, QUESTION_MAX_LENGTH, MOD_QUEUE_PAGE_SIZE } from '../../shared/config.js';
import { SUBMISSION_GUIDANCE } from '../../shared/validate.js';
import { currentSubredditName, postDaily } from '../core/daily.js';
import { isModerator } from '../core/mod.js';
import { listPending } from '../core/queue.js';
import { checkCooldown } from '../core/submit.js';
import { misjudgedLeaderboard, renderLeaderboardPost } from '../core/stats.js';

export const menuRoutes = new Hono();

/** "Submit a question" — the whole open-question flow starts here. */
menuRoutes.post('/internal/menu/submit-question', async (c) => {
  if (!context.userId) {
    return c.json<UiResponse>({ showToast: 'Sign in to submit a question.' });
  }

  if (await checkCooldown(context.userId)) {
    return c.json<UiResponse>({
      showToast: 'One question per day. Yours is already in the queue.',
    });
  }

  return c.json<UiResponse>({
    showForm: {
      name: 'submitQuestion',
      form: {
        title: 'Ask the subreddit something',
        description: SUBMISSION_GUIDANCE,
        acceptLabel: 'Post it',
        cancelLabel: 'Not yet',
        fields: [
          {
            type: 'string',
            name: 'text',
            label: 'Your question',
            helpText: `Ends in a question mark. Up to ${QUESTION_MAX_LENGTH} characters.`,
            required: true,
            placeholder: 'Do you eat the pizza crust?',
          },
          {
            type: 'string',
            name: 'labelA',
            label: 'First answer',
            helpText: `Up to ${LABEL_MAX_LENGTH} characters.`,
            defaultValue: 'Yes',
            required: true,
          },
          {
            type: 'string',
            name: 'labelB',
            label: 'Second answer',
            helpText: `Up to ${LABEL_MAX_LENGTH} characters.`,
            defaultValue: 'No',
            required: true,
          },
        ],
      },
    },
  });
});

/** "Review the question queue" — top pending questions, approve or reject. */
menuRoutes.post('/internal/menu/review-queue', async (c) => {
  if (!(await isModerator())) {
    return c.json<UiResponse>({ showToast: 'Moderators only.' });
  }

  const pending = await listPending(MOD_QUEUE_PAGE_SIZE);
  if (pending.length === 0) {
    return c.json<UiResponse>({ showToast: 'Nothing waiting in the queue.' });
  }

  return c.json<UiResponse>({
    showForm: {
      name: 'reviewQueue',
      form: {
        title: `Question queue · ${pending.length} waiting`,
        description:
          'Approved questions become eligible for the Daily once they clear the upvote ' +
          'threshold. Rejected ones leave the queue; their post stays up and playable.',
        acceptLabel: 'Apply',
        fields: [
          {
            type: 'select',
            name: 'questionId',
            label: 'Question',
            required: true,
            options: pending.map((entry) => ({
              label: `${entry.upvotes} · ${entry.text}`,
              value: entry.id,
            })),
          },
          {
            type: 'select',
            name: 'action',
            label: 'Decision',
            required: true,
            defaultValue: ['approve'],
            options: [
              { label: 'Approve — eligible for the Daily', value: 'approve' },
              { label: 'Reject — remove from the queue', value: 'reject' },
            ],
          },
        ],
      },
    },
  });
});

/** "Post today's Daily now" — the same resolution the scheduler runs. */
menuRoutes.post('/internal/menu/post-daily-now', async (c) => {
  if (!(await isModerator())) {
    return c.json<UiResponse>({ showToast: 'Moderators only.' });
  }

  const result = await postDaily();
  if (result.status === 'exists') {
    return c.json<UiResponse>({ showToast: `Today's Daily is already up (${result.day}).` });
  }

  return c.json<UiResponse>({
    navigateTo: `https://reddit.com/comments/${result.postId.replace(/^t3_/, '')}`,
    showToast: { text: 'Daily posted.', appearance: 'success' },
  });
});

/** "Post the misjudged leaderboard" — the recurring event post. */
menuRoutes.post('/internal/menu/post-leaderboard', async (c) => {
  if (!(await isModerator())) {
    return c.json<UiResponse>({ showToast: 'Moderators only.' });
  }

  const entries = await misjudgedLeaderboard();
  if (entries.length === 0) {
    return c.json<UiResponse>({ showToast: 'No question has enough votes to rank yet.' });
  }

  const post = await reddit.submitPost({
    subredditName: await currentSubredditName(),
    title: 'The questions nobody could read',
    text: renderLeaderboardPost(entries),
  });

  return c.json<UiResponse>({
    navigateTo: post.permalink,
    showToast: { text: 'Leaderboard posted.', appearance: 'success' },
  });
});
