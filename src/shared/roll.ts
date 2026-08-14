/**
 * What a gift box gives you.
 *
 * Pure, and deliberately so: the roll is the one part of the economy where the
 * difference between "the server decided" and "the client decided" is the
 * difference between an inventory and a suggestion. It takes everything it needs
 * as arguments — the catalogue, what the player owns, their pity counter, and a
 * generator — so the server can hand it `Math.random` and a test can hand it a
 * seed and assert the guarantees over ten thousand boxes.
 *
 * Three rules are encoded here and one is not:
 *
 *   - **Starters are never rolled.** They are owned implicitly by everyone, so
 *     rolling one would be a duplicate nobody ever bought.
 *   - **Pity.** A rare is guaranteed within `BOX_PITY_ROLLS` boxes. The counter
 *     comes in and goes out; the caller only has to store it.
 *   - **The band comes first.** A rarity is drawn against the configured odds
 *     and the item uniformly inside it, so those odds mean what they say
 *     however many items each band holds.
 *
 * The fourth rule — duplicates convert to coins — is the caller's, because it
 * moves a balance. All this does is say whether the item was already owned.
 */

import { BOX_PITY_ROLLS, BOX_RARITY_ODDS } from './config.js';
import type { Item, Rarity } from './items.js';

export type Roll = {
  item: Item;
  /** The player already had it. The caller converts this to a refund. */
  duplicate: boolean;
  /** The pity counter to store. Reset to 0 by a rare, incremented otherwise. */
  pity: number;
};

/** Everything a box can give: the catalogue, less what everyone starts with. */
export function rollable(catalogue: readonly Item[]): Item[] {
  return catalogue.filter((item) => item.starter !== true);
}

/**
 * Open one box.
 *
 * `pity` is how many boxes have been opened since the last rare. When the next
 * one would break the promise, the pool narrows to rares — which is the whole
 * mechanism; there is no separate "pity roll".
 */
export function roll(
  catalogue: readonly Item[],
  owned: readonly string[],
  pity: number,
  rng: () => number
): Roll {
  const pool = rollable(catalogue);
  const rares = pool.filter((item) => item.rarity === 'rare');

  // `pity + 1` is this box's position in the run, so a counter of N-1 means this
  // is the Nth and the promise falls due now rather than one box late.
  const owed = pity + 1 >= BOX_PITY_ROLLS && rares.length > 0;
  const item = owed ? pick(rares, rng) : pickByRarity(pool, rng);

  return {
    item,
    duplicate: owned.includes(item.id),
    pity: item.rarity === 'rare' ? 0 : pity + 1,
  };
}

/** A rarity against the configured odds, then an item uniformly inside it. */
function pickByRarity(pool: readonly Item[], rng: () => number): Item {
  // Bands the catalogue has nothing in are left out of the draw entirely, so
  // their share is redistributed rather than falling through to a default.
  const bands = (Object.keys(BOX_RARITY_ODDS) as Rarity[])
    .map((rarity) => ({ rarity, items: pool.filter((item) => item.rarity === rarity) }))
    .filter((band) => band.items.length > 0);

  const total = bands.reduce((sum, band) => sum + BOX_RARITY_ODDS[band.rarity], 0);
  let ticket = rng() * total;

  for (const band of bands) {
    ticket -= BOX_RARITY_ODDS[band.rarity];
    if (ticket < 0) return pick(band.items, rng);
  }

  // Only reachable if `rng` returned exactly 1, which the contract says it does
  // not. Falling back to the last band costs a branch and removes the question.
  return pick(bands[bands.length - 1]!.items, rng);
}

function pick(items: readonly Item[], rng: () => number): Item {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]!;
}
