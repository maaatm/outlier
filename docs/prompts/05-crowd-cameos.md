# 05 — Crowd cameos

Put up to ten real players' blobs into the dot crowd on the reveal, on the side they
actually answered.

Last on purpose. It is the only change that touches the reveal — the one screen the README
reserves for a single orchestrated moment and calls the one place worth spending effort —
and it is the only one that changes what the game discloses about a player.

---

## Context

Read `README.md` (**Visual system**, **The two axes**) and then all of
`src/client/components/DotCrowd.tsx` — including the header comment, which is the design
brief for this component and should survive the change. Then `src/server/core/votes.ts`
and `src/shared/items.ts`.

---

## Read this before writing code

A cameo publishes how somebody voted.

Today, how you answered is yours. The only way it becomes public is if *you* tap the share
button on the third reveal slide and post the comment. Putting u/alice's blob in the left
camp tells everyone who plays that question that alice answered "yes" — including for
questions she answered before this feature existed.

The decision has been made: **the toggle ships defaulted on.** Build it that way. But the
default being on is exactly why the following are not optional:

1. **A first-run notice, in place.** The first time a player's blob is eligible to appear,
   tell them, on the screen where it is happening, with the toggle reachable from there.
   Not a settings page they have to find afterwards. Nobody's first encounter with this
   should be discovering it already happened.
2. **The toggle turns off retroactively and immediately.** Switching it off removes them
   from crowds they are already in, including questions they voted on months ago. It is a
   render-time filter on a stored preference, not a flag captured at vote time — write it
   that way and this is free.
3. **Signed-out and never-voted players are never eligible.** Obvious, but the eligibility
   check should make it structural rather than incidental.

Nothing here weakens the tally invariant — cameos appear only on the reveal, which is
already gated on `voted:{questionId}` — but it does widen what the reveal *says*, and that
is worth being deliberate about.

---

## What to build

### 1. Capture recent voters

```
recent:{questionId}   zset  userId -> vote timestamp
```

Written in `castVote` in `src/server/core/votes.ts`, alongside the existing
`zAdd(keys.guesses(...))` — same shape, same place, so the vote path gains one parallel
write and not one more round trip.

Trim on write to keep it bounded:

```ts
await redis.zRemRangeByRank(keys.recent(questionId), 0, -(RECENT_CAP + 1));
```

Cap it at a small multiple of the cameo count — 30 or so — so that after eligibility
filtering there are still ten to choose from. A question with ten thousand voters must not
grow a ten-thousand-member zset for a feature that shows ten.

**Note the honesty problem this creates and pick a side in a comment:** the most recent
ten voters are not a random sample of the crowd, and if the last ten people all answered
"yes" the cameos will all sit on one side of a 50/50 split. Either sample across the
window rather than taking the newest ten, or accept it and make sure the copy never
implies the cameos are representative. Prefer the first — a seeded sample over the
window costs nothing and avoids the crowd telling a small lie about itself.

### 2. Which side each cameo sits on

The reveal already knows the tally. Each cameo needs its own choice, which means reading
`voted:{questionId}` for those ten users — `hMGet` with the ten ids, one round trip,
decoding with the existing `decodeVote`.

This is the point where the reveal starts carrying other people's answers. It carries them
only for players who are eligible (opted in, and it is on by default), and only to a viewer
who has already voted and therefore already has the tally. Say that in the header comment
in `votes.ts`, next to the existing invariant note.

### 3. The blobs

```ts
const packed = await redis.hMGet(keys.avatars, cameoIds);
```

One read for all ten, which is the whole reason prompt 03 packed the equipped pair into a
single shared hash. Names come from `users:names`, added in prompt 02 — a second `hMGet`.

So the reveal gains three reads: recent voters, their votes, their avatars, plus names.
`buildReveal` already does three in parallel via `Promise.all`; add these to it rather
than serialising after it.

### 4. Rendering — the hard part

