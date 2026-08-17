import { describe, expect, it } from 'vitest';

import { BLOB_SIZE } from '../src/shared/config.js';
import {
  ACCESSORIES,
  BLOB_CIRCLE,
  FACES,
  ITEMS,
  STARTER_ACCESSORY,
  STARTER_FACE,
  STARTER_PAIR,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  blobHeight,
  blobStroke,
  findItem,
  getItem,
  itemIndex,
  ownedItems,
  ownsItem,
  packAvatar,
  resolveAccessory,
  resolveFace,
  starterFor,
  stepItem,
  unpackAvatar,
} from '../src/shared/items.js';

describe('the catalogue', () => {
  it('gives every item a unique id', () => {
    expect(new Set(ITEMS.map((item) => item.id)).size).toBe(ITEMS.length);
  });

  it('puts every item in the list its kind says it is in', () => {
    for (const item of FACES) expect(item.kind).toBe('face');
    for (const item of ACCESSORIES) expect(item.kind).toBe('accessory');
    expect(ITEMS).toHaveLength(FACES.length + ACCESSORIES.length);
  });

  it('names every item and gives it a rarity', () => {
    for (const item of ITEMS) {
      expect(item.name.length).toBeGreaterThan(0);
      expect(['common', 'uncommon', 'rare']).toContain(item.rarity);
    }
  });

  it('has exactly one starter of each kind', () => {
    expect(FACES.filter((item) => item.starter)).toEqual([STARTER_FACE]);
    expect(ACCESSORIES.filter((item) => item.starter)).toEqual([STARTER_ACCESSORY]);
    expect(starterFor('face')).toBe(STARTER_FACE);
    expect(starterFor('accessory')).toBe(STARTER_ACCESSORY);
  });

  it('keeps the starters common, since everyone has them', () => {
    expect(STARTER_FACE.rarity).toBe('common');
    expect(STARTER_ACCESSORY.rarity).toBe('common');
  });

  it('ships enough of each kind to be worth a wardrobe', () => {
    expect(FACES.length).toBeGreaterThanOrEqual(8);
    expect(ACCESSORIES.length).toBeGreaterThanOrEqual(8);
  });

  it('fills every band of both layers', () => {
    // The box draws a band first and an item uniformly inside it, so a band
    // with nothing in it is a share of the odds redistributed to the others.
    // Both layers hold some of every band, so a rare is not always a hat.
    for (const layer of [FACES, ACCESSORIES]) {
      for (const rarity of ['common', 'uncommon', 'rare'] as const) {
        expect(layer.filter((item) => item.rarity === rarity).length).toBeGreaterThan(0);
      }
    }
  });

  it('runs each layer common, then uncommon, then rare', () => {
    // The wardrobe walks these lists as rings, so the order is what a player
    // steps through. A new item goes at the end of its band rather than being
    // sorted in, so nothing already in the list moves under them.
    const ladder = { common: 0, uncommon: 1, rare: 2 } as const;
    for (const layer of [FACES, ACCESSORIES]) {
      const rungs = layer.map((item) => ladder[item.rarity]);
      expect(rungs).toEqual([...rungs].sort((a, b) => a - b));
    }
  });
});

describe('looking an item up', () => {
  it('finds an item by id and kind', () => {
    expect(getItem(STARTER_FACE.id, 'face')).toBe(STARTER_FACE);
    expect(getItem(STARTER_ACCESSORY.id, 'accessory')).toBe(STARTER_ACCESSORY);
  });

  it('refuses an id sent to the wrong slot', () => {
    // The check the equip endpoint rests on: a face id in the accessory slot is
    // a miss, not a blob wearing its own eyes as a hat.
    expect(getItem(STARTER_FACE.id, 'accessory')).toBeUndefined();
    expect(getItem(STARTER_ACCESSORY.id, 'face')).toBeUndefined();
  });

  it('does not know an id that is not in the catalogue', () => {
    expect(getItem('sombrero', 'accessory')).toBeUndefined();
  });
});

/*
 * The rule the equip endpoint enforces and the wardrobe's steppers walk. It is
 * pure and shared for exactly that reason: two implementations of "may I wear
 * this" would eventually disagree, and the disagreement would be a screen
 * offering something the server refuses.
 */
