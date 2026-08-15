# Proposed features

> **Partly superseded.** Decisions have since been made that overrule parts of this
> document — replay mode stays on, How to play is cut rather than folded, hats become
> silhouette-breaking accessories, cameos default to visible, submission is uncapped, and
> the coin rates are fixed. See [`prompts/README.md`](prompts/README.md) for the amended
> list and [`prompts/`](prompts/) for the implementation prompts that carry it.
>
> This file stays as the reasoning behind those calls. Where the two disagree, the prompts
> win.

Four ideas, worked through: a player leaderboard, custom blob avatars with a gift-box
economy, a Daily button in the menu, and a reshuffle of the menu itself.

They are not four independent features. The leaderboard and the avatars both depend on a
player identity the app does not currently store, both add writes to the vote path, and
both are meaningless while `REPLAY_MODE` is on. The menu changes are the cheap part and
should ship first regardless.

Each section says what the idea is, what breaks if it is built the obvious way, and what
to build instead.

---

## Before any of this

**`REPLAY_MODE` has to go off.** It is `true` in `src/shared/config.ts` today, and with it
on the same account banks points on every replay of the same question. A points
leaderboard built on top of that ranks whoever left a post open the longest. A currency
earned from points does the same. This is already flagged in the README as a
release blocker; it is now also a correctness blocker for two of these four features.

