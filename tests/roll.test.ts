import { describe, expect, it } from 'vitest';

import { BOX_PITY_ROLLS, BOX_RARITY_ODDS } from '../src/shared/config.js';
import {
  ACCESSORIES,
  FACES,
  ITEMS,
  type Item,
  STARTER_ACCESSORY,
  STARTER_FACE,
} from '../src/shared/items.js';
import { makeRandom } from '../src/shared/rng.js';
import { roll, rollable } from '../src/shared/roll.js';

/**
 * A seeded generator, so an assertion about ten thousand boxes is a fact rather
 * than a coin flip that passed today. Same seed, same sequence, every engine.
 */
const seeded = (seed = 0xb0a7) => makeRandom(seed);

/** Open `count` boxes in a row, carrying the pity counter the way a player does. */
function open(count: number, owned: string[] = [], seed?: number): Item[] {
  const rng = seeded(seed);
  const drawn: Item[] = [];
  let pity = 0;

  for (let i = 0; i < count; i++) {
    const result = roll(ITEMS, owned, pity, rng);
    pity = result.pity;
    drawn.push(result.item);
  }
  return drawn;
}

describe('what a box can contain', () => {
  it('leaves the starters out of the pool entirely', () => {
    // They are owned implicitly by everyone, so rolling one would be a
    // duplicate nobody ever bought.
    expect(rollable(ITEMS)).not.toContain(STARTER_FACE);
    expect(rollable(ITEMS)).not.toContain(STARTER_ACCESSORY);
    expect(rollable(ITEMS)).toHaveLength(ITEMS.length - 2);
  });

  it('never rolls a starter, over ten thousand boxes', () => {
    for (const item of open(10_000)) {
      expect(item.starter).toBeUndefined();
    }
  });

  it('can reach every other item in the catalogue', () => {
    // A box that cannot produce an item is an item nobody can have.
    const seen = new Set(open(20_000).map((item) => item.id));
    for (const item of rollable(ITEMS)) expect(seen).toContain(item.id);
  });

  it('rolls both faces and accessories', () => {
    const drawn = open(500);
    expect(drawn.some((item) => FACES.includes(item))).toBe(true);
    expect(drawn.some((item) => ACCESSORIES.includes(item))).toBe(true);
  });
});

describe('pity', () => {
  it('never goes more than the promised number of boxes without a rare', () => {
    let gap = 0;
    let worst = 0;

    for (const item of open(10_000)) {
      gap = item.rarity === 'rare' ? 0 : gap + 1;
      worst = Math.max(worst, gap);
    }

    expect(worst).toBeLessThanOrEqual(BOX_PITY_ROLLS);
  });

  it('holds from any counter a stored record could carry', () => {
    // Including a counter already past the threshold, which is what a record
    // written before the pity rule shipped would read as.
    for (const pity of [0, 1, BOX_PITY_ROLLS - 1, BOX_PITY_ROLLS, 99]) {
      const result = roll(ITEMS, [], pity, seeded());
      if (pity + 1 >= BOX_PITY_ROLLS) expect(result.item.rarity).toBe('rare');
    }
  });

  it('resets on a rare and counts up on everything else', () => {
    expect(roll(ITEMS, [], BOX_PITY_ROLLS - 1, seeded()).pity).toBe(0);

    const rng = seeded();
    let pity = 0;
    for (let i = 0; i < BOX_PITY_ROLLS - 1; i++) {
      const result = roll(ITEMS, [], pity, rng);
      pity = result.pity;
      // Either it paid out early, resetting, or the counter advanced by one.
      expect(pity).toBe(result.item.rarity === 'rare' ? 0 : i + 1);
      if (pity === 0) break;
    }
  });
});

describe('duplicates', () => {
  it('reports a repeat as a duplicate', () => {
    const first = roll(ITEMS, [], 0, seeded());
    const again = roll(ITEMS, [first.item.id], 0, seeded());
    expect(first.duplicate).toBe(false);
    expect(again.duplicate).toBe(true);
  });

  it('converts every box once a player owns everything', () => {
    // Without this, a player holding 80% of the catalogue opens boxes for
    // nothing and stops. The refund is what they get instead.
    const everything = ITEMS.map((item) => item.id);
    const rng = seeded();
    let pity = 0;

    for (let i = 0; i < 500; i++) {
      const result = roll(ITEMS, everything, pity, rng);
      pity = result.pity;
      expect(result.duplicate).toBe(true);
    }
  });

  it('is not a duplicate merely because the starters are owned', () => {
    const owned = [STARTER_FACE.id, STARTER_ACCESSORY.id];
    for (const result of open(200, owned).values()) {
      expect(owned).not.toContain(result.id);
    }
  });
});

describe('the odds', () => {
  it('lands in each band roughly as often as configured', () => {
    // Generous bounds: this is a smoke test that the bands are wired to the
    // right weights, not an attempt to prove a distribution.
    const drawn = open(20_000);
    const share = (rarity: string): number =>
      (drawn.filter((item) => item.rarity === rarity).length / drawn.length) * 100;

    expect(share('common')).toBeGreaterThan(BOX_RARITY_ODDS.common - 10);
    expect(share('common')).toBeLessThan(BOX_RARITY_ODDS.common + 10);
    // Rares run above their share, because pity tops them up.
    expect(share('rare')).toBeGreaterThanOrEqual(BOX_RARITY_ODDS.rare);
  });

  it('is reproducible from a seed', () => {
    expect(open(50, [], 1234).map((item) => item.id)).toEqual(
      open(50, [], 1234).map((item) => item.id)
    );
  });
});
