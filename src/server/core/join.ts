/**
 * Joining the subreddit, and the one free box that comes with it.
 *
 * Devvit does **not** expose subscription state — a user's subscribed
 * subreddits are private data, and `subscribeToCurrentSubreddit` returns
 * `void`. So there is no way to check whether somebody is already subscribed,
 * no way to detect an unsubscribe afterwards, and players who were already
 * subscribed will claim the grant. All three are handled by the grant being
 * one-time and tracked locally, which is the only bound available, and by the
 * copy framing it as a welcome rather than as a bounty.
 *
 * `joined` is one field with three states, exactly the `showBlob` idiom:
 * absent is never offered and never granted, `"1"` is granted, `"0"` is offered
 * and declined. A decline stops the offer firing on a reveal again; it does not
 * stop a later claim, because the row in Your record stays until `"1"`.
 */

import { redis } from '@devvit/web/server';

import { keys, userFields } from './keys.js';

export type JoinState = {
  /** The free roll has been handed out. */
  joined: boolean;
  /** They have answered the offer either way, so a reveal should not ask again. */
  answered: boolean;
  /** Boxes owed that cost nothing. */
  freeRolls: number;
};

export async function readJoinState(userId: string): Promise<JoinState> {
  const raw = await redis.hMGet(keys.user(userId), [userFields.joined, userFields.freeRolls]);
  return decodeJoin(raw[0], raw[1]);
}

/**
 * Absent, empty and null all mean the same thing — never asked — the way an
 * absent `showBlob` does. Only `"1"` and `"0"` are answers.
 */
function decodeJoin(
  joined: string | null | undefined,
  freeRolls: string | null | undefined
): JoinState {
  return {
    joined: joined === '1',
    answered: joined === '1' || joined === '0',
    freeRolls: Number(freeRolls ?? 0) || 0,
  };
}

export type JoinClaim =
  | { status: 'granted'; freeRolls: number }
  /** Already claimed. The subscribe still happened; the box does not come twice. */
  | { status: 'already'; freeRolls: number }
  /** The hash moved under us. Same guarantee as the box: nothing happened. */
  | { status: 'busy' };

/**
 * Claim the grant and hand over the roll, together.
 *
 * A `watch` rather than the `hSetNX` the other once-only claims in this app use,
 * for one reason: `joined` is not a claim flag, it is a field with three states,
 * and a player who declined holds `"0"` — which an `hSetNX` can never move, so
 * declining once would quietly cost them the box forever. Reading the field and
 * writing over it is the only way to let a no become a yes, and a read-then-
 * write in front of a grant needs the same protection the box's debit needs.
 *
 * One attempt and `busy` if it loses, exactly as `openBox` does: a tap the
 * player can repeat is a better failure than a retry that might grant twice.
 */
export async function claimJoin(userId: string, rolls: number): Promise<JoinClaim> {
  const key = keys.user(userId);

  // Watch first, then read: a value read before the watch is a value that could
  // have moved without the transaction ever knowing.
  const txn = await redis.watch(key);

  const raw = await redis.hMGet(key, [userFields.joined, userFields.freeRolls]);
  const state = decodeJoin(raw[0], raw[1]);

  if (state.joined) {
    await txn.unwatch();
    return { status: 'already', freeRolls: state.freeRolls };
  }

  await txn.multi();
  await txn.hSet(key, { [userFields.joined]: '1' });
  await txn.hIncrBy(key, userFields.freeRolls, rolls);

  const applied = await txn.exec();
  if (applied.length === 0) return { status: 'busy' };

  return { status: 'granted', freeRolls: state.freeRolls + rolls };
}

/**
 * No thanks.
 *
 * Written over the absent state and never over a granted one — somebody who has
 * already claimed cannot un-claim by declining, and the `'1'` is what a later
 * read is entitled to trust.
 */
export async function declineJoin(userId: string): Promise<void> {
  await redis.hSetNX(keys.user(userId), userFields.joined, '0');
}
