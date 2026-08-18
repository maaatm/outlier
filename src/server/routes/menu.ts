/**
 * Menu item endpoints. Each returns a `UiResponse` telling the Reddit client
 * what to do next — usually open a form, sometimes just show a toast.
 */

import { context, notifications, reddit } from '@devvit/web/server';
import type { UiResponse } from '@devvit/web/shared';
import { Hono } from 'hono';

import {
  MOD_QUEUE_PAGE_SIZE,
  SUBMISSIONS_PER_DAY,
  SUBMITTED_LABEL_MAX_LENGTH,
  SUBMITTED_QUESTION_MAX_LENGTH,
  TITLE_MAX_LENGTH,
} from '../../shared/config.js';
import { SUBMISSION_GUIDANCE } from '../../shared/validate.js';
import { currentSubredditName, postDaily } from '../core/daily.js';
import { pinMenuPost } from '../core/menuPost.js';
import { isModerator } from '../core/mod.js';
import { listPending } from '../core/queue.js';
import { misjudgedLeaderboard, renderLeaderboardPost } from '../core/stats.js';
import { remainingSubmissions } from '../core/submit.js';

export const menuRoutes = new Hono();

/**
 * "Submit a question" — the same flow as the room in the app, from outside it.
 *
 * Kept deliberately. It is the only path for somebody who never opens a post,
 * and both entry points call `submitOpenQuestion` and read the same constants,
 * so there is no second copy of any rule to keep in step.
 */
menuRoutes.post('/internal/menu/submit-question', async (c) => {
  const userId = context.userId;
  if (!userId) {
    return c.json<UiResponse>({ showToast: 'Sign in to submit a question.' });
  }

  // The one thing worth knowing before a form opens: everything else about a
  // submission needs a submission to judge, but the allowance is spent or it is
  // not, and four fields typed into a form that will refuse them is worse than
  // being told first.
  const remaining = await remainingSubmissions(userId);
  if (remaining <= 0) {
    return c.json<UiResponse>({
      showToast: `That is ${SUBMISSIONS_PER_DAY} for today. The count starts over at midnight UTC.`,
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
            helpText: `Up to ${SUBMITTED_QUESTION_MAX_LENGTH} characters, which is what the question block on the post holds.`,
            required: true,
            placeholder: 'Do you eat the pizza crust?',
          },
          {
            type: 'string',
            name: 'labelA',
            label: 'First answer',
            helpText: `Up to ${SUBMITTED_LABEL_MAX_LENGTH} characters — it has to fit on a button.`,
            defaultValue: 'Yes',
            required: true,
          },
          {
            type: 'string',
            name: 'labelB',
            label: 'Second answer',
            defaultValue: 'No',
            required: true,
          },
          {
            type: 'string',
            name: 'title',
            label: 'Post title (optional)',
            helpText: `Leave it empty and the question is the title. Up to ${TITLE_MAX_LENGTH} characters.`,
            required: false,
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

/** "Pin the menu post" — the subreddit's front door for somebody new. */
menuRoutes.post('/internal/menu/pin-menu-post', async (c) => {
  if (!(await isModerator())) {
    return c.json<UiResponse>({ showToast: 'Moderators only.' });
  }

  const result = await pinMenuPost();

  if (result.status === 'exists') {
    return c.json<UiResponse>({
      navigateTo: result.permalink,
      showToast: 'The menu post is already up.',
    });
  }

  return c.json<UiResponse>({
    navigateTo: result.permalink,
    showToast: result.pinned
      ? { text: 'Menu post pinned.', appearance: 'success' }
      : 'Menu post created, but it could not be pinned — check the sticky slots.',
  });
});

/**
 * "Grant coins" — put a balance in an account without playing for one.
 *
 * Moderators only, re-checked here rather than trusted from the menu item's
 * `forUserType`, which hides a button and gates nothing. It exists for testing:
 * every way to earn is slow on purpose, and a wardrobe with no coins behind it
 * cannot be tried out.
 *
 * The fields are prefilled with the account and the amount this was first needed
 * for, because a form whose defaults are the common case is one tap.
 */
menuRoutes.post('/internal/menu/grant-coins', async (c) => {
  if (!(await isModerator())) {
    return c.json<UiResponse>({ showToast: 'Moderators only.' });
  }

  return c.json<UiResponse>({
    showForm: {
      name: 'grantCoins',
      form: {
        title: 'Grant coins',
        description:
          'Adds to a balance. Coins are spent on gift boxes in the wardrobe; points and ' +
          'the leaderboards are untouched.',
        acceptLabel: 'Grant',
        cancelLabel: 'Cancel',
        fields: [
          {
            type: 'string',
            name: 'username',
            label: 'Username',
            helpText: 'Without the u/.',
            defaultValue: 'spottylawyer',
            required: true,
          },
          {
            type: 'number',
            name: 'amount',
            label: 'Coins',
            defaultValue: 3000,
            required: true,
          },
        ],
      },
    },
  });
});

/**
 * TEMPORARY — the step-0 probe from `docs/prompts/07-push-notifications.md`.
 *
 * `@devvit/notifications` ships marked experimental, and an experimental plugin
 * may simply not be switched on for this app. This asks it two questions that
 * change nothing — is there a badge, and is there anybody opted in — and reports
 * what came back. The only answer it is looking for is whether the call returns
 * or throws.
 *
 * Delete this handler and its menu item once the answer is in the logs. It is a
 * probe, not a feature.
 */
menuRoutes.post('/internal/menu/push-probe', async (c) => {
  if (!(await isModerator())) {
    return c.json<UiResponse>({ showToast: 'Moderators only.' });
  }

  try {
    const badge = await notifications.getGameBadgeStatus();
    const optedIn = await notifications.listOptedInUsers({ limit: 1 });
    console.log(
      `push-probe: badge=${JSON.stringify(badge)} optedIn=${JSON.stringify(optedIn)}`
    );
    return c.json<UiResponse>({
      showToast: `Plugin answered. Badge: ${badge.hasActiveBadge}. Opted in: ${optedIn.userIds.length}.`,
    });
  } catch (error) {
    // The whole point of the probe. Logged in full, because the message is what
    // decides whether `PUSH_ENABLED` ships true or false.
    console.error('push-probe: the notifications plugin threw', error);
    const reason = error instanceof Error ? error.message : String(error);
    return c.json<UiResponse>({ showToast: `Plugin threw: ${reason}` });
  }
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
