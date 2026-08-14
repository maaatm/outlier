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
src/shared/             scoring, badges, day math, coin rules, the box roll, the item
                        catalogue, comment text — used by both sides
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
- `points` — lifetime, banked per vote rather than per day. The score, and never spent.
- `coins` — the spendable balance, earned four ways and sunk into gift boxes. A second
  ledger on the same record, not a second score. See below.

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

## Coins and the gift box

**Coins are not points.** `points` is the leaderboard score: cumulative, never
decremented, never spent. A score that can be spent stops being a score — a player who
buys three boxes drops fifty places and the board quietly becomes a ranking of who bought
the least. `coins` is a separate spendable balance, and it is the only figure on a player
record that ever goes down.

Nothing in the economy reads, writes or decrements `points`. That is asserted directly in
`tests/streaks.test.ts`.

Four ways to earn, all of them earned-only:

| Event | Coins | Where it fires |
|---|---|---|
| First vote of the day | +5 | `advance()` in `core/users.ts` |
| Every 7th consecutive day of streak | +20 | `advance()` in `core/users.ts` |
| Question posted | +10 | `submitOpenQuestion` in `core/submit.ts` |
| Question promoted to the Daily | +30 | `postDaily` in `core/daily.ts` |

The first two hang off the day boundary `advance()` already turns the streak on, so they
are one branch on a function that was already pure and already tested. The seven-day bonus
is keyed on the streak the vote moved *to*, so it pays on the day the run reaches seven
rather than the day after, and a run that reset to 1 counts toward the next one from
there. Promotion pays the **author**, not the moderator who approved it and not whoever
ran the job — the id comes off `q:{id}`, and the credit sits inside the `daily:claims`
guard so a re-run of `post-daily` pays nobody a second time. A house question reaching the
Daily slot pays nobody and does not error.

**The box** is the only sink. `POST /api/box/open` — the server rolls, the client
animates; a client-side roll is a client-side inventory. Four rules:

- **Debit and grant are atomic.** The balance and the pity counter are read under a
  `watch` on the user hash and written back inside the transaction, so a failure between
  taking the coins and granting the item cannot eat one or give away the other. If
  anything else moved that hash in between, `exec` comes back empty and nothing happened.
- **Duplicates convert.** A repeat pays back `DUPLICATE_REFUND_FRACTION` of the price.
  Without it a player holding most of the catalogue opens boxes for nothing and stops.
- **Pity.** A rare is guaranteed within `BOX_PITY_ROLLS` boxes, on a counter that resets
  when one lands — the worst case becomes a bounded promise rather than "I opened twelve
  and got nothing".
- **Starters are never rolled.** They are owned implicitly by everyone, so rolling one
  would be a duplicate nobody ever bought.

The roll itself is pure — `roll(catalogue, owned, pity, rng)` in `src/shared/roll.ts` —
and is tested against a seeded generator over tens of thousands of boxes, which is the
only way an assertion about a guarantee is a fact rather than a coin flip that passed
today.

**Granting coins for testing.** The four rates are slow on purpose, which makes the
wardrobe hard to try out. `Outlier: grant coins` is a moderator-only menu item that adds
to any account's balance by username — the only path that creates coins out of nothing,
deliberately unreachable by a player, and mod-checked on the form endpoint as well as on
the menu item. Points and both leaderboards are untouched by it. The form's fields are
prefilled with the account and amount it was first needed for.

**On real money.** Everything here is earned-only, which keeps it a progression loop.
Devvit does ship a payments module, and the moment a randomised box can be bought with
real money this stops being a game mechanic and becomes a regulated one — several
jurisdictions treat paid loot boxes as gambling, with disclosure requirements attached.
That is not a reason to avoid payments; it is a strong reason to keep the *random* box on
the earned side and to sell only known items directly, if anything is ever sold.

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

The coins split in two under it, and the split is worth knowing. The **daily and streak
awards do not inflate**: they hang off the day-boundary branch in `advance()`, which is a
date comparison the flag does not touch — the one part of the economy that behaves
correctly in dev. **Submission coins do inflate**, because nothing rate-limits submission
any more; a dev subreddit will accumulate them quickly, and that is expected rather than
broken. Nothing in the economy checks the flag.

**The crowd's cameos are absent under it**, and that is the flag working rather than a
bug. `recent:{questionId}` is written on the same branch as `guesses:`, which the flag
skips, and nothing is written to `voted:` either — so there is no pool to draw from and no
side to draw anyone on. Nothing in `core/cameos.ts` checks the flag; the feature simply has
no data in a replay subreddit and is correct the moment the flag flips. Seeing cameos while
developing means turning it off.

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

