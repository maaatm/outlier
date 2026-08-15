/**
 * The pinned menu post.
 *
 * One post on the subreddit that opens straight onto the menu instead of onto a
 * question: what the game is, the player's own record, the leaderboard, and the
 * room that asks the subreddit something. It is the app's front door for
 * somebody who has just arrived and does not yet know what any of this is —
 * which is also why the room that creates a post has to say plainly why it is
 * inert for a visitor who is not signed in. See `canSubmit`.
 *
 * It carries no question, so it is the one post where `/api/state` answers
 * without ever going near a tally.
 */

import { redis, reddit } from '@devvit/web/server';
import type { T3 } from '@devvit/web/shared';

import { CROWD_SIZE } from '../../shared/config.js';
import { currentSubredditName } from './daily.js';
import { keys } from './keys.js';

/**
 * Reddit does not allow a title to be edited after submission, so changing this
 * only affects menu posts created from here on.
 */
const TITLE = 'Outlier';

/** For old clients that cannot render the interactive post. */
const FALLBACK = [
  'One question a day about ordinary behavior.',
  '',
  `Answer it, then guess how many people out of ${CROWD_SIZE} answered the same way.`,
  'You find out two things at once: how unusual you are, and how well you read',
  'everyone else.',
  '',
  'Open this post in the app to read the rules and see your record.',
].join('\n');

export type PinMenuPostResult =
  | { status: 'created'; postId: string; permalink: string; pinned: boolean }
  | { status: 'exists'; postId: string; permalink: string };

export async function getMenuPostId(): Promise<string | null> {
  return (await redis.get(keys.menuPost)) ?? null;
}

export async function isMenuPost(postId: string): Promise<boolean> {
  return (await getMenuPostId()) === postId;
}

/**
 * Create the menu post and pin it, or hand back the one already up.
 *
 * Idempotent on purpose: a moderator running this twice should not end up with
 * two front doors. The recorded post is confirmed to still exist before it is
 * reported as live, so a deleted post does not permanently block a new one.
 *
 * A failed pin is not a failed post. The post is useful unpinned, and Reddit
 * only allows two stickies — a subreddit that already has both should get the
 * post plus a note, not an error and nothing.
 */
export async function pinMenuPost(): Promise<PinMenuPostResult> {
  const existing = await getMenuPostId();
  if (existing) {
    const live = await getPostIfLive(existing);
    if (live) return { status: 'exists', postId: existing, permalink: live.permalink };
  }

  const post = await reddit.submitCustomPost({
    subredditName: await currentSubredditName(),
    title: TITLE,
    textFallback: { text: FALLBACK },
  });

  // Recorded before the pin: the post is already the menu post whether or not
  // it ends up stickied, and losing the record would strand it.
  await redis.set(keys.menuPost, post.id);

  let pinned = true;
  try {
    await post.sticky();
  } catch (error) {
    pinned = false;
    console.error('pin-menu-post: posted but could not pin', error);
  }

  return { status: 'created', postId: post.id, permalink: post.permalink, pinned };
}

/** `null` when the post is gone, so a stale record cannot block a new one. */
async function getPostIfLive(postId: string): Promise<{ permalink: string } | null> {
  try {
    const post = await reddit.getPostById(postId as T3);
    if (post.removed || post.spam) return null;
    return { permalink: post.permalink };
  } catch {
    return null;
  }
}
