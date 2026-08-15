/**
 * Form submit handlers. Devvit posts the form values here; the response is a
 * `UiResponse` that closes the loop with a toast or a navigation.
 */

import type { UiResponse } from '@devvit/web/shared';
import { Hono } from 'hono';

import { grantCoins } from '../core/coins.js';
import { isModerator } from '../core/mod.js';
import { approve, reject } from '../core/queue.js';
import { submitOpenQuestion } from '../core/submit.js';

export const formRoutes = new Hono();

/** Devvit sends select values as arrays; string fields come through as strings. */
function firstValue(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : '';
  return typeof value === 'string' ? value : '';
}

/**
 * A number field arrives as a number rather than a string, so it needs its own
 * reader — `firstValue` would answer '' for a perfectly good 3000. Anything that
 * does not parse comes back NaN and is rejected by the caller.
 */
function numberValue(value: unknown): number {
  return Number(Array.isArray(value) ? value[0] : value);
}

formRoutes.post('/internal/forms/submit-question', async (c) => {
  const values = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));

  const outcome = await submitOpenQuestion({
    text: firstValue(values.text),
    labelA: firstValue(values.labelA) || 'Yes',
    labelB: firstValue(values.labelB) || 'No',
    // Optional in the form and optional here. An untouched field arrives as ''
    // and means what it means everywhere else: the question is the title.
    title: firstValue(values.title),
  });

  if (outcome.status !== 'ok') {
    return c.json<UiResponse>({ showToast: outcome.reason });
  }

  // The coins are named only when they were actually paid. Past the eligibility
  // cap — off by default — the question still posts and the toast simply says
  // so, rather than announcing a reward of zero.
  const paid = outcome.coins > 0 ? ` +${outcome.coins} coins.` : '';

  return c.json<UiResponse>({
    navigateTo: outcome.permalink,
    showToast: { text: `Posted. It is playable now.${paid}`, appearance: 'success' },
  });
});

/**
 * The grant form's other half. Mod-checked again here: the check on the menu
 * item guards the button, and this endpoint is reachable without it.
 */
formRoutes.post('/internal/forms/grant-coins', async (c) => {
  if (!(await isModerator())) {
    return c.json<UiResponse>({ showToast: 'Moderators only.' });
  }

  const values = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
  const username = firstValue(values.username);
  const amount = Math.floor(numberValue(values.amount));

  if (!username) return c.json<UiResponse>({ showToast: 'Name somebody first.' });
  if (!Number.isFinite(amount) || amount <= 0) {
    return c.json<UiResponse>({ showToast: 'Grant a whole number of coins above zero.' });
  }

  const outcome = await grantCoins(username, amount);
  if (outcome.status === 'unknown') {
    return c.json<UiResponse>({ showToast: `Reddit does not know u/${outcome.username}.` });
  }

  return c.json<UiResponse>({
    showToast: {
      text: `u/${outcome.username} now has ${outcome.coins} coins.`,
      appearance: 'success',
    },
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
