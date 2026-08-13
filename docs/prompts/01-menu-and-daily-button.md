# 01 — Menu restructure and the Daily button

Restructure the in-app menu around two things it cannot currently do: get a player to
today's Daily, and show them a leaderboard. Cut the two rooms that explain the game, and
move that explanation to the subreddit description.

No new storage beyond one cached field. This is the smallest of the planned changes and
should land first.

---

## Context

Read `README.md` first — particularly **The menu** and **The pinned menu post** — then
`src/client/components/Menu.tsx`, `src/client/App.tsx`, `src/server/core/daily.ts`, and
`src/server/core/questions.ts`.

The menu today is four rooms in `Menu.tsx`, one open at a time, driven by a `PanelId`
union: `'play' | 'record' | 'outcomes' | 'misjudged'`. It renders in two situations —
reached from the reveal's last slide with an `onExit` back to the question, and as the
whole screen on the pinned menu post, where `onExit` is absent because there is no
question behind it.

## What to build

### 1. Cut two rooms, add one action and one room

Target structure:

```
Today's question          navigates out of the post          [primary action]
──────────────────────────────────────────────────────────
Your record               streak, best, points, read rate
Leaderboard               placeholder in this change — see below
Hardest to read           what the subreddit misjudged most
```

- Delete the `'play'` room and the `HowToPlay` component.
- Delete the `'outcomes'` room and the `Outcomes` component.
- `PanelId` becomes `'record' | 'board' | 'misjudged'`.
- Add the `'board'` entry to `ENTRIES` now, rendering a `notice--quiet` placeholder
  ("Nothing ranked yet."). Prompt 02 fills it in. Adding the entry now means 02 touches
  one component and not the menu's structure.

`Menu.tsx` imports `badgeFor`/`getBadge` and several config constants solely for the two
deleted rooms. Remove the imports that go unused; leave `CROWD_SIZE` (the tagline uses
it) and whatever `Record` still needs.

**The action is not a room.** Every other entry opens a panel in place; this one leaves
the post entirely. Render it above the `WobbleRule`, with `button--primary`, visually
separated from the `menu__list` below. A player should be able to tell which entries
navigate away before tapping one.

### 2. The tagline now carries the explanation

With How to play gone, the only thing in the app that says what the game is, is the
tagline in `Root`:

> One question a day about ordinary behavior. Answer it, then guess how many people out
> of 100 answered the same way.

Keep it and extend it by at most one sentence, so someone landing cold on the pinned menu
post still learns the shape of the game before they tap anything. It needs to convey that
there are two things being scored — how unusual you were, and how well you guessed —
without becoming a rules page. Aim for three sentences total and no bullet list; if it
needs a bullet list it belongs in the sidebar, not here.

### 3. `GET /api/daily`

Add to `src/server/routes/api.ts`, alongside the existing `/api/today`:

```ts
type DailyPointer = {
  day: string;                                       // YYYY-MM-DD, UTC, server-resolved
  state: 'playable' | 'voted' | 'here' | 'none';
  postId?: string;
  permalink?: string;
};
```

Resolution: `daily:{toDayKey()}` → `getQuestion(id)` → `postId` / `permalink`.

The four states:

| State | Condition | Button renders as |
|---|---|---|
| `playable` | a Daily exists and this user has not voted on it | **Today's question** — primary |
| `voted` | they have already answered it | "You've played today's" — still navigates |
| `here` | the post this menu is open on *is* today's Daily | disabled line, or omitted |
| `none` | no Daily for today yet | "Tomorrow's question posts at midnight UTC" — not a button |

`none` is genuinely reachable: `post-daily` runs on `0 0 * * *`, and a subreddit that
installs at 00:30 UTC has no Daily until the next midnight except for the one
`onAppInstall` posts.

Deciding `here` needs the caller's postId. Take it as a query parameter
(`/api/daily?from={postId}`) rather than trying to infer it — the pinned menu post has no
question, so there is no `post:` lookup to lean on.

**Two invariant notes, and they matter more than the endpoint does:**

- Deciding `voted` requires reading `voted:{questionId}` for this user. That is a
  boolean about *them*, not a tally, and it must stay that way. Return `state`, not a
  count, not a reveal, not the question text. Reuse `getStoredVote` and coerce to a
  boolean at the call site.
- Under `REPLAY_MODE`, `getStoredVote` always returns `null`, so `voted` is unreachable
  in dev. That is correct behaviour, not a bug to work around — do not add a flag check.

Give the route a header comment in the style of the ones already in `api.ts`, stating
explicitly that it returns no tally.

### 4. Cache the permalink

`linkQuestionToPost` in `src/server/core/questions.ts` currently writes `postId` in both
directions. Add `permalink` to the `q:{id}` hash in the same write — `submitCustomPost`
returns a `Post` with a `permalink` getter, so it is free at write time and saves a
`reddit.getPostById` call on every menu open.

Both call sites pass it: `postDaily` in `daily.ts` and `submitOpenQuestion` in
`submit.ts`. Add the field to `QuestionRecord` and read it in `getQuestion` with a `''`
fallback, the way `postId` already does — records written before this change have no
permalink, and the endpoint should fall back to `reddit.getPostById(postId).permalink`
for those rather than returning `none`.

Keep `permalink` off `toPublicQuestion`'s output. It is not needed to render a question
and the public projection is deliberately narrow.

### 5. Client navigation

`navigateTo` is exported from `@devvit/web/client` (verified present in 0.14.0) and
accepts either a URL string or `{ url, permalink }`.

Fetch the pointer in `Menu.tsx` on mount, the way `Leaderboard.tsx` already fetches its
rows — `useEffect` with a `live` flag to avoid setting state after unmount. Add a
`fetchDaily` to `src/client/api.ts` next to `fetchLeaderboard`.

While the fetch is in flight, render the button disabled rather than absent. A control
that appears a moment after the screen settles is worse than one that starts inert,
especially at the top of the list where it shifts everything below it.

---

## Subreddit description copy

Deliverable, not a code change: write the sidebar text that now carries what How to play
used to. Put it in `docs/subreddit-copy.md`.

It should cover the three steps, the two axes with their real thresholds
(`MINORITY_THRESHOLD` 35%, `HIT_THRESHOLD` 10), the four outcomes, the points bands from
`BANDS`, and how the streak works (UTC days, any question counts, missing a day resets).
Take the numbers from `src/shared/` rather than restating them from memory, and note in
the file which constants they came from so it can be re-checked when they change.

Match the app's voice: dry, declarative, no exclamation marks, no "Ready to play?".

---

## Acceptance

- Menu renders three rooms plus one action; no `HowToPlay` or `Outcomes` component
  remains and no dead imports are left in `Menu.tsx`.
- Opening the menu from the reveal still returns to the slide it was opened from —
  `slide` lives in `App` for this reason and this change must not move it.
- The pinned menu post still renders without an `onExit` button.
- All four daily states are reachable. Verify `none` by clearing `daily:{today}` and
  `here` by opening the menu from today's Daily post itself.
- `GET /api/daily` returns no vote counts in any state. Check the actual JSON.
- `npm run verify` passes.

## Out of scope

The leaderboard's contents (02), anything to do with avatars (03–05), and the streak's
coin payouts (04). Do not pre-wire hooks for them — an empty room and a placeholder are
enough of a seam.
