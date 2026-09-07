/**
 * The grant that decides whose name is on what the game posts.
 *
 * `runAs: 'USER'` on the server is not enough by itself. Reddit gates acting on
 * somebody's behalf on a grant that account has given this app, and the only
 * thing that can ask for one is the client, from inside a trusted gesture.
 * Without it the server's call still succeeds and still comes back with a
 * permalink — it is simply authored by the app account. That is the whole of the
 * bug this file closes: not a refusal anybody could see, just the wrong name on
 * every comment.
 *
 * **Nothing here is a consent screen of ours.** `canRunAsUser` answers `true`
 * and shows nothing when the client does not carry the feature, and `true` and
 * shows nothing when the grant is already held. The only time a player sees
 * anything is Reddit's own sheet, once, ever. So pressing "Post comment" is the
 * consent, and this is the call that carries it — there is no screen to add, no
 * copy to write, and nothing to ask twice.
 *
 * The grant is all-or-nothing across every scope in `devvit.json`, so whichever
 * of commenting, asking a question and joining a player reaches first covers the
 * other two for good.
 */

import { canRunAsUser } from '@devvit/web/client';

/**
 * How long to wait for the client to answer before going ahead without it.
 *
 * Generous, because the wait is only ever paid once per player and what sits
 * behind it may be a sheet they have to read. Short enough that a client which
 * never answers costs a pause rather than a dead button.
 */
const GRANT_TIMEOUT_MS = 5000;

/**
 * Ask for the grant, and never let the asking cost the tap.
 *
 * Two things can go wrong here and both end the same way — we go ahead and post.
 * The effect underneath resolves only when the host answers it and carries no
 * timeout of its own, so a client that advertises the feature and then does not
 * reply would otherwise wedge the button it was pressed on for the rest of the
 * session. The race is that missing timeout. The `catch` is the other half: a
 * throw is Reddit declining to be asked, which is not the player declining
 * anything.
 *
 * Failing open is also what Devvit does with its own hand — it drops the
 * permission state entirely on clients too old to honour it and lets the app run
 * as though the feature were not there.
 *
 * **It answers nothing, on purpose.** The result is not a permission to check
 * before posting. The press was the decision, and a player who dismisses the
 * sheet gets the app-authored comment they were already getting before any of
 * this existed — not a tap that silently did nothing.
 */
export async function establishUserGrant(event: Event): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      canRunAsUser(event),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, GRANT_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Deliberately silent. There is nothing the player could do about it and
    // nothing the next line does differently for knowing.
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
