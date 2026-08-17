# Incentives — implementation spec

Five features, one shared surface. Written against the code as it stands and using
its own idioms — pure rules in `src/shared/`, Redis-facing logic in
`src/server/core/`, one concern per file, copy beside the id it belongs to.

| # | Feature | Pays | When |
|---|---|---|---|
| F1 | Comment coins | 5, per question commented on, uncapped per day | Immediately |
| F2 | Comment upvotes | 1 per upvote, capped at 10 per comment | Hourly sweep, 48h window |
| F3 | Question royalties | 1 per 100 votes, capped at 25 per question | On the hundredth vote |
| F4 | Join the subreddit | 1 free box roll, once per account | Immediately |
| F5 | Earnings ledger | — | The surface that makes F2 and F3 visible at all |

F1, F4 and F5 are independent. F2 and F3 are only worth building because F5 exists:
a payout the player never sees is not an incentive.

---

## 0. Constants

All of these go in `src/shared/config.ts`, in the coin-economy block, in this order.

```ts
/** Posting the generated comment. One per question, uncapped per day. */
export const COINS_COMMENT = 5;

/**
 * What a comment's upvotes pay, and the ceiling on one comment.
 *
 * The cap is what keeps a comment that reaches r/all from being worth more than
 * a fortnight of playing. `COMMENT_TRACK_HOURS` is how long a comment keeps
 * accruing: almost every upvote a Reddit comment will ever get arrives in the
 * first day, and tracking forever would mean an unbounded set of comments to
 * re-read on every sweep.
 */
export const COINS_PER_COMMENT_UPVOTE = 1;
export const COMMENT_UPVOTE_COIN_CAP = 10;
export const COMMENT_TRACK_HOURS = 48;

/** Comments re-read per sweep run, newest first. See `core/commentRewards.ts`. */
export const COMMENT_SWEEP_BATCH = 100;

/**
 * What a question pays its author for being played, and the ceiling per
 * question.
 *
 * The cap binds at 2,500 answers, which no question has yet reached — it is
 * there so that an old Daily cannot pay its author forever as the archive stays
 * playable, not to refuse anybody anything they are likely to earn.
 */
export const ROYALTY_VOTES_PER_COIN = 100;
export const ROYALTY_COIN_CAP = 25;

/** What joining the subreddit grants, once per account, ever. */
export const JOIN_FREE_ROLLS = 1;

/** Reveals a player must have seen before the join offer appears on one. */
export const JOIN_OFFER_MIN_PLAYS = 2;

/** Entries kept in a player's earnings ledger. A receipt, not a history. */
export const EARNINGS_LOG_SIZE = 8;
```

---

## 1. Redis: new keys and new fields

### New fields on `user:{userId}`

Added to `userFields` in `core/keys.ts`, since every one of them is written from
more than one file.

```ts
export const userFields = {
  // ...existing...

  /** Boxes owed to this player that cost nothing. Spent before coins are. */
  freeRolls: 'freeRolls',

  /**
   * `"1" | "0"` — the join offer, in the `showBlob` idiom.
   *
   * Absent means never offered and never granted; `"1"` means the free roll has
   * been handed out; `"0"` means they were offered it and said no. Three states
   * on one field, and the `hSetNX` that grants it is the same atomic claim
   * `voted:` uses — two taps racing each other can only produce one free roll.
   */
  joined: 'joined',

  /**
   * Two counters, and the whole unseen-earnings marker.
   *
   * `earnSeq` increments on every coin event; `earnSeen` is set to it when the
   * ledger is opened. Unseen is `earnSeq > earnSeen`, which `projectStats` can
   * answer out of the `hGetAll` it was already making — so the dot on the menu
   * costs no read anywhere.
   */
  earnSeq: 'earnSeq',
  earnSeen: 'earnSeen',
} as const;
```

### New keys

