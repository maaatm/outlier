# Outlier

A daily social-calibration game for Reddit, built on Devvit.

Every day the subreddit gets one question about ordinary human behavior. You answer it,
then guess what percentage of people agreed with you. The reveal tells you two things:
how normal you are, and how well you read other people.

Two taps, no typing, under fifteen seconds.

```
See question  →  Tap an answer  →  Drag the slider  →  Lock in  →  Reveal
```

---

## Running it

```bash
npm install
npm run login          # devvit login
npm run playtest       # builds and installs into your dev subreddit
```

Set your dev subreddit in `devvit.json` under `dev.subreddit` (currently `outlier_dev`).

| Command | What it does |
|---|---|
| `npm run build` | Builds `dist/client` and `dist/server` |
| `npm run check` | Typechecks both projects |
| `npm test` | Runs the unit suite |
| `npm run verify` | check + test + build |
| `npm run upload` | Uploads a version to Reddit |

The app posts a Daily automatically on install, so there is something to play with
immediately rather than a wait until midnight.

---

## Layout

```
data/questions.json     130 hand-written house questions
docs/writing-questions.md   the moderator guide — the thing that decides if this is fun
src/shared/             scoring, badges, day math, comment text — used by both sides
src/server/core/        redis-facing logic, one concern per file
src/server/routes/      hono routers: api, submit, queue, menu, forms, tasks
src/client/             react app, flat sticker-book UI
tests/                  unit tests for everything pure
```

The client and the server resolve `@devvit/web/*` through different export conditions,
so each owns its own `tsconfig.json`. The root one just points at both.

---

## The two axes

**Rarity** — was your answer the minority or majority position? Your side is the minority
below 35% of the vote.

**Accuracy** — `error = |guess - actualPercentAgreeing|`. A hit is `error <= 10`. The raw
error is kept for stats; the binary is what makes a streak legible.

|  | Guessed well | Guessed badly |
|---|---|---|
| **Majority answer** | Baseline | Impostor syndrome |
| **Minority answer** | Self-aware outlier | Living in a bubble |

Badge copy lives in `src/shared/badges.ts` so the tone can be tuned without touching
logic. Thresholds live in `src/shared/config.ts`.

### Streaks

- `playStreak` — consecutive days with a Daily submission. The habit metric.
- `readStreak` — consecutive Dailies where `error <= 10`. The brag metric.

Both reset on a missed day. **Day boundaries are UTC**, matching the post schedule; local
time is never consulted on either side of the wire. Only the Daily moves streaks — open
questions accumulate vote data and nothing else.

---

## The invariant

`GET /api/state` must not include vote counts for a user who has not voted. Otherwise
everyone reads the current percentage off the wire and scores perfectly, and the second
axis of the game stops existing.

In the code this is structural rather than a check: `StateResponse.reveal` is the only
field that carries a `Tally`, and the only thing that populates it is a lookup in
`voted:{questionId}`. See the header comments in `src/server/core/votes.ts` and
`src/server/routes/api.ts`.

Related guarantees:

- `guess` is validated server-side as an integer 0–100; `choice` against the question's
  own labels.
- Dedupe is `hSetNX` on `voted:{questionId}` — an atomic claim, so two taps racing each
  other produce one vote.
- A second vote returns **409** with the reveal the player already earned.
- A vote on a locked Daily returns **423**.

---

## Data model

All Redis, exactly as specced, plus three derived indexes.

```
q:{questionId}         hash   text, labelA, labelB, authorId, authorName, source,
                              createdAt, postId, lockedAt, dailyDate
daily:{YYYY-MM-DD}     string questionId
daily:claims           hash   day -> "1"          (double-fire guard, see below)
post:{postId}          string questionId

votes:{questionId}     hash   a, b, guessSum, guessCount, errSum
guesses:{questionId}   zset   userId -> guess     (the distribution record)
voted:{questionId}     hash   userId -> "a:45"    (dedupe guard + what to re-render)
hist:{questionId}      hash   bucket -> count     (derived from guesses)
commented:{questionId} hash   userId -> commentId

user:{userId}          hash   playStreak, readStreak, lastPlayedDay,
                              totalPlayed, totalHits
sub:cooldown:{userId}  string TTL 24h

queue:pending          zset   questionId -> upvotes
queue:approved         zset   questionId -> upvotes
stats:misjudged        zset   questionId -> avgError
pool:cursor            string index into the shuffled house pool
```

**Additions and why.** `hist:` and `stats:misjudged` are caches so the reveal and the
leaderboard are cheap reads instead of scans over `guesses:` and every question;
`guesses:` remains the record of truth. `commented:` stops one tap from posting twice.
`daily:claims` is the `post-daily` lock: the claim has to be taken *before* the question
is resolved, or two overlapping runs both draw from the house pool and one draw is
thrown away. `errSum` on `votes:` is what makes `avgError` computable without a scan.

`voted:{questionId}` is both the dedupe guard and the record of what to render on
return. A player reopening a post they have answered always lands on the completed
reveal — never a blank form, never a second vote.

### What a returning player sees

