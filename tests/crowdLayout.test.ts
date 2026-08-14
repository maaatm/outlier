import { describe, expect, it } from 'vitest';

import {
  CAMP_GAP_CELLS,
  DOT_RATIO,
  PER_ROW,
  type Placement,
  cameoBlob,
  cameoCapacity,
  campLayout,
  cellFor,
  extent,
  scatterLayout,
} from '../src/client/crowdLayout.js';
import { CAMEO_COUNT, CROWD_SIZE } from '../src/shared/config.js';

/** The box a placement actually occupies, in cells. */
function boxOf(place: Placement): { x1: number; y1: number; x2: number; y2: number } {
  const size = place.span - 1 + DOT_RATIO;
  return { x1: place.x, y1: place.y, x2: place.x + size, y2: place.y + size };
}

function overlaps(a: Placement, b: Placement): boolean {
  const one = boxOf(a);
  const two = boxOf(b);
  return one.x1 < two.x2 && two.x1 < one.x2 && one.y1 < two.y2 && two.y1 < one.y2;
}

/** Every pair, because a hundred dots is four thousand pairs and that is free. */
function anyOverlap(places: Placement[]): boolean {
  for (let i = 0; i < places.length; i++) {
    for (let j = i + 1; j < places.length; j++) {
      if (overlaps(places[i]!, places[j]!)) return true;
    }
  }
  return false;
}

describe('the camp layout, with nobody named', () => {
  /*
   * The regression that matters most. Cameos changed how the camps are packed,
   * and the crowd without them has to come out exactly where it always did —
   * ten to a row, your camp on top, theirs below the gap.
   */
  it('packs the same arrangement it always did', () => {
    for (const withYou of [1, 19, 50, 73, 99]) {
      const { places } = campLayout(withYou);
      const yourRows = Math.ceil(withYou / PER_ROW);

      expect(places).toHaveLength(CROWD_SIZE);
      for (let index = 0; index < CROWD_SIZE; index++) {
        const mine = index < withYou;
        const inCamp = mine ? index : index - withYou;
        expect(places[index]).toEqual({
          x: inCamp % PER_ROW,
          y: Math.floor(inCamp / PER_ROW) + (mine ? 0 : yourRows + CAMP_GAP_CELLS),
          span: 1,
        });
      }
    }
  });

  it('measures a box that exactly holds the arrangement', () => {
    const layout = campLayout(55);
    const rows = Math.ceil(55 / PER_ROW) + Math.ceil(45 / PER_ROW);
    expect(layout.width).toBeCloseTo(extent(PER_ROW, layout.margin));
    expect(layout.height).toBeCloseTo(extent(rows, layout.margin) + CAMP_GAP_CELLS);
  });

  it('drops the gap when one camp took every dot', () => {
    const layout = campLayout(CROWD_SIZE);
    expect(layout.height).toBeCloseTo(extent(CROWD_SIZE / PER_ROW, layout.margin));
  });
});