```ts
/**
 * zset: encoded earning -> when it landed. The player's last
 * `EARNINGS_LOG_SIZE` coin events, trimmed on write.
 *
 * A window, not a history — the same shape and the same reasoning as
 * `recent:{questionId}`. Its job is to answer "where did that come from",
 * which is a question about the last few days and never about the last year.
 *
 * Devvit's Redis has no list commands, which is why this is a zset and not the
 * capped list it would otherwise be.
 */
earnings: (userId: string) => `earn:${userId}`,

/**
 * zset: `"{userId}:{commentId}"` -> posted at, in ms.
 *
 * Every comment still inside its accrual window. Entries leave on their final
 * settle, or the moment one hits `COMMENT_UPVOTE_COIN_CAP` — a comment that can
 * earn nothing more is a Reddit API call per sweep for no reason.
 */
commentsTracked: 'comments:tracked',

/**
 * hash: commentId -> coins already paid for its upvotes.
 *
 * The watermark, and the reason a partial or a missed sweep is safe: every
 * settle pays the difference between what is owed now and what has been paid,
 * so a run that skips a comment costs it latency and never money. Deleted with
 * the tracking entry.
 */
commentsPaid: 'comments:paid',
```

`royalty:` has no key, deliberately — see F3.

---

## 2. `src/shared/coins.ts` — the pure rules

Everything a test can reach without Redis goes here, beside `submissionAward`
and `duplicateRefund`.

```ts
/**
 * What a comment's upvotes owe, in total, given its current score.
 *
 * Reddit scores a comment 1 on submission — that is the author's own automatic
 * upvote and is not an endorsement by anybody. Subtracting it is what makes
 * "+3" mean three people rather than two people and yourself.
 *
 * Total owed rather than an increment, so the caller pays the difference from
 * the watermark. The clamp at zero matters: a comment that is downvoted below
 * its own upvote owes nothing, and nothing is ever taken back.
 */
export function commentUpvoteOwed(score: number): number {
  const upvotes = Math.max(0, score - 1);
  return Math.min(upvotes * COINS_PER_COMMENT_UPVOTE, COMMENT_UPVOTE_COIN_CAP);
}

/** What is still to pay, given what has been. Never negative. */
export function commentUpvoteDue(score: number, paid: number): number {
  return Math.max(0, commentUpvoteOwed(score) - paid);
}

/** A comment at the ceiling stops being worth an API call. */
export function commentIsSettled(paid: number): boolean {
  return paid >= COMMENT_UPVOTE_COIN_CAP;
}

/**
 * What the vote that took a question to `voteCount` answers owes its author.
 *
 * Keyed on the count *this vote produced* rather than on a running total, which
 * is what removes the need for a watermark: `hIncrBy` hands back a different
 * number to every vote, so exactly one vote in the app's history ever observes
 * each multiple of a hundred. No second key, no read-then-write, and no way for
 * two votes landing together to both pay the same coin.
 */
export function royaltyFor(voteCount: number): number {
  if (voteCount % ROYALTY_VOTES_PER_COIN !== 0) return 0;
  if (voteCount > ROYALTY_VOTES_PER_COIN * ROYALTY_COIN_CAP) return 0;
  return 1;
}
```

---

## 3. `src/shared/earnings.ts` — the ledger's copy and encoding

New file. Same job `badges.ts` and `points.ts` do: an id, its words, and nothing else.

```ts
export type EarnReason =
  | 'daily'      // first vote of the day
  | 'streak'     // every seventh consecutive day
  | 'submission' // a question posted
  | 'promotion'  // a question taking the Daily slot
  | 'comment'    // the generated comment, posted
  | 'upvotes'    // that comment, upvoted
  | 'royalty'    // somebody answered a question you wrote
  | 'join';      // the free roll, which pays a roll and not coins

export type Earning = {
  reason: EarnReason;
  /** Coins. Zero for `join`, which pays in rolls. */
  coins: number;
  at: number;
  /** One number the line needs — the upvote count, the vote count. Optional. */
  detail: number;
};

/**
 * What each line says.
 *
 * Written as a sentence about what *you* did, not as a transaction record: the
 * ledger is read by somebody asking "where did that come from", and "8 upvotes
 * on your comment" answers it where "COMMENT_UPVOTE_BONUS" does not.
 */
export const EARN_COPY: Record<EarnReason, (detail: number) => string> = {
  daily: () => 'turned up today',
  streak: (days) => `${days} days in a row`,
  submission: () => 'asked a question',
  promotion: () => 'your question became the Daily',
  comment: () => 'posted your comment',
  upvotes: (votes) => `${votes} ${votes === 1 ? 'upvote' : 'upvotes'} on your comment`,
  royalty: (votes) => `${votes} people answered your question`,
  join: () => 'joined the subreddit',
};

/**
 * `"1739..:upvotes:8:12"` — at, reason, coins, detail.
 *
 * Encoded rather than JSON for the same reason `encodeVote` is: this is a zset
 * member, it is written on paths that are already doing work, and a colon-joined
 * quadruple is both smaller and easier to eyeball in redis-cli. A decode that
 * fails returns null and the entry is skipped, so a format change never breaks
 * a screen.
 */
export function encodeEarning(e: Earning): string;
export function decodeEarning(raw: string): Earning | null;
```

