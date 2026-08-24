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
 * **Two fields, one job each.** `joined` is the answer, in the `showBlob`
 * idiom: absent is never offered, `"1"` is yes, `"0"` is offered and declined.
 * A decline stops the offer firing on a reveal again; it does not stop a later
 * claim, because the row in Your record stays until `"1"`. `joinGrant` is the
 * claim on the roll, and it is separate for one reason — a no is allowed to
 * become a yes, so `joined` has to be writable over, and a field that can be
 * written over is a field `hSetNX` cannot guard.
 *
 * That split is what lets this file hold nothing but single atomic commands.
 * It used to read `joined` under a `watch` and write the grant back inside a
 * transaction, which is the one shape in this app that can refuse for a reason
 * the player cannot act on: an `exec` that loses its watch reports `busy`, the
 * route turns that into a 409, and the offer comes back with nothing to do
 * differently. An `hSetNX` on a field nothing else writes gives the same
 * once-per-account guarantee with no losing branch at all.
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
  | { status: 'already'; freeRolls: number };

/**
 * Claim the grant and hand over the roll.
 *
 * `hSetNX` on `joinGrant` is the whole guard, and it is the only thing in here
 * that has to be atomic: however many taps arrive together, exactly one of them
 * moves an absent field to `"1"` and every other one is told the box is already
 * gone. There is deliberately no third outcome — nothing here can fail in a way
 * the player is expected to retry.
 *
 * The read in front of it is not the guard. It is there for accounts granted
 * before `joinGrant` existed, which hold `joined === '1'` and no claim at all:
 * without it the claim would be free to win and would pay them a second roll.
 *
 * The claim is taken before the roll is credited, which is the order every
 * once-only payment in this app uses — see `commented:`. A throw in between
 * costs the player the roll rather than paying it twice, and the tap that
 * follows finds the offer answered rather than the grant still open.
 */
export async function claimJoin(userId: string, rolls: number): Promise<JoinClaim> {
  const key = keys.user(userId);

  const state = await readJoinState(userId);
  if (state.joined) return { status: 'already', freeRolls: state.freeRolls };

  const claimed = (await redis.hSetNX(key, userFields.joinGrant, '1')) === 1;

  if (!claimed) {
    // A second tap of the same offer, or a second device. The answer is still
    // an answer, so `joined` is written either way — the loser of the race must
    // not be left with an offer that keeps coming back.
    await redis.hSet(key, { [userFields.joined]: '1' });
    return { status: 'already', freeRolls: state.freeRolls };
  }

  const freeRolls = await redis.hIncrBy(key, userFields.freeRolls, rolls);
  await redis.hSet(key, { [userFields.joined]: '1' });

  return { status: 'granted', freeRolls };
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
