/**
 * Where the hundred dots rest, and the box that exactly holds them.
 *
 * Lifted out of `DotCrowd` when cameos arrived, because this is now the part
 * with a real algorithm in it and an algorithm nobody can write a test against
 * is an algorithm nobody can change. The component still owns the rendering and
 * the motion; this owns the arithmetic.
 *
 * Everything here is in **cells**. The caller measures its own box, divides it
 * by the layout's width and height, and multiplies back — which is what makes
 * the crowd grow with the screen instead of sitting at a fixed size in the
 * middle of it.
 *
 * ## The one thing that changed
 *
 * Every dot used to occupy exactly one cell, and the row packing, the box
 * extent and the centring all leaned on that. A cameo is a player's blob rather
 * than a dot, and it takes a **2x2 block**: two cells wide, two cells tall,
 * pulled to the front of its camp so the pack flows around it.
 *
 * The box maths survives that untouched, and it is worth saying why. A block
 * placed at column `c` reaches `c + 1 + DOT_RATIO`, which is exactly what a
 * plain dot in column `c + 1` reaches; the same holds downwards. A cameo can
 * therefore never push past the extent of the cells it sits on, so `extent()`
 * still bounds the arrangement as long as the row count includes a block's
 * second row. Nothing about the margin, the centring or the cell fit had to
 * learn about cameos at all.
 *
 * The blob is drawn to *fit* its block rather than to overflow it — see
 * `cameoBlob` below. That is the detail that keeps this simple: no accessory
 * paints outside the crowd's own box, so nothing clips against the slide's
 * scroll boundary and the camp gap stays what it was.
 */

import { CROWD_SIZE } from '../shared/config.js';

export const PER_ROW = 10;
/** Blank space between the two camps, in cells. */
export const CAMP_GAP_CELLS = 0.7;

/** A dot fills most of its cell; the remainder is the breathing room. */
export const DOT_RATIO = 0.9;

/** The size everything was tuned against, so jitter scales with the cell. */
export const REFERENCE_CELL = 20;

/** Jitter is ±2px at the reference cell, which is a constant in cells. */
export const JITTER_CELLS = 2 / REFERENCE_CELL;
/** How far your dot sits proud of the pack, up and to the left. */
export const PROUD_CELLS = 0.16;
/** How far a dot strays from its cell in the pre-reveal scatter. */
export const SCATTER_SPREAD = 0.45;

/** How many cells across a cameo's block is. Square, so this is both ways. */
const CAMEO_CELLS = 2;

export type Placement = {
  x: number;
  y: number;
  /** Cells across. 1 for a dot, `CAMEO_CELLS` for a cameo's block. */
  span: number;
};

/**
 * The box is measured from the arrangement actually on screen rather than from
 * a worst case, so the crowd fills the space it is given and sits centred in
 * it — a fifty-fifty split needs ten rows, a fifty-five split needs eleven, and
 * the scatter before the reveal needs ten.
 */
export type Layout = {
  places: Placement[];
  width: number;
  height: number;
  /** Slack on every side, for what strays outside its cell. Kept symmetric so
      the crowd stays centred in the box. */
  margin: number;
};

/** How much room a run of `count` cells needs: the span, the dot, the slack. */
export function extent(count: number, margin: number): number {
  return count - 1 + DOT_RATIO + margin * 2;
}

/**
 * How many of a camp's dots may be cameos.
 *
 * A cameo is one of the hundred drawn larger, not an extra body — otherwise the
 * count on screen stops being the count, and "nineteen out of a hundred" is the
 * whole point of this component. So a camp can hold no more cameos than it has
 * dots, and your own camp keeps one back for you.
 *
 * This bites when the recent window disagrees with the tally: a question
 * sitting at 5% whose last few voters all said yes has more cameos on that side
 * than there are dots to be. The extra ones are simply not drawn.
 */
export function cameoCapacity(dots: number, isYours: boolean): number {
  return Math.max(0, dots - (isYours ? 1 : 0));
}

/**
 * Two blocks, ten to a row: your camp on top, theirs below, with a gap between.
 * The row counts carry the proportion on their own.
 *
 * `yourCameos` and `theirCameos` are how many of each camp's dots are drawn as
 * players. They are clamped here rather than by the caller, because the rule is
 * a property of the layout and a caller that got it wrong would produce an
 * arrangement rather than an error.
 */
export function campLayout(withYou: number, yourCameos = 0, theirCameos = 0): Layout {
  const theirs = CROWD_SIZE - withYou;

  // Your dot holds the top-left cell of its camp. It is the position the whole
  // screen is composed around — proud of the pack, landing last — so a cameo
  // never takes it, however many of them there are. Ordinarily that camp is
  // yours; when the rounding leaves your side with no dots at all, index 0 is
  // the head of the other one and the anchor goes with it.
  const yoursIsEmpty = withYou <= 0;
  const mine = packCamp(withYou, Math.min(yourCameos, cameoCapacity(withYou, true)), !yoursIsEmpty);
  const other = packCamp(
    theirs,
    Math.min(theirCameos, cameoCapacity(theirs, yoursIsEmpty)),
    yoursIsEmpty
  );

  // Nothing to separate when one camp took every dot.
  const gap = mine.rows > 0 && other.rows > 0 ? CAMP_GAP_CELLS : 0;
  const offset = mine.rows + gap;

  const places: Placement[] = [
    ...mine.places,
    ...other.places.map((place) => ({ ...place, y: place.y + offset })),
  ];

  const margin = JITTER_CELLS + PROUD_CELLS;
  return {
    places,
    width: extent(PER_ROW, margin),
    height: extent(mine.rows + other.rows, margin) + gap,
    margin,
  };
}