describe('the camp layout, with cameos in it', () => {
  it('still draws a hundred people', () => {
    for (const cameos of [0, 1, 5, CAMEO_COUNT]) {
      const layout = campLayout(40, cameos, CAMEO_COUNT - cameos);
      expect(layout.places).toHaveLength(CROWD_SIZE);
    }
  });

  it('gives every cameo a two-by-two block and everyone else a cell', () => {
    const { places } = campLayout(40, 4, 6);
    expect(places.filter((place) => place.span === 2)).toHaveLength(10);
    expect(places.filter((place) => place.span === 1)).toHaveLength(90);
  });

  it('never lets two of them occupy the same space', () => {
    for (const withYou of [2, 12, 19, 50, 81, 99]) {
      for (const yours of [0, 1, 3, 5, 8, 10]) {
        const layout = campLayout(withYou, yours, CAMEO_COUNT - yours);
        expect(anyOverlap(layout.places)).toBe(false);
      }
    }
  });

  it('keeps everything inside the box it measured', () => {
    const layout = campLayout(19, 2, 8);
    for (const place of layout.places) {
      const box = boxOf(place);
      expect(box.x1).toBeGreaterThanOrEqual(0);
      expect(box.x2).toBeLessThanOrEqual(layout.width - layout.margin * 2 + 0.0001);
      expect(box.y2).toBeLessThanOrEqual(layout.height - layout.margin * 2 + 0.0001);
    }
  });

  /*
   * Your dot is the one the whole screen is composed around. A cameo may stand
   * beside it and may be bigger than it, but it may never take its place.
   */
  it('leaves the top-left cell of your camp to you', () => {
    const { places } = campLayout(30, CAMEO_COUNT, 0);
    expect(places[0]).toEqual({ x: 0, y: 0, span: 1 });
  });

  it('hands the places back in reading order, so the stagger sweeps', () => {
    const { places } = campLayout(40, 3, 3);
    for (let index = 1; index < places.length; index++) {
      const step = [places[index - 1]!.y, places[index - 1]!.x];
      const next = [places[index]!.y, places[index]!.x];
      expect(next[0]! > step[0]! || (next[0] === step[0] && next[1]! > step[1]!)).toBe(true);
    }
  });

  /*
   * The reason the scatter exists. Lined up at the front of a camp the blobs
   * read as a cast standing in front of an audience; spread through it they read
   * as some of the crowd being people we know. So they have to actually be
   * spread: not every cameo in the camp's first rows, and not every one of them
   * in the same column band.
   */
  it('scatters them through the camp rather than lining them up at the front', () => {
    const { places } = campLayout(70, 6, 0);
    const blocks = places.filter((place) => place.span === 2);

    expect(blocks).toHaveLength(6);
    expect(new Set(blocks.map((block) => block.y)).size).toBeGreaterThan(1);
    expect(Math.max(...blocks.map((block) => block.y))).toBeGreaterThan(2);
  });

  it('deals the same arrangement every time, so nothing reshuffles on a render', () => {
    expect(campLayout(40, 4, 6)).toEqual(campLayout(40, 4, 6));
    expect(campLayout(40, 4, 6)).not.toEqual(campLayout(41, 4, 6));
  });

  it('scatters the two camps differently', () => {
    // Same camp size, same number of blobs: without a salt per camp the two
    // would come out as the same pattern twice, which reads as a wallpaper.
    const { places } = campLayout(50, 4, 4);
    const yours = places.slice(0, 50).filter((place) => place.span === 2);
    const theirs = places.slice(50).filter((place) => place.span === 2);
    const shape = (blocks: Placement[]): string =>
      blocks.map((block) => `${block.x},${block.y}`).join(' ');

    expect(shape(yours)).not.toBe(shape(theirs.map((block) => ({ ...block, y: block.y - 5.7 }))));
  });

  it('measures a camp by the cells it uses, not by the people in it', () => {
    /*
     * Your dot plus four blocks is seventeen of the twenty cells in two rows,
     * so three dots fill the rest and eight people are exactly two rows tall.
     * The other camp's ninety-two are ten.
     */
    const tight = campLayout(8, 4, 0);
    expect(tight.height).toBeCloseTo(extent(2 + 10, tight.margin) + CAMP_GAP_CELLS);

    // The same four blocks with twelve more people behind them: the blocks
    // still hold their two rows and the pack flows on underneath.
    const roomy = campLayout(20, 4, 0);
    expect(roomy.height).toBeCloseTo(extent(4 + 8, roomy.margin) + CAMP_GAP_CELLS);
  });

  /*
   * A cameo is one of the hundred drawn larger, not an extra body, so a camp
   * can hold no more of them than it has dots — otherwise "nineteen out of a
   * hundred" would stop being a count of what is on screen. Reachable whenever
   * the recent window disagrees with the tally.
   */
  it('draws no more cameos than the camp has dots', () => {
    expect(cameoCapacity(3, true)).toBe(2);
    expect(cameoCapacity(3, false)).toBe(3);
    expect(cameoCapacity(0, true)).toBe(0);

    const layout = campLayout(3, CAMEO_COUNT, 0);
    expect(layout.places.filter((place) => place.span === 2)).toHaveLength(2);
    expect(layout.places).toHaveLength(CROWD_SIZE);
  });

  it('renders a crowd where nobody else is named', () => {
    const layout = campLayout(19, 0, 0);
    expect(layout.places.every((place) => place.span === 1)).toBe(true);
    expect(anyOverlap(layout.places)).toBe(false);
  });
});

describe('the blob in a cameo block', () => {
  /*
   * The whole reason the box maths survived cameos: the drawing fits inside the
   * block, so no accessory paints outside the crowd's own box and nothing has
   * to be given extra headroom to keep it off the slide's scroll boundary.
   */
  it('fits inside its block, accessory and all', () => {
    const blob = cameoBlob();
    const block = extent(2, 0);

    expect(blob.height).toBeLessThanOrEqual(block + 0.0001);
    expect(blob.width + blob.inset * 2).toBeCloseTo(block);
    expect(blob.height / blob.width).toBeCloseTo(1.5);
  });

  it('draws a head bigger than a dot but nothing like twice the block', () => {
    const blob = cameoBlob();
    expect(blob.width).toBeGreaterThan(DOT_RATIO);
    expect(blob.width).toBeLessThan(extent(2, 0));
  });
});

describe('fitting the crowd to its box', () => {
  it('takes the tighter of the two dimensions', () => {
    const layout = campLayout(50);
    expect(cellFor({ width: 1000, height: 100 }, layout)).toBeCloseTo(100 / layout.height);
    expect(cellFor({ width: 100, height: 1000 }, layout)).toBeCloseTo(100 / layout.width);
  });

  it('has no answer for a box that has not been measured yet', () => {
    expect(cellFor({ width: 0, height: 0 }, campLayout(50))).toBe(0);
  });

  it('leaves the scatter one cell per dot', () => {
    const scatter = Array.from({ length: CROWD_SIZE }, (_, index) => ({ x: index % 10, y: 0 }));
    expect(scatterLayout(scatter).places.every((place) => place.span === 1)).toBe(true);
  });
});
