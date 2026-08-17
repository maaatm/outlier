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
 *
 * A free roll is the same transaction with the price taken out of it. It is read
 * under the same watch, spent before coins are, and decremented inside the same
 * `hSet` — so a box that cost nothing is as atomic as one that cost thirty, and
 * two taps cannot spend one roll twice.
 */

import { redis } from '@devvit/web/server';

import { duplicateRefund } from '../../shared/coins.js';
import { BOX_PRICE } from '../../shared/config.js';
import { type Item, ITEMS } from '../../shared/items.js';
import { roll } from '../../shared/roll.js';
import { keys, userFields } from './keys.js';
import { readInventory } from './avatars.js';

export type BoxOutcome =
  | {
      status: 'ok';
      item: Item;
      duplicate: boolean;
      refunded: number;
      coins: number;
      /** Paid for with a free roll, so nothing was debited and nothing refunded. */
      free: boolean;
      /** Free rolls left afterwards, so the wardrobe knows what the next tap costs. */
      freeRolls: number;
    }
  /** Not enough coins, and no free roll either. Nothing was debited or granted. */
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

  const raw = await redis.hMGet(key, [userFields.coins, userFields.pity, userFields.freeRolls]);
  const coins = Number(raw[0] ?? 0) || 0;
  const pity = Number(raw[1] ?? 0) || 0;
  const freeRolls = Number(raw[2] ?? 0) || 0;

  // A free roll is spent before coins are, and it is read under the same watch
  // as the balance — so a roll that costs nothing is as atomic as one that
  // costs thirty, and two taps cannot spend the same free roll twice.
  const free = freeRolls > 0;

  if (!free && coins < BOX_PRICE) {
    // Nothing was queued, so there is nothing to discard — but the keys are
    // still watched, and this request is done with them.
    await txn.unwatch();
    return { status: 'poor', coins };
  }

  const owned = await readInventory(userId);
  // A free roll advances `pity` like any other, because `roll()` is the one path
  // and a roll that did not count would be a hole in the pity guarantee.
  const result = roll(ITEMS, owned, pity, Math.random);

  // A free roll refunds nothing on a duplicate. The refund exists so that a
  // player deep into the catalogue is not spending 30 coins for nothing — a roll
  // that cost nothing has nothing to be made whole for, and paying 12 coins out
  // of a box that took none in is a faucet rather than a refund.
  const refunded = result.duplicate && !free ? duplicateRefund() : 0;
  const balance = free ? coins : coins - BOX_PRICE + refunded;

  await txn.multi();
  await txn.hSet(key, {
    [userFields.coins]: String(balance),
    [userFields.pity]: String(result.pity),
    ...(free ? { [userFields.freeRolls]: String(freeRolls - 1) } : {}),
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
    free,
    freeRolls: free ? freeRolls - 1 : freeRolls,
  };
}
