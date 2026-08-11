/**
 * Form submit handlers. Devvit posts the form values here; the response is a
 * `UiResponse` that closes the loop with a toast or a navigation.
 */

import type { UiResponse } from '@devvit/web/shared';
import { Hono } from 'hono';

import { isModerator } from '../core/mod.js';
import { approve, reject } from '../core/queue.js';
import { submitOpenQuestion } from '../core/submit.js';

export const formRoutes = new Hono();

/** Devvit sends select values as arrays; string fields come through as strings. */
function firstValue(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : '';
  return typeof value === 'string' ? value : '';
}

formRoutes.post('/internal/forms/submit-question', async (c) => {
  const values = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));

  const outcome = await submitOpenQuestion({
    text: firstValue(values.text),
    labelA: firstValue(values.labelA) || 'Yes',
    labelB: firstValue(values.labelB) || 'No',
  });

  if (outcome.status !== 'ok') {
    return c.json<UiResponse>({ showToast: outcome.reason });
  }

  return c.json<UiResponse>({
    navigateTo: outcome.permalink,
    showToast: { text: 'Posted. It is playable now.', appearance: 'success' },
  });
});

formRoutes.post('/internal/forms/review-queue', async (c) => {
  if (!(await isModerator())) {
    return c.json<UiResponse>({ showToast: 'Moderators only.' });
  }

  const values = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
  const questionId = firstValue(values.questionId);
  const action = firstValue(values.action);

  if (!questionId) return c.json<UiResponse>({ showToast: 'Pick a question first.' });

  if (action === 'reject') {
    const done = await reject(questionId);
    return c.json<UiResponse>({
      showToast: done ? 'Rejected. It is out of the queue.' : 'That one is no longer pending.',
    });
  }

  const done = await approve(questionId);
  return c.json<UiResponse>({
    showToast: done
      ? { text: 'Approved. It can take the Daily slot now.', appearance: 'success' }
      : 'That one is no longer pending.',
  });
});
