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
                        catalogue, comment text, notification copy — both sides
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
- `coins` — the spendable balance, earned seven ways and sunk into gift boxes. A second
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

Seven ways to earn, all of them earned-only:

| Event | Coins | Where it fires |
|---|---|---|
| First vote of the day | +5 | `advance()` in `core/users.ts` |
| Every 7th consecutive day of streak | +20 | `advance()` in `core/users.ts` |
| Question posted | +10 | `submitOpenQuestion` in `core/submit.ts` |
| Question promoted to the Daily | +30 | `postDaily` in `core/daily.ts` |
| The generated comment, posted | +5 | `POST /api/comment` |
| Upvotes on that comment | +1 each, up to 10 | `sweepCommentRewards` in `core/commentRewards.ts` |
| Every 100th answer on a question you asked | +1, up to 25 | `POST /api/vote` |

The first two hang off the day boundary `advance()` already turns the streak on, so they
are one branch on a function that was already pure and already tested. The seven-day bonus
is keyed on the streak the vote moved *to*, so it pays on the day the run reaches seven
rather than the day after, and a run that reset to 1 counts toward the next one from
there. Promotion pays the **author**, not the moderator who approved it and not whoever
ran the job — the id comes off `q:{id}`, and the credit sits inside the `daily:claims`
guard so a re-run of `post-daily` pays nobody a second time. A house question reaching the
Daily slot pays nobody and does not error.

**Comment coins are guarded by a claim, not a check.** `commented:{questionId}` is now
claimed with `hSetNX` *before* the comment is submitted and written over with the real
comment id afterwards, because a read-then-write guard in front of a payment is a double
payment waiting for two taps. A submit that throws therefore leaves a claimed slot
pointing at nothing: the player is refused and can post the comment themselves, which is
the cheaper of the two ways to fail.

**Upvote coins are a watermark, swept hourly.** `comments:paid` holds what each comment
has been paid, and every settle pays the *difference* between what its score owes now and
that number — so a skipped comment costs an hour of latency and never a coin, and a run
that fires twice pays nothing the second time. Comments leave `comments:tracked` when
they pass `COMMENT_TRACK_HOURS` or hit the cap, whichever comes first. Nothing is ever
clawed back: a comment downvoted after payment keeps what it earned.

**Royalties need no watermark at all.** They are keyed on the answer count *this vote
produced* — the number `hIncrBy` handed back — so exactly one vote in a question's life
ever observes each multiple of a hundred, however many are landing at once. The author's
own vote is not excluded: self-farming would cost a hundred distinct accounts per coin,
and filtering would be a read to defend nothing.

**Joining the subreddit pays a box rather than coins.** `POST /api/join` subscribes and
grants one free roll, once per account, tracked on `joined` — Devvit does not expose
subscription state, so a local one-time grant is the only bound available. A free roll is
spent before coins are, refunds nothing on a duplicate (a roll that took nothing in has
nothing to make whole), and still advances pity. It is offered in one place, on the
reveal's score slide, under the award — the menu asks for nothing.

### Where the coins came from

Four of those earns used to pay silently, and two of the three added since arrive hours
after the thing that earned them. A payout the player never sees is not an incentive, so
every one of them now writes a line to `earn:{userId}` — a zset holding the last
`EARNINGS_LOG_SIZE` events, trimmed on write, in the same window-not-a-history shape
`recent:{questionId}` has.

`logEarning` deliberately does not pay: `creditCoins` moves the balance and this records
why, so a payment that succeeds and a log line that fails costs a receipt rather than the
coins. The ledger is read once, by the sheet Your record opens, through
`GET /api/earnings` — and reading it is what marks it seen. `earnSeq` and `earnSeen` on the user hash carry that: unseen is
`earnSeq > earnSeen`, which `projectStats` answers out of the `hGetAll` it was already
making, so the dot on the menu costs no read anywhere.

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

**Granting coins for testing.** The rates are slow on purpose, which makes the
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

## Replay mode — off, and it stays off

`REPLAY_MODE` in `src/shared/config.ts` is **off**. It was turned off when the
incentives shipped, because three of them inflate under it and nothing measured
while it is on is measuring the game. Turning it back on for an afternoon in the
dev subreddit is still the intended use; leaving it on is not.

It exists so the game can be played repeatedly while testing: your answer is
never written to `voted:{questionId}`, so opening a post always gives you the
question again rather than the reveal you already earned.

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
broken. **Comment coins do too**: `claimComment` short-circuits with the flag on, so the
same question can be commented on and paid for repeatedly. **Royalties do as well**, since
`tallyVote` runs on the replay branch and one account can walk a question to a hundred
answers by itself. Nothing in the economy checks the flag — those three are consequences
of the one guard it disables, not branches anybody wrote.