The `at` in the member is what keeps members unique: two earnings of the same
reason in the same millisecond are not reachable, because every reason is behind
a once-per-question or once-per-day guard.

---

## 4. `src/server/core/earnings.ts` — the ledger's writer

New file.

```ts
/**
 * One place that records a coin event, and the only thing any of the earns
 * below have in common.
 *
 * It is deliberately not the thing that pays: `creditCoins` moves the balance
 * and this records why. Keeping them apart means a payment that succeeds and a
 * log line that fails costs a receipt rather than the coins, which is the right
 * way round — and it means the ledger can be added to a path without that path
 * learning anything about zsets.
 *
 * `earnSeq` is bumped in the same breath, because the marker on the menu is
 * "something arrived since you last looked" and this is where something
 * arrives.
 */
export async function logEarning(
  userId: string,
  reason: EarnReason,
  coins: number,
  detail = 0
): Promise<void> {
  const key = keys.earnings(userId);
  const at = Date.now();

  await redis.zAdd(key, { member: encodeEarning({ reason, coins, at, detail }), score: at });
  // Trim after the add, never beside it — racing them can leave the window one
  // entry over the cap. The same reasoning as `rememberVoter`.
  await redis.zRemRangeByRank(key, 0, -(EARNINGS_LOG_SIZE + 1));
  await redis.hIncrBy(keys.user(userId), userFields.earnSeq, 1);
}

/** Newest first. Undecodable entries are dropped rather than thrown over. */
export async function readEarnings(userId: string): Promise<Earning[]>;

/** Called when the ledger is rendered. Sets `earnSeen` to `earnSeq`. */
export async function markEarningsSeen(userId: string): Promise<void>;
```

**Backfill the four existing earns.** `advance()`'s daily and streak awards, the
submission award and the promotion award all currently pay silently. Each gets a
`logEarning` call at its existing payment site — `recordPlay` in `core/users.ts`
(where `next.coinsEarned > 0` is already a branch), `awardSubmissionCoins` in
`core/coins.ts`, and `postDaily` in `core/daily.ts`. Without this the ledger opens
mostly empty and reads as broken.

`advance()` stays pure. It already returns `coinsEarned`; splitting the daily 5
from the streak 20 for two ledger lines means returning the pair rather than the
sum — change `coinsForNewDay(streak)` to return `{ daily, streak }` and have
`advance` sum it for `coins`. One test moves.

---

## F1 — Comment coins

**Rule.** Posting the generated comment pays `COINS_COMMENT` (5). One payment per
question, no daily cap, no note required.

### The one correctness fix it needs first

`POST /api/comment` currently guards on `reveal.commented`, which is a read of
`commented:{questionId}` taken several awaits before `recordComment` writes to it.
That is fine when the only cost of a double post is a duplicate comment Reddit
would reject anyway. It is not fine once it pays: two taps racing each other both
read "not commented", both post, both get paid.

Make the claim atomic, in `core/votes.ts`:

