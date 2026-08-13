# 02 — The player leaderboard

Rank players by points banked, weekly by default with an all-time tab. Fills the
`Leaderboard` room that prompt 01 left as a placeholder.

This is also where player usernames start being stored, which prompt 03 depends on.

---

## Context

Read `README.md` (**Streak and points**, **The menu**), then
`src/server/core/users.ts`, `src/server/core/stats.ts`,
`src/client/components/Leaderboard.tsx`, and `src/server/core/keys.ts`.

### Why weekly is the default

Points are banked per vote and **nothing closes on a schedule** — every archived Daily
and every open question stays playable forever. So on an all-time board the fastest climb
is not reading the room well, it is grinding the archive: 130 house questions in one
evening banks 1,300 points at `POINTS_BASE` alone and beats four months of good daily
play.

A weekly reset bounds that, because the archive is finite and can only be farmed once per
player, not once per week. It also solves the duller problem that a board carrying months
of accumulated lead is not worth opening for anyone who joined late.

All-time still ships, as the second tab. It is a real thing players want to see; it is
just not the thing that should greet them.

---

## What to build

### 1. Rename the existing leaderboard first

`GET /api/leaderboard`, `LeaderboardResponse`, `LeaderboardEntry` and
`src/client/components/Leaderboard.tsx` are all currently the *most-misjudged-questions*
board. Do this rename as a separate first commit, so the diff that adds a feature is not
tangled with the diff that moves things:

```
GET /api/leaderboard          →  GET /api/leaderboard/questions
LeaderboardResponse           →  MisjudgedResponse
LeaderboardEntry              →  MisjudgedEntry
components/Leaderboard.tsx    →  components/MisjudgedBoard.tsx
api.ts: fetchLeaderboard      →  fetchMisjudged
```

`MisjudgedBoard` is used in two places — the menu's "Hardest to read" room and the
reveal's detail tab in `App.tsx`. The menu room keeps its user-facing name; only the code
moves. `misjudgedLeaderboard()` in `stats.ts` is already well named; leave it.

Then add `GET /api/leaderboard/players` for the new one.

### 2. Keys

```
lb:points:{YYYY-Www}   zset  userId -> weekly points + tiebreak    TTL 9 days
lb:points:all          zset  userId -> lifetime points + tiebreak
users:names            hash  userId -> username
```

Add all three to `src/server/core/keys.ts` with the same style of comment the existing
entries carry — say why the key exists, not what type it is.

The weekly key gets `redis.expire(key, 9 * 86400)` on first write so old weeks clean
themselves up without a sweep job. Nine days rather than seven: a board should still be
readable for a day or two after its week closes.

`shared/day.ts` needs `toWeekKey(date = new Date()): string` returning ISO-8601 week
form `YYYY-Www`, UTC, matching how `toDayKey` behaves. Unit-test it — year boundaries are
where ISO week numbering is counterintuitive (1 January can belong to week 52 of the
previous year), and this is exactly the pure-function seam `tests/` exists for.

### 3. The tiebreak

Points land on multiples of 5, so exact ties are common, and Redis orders tied members
lexically by member — which would silently rank by account ID. Encode the tiebreak into
the score instead. Points are integers, so any fraction below 1 preserves their ordering:

```ts
/**
 * Of two players on the same total, the one who has been sitting on it longer
 * ranks higher — the later you arrived at a number, the less it is worth.
 *
 * Safe because points are integers: the fraction can never carry across one.
 */
const TIE_HORIZON = 4096; // days; ~11 years of runway
export function boardScore(points: number, daysSinceLaunch: number): number {
  return points + (TIE_HORIZON - Math.min(daysSinceLaunch, TIE_HORIZON - 1)) / TIE_HORIZON;
}
```

Put it in `src/shared/` next to the other pure scoring code and test it: monotone in
points, never crosses an integer boundary, and clamps rather than going negative past the
horizon. Display `Math.floor(score)`.

This matters beyond aesthetics: Devvit's Redis has **no `zCount`**, so there is no cheap
way to count players above a given score. Encoding the tiebreak means `zRank` alone gives
an unambiguous rank with no second lookup.

### 4. Writing the boards

All board writes go in `recordPlay` in `src/server/core/users.ts` and nowhere else. It
already computes the next record, so it is the one place that knows the new totals.