The **free roll for joining does not inflate**: it is claimed on the user hash, which the
flag has no opinion about, so it is once per account in dev exactly as in production.

**The crowd's cameos are absent under it**, and that is the flag working rather than a
bug. `recent:{questionId}` is written on the same branch as `guesses:`, which the flag
skips, and nothing is written to `voted:` either — so there is no pool to draw from and no
side to draw anyone on. Nothing in `core/cameos.ts` checks the flag; the feature simply has
no data in a replay subreddit and is correct the moment the flag flips. Seeing cameos while
developing means turning it off.

The server logs a warning on boot while it is on. Anything turned on for an
afternoon goes back off before the branch does.

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
  blob is eligible says so on that screen, and points at the switch in Your record. Nobody's
  first encounter with this should be discovering it already happened. It is a notice rather
  than a question — one X to close it — because a consent form on the way into the reveal
  would cost the reveal more than it is worth; closing it is what records that they were
  told, so it never fires twice.
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

### Push notifications, opt-in

The one part of the game that reaches a player who is not looking at it, and the one
setting that ships **off**. A cameo is a drawing inside an app somebody already opened; a
notification is this app reaching a phone in somebody's pocket, so absent consent is no.

- **Reddit owns the ledger, not us.** `notifications.isOptedIn` is the record of truth and
  is read every time the switch is drawn. Nothing is mirrored into Redis, because a cached
  copy of a boolean a player can change in Reddit's own settings is a boolean that will
  eventually lie on the one screen that shows it. The single thing stored is `pushAsked`,
  which records that the question was put and not what the answer was.
- **Two things are sent and nothing else.** The Daily is up, to everyone opted in; and —
  to one author — your question is today's Daily. The second suppresses the first for that
  person, because two buzzes about one post is how an opt-in becomes an opt-out.
- **No copy carries a number** except the coin award on the promotion notice. A
  notification reaches somebody who by definition has not voted on the question it is
  about, so anything derived from the split would hand them the answer — the same
  invariant, on the one shape that travels outside the app.
- **The ask is one panel, once, at a streak of `PUSH_ASK_AFTER_STREAK`.** Not on a first
  answer, where the blob notice already has that moment. Both of its buttons write, so a
  no is recorded as an answer rather than as a dismissal.
- **`PUSH_ENABLED` turns the whole thing off.** `@devvit/notifications` ships marked
  experimental; false means the switch never renders, the ask never fires, and nothing is
  ever enqueued. Nothing in `core/push.ts` throws, so a plugin that stops answering costs
  the subreddit a buzz and never its Daily.

---

## Data model

All Redis, exactly as specced, plus three derived indexes.