```ts
/**
 * Claim this player's comment slot on this question.
 *
 * `hSetNX` rather than `hSet`, for the same reason `voted:` uses it: this is now
 * a guard in front of a payment, and a read-then-write guard in front of a
 * payment is a double payment waiting for two taps. Answers `true` if the claim
 * was won.
 *
 * The claim goes in before the Reddit call and is written over with the real
 * comment id after, so a submit that throws leaves a claimed slot pointing at
 * nothing. That is the safe direction: the player retries and is refused, which
 * costs them a comment they can post themselves, where the other direction
 * costs the app a second payment.
 */
export async function claimComment(questionId: string, userId: string): Promise<boolean> {
  if (REPLAY_MODE) return true;
  return (await redis.hSetNX(keys.commented(questionId), userId, 'pending')) === 1;
}
```

### The route

In `POST /api/comment`, replacing the `reveal.commented` check:

```ts
if (!(await claimComment(questionId, userId))) {
  return c.json<ApiError>({ error: 'You have already posted this one.' }, 409);
}

const comment = await reddit.submitComment({ ... });
await recordComment(questionId, userId, comment.id);

// Track before paying. A tracked comment that was not paid for is a comment
// that earns its upvote bonus anyway; a paid comment that was not tracked
// silently never earns one.
await trackComment(userId, comment.id);

const coins = await creditCoins(userId, COINS_COMMENT);
await logEarning(userId, 'comment', COINS_COMMENT);

return c.json<CommentResponse>({
  ok: true,
  permalink: comment.permalink,
  earned: COINS_COMMENT,
  coins,
});
```

`CommentResponse` in `shared/types.ts` gains `earned: number` and `coins: number`.
The client needs both to render the receipt without a second fetch.

### Under REPLAY_MODE

`claimComment` short-circuits, so comment coins inflate in a dev subreddit exactly
the way submission coins already do. Consistent, expected, and worth one line in
the README's replay section.

### Known trade-off, recorded on purpose

Uncapped means a player answering the Daily plus three open questions banks 20
coins a day from commenting alone — more than two and a half times what turning
up pays, and it makes commenting the fastest earn in the game. Two things bound
what that does to the thread: `commented:{questionId}` still allows only one
comment per question, and `SUBMISSIONS_PER_DAY` (3) bounds how many new questions
exist to comment on. So the ceiling is roughly "the Daily plus whatever was posted
today", not unbounded — but the expected outcome is still that most players comment
on most questions, and the thread under a Daily becomes mostly generated text.

If that turns out badly, the smallest correction that does not change the rule is
to make `buildComment` say less and the note field say more. The next smallest is
a daily cap, for which `awardSubmissionCoins`'s `subDay`/`subCount` pattern is a
drop-in. Neither is in this spec.

---

## F2 — Comment upvotes

**Rule.** 1 coin per upvote, capped at 10 per comment, accruing for 48 hours from
posting.

### `src/server/core/commentRewards.ts`

New file.

```ts
/** Put a comment into the accrual window. Called once, from the comment route. */
export async function trackComment(userId: string, commentId: string): Promise<void> {
  await redis.zAdd(keys.commentsTracked, {
    member: `${userId}:${commentId}`,
    score: Date.now(),
  });
}

/**
 * Pay a comment the difference between what its upvotes owe and what it has
 * been paid. Answers what was paid, and whether the entry is done.
 */
async function settle(userId: string, commentId: string): Promise<{ paid: number; done: boolean }> {
  const comment = await reddit.getCommentById(commentId as T1);
  const alreadyPaid = Number(await redis.hGet(keys.commentsPaid, commentId)) || 0;
  const due = commentUpvoteDue(comment.score, alreadyPaid);

  if (due > 0) {
    const total = alreadyPaid + due;
    await redis.hSet(keys.commentsPaid, { [commentId]: String(total) });
    await creditCoins(userId, due);
    await logEarning(userId, 'upvotes', due, Math.max(0, comment.score - 1));
    return { paid: due, done: commentIsSettled(total) };
  }

  return { paid: 0, done: commentIsSettled(alreadyPaid) };
}

/** Stop tracking, and forget the watermark with it. */
async function drop(member: string, commentId: string): Promise<void> {
  await redis.zRem(keys.commentsTracked, [member]);
  await redis.hDel(keys.commentsPaid, [commentId]);
}
```

### The sweep

