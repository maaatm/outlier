/** `POST /api/submit` — create an open question and its post. */

import { Hono } from 'hono';

import type { ApiError, SubmitQuestionRequest } from '../../shared/types.js';
import { submitOpenQuestion } from '../core/submit.js';

export const submitRoutes = new Hono();

submitRoutes.post('/api/submit', async (c) => {
  const body = await c.req.json<Partial<SubmitQuestionRequest>>().catch(() => null);
  if (!body || typeof body.text !== 'string') {
    return c.json<ApiError>({ error: 'Malformed submission.' }, 400);
  }

  const outcome = await submitOpenQuestion({
    text: body.text,
    labelA: typeof body.labelA === 'string' ? body.labelA : 'Yes',
    labelB: typeof body.labelB === 'string' ? body.labelB : 'No',
  });

  // 409 rather than 429: nothing is being rate limited. This is the same
  // question arriving twice, which is a conflict with the one already posted.
  if (outcome.status === 'duplicate') return c.json<ApiError>({ error: outcome.reason }, 409);
  if (outcome.status === 'rejected') return c.json<ApiError>({ error: outcome.reason }, 400);

  return c.json({
    ok: true,
    questionId: outcome.questionId,
    postId: outcome.postId,
    permalink: outcome.permalink,
    coins: outcome.coins,
  });
});
