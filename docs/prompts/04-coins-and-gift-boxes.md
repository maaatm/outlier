# 04 — Coins and gift boxes

Add the spendable currency, the four ways to earn it, and the gift box that turns it into
items. Remove the submission cooldown. Turn on the ownership enforcement that prompt 03
stubbed out.

The largest of the five changes, because a currency with nothing to buy and a shop with no
currency are each useless alone — they have to land together.

---

## Context

Read `src/server/core/users.ts` (all of it — `advance` is the hinge of this change),
`src/server/core/submit.ts`, `src/server/core/queue.ts`, `src/server/core/daily.ts`
(`resolveDailyQuestion`), and `src/shared/items.ts` from prompt 03.

### Coins are not points

`points` is the leaderboard score from prompt 02. It is cumulative, never decremented,
never spent. A score that can be spent stops being a score — a player who buys three boxes
drops fifty places, and the board quietly becomes a ranking of who bought the least.

`coins` is a separate, spendable balance. Two ledgers, one hash:

```
user:{userId}.points   lifetime score       only ever increases
user:{userId}.coins    spendable balance    goes up and down
```

Both live on the existing `user:{userId}` hash, so crediting coins is another field on an
`hSet` that `recordPlay` already issues rather than a new key and a new round trip.

Nothing in this change may read, write, or decrement `points`.

---

## What to build

### 1. Earning

Put the rates in `src/shared/config.ts` with the other tunables:

| Event | Coins | Where it fires |
|---|---|---|
| First vote of the day | +5 | `advance()` in `users.ts` |
| Every 7th consecutive day of streak | +20 | `advance()` in `users.ts` |
| Question posted | +10 | `submitOpenQuestion` in `submit.ts` |
| Question promoted to the Daily | +30 | `resolveDailyQuestion` in `daily.ts` |

**The daily award and the streak bonus both belong in `advance()`**, which is pure and
already unit-tested in `tests/streaks.test.ts`. It already knows whether the day just
turned over — `record.lastPlayedDay === today` is the exact test — so both awards hang off
a branch that exists. Extend its return type with the coins earned rather than mutating
anything; keep it pure.

The 7-day bonus fires when the *new* streak value is a multiple of 7, so it pays on days
7, 14, 21. Get the boundary right: it should pay on the day the streak reaches 7, not the
day after, and a streak that resets to 1 starts counting again from there.

**Promotion pays the author, not the promoter.** `resolveDailyQuestion` returns
`promotedFrom` with an author name; it needs the author *id* to credit. `q:{id}` already
stores `authorId` — read it from the question record rather than resolving the name back
to an id. House questions have an empty `authorId`; pay nobody and do not error.

Promotion happens inside `postDaily`, which is guarded by `daily:claims` and is
idempotent. The coin credit must sit inside that guard, or a retried job pays twice.

### 2. Remove the submission cooldown

Delete it. More questions is the goal for now.

Touch points, all of them:

- `src/shared/config.ts` — `SUBMISSION_COOLDOWN_SECONDS`
- `src/server/core/keys.ts` — `submissionCooldown`
- `src/server/core/submit.ts` — `checkCooldown`, `startCooldown`, the `'cooldown'` variant
  of `SubmitOutcome`, and the check in `submitOpenQuestion`
- `src/server/routes/menu.ts` — the `checkCooldown` import and the toast at line ~27
- `src/server/routes/submit.ts` — the 429 branch

Note while removing it: the cooldown currently starts *before* the post call, with a
comment explaining that a submission failing halfway cannot be retried into a flood. That
protection goes away with it. Nothing else in `submitOpenQuestion` is idempotent, so a
client retrying a timed-out submission now creates two posts and pays twice. Worth a brief
guard — a short-TTL key on a hash of the normalized text, refusing an identical submission
from the same user within a minute — which is duplicate protection rather than a rate
limit and does not reintroduce the cap.

### 3. The unbounded-coins problem

Uncapped submission plus +10 coins per submission is an unbounded coin source, and its
side effect is a real Reddit post each time. So the pressure lands on the subreddit's
front page and the mod queue, not just on the economy. Every filter that exists
(`validateSubmission`, `filterQuestionText`) catches slurs, links, and off-limits topics;
none of them catches *boring*, and boring is what a coin farm produces.

Implement the +10 as specified. Also add, unused by default:

```ts
/**
 * How many submissions in a UTC day still pay coins. Submission itself is
 * uncapped — this caps only the reward, so a flood costs the farmer nothing
 * but earns them nothing either. `Infinity` disables it.
 */
export const COIN_ELIGIBLE_SUBMISSIONS_PER_DAY = Infinity;
```