```ts
/**
 * Two passes, and they are not the same pass.
 *
 * **Expiring** is everything past the window. Each gets one last settle and is
 * then dropped, so a comment that gained its upvotes on the second day is still
 * paid for them before it leaves.
 *
 * **Fresh** is the newest `COMMENT_SWEEP_BATCH` inside the window, because that
 * is where upvotes actually arrive — a Reddit comment gets most of its score in
 * the first few hours. A comment in the middle that is missed by this pass is
 * not missed by the expiring one.
 *
 * The batch is what makes a busy subreddit affordable: this reads one comment
 * per Reddit API call, and a Daily with four hundred comments is four hundred
 * calls if nothing bounds it. The watermark in `comments:paid` is what makes
 * bounding it safe — every settle pays the difference, so a skipped run costs a
 * player an hour of latency and never a coin.
 *
 * Failures on individual comments are swallowed, the way `refresh-queue`
 * swallows a deleted post: one removed comment must not cost the whole run.
 */
export async function sweepCommentRewards(now = Date.now()): Promise<{ paid: number; settled: number }> {
  const cutoff = now - COMMENT_TRACK_HOURS * 60 * 60 * 1000;

  const expiring = await redis.zRange(keys.commentsTracked, 0, cutoff, { by: 'score' });
  const fresh = await redis.zRange(keys.commentsTracked, cutoff, now, {
    by: 'score',
    reverse: true,
    limit: { offset: 0, count: COMMENT_SWEEP_BATCH },
  });

  // ...for each: split the member on ':', settle, drop if expiring or done...
}
```

Member split: the member is `${userId}:${commentId}` and both halves are Reddit
`t2_`/`t1_` ids containing no colon, so `indexOf(':')` is unambiguous.

### The task

`src/server/routes/tasks.ts`:

```ts
taskRoutes.post('/internal/tasks/sweep-comments', async (c) => {
  const result = await sweepCommentRewards();
  console.log(`sweep-comments: paid ${result.paid} coins, settled ${result.settled}`);
  return c.json({});
});
```

`devvit.json`, beside `refresh-queue`:

```json
"sweep-comments": {
  "endpoint": "/internal/tasks/sweep-comments",
  "cron": "0 * * * *"
}
```

Its own task rather than a second half of `refresh-queue`: they touch different
data, and a throw in one must not take the other's run with it.

### What is deliberately not built

No claw-back. `commentUpvoteDue` clamps at zero, so a comment downvoted after
payment keeps what it earned. Taking coins back for something the player did not
do is worse than paying a few coins for a comment that later fell.

---

## F3 — Question royalties

**Rule.** 1 coin per 100 answers, to the question's author, capped at 25 coins.

This is the cheapest of the five, because `tallyVote` already increments the
number the rule is keyed on.

### `core/votes.ts`

`tallyVote` currently discards its increments' return values. Capture `guessCount`:

```ts
/**
 * The counters every vote moves — and the sequence number one of them hands
 * back.
 *
 * `guessCount` after this vote is a number no other vote will ever see, which
 * is what makes the royalty exact without a watermark: exactly one vote in a
 * question's life observes each multiple of a hundred, so exactly one vote pays
 * each coin, however many are landing at once.
 */
async function tallyVote(questionId: string, choice: Choice, guess: number): Promise<number> {
  const [, , count] = await Promise.all([
    redis.hIncrBy(keys.votes(questionId), choice === 'a' ? voteFields.a : voteFields.b, 1),
    redis.hIncrBy(keys.votes(questionId), voteFields.guessSum, guess),
    redis.hIncrBy(keys.votes(questionId), voteFields.guessCount, 1),
    redis.hIncrBy(keys.histogram(questionId), String(bucketFor(guess)), 1),
  ]);
  return count;
}
```

`castVote` returns the count on its `ok` result: `CastResult` gains `voteCount: number`.

### The payment

In `POST /api/vote`, after `recordPlay`, where the question record — and therefore
`authorId` — is already in hand and costs no extra read:

```ts
// Paid to the author of the question, not to the player who answered it. A
// house question has no author, and `creditCoins` treats an empty id as
// nobody to pay rather than as an error.
const royalty = royaltyFor(result.voteCount);
if (royalty > 0 && question.authorId) {
  await creditCoins(question.authorId, royalty);
  await logEarning(question.authorId, 'royalty', royalty, result.voteCount);
}
```

