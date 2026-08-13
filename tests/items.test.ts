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
  getItem,
  packAvatar,
  resolveAccessory,
  resolveFace,
  starterFor,
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

  it('draws something for every item except the empty accessory slot', () => {
    // Wearing nothing is an item rather than the absence of one, so that the
    // wardrobe has an honest way to take an accessory off.
    expect(STARTER_ACCESSORY.path).toBe('');
    for (const item of ITEMS) {
      if (item !== STARTER_ACCESSORY) expect(item.path.length).toBeGreaterThan(0);
    }
  });

  it('ships enough of each kind to be worth a wardrobe', () => {
    expect(FACES.length).toBeGreaterThanOrEqual(8);
    expect(ACCESSORIES.length).toBeGreaterThanOrEqual(8);
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