`campLayout` currently assumes **every dot occupies exactly one cell**. The row packing,
the box extent via `extent()`, and the centering via `originX`/`originY` all derive from
that assumption, and `cellFor` picks the cell size by fitting the whole layout into the
measured box. A cameo at 2× the cell breaks all four.

Two approaches. Try the first; fall back to the second if the layout fights back.

**Oversized dots in the crowd.** Cameo blobs render at ~2× the cell and are pulled to the
front of their camp, with the rest of the pack flowing around them. Keeps one population
on screen and the size difference reads as "these are the ones we know". Requires
`campLayout` to understand that some dots are wider than one cell — treat a cameo as a 2×2
block in the packing and let `extent()` account for it.

**A separate band.** Cameos are not among the hundred dots at all; they sit in a row under
the crowd at 32–40px — "also played: [blob] [blob] …". Far cheaper, more legible, and it
sidesteps the side-placement question entirely because a row is not a side. The cost is
that it puts a second population on the screen and dilutes "each dot is a person, one of
them is you".

Whichever lands, the constraints from the existing component hold:

- **Your dot still lands last**, ~150ms behind the pack, and still sits proud. A cameo
  must never out-rank the viewer's own dot for attention — the reveal is a verdict on
  *their* vote.
- **The travel animation is unchanged.** 600ms, 6ms stagger, light spring overshoot.
  Cameos travel with the pack, not on their own clock.
- `prefers-reduced-motion` still cross-fades to the same final state.
- The crowd still measures its own box and centers in it. Do not fix the cell size to make
  the cameos work.
- No fourth deliberate imperfection. Cameos jitter with everyone else and get nothing
  extra.

### 5. Naming them

A blob with no name is decoration. A blob with a name permanently under it is a wall of
text on the game's most carefully composed screen.

Tap or hover to name, with the name in the existing `crowd__caption` slot or a small
label near the blob. Hover must sit behind `(hover: hover) and (pointer: fine)` — the
codebase already does this for button lift, for the reason that a tap on a phone otherwise
leaves things stuck in the hovered state.

The accessible label on `crowd__field` currently describes the split. Extend it to mention
that some of the crowd are named players; do not enumerate ten usernames into a label
that is read aloud in one breath.

---

## Storage

```
user:{userId}.showBlob   "1" | "0"   default "1" when absent
```

A field on the existing user hash, not a new key. Absent means on — so no backfill is
needed, and the default lives in one `?? '1'` rather than in a migration.

```
GET  /api/avatar   → gains `showBlob`
POST /api/avatar   → accepts `showBlob`
```

Reuse the endpoints from prompt 03 rather than adding a settings endpoint for one boolean.

The toggle renders in **Your record**, next to the blob, with one line of plain copy
saying what it does. Not buried in the wardrobe — the wardrobe is about what your blob
looks like, this is about who sees it.

---

## Acceptance

- Up to ten cameos render, each on the side its player actually chose. Verify against
  `voted:{questionId}` directly for at least three of them.
- A player with `showBlob` off appears in no crowd, including questions they voted on
  before switching it off.
- The first-run notice fires once, in place, and the toggle is reachable from it.
- A question with fewer than ten voters renders cleanly. So does one with zero other
  voters — a fresh open question is the common case, not the edge case.
- `recent:{questionId}` stays bounded at the cap after many votes.
- The viewer's own dot still lands last and still reads as the focal point. Screenshot the
  reveal with ten cameos and confirm the eye still goes to your own dot first.
- Reduced-motion path reaches the same final arrangement.
- The reveal's added reads are parallel, not serial. Check the actual call graph in
  `buildReveal`.
- `npm run verify` passes.

## Out of scope

Cameos anywhere other than the reveal — not on the question screen, not on the guess
screen, not in the pre-vote scatter. The scatter is undifferentiated on purpose and
putting known faces in it before a vote starts hinting at a split that has not been
earned.
