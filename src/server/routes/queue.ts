/**
 * Moderator-only queue endpoints.
 *
 * Every route here re-checks moderator status. The menu items that lead to them
 * are already restricted by Devvit, but the endpoints are reachable directly and
 * a hidden button is not an authorisation check.
 */

import { Hono } from 'hono';

import type { ApiError, QueueResponse } from '../../shared/types.js';
import { isModerator } from '../core/mod.js';
import { approve, listApproved, listPending, reject } from '../core/queue.js';

export const queueRoutes = new Hono();

queueRoutes.use('/api/queue/*', async (c, next) => {
  if (!(await isModerator())) {
    return c.json<ApiError>({ error: 'Moderators only.' }, 403);
  }
  await next();
});

queueRoutes.get('/api/queue', async (c) => {
  if (!(await isModerator())) return c.json<ApiError>({ error: 'Moderators only.' }, 403);
  const [pending, approved] = await Promise.all([listPending(), listApproved()]);
  return c.json<QueueResponse>({ pending, approved });
});

queueRoutes.post('/api/queue/:id/approve', async (c) => {
  const id = c.req.param('id');
  const moved = await approve(id);
  if (!moved) return c.json<ApiError>({ error: 'Not in the pending queue.' }, 404);
  return c.json({ ok: true, id, state: 'approved' });
});

queueRoutes.post('/api/queue/:id/reject', async (c) => {
  const id = c.req.param('id');
  const removed = await reject(id);
  if (!removed) return c.json<ApiError>({ error: 'Not in the pending queue.' }, 404);
  return c.json({ ok: true, id, state: 'rejected' });
});