### What the reveal says about other people

Up to ten players appear in the reveal's crowd as their blobs, on the side they actually
answered. That is a real widening of what the game discloses, and it is worth being
straight about: before this, how you answered was yours unless *you* tapped share and
posted the comment. The setting ships **on**, so three things are not optional.

- **The notice is in place, not in a settings page.** The first reveal where a player's own
  blob is eligible tells them so, on that screen, with both answers one tap away. Nobody's
  first encounter with this should be discovering it already happened.
- **Turning it off is retroactive.** `showBlob` is read every time a crowd is drawn and is
  never captured at vote time, so switching it off takes a player out of every crowd they
  are in — including questions answered months ago. Absent means on *and* never asked, which
  is why there is no migration and no second field recording who has been told.
- **Only voters are eligible, structurally.** The candidates come from `recent:{questionId}`,
  which only `castVote` writes, so a signed-out reader and a player who has never answered
  cannot be in the pool at all rather than being filtered out of it.

None of this weakens the tally invariant. Cameos ride on `Reveal` and on nothing else, so
they are behind the same `voted:{questionId}` gate — a viewer who has not answered cannot
reach them, and a viewer who has already holds the tally those ten answers are part of.

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
recent:{questionId}    zset   userId -> voted at  (capped window, for the cameos)

user:{userId}          hash   streak, bestStreak, lastPlayedDay, points,
                              totalPlayed, totalHits, weekPoints, weekKey,
                              coins, pity, subDay, subCount, showBlob
sub:recent:{userId}    hash   submission fingerprint -> "1", TTL 60s

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
starter items are never written to it, because they are owned implicitly by everyone. It
now gates: `POST /api/avatar` refuses an item outside it, and the wardrobe's steppers walk
it rather than the whole catalogue.

**Two ledgers, one hash.** `points` and `coins` sit on the same `user:` record and mean
opposite things — see below. Crediting coins on a vote is therefore one more field moved
on a write `recordPlay` was already making, rather than a second key and a second round
trip. The totals are written by assignment because `recordPlay` is their only writer; the
balance moves by `hIncrBy`, because a box opened in the same breath as a vote would
otherwise be undone by a total read before the debit happened.

**The cameos.** `recent:` is a window, not a register: it is trimmed to
`RECENT_VOTER_CAP` (30) on every write, because a question with ten thousand voters must
not carry a ten-thousand-member zset for a feature that puts ten blobs on a screen. The
ten are drawn from across that window by a seeded shuffle rather than taken off the end of
it — the last ten people to answer are not a sample of the crowd, and on a 50/50 question
a run of one answer would put every cameo in one camp. The seed is the question, so
reopening a reveal shows the same faces rather than reshuffling them. Being in `recent:`
is not permission to be drawn; that is `showBlob`, read at render time, below.

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
GET  /api/avatar              the pair you are wearing, what you own, your balance,
                              and whether other players may see it
POST /api/avatar              { face?, accessory?, showBlob? } -> the same shape;
                              403 if unowned, 400 if it asks for nothing
POST /api/box/open            spend coins, roll an item -> { item, duplicate, refunded, coins }
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
accumulates real vote data, enters the promotion queue, and pays its author coins.

**Submission is uncapped.** The one-per-24h cooldown is gone — more questions is the goal
for now. What replaced it is narrower on purpose: an identical submission from the same
player inside `SUBMISSION_DEDUPE_SECONDS` (60) is refused, because nothing in
`submitOpenQuestion` is idempotent and a client retrying a request that timed out after
the post went up would otherwise create a second post and be paid twice. Two *different*
questions a second apart are both fine.

The consequence is stated where it lives, in `core/submit.ts`: uncapped submission plus
+10 coins each is an unbounded coin source whose side effect is a real Reddit post every
time, so the pressure lands on the front page and the mod queue rather than only on the
economy. `COIN_ELIGIBLE_SUBMISSIONS_PER_DAY` is the valve — `Infinity` by default, wired
through so capping the *reward* (never the submission) is a one-line config change.

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
- On the reveal, up to ten of the dots are real players drawn as their blobs, each in the
  camp they answered in. They are *of* the hundred rather than added to it — a cameo is one
  of the dots drawn larger, so the count on screen is still the count, and a camp never
  holds more of them than it has dots. They take a 2×2 block at the front of their camp
  with the pack flowing around them, they travel on the same clock as everyone else, and
  they never take the top-left cell, which is yours. Tap or hover one for a name; the
  caption slot under the crowd is where it goes