The weekly score is *points banked this week*, not lifetime points — so the weekly zset
needs incrementing by the award, not set to a total. `zIncrBy` exists, but it cannot
carry the tiebreak fraction correctly across increments. Two options; take the second:

- Track weekly points as their own field on `user:{userId}` (`weekPoints`, `weekKey`),
  reset when `weekKey` changes, and `zAdd` the computed `boardScore`. One extra field on
  a hash already being written, and the value stays inspectable.
- `zIncrBy` and accept a drifting fraction. Don't — the fraction is meaningful.

### 5. Storing names

Both boards render usernames and the app currently stores none for voters.
`reddit.getCurrentUsername()` exists but is a Reddit API call, so it must not run on
every vote:

```ts
// Once per player, forever. One extra hGet on the vote path buys one API call
// in a player's entire lifetime.
if (!(await redis.hGet(keys.names, userId))) {
  const name = context.username ?? (await reddit.getCurrentUsername());
  if (name) await redis.hSet(keys.names, { [userId]: name });
}
```

`context.username` is already used this way in `submit.ts` — prefer it and fall back.

Reddit usernames change rarely; a stale name on a board is cosmetic. Deleted and
suspended accounts will accumulate — handle that lazily at render time, `zRem`-ing a
member whose name lookup misses and whose `getUserById` returns undefined, rather than
building a sweep job.

### 6. The route

```
GET /api/leaderboard/players?range=week|all
→ { range, rows: [{ rank, userId, name, points }], you: { rank, points } | null }
```

Read path:

```ts
const rows = await redis.zRange(key, 0, ROWS - 1, { by: 'rank', reverse: true });
const names = await redis.hMGet(keys.names, rows.map(r => r.member));
const rank = await redis.zRank(key, userId);          // ascending
const yourRank = rank === undefined ? null : (await redis.zCard(key)) - rank;
```

Three round trips for a page. Cheap enough to serve on every menu open with no cache.

`you` is what makes the board worth reopening for the other 99% of players — a board you
are absent from is a board you stop looking at. Return it even when the player is in the
top ten; let the client decide whether to render it twice.

**Invariant check:** points, streaks and rates are per-player aggregates across every
question ever answered. None of them narrows down how any individual answered any
individual question, and none carries a `Tally`. Say so in the route's header comment —
this is the first new read path added since the invariant was written and the next person
to touch it should not have to re-derive that it is safe.

### 7. The room

Two tabs — **This week** / **All time** — reusing the `detail__tabs` / `detail__tab`
pattern already in `App.tsx`'s reveal, so the menu does not invent a second tab idiom.

Ten rows: rank, name, points. The viewer's row pinned below the list, visually separated.
Keep rows terse — **Your record** is the adjacent room and it owns the prose. If the
board's rows start explaining themselves, the two rooms are competing.

No accent colour on the top rank. The two-accents-per-screen rule is not suspended for a
leaderboard, and rank is already carried by position.

Empty state, in the existing `notice--quiet` voice: a fresh install has an empty weekly
board every Monday and that is normal, not an error.

---

## Replay mode

`REPLAY_MODE` is `true` and stays that way. It means the same account banks points every
time it replays a question, so **both boards will show inflated, meaningless numbers in
the dev subreddit**. That is expected. Do not add a flag check to compensate — the flag's
design is that it disables exactly one guard, and features layered on top stay
flag-agnostic so they are correct the moment it flips.

Worth knowing while testing: the *streak* board figure would not inflate, because
`advance()` only moves the streak when the UTC day changes. Points do.

---

## Acceptance

- Rename lands as its own commit; `npm run verify` passes at that commit.
- Both tabs render, weekly is the default, weekly is empty on a fresh week.
- `toWeekKey` has tests covering a year boundary in both directions.
- `boardScore` has tests for monotonicity and integer-boundary safety.
- Two players with identical points rank deterministically, and re-running the read gives
  the same order.
- `you` renders correctly for a player outside the top ten and for one inside it.
- `GET /api/leaderboard/players` returns no per-question data of any kind.

## Out of scope

Streak and read-rate boards — the shape here should make adding a third and fourth zset
straightforward later, but do not build them now. No avatars on rows yet; prompt 03 adds
them once there is something to render.
