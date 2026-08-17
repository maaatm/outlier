/**
 * The item catalogue: the faces and accessories a blob is made of.
 *
 * Data and its copy in one place, the way `badges.ts` and `points.ts` do it, so
 * the client can draw an item and the server can validate an equip against the
 * same list.
 *
 * What is *not* here is the drawing. An item is an id, a name and a rarity;
 * what it looks like lives in `client/counterArt.ts`, keyed by the same ids.
 * The split is the server's doing: this file is the one the server imports, to
 * check that a submitted id exists and is the kind it claims to be, and a
 * thousand characters of path data is none of its business.
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
 * ## The order of these lists
 *
 * Each list runs common, then uncommon, then rare. The wardrobe's steppers walk
 * a list as a ring, so the order is what a player steps through, and a ring that
 * climbs is one they can feel their way along. It is also why nothing is ever
 * re-sorted here: a new item goes at the end of its band, so that everything
 * already in the list stays where the player last left it.
 *
 * ## The geometry
 *
 * Every drawing is authored against one viewBox with the dot at a known place,
 * or nothing lines up the moment the dot resizes:
 *
 *     viewBox   0 0 100 150
 *     the dot   centre (50, 100), outer radius 50 — the bottom third of the box
 *     above it  y 0..56, which is the accessory's room and nobody else's
 *
 * The radius is the dot's *outer* edge, matching `.dot` in `styles.css`: a 2px
 * border on a border-box element, so a 24px dot is 24px across including its
 * ink. A blob drawn at `size` is therefore `size` wide and `size * 1.5` tall,
 * and an accessory that towers over the head is still inside the element's own
 * box. That is deliberate — `.slide` and `.menu__body` are scroll containers,
 * and a scroll container clips on both axes, so anything painting outside its
 * box loses an edge there.
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
  starter: true,
};

export const FACES: readonly Item[] = [
  EYES,
  { id: 'tiny', kind: 'face', name: 'Pinpricks', rarity: 'common' },
  { id: 'wide', kind: 'face', name: 'Wide eyes', rarity: 'common' },
  { id: 'sleepy', kind: 'face', name: 'Sleepy', rarity: 'common' },
  { id: 'squint', kind: 'face', name: 'Squint', rarity: 'common' },
  { id: 'frown', kind: 'face', name: 'Frown', rarity: 'common' },
  { id: 'bored', kind: 'face', name: 'Bored', rarity: 'common' },
  { id: 'closed', kind: 'face', name: 'Eyes closed', rarity: 'uncommon' },
  { id: 'smile', kind: 'face', name: 'Smile', rarity: 'uncommon' },
  { id: 'oh', kind: 'face', name: 'Oh', rarity: 'uncommon' },
  { id: 'sideeye', kind: 'face', name: 'Side-eye', rarity: 'uncommon' },
  { id: 'grin', kind: 'face', name: 'Grin', rarity: 'uncommon' },
  { id: 'angry', kind: 'face', name: 'Angry', rarity: 'uncommon' },
  { id: 'tongue', kind: 'face', name: 'Tongue out', rarity: 'uncommon' },
  { id: 'wink', kind: 'face', name: 'Wink', rarity: 'rare' },
  { id: 'cyclops', kind: 'face', name: 'Cyclops', rarity: 'rare' },
  { id: 'third', kind: 'face', name: 'Third eye', rarity: 'rare' },
  { id: 'starry', kind: 'face', name: 'Starstruck', rarity: 'rare' },
  { id: 'foureyes', kind: 'face', name: 'Four eyes', rarity: 'rare' },
  { id: 'xeyes', kind: 'face', name: 'X eyes', rarity: 'rare' },
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
  starter: true,
};

export const ACCESSORIES: readonly Item[] = [
  BARE,
  { id: 'cowlick', kind: 'accessory', name: 'Cowlick', rarity: 'common' },
  { id: 'leaf', kind: 'accessory', name: 'Sprout', rarity: 'common' },
  { id: 'catears', kind: 'accessory', name: 'Cat ears', rarity: 'common' },
  { id: 'crest', kind: 'accessory', name: 'Crest', rarity: 'common' },
  { id: 'party', kind: 'accessory', name: 'Party hat', rarity: 'common' },
  { id: 'ears', kind: 'accessory', name: 'Bunny ears', rarity: 'uncommon' },
  { id: 'antennae', kind: 'accessory', name: 'Antennae', rarity: 'uncommon' },
  { id: 'devil', kind: 'accessory', name: 'Devil horns', rarity: 'uncommon' },
  { id: 'bow', kind: 'accessory', name: 'Bow', rarity: 'uncommon' },
  { id: 'bobble', kind: 'accessory', name: 'Bobble hat', rarity: 'uncommon' },
  { id: 'daisy', kind: 'accessory', name: 'Daisy', rarity: 'uncommon' },
  { id: 'starant', kind: 'accessory', name: 'Star antenna', rarity: 'uncommon' },
  { id: 'horn', kind: 'accessory', name: 'Unicorn horn', rarity: 'rare' },
  { id: 'halo', kind: 'accessory', name: 'Halo', rarity: 'rare' },
  { id: 'propeller', kind: 'accessory', name: 'Propeller', rarity: 'rare' },
  { id: 'crown', kind: 'accessory', name: 'Crown', rarity: 'rare' },
  { id: 'bolt', kind: 'accessory', name: 'Bolt', rarity: 'rare' },
  { id: 'tophat', kind: 'accessory', name: 'Top hat', rarity: 'rare' },
  { id: 'antlers', kind: 'accessory', name: 'Antlers', rarity: 'rare' },
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
 * An item by id alone, for the one caller that does not know the kind: a box
 * result arrives as an id, and which list it came out of is the answer rather
 * than part of the question. Safe because ids are unique across both lists —
 * asserted in `tests/items.test.ts`, which is what this leans on, and what
 * `counterArt.ts` leans on to key one table of drawings by id.
 */
export function findItem(id: string): Item | undefined {
  return ITEMS.find((item) => item.id === id);
}

/**
 * Whether a player may wear an item.
 *
 * Pure, and shared by both sides on purpose: the server enforces it on equip and
 * the wardrobe uses the same rule to decide what its steppers walk, so the two
 * cannot drift into a screen that offers something the server will refuse.
 *
 * Starter items always pass. They are owned implicitly by everyone and are never
 * written to an inventory — see `keys.inventory`.
 */
export function ownsItem(owned: readonly string[], item: Item): boolean {
  return item.starter === true || owned.includes(item.id);
}

/** The subset of a layer a player can actually put on. */
export function ownedItems(items: readonly Item[], owned: readonly string[]): Item[] {
  return items.filter((item) => ownsItem(owned, item));
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
 * Where an item sits in its list, for the wardrobe's "7 of 20".
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
