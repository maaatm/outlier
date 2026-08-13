# Implementation prompts

One prompt per shippable change, written to be handed to Claude Code as a standalone
session. Each file is self-contained: it repeats the context it needs rather than
assuming the previous prompt is still in the window.

| # | Prompt | Depends on | Size |
|---|---|---|---|
| 01 | [Menu restructure and the Daily button](01-menu-and-daily-button.md) | — | small |
| 02 | [The player leaderboard](02-player-leaderboard.md) | 01 | medium |
| 03 | [Blob avatars and accessories](03-blob-avatars.md) | 02 (names) | medium |
| 04 | [Coins and gift boxes](04-coins-and-gift-boxes.md) | 03 | large |
| 05 | [Crowd cameos](05-crowd-cameos.md) | 03, 04 | medium |

Run them in order. 01 and 02 are independently shippable and touch nothing the others
need. 03 is the point at which a player can see a blob at all; 04 is what makes acquiring
one a loop; 05 is last on purpose, because it is the only one that touches the reveal.

---

## Decisions that supersede the design doc

[`docs/proposed-features.md`](../proposed-features.md) is the analysis these prompts came
from. Where the two disagree, **these prompts win** — the following calls were made after
it was written.

**Replay mode stays on.** `REPLAY_MODE` in `src/shared/config.ts` remains `true` for
testing. The design doc treats turning it off as a prerequisite; it is not, provided
every prompt below is written so the code is *correct* when the flag flips, and so the
distortions while it is on are understood rather than surprising. Concretely, with
`REPLAY_MODE` on:

- `getStoredVote` always returns `null`, so `castVote` never reports a duplicate and
  every replay of the same question calls `recordPlay` again.
- Points, `totalPlayed`, `totalHits` and therefore both leaderboards inflate on every
  replay. Expected in a dev subreddit; meaningless numbers, not broken code.
- The streak does **not** inflate — `advance()` only moves it when
  `record.lastPlayedDay !== today`, which is a date comparison the flag does not touch.
- Consequently the **daily coin award does not inflate either**, because it hangs off
  the same day-boundary branch. Coins from posting questions *do* inflate, because
  nothing rate-limits submission (see below).

No prompt below may add a `REPLAY_MODE` special case beyond what already exists in
`votes.ts`. The flag's whole design is that it disables one guard; features layered on
top should be flag-agnostic.

**How to play is cut, and so are the four outcomes.** The design doc argued for folding
the outcomes into How to play and keeping both. Overruled: the game gets explained in the
subreddit description instead, and both menu rooms are removed. Prompt 01 covers what
carries the explanatory load in their absence — the menu root's tagline stays and grows
slightly, and the prompt produces sidebar copy as a deliverable.

**Accessories, not hats.** The design doc flagged that a hat is illegible on a 14–22px
dot. The resolution is not to shrink the hat but to change what the item is: accessories
that **break the circle's silhouette** rather than sit on top of it — unicorn horns,
bunny ears, antennae, a halo. A shape that changes the dot's outline is readable at sizes
where interior detail is not, which is the same reason the existing faces are two dark
spans and nothing more.

**Cameos are opt-out, not opt-in.** The toggle ships defaulted **on**. Note the
consequence, since it is a real change to what the game discloses: a player's answer
becomes visible to other players by default, where today the only way it becomes public
is if they tap share themselves. Prompt 05 handles this with a first-run notice rather
than a silent default, so nobody's first encounter with the feature is discovering it
already happened.

**Coin rates**, all of them coins and none of them points — `points` remains the
leaderboard score and is never spent or decremented:

| Event | Coins |
|---|---|
| First vote of the day | +5 |
| Every 7th consecutive day of streak | +20 |
| Question posted | +10 |
| Question promoted to the Daily | +30 |

Approval by a moderator pays nothing on its own; the design doc's approval award is
dropped in favour of paying at submission.

**Submission is uncapped.** The 24h `sub:cooldown:{userId}` limit is removed entirely —
more questions is the goal for now. Prompt 04 does the removal and flags the consequence
in place: uncapped submission plus +10 coins per submission is an unbounded coin source
whose side effect is a real Reddit post each time, so the spam pressure lands on the
subreddit and not just the economy. The prompt implements it as specified and adds one
config constant, `COIN_ELIGIBLE_SUBMISSIONS_PER_DAY`, as an unused-by-default safety
valve that can be turned on without a code change if the queue floods.

---

## House rules for every prompt

These are not preferences; they are the things the codebase will look wrong without.

- **Comments explain why, not what.** Every file in `src/` opens with a prose header
  explaining the decision it embodies. Match that register. A comment restating the line
  below it is worse than none.
- **Constants live in `src/shared/config.ts`.** Anything a designer might retune goes
  there, not inline. Copy that a writer might retune goes next to its data, the way
  `badges.ts` and `points.ts` do it.
- **The invariant holds.** `GET /api/state` must not carry vote counts for a user who has
  not voted. `StateResponse.reveal` is the only field that can hold a `Tally`, and only
  a hit in `voted:{questionId}` populates it. No new endpoint may return a tally, a
  per-question vote count, or anything a tally can be derived from, to a player who has
  not voted on that question.
- **Two accents per screen, one meaning each.** `--signal` is you, `--rare` is minority,
  `--hit` is accurate, `--sun` is the streak and nothing else. A new feature does not get
  a new colour meaning; if it needs emphasis, it gets shape, weight, or a word.
- **Three deliberate imperfections and no more** — crowd jitter, the wobbled rule, the
  tilted badge. Do not add a fourth.
- **No external requests.** Fonts are bundled and subsetted; art is inline SVG path data
  in a TypeScript module. Nothing loads from a CDN.
- **UTC everywhere.** The client never reads a local clock to decide what day it is.
  `toDayKey()` on the server is the only source of "today".
- **Pure logic is tested; Redis-facing code is not.** Put new logic on the pure side of
  the seam where possible, and add tests to `tests/` for it. Run `npm run verify`
  (typecheck + tests + build) before declaring done.