describe('owning an item', () => {
  const horn = ACCESSORIES.find((item) => item.id === 'horn')!;

  it('lets everyone wear the starters, owned or not', () => {
    // They are never written to an inventory, so an empty one still has them.
    expect(ownsItem([], STARTER_FACE)).toBe(true);
    expect(ownsItem([], STARTER_ACCESSORY)).toBe(true);
  });

  it('refuses anything else that is not in the inventory', () => {
    expect(ownsItem([], horn)).toBe(false);
    expect(ownsItem(['wink'], horn)).toBe(false);
    expect(ownsItem([horn.id], horn)).toBe(true);
  });

  it('narrows a layer to what can actually be put on', () => {
    const owned = [STARTER_FACE.id, STARTER_ACCESSORY.id, horn.id];
    expect(ownedItems(ACCESSORIES, owned)).toEqual([STARTER_ACCESSORY, horn]);
    // The starter is there even though nothing granted it.
    expect(ownedItems(FACES, owned)).toEqual([STARTER_FACE]);
  });

  it('keeps the catalogue order, so the ring does not reshuffle on a grant', () => {
    const owned = ITEMS.map((item) => item.id);
    expect(ownedItems(FACES, owned)).toEqual([...FACES]);
    expect(ownedItems(ACCESSORIES, owned)).toEqual([...ACCESSORIES]);
  });

  it('never returns an empty layer, however empty the inventory', () => {
    // The wardrobe indexes into whatever comes back, and a player who owns
    // nothing still owns the pair they are wearing.
    expect(ownedItems(FACES, []).length).toBeGreaterThan(0);
    expect(ownedItems(ACCESSORIES, []).length).toBeGreaterThan(0);
  });
});

describe('finding an item without knowing its kind', () => {
  it('finds one in either list', () => {
    // What a box result arrives as: an id, and which list it came from is the
    // answer rather than part of the question.
    expect(findItem(STARTER_FACE.id)).toBe(STARTER_FACE);
    expect(findItem('horn')?.kind).toBe('accessory');
  });

  it('comes back empty for an id the catalogue does not have', () => {
    expect(findItem('sombrero')).toBeUndefined();
  });
});

describe('resolving what to draw', () => {
  it('draws the item when it exists', () => {
    const rare = FACES.find((item) => item.rarity === 'rare')!;
    expect(resolveFace(rare.id)).toBe(rare);
  });

  it('falls back to the starter rather than drawing nothing', () => {
    // Ids live in storage and an entry can be removed from the catalogue. A
    // blank where a face should be is a worse failure than a default one.
    expect(resolveFace('gone')).toBe(STARTER_FACE);
    expect(resolveFace('')).toBe(STARTER_FACE);
    expect(resolveFace(undefined)).toBe(STARTER_FACE);
    expect(resolveFace(null)).toBe(STARTER_FACE);
    expect(resolveAccessory('gone')).toBe(STARTER_ACCESSORY);
    expect(resolveAccessory(undefined)).toBe(STARTER_ACCESSORY);
  });

  it('falls back when an id is real but belongs to the other slot', () => {
    expect(resolveAccessory(STARTER_FACE.id)).toBe(STARTER_ACCESSORY);
    expect(resolveFace(STARTER_ACCESSORY.id)).toBe(STARTER_FACE);
  });
});