Everything except the streak counters is recomputed from the **live** tally, so the
crowd is as it stands now rather than a fossil of the moment they voted. Streaks are
banked at vote time and never recomputed: a day already counted stays counted, and a
`readStreak` earned on the day's numbers is not retroactively taken away because the
crowd moved afterwards.

---

## Endpoints

```
GET  /api/state/:postId       question, prior answer, tallies only if voted
POST /api/vote                { postId, choice, guess } -> reveal
POST /api/comment             posts the generated comment as this user
POST /api/submit              create an open question + post
GET  /api/leaderboard         most misjudged questions ever
GET  /api/queue               mod-only
POST /api/queue/:id/approve   mod-only
POST /api/queue/:id/reject    mod-only
```

Mod-only routes re-check moderator status server-side. The `forUserType: "moderator"`
flag on a menu item hides a button; it does not gate the endpoint behind it.

---

## Scheduler

| Job | Cadence | Action |
|---|---|---|
| `post-daily` | `0 0 * * *` | Resolve source, create the Daily post, write `daily:{date}` |
| `lock-daily` | `0 0 * * *` | Lock the *previous* day, freeze tallies, sticky the summary |
| `refresh-queue` | hourly | Re-score `queue:pending` from live post upvotes |

Both midnight jobs are idempotent and touch different day keys, so the order they fire
in does not matter.

---

## Question sources

1. **Promoted community question** — the highest-scoring *approved* item in the queue
   with at least `PROMOTION_THRESHOLD` (10) upvotes. Approval is a manual mod step;
   unmoderated content never reaches the Daily slot.
2. **House pool** — `data/questions.json`, 130 hand-written questions drawn in a
   deterministic shuffled order with no repeats until the pool is exhausted. Four months
   of Dailies with zero community input. The next pass reshuffles rather than repeating
   the first.

Anyone can submit an open question from the subreddit menu. It becomes its own playable
post immediately, does not affect streaks, accumulates real vote data, and enters the
promotion queue. One submission per user per 24h, enforced server-side with a TTL.

Question text is validated and filtered before a post is created — length, a single
trailing question mark, no links or usernames, and a content filter that turns away
slurs along with political, medical, and identity topics. See
[docs/writing-questions.md](docs/writing-questions.md).

---

## Visual system

Flat sticker-book. Thick outlines, solid fills, hard offset shadows, zero gradients. The
restraint is in the layout; the personality is in the shapes and the color.

**The dot crowd** is the signature and the one place effort is spent. One hundred dots,
each dot a person, one of them you. There is no percentage bar: on reveal the dots travel
from a neutral scatter into two camps and the count *is* the visual. Nineteen dots
against eighty-one lands harder than "19%".

- 14px circles, flat fill, 2px ink outline
- Your dot carries a 3px ring and a knockout so it sits proud of the pack
- Your side takes the accent for your outcome; the opposing side is ink at 15%
- Eight dots carry faces, chosen by a fixed seed — a crowd where every face is drawn
  looks like a mascot sheet

**Color** is semantic. Each accent means exactly one thing and no screen shows more than
two at once: `--signal` you, `--rare` minority, `--hit` accurate, `--sun` streak and
nothing else. Dark mode moves the neutrals only; the accents hold in both.

**Type.** Gabarito for display and big numbers, Instrument Sans for body and UI, DM Mono
for metadata. All three are bundled as subsetted woff2 in `src/client/fonts` and served
through the asset pipeline — the app makes no external requests, so nothing loads from a
font CDN.

**Deliberate imperfection**, three moves and no more: the crowd is jittered by a
deterministic ±2px and ±3° from each dot's index; the divider under the question is an
inline SVG path with a hand-drawn waver; the badge sits at −2° like a stamp applied by
hand.

**Motion** is one orchestrated moment. On lock-in the dots travel to their camps over
600ms with a 6ms stagger and a light spring overshoot; your dot lands ~150ms behind the
pack with a small pop; the badge stamps in after. Under a second total — a verdict, not
a loading screen. `prefers-reduced-motion` gets a straight cross-fade to the same final
state. No confetti, no shake, no celebratory burst; the copy voice matches.

---

## Decisions taken

Two things the spec left open, and how they were resolved.

**Live percentages on open questions.** The spec's §13 suggests hiding the split until 20
votes and then showing it live, but §6 marks "no tallies before a vote" as critical, and
showing a live percentage pre-vote would break it — the guess becomes free. §6 won.
Tallies are never exposed before a vote on any question. `PROVISIONAL_VOTE_FLOOR` (20) is
still used, but for honesty rather than secrecy: below it the reveal says "N votes so
far. This split will move", the comment says "so far", and the locking summary notes when
a sample was too small to mean anything. This is flagged rather than buried because it is
a real departure from one reading of §13.

**Approve/reject as a form.** The spec asks for a mod list with approve and reject
buttons. Devvit forms have no per-row buttons, so the review action is a form with a
question picker and a decision picker. Same two decisions, one extra tap.

## Not in v1

More than two answer options, images in questions, cross-subreddit play, karma stakes,
LLM-generated question text. Alt-account vote inflation is out of scope too — Devvit
gives a stable `userId` and that is what the dedupe rests on.
