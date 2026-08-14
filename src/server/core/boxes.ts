/**
 * The gift box: coins in, an item out.
 *
 * The roll is pure and lives in `shared/roll.ts`. What is here is the part that
 * cannot be pure — taking the coins and granting the item **together**.
 *
 * A failure between the debit and the grant either eats a player's coins or
 * hands out a free item, and at any volume both will happen. So the balance and
 * the pity counter are read under a `watch` on the user hash, and the new
 * balance, the new counter and the grant go out as one transaction: if anything
 * else moved that hash in between — a vote paying the daily award, a second box
 * from a double tap — `exec` comes back empty and nothing at all happened.
 *
 * The debit is an assignment rather than an increment for exactly that reason.
 * An increment would be safe on its own and would let an overdraft through under
 * contention; the whole point of the watch is that the balance this decision was
 * made against is the balance it is applied to.
 */

import { redis } from '@devvit/web/server';

import { duplicateRefund } from '../../shared/coins.js';
import { BOX_PRICE } from '../../shared/config.js';
import { type Item, ITEMS } from '../../shared/items.js';
import { roll } from '../../shared/roll.js';
import { keys, userFields } from './keys.js';
import { readInventory } from './avatars.js';

export type BoxOutcome =
  | { status: 'ok'; item: Item; duplicate: boolean; refunded: number; coins: number }
  /** Not enough coins. Nothing was debited and nothing was granted. */
  | { status: 'poor'; coins: number }
  /** The hash moved under us. Same guarantee: nothing happened. */
  | { status: 'busy' };

/**
 * Open one box.
 *
 * One attempt, and `busy` if it loses. There is deliberately no retry: the only
 * thing that contends for this hash is the same player's own other request, so a
 * retry would buy almost nothing — and it would spend the one guarantee this
 * function has. An aborted `exec` is indistinguishable from an `exec` whose
 * result did not come back, and re-rolling on top of that is how a player gets
 * charged twice. A tap they can repeat themselves is the better failure.
 */
export async function openBox(userId: string): Promise<BoxOutcome> {
  const key = keys.user(userId);

  // Watch first, then read: a value read before the watch is a value that could
  // have moved without the transaction ever knowing.
  const txn = await redis.watch(key);

  const raw = await redis.hMGet(key, [userFields.coins, userFields.pity]);
  const coins = Number(raw[0] ?? 0) || 0;
  const pity = Number(raw[1] ?? 0) || 0;

  if (coins < BOX_PRICE) {
    // Nothing was queued, so there is nothing to discard — but the keys are
    // still watched, and this request is done with them.
    await txn.unwatch();
    return { status: 'poor', coins };
  }

  const owned = await readInventory(userId);
  const result = roll(ITEMS, owned, pity, Math.random);
  const refunded = result.duplicate ? duplicateRefund() : 0;
  const balance = coins - BOX_PRICE + refunded;

  await txn.multi();
  await txn.hSet(key, {
    [userFields.coins]: String(balance),
    [userFields.pity]: String(result.pity),
  });
  // A duplicate is already in the inventory; writing it again would be a write
  // that says nothing. The refund is what happened instead.
  if (!result.duplicate) {
    await txn.hSet(keys.inventory(userId), { [result.item.id]: '1' });
  }

  // Devvit hands back one entry per queued command, and an empty array when the
  // transaction was aborted because a watched key moved.
  const applied = await txn.exec();
  if (applied.length === 0) return { status: 'busy' };

  return {
    status: 'ok',
    item: result.item,
    duplicate: result.duplicate,
    refunded,
    coins: balance,
  };
}
