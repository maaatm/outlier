# 03 — Blob avatars and accessories

Give each player a blob: a face and an accessory. Build the item catalogue, the wardrobe,
and the two places a blob renders today — next to a community question's author line, and
in the player's own record.

**No economy in this change.** Every item is unlocked. Prompt 04 puts them behind coins.
The point of this ordering is to prove the art reads at every size it needs to before any
of it is locked behind a reward loop.

---

## Context

Read `README.md` (**Visual system**) and then `src/client/components/DotCrowd.tsx`,
`src/client/jitter.ts`, `src/client/styles.css` (the `.dot` block, around line 523), and
`src/server/core/questions.ts`.

### Why accessories and not hats

The crowd sizes its own dots: `cellFor` picks the largest cell that fits the layout into
the measured box, `DOT_RATIO` is 0.9, and a hundred dots in ten or eleven rows on a phone
lands each dot somewhere around 14–22px. The existing faces work at that size precisely
because they are two absolutely-positioned dark spans and nothing more — interior detail
at 18px is a smudge.

A hat covers the top of the circle with interior detail. An accessory **breaks the
circle's silhouette**: a unicorn horn, bunny ears, antennae, a halo all change the dot's
outline, and outline survives at sizes where detail does not. That is the design rule for
this catalogue, and it should be stated in the catalogue file's header so the tenth item
added a year from now still follows it.

Practical consequence: an accessory draws **outside** the dot's bounding circle. Neither
`.dot` nor `.dot-slot` sets `overflow`, so nothing clips at that level — but
`.slide, .menu__body` (styles.css ~line 643) sets `overflow-y: auto`, and a scroll
container clips on both axes. The comment there documents this exact bug being hit once
already: buttons that lift on hover lost an edge against that boundary, and the fix was
padding plus an equal negative margin to give the overflowing paint somewhere to live.

Expect to hit it again with a horn on a top-row dot. Prefer extending the SVG viewBox
above the circle — so the accessory is inside the element's own box and nothing overflows
in the first place — over adding a second padding hack. Note that this makes the SVG
taller than the dot is wide, which the sizing has to account for.

---

## What to build

### 1. The catalogue — `src/shared/items.ts`

Follows the pattern of `badges.ts` and `points.ts`: data and its copy in one place, imported
by both sides, so the client can render an item and the server can validate an equip
against the same list.

```ts
export type ItemKind = 'face' | 'accessory';
export type Rarity = 'common' | 'uncommon' | 'rare';

export type Item = {
  id: string;             // stable, short, appears in storage — keep it boring
  kind: ItemKind;
  name: string;           // what the wardrobe calls it
  rarity: Rarity;
  /** Inline SVG path data. No files, no CDN — see the no-external-requests rule. */
  path: string;
  /** True for the pair everyone starts with. Never rolled from a box. */
  starter?: boolean;
};
```

Ship roughly 8 faces and 8 accessories. Faces are variations on the existing two-eye
treatment — closed eyes, wide eyes, a single cyclops eye, eyes with a mouth. Accessories
are silhouette-breaking: unicorn horn, bunny ears, antennae, halo, a single leaf, devil
horns, a cowlick, a propeller.

Every path is authored against **one shared viewBox** with the dot's circle at a known
position, or nothing will line up when the dot resizes. Define that viewBox as a constant
in the same file and state its geometry in the header comment.

Exactly one face and one accessory are `starter: true`, owned by everyone implicitly and
never in the box pool. The starter face should be the existing two-eye dot, so the crowd
today is already the default blob rather than something the feature replaces.

### 2. The `Blob` component — `src/client/components/Blob.tsx`

One component, every size, no variants:

```tsx
<Blob face={faceId} accessory={accessoryId} size={24} />
```

Renders an SVG at the given pixel size. Must look right at 18px (crowd cameo, prompt 05),
24px (inline author line), and 40px (wardrobe, record). Test it at all three now, not
after prompt 05 discovers it does not scale.

