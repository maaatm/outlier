/**
 * Server entrypoint.
 *
 * Hono handles routing; Devvit supplies the server. `getRequestListener` turns
 * Hono's fetch handler into a Node request listener, which is the interface
 * `createServer` implements.
 */

import { createServer, getServerPort } from '@devvit/web/server';
import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';

import { api } from './routes/api.js';
import { formRoutes } from './routes/forms.js';
import { menuRoutes } from './routes/menu.js';
import { queueRoutes } from './routes/queue.js';
import { submitRoutes } from './routes/submit.js';
import { taskRoutes } from './routes/tasks.js';

const app = new Hono();

app.route('/', api);
app.route('/', submitRoutes);
app.route('/', queueRoutes);
app.route('/', menuRoutes);
app.route('/', formRoutes);
app.route('/', taskRoutes);

app.onError((error, c) => {
  // Devvit surfaces nothing useful from a thrown error, so log it here and hand
  // the client something it can render.
  console.error('unhandled error', error);
  return c.json({ error: 'Something went wrong on our end.' }, 500);
});

app.notFound((c) => c.json({ error: 'No such endpoint.' }, 404));

const server = createServer(getRequestListener(app.fetch));
server.listen(getServerPort());