The blob inside a cameo's block is sized to *fit* it rather than to overflow it, which is
what keeps the rest of the geometry honest: a block reaches exactly as far as the two cells
it sits on, so the box the crowd measures itself against needed no changes, no accessory
paints outside the field, and nothing clips against the slide's scroll boundary. The
packing lives in `src/client/crowdLayout.ts` and is tested there.

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
art that paints outside its own box loses an edge there. Rarity is carried by the colour
of a layer's border in the wardrobe and by the word beside the count.

**Color** is semantic. Each accent means exactly one thing and no screen shows more than
two at once: `--signal` you, `--rare` minority, `--hit` accurate, `--sun` streak and
nothing else. Dark mode moves the neutrals only; the accents hold in both.

The rarity ladder — `--rarity-common`, `--rarity-uncommon`, `--rarity-rare` — is the one
exception, and is kept an exception by being confined to the wardrobe's two layer borders,
where it never shares a screen with any of the four above. Its hues are chosen out of the
gaps those four leave: blue, red, green and yellow are spoken for, which rules out the
grey/green/blue ladder other games have trained players to expect, so the ladder is slate,
cyan and violet instead. Colour is the second channel, not the only one — the rarity is
also written next to the count.

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

Four rooms, one open at a time, each with its fine print pinned to the bottom — except the
wardrobe, which spent that space on the gift box — and one action above them that is not a
room at all.

| Entry | What it holds |
|---|---|
| **Today's question** | leaves the post for today's Daily. Not a room |
| Your record | streak, best, points, coins, questions answered, read rate, and whether other players see your blob |
| Wardrobe | your blob, your balance, the items you own, and the gift box |
| Leaderboard | who has banked the most points, weekly or all time |
| Hardest to read | the misjudged leaderboard, five rows |

The Daily action sits above the wobbled rule and the others below it, because every
entry in the list opens in place and that one navigates away — a player should be able
to tell which is which before tapping. It reads `GET /api/daily`, which answers with one
of four states: `playable`, `voted`, `here` (you are already on today's Daily), or `none`
(no Daily yet today). While the pointer is in flight the button renders disabled rather
than absent; a control that arrives after the screen settles shifts everything under it.

**Your record holds the one setting in the app**, next to the blob it is about: whether
other players see that blob in the crowd. It is not in the wardrobe, because the wardrobe
is about what your blob looks like and this is about who it is shown to. One line of copy
says what it does, including that turning it off is retroactive.

**The balance is in Your record and the wardrobe, not the header.** The header shows the
streak and the points, and `--sun` marks the streak alone; a third counter up there would
be a third thing to read before the question, and a third meaning of colour if it were
ever accented. The two places coins appear are the two screens where they are relevant —
the page of totals, and the room where they are spent.

The wardrobe is the one room built to a height budget. A balance, a blob, two steppers and
the gift box have to fit the card without scrolling at 512px — as short as Devvit's inline
post view gets — because a room whose every element is a control cannot put its last one
below the fold. Three things pay for it: the balance rides on the heading's line, each
layer is one row rather than a label above a stepper, and the gift box is exactly two rows
in every state, so the result of a box takes the status line's place instead of pushing
the button down. There is no fine print pinned under it either; that was the fourth thing
to go. Measured at 320/360/430 wide by 512/560/640 tall, opened and closed, rather than
eyeballed — see the note on `.wardrobe` in `styles.css`.

The wardrobe's steppers walk what you own rather than the whole catalogue, using the same
pure `ownsItem` the equip endpoint enforces, so a client in step with the server never
sees a refusal and one that is not cannot talk its way past it. The gift box sits under
the two layers, because the order of that room is: what you have on, what you own, how to
own more. Its reveal is one moment of 240ms — the badge stamp is the reference, a verdict
arriving rather than a slot machine — with no confetti, no shake, no burst, and a
cross-fade to the same final state under `prefers-reduced-motion`. Rarity there is the
word beside the name and the same three-step ladder the layers already use, which is what
keeps that ladder confined to one screen.

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
LLM-generated question text, real-money payments, and a shop selling specific items — the
box is the only sink there is. Alt-account vote inflation is out of scope too — Devvit
gives a stable `userId` and that is what the dedupe rests on.
