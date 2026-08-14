/**
 * The item catalogue: the faces and accessories a blob is made of.
 *
 * Data and its copy in one place, the way `badges.ts` and `points.ts` do it, so
 * the client can draw an item and the server can validate an equip against the
 * same list.
 *
 * ## The rule for anything added here
 *
 * **An accessory breaks the circle's silhouette. It does not decorate the inside
 * of it.** The crowd sizes its own dots, and a hundred of them in ten or eleven
 * rows on a phone land somewhere around 14-22px — a size at which interior
 * detail is a smudge. That is exactly why the existing dot faces are two dark
 * spans and nothing more. A hat covers the top of the head with detail that
 * disappears; a horn, a pair of ears, a halo or an antenna changes the outline,
 * and an outline survives where detail does not.
 *
 * Faces are the exception that proves the rule. They are the part that only
 * reads up close, which is why everyone has one and why it is never the thing
 * that identifies a player across a crowd.
 *
 * ## The geometry
 *
 * Every path is authored against one viewBox with the dot at a known place, or
 * nothing lines up the moment the dot resizes:
 *
 *     viewBox   0 0 100 150
 *     the dot   centre (50, 100), outer radius 50 — the bottom third of the box
 *     above it  y 0..50, which is the accessory's room and nobody else's
 *
 * The radius is the dot's *outer* edge, matching `.dot` in `styles.css`: a 2px
 * border on a border-box element, so a 24px dot is 24px across including its
 * ink. A blob drawn at `size` is therefore `size` wide and `size * 1.5` tall,
 * and an accessory that towers over the head is still inside the element's own
 * box. That is deliberate — `.slide` and `.menu__body` are scroll containers,
 * and a scroll container clips on both axes, so anything painting outside its
 * box loses an edge there.
 *
 * Accessories stay inside x 6..94 and y 6..56 for the same reason. The ink is a
 * constant 2px on screen, which at 18px is eleven units of this space, and half
 * of it hangs outside the path it is drawn on.
 *
 * Accessories are drawn *behind* the head, so whatever tucks under the rim is
 * hidden rather than painted over it. Their bases run past y=50 on purpose.
 */

export type ItemKind = 'face' | 'accessory';

/**
 * How hard an item is to come by. Shown in the wardrobe as the colour of a
 * layer's border and as the word beside the count — the colours are their own
 * tokens, kept clear of the four the rest of the app assigns meanings to, and
 * they appear on that screen and no other.
 */
export type Rarity = 'common' | 'uncommon' | 'rare';

export type Item = {
  /** Stable, short, appears in storage — keep it boring. */
  id: string;
  kind: ItemKind;
  /** What the wardrobe calls it. */
  name: string;
  rarity: Rarity;
  /** Inline SVG path data. No files, no CDN — the app makes no external requests. */
  path: string;
  /** True for the pair everyone starts with. Never rolled from a box. */
  starter?: boolean;
};

/** The pair a player has on. Packed into one hash field — see `core/avatars.ts`. */
export type Equipped = {
  face: string;
  accessory: string;
};

export const VIEW_WIDTH = 100;
export const VIEW_HEIGHT = 150;
export const VIEW_BOX = `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`;

/** The dot itself. `r` is the outer edge of the ink, as a CSS border box is. */
export const BLOB_CIRCLE = { cx: 50, cy: 100, r: 50 } as const;

/** Ink is 2px at every size, the same as `.dot`'s border. */
const INK_PX = 2;

/**
 * The stroke, in user units, that renders as 2px at a given pixel size.
 *
 * Scaling the stroke instead of fixing it in units is what keeps a blob in the
 * author line and a blob in the wardrobe the same drawing rather than the same
 * drawing at two weights.
 */
export function blobStroke(size: number): number {
  return (INK_PX * VIEW_WIDTH) / size;
}

/** A blob is taller than it is wide, because the accessory lives inside its box. */
export function blobHeight(size: number): number {
  return (size * VIEW_HEIGHT) / VIEW_WIDTH;
}

/** A circle as path data. Eyes, mouths and antenna heads are all circles. */
function disc(cx: number, cy: number, r: number): string {
  return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
}

/** A closed eye: two arcs bowing the same way, filled as the crescent between. */
function lid(cx: number): string {
  return `M ${cx - 11} 78 Q ${cx} 94 ${cx + 11} 78 Q ${cx} 84 ${cx - 11} 78 Z`;
}