Wire the check so setting this to a number is a one-line config change and not a code
change. Track the count on the user hash keyed by day (`subDay`, `subCount`), reset when
the day turns over — the same pattern prompt 02 uses for `weekKey`/`weekPoints`.

### 4. Gift boxes

```
POST /api/box/open  →  { item, duplicate: boolean, refunded: number, coins: number }
```

Server rolls, client animates. A client-side roll is a client-side inventory.

Four rules:

- **Debit and grant atomically.** Devvit's Redis has `watch`, returning a transaction
  client — that is what it is for. A failure between debit and grant either eats the
  coins or hands out a free item, and both will happen at some volume.
- **Duplicates convert.** A repeat pays back a fraction of the box price in coins.
  Without this, a player holding 80% of the catalogue opens boxes for nothing and stops.
  Put the fraction in config.
- **Pity.** Guarantee a `rare` within N boxes. Counter on the user hash, reset on a rare.
  Cheap, and it turns the worst case from "I opened twelve and got nothing" into a bounded
  promise.
- **Starter items are never rolled.** They are `starter: true` in the catalogue and owned
  implicitly. Rolling one would be a duplicate that nobody ever bought.

The roll itself is pure — `roll(catalogue, owned, pityCounter, rng)` — so it goes in
`src/shared/` and gets tested with a seeded RNG. Assert the pity guarantee holds over many
rolls, assert starters never appear, and assert a player owning everything always converts.

### 5. Enforce ownership

Prompt 03 left a helper that returns true for everything. Make it real: `POST /api/avatar`
now rejects an item the player does not own. Starter items always pass.

Anyone who equipped an item during 03 while everything was unlocked will be holding
something they do not own once this lands. Decide and state the migration in the code: the
cleanest is to grant everything currently equipped at first read after the change, so no
player is silently reset to the starter blob. This only matters for the dev subreddit, but
it is two lines and the alternative is a confusing bug report.

### 6. Surfaces

**The balance.** Not in the header `StatBar` — that shows streak and points and the
README is explicit that the streak owns `--sun` and the points tile stays plain
specifically to avoid a third meaning of colour. Put coins in **Your record** and at the
top of the wardrobe, where they are relevant.

**The box opening.** One moment, and it obeys the motion rules: under a second, no
confetti, no shake, no celebratory burst. The reveal's badge stamp is the reference — a
verdict arriving, not a slot machine. `prefers-reduced-motion` gets a cross-fade to the
same final state, as everything else does.

Rarity is still carried by a word and by outline weight, not by a new accent colour.

---

## On real money

Everything here is earned-only, which keeps it a progression loop. Devvit does ship a
payments module. The moment a randomised box can be bought with real money this stops
being a game mechanic and becomes a regulated one — several jurisdictions treat paid loot
boxes as gambling, with disclosure requirements attached. Not a reason to avoid payments;
a strong reason to keep the *random* box on the earned side and sell only known items
directly if anything is ever sold. Do not add payments in this change.

---

## Replay mode

`REPLAY_MODE` is `true` and stays that way.

- **Daily and streak coins do not inflate.** They hang off the day-boundary branch in
  `advance()`, which is a date comparison the flag does not touch. This is the one part of
  the economy that behaves correctly in dev.
- **Submission coins do inflate**, because nothing rate-limits submission any more. A dev
  subreddit will accumulate coins quickly. Expected.

Do not add a `REPLAY_MODE` check anywhere in this change.

---

## Acceptance

- `advance()` stays pure and its existing tests still pass unmodified; new coin assertions
  attach to them.
- The 7-day bonus pays on days 7, 14, 21 and not on 8; a reset streak starts counting
  again from 1.
- Promotion pays the author once, and a re-run of `post-daily` for the same day pays
  nobody a second time.
- A house question reaching the Daily slot pays nobody and does not error.
- Submitting twice in a minute is possible (no cap) but the two submissions are distinct
  posts, and an identical retry inside the dedupe window is refused.
- `points` is unchanged by every coin operation. Assert this explicitly.
- Box roll respects pity, never returns a starter, and converts duplicates.
- Opening a box with insufficient coins fails cleanly and debits nothing.
- `POST /api/avatar` rejects an unowned item.
- `npm run verify` passes.

## Out of scope

Crowd cameos (05). Real-money payments. A shop selling specific items — the box is the
only sink in this change.