Three things this deliberately does not do:

- **It does not exclude the author's own vote.** Self-farming costs a hundred
  distinct accounts per coin, and `voted:` already allows one vote each. Filtering
  would be a read to defend nothing.
- **It does not notify.** The ledger is the notification. See F5.
- **It does not stop at any age.** The cap is by total, not by date. An old Daily
  keeps paying until it has paid 25, which at a hundred votes a coin is a question
  2,500 people answered.

### Under REPLAY_MODE

`tallyVote` runs on the replay branch too, so royalties inflate in dev — same as
submission coins, and for the same reason. One more line in the README's list.

---

## F4 — Join the subreddit for a free roll

**Rule.** One tap subscribes and grants one free box roll. Once per account, ever.

### Platform facts that shape it

`reddit.subscribeToCurrentSubreddit()` runs as the user and is a no-op if they are
already subscribed. It needs `SUBSCRIBE_TO_SUBREDDIT` added to
`permissions.reddit.asUser` in `devvit.json`:

```json
"asUser": ["SUBMIT_COMMENT", "SUBMIT_POST", "SUBSCRIBE_TO_SUBREDDIT"]
```

Devvit does **not** expose subscription state — a user's subscribed subreddits are
private data, and the call returns `void`. So there is no way to check, no way to
detect an unsubscribe afterwards, and already-subscribed players will claim the
grant. All three are handled by the grant being one-time and tracked locally,
which is the only bound available, and by the copy framing it as a welcome rather
than as a bounty.

### `POST /api/join`

```ts
api.post('/api/join', async (c) => {
  const userId = context.userId;
  if (!userId) return c.json<ApiError>({ error: 'Sign in first.' }, 401);

  // Claim before subscribing. `hSetNX` is the whole guard: two taps racing each
  // other produce one winner, and the loser still gets subscribed — which is
  // what they asked for — and no second roll.
  const claimed = (await redis.hSetNX(keys.user(userId), userFields.joined, '1')) === 1;

  await reddit.subscribeToCurrentSubreddit();

  if (!claimed) return c.json<JoinResponse>({ joined: true, granted: false, freeRolls: ... });

  const freeRolls = await redis.hIncrBy(keys.user(userId), userFields.freeRolls, JOIN_FREE_ROLLS);
  await logEarning(userId, 'join', 0);
  return c.json<JoinResponse>({ joined: true, granted: true, freeRolls });
});
```

A decline writes `'0'` to the same field, from `POST /api/join/decline` or a
`{ decline: true }` body — one field, three states, exactly the `showBlob` idiom.
Declining blocks the offer from firing on a future reveal but does **not** block a
later claim, because the row in Your record (below) stays until `joined === '1'`.

### The free roll in `core/boxes.ts`

One branch inside the existing `watch`, so a free roll is as atomic as a paid one:

```ts
const raw = await redis.hMGet(key, [userFields.coins, userFields.pity, userFields.freeRolls]);
const coins = Number(raw[0] ?? 0) || 0;
const pity = Number(raw[1] ?? 0) || 0;
const freeRolls = Number(raw[2] ?? 0) || 0;

const free = freeRolls > 0;
if (!free && coins < BOX_PRICE) { await txn.unwatch(); return { status: 'poor', coins }; }

// A free roll refunds nothing on a duplicate. The refund exists so that a
// player deep into the catalogue is not spending 30 coins for nothing — a roll
// that cost nothing has nothing to be made whole for, and paying 12 coins out
// of a box that took none in is a faucet rather than a refund.
const refunded = result.duplicate && !free ? duplicateRefund() : 0;
const balance = free ? coins : coins - BOX_PRICE + refunded;

await txn.hSet(key, {
  [userFields.coins]: String(balance),
  [userFields.pity]: String(result.pity),
  ...(free ? { [userFields.freeRolls]: String(freeRolls - 1) } : {}),
});
```

A free roll advances `pity` like any other, because `roll()` is the one path and a
roll that did not count would be a hole in the pity guarantee.

