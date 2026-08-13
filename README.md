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

The app installs into **r/PlayOutlier**, set in `devvit.json` under `dev.subreddit`.
Nothing else hardcodes a subreddit — every post and comment resolves the install's own
subreddit from the request context, so the app works wherever it is installed.

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

### Streak and points

- `streak` — consecutive UTC days on which the player submitted at least one vote. The
  habit metric. A missed day resets it to zero; `bestStreak` keeps the number it reached
  and is never reduced.
- `points` — lifetime, banked per vote rather than per day.

**Every question counts** toward both: the Daily, an open question somebody submitted, or
one played out of the archive. The day recorded is the day the vote was *cast*, not the
day the question ran, so an archived puzzle cannot back-date a streak.

**Day boundaries are UTC**, matching the post schedule; local time is never consulted on
either side of the wire. The streak moves once a day however many questions are in it;
points move on every vote.

Each vote pays `POINTS_BASE` (10) plus one accuracy band, on `error = |guess - actual|`:

| Band | Error | Bonus |
|---|---|---|
| Bullseye | ≤ 2 | +50 |
| Sharp | ≤ 5 | +30 |
| Close | ≤ 10 | +15 |
| Warm | ≤ 20 | +5 |
| Cold | — | 0 |

The label is what the reveal and the shared comment lead with; the number is the receipt.
`Close` shares its ceiling with `HIT_THRESHOLD` on purpose — the point at which the game
says you read the room is the point at which it stops paying much for it. The table lives
in `src/shared/points.ts` alongside its copy, the same way badges do.

---

## Replay mode — turn this off before release

`REPLAY_MODE` in `src/shared/config.ts` is currently **on**. It exists so the
game can be played repeatedly while testing: your answer is never written to
`voted:{questionId}`, so opening a post always gives you the question again
rather than the reveal you already earned.

It does this by disabling the server-side dedupe guard — the only thing stopping
one account from voting a hundred times. Votes still count toward the tallies,
so a test subreddit builds a real distribution and a live one would build a fake
one. The streak still works normally, but with the guard off the same account
banks points on every replay, so lifetime totals inflate too — and with them both
player leaderboards, which are read off those totals. That is expected while the
flag is on. Nothing compensates for it: the flag disables exactly one guard, and
everything layered on top stays flag-agnostic so it is correct the moment it flips.

The server logs a warning on boot while it is on. Set it to `false` before this
goes anywhere real.

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
- A vote on a closed question returns **423**. Nothing closes a question on a schedule —
  see below.

---

## Data model

All Redis, exactly as specced, plus three derived indexes.

```
q:{questionId}         hash   text, labelA, labelB, authorId, authorName, source,
                              createdAt, postId, permalink, lockedAt, dailyDate
daily:{YYYY-MM-DD}     string questionId
daily:claims           hash   day -> "1"          (double-fire guard, see below)
daily:summaries        hash   day -> "1"          (double-post guard for the sticky)
post:{postId}          string questionId
menu:post              string postId of the pinned menu post (no question on it)

votes:{questionId}     hash   a, b, guessSum, guessCount, errSum
guesses:{questionId}   zset   userId -> guess     (the distribution record)
voted:{questionId}     hash   userId -> "a:45:21" (dedupe guard + what to re-render)
hist:{questionId}      hash   bucket -> count     (derived from guesses)
commented:{questionId} hash   userId -> commentId

user:{userId}          hash   streak, bestStreak, lastPlayedDay, points,
                              totalPlayed, totalHits, weekPoints, weekKey
sub:cooldown:{userId}  string TTL 24h

queue:pending          zset   questionId -> upvotes
queue:approved         zset   questionId -> upvotes
stats:misjudged        zset   questionId -> avgError
pool:cursor            string index into the shuffled house pool

lb:points:{YYYY-Www}   zset   userId -> weekly points + tiebreak, TTL 9 days
lb:points:all          zset   userId -> lifetime points + tiebreak
users:names            hash   userId -> username

avatars                hash   userId -> "faceId:accessoryId"
inv:{userId}           hash   itemId -> "1"
```

**Additions and why.** `hist:` and `stats:misjudged` are caches so the reveal and the
leaderboard are cheap reads instead of scans over `guesses:` and every question;
`guesses:` remains the record of truth. `commented:` stops one tap from posting twice.
`daily:claims` is the `post-daily` lock: the claim has to be taken *before* the question
is resolved, or two overlapping runs both draw from the house pool and one draw is
thrown away. `daily:summaries` is the same idea for `summarize-daily` — it gets its own
key rather than a flag on the question record, because the summary changes nothing about
the question. `errSum` on `votes:` is what makes `avgError` computable without a scan.

**The player boards.** `lb:points:*` are written only by `recordPlay`, which is already
the one function that knows a player's new totals — a second writer would be a second
chance for a board to disagree with the record behind it. The weekly board is keyed by
ISO week and expires nine days after it is opened, so a closed week cleans itself up and
stays readable for a day or two after it closes. `weekPoints`/`weekKey` on the user hash
exist so the weekly figure can be `zAdd`ed as a computed value: the score carries a
tiebreak fraction under the points (see `src/shared/board.ts`) and `zIncrBy` cannot be
trusted to carry that fraction across increments. `users:names` is the only place a
voter's username is stored; it is written once per player, because the alternative is a
Reddit API call on every vote.

