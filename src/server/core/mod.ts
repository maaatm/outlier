/**
 * Moderator checks.
 *
 * Devvit already hides `forUserType: "moderator"` menu items from ordinary
 * users, but that is a UI affordance, not a gate — the endpoints behind them
 * are reachable directly. Every mod-only route re-checks here.
 */

import { context, reddit } from '@devvit/web/server';

export async function isModerator(): Promise<boolean> {
  if (!context.userId) return false;

  try {
    const user = await reddit.getCurrentUser();
    if (!user) return false;
    const subredditName = context.subredditName ?? (await reddit.getCurrentSubreddit()).name;
    const permissions = await user.getModPermissionsForSubreddit(subredditName);
    return permissions.length > 0;
  } catch {
    // Failing closed is the only safe direction for an authorisation check.
    return false;
  }
}
