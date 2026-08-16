/**
 * How a counter is drawn, in the one place the drawing is decided.
 *
 * A counter is a moulded plastic piece: a disc with a darker band inside its
 * bottom edge, a face, and — if it is wearing one — an accessory made of
 * blocks. Not a line drawing. Nothing here has an outline, because nothing in
 * this design does.
 *
 * ## Why the accessories live here rather than in the catalogue
 *
 * `shared/items.ts` owns what exists: the ids, the names, the rarities, and the
 * silhouettes the old outlined artwork was drawn from. That file is the
 * server's too — it validates equips against it — and none of what follows is
 * any of the server's business. So the catalogue keeps saying *which* items
 * there are and this says *what they look like now*, keyed by the same ids.
 *
 * ## The geometry
 *
 * Same viewBox the catalogue documents, so nothing that measures a counter had
 * to learn anything new:
 *
 *     viewBox   0 0 100 150
 *     the disc  centre (50, 100), radius 50 — the bottom third of the box
 *     above it  y 0..50, which is the accessory's room and nobody else's
 *
 * Blocks are authored in that space and may run past y=50 at the bottom: they
 * are drawn *behind* the disc, so whatever tucks under the rim is hidden by it
 * rather than painted on top of it. Everything stays inside the box, because
 * the crowd's slides are scroll containers and a scroll container clips.
 *
 * The rule the catalogue states still holds and is why these shapes are what
 * they are: **an accessory breaks the disc's silhouette, it does not decorate
 * the inside of it.** A hundred counters on a phone land somewhere around
 * 14-22px, and at that size an outline survives where detail does not.
 */

import type { Rarity } from '../shared/items.js';
import { jitterFor } from './jitter.js';

/** The disc, matching `BLOB_CIRCLE` in the catalogue. */
const DISC = { cx: 50, cy: 100, r: 50 } as const;

/**
 * How deep the band inside the disc's bottom edge runs, in view units.
 *
 * It is the same light-catching-the-rim the crowd's counters get from
 * `--counter-lift`, drawn rather than shadowed because this is one SVG and an
 * inset box-shadow is not available inside one.
 */
const RIM = 7;

/**
 * The sizes a counter is drawn at, and the only ones it is tuned for.
 *
 * `crowd` is where a piece lands on a phone once the crowd has measured
 * itself; `inline` sits in front of a community question's author line; `row`
 * is a leaderboard avatar; `panel` is your own record; `wardrobe` is the one
 * the player is working on, and the only screen where the counter is the
 * subject rather than a label.
 */
export const COUNTER_SIZE = {
  crowd: 18,
  inline: 24,
  row: 28,
  panel: 76,
  wardrobe: 172,
} as const;

/**
 * How far a counter is tipped, at most.
 *
 * `jitterFor` hands out ±3°, which was the right amount of waver for a drawn
 * dot and is nowhere near enough for a plastic piece somebody tipped out of a
 * cup. Scaling the seeded value rather than reaching for a new hash keeps the
 * arrangement stable across renders and reloads, and keeps `jitter.ts` the one
 * place the crowd's imperfection is decided.
 *
 * Counters are the only thing in this design allowed to rotate. Every block is
 * square to the screen, which is what makes the tilt read as pieces lying on a
 * table rather than as a style.
 */
const TILT_SCALE = 14 / 3;

/** The tilt of the counter at `index`, as a CSS `rotate` value. */
export function counterTilt(index: number): string {
  return `${(jitterFor(index).rotation * TILT_SCALE).toFixed(2)}deg`;
}

/** One moulded piece of an accessory. Rounded, square to the world, tilted. */
export type Block = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Corner radius. Never half the width — a block is not a pill. */
  r: number;
  /** Degrees. The piece is rotated about its own centre. */
  rot?: number;
};

/**
 * What each accessory is made of.
 *
 * Two of these are the handoff's own: bunny ears are two tall blocks at ±10°,
 * and the flat one across the top is the visor shape. The rest are drawn in
 * the same idiom — as few blocks as the silhouette needs, and never more than
 * two, because a third is detail and detail is what disappears at 18px.
 *
 * `bare` is absent rather than empty: wearing nothing is an item in the
 * catalogue, and here it is simply nothing to draw.
 */