/**
 * The starter face is the dot the crowd already draws — two spans at 14% of the
 * dot, 24% down, inset 20% — so today's crowd is already the default blob rather
 * than something this feature replaced.
 */
const EYES: Item = {
  id: 'eyes',
  kind: 'face',
  name: 'Two eyes',
  rarity: 'common',
  path: `${disc(27, 81, 7)} ${disc(73, 81, 7)}`,
  starter: true,
};

export const FACES: readonly Item[] = [
  EYES,
  {
    id: 'tiny',
    kind: 'face',
    name: 'Pinpricks',
    rarity: 'common',
    path: `${disc(30, 84, 4)} ${disc(70, 84, 4)}`,
  },
  {
    id: 'wide',
    kind: 'face',
    name: 'Wide eyes',
    rarity: 'common',
    path: `${disc(28, 82, 11)} ${disc(72, 82, 11)}`,
  },
  {
    id: 'closed',
    kind: 'face',
    name: 'Eyes closed',
    rarity: 'uncommon',
    path: `${lid(28)} ${lid(72)}`,
  },
  {
    id: 'smile',
    kind: 'face',
    name: 'Smile',
    rarity: 'uncommon',
    path: `${disc(28, 79, 6)} ${disc(72, 79, 6)} M 34 104 Q 50 122 66 104 Q 50 112 34 104 Z`,
  },
  {
    id: 'oh',
    kind: 'face',
    name: 'Oh',
    rarity: 'uncommon',
    path: `${disc(30, 79, 6)} ${disc(70, 79, 6)} ${disc(50, 110, 10)}`,
  },
  {
    id: 'wink',
    kind: 'face',
    name: 'Wink',
    rarity: 'rare',
    path: `${disc(27, 81, 7)} ${lid(72)}`,
  },
  {
    id: 'cyclops',
    kind: 'face',
    name: 'Cyclops',
    rarity: 'rare',
    path: disc(50, 86, 15),
  },
];

/**
 * Wearing nothing is an item, not the absence of one.
 *
 * It gives the wardrobe an honest way to take an accessory off, and it makes the
 * starter pair identical to the dot the crowd draws today.
 */
const BARE: Item = {
  id: 'bare',
  kind: 'accessory',
  name: 'Bare',
  rarity: 'common',
  path: '',
  starter: true,
};

export const ACCESSORIES: readonly Item[] = [
  BARE,
  {
    id: 'cowlick',
    kind: 'accessory',
    name: 'Cowlick',
    rarity: 'common',
    path: 'M 43 55 C 44 38 52 26 68 20 C 62 30 56 38 54 55 Z',
  },
  {
    id: 'leaf',
    kind: 'accessory',
    name: 'Sprout',
    rarity: 'common',
    path: 'M 54 53 C 54 34 64 20 82 14 C 82 34 74 48 64 53 Z',
  },
  {
    id: 'ears',
    kind: 'accessory',
    name: 'Bunny ears',
    rarity: 'uncommon',
    path:
      'M 42 56 C 30 42 25 26 30 16 C 36 11 44 22 46 36 C 47 45 47 51 47 56 Z ' +
      'M 58 56 C 70 42 75 26 70 16 C 64 11 56 22 54 36 C 53 45 53 51 53 56 Z',
  },
  {
    id: 'antennae',
    kind: 'accessory',
    name: 'Antennae',
    rarity: 'uncommon',
    path:
      `M 41 57 L 27 30 L 33 27 L 47 55 Z ${disc(28, 22, 8)} ` +
      `M 59 57 L 73 30 L 67 27 L 53 55 Z ${disc(72, 22, 8)}`,
  },
  {
    id: 'devil',
    kind: 'accessory',
    name: 'Devil horns',
    rarity: 'uncommon',
    /*
     * Set wider on the head and leaning outward, which is the only thing
     * separating a devil from a rabbit once both are eleven pixels of outline.
     */
    path:
      'M 22 62 C 14 52 10 38 13 24 C 24 32 32 48 36 60 Z ' +
      'M 78 62 C 86 52 90 38 87 24 C 76 32 68 48 64 60 Z',
  },
  {
    id: 'horn',
    kind: 'accessory',
    name: 'Unicorn horn',
    rarity: 'rare',
    path: 'M 41 56 Q 44 30 50 14 Q 56 30 59 56 Z',
  },
  {
    /*
     * The one item with a hole in it. The inner ellipse is wound the other way
     * round — `a … 1 1 …` against the outer's `a … 1 0 …` — so the default
     * non-zero fill rule punches it out. Every other path here is a union of
     * overlapping shapes and needs that same rule to merge rather than cancel,
     * which is why this is solved in the path data instead of with `evenodd`.
     */
    id: 'halo',
    kind: 'accessory',
    name: 'Halo',
    rarity: 'rare',
    path:
      'M 20 30 a 30 10 0 1 0 60 0 a 30 10 0 1 0 -60 0 Z ' +
      'M 30 30 a 20 5 0 1 1 40 0 a 20 5 0 1 1 -40 0 Z',
  },
  {
    id: 'propeller',
    kind: 'accessory',
    name: 'Propeller',
    rarity: 'rare',
    path:
      'M 14 30 C 18 21 34 21 46 27 C 58 21 82 21 86 30 C 82 39 58 39 46 33 ' +
      'C 34 39 18 39 14 30 Z M 46 56 L 46 30 L 54 30 L 54 56 Z',
  },
];