/**
 * One camp: the anchor, then the cameos, then everyone else.
 *
 * The grid is a set of taken cells rather than a row cursor, because a 2x2
 * block leaves holes beside and under it that the pack should flow into rather
 * than skip. Each cameo takes the first block that fits, scanning row-major,
 * and the plain dots take whatever is left in the same order — so the crowd
 * still fills from the top-left and still reads as one population.
 *
 * The order of `places` is the order the caller's indices arrive in: the anchor
 * first, then the cameos, then the pack. That is what lets the render loop keep
 * using an index for its stagger and its jitter.
 */
function packCamp(
  dots: number,
  cameos: number,
  hasAnchor: boolean
): { places: Placement[]; rows: number } {
  if (dots <= 0) return { places: [], rows: 0 };

  const taken = new Set<string>();
  const key = (x: number, y: number): string => `${x},${y}`;
  const free = (x: number, y: number): boolean => !taken.has(key(x, y));

  const anchor: Placement[] = [];
  if (hasAnchor) {
    taken.add(key(0, 0));
    anchor.push({ x: 0, y: 0, span: 1 });
  }

  const blocks: Placement[] = [];
  for (let placed = 0; placed < cameos; placed++) {
    const at = firstBlock(free);
    for (let dx = 0; dx < CAMEO_CELLS; dx++) {
      for (let dy = 0; dy < CAMEO_CELLS; dy++) taken.add(key(at.x + dx, at.y + dy));
    }
    blocks.push({ ...at, span: CAMEO_CELLS });
  }

  const pack: Placement[] = [];
  const remaining = dots - anchor.length - blocks.length;
  for (let row = 0; pack.length < remaining; row++) {
    for (let column = 0; column < PER_ROW && pack.length < remaining; column++) {
      if (!free(column, row)) continue;
      taken.add(key(column, row));
      pack.push({ x: column, y: row, span: 1 });
    }
  }

  return { places: [...anchor, ...blocks, ...pack], rows: rowsOf(taken) };
}

/** The first place a 2x2 block fits, scanning left to right and down. */
function firstBlock(free: (x: number, y: number) => boolean): { x: number; y: number } {
  for (let row = 0; ; row++) {
    for (let column = 0; column <= PER_ROW - CAMEO_CELLS; column++) {
      const fits =
        free(column, row) &&
        free(column + 1, row) &&
        free(column, row + 1) &&
        free(column + 1, row + 1);
      if (fits) return { x: column, y: row };
    }
  }
}

/** How tall the camp ended up, counting a block's second row as occupied. */
function rowsOf(taken: Set<string>): number {
  let rows = 0;
  for (const cell of taken) {
    const row = Number(cell.split(',')[1]);
    if (row + 1 > rows) rows = row + 1;
  }
  return rows;
}

/** The loose neutral scatter, which strays a good part of a cell either way. */
export function scatterLayout(places: { x: number; y: number }[]): Layout {
  const margin = SCATTER_SPREAD + JITTER_CELLS;
  return {
    places: places.map((place) => ({ ...place, span: 1 })),
    width: extent(PER_ROW, margin),
    height: extent(Math.ceil(CROWD_SIZE / PER_ROW), margin),
    margin,
  };
}

/** Largest cell that fits the whole layout into the measured box. */
export function cellFor(box: { width: number; height: number }, layout: Layout): number {
  if (box.width <= 0 || box.height <= 0) return 0;
  return Math.min(box.width / layout.width, box.height / layout.height);
}

/**
 * The blob drawn in a cameo's block, in cells.
 *
 * A blob is half again as tall as it is wide, because its accessory lives
 * inside its own viewBox — see the geometry note in `shared/items.ts`. Fitting
 * that whole shape into the block, rather than sizing the head to the block and
 * letting the accessory hang over the top, is what keeps every cameo inside the
 * crowd's measured box: `.slide` is a scroll container and clips on both axes,
 * so art painting outside its box loses an edge there.
 *
 * The head lands around 1.4x a plain dot, which is enough to read as "these are
 * the ones we know" without competing with the viewer's own dot — that one wins
 * on colour, on position and on landing last, and it should keep winning.
 */
export function cameoBlob(): { width: number; height: number; inset: number } {
  const box = extent(CAMEO_CELLS, 0);
  const width = Math.min(box, (box * 2) / 3);
  return {
    width,
    height: (width * 3) / 2,
    // Centred across the block; the bottom of the drawing sits on the block's
    // bottom edge, which is where a plain dot in that row would sit.
    inset: (box - width) / 2,
  };
}
