/**
 * How a counter is drawn, in the one place the drawing is decided.
 *
 * A counter is a moulded plastic piece: a disc with a darker band inside its
 * bottom edge, a face, and — if it is wearing one — an accessory. Not a line
 * drawing. Nothing here has an outline, because nothing in this design does.
 *
 * ## Why the drawing lives here rather than in the catalogue
 *
 * `shared/items.ts` owns what exists: the ids, the names and the rarities. That
 * file is the server's too — it validates equips against it — and none of what
 * follows is any of the server's business. So the catalogue keeps saying *which*
 * items there are and this says what they look like, keyed by the same ids.
 *
 * ## The geometry
 *
 * One authoring space, the one the catalogue documents:
 *
 *     viewBox   0 0 100 150
 *     the disc  centre (50, 100), radius 50 — the bottom third of the box
 *     above it  y 0..56, which is the accessory's room and nobody else's
 *
 * Accessories are drawn *behind* the disc, so anything below y≈52 tucks under
 * the rim and is hidden rather than painted across it. They stay inside x 4..96
 * and y 2..60: everything stays in the box, because the crowd's slides are
 * scroll containers and a scroll container clips on both axes.
 *
 * The rule the catalogue states is why these shapes are what they are: **an
 * accessory breaks the disc's silhouette, it does not decorate the inside of
 * it.** A hundred counters on a phone land somewhere around 14-22px, and at that
 * size an outline survives where detail does not.
 *
 * ## What a piece is made of
 *
 * An accessory paints in three layers, in this order:
 *
 *     cast   the whole path, one element, CAST_FILL, at CAST_TRANSFORM
 *     face   each subpath, the rarity's face colour, at FACE_TRANSFORM
 *     body   each subpath, the rarity's body colour, untransformed
 *
 * The cast is what makes a cream accessory survive on a cream block — your
 * record, a community question's author line. Hard-edged, because every other
 * shadow in this design is, and offset downward, because the light is above.
 *
 * ## One element per subpath
 *
 * Mirroring a path reverses its winding, so two overlapping halves inside a
 * single `d` cancel under the non-zero fill rule and the overlap punches a hole
 * — which is what clipped the antennae, the bow and the propeller. Every layer
 * but the cast is therefore drawn as one element per subpath, and each piece
 * simply paints over the last. See `subpathsFor`.
 */

import { VIEW_WIDTH, type Rarity } from '../shared/items.js';
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
 *
 * `wardrobe` is a maximum rather than a size: that room hands its slack to the
 * drawing and takes it back when the window is short, so the counter is this
 * big when there is height for it and smaller when there is not.
 */
