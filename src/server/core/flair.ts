/**
 * Post flair, applied after the post and never in front of it.
 *
 * Setting link flair text is a moderator action, and the app account is not a
 * moderator: Devvit 0.14.1 deprecated `permissions.reddit.scope: "moderator"`
 * and treats every app as `"user"`. So this is a call that is expected to fail
 * on a subreddit that has not added the app to its mod team, and to start
 * working — with no code change — on one that has.
 *
 * Which is the whole reason it is a call at all. `flairText` on
 * `submitCustomPost` travels *inside* the submit, so a flair Reddit will not
 * grant is a submission Reddit may refuse — and the two things that submit
 * posts here are the Daily and a player's question, neither of which is worth
 * losing over a label. Pulled out, a refused flair costs the post nothing.
 *
 * Retrying the submit without the flair would be the other way to arrange this,
 * and it is the wrong way: a throw is not proof the post failed — see the note
 * in `submitOpenQuestion` — so a retry risks two posts where this risks one
 * missing label.
 *
 * The subreddit name is passed in rather than looked up, because both callers
 * have just used it to submit the post this is labelling. Importing
 * `currentSubredditName` from `daily.ts` would also make a cycle out of a file
 * that has no other reason to know about the Daily.
 */

import { reddit } from '@devvit/web/server';
import type { T3 } from '@devvit/web/shared';

/**
 * Label a post. Answers whether the label went on, and never throws.
 *
 * The answer is for the caller's log line and for tests. Nothing in the game
 * branches on it: a post is exactly as playable unflaired.
 */
export async function applyFlair(
  subredditName: string,
  postId: string,
  text: string
): Promise<boolean> {
  try {
    await reddit.setPostFlair({ subredditName, postId: postId as T3, text });
    return true;
  } catch (error) {
    // Logged rather than swallowed silently: a subreddit that meant to give the
    // app flair permission and did not has no other signal that it is missing.
    console.error(`flair: could not label ${postId} "${text}"`, error);
    return false;
  }
}