export const ITEMS: readonly Item[] = [...FACES, ...ACCESSORIES];

/** Owned by everyone implicitly, never written to an inventory, never rolled. */
export const STARTER_FACE = EYES;
export const STARTER_ACCESSORY = BARE;

export const STARTER_PAIR: Equipped = {
  face: STARTER_FACE.id,
  accessory: STARTER_ACCESSORY.id,
};

export function starterFor(kind: ItemKind): Item {
  return kind === 'face' ? STARTER_FACE : STARTER_ACCESSORY;
}

/**
 * An item by id, but only if it is the kind being asked for.
 *
 * The kind is part of the question rather than something checked afterwards,
 * which is what makes a face id submitted in the accessory slot a miss on the
 * server instead of a blob wearing its own eyes as a hat.
 */
export function getItem(id: string, kind: ItemKind): Item | undefined {
  return ITEMS.find((item) => item.id === id && item.kind === kind);
}

/**
 * What to draw for a stored id.
 *
 * Ids live in storage and an entry can be removed from the catalogue, so this
 * never comes back empty: a blank where a face should be is a worse failure
 * than a default one.
 */
export function resolveItem(id: string | undefined | null, kind: ItemKind): Item {
  return (id ? getItem(id, kind) : undefined) ?? starterFor(kind);
}

export function resolveFace(id: string | undefined | null): Item {
  return resolveItem(id, 'face');
}

export function resolveAccessory(id: string | undefined | null): Item {
  return resolveItem(id, 'accessory');
}

/**
 * Where an item sits in its list, for the wardrobe's "7 of 8".
 *
 * An id the catalogue does not have reads as the first item rather than as -1,
 * because every caller here is about to index with the answer and the first item
 * is the same fallback `resolveItem` would have reached for anyway.
 */
export function itemIndex(items: readonly Item[], id: string): number {
  const at = items.findIndex((item) => item.id === id);
  return at === -1 ? 0 : at;
}

/**
 * The item `delta` places along, wrapping at both ends.
 *
 * A catalogue has no first or last item — it is a ring you step around — and a
 * stepper that stops has two controls that do nothing whenever you are parked on
 * an end. Wrapping costs one modulo and removes the dead ends entirely.
 */
export function stepItem(items: readonly Item[], id: string, delta: number): Item {
  const at = itemIndex(items, id) + delta;
  // Twice, because `%` in JavaScript keeps the sign of the left operand and a
  // step backwards off the front would otherwise land on a negative index.
  return items[((at % items.length) + items.length) % items.length]!;
}

/**
 * `"faceId:accessoryId"`, the whole avatar in one hash field.
 *
 * Packed rather than spread over two fields or two keys so that a screen wanting
 * ten players' blobs pays one `hMGet` and not ten round trips.
 */
export function packAvatar(equipped: Equipped): string {
  return `${equipped.face}:${equipped.accessory}`;
}

/**
 * The other half of the pair, tolerant in the same way `decodeVote` is: a value
 * that does not parse falls back rather than throwing. The difference is that
 * there is a sensible answer to fall back *to*, so this returns the starter pair
 * instead of null and every caller is spared a branch.
 */
export function unpackAvatar(raw: string | undefined | null): Equipped {
  const [face, accessory] = (raw ?? '').split(':');
  return {
    face: resolveFace(face).id,
    accessory: resolveAccessory(accessory).id,
  };
}
