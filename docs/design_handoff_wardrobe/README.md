# Handoff: Outlier — wardrobe art (accessories remoulded + 23 new items)

## Overview

Two changes to the blob art, both client-side:

1. **Every accessory is redrawn.** The Blocks pass rebuilt them as literal rounded rectangles in `src/client/counterArt.ts` (`ACCESSORY_BLOCKS`) — a bunny ear as a 16×43 block tipped 10°, a halo as a 58×15 brick, a propeller as a bar. At the size these are actually read (18px in the crowd) a rectangle is a rectangle. Each piece goes back to its own silhouette, still moulded rather than outlined.
2. **The pool grows from 17 to 40 items** — 20 faces and 20 accessories, 38 of them rollable. 23 new pieces: 12 faces, 11 accessories.

Faces are otherwise untouched: the eight that exist keep their exact geometry.

Nothing about the game changes. `shared/roll.ts`, `shared/coins.ts` and `shared/points.ts` are not touched — but see **Rarity bands** below for one number worth a second look.

## The design files

- `Wardrobe Art.dc.html` — the reference, and the source of truth for every path. Open it in a browser; it is one design component with the whole sheet: 9a before/after, 9b accessories, 9c faces, 9d the same accessories at 18px and 26px plus three worn on the wardrobe counter.
- `support.js` — the runtime that file needs in order to open. Not a deliverable.

The reference is also the top turn (`#9a`–`#9d`) of `docs/design_handoff_blocks_ui/Outlier - Redesign Drafts.dc.html`; the two are the same drawing.

## Fidelity

**High.** Path data, rarities, names and ids are final — lift them verbatim from the catalogue below. Sizes, tilt and layout are already correct in the codebase and do not change.

---

## What a piece is made of

Same authoring space the catalogue already documents, unchanged:

    viewBox   0 0 100 150
    the disc  centre (50, 100), radius 50 — the bottom third of the box
    above it  y 0..56, which is the accessory's room and nobody else's

Accessories are drawn **behind** the disc, so anything below y≈52 tucks under the rim. They stay inside x 4..96 and y 2..60.

An accessory paints in three layers, in this order:

```
cast   the whole path, one element, fill rgba(18,32,24,.26)
       transform: translate(0 7) translate(50 38) scale(1.06) translate(-50 -38)
face   each subpath, fill = rarity face colour, transform: translate(0 5)
body   each subpath, fill = rarity body colour, no transform
```

Then the disc (its own cast at `translate(0 5)` in `rgba(18,32,24,.2)`, the fill, then `DISC_RIM` in `rgba(0,0,0,.16)`), then the face marks in `#3A2A18`.