**Avatars.** `avatars` is one shared hash with the equipped pair packed into a single
field, rather than a key per player, so a screen wanting ten players' blobs costs one
`hMGet` and not ten round trips. An absent field is the starter pair, so nothing needs
back-filling for a player who has never opened the wardrobe. `inv:` is what a player owns;
starter items are never written to it, because they are owned implicitly by everyone.
Nothing reads `inv:` yet — every item is currently unlocked — but it is written from the
start so there is an inventory to lock against later rather than one to reconstruct.

`voted:{questionId}` is both the dedupe guard and the record of what to render on
return. A player reopening a post they have answered always lands on the completed
reveal — never a blank form, never a second vote. Its third field is the error the
points were paid on, banked at vote time; a two-field value is a vote from before points
existed and still renders.

### What a returning player sees

Everything except the counters and the award is recomputed from the **live** tally, so
the crowd is as it stands now rather than a fossil of the moment they voted. The streak
and the points are banked at vote time and never recomputed: a day already counted stays
counted, and points already paid are not retroactively taken away because the crowd moved
afterwards. That is why the vote-time error is stored — an award re-derived from a tally
that has since moved would contradict the total it already added to.

---

## Endpoints

```
GET  /api/state/:postId       question, prior answer, tallies only if voted
POST /api/vote                { postId, choice, guess } -> reveal
POST /api/comment             posts the generated comment as this user
POST /api/submit              create an open question + post
GET  /api/leaderboard/questions  most misjudged questions ever
GET  /api/leaderboard/players?range=week|all   players by points banked
GET  /api/avatar              the pair you are wearing, and what you own
POST /api/avatar              { face, accessory } -> the same shape
GET  /api/today               today's UTC day key
GET  /api/daily?from={postId} where today's Daily is — a state and a permalink
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
| `summarize-daily` | `0 0 * * *` | Sticky where the *previous* day's split stands |
| `refresh-queue` | hourly | Re-score `queue:pending` from live post upvotes |

Both midnight jobs are idempotent and touch different day keys, so the order they fire
in does not matter. `post-daily` guards on `daily:claims`, `summarize-daily` on
`daily:summaries`; both claim before they act, so two overlapping runs produce one post
and one sticky.

### Nothing closes on a schedule

**Yesterday's Daily stays open.** An archived question still counts toward a streak and
still pays points, so closing it the next midnight would make the archive unplayable and
would quietly cost somebody a streak for answering the wrong question. The midnight job
posts a summary and changes nothing about the question.

The summary therefore reports where the split *stands* rather than declaring a result —
"so far", "still open" — and is expected to go stale as people keep playing.

`lockQuestion` still exists and the client still renders a closed question, but nothing
calls it automatically: closing one is a deliberate act for a question that turned out to
be a problem. There is no mod affordance wired to it yet.

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
post immediately, counts toward the streak and pays points like any other question,
accumulates real vote data, and enters the promotion queue. One submission per user per
24h, enforced server-side with a TTL.

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

- Flat circles, 2px ink outline, sized to fill the box the slide hands them — the crowd
  measures its own space and centers in it, so the dots grow with the screen
- Your dot carries a 3px ring and a knockout so it sits proud of the pack
- Your side takes the accent for your outcome; the opposing side is ink at 15%
- Eight dots carry faces, chosen by a fixed seed — a crowd where every face is drawn
  looks like a mascot sheet

**Blobs** are the same drawing with more shape: a dot, a face, and an accessory. They
appear in front of a community question's author line and in the player's own record,
and the catalogue lives in `src/shared/items.ts` as inline SVG path data.

The rule the catalogue is built on is that **an accessory breaks the circle's silhouette
rather than decorating the inside of it** — a horn, a pair of ears, a halo, an antenna.
A dot on a phone lands somewhere around 14–22px, where interior detail is a smudge and an
outline is not, which is the same reason the crowd's faces are two dark spans and nothing
more. A hat would fail that test; the accessory is what changed to pass it.

Everything is authored against one viewBox with the dot at a known place, and the
accessory's room is *inside* it — the element is `size` wide and half again as tall. That
is deliberate: `.slide` and `.menu__body` are scroll containers and clip on both axes, so
art that paints outside its own box loses an edge there. Rarity is carried by a word and
by outline weight in the wardrobe, and by no colour at all.

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

**Pointer feedback** is the sticker metaphor kept honest: anything clickable lifts two
pixels towards the cursor on hover with its shadow lengthening to match, and presses two
pixels into the page on click. Hover is behind `(hover: hover) and (pointer: fine)`, so a
tap on a phone never leaves a button stuck in the raised state.

**Motion** is one orchestrated moment. On lock-in the dots travel to their camps over
600ms with a 6ms stagger and a light spring overshoot; your dot lands ~150ms behind the
pack with a small pop; the badge stamps in after. Under a second total — a verdict, not
a loading screen. The point total counts up on the score slide, the only number in the
app that arrives moving, because it is the only one that was earned rather than reported.
`prefers-reduced-motion` gets a straight cross-fade to the same final state — and the
count-up checks it in JavaScript, since the movement is in a value no media query can
reach. No confetti, no shake, no celebratory burst; the copy voice matches.

---

## The menu

The share slide is the end of a question, so the step that carried **Next** on the way
there carries **Menu** instead of nothing. The menu is a screen rather than a sheet laid
over one: same shell, same header, same card, and the card's contents are the only thing
that changes.

Three rooms, one open at a time, each with its fine print pinned to the bottom — and one
action above them that is not a room at all.

| Entry | What it holds |
|---|---|
| **Today's question** | leaves the post for today's Daily. Not a room |
| Your record | streak, best, points, questions answered, read rate |
| Leaderboard | who has banked the most points, weekly or all time |
| Hardest to read | the misjudged leaderboard, five rows |

The Daily action sits above the wobbled rule and the others below it, because every
entry in the list opens in place and that one navigates away — a player should be able
to tell which is which before tapping. It reads `GET /api/daily`, which answers with one
of four states: `playable`, `voted`, `here` (you are already on today's Daily), or `none`
(no Daily yet today). While the pointer is in flight the button renders disabled rather
than absent; a control that arrives after the screen settles shifts everything under it.

**The leaderboard opens on the week, not on all time.** Points are banked per vote and
nothing closes on a schedule, so on an all-time board the fastest climb is grinding the
archive rather than reading the room well — and a board carrying months of accumulated
lead is not worth opening for anyone who joined late. A weekly reset bounds both: the
archive is finite and can only be farmed once per player, not once per week. All time is
still there as the second tab, because it is a real thing players want to see; it is
just not the thing that should greet them. Ten rows of rank, name and points, with the
viewer's own row pinned below the list whether or not they are on it — a board you are
absent from is a board you stop opening.

Ties are settled inside the score rather than left to Redis, which orders tied members
lexically and would silently rank by account ID. `boardScore` in `src/shared/board.ts`
adds a fraction below 1 that shrinks with each day since launch, so of two players on the
same total the one who has held it longer ranks higher, and the points are recoverable
with `Math.floor`. That also makes `zRank` an unambiguous rank on its own, which matters
because Devvit's Redis has no `zCount` to count a tied group with.

The game itself is explained in the subreddit description rather than in a room — see
[docs/subreddit-copy.md](docs/subreddit-copy.md). What survives in the app is the menu
root's three-sentence tagline, which has to name both things being scored without
becoming a rules page. Every threshold the menu still quotes is read from `src/shared/`,
so it cannot drift from what the game actually scores.

Nothing here is a leak, including the Daily pointer. The misjudged board is average error
on questions long since answered, the counters are the player's own, the player board is
points totalled across every question a player ever answered — an aggregate that narrows
down nobody's answer to anything — and `/api/daily` returns a state and a permalink:
`voted` is a boolean about *you*, never a count. The
menu never touches a live tally, which is what makes it safe to hand out on its own,
below.

The reveal's page index lives in `App` rather than inside the reveal, which is what makes
the trip out to the menu and back land on the slide it left from.

### The pinned menu post

**Outlier: pin the menu post** (mod menu) creates a custom post that opens straight onto
the menu, and stickies it. It is the subreddit's front door: somebody arriving cold reads
the tagline, sees their record, and is one tap from today's question without having to go
looking for it.

The post carries no question, so `GET /api/state/:postId` answers it with a second shape.
`StateResponse` is a discriminated union on `kind` rather than a question-shaped object
with holes in it — which also means the menu post's response has no field that could
carry a `Tally` at all.

`menu:post` records which post it is. It is read *only* when `post:{postId}` misses, so a
playable post never pays for the lookup. The action is idempotent: it confirms the
recorded post still exists before reporting it, so a deleted one does not permanently
block a new one, and a moderator running it twice does not get two front doors.

A failed sticky is not a failed post — Reddit allows two, and a subreddit that already
has both gets the post plus a note rather than an error and nothing.

---

## Decisions taken

Two things the spec left open, and how they were resolved.

**Live percentages on open questions.** The spec's §13 suggests hiding the split until 20
votes and then showing it live, but §6 marks "no tallies before a vote" as critical, and
showing a live percentage pre-vote would break it — the guess becomes free. §6 won.
Tallies are never exposed before a vote on any question. `PROVISIONAL_VOTE_FLOOR` (20) is
still used, but for honesty rather than secrecy: below it the reveal says "N votes so
far. This split will move", the comment says "so far", and the daily summary notes when
a sample was too small to mean anything. This is flagged rather than buried because it is
a real departure from one reading of §13.

**Approve/reject as a form.** The spec asks for a mod list with approve and reject
buttons. Devvit forms have no per-row buttons, so the review action is a form with a
question picker and a decision picker. Same two decisions, one extra tap.

## Not in v1

More than two answer options, images in questions, cross-subreddit play, karma stakes,
LLM-generated question text. Alt-account vote inflation is out of scope too — Devvit
gives a stable `userId` and that is what the dedupe rests on.