export const COUNTER_SIZE = {
  crowd: 18,
  inline: 24,
  row: 26,
  panel: 76,
  wardrobe: 156,
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
 * Counters are the only thing in this design allowed to rotate. Nothing inside
 * one is, which is what makes the tilt read as pieces lying on a table rather
 * than as a style.
 */
const TILT_SCALE = 14 / 3;

/** The tilt of the counter at `index`, as a CSS `rotate` value. */
export function counterTilt(index: number): string {
  return `${(jitterFor(index).rotation * TILT_SCALE).toFixed(2)}deg`;
}

/* ── The pen ──────────────────────────────────────────────────────────────
 *
 * Six shapes make every mark in the catalogue. They are here rather than
 * inlined so that a face and the accessory above it are the same kind of data,
 * and so that a piece with a twin is authored once and mirrored.
 */

/** A circle as path data. Eyes, mouths, antenna heads and petals are circles. */
function disc(cx: number, cy: number, r: number): string {
  return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
}

/** A closed eye: two arcs bowing the same way, filled as the crescent between. */
function lid(cx: number): string {
  return `M ${cx - 11} 78 Q ${cx} 94 ${cx + 11} 78 Q ${cx} 84 ${cx - 11} 78 Z`;
}

/** A four-point star, its arms pinched in by `k` at the waist. */
function star(cx: number, cy: number, r: number): string {
  const k = r * 0.17;
  return (
    `M ${cx} ${cy - r} Q ${cx + k} ${cy - k} ${cx + r} ${cy} ` +
    `Q ${cx + k} ${cy + k} ${cx} ${cy + r} Q ${cx - k} ${cy + k} ${cx - r} ${cy} ` +
    `Q ${cx - k} ${cy - k} ${cx} ${cy - r} Z`
  );
}

/**
 * Two bars crossed at 45°, `r` long and `2t` thick.
 *
 * The corners are worked out rather than rotated, so an X is the same kind of
 * data as every other mark on a face — one path, no transform to carry.
 */
function cross(cx: number, cy: number, r: number, t: number): string {
  const corners: readonly (readonly [number, number])[] = [
    [-r, -t],
    [r, -t],
    [r, t],
    [-r, t],
  ];

  return [Math.PI / 4, -Math.PI / 4]
    .map((angle) => {
      const points = corners.map(
        ([x, y]) =>
          `${(cx + x * Math.cos(angle) - y * Math.sin(angle)).toFixed(1)} ` +
          `${(cy + x * Math.sin(angle) + y * Math.cos(angle)).toFixed(1)}`
      );
      return `M ${points.join(' L ')} Z`;
    })
    .join(' ');
}

/** A rounded rectangle as path data, its radius clamped so it cannot fold. */
function bar(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  return (
    `M ${x + rr} ${y} L ${x + w - rr} ${y} Q ${x + w} ${y} ${x + w} ${y + rr} ` +
    `L ${x + w} ${y + h - rr} Q ${x + w} ${y + h} ${x + w - rr} ${y + h} ` +
    `L ${x + rr} ${y + h} Q ${x} ${y + h} ${x} ${y + h - rr} ` +
    `L ${x} ${y + rr} Q ${x} ${y} ${x + rr} ${y} Z`
  );
}

/** How many numbers each path command takes its arguments in. */
const COMMAND_ARGS: Record<string, number> = {
  M: 2,
  L: 2,
  C: 6,
  Q: 4,
  T: 2,
  S: 4,
  A: 7,
  m: 2,
  l: 2,
  c: 6,
  q: 4,
  t: 2,
  s: 4,
  a: 7,
};

/**
 * A path reflected about the middle of the viewBox.
 *
 * Half of these pieces have a twin — ears, horns, antlers, the blades of a
 * propeller — and hand-authoring both halves is two chances to be slightly
 * wrong. This mirrors the numbers instead: every x becomes `100 - x`, and an
 * arc additionally flips its sweep flag and negates its x-axis rotation,
 * because a reflected arc bends the other way. The radii and the large-arc flag
 * are the same arc read from the other side and are left alone.
 */
export function mirror(d: string): string {
  const tokens = d.trim().split(/[\s,]+/);
  const out: string[] = [];
  let command = 'M';
  let at = 0;

  while (at < tokens.length) {
    const token = tokens[at]!;
    if (/^[a-zA-Z]$/.test(token)) {
      command = token;
      at++;
      out.push(command);
      if (command === 'Z' || command === 'z') continue;
    }

    const values = tokens.slice(at, at + (COMMAND_ARGS[command] ?? 2)).map(Number);
    at += values.length;

    if (command === 'A' || command === 'a') {
      values[2] = -values[2]!;
      values[4] = 1 - values[4]!;
      values[5] = command === 'A' ? VIEW_WIDTH - values[5]! : -values[5]!;
    } else {
      // Absolute coordinates reflect about the middle; relative ones are
      // deltas, and a delta reflects about zero.
      const absolute = command === command.toUpperCase();
      for (let k = 0; k < values.length; k += 2) {
        values[k] = absolute ? VIEW_WIDTH - values[k]! : -values[k]!;
      }
    }

    out.push(values.map((value) => String(Math.round(value * 100) / 100)).join(' '));
  }

  return out.join(' ');
}

/** A path and its reflection, which is how every symmetrical piece is drawn. */
function pair(d: string): string {
  return `${d} ${mirror(d)}`;
}

/** The daisy's five petals, one turn of a circle apart. */
const PETALS = [0, 1, 2, 3, 4]
  .map((i) => {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / 5;
    return disc(50 + Math.cos(angle) * 12, 26 + Math.sin(angle) * 12, 8.5);
  })
  .join(' ');

/** One item's drawing. `hole` is the one piece that must not be split — see below. */
type Art = {
  d: string;
  /**
   * The path is drawn as one element however many subpaths it has, because a
   * subpath is wound the other way *on purpose* and the fill rule is what
   * punches the hole out.
   */
  hole?: true;
};

/**
 * What each item is drawn as, keyed by the catalogue's own ids.
 *
 * Faces and accessories share one table because ids are unique across both
 * lists — `tests/items.test.ts` asserts it — and because a face and a hat are
 * the same kind of thing here: a path in the authoring space above.
 *
 * `bare` is absent rather than empty: wearing nothing is an item in the
 * catalogue, and here it is simply nothing to draw.
 */
const ART: Record<string, Art> = {
  /* ── Faces ─────────────────────────────────────────────────────────────
   * The part that only reads up close, which is why everyone has one and why
   * it is never what identifies a player across a crowd.
   */
  eyes: { d: `${disc(27, 81, 7)} ${disc(73, 81, 7)}` },
  tiny: { d: `${disc(30, 84, 4)} ${disc(70, 84, 4)}` },
  wide: { d: `${disc(28, 82, 11)} ${disc(72, 82, 11)}` },
  sleepy: { d: 'M 19 80 A 9 9 0 0 0 37 80 Z M 81 80 A 9 9 0 0 1 63 80 Z' },
  squint: { d: `${bar(17, 79, 22, 7, 3.5)} ${bar(61, 79, 22, 7, 3.5)}` },
  frown: {
    d: `${disc(28, 79, 6)} ${disc(72, 79, 6)} M 34 116 Q 50 98 66 116 Q 50 108 34 116 Z`,
  },
  bored: { d: `${disc(30, 80, 6)} ${disc(70, 80, 6)} ${bar(38, 106, 24, 6, 3)}` },
  closed: { d: `${lid(28)} ${lid(72)}` },
  smile: {
    d: `${disc(28, 79, 6)} ${disc(72, 79, 6)} M 34 104 Q 50 122 66 104 Q 50 112 34 104 Z`,
  },
  oh: { d: `${disc(30, 79, 6)} ${disc(70, 79, 6)} ${disc(50, 110, 10)}` },
  sideeye: { d: `${disc(36, 80, 7.5)} ${disc(78, 80, 7.5)}` },
  grin: { d: `${disc(28, 77, 6.5)} ${disc(72, 77, 6.5)} M 27 99 A 23 23 0 0 0 73 99 Z` },
  angry: {
    d: `${disc(30, 95, 6.5)} ${disc(70, 95, 6.5)} ${pair('M 17 65 L 40 75 L 38 82 L 16 73 Z')}`,
  },
  // The tongue overlaps the mouth it hangs out of, and the two are wound the
  // other way from each other — the plainest case of why subpaths are split.
  tongue: {
    d:
      `${disc(28, 78, 6)} ${disc(72, 78, 6)} M 30 100 A 20 20 0 0 0 70 100 Z ` +
      'M 41 112 L 59 112 L 59 127 Q 59 137 50 137 Q 41 137 41 127 Z',
  },
  wink: { d: `${disc(27, 81, 7)} ${lid(72)}` },
  cyclops: { d: disc(50, 86, 15) },
  third: { d: `${disc(30, 86, 7)} ${disc(70, 86, 7)} ${disc(50, 64, 8)}` },
  starry: { d: `${star(28, 81, 12)} ${star(72, 81, 12)}` },
  foureyes: { d: `${disc(28, 74, 6)} ${disc(72, 74, 6)} ${disc(28, 93, 6)} ${disc(72, 93, 6)}` },
  xeyes: { d: `${cross(28, 81, 11, 3.4)} ${cross(72, 81, 11, 3.4)}` },

  /* ── Accessories ───────────────────────────────────────────────────────
   * The half of the drawing that leaves the disc's silhouette. The bar each
   * one has to clear is 18px: not to be legible as an object, which nothing is
   * at that size, but to be a different outline from every other.
   */
  cowlick: { d: 'M 43 58 C 40 40 47 22 68 10 C 60 25 55 40 56 58 Z' },
  leaf: {
    d:
      'M 45 58 L 45 34 Q 45 29 50 29 Q 55 29 55 34 L 55 58 Z ' +
      'M 53 36 C 55 19 68 9 84 9 C 83 26 70 37 53 37 Z',
  },
  catears: { d: pair('M 24 58 Q 25 32 30 24 Q 39 39 45 56 Z') },
  crest: {
    d:
      'M 30 58 Q 31 40 36 30 Q 41 40 42 58 Z ' +
      'M 44 58 Q 45 32 50 20 Q 55 32 56 58 Z ' +
      'M 58 58 Q 59 40 64 30 Q 69 40 70 58 Z',
  },
  party: { d: `M 27 58 L 50 15 L 73 58 Z ${disc(50, 11, 8)}` },
  ears: { d: pair('M 30 58 C 24 46 21 27 26 16 C 31 9 39 14 39 27 C 39 39 40 48 40 58 Z') },
  antennae: {
    d: pair(`M 40 58 C 36 44 33 33 29 25 L 36 21 C 41 31 45 44 47 58 Z ${disc(31, 18, 9)}`),
  },
  devil: { d: pair('M 13 58 C 12 38 19 23 34 16 C 30 29 27 43 27 58 Z') },
  bow: { d: `${pair('M 48 44 L 9 20 L 12 54 Z')} ${disc(50, 44, 9)}` },
  bobble: { d: `M 16 58 C 16 32 31 20 50 20 C 69 20 84 32 84 58 Z ${disc(50, 14, 10)}` },
  daisy: { d: `M 46 58 L 46 34 Q 50 30 54 34 L 54 58 Z ${PETALS} ${disc(50, 26, 8)}` },
  starant: { d: `M 45 58 C 44 44 45 34 48 27 L 55 29 C 52 38 52 46 53 58 Z ${star(51, 18, 12)}` },
  horn: { d: 'M 39 58 Q 43 32 50 8 Q 57 32 61 58 Z' },
  /*
   * The one piece with a hole in it. The inner ellipse is wound the other way
   * round — `a … 1 1 …` against the outer's `a … 1 0 …` — so the default
   * non-zero fill rule punches it out. Splitting it would fill the hole in.
   */
  halo: {
    d:
      'M 18 26 a 32 10 0 1 0 64 0 a 32 10 0 1 0 -64 0 Z ' +
      'M 29 26 a 21 5 0 1 1 42 0 a 21 5 0 1 1 -42 0 Z',
    hole: true,
  },
  propeller: {
    d:
      `M 46 58 L 46 30 L 54 30 L 54 58 Z ` +
      `${pair('M 47 24 C 34 15 16 16 10 25 C 16 33 34 34 47 30 Z')} ${disc(50, 27, 8)}`,
  },
  crown: { d: 'M 20 58 L 20 24 L 33 38 L 50 16 L 67 38 L 80 24 L 80 58 Z' },
  bolt: { d: 'M 58 6 L 32 38 L 47 38 L 38 58 L 68 24 L 52 24 Z' },
  tophat: { d: `${bar(11, 44, 78, 11, 5)} ${bar(27, 6, 46, 42, 5)}` },
  antlers: {
    d:
      `${pair('M 34 58 C 30 44 26 30 22 18 L 30 15 C 35 28 39 44 41 58 Z')} ` +
      `${pair('M 27 32 L 11 25 L 8 32 L 25 39 Z')} ` +
      `${pair('M 23 19 L 13 6 L 19 2 L 29 15 Z')}`,
  },
};

/**
 * The whole of an item's drawing, as one path.
 *
 * Only the cast wants this: it is translucent, and one element is what stops
 * the fill doubling up where two pieces of the same accessory overlap. An id
 * with nothing to draw — `bare`, or one the catalogue has dropped — is empty.
 */
export function pathFor(id: string): string {
  return ART[id]?.d ?? '';
}

/**
 * An item's drawing as the elements it should be painted with: one per
 * subpath, so that overlapping pieces paint over each other instead of
 * cancelling out under the non-zero fill rule.
 *
 * The halo is the exception and says so in its own entry.
 */
export function subpathsFor(id: string): string[] {
  const art = ART[id];
  if (!art || art.d === '') return [];
  if (art.hole) return [art.d];
  return art.d.match(/M[^M]*/g) ?? [art.d];
}

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

/**
 * What an accessory casts, drawn rather than filtered.
 *
 * The disc's shadow is a circle in the stylesheet — see the note on
 * `.dot-slot--cameo::before` — but an accessory is not a circle and it is the
 * half of the drawing that leaves the disc's silhouette, so it needs its own.
 * This is the same path, a little bigger and a little lower, in a dark
 * translucent fill, painted behind everything.
 *
 * It has to exist. Accessories are moulded in cream, and a counter is drawn on
 * a cream block in two places — your record and a community question's author
 * line — where cream on cream is nothing at all.
 *
 * The scale is about (50, 38) rather than the shape's own middle, so that every
 * piece grows away from the head it is sitting on instead of each one growing
 * about somewhere different.
 */
export const CAST_FILL = 'rgba(18, 32, 24, 0.26)';

export const CAST_TRANSFORM = 'translate(0 7) translate(50 38) scale(1.06) translate(-50 -38)';

/**
 * How far the rarity's face colour is dropped below the body.
 *
 * The body is painted over it and the five units that stick out below are the
 * piece's own bottom face — the same trick as a block's, without needing to
 * know where any particular shape's bottom is.
 */
export const FACE_TRANSFORM = 'translate(0 5)';

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
