/** `POST /api/submit` — create an open question and its post. */

import { Hono } from 'hono';

import type { ApiError, SubmitQuestionRequest, SubmitQuestionResponse } from '../../shared/types.js';
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
    // Absent and empty mean the same thing here and all the way down: the
    // question is the title.
    title: typeof body.title === 'string' ? body.title : '',
  });

  // Three codes for three different refusals, because the room says something
  // different about each. 429 is the allowance and the only one of the three
  // that will still refuse the same request in an hour; 409 is the same question
  // arriving twice, which is a conflict with the one already posted; 400 is
  // something about the submission itself.
  if (outcome.status === 'limited') return c.json<ApiError>({ error: outcome.reason }, 429);
  if (outcome.status === 'duplicate') return c.json<ApiError>({ error: outcome.reason }, 409);
  if (outcome.status === 'rejected') return c.json<ApiError>({ error: outcome.reason }, 400);

  // The coins are not on the response. The room navigates to the new post on
  // success, so there is nowhere to spend a number it would have to fetch the
  // balance to make sense of — and the Devvit form reads the outcome directly.
  return c.json<SubmitQuestionResponse>({
    ok: true,
    questionId: outcome.questionId,
    postId: outcome.postId,
    permalink: outcome.permalink,
  });
});