`BoxOutcome` and `BoxResponse` gain `free: boolean` so the wardrobe can say which
kind it was. `AvatarResponse` gains `freeRolls: number` and `joined: boolean`.

---

## F5 — The earnings ledger

The surface without which F2 and F3 are invisible, and the reason to open the menu.

### `GET /api/earnings`

Returns `{ entries: Earning[], coins: number }`, newest first, and calls
`markEarningsSeen` as a side effect of rendering — reading the ledger is what
"seen" means, and a separate acknowledge endpoint would be a second round trip to
say what the first one already said.

Only the record room calls it, so it is a fetch on entering that room and not part
of `/api/state`.

### `PlayerStats` gains one field

```ts
/**
 * Something has been paid since this player last opened their record.
 *
 * A boolean rather than a count: the marker is a dot, and a dot does not need a
 * number. It is derived from two fields on the user hash, so `projectStats`
 * answers it out of the `hGetAll` it was already making — the dot costs no
 * read on the vote path, the state path, or anywhere else.
 */
unseenEarnings: boolean;
```

---

## 6. The UI

Three rules the existing screens are built on, which every addition below obeys:

- **A well is inert and holds something already banked. A block is being handed to
  you.** So a balance sits in a well; a payout arriving sits in a block.
- **Coins are not in the header.** The header shows the streak and the points. The
  two places coins appear are Your record and the wardrobe.
- **Colour is semantic and no screen shows more than two accents.** Coins keep the
  orange they already have in `record` and in `BoxResult`. Nothing here introduces
  a colour.

### Where each incentive is stated *before* the action

An incentive nobody knows about is not one. Every earn gets a line at the point of
decision, and none of them is a new screen.

**The comment.** `Compose`'s foot row currently reads `posts to the thread` on the
left and the character count on the right. The left becomes **`+5 coins`**. It is
the one place the player is deciding whether to post, it costs no layout, and it is
four characters wider than what was there.

**The question.** The Ask room's submit button gains the same treatment in its hint
slot — `+10 coins, and 30 more if it becomes the Daily`. The room already has a
`Field` hint mechanism and a height budget; this is one line, on the room's fine
print, not a fifth row.

**Everything else** lives in the ways-to-earn table, below.

### Where each payout is stated *after*

**The comment — in place, in the well it already fills.** `Compose` currently
replaces the preview with `Posted to the thread.` It becomes:

```
Posted to the thread. +5 coins.
```

No new element, no layout change, and the block under it still goes flat as the
whole receipt. If the response's `earned` is 0 — a re-post, a replay subreddit —
the sentence is the old one, unchanged.

**The free roll — in the wardrobe's gift box, which is already two rows in every
state.** With `freeRolls > 0` the price line reads `1 free roll` instead of the
price, and the button reads **`Open — free`**. `BoxResult` gains nothing: a free
roll's result renders exactly like a paid one, minus the refund line it cannot
have.

**Everything deferred — the ledger.**

### The ledger, in Your record

A block below the four figures and above `record__read`. One heading, up to eight
rows, each row a reason on the left and an amount on the right:

```
┌─ what you have earned ─────────────────┐
│ 8 upvotes on your comment        +8    │
│ 300 people answered your question +3   │
│ posted your comment              +5    │
│ turned up today                  +5    │
│ 7 days in a row                 +20    │
└────────────────────────────────────────┘
```

It is a **block, not a well**, and that is the one deliberate exception to the
rule above: everything else on that page is a total the player already knew, and
this is the page telling them something they did not. Rows are `DM Mono` for the
amount and body for the reason, matching the wardrobe's item meta line.

**When it is empty it is the teaching surface instead.** A new player's ledger has
nothing in it, and an empty box is a worse first impression than no box. So the same
block, in its empty state, renders the ways to earn:

```
┌─ ways to earn ─────────────────────────┐
│ turn up                          +5    │
│ every seventh day in a row      +20    │
│ post your comment                +5    │
│ upvotes on it            up to +10     │
│ ask a question                  +10    │
│ ...it becomes the Daily         +30    │
│ ...every 100 people answer it    +1    │
└────────────────────────────────────────┘
```