**The app has no player names.** `user:{userId}` stores counters and nothing else.
`authorName` exists only on community question records. Both the leaderboard and the
blobs need to render a name, so a name has to start being stored — see
[Storing the player](#storing-the-player) below, which both features share.

**Redis is scoped per installation.** "Global" therefore means "everyone on this
subreddit", not everyone playing Outlier anywhere. That is almost certainly the right
scope anyway — a subreddit-wide board is winnable and a cross-subreddit one is not — but
the copy should say "this subreddit" rather than "global" so it does not promise
something the storage model cannot deliver.

---

## 1. The player leaderboard

### The problem with ranking on lifetime points

Points are banked per vote, not per day, and **nothing closes on a schedule** — every old
Daily and every open question stays playable forever. So the fastest way up an all-time
points board is not to read the room well; it is to sit down and grind the archive. A
player who answers 130 house questions in an evening at `POINTS_BASE` alone banks 1,300
points and beats a player who has shown up every day for four months and guessed well.

That inverts what the game says it is about. The README's habit metric is the streak and
its skill metric is the read rate; lifetime points are mostly a volume metric wearing
both their clothes.

Three ways out, and they are not exclusive:

**Seasons.** A weekly board that resets is the primary board; all-time is a secondary tab.
Resetting solves the grind on its own — the archive is finite, so it can be farmed once
per player, not once per week — and it also solves the deeper problem that a board with
four months of accumulated lead is not worth looking at for anyone who joined in month
three. Recommended as the default view.

**More than one board.** Points, current streak, and read rate answer three different
questions and the game already computes all three. A read-rate board is the only one of
the three that is actually a skill board, and it costs one more zset. Gate it behind a
minimum sample (`LEADERBOARD_MIN_VOTES` is 25 and would do) or it fills up with people
who went 1-for-1.

**Pay less for volume.** Not recommended. Tuning `POINTS_BASE` down to discourage archive
play punishes the archive, which is a genuinely good part of the game.

### Shape

Three tabs, one board each, weekly by default:

| Board | Score | Reads |
|---|---|---|
| Points | points banked this week | the habit and the accuracy together |
| Streak | current streak | pure habit |
| Read rate | `totalHits / totalPlayed`, min 25 votes | pure skill |

Ten rows, plus a pinned row for the viewer showing their own rank even when they are
nowhere near the top — a board you are absent from is a board you stop opening.

### Naming collision

`GET /api/leaderboard`, `LeaderboardResponse`, `LeaderboardEntry` and
`src/client/components/Leaderboard.tsx` are all already taken by the most-misjudged-
questions board. Rename before adding, or the codebase ends up with two things called
the leaderboard that have nothing to do with each other:

```
GET /api/leaderboard/questions   the existing misjudged board
GET /api/leaderboard/players     the new one
```

with `Leaderboard.tsx` → `MisjudgedBoard.tsx` and `PlayerBoard.tsx` alongside it. The
menu room "Hardest to read" keeps its name; only the code moves.

> **Since superseded.** The misjudged board came off both in-app surfaces to free the menu
> slot for **Ask a question** — the room, the reveal's tab, `MisjudgedBoard.tsx` and
> `GET /api/leaderboard/questions` are all gone. The ranking itself survives:
> `stats:misjudged` is still maintained on every vote and `misjudgedLeaderboard()` still
> reads it, for the moderator-posted event post, which is now its only reader and the one
> that reaches people who are not already in the app.

### Keys

```
lb:points:{YYYY-Www}   zset  userId -> weekly points     TTL ~9 days
lb:points:all          zset  userId -> lifetime points
lb:streak              zset  userId -> current streak
lb:rate                zset  userId -> hit rate * 10000  (only past the min sample)
users:names            hash  userId -> username
```

The weekly key gets an `expire` on first write, so old weeks clean themselves up without
a sweep job. `shared/day.ts` needs a `toWeekKey()` next to `toDayKey()` — ISO week, UTC,
same rule as everything else.

All four boards are written from one place: `recordPlay` in `src/server/core/users.ts`
already computes the next record, so the zset writes go there and nowhere else.

### Ties

Points land on multiples of 5, so exact ties are common and Redis orders tied members
lexically by userId — which would silently rank by account ID. Encode the tiebreak into
the score instead. Points are integers, so any fraction below 1 preserves their order:

```ts
// Of two players on the same total, the one who has been sitting on it longer
// ranks higher. Monotone, pure, and stable across restarts.
const TIE_HORIZON = 4096; // days; ~11 years of runway
score = points + (TIE_HORIZON - daysSince(LAUNCH_DAY, today)) / TIE_HORIZON;
```

Display the truncated integer. `zRank` then gives an unambiguous rank with no second
lookup, which matters because Devvit's Redis has no `zCount` to count players above a
score with.

### Reads

```ts
const rows = await redis.zRange(keys.leaderboard(week), 0, 9, { reverse: true, by: 'rank' });
const names = await redis.hMGet(keys.names, rows.map(r => r.member));
const rank = await redis.zRank(keys.leaderboard(week), userId); // reverse rank: zCard - rank - 1
```

Two round trips for the page plus one for the viewer's rank. Cheap enough to serve on
every menu open without a cache.

### What it does not leak

Nothing. Points, streaks and rates are per-player aggregates across every question ever
answered; none of them narrows down how any individual answered any individual question,
and none of them carries a `Tally`. The invariant in `votes.ts` is untouched. This is
worth stating explicitly in the route's header comment, in the same voice as the existing
ones, because it is the first new read path added since the invariant was written.

### Alt accounts

The README puts vote inflation out of scope, which is defensible when the only prize is
your own badge. A public ranked board changes the incentive: now there is something to
win. Devvit's stable `userId` stops one account voting twice; it does nothing about ten
accounts voting once. Realistic mitigations, in order of cost:

- Weekly reset caps how far a farm can get before it is wiped.
- Require a small account age or subreddit karma floor to appear on the board. Players
  below it still play, still bank points, still see their own record — they just do not
  render publicly.
- Mod tooling to remove a user from the boards: one `zRem` per board, exposed as a menu
  action next to the existing queue review.

The third is worth building alongside the board rather than after the first incident.

---

## 2. The Daily button

The smallest of the four and the highest value per line of code, especially on the pinned
menu post — that post exists to be the subreddit's front door, and right now the front
door explains the game and then leaves you to go find a question yourself.

### Navigation

`navigateTo` is exported from `@devvit/web/client` and takes either a URL or
`{ url, permalink }`. So the client needs today's Daily post permalink:

```
GET /api/daily
→ { day, postId, permalink, state: 'playable' | 'voted' | 'here' | 'none' }
```

Resolved server-side from `daily:{today}` → `q:{id}.postId`. The day comes from
`toDayKey()` on the server, never from the client's clock — same rule as `isToday` in
`toPublicQuestion`.

**Cache the permalink.** `linkQuestionToPost` currently stores only `postId`. Add
`permalink` to the same write — `submitCustomPost` returns it, so it costs nothing at
write time and saves a `reddit.getPostById` call on every menu open.

### The four states

The button's label is the interesting part, because the honest answer differs:

| State | When | Label |
|---|---|---|
| `playable` | Daily exists, not voted | **Today's question** — the primary action |
| `voted` | already answered today | "You've played today's" → still navigates, lands on the reveal |
| `here` | this post *is* today's Daily | render as a disabled line, or omit |
| `none` | no Daily yet today | "Tomorrow's question posts at midnight UTC" |

`none` is reachable in practice: `post-daily` runs at `0 0 * * *`, and an install
mid-day only gets a Daily because `onAppInstall` posts one. A subreddit that installs
at 00:30 UTC has no Daily until the next midnight.

The `voted` state is worth keeping navigable rather than greying out. The reveal is
re-openable by design and going back to look at the crowd again is a real thing players
do.

### Placement

This is an **action**, not a room — it leaves the app. Every other menu entry opens a
panel in place. It should not sit in the same list wearing the same button; give it
`button--primary` above the rule, with the rooms below it. That also stops the menu list
from being a mix of "this navigates away" and "this doesn't" with no way to tell which.

---

## 3. The menu, restructured

The proposal is to drop **How to play** and **The four outcomes** to make room for the
Daily and the leaderboard. Half of that is right; dropping How to play is not.

The README is explicit about what the pinned menu post is for: *"somebody arriving cold
gets the rules and the four outcomes without having to find a question first."* Deleting
How to play from the menu deletes the only explanation of the game that exists anywhere
in the app, and it deletes it specifically from the screen built to be somebody's first
contact with it. The pinned post would become a leaderboard for a game whose rules are
not written down.

**Fold instead of cut.** The four outcomes is not a peer of How to play — it is the
second half of it. How to play already explains rarity, accuracy and the points bands;
the 2x2 is what those two axes produce when crossed. Putting the outcomes grid at the
bottom of How to play loses nothing, and frees the slot honestly.

```
Today's question          →  navigates out            [primary]
─────────────────────────────
How to play                  the three steps, the two axes, the four outcomes
Your record                  streak, best, points, read rate
Leaderboard                  this subreddit's top ten            [new]
Hardest to read              what the subreddit misjudged most
```

Still four rooms plus one action, so the "four rooms, one open at a time" structure
survives and `Menu.tsx`'s `PanelId` union barely changes: drop `'outcomes'`, add
`'board'`.

One consequence worth noticing: **Your record** and **Leaderboard** are now adjacent and
partly redundant — both answer "how am I doing". If the leaderboard's pinned viewer row
carries streak and points, Your record becomes a longer-form version of one line. That is
fine, but it is an argument for the leaderboard row being terse (rank, name, one number)
and Your record keeping the prose.

The How to play panel is getting long enough to scroll on a phone with the outcomes grid
appended. Worth checking against the shortest supported viewport before shipping; the
`fade-in` keying already resets scroll on panel change, so a long panel is a legibility
problem rather than a state problem.

---

## 4. Blob avatars, gift boxes, and cameos

The largest of the four by an order of magnitude — it is four systems, not one: an item
catalogue, a second currency, a randomised reward loop, and three new render surfaces.
Worth splitting into shippable pieces (see [Build order](#build-order)); worth also
deciding early on two things that are easy to get wrong and expensive to undo.

### First: do not spend points

The obvious move is to buy gift boxes with points. Do not. Points are the leaderboard's
score, and a score that can be spent stops being a score — a player who buys three boxes
drops fifty places, and the board silently becomes a ranking of who bought the least.
Every game that has merged its score and its wallet has had to unmerge them.

**Two ledgers.** `points` stays exactly what it is: cumulative, never decremented,
never spent. Add a separate spendable balance — call it something concrete rather than
"currency"; the visual system is a sticker book, so **stickers** or **coins** both fit
and neither reads as a score.

```
user:{userId}.points   lifetime score      never decreases
user:{userId}.coins    spendable balance   goes up and down
```

### Second: hats do not fit on the dots

The crowd sizes its own dots — `cellFor` picks the largest cell that fits the layout into
the measured box, and `DOT_RATIO` is 0.9. On a phone, a hundred dots in eleven rows means
a dot somewhere around 14–22px. The existing faces are two absolutely-positioned spans
and they work at that size because two dark pixels on a light circle is all they are. A
hat is a silhouette with a brim, a crown and an outline, and at 18px it is a smudge.

So the cameo idea and the customisation idea are pulling in opposite directions: the
customisation is only worth doing if the result is legible, and the crowd is where it is
least legible. Three ways to resolve it, in order of preference:

**A separate row.** The ten cameo blobs are not among the hundred dots; they sit in a
band under the crowd — "also played: [blob] [blob] [blob] …" — at 32–40px each, where a
hat reads. Cheapest to build, cleanest to read, and it sidesteps the privacy problem in
the next section entirely because a row is not a side. The cost is that it breaks "each
dot is a person, one of them is you" by adding a second population to the screen.

**Oversized dots in the crowd.** Cameo blobs render at ~2× the cell, pulled to the front
of their camp with the rest of the pack flowing around them. Keeps one population, and
the size difference reads as "these are the ones we know". Costs a real change to
`campLayout`, which currently assumes every dot occupies exactly one cell — the row
packing, the box extent and the centering all derive from that.

**Tap to enlarge.** A cameo dot stays dot-sized and blooms into a named blob on tap.
Preserves the crowd exactly, but hides the feature behind an interaction nobody knows is
there, on the one screen the README reserves for a single orchestrated moment. Not
recommended.

Whichever wins, the item art should be inline SVG path data in a TypeScript catalogue,
not files — the app currently makes no external requests and bundles even its fonts, and
the crowd's whole aesthetic is flat shapes with 2px ink outlines, which is exactly what
path data is good at.

### Third: a cameo publishes how somebody voted

This is the one that needs a decision from you rather than a recommendation from me.

If u/alice's blob appears in the left camp on the reveal, the screen has just told
everyone who plays that question that alice answered "yes". Right now, how you answered
is yours: the only way it becomes public is if *you* tap the share button and post the
comment. A cameo placed by side takes that choice away, for a question the player may
have answered before the feature existed.

The options:

1. **Place cameos honestly, opt in.** A "show my blob to other players" toggle, default
   off, in Your record. Honest placement, no surprise disclosure. The cost is that a
   feature bought with earned currency is invisible until you find a settings toggle,
   which is a bad first run — mitigate by asking once, in place, the first time a player
   equips anything.
2. **Place cameos neutrally.** Blobs appear in the "also played" row (option A above),
   which says who played and not what they said. No consent needed, because nothing is
   disclosed. This is the strongest argument for the separate row.
3. **Place cameos by side, no opt-in.** Fastest to build and the most visually satisfying
   — real faces on both sides of a real split. But it retroactively republishes past
   answers, and on a question about ordinary behaviour that is occasionally going to be
   something somebody would rather not have attached to their username. The question pool
   is filtered for political, medical and identity topics precisely because those are
   sensitive; "do you wash your hands every time" is filtered by nothing and is still not
   nothing.

Recommendation: **2 for the crowd, 1 if you later want blobs on the sides.** The author
blob on custom questions is unaffected either way — see below.

### The avatar model

```
avatars              hash  userId -> "face:hat"        packed, one read for ten cameos
inv:{userId}         hash  itemId -> "1"               what they own
user:{userId}.coins  field on the existing user hash
```

Packing the equipped pair into a single shared hash rather than a per-user key is the
whole trick: ten cameos is one `hMGet`, not ten round trips, on a screen that is already
doing three reads to build the reveal.

Items are `{ id, kind: 'face' | 'hat', name, rarity, path }`, defined in
`src/shared/items.ts` so the client can render them and the server can validate an equip
request against the same list. Server-side validation matters: the equip endpoint must
reject an item the player does not own, or the inventory is decorative.

Everyone starts with the plain blob and the existing dot face, owned by default and not
in the box pool. Nobody's first screen should be empty.

### Earning coins

The two sources proposed are the daily streak and posting questions. Both work; the
second needs a guard.

**Streak.** Pay on the first vote of a day, with milestone bumps — the point of a streak
currency is that missing a day costs something visible. `advance()` in `users.ts` already
knows whether the day just turned over (`record.lastPlayedDay === today` is the exact
test), so the hook is one branch in a pure function that is already unit-tested.

| Event | Coins |
|---|---|
| First vote of the day | 5 |
| Every 7th consecutive day | +25 |
| Reaching a new best streak | +10 |

**Questions — pay on merit, not on submission.** Submitting is capped at one per 24h by
`sub:cooldown:{userId}`, so paying per submission is a standing offer of free currency
for one sentence a day. The content filter catches slurs and off-limits topics; it does
not catch boring, and a subreddit whose question queue fills with paid-for filler is a
worse game than one with no economy.

Pay further down the funnel instead:

| Event | Coins | Why here |
|---|---|---|
| Question approved by a mod | 25 | a human confirmed it is a real question |
| Question promoted to the Daily | 100 | it cleared `PROMOTION_THRESHOLD` upvotes |
| Question reaches 25 votes | 25 | people actually played it |

Approval and promotion are both already discrete events in the code — `queue.ts` and
`resolveDailyQuestion` — so each is one payment call at a point that already exists.

### Gift boxes

Standard box mechanics, with the three guards that stop them being annoying:

- **Duplicates convert.** A repeat item pays coins back at a fraction of the box price.
  Without this, a player with 80% of the catalogue opens boxes for nothing and stops.
- **Pity.** Guarantee a rare within N boxes. Track `since:{userId}` as a counter; reset on
  a rare. Cheap, and it converts the worst-case experience from "I opened twelve and got
  nothing" into a bounded promise.
- **Server rolls, client animates.** The roll is a `POST /api/box/open` that debits,
  rolls, writes to `inv:` and returns the item. A client-side roll is a client-side
  inventory. The debit and the grant need to be one atomic step or a failure mid-way
  either eats the coins or gives a free item — Devvit's Redis has `watch`, which is what
  it is for.

Rarity tiers should map to the existing colour discipline rather than inventing a new
palette. The visual system allows two accents per screen and assigns each accent exactly
one meaning; a five-colour rarity ladder would blow that up on the box-opening screen
alone. Rarity can be carried by the item's own outline weight and a word, and the screen
can keep its two accents.

**On money.** Everything above is earned-only, which keeps this a progression loop.
Devvit does ship a payments module, and the moment a randomised box can be bought with
real money it stops being a game mechanic and starts being a regulated one — several
jurisdictions treat paid loot boxes as gambling, with disclosure requirements attached.
Not a reason to avoid payments entirely; a strong reason to keep the random box on the
earned side of the line and sell known items directly if anything is ever sold.

### The author blob

The simplest and best-value piece of the whole avatar feature: a community question
already renders `asked by u/{authorName}` in `App.tsx`, and `q:{id}` already stores
`authorId`. So the blob is one avatar lookup keyed on a value already in hand, rendered
next to a line that already exists.

No privacy question — the author's name is already on the post, and authorship is a
deliberately public act. No layout question — it is one 24px blob inline with existing
text, at a size where a hat reads fine. This is the piece that makes people want an
avatar in the first place, and it can ship before boxes, before cameos, and before any
currency at all, with faces alone.

### New surfaces, summarised

| Surface | Size | Difficulty | Notes |
|---|---|---|---|
| Author blob on community questions | 24px inline | trivial | ship first |
| Your blob in Your record / the header | 32–40px | easy | needs the equip screen |
| Wardrobe + inventory | full panel | medium | new menu room, or a tab in Your record |
| Box opening | full screen | medium | one moment, no confetti — see the motion rules |
| Crowd cameos | 14–40px ×10 | hard | the legibility and privacy decisions above |

---

## Cross-cutting

### The vote path is the hot path

`castVote` → `tallyVote` → `finishVote` currently issues eleven Redis operations, several
already parallelised, and the whole `POST /api/vote` request runs about sixteen once
`recordPlay` and `buildReveal` are counted. These features want to add: four leaderboard
zsets, a recent-voters zset with a trim, and a coin credit. That is six more, and they
are all writes, on the one request in the app the player is actually waiting on.

Mitigations, in order:

- Batch. `recordPlay` already reads and writes the user hash; the coin credit is another
  field on the same `hSet`, not a new key.
- Push what is not needed synchronously off the request. The leaderboard zsets do not
  need to be current before the reveal renders — nothing on the reveal reads them.
- Cap the boards. `lb:*` grows one member per player forever; `zRemRangeByRank` trimming
  the weekly boards to the top few thousand keeps them bounded, and nobody outside the
  top few thousand is reading their own weekly rank anyway.

### Storing the player

Both features need a username. `reddit.getCurrentUsername()` exists but is a Reddit API
call, so it should not be on every vote:

```ts
// In recordPlay, once per player, forever.
if (!(await redis.hGet(keys.names, userId))) {
  const name = await reddit.getCurrentUsername();
  if (name) await redis.hSet(keys.names, { [userId]: name });
}
```

One extra `hGet` on the vote path and one API call in a player's entire lifetime. Names
do change on Reddit rarely; a stale name on a leaderboard is a cosmetic bug, and
refreshing it when the player next votes on a board they appear in is enough.

Deleted and suspended accounts will accumulate on the boards. `getUserById` returning
undefined is the signal; checking it lazily when a row is rendered, and `zRem`-ing on a
miss, keeps the boards clean without a sweep job.

### Testing

The existing suite covers the pure things — scoring, points, pool, validation, streaks —
and that is the right seam for most of this:

- Tie-break encoding: monotone in points, and never lets a fraction cross an integer.
- `advance()` with coin payouts: the day-boundary cases are already covered, so the coin
  assertions attach to tests that exist.
- Box rolls: seed the RNG and assert the pity counter guarantees a rare within N.
- Weekly key: `toWeekKey` across a year boundary, in UTC, same treatment `toDayKey` got.

The Redis-facing parts are not currently unit tested and this does not change that.

---

## Build order

Five shipping steps. Each one is independently useful, which matters because the avatar
work is large enough that it should not be a single unmergeable branch.

**0 — Turn off `REPLAY_MODE`.** Blocks 2 and 4.

**1 — Menu restructure and the Daily button.** No new storage beyond a cached permalink.
Fold the outcomes into How to play, add the primary action, leave a labelled gap where
Leaderboard will go. Immediately makes the pinned post do its job.

**2 — The player leaderboard.** Rename the existing one first. Weekly board, ten rows,
the viewer's row pinned. Store names here, since the avatar work needs them next.

**3 — Blobs, faces only, no economy.** Item catalogue, a wardrobe with everything
unlocked, the author blob on community questions, your blob in Your record. Proves the
art direction at every size it needs to work at before any of it is behind a paywall of
earned currency.

**4 — Coins, boxes, hats.** The whole economy at once, because a currency with nothing to
buy and a shop with no currency are each useless alone.

**5 — Crowd cameos.** Last, deliberately. It is the piece with the unresolved design
question, the hardest layout change, and the only one that touches the reveal — which is
the one screen the README says is worth spending effort on, and therefore the one screen
worth being slowest about.