```
q:{questionId}         hash   text, title, labelA, labelB, authorId, authorName,
                              source, createdAt, postId, permalink, lockedAt, dailyDate
daily:{YYYY-MM-DD}     string questionId
daily:claims           hash   day -> "1"          (double-fire guard, see below)
daily:summaries        hash   day -> "1"          (double-post guard for the sticky)
post:{postId}          string questionId
menu:post              string postId of the pinned menu post (no question on it)

votes:{questionId}     hash   a, b, guessSum, guessCount, errSum
guesses:{questionId}   zset   userId -> guess     (the distribution record)
voted:{questionId}     hash   userId -> "a:45:21" (dedupe guard + what to re-render)
hist:{questionId}      hash   bucket -> count     (derived from guesses)
commented:{questionId} hash   userId -> commentId, or "pending" between the
                              claim and the post
recent:{questionId}    zset   userId -> voted at  (capped window, for the cameos)

user:{userId}          hash   streak, bestStreak, lastPlayedDay, points,
                              totalPlayed, totalHits, weekPoints, weekKey,
                              coins, pity, subDay, subCount, showBlob,
                              freeRolls, joined, earnSeq, earnSeen, pushAsked
sub:recent:{userId}    hash   submission fingerprint -> "1", TTL 60s
sub:count:{userId}:{day}  string  questions posted today, TTL 48h

earn:{userId}          zset   encoded earning -> when it landed (capped window)
comments:tracked       zset   "{userId}:{commentId}" -> posted at
comments:paid          hash   commentId -> coins already paid for its upvotes

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

**Additions and why.** `hist:` is a cache so the reveal is a cheap read instead of a scan
over `guesses:`, which remains the record of truth. `stats:misjudged` is the same idea for
the misjudged ranking, which is now read by one caller: the moderator-posted event post.
`commented:` stops one tap from posting twice.
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

**The incentive keys.** `earn:{userId}` is a window and not a history — the same shape and
the same reasoning as `recent:{questionId}`, because its job is to answer "where did that
come from", which is a question about the last few days and never about the last year. It
is a zset rather than the capped list it would otherwise be because Devvit's Redis has no
list commands. `comments:tracked` holds every comment still inside its accrual window and
`comments:paid` is the watermark beside it; entries leave both together, on a comment's
final settle or the moment it reaches the cap. `royalty:` has no key at all, deliberately —
the answer count a vote produced is the sequence number, so there is nothing to remember.

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
POST /api/comment             posts the generated comment as this user, and pays for it
                              -> { permalink, earned, coins }; 409 on a second attempt
GET  /api/earnings            the last few coin events, newest first — and reading it
                              is what marks them seen
POST /api/join                { decline? } subscribe and take the free roll, once per
                              account -> { joined, granted, freeRolls }
POST /api/submit              { text, labelA, labelB, title? } -> the new post;
                              429 past the day's allowance, 409 on a repeat
GET  /api/leaderboard/players?range=week|all   players by points banked
GET  /api/avatar              the pair you are wearing, what you own, your balance,
                              whether other players may see it, and whether you
                              are opted in to push
POST /api/avatar              { face?, accessory?, showBlob?, push? } -> the same
                              shape; 403 if unowned, 400 if it asks for nothing
POST /api/box/open            spend a free roll or coins, roll an item
                              -> { item, duplicate, refunded, coins, free, freeRolls }
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
| `post-daily` | `0 0 * * *` | Resolve source, create the Daily post, write `daily:{date}`, then notify |
| `summarize-daily` | `0 0 * * *` | Sticky where the *previous* day's split stands |
| `refresh-queue` | hourly | Re-score `queue:pending` from live post upvotes |
| `sweep-comments` | hourly | Pay tracked comments what their upvotes owe |

`sweep-comments` is its own job rather than a second half of `refresh-queue`: they touch
different data, and a throw in one must not take the other's run with it. It reads the
expiring end of `comments:tracked` in full and the newest `COMMENT_SWEEP_BATCH` inside the
window, which is where upvotes actually arrive — and the watermark is what makes bounding
it safe, since a comment it skips is paid in full by the next run that reaches it.

The notifications hang off the end of `post-daily` rather than off `postDaily` itself: the
`try`/`catch` in there releases `daily:claims` on any throw, and a notification failing
inside it would release the claim on a day whose post already exists. A push is something
that happens *because* the Daily was posted; it is not part of posting it. The install
trigger deliberately does not notify — a fresh install has nobody opted in.

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

Anyone can ask a question, from the **Ask a question** room in the menu or from the
subreddit menu item. It becomes its own playable post immediately, counts toward the
streak and pays points like any other question, accumulates real vote data, enters the
promotion queue, and pays its author coins. Both doors call the same
`submitOpenQuestion` and read the same constants, so there is no second copy of any rule.

**Three a day**, per `SUBMISSIONS_PER_DAY`. Submission was uncapped while the only way to
reach it was a subreddit menu item most players never open; the room puts it one tap from
the front door — including the pinned menu post, where somebody who has never played
lands — so uncapped stopped meaning "rarely used" and started meaning an unbounded source
of real posts attached to the lowest-friction control in the game. The allowance is keyed
by UTC day rather than a rolling window, so it turns over on the same boundary the streak
and the Daily use, and three in one sitting is a normal thing to do.

The fingerprint guard is still there and is not the same guard. `sub:recent:{userId}`
refuses an *identical* submission from the same player inside `SUBMISSION_DEDUPE_SECONDS`
(60), because nothing in `submitOpenQuestion` is idempotent and a client retrying a
request that timed out after the post went up would otherwise create a second post and be
paid twice. Two *different* questions a second apart are both fine.

The order the two guards run in is what makes them fair, and it is one rule in both
directions: **nothing a player is refused for costs them anything.** The allowance is
checked before the question is validated and spent after it, so a question the filter
turns away is not one of the three. It is spent before the post call rather than after,
because a post that throws must not be retryable without limit — and a post call that does
throw takes its half-written `q:{id}` record with it rather than leaving an orphan nothing
can reach. `COIN_ELIGIBLE_SUBMISSIONS_PER_DAY` still caps the *reward* independently, and
is `Infinity` by default.

**What a submission is checked for is deliberately narrow.** Something was written, it
reads as words rather than as punctuation, and it is not a link or a username — then the
content filter, which turns away slurs along with political, medical, and identity topics.
Length is not a rule and neither is punctuation: a question that had to be ten characters,
or under a hundred and twenty, or ended in a question mark, was a house style enforced as
a validity check on somebody else's writing, and every one of those refusals fell on
somebody who had already typed the thing. [docs/writing-questions.md](docs/writing-questions.md)
still says what a good question looks like, and the mod queue in front of the Daily slot
is still the gate that decides what becomes one.

**The post title is filtered too.** It is optional and defaults to the question, it is
held to the same content rules and to none of the rules about being a question, and it is
the half of a submission the feed shows — a title field that skipped the filter would be
an unfiltered path to a real post made under the player's own account.

The one length still enforced anywhere is `TITLE_MAX_LENGTH` (300), and only because
Reddit enforces it: a longer title is a post Reddit refuses to create. A title typed past
it is refused with a reason, because the player wrote it and can shorten it; a *question*
past it is cut to fit by `fitTitle` when it falls back into the title slot, because that
is not a title anybody wrote and refusing it would be refusing a question for the length
of a field the player was told was optional. `dailyTitle` uses the same function, so there
is one answer to "too long for Reddit".

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
  holds more of them than it has dots. Each takes a 2×2 block dropped somewhere in its
  camp — scattered, not lined up at the front, which would read as a cast standing in
  front of an audience — with the pack flowing around them. The scatter is seeded like
  everything else in the crowd, so it holds still across renders. They travel on the same
  clock as everyone else and never take the top-left cell, which is yours. Tap or hover one
  for a name; the caption slot under the crowd is where it goes

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
| Ask a question | write one for the subreddit and post it |
| Your record | streak, best, points, coins, the way into the ledger, questions answered, read rate, and whether other players see your blob |
| Wardrobe | your blob, your balance, the items you own, and the gift box |
| Leaderboard | who has banked the most points, weekly or all time |

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

**The balance is the middle counter in the header**, between the streak that pays it and
the points it is not, and it is read again in full in Your record and in the wardrobe where
it is spent. Colour keeps the three apart and each colour means one thing: `--sun` is the
streak and only while it is alive, orange is coins everywhere they are counted, and the
points take no accent at all, which is what leaves the other two legible.

That row is the one part of the app with no slack in it — a lockup and three counters, all
as wide as their own contents, in a line that cannot wrap or scroll — so it is sized
against the width it is handed rather than at one size with a breakpoint under it. The
counters and the lockup are `clamp`ed from a floor that fits four figures in a 320px post
up to the sizes they have always been, reached around 430px. A breakpoint fits the width
you tested and clips the last counter at the next one.

Because the header is on screen while things are being paid for, anything that moves a
balance hands the new one back on its own response: `POST /api/comment` answers with the
balance after paying, and the share slide passes it up to the header rather than leaving
it on the number the post loaded with. The menu does the same from below — a box opened in
the wardrobe, or the ledger's own read, both write into the one balance the menu's header
shows.

**Where a payout is explained is a sheet, not a room.** The coins tile in Your record
carries a small block — `where from` — standing in the well beside the balance, and
pressing it lays the ledger over the whole menu, closed by the X in its corner or by
pressing the felt around it. It is inside that tile because where a coin came from is a
question about that number and no other, and it shares the balance's line so the tile is no
taller than the three beside it and the grid does not move. It is a sheet rather than a block on the
page because the room it opens from is a page of totals the player already knew, and this
is the one thing in the menu telling them something they did not: it earns covering the
screen by being asked for, and the room underneath gives up no height for a table nobody
has opened. Each line is in the words of what you did — `8 upvotes on your comment`, not a
constant. When it is empty it renders the ways to earn instead, because a new player's
ledger has nothing in it and an empty sheet is a worse first impression than no sheet. Both
tables read their numbers from `shared/config.ts`, so neither can drift from what the game
actually pays.

An orange dot on the **Your record** row of the menu, on the chip inside the coins tile,
and on the reveal's **Menu** button says something has been paid since the ledger was last
opened. It
is `stats.unseenEarnings`, derived from two counters on the user hash inside a read every
screen was already making — so the dot costs no round trip anywhere, and opening the ledger
is what puts it out.

**The incentive is stated on the control that pays it.** `Ask a question` in the menu list,
`Post it` in the ask room and `Post comment` on the share slide each carry a
`(+10 Coins)` / `(+5 Coins)` tag in their own colour — the deep orange coins already use on
a cream block, the dark ink on an orange one, where that orange would be invisible. Neither
is a new accent, and both are bracketed numbers as well as a colour, so nothing rests on
colour alone. No fine print under a button says what the button says.

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

**Ask a question leads the list, and it is the only room that cannot be undone.** It is
first because it is the only entry that adds anything to the subreddit — the three below
it read back what has already happened — and because it is the one thing worth putting in
front of somebody who has just landed on the pinned menu post. What guards an irreversible
control is not its position in a list: the panel itself is the confirmation, nothing
submits on blur or on the last keystroke, and one primary button is the only thing that
posts.

It is built to ask for as little as it can. The two answers arrive as Yes/No, the title
defaults to the question and the preview shows what will actually be posted, and every
field is one line. **The room fits the card without scrolling**, at the same 512px the
wardrobe is measured against, which is what the single-line fields buy: a box that scrolls
sideways holds a question of any length in one row, where a box that grows downward
reflows the room on the keystroke that wraps and moves the button out from under a thumb
already reaching for it. Only the title carries a counter, because it is the only field
with a limit left.

Every rule it checks is re-run on the server, which is the actual gate; the client's copy
is there to say why the button is dark. A signed-out visitor sees the room and why it is
inert rather than not seeing it, which matters most on the pinned menu post. That is what
`canSubmit` on the state response is for — one boolean about the viewer, carrying no count
and nothing about anybody else.

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

Nothing here is a leak, including the Daily pointer. The counters are the player's own,
the player board is points totalled across every question a player ever answered — an
aggregate that narrows down nobody's answer to anything — and `/api/daily` returns a state
and a permalink: `voted` is a boolean about *you*, never a count. `canSubmit` is the same
kind of boolean. The menu never touches a live tally, which is what makes it safe to hand
out on its own, below.

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

### Wiping a player

**Outlier: wipe a player** (mod menu) erases one account by username. It is the only
destructive tool in the app, so the form opens on **Preview**, which reads everything and
writes nothing: the first pass answers *is this the right account, and is this what you
think it is* — `u/name · 1240 points · 300 coins · 47 votes · 12 items` — and deleting is
a second, deliberate pass. Mod-checked on the form endpoint as well as on the menu item.

It reaches all three shapes player data comes in. `user:`, `earn:`, `inv:`, `sub:recent:`
and `sub:count:` are wholly theirs and are deleted outright. Their row goes from
`avatars`, `users:names`, `lb:points:all`, the live weekly boards, and the
`comments:tracked`/`comments:paid` pair — that last one is what stops the hourly sweep
paying an account that no longer exists. And their vote comes off every question they
answered: `voted:`, `guesses:`, `recent:` and `commented:`.

**The counters are reversed, not left behind.** `voted:{questionId}` stores `"a:45:21"` —
choice, guess, and the error the points were paid on — which are exactly the three values
`tallyVote` and `finishVote` moved. So undoing a vote is subtraction rather than
re-derivation: `a`/`b`, `guessSum`, `guessCount`, `errSum`, and the histogram bucket read
back through the same `bucketFor` the write used. `stats:misjudged` is recomputed from
what survives, and a question whose last vote just left comes off it rather than being
ranked on a division by zero. A vote from before points existed has no banked error, so
its count comes down and its `errSum` cannot — the one approximate corner, and the reason
the average is recomputed rather than left standing on a count that moved under it.

**Finding the questions.** Devvit's Redis has no `SCAN`, and `voted:` is keyed by question
rather than by player, so there is no key to derive from a userId. The walk goes over an
index instead: `stats:misjudged` holds every question that has ever been voted on —
`finishVote` writes it on every vote — unioned with both queues, which add the questions
submitted but not yet answered. `WIPE_SCAN_BATCH` questions per wave, two reads each,
batched through the same `chunk` the push fan-out uses.

**It is safe to run twice**, and running it again is the right answer to a run that fell
over halfway. `hDel(voted:{questionId}, [userId])` is the claim — the exact mirror of the
`hSetNX` that recorded the vote — and the counters move only when it reports a row
actually removed, so two runs decrement once between them. The row is deleted *before* the
counters move, which is the safe direction: an interrupted run leaves a tally counting a
vote by nobody, where the other order can be interrupted into a tally decremented twice
with nothing left to detect it.

**What it deliberately does not touch.** The Reddit posts and comments the player made are
theirs, made under their own account (`runAs: 'USER'`), and Reddit is where they are
deleted. What goes is the byline this app stores — `authorId` and `authorName` on
`q:{id}` — so the question renders with no author, the way a house question does. The
question record itself stays: it is a live post other people have answered, and deleting
it would orphan the post.

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