One block, two states, no extra room, and it teaches at exactly the moment
teaching is worth anything — mirroring the `Nothing to show yet` branch
`record__read` already has. Both tables read their numbers from `shared/config.ts`,
so neither can drift from what the game actually pays.

### The unseen marker

A 6px dot, in `--sun`... **no** — `--sun` is the streak and nothing else. Use the
same orange coins already carry.

Two places:

- The menu list's **Your record** row, as a dot after the label.
- The reveal's **Menu** button on slide 3, same dot.

Both read `stats.unseenEarnings`, which is already on every state response. Opening
the record clears it.

### The join offer

**On slide 1 of the reveal, as a block under the award.** Not slide 0 — that is
where `blobNotice` fires on a first reveal, and two first-run interruptions on one
screen means both are dismissed unread. Not slide 2 — the share slide has exactly
one primary action, and a second one beside it makes a decision into a choice
between decisions. Slide 1 is where the game already hands you something, and the
award block is the idiom a second block below it inherits for free.

**It fires at `stats.totalPlayed >= JOIN_OFFER_MIN_PLAYS`**, not on the first
reveal. A player who has answered twice has shown up on purpose; one who is on
their first reveal is still working out what the game is.

`Reveal` gains `joinOffer: boolean`, computed in `buildReveal` from `totalPlayed`
and the absence of `joined` — the same shape and the same gate `blobNotice` uses.
Copy:

> **Join r/PlayOutlier and take a gift box on us.** One tap, and the box is
> waiting in your wardrobe.
>
> `[ Join and claim ]`   `[ ✕ ]`

The X writes `joined: '0'` and the offer never fires on a reveal again.

**And a permanent row in Your record** while `joined !== '1'`, under the figures —
a single line with the same button. The wardrobe would be the obvious home for it
and is the wrong one: that room is measured to fit 512px without scrolling and has
already given up its fine print to the box. Your record has no height budget.

---

## 7. Tests

Pure, in `tests/`, matching what is already tested there:

- `commentUpvoteOwed` — score 0 and 1 both owe nothing; score 2 owes 1; the cap
  holds at score 200; a negative score owes nothing.
- `commentUpvoteDue` — never negative when a comment falls after payment.
- `royaltyFor` — 0 at 99, 1 at 100, 0 at 101, 1 at 2500, 0 at 2600.
- `encodeEarning`/`decodeEarning` — round trip, and a malformed string decodes to
  null rather than throwing.
- `coinsForNewDay` — the existing test, updated for the `{ daily, streak }` split.

And one assertion in `tests/streaks.test.ts` alongside the existing "nothing in the
economy touches points": **nothing in this spec touches `points` either.** Every
new earn is coins. The leaderboard is unaffected by all five features, which is the
property that keeps it a ranking of who reads the room rather than who posts most.

---

## 8. Order to build in

1. **`REPLAY_MODE = false`.** Nothing below can be measured while the dedupe guard
   is off, and three of these five features inflate under it.
2. **F5's plumbing** — `shared/earnings.ts`, `core/earnings.ts`, the `earnSeq`/
   `earnSeen` fields, backfilling `logEarning` into the four existing earns. Ship
   the ledger against the economy that already exists; it is worth having on its
   own and it is what makes the next three legible.
3. **F1** — the `hSetNX` fix first, then the payment, then the two lines of copy in
   `Compose`. Smallest, and immediately felt.
4. **F3** — one captured return value, one `royaltyFor`, one call site.
5. **F4** — the manifest scope, the route, the `boxes.ts` branch, the reveal block.
6. **F2** — the new core file, the new task, the cron entry. Last because it is the
   only one with a scheduled job and an external API call in the loop.

## 9. What to watch after launch

- **Comments per Daily.** If it rises above roughly one per two voters, the thread
  is being written by the incentive rather than by people.
- **Coins earned per active day.** It was ~8. F1 alone roughly doubles it, and the
  box still costs 30. If a box becomes a daily purchase, the fourteen-item
  catalogue is exhausted in a fortnight instead of a season — at which point coins
  buy nothing and every incentive here stops working. That is the failure mode to
  watch for, and the answer to it is a second sink, not a smaller earn.