Unknown or missing ids fall back to the starter pair rather than rendering nothing. Item
ids live in storage and a catalogue entry can be removed; a blank blob where a face should
be is a worse failure than a default one.

Keep the 2px ink outline and the flat fill. No gradients. The blob is the same drawing
language as the dots because it *is* a dot with more shape.

### 3. Storage

```
avatars        hash  userId -> "faceId:accessoryId"     packed, one read for many blobs
inv:{userId}   hash  itemId -> "1"                      what they own
```

The packed single-hash form is deliberate and is the reason prompt 05 is affordable: ten
cameo blobs become one `hMGet`, not ten round trips, on a screen already doing three reads
to build the reveal. Encode and decode with a small pure pair next to the catalogue —
same shape as `encodeVote`/`decodeVote` in `votes.ts`, including tolerating a malformed
value by falling back rather than throwing.

In this change `inv:` is written but not enforced, since everything is unlocked. Write it
anyway: prompt 04 needs a populated inventory to have something to add to, and
back-filling one later is worse than writing one now.

### 4. Endpoints

```
GET  /api/avatar            → { face, accessory, owned: string[] }
POST /api/avatar            { face, accessory } → 200 | 400
```

The POST **must validate server-side** that both ids exist in the catalogue and are of the
right kind, and — from prompt 04 onward — that the player owns them. Build the ownership
check now behind a helper that currently returns true for everything, so 04 changes one
function instead of finding every call site. An inventory the client can bypass is
decoration.

Signed-out users get the starter pair and no ability to save.

### 5. Render surfaces

**The author line.** `App.tsx` already renders `asked by u/{authorName}` for community
questions, and `q:{id}` already stores `authorId`. Put a 24px blob in front of that line.
This is the highest-value pixel in the whole avatar feature — it is what makes another
player want one — and it costs one avatar lookup on a value already in hand.

Return the author's equipped pair on the question state rather than making the client
fetch it separately. It is one extra field on a response the client already waits for,
and it carries no vote information. Add it to `QuestionState`, not to `Question` — the
public question projection is deliberately narrow and this is presentation, not content.

**Your record.** A 40px blob at the top of the room, above the figures, with a
**Change** button opening the wardrobe.

**The wardrobe.** A fourth menu room, or a sub-view of Your record — prefer the sub-view,
since the menu is deliberately shallow ("two levels and no more") and a wardrobe reached
from the blob it changes is more obvious than one reached from a list. Two grids, faces
and accessories, current selection marked. Tapping equips immediately; there is no save
button and no confirm — this is a two-tap game and the wardrobe should not be the
heaviest screen in it.

---

## Do not

- **Do not add a colour meaning for rarity.** The visual system allows two accents per
  screen with one meaning each, and a five-colour rarity ladder would blow that up on the
  wardrobe alone. Rarity is carried by a word and by outline weight.
- **Do not add a fourth deliberate imperfection.** Blobs do not get their own wobble. The
  crowd jitter already applies to them when they render as dots.
- **Do not touch `DotCrowd.tsx`.** Cameos are prompt 05. This change must not alter the
  reveal.
- **Do not use Reddit snoovatars.** `reddit.getSnoovatarUrl()` exists, and it would be an
  external image request in an app that bundles its own fonts to avoid exactly that.

---

## Acceptance

- `Blob` renders correctly at 18px, 24px and 40px. Screenshot all three.
- An accessory that extends above the circle is not clipped at any of those sizes.
- Equipping persists across a reload and across posts.
- `POST /api/avatar` rejects an id that is not in the catalogue, and rejects a face id
  submitted in the accessory slot.
- A community question shows its author's blob; a house question shows no author line at
  all, as today.
- A user with no `avatars` entry renders the starter pair everywhere.
- `npm run verify` passes.

## Out of scope

Coins, boxes, ownership enforcement (04); cameos in the crowd (05). Leaderboard rows do
not get blobs in this change — revisit once 04 makes avatars varied enough to be worth the
row height.
