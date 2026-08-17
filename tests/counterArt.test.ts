import { describe, expect, it } from 'vitest';

import {
  CAST_TRANSFORM,
  FACE_TRANSFORM,
  mirror,
  pathFor,
  subpathsFor,
} from '../src/client/counterArt.js';
import { ACCESSORIES, FACES, ITEMS, STARTER_ACCESSORY } from '../src/shared/items.js';

/*
 * The catalogue says which items exist and this file says what they look like,
 * keyed by the same ids. Nothing checks that at compile time — the table is a
 * `Record<string, …>` because it is keyed by data, not by a union — so these
 * are the tests that keep the two lists from drifting apart.
 */
describe('the drawings', () => {
  it('draws every item except the empty accessory slot', () => {
    // Wearing nothing is an item rather than the absence of one, so that the
    // wardrobe has an honest way to take an accessory off.
    expect(pathFor(STARTER_ACCESSORY.id)).toBe('');
    expect(subpathsFor(STARTER_ACCESSORY.id)).toEqual([]);

    for (const item of ITEMS) {
      if (item === STARTER_ACCESSORY) continue;
      expect(pathFor(item.id).length, `${item.id} has no drawing`).toBeGreaterThan(0);
      expect(subpathsFor(item.id).length, `${item.id} paints nothing`).toBeGreaterThan(0);
    }
  });

  it('draws nothing at all for an id the catalogue does not have', () => {
    // Ids live in storage, so a drawing can be asked for by name after the
    // catalogue has dropped it. `resolveItem` catches that upstream; this is
    // the floor underneath it.
    expect(pathFor('sombrero')).toBe('');
    expect(subpathsFor('sombrero')).toEqual([]);
  });

  it('gives every accessory an outline of its own', () => {
    // The bar the whole pass is measured against: at 18px nothing is legible
    // as an object, so two accessories that draw the same are one accessory.
    const drawn = ACCESSORIES.filter((item) => item !== STARTER_ACCESSORY).map((item) =>
      pathFor(item.id)
    );
    expect(new Set(drawn).size).toBe(drawn.length);
  });

  it('gives every face a mark of its own', () => {
    const drawn = FACES.map((item) => pathFor(item.id));
    expect(new Set(drawn).size).toBe(drawn.length);
  });
});

/*
 * The bug this pass fixes. Mirroring a path reverses its winding, so two
 * overlapping halves inside one `d` cancel under the non-zero fill rule and the
 * overlap punches a hole — which is what clipped the antennae, the bow and the
 * propeller. One element per subpath, and each piece paints over the last.
 */
describe('splitting a drawing into what paints it', () => {
  it('gives back one piece per subpath', () => {
    // Two eyes, four eyes, three feathers, and an antler that is three shapes
    // authored once and mirrored.
    expect(subpathsFor('eyes')).toHaveLength(2);
    expect(subpathsFor('foureyes')).toHaveLength(4);
    expect(subpathsFor('crest')).toHaveLength(3);
    expect(subpathsFor('antlers')).toHaveLength(6);
  });

  it('starts every piece with its own move, and puts them back together whole', () => {
    for (const item of ITEMS) {
      const pieces = subpathsFor(item.id);
      for (const piece of pieces) expect(piece.startsWith('M')).toBe(true);
      expect(pieces.join('').replace(/\s+/g, ' ').trim()).toBe(
        pathFor(item.id).replace(/\s+/g, ' ').trim()
      );
    }
  });

  it('leaves the tongue overlapping the mouth it hangs out of', () => {
    // The plainest case: the mouth arc and the tongue are wound the other way
    // from each other, so a single element would notch the tongue.
    expect(subpathsFor('tongue')).toHaveLength(4);
  });

  it('keeps the halo whole, because its hole is the point', () => {
    // The inner ellipse is wound the other way round on purpose — `a … 1 1 …`
    // against the outer's `a … 1 0 …` — and splitting it would fill it in.
    const halo = subpathsFor('halo');
    expect(halo).toHaveLength(1);
    expect(halo[0]).toBe(pathFor('halo'));
    expect(halo[0]).toContain('a 32 10 0 1 0');
    expect(halo[0]).toContain('a 21 5 0 1 1');
  });
});

/*
 * Half the accessories have a twin and are authored once. The mirror is
 * therefore the one piece of generated geometry in the drawing, and the one
 * that can be silently wrong.
 */
describe('mirroring a path', () => {
  it('reflects x about the middle of the viewBox and leaves y alone', () => {
    expect(mirror('M 24 58 Q 25 32 30 24 Q 39 39 45 56 Z')).toBe(
      'M 76 58 Q 75 32 70 24 Q 61 39 55 56 Z'
    );
  });

  it('flips an arc rather than reflecting only its ends', () => {
    // A reflected arc bends the other way, so the sweep flag has to turn over
    // with it. The radii and the large-arc flag are the same arc read from the
    // other side and are left alone.
    expect(mirror('M 19 80 A 9 9 0 0 0 37 80 Z')).toBe('M 81 80 A 9 9 0 0 1 63 80 Z');
  });

  it('reflects a relative arc about zero, since a delta has no origin', () => {
    expect(mirror('M 22 18 a 9 9 0 1 0 18 0 a 9 9 0 1 0 -18 0 Z')).toBe(
      'M 78 18 a 9 9 0 1 1 -18 0 a 9 9 0 1 1 18 0 Z'
    );
  });

  it('comes back to where it started when done twice', () => {
    for (const d of [
      'M 34 58 C 30 44 26 30 22 18 L 30 15 C 35 28 39 44 41 58 Z',
      'M 22 18 a 9 9 0 1 0 18 0 a 9 9 0 1 0 -18 0 Z',
      'M 19 80 A 9 9 0 0 0 37 80 Z',
      'M 27 32 L 11 25 L 8 32 L 25 39 Z',
    ]) {
      expect(mirror(mirror(d))).toBe(d);
    }
  });

  it('mirrors each half of a twinned piece onto the other', () => {
    // Cat ears, bunny ears, devil horns: one ear authored, one generated.
    for (const id of ['catears', 'ears', 'devil']) {
      const [left, right] = subpathsFor(id);
      expect(mirror(left!.trim())).toBe(right!.trim());
    }
  });
});

describe('the three layers a piece is painted in', () => {
  it('drops the rarity face below the body rather than measuring an edge', () => {
    // Whatever shape a piece is, its bottom face is the same drawing a few
    // units lower with the body painted back over it. No shape has to say
    // where its own bottom is.
    expect(FACE_TRANSFORM).toBe('translate(0 5)');
  });

  it('grows the cast about the head rather than about each shape', () => {
    // A scale about (50, 38) pushes every piece outward from the counter it is
    // sitting on. Scaling each shape about its own middle would move a bunny
    // ear's shadow inward, under the ear.
    expect(CAST_TRANSFORM).toContain('scale(1.06)');
    expect(CAST_TRANSFORM).toContain('translate(50 38)');
    expect(CAST_TRANSFORM).toContain('translate(-50 -38)');
  });
});