describe('stepping through a layer', () => {
  it('finds where an item sits, counting from zero', () => {
    expect(itemIndex(FACES, STARTER_FACE.id)).toBe(0);
    expect(itemIndex(FACES, FACES[3]!.id)).toBe(3);
  });

  it('reads an id it does not recognise as the first item', () => {
    // The wardrobe indexes with this answer, so -1 would be a crash rather than
    // a fallback. The first item is where `resolveItem` would land anyway.
    expect(itemIndex(FACES, 'gone')).toBe(0);
    expect(itemIndex(ACCESSORIES, '')).toBe(0);
  });

  it('moves one along in either direction', () => {
    expect(stepItem(FACES, FACES[2]!.id, 1)).toBe(FACES[3]);
    expect(stepItem(FACES, FACES[2]!.id, -1)).toBe(FACES[1]);
  });

  it('wraps at both ends rather than stopping', () => {
    // A catalogue is a ring. A stepper that stops has two controls that do
    // nothing whenever you are parked on an end.
    expect(stepItem(FACES, FACES[FACES.length - 1]!.id, 1)).toBe(FACES[0]);
    expect(stepItem(FACES, FACES[0]!.id, -1)).toBe(FACES[FACES.length - 1]);
    expect(stepItem(ACCESSORIES, ACCESSORIES[0]!.id, -1)).toBe(
      ACCESSORIES[ACCESSORIES.length - 1]
    );
  });

  it('returns to where it started after a full lap in either direction', () => {
    for (const items of [FACES, ACCESSORIES]) {
      let forward = items[0]!.id;
      let backward = items[0]!.id;
      for (let i = 0; i < items.length; i++) {
        forward = stepItem(items, forward, 1).id;
        backward = stepItem(items, backward, -1).id;
      }
      expect(forward).toBe(items[0]!.id);
      expect(backward).toBe(items[0]!.id);
    }
  });

  it('visits every item exactly once on the way round', () => {
    const seen = new Set<string>();
    let at = FACES[0]!.id;
    for (let i = 0; i < FACES.length; i++) {
      seen.add(at);
      at = stepItem(FACES, at, 1).id;
    }
    expect(seen.size).toBe(FACES.length);
  });

  it('always lands on a real item, however big the step', () => {
    for (const delta of [-100, -9, 0, 1, 17, 1000]) {
      expect(FACES).toContain(stepItem(FACES, STARTER_FACE.id, delta));
    }
  });
});

describe('packing an avatar', () => {
  it('round-trips every pair in the catalogue', () => {
    for (const face of FACES) {
      for (const accessory of ACCESSORIES) {
        const pair = { face: face.id, accessory: accessory.id };
        expect(unpackAvatar(packAvatar(pair))).toEqual(pair);
      }
    }
  });

  it('packs into one field, which is the whole point of the shape', () => {
    expect(packAvatar(STARTER_PAIR)).toBe(`${STARTER_FACE.id}:${STARTER_ACCESSORY.id}`);
  });

  it('falls back rather than throwing on anything that does not parse', () => {
    for (const raw of ['', 'nonsense', ':', 'eyes', 'a:b:c', 'horn:eyes', undefined, null]) {
      expect(unpackAvatar(raw)).toEqual(STARTER_PAIR);
    }
  });

  it('keeps the half that is readable when the other half is not', () => {
    const horn = ACCESSORIES.find((item) => item.id === 'horn')!;
    expect(unpackAvatar(`gone:${horn.id}`)).toEqual({
      face: STARTER_FACE.id,
      accessory: horn.id,
    });
  });

  it('reads a value with no entry at all as the starter pair', () => {
    // A player who has never opened the wardrobe has no field on the hash, and
    // that is not an error state — it is the default blob.
    expect(unpackAvatar(undefined)).toEqual(STARTER_PAIR);
  });
});

describe('blob geometry', () => {
  it('renders the ink at 2px at every size the app draws at', () => {
    // The stroke is in user units and the viewBox is fixed, so a blob in the
    // crowd and a blob in the wardrobe are the same drawing rather than the same
    // drawing at two weights.
    for (const size of Object.values(BLOB_SIZE)) {
      expect((blobStroke(size) * size) / VIEW_WIDTH).toBeCloseTo(2, 10);
    }
  });

  it('is half again as tall as it is wide, for the accessory to live in', () => {
    for (const size of Object.values(BLOB_SIZE)) {
      expect(blobHeight(size)).toBeCloseTo(size * 1.5, 10);
    }
  });

  it('puts the dot in the bottom of the box with its outer edge on the border', () => {
    expect(BLOB_CIRCLE.cx).toBe(VIEW_WIDTH / 2);
    expect(BLOB_CIRCLE.cy + BLOB_CIRCLE.r).toBe(VIEW_HEIGHT);
    expect(BLOB_CIRCLE.r * 2).toBe(VIEW_WIDTH);
  });

  it('leaves the ink somewhere to go at the smallest size drawn', () => {
    // Half the stroke hangs outside the path it is drawn on. Accessories are
    // authored no closer than 6 units to the edge of the viewBox, which has to
    // clear that at the smallest size the app uses.
    expect(blobStroke(BLOB_SIZE.crowd) / 2).toBeLessThan(6);
  });
});
