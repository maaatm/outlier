/**
 * Server entrypoint.
 *
 * Hono handles routing; Devvit supplies the server. `getRequestListener` turns
 * Hono's fetch handler into a Node request listener, which is the interface
 * `createServer` implements.
 */

import { createServer, getServerPort } from '@devvit/web/server';
import type { UiResponse } from '@devvit/web/shared';
import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';
import type { Context } from 'hono';

import { REPLAY_MODE } from '../shared/config.js';
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

/**
 * A menu item is not a fetch. Devvit renders a `UiResponse` from these routes,
 * so answering one with an `ApiError` body gets the moderator a bare "an error
 * occurred" with the reason nowhere on screen. These two handlers put the reason
 * in a toast instead.
 *
 * The audience for a menu item is a moderator acting on their own subreddit, so
 * the real message is theirs to see — guessing at what went wrong from an opaque
 * failure is worse for everyone.
 */
function isMenuRequest(c: Context): boolean {
  return c.req.path.startsWith('/internal/menu/');
}

app.onError((error, c) => {
  // Devvit surfaces nothing useful from a thrown error, so log it here and hand
  // the caller something it can render.
  console.error(`unhandled error on ${c.req.path}`, error);

  if (isMenuRequest(c)) {
    const reason = error instanceof Error ? error.message : String(error);
    return c.json<UiResponse>({ showToast: `Outlier: ${reason}` });
  }

  return c.json({ error: 'Something went wrong on our end.' }, 500);
});

app.notFound((c) => {
  // Almost always a menu item or task declared in `devvit.json` whose route did
  // not ship — the config and the server travel separately, and only one of them
  // has to be stale for this to happen.
  console.error(`no route for ${c.req.method} ${c.req.path}`);

  if (isMenuRequest(c)) {
    return c.json<UiResponse>({
      showToast: `Outlier: this menu item has no endpoint on the server (${c.req.path}). Re-upload the app.`,
    });
  }

  return c.json({ error: 'No such endpoint.' }, 404);
});

if (REPLAY_MODE) {
  // Loud on purpose. This is the vote dedupe switched off, and it is the one
  // setting in the app that must never reach a real subreddit unnoticed.
  console.warn(
    'REPLAY_MODE is on: votes are not remembered and one account can vote ' +
      'repeatedly. Set REPLAY_MODE to false in src/shared/config.ts before release.'
  );
}

const server = createServer(getRequestListener(app.fetch));
server.listen(getServerPort());