const ACCESSORY_BLOCKS: Record<string, Block[]> = {
  cowlick: [{ x: 45, y: 12, w: 13, h: 46, r: 6, rot: 18 }],
  leaf: [
    { x: 47, y: 20, w: 8, h: 38, r: 4 },
    { x: 55, y: 13, w: 25, h: 13, r: 6, rot: -24 },
  ],
  ears: [
    { x: 21, y: 24, w: 16, h: 43, r: 8, rot: -10 },
    { x: 63, y: 24, w: 16, h: 43, r: 8, rot: 10 },
  ],
  antennae: [
    { x: 29, y: 14, w: 7, h: 44, r: 3, rot: -13 },
    { x: 64, y: 14, w: 7, h: 44, r: 3, rot: 13 },
  ],
  devil: [
    { x: 11, y: 20, w: 15, h: 42, r: 7, rot: -26 },
    { x: 74, y: 20, w: 15, h: 42, r: 7, rot: 26 },
  ],
  horn: [{ x: 42, y: 8, w: 16, h: 52, r: 8 }],
  halo: [{ x: 21, y: 20, w: 58, h: 15, r: 7 }],
  propeller: [
    { x: 46, y: 28, w: 8, h: 30, r: 4 },
    { x: 14, y: 22, w: 72, h: 13, r: 6, rot: -7 },
  ],
};

/**
 * The two colours an accessory is moulded in.
 *
 * Rarity rides on the bottom face — and, for a rare, on the whole piece, which
 * is the one place violet appears in the app. It is the second channel and
 * never the only one: the wardrobe writes the rarity out beside the count.
 */
export type Paint = { body: string; face: string };

const PAINT: Record<Rarity, Paint> = {
  common: { body: 'var(--cream)', face: 'var(--rarity-common)' },
  uncommon: { body: 'var(--cream)', face: 'var(--rarity-uncommon)' },
  rare: { body: 'var(--violet)', face: 'var(--violet-face)' },
};

export function paintFor(rarity: Rarity): Paint {
  return PAINT[rarity];
}

export function blocksFor(accessoryId: string): Block[] {
  return ACCESSORY_BLOCKS[accessoryId] ?? [];
}

/** How thick a block's own bottom face is, given how tall the block is. */
export function faceDepth(block: Block): number {
  return Math.min(6, Math.max(3, block.h * 0.12));
}

/**
 * Where the disc starts hiding things.
 *
 * Accessory blocks run past the rim on purpose — they are drawn behind the
 * disc, so whatever tucks under it is hidden rather than painted across it.
 * That means a block's *own* bottom edge is usually somewhere nobody can see,
 * and a bottom face drawn there would take the rarity with it.
 */
const TUCK = 54;

/**
 * The band inside the bottom of a block, as a path.
 *
 * A rectangle with two square corners and two round ones, so it follows the
 * block's own bottom edge exactly — unless that edge is under the disc, in
 * which case the band sits at the rim instead and squares off, because it is
 * no longer the end of anything. Drawn rather than clipped because a clip path
 * needs an id, and an id has to be unique across every counter on the screen —
 * which on the reveal is a hundred of them.
 */
export function blockFace(block: Block): string {
  const { x, y, w, h } = block;
  const bottom = Math.min(y + h, TUCK);
  const r = bottom === y + h ? block.r : 0;
  const top = bottom - faceDepth(block);

  return [
    `M ${x} ${top}`,
    `L ${x} ${bottom - r}`,
    `Q ${x} ${bottom} ${x + r} ${bottom}`,
    `L ${x + w - r} ${bottom}`,
    `Q ${x + w} ${bottom} ${x + w} ${bottom - r}`,
    `L ${x + w} ${top}`,
    'Z',
  ].join(' ');
}

/** `rotate(deg cx cy)` about the block's own centre, or nothing. */
export function blockSpin(block: Block): string | undefined {
  if (!block.rot) return undefined;
  return `rotate(${block.rot} ${block.x + block.w / 2} ${block.y + block.h / 2})`;
}

/**
 * The disc's own rim: the circular segment below `RIM` units from the bottom.
 *
 * Constant, so it is worked out once rather than on every counter drawn.
 */
export const DISC_RIM = (() => {
  const y = DISC.cy + DISC.r - RIM;
  const half = Math.sqrt(DISC.r * DISC.r - (y - DISC.cy) * (y - DISC.cy));
  const left = (DISC.cx - half).toFixed(2);
  const right = (DISC.cx + half).toFixed(2);
  // Sweep 0: from the left of the segment, down around the bottom, back up to
  // the right of it.
  return `M ${left} ${y} A ${DISC.r} ${DISC.r} 0 0 0 ${right} ${y} Z`;
})();

/**
 * Which of the three fills a player's counter takes on a leaderboard row.
 *
 * The board knows a userId, a name and a number of points, and nothing else —
 * asking the server for eleven players' equipped items would be a second round
 * trip for eleven pieces of decoration. So the row's counter is plain, and its
 * colour is drawn from the id: stable for a given player, mixed down the board,
 * and carrying no meaning at all. The one counter on that screen that *does*
 * mean something — yours — is marked by a collar and by being pinned to the
 * bottom, not by its fill.
 */
export function rowTint(userId: string): 'cream' | 'orange' | 'yellow' {
  let hash = 0x811c9dc5;
  for (let index = 0; index < userId.length; index++) {
    hash ^= userId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (['cream', 'orange', 'yellow'] as const)[(hash >>> 0) % 3]!;
}