The cast replaces the old soft halo and is what makes a cream accessory survive on a cream block (your record, a community question's author line). It is hard-edged and offset downward, like every other shadow in this design.

### Split the subpaths — this is the bug that clipped the old drawings

Mirroring a path reverses its winding. Two overlapping halves inside a **single** `d` therefore cancel under the non-zero fill rule and the overlap punches a hole — which is what clipped the antennae, the bow and the propeller. **Draw one `<path>` element per subpath** (split on `M`); each piece then simply paints over the last.

Two exceptions:

- **The cast stays whole** — one element for the entire path. Any hole in it is behind the body anyway, and a single element means the translucent fill cannot double up where two pieces overlap.
- **The halo keeps its hole.** Its inner ellipse is wound the other way on purpose, so it must stay one path. It carries `hole: true` in the catalogue; honour that flag instead of splitting.

### Paint

| Rarity | Body | Bottom face |
|---|---|---|
| common | `var(--cream)` `#FFF6E7` | `var(--rarity-common)` `#8b93a1` |
| uncommon | `var(--cream)` `#FFF6E7` | `var(--rarity-uncommon)` `#0f9bbd` |
| rare | `var(--violet)` `#8b5cf6` | `var(--violet-face)` `#6D3EE0` |

Unchanged from `paintFor()`. Rarity is still spoken twice — the face colour and the word beside the count — and still appears in the wardrobe and nowhere else.

---

## Where it lands in the repo

- **`src/client/counterArt.ts`** — delete `ACCESSORY_BLOCKS`, `Block`, `blocksFor`, `faceDepth`, `blockFace`, `blockSpin`, `blockCast` and `TUCK`. Replace with the path catalogue below plus `subpathsFor(id)` and the three-layer recipe. `DISC`, `RIM`, `DISC_RIM`, `COUNTER_SIZE`, `TILT_SCALE`, `counterTilt`, `PAINT`/`paintFor` and `rowTint` all stay as they are.
- **`src/shared/items.ts`** — add the 23 new entries (id, kind, name, rarity). The `path` field on `Item` is now dead: the drawing lives entirely in `counterArt.ts`, keyed by id, and none of it is the server's business. Dropping `path` from the type is the tidier end state; keeping it is harmless if it costs a wider diff. Ids are unique across both lists — `tests/items.test.ts` asserts it, and the new ones hold to it.
- **`src/client/components/Blob.tsx`** — one component still, one `<svg>`. The only change is that an accessory is now N path elements per layer instead of a list of rects.
- **`crowdLayout.ts`, `jitter.ts`, `DotCrowd.tsx`** — untouched.

## Rarity bands

| | common | uncommon | rare | total |
|---|---|---|---|---|
| faces | 7 | 7 | 6 | 20 |
| accessories | 6 | 7 | 7 | 20 |

`roll.ts` splits the pool into bands and picks uniformly inside the band, so nothing there needs a change. One number is now stale in prose only: `shared/config.ts` describes "the fourteen rollable items" as a season's worth. There are 38. The box price and the duplicate refund were tuned against 14 — worth a deliberate look before this ships, not a change I have made here.

## The catalogue

Verbatim from `Wardrobe Art.dc.html`. `D(cx,cy,r)` is a circle as path data, `lid(cx)` a closed eye, `star(cx,cy,r)` a four-point star, `X(cx,cy,r,t)` two bars crossed at 45°, `P(d)` a path plus its mirror about x=50, `artBar(x,y,w,h,r)` a rounded rect. All six are in the reference file, as is `artMirror`, which mirrors a path (including arc sweep flags) rather than hand-authoring both halves.

```js
const faces = [
  { id: 'eyes', name: 'Two eyes', rarity: 'common', d: `${D(27, 81, 7)} ${D(73, 81, 7)}` },
  { id: 'tiny', name: 'Pinpricks', rarity: 'common', d: `${D(30, 84, 4)} ${D(70, 84, 4)}` },
  { id: 'wide', name: 'Wide eyes', rarity: 'common', d: `${D(28, 82, 11)} ${D(72, 82, 11)}` },
  { id: 'sleepy', name: 'Sleepy', rarity: 'common', isNew: true, d: 'M 19 80 A 9 9 0 0 0 37 80 Z M 81 80 A 9 9 0 0 1 63 80 Z' },
  { id: 'squint', name: 'Squint', rarity: 'common', isNew: true, d: `${this.artBar(17, 79, 22, 7, 3.5)} ${this.artBar(61, 79, 22, 7, 3.5)}` },
  { id: 'closed', name: 'Eyes closed', rarity: 'uncommon', d: `${lid(28)} ${lid(72)}` },
  { id: 'smile', name: 'Smile', rarity: 'uncommon', d: `${D(28, 79, 6)} ${D(72, 79, 6)} M 34 104 Q 50 122 66 104 Q 50 112 34 104 Z` },
  { id: 'oh', name: 'Oh', rarity: 'uncommon', d: `${D(30, 79, 6)} ${D(70, 79, 6)} ${D(50, 110, 10)}` },
  { id: 'sideeye', name: 'Side-eye', rarity: 'uncommon', isNew: true, d: `${D(36, 80, 7.5)} ${D(78, 80, 7.5)}` },
  { id: 'grin', name: 'Grin', rarity: 'uncommon', isNew: true, d: `${D(28, 77, 6.5)} ${D(72, 77, 6.5)} M 27 99 A 23 23 0 0 0 73 99 Z` },
  { id: 'wink', name: 'Wink', rarity: 'rare', d: `${D(27, 81, 7)} ${lid(72)}` },
  { id: 'cyclops', name: 'Cyclops', rarity: 'rare', d: D(50, 86, 15) },
  { id: 'third', name: 'Third eye', rarity: 'rare', isNew: true, d: `${D(30, 86, 7)} ${D(70, 86, 7)} ${D(50, 64, 8)}` },
  { id: 'starry', name: 'Starstruck', rarity: 'rare', isNew: true, d: `${star(28, 81, 12)} ${star(72, 81, 12)}` },
];

const accs = [
  { id: 'bare', name: 'Bare', rarity: 'common', d: '' },
  { id: 'cowlick', name: 'Cowlick', rarity: 'common', d: 'M 43 58 C 40 40 47 22 68 10 C 60 25 55 40 56 58 Z' },
  { id: 'leaf', name: 'Sprout', rarity: 'common', d: 'M 45 58 L 45 34 Q 45 29 50 29 Q 55 29 55 34 L 55 58 Z M 53 36 C 55 19 68 9 84 9 C 83 26 70 37 53 37 Z' },
  { id: 'catears', name: 'Cat ears', rarity: 'common', isNew: true, d: P('M 24 58 Q 25 32 30 24 Q 39 39 45 56 Z') },
  { id: 'crest', name: 'Crest', rarity: 'common', isNew: true, d: 'M 30 58 Q 31 40 36 30 Q 41 40 42 58 Z M 44 58 Q 45 32 50 20 Q 55 32 56 58 Z M 58 58 Q 59 40 64 30 Q 69 40 70 58 Z' },
  { id: 'ears', name: 'Bunny ears', rarity: 'uncommon', d: P('M 30 58 C 24 46 21 27 26 16 C 31 9 39 14 39 27 C 39 39 40 48 40 58 Z') },
  { id: 'antennae', name: 'Antennae', rarity: 'uncommon', d: P(`M 40 58 C 36 44 33 33 29 25 L 36 21 C 41 31 45 44 47 58 Z ${D(31, 18, 9)}`) },
  { id: 'devil', name: 'Devil horns', rarity: 'uncommon', d: P('M 13 58 C 12 38 19 23 34 16 C 30 29 27 43 27 58 Z') },
  { id: 'bow', name: 'Bow', rarity: 'uncommon', isNew: true, d: `${P('M 48 44 L 9 20 L 12 54 Z')} ${D(50, 44, 9)}` },
  { id: 'bobble', name: 'Bobble hat', rarity: 'uncommon', isNew: true, d: `M 16 58 C 16 32 31 20 50 20 C 69 20 84 32 84 58 Z ${D(50, 14, 10)}` },
  { id: 'horn', name: 'Unicorn horn', rarity: 'rare', d: 'M 39 58 Q 43 32 50 8 Q 57 32 61 58 Z' },
  /* The one piece with a hole: the inner ellipse is wound the other way, so
   * it must stay a single path for the fill rule to punch it out. */
  { id: 'halo', name: 'Halo', rarity: 'rare', hole: true, d: 'M 18 26 a 32 10 0 1 0 64 0 a 32 10 0 1 0 -64 0 Z M 29 26 a 21 5 0 1 1 42 0 a 21 5 0 1 1 -42 0 Z' },
  { id: 'propeller', name: 'Propeller', rarity: 'rare', d: `M 46 58 L 46 30 L 54 30 L 54 58 Z ${P('M 47 24 C 34 15 16 16 10 25 C 16 33 34 34 47 30 Z')} ${D(50, 27, 8)}` },
  { id: 'crown', name: 'Crown', rarity: 'rare', isNew: true, d: 'M 20 58 L 20 24 L 33 38 L 50 16 L 67 38 L 80 24 L 80 58 Z' },
  { id: 'bolt', name: 'Bolt', rarity: 'rare', isNew: true, d: 'M 58 6 L 32 38 L 47 38 L 38 58 L 68 24 L 52 24 Z' },
];

/* Two bars crossed at 45°, corners worked out rather than rotated, so an X
 * is the same kind of data as every other mark on a face. */
const X = (cx, cy, r, t) => [Math.PI / 4, -Math.PI / 4].map(a => {
  const c = [[-r, -t], [r, -t], [r, t], [-r, t]]
    .map(p => [cx + p[0] * Math.cos(a) - p[1] * Math.sin(a), cy + p[0] * Math.sin(a) + p[1] * Math.cos(a)]);
  return 'M ' + c.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L ') + ' Z';
}).join(' ');
const petals = [0, 1, 2, 3, 4].map(i => {
  const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
  return D(50 + Math.cos(a) * 12, 26 + Math.sin(a) * 12, 8.5);
}).join(' ');

faces.push(
  { id: 'frown', name: 'Frown', rarity: 'common', isNew: true, d: `${D(28, 79, 6)} ${D(72, 79, 6)} M 34 116 Q 50 98 66 116 Q 50 108 34 116 Z` },
  { id: 'bored', name: 'Bored', rarity: 'common', isNew: true, d: `${D(30, 80, 6)} ${D(70, 80, 6)} ${this.artBar(38, 106, 24, 6, 3)}` },
  { id: 'angry', name: 'Angry', rarity: 'uncommon', isNew: true, d: `${D(30, 95, 6.5)} ${D(70, 95, 6.5)} ${P('M 17 65 L 40 75 L 38 82 L 16 73 Z')}` },
  { id: 'tongue', name: 'Tongue out', rarity: 'uncommon', isNew: true, d: `${D(28, 78, 6)} ${D(72, 78, 6)} M 30 100 A 20 20 0 0 0 70 100 Z M 41 112 L 59 112 L 59 127 Q 59 137 50 137 Q 41 137 41 127 Z` },
  { id: 'foureyes', name: 'Four eyes', rarity: 'rare', isNew: true, d: `${D(28, 74, 6)} ${D(72, 74, 6)} ${D(28, 93, 6)} ${D(72, 93, 6)}` },
  { id: 'xeyes', name: 'X eyes', rarity: 'rare', isNew: true, d: `${X(28, 81, 11, 3.4)} ${X(72, 81, 11, 3.4)}` },
);

accs.push(
  { id: 'party', name: 'Party hat', rarity: 'common', isNew: true, d: `M 27 58 L 50 15 L 73 58 Z ${D(50, 11, 8)}` },
  { id: 'daisy', name: 'Daisy', rarity: 'uncommon', isNew: true, d: `M 46 58 L 46 34 Q 50 30 54 34 L 54 58 Z ${petals} ${D(50, 26, 8)}` },
  { id: 'starant', name: 'Star antenna', rarity: 'uncommon', isNew: true, d: `M 45 58 C 44 44 45 34 48 27 L 55 29 C 52 38 52 46 53 58 Z ${star(51, 18, 12)}` },
  { id: 'tophat', name: 'Top hat', rarity: 'rare', isNew: true, d: `${this.artBar(11, 44, 78, 11, 5)} ${this.artBar(27, 6, 46, 42, 5)}` },
  { id: 'antlers', name: 'Antlers', rarity: 'rare', isNew: true, d: `${P('M 34 58 C 30 44 26 30 22 18 L 30 15 C 35 28 39 44 41 58 Z')} ${P('M 27 32 L 11 25 L 8 32 L 25 39 Z')} ${P('M 23 19 L 13 6 L 19 2 L 29 15 Z')}` },
);
```

New pieces, for review at a glance:

- **Faces** — Sleepy, Squint, Frown, Bored (common) · Side-eye, Grin, Angry, Tongue out (uncommon) · Third eye, Starstruck, Four eyes, X eyes (rare)
- **Accessories** — Cat ears, Crest, Party hat (common) · Bow, Bobble hat, Daisy, Star antenna (uncommon) · Crown, Bolt, Top hat, Antlers (rare)

## Checking it

The bar every accessory has to clear is the one in 9d: at **18px**, on felt and in a well, each piece has to be a different outline. Nothing is legible as an object at that size and nothing needs to be. Faces are exempt by design — they are the part that only reads up close, and they are never what identifies a player across a crowd.

## Files in this bundle

| File | What it is |
|---|---|
| `Wardrobe Art.dc.html` | The reference and the source of truth for all path data. |
| `support.js` | Runtime needed to open it in a browser. Not a deliverable. |
| `README.md` | This file. |
