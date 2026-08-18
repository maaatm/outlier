# 07 — Push notifications, opt-in

**Depends on:** 01 (the menu), 03 (the `showBlob` switch this is modelled on). **Size:** medium.

Add an opt-in push notification so a player who wants to be told when the Daily
goes up is told, and nobody else is. Two things get sent and nothing else: the
Daily is up, and — to one person — your question is today's Daily.

Read this whole file before writing anything. The house rules in
[`docs/prompts/README.md`](README.md) apply in full; the ones that bite hardest
here are **comments explain why**, **constants live in `src/shared/config.ts`**,
**pure logic is tested and Redis-facing code is not**, and **the invariant**.

---

## The API you are building on

`@devvit/notifications` is already in `node_modules` at 0.14.0 and is re-exported
by `@devvit/web/server` (`export * from '@devvit/notifications'`), so the import
is `import { notifications } from '@devvit/web/server'` alongside the `redis` and
`reddit` this codebase already uses. No new dependency, no `package.json` change.

The surface, from `node_modules/@devvit/notifications/NotificationsClient.d.ts`:

```ts
notifications.optInCurrentUser():  Promise<{ success: boolean; message?: string }>
notifications.optOutCurrentUser(): Promise<{ success: boolean; message?: string }>
notifications.isOptedIn(userId: T2): Promise<boolean>
notifications.listOptedInUsers({ limit?, after? }): Promise<{ userIds: string[]; next?: string }>
notifications.listOptedInUsersIterator({ after? }): AsyncIterableIterator<string>
notifications.enqueue({
  title: string,                 // mustache templating allowed
  body: string,                  // mustache templating allowed
  recipients: { userId: T2; link: T1 | T3; data: Record<string,string> }[],  // max 1000
}): Promise<{ successCount: number; failureCount: number; errors: { userId?: T2; message: string }[] }>
notifications.requestShowGameBadge({ post: T3, expiresAt?: Date }): Promise<{ success: boolean; message?: string }>
notifications.dismissGameBadge(): Promise<{ success: boolean }>
notifications.getGameBadgeStatus(): Promise<{ hasActiveBadge: boolean; expiresAt?: Date }>
```

Four facts about it that shape everything below.

1. **Reddit owns the opt-in ledger, not us.** `optInCurrentUser` and
   `isOptedIn` are the record of truth, and a player can presumably turn the
   thing off somewhere in Reddit's own settings without this app hearing about
   it. So **do not mirror the on/off state into Redis.** A cached copy of a
   boolean somebody else can change is a boolean that will eventually lie, and
   the screen that shows it would be the last to find out.

2. **Opt in and opt out are about the *current* user.** There is no
   `optIn(userId)`. They can only be called from a request that has a user on
   it — an `/api/` route — and never from a scheduler task.

3. **`enqueue` is how you reach everyone, and its recipient list is capped at
   1000.** The fan-out is therefore paged: walk `listOptedInUsersIterator`,
   buffer into batches, enqueue each batch.

4. **The package README says, in as many words, "Experimental… may change
   without notice and should not be used in production."** That is the whole
   reason for step 0 and for the flag in step 1. Build it so that the day the
   API moves, or the app is not on whatever allowlist gates it, Outlier still
   posts a Daily and still renders a menu.

There is **no `notifications` key in the `permissions` block** of
`config-file.v1.json` (checked against the installed schema), so there is
nothing to add to `devvit.json` for this. If step 0 comes back saying the app is
not permitted, that is an allowlist question for Reddit and not a config file
you forgot.

---

## Decisions already made

These were settled before this prompt was written. Do not relitigate them in
code; if you think one is wrong, say so in the summary at the end and implement
it as written.

**Two triggers, and the second one suppresses the first.** The Daily broadcast
goes to everyone opted in. The promotion notice goes to one author. Both fire
from the same `post-daily` run, about the same post, within the same second — so
the author gets the promotion notice **instead of** the broadcast, not as well
as. Two buzzes about one post is how an opt-in becomes an opt-out.

**No streak-at-risk reminder.** It was considered and cut. It needs its own
cron, and it needs `lastPlayedDay` read per opted-in user — an `hGet` each,
across the whole opted-in population, on a schedule. That cost is real and the
benefit is a *second* notification on a day the player has already had one,
which is the fastest way to get the app muted. If it comes back later it comes
back as its own prompt, with its own argument about cost.

**The opt-in lives beside `showBlob` in Your record.** Same room, same `switch`
markup, same optimistic write. It is a setting about you, on the page about you,
next to the only other setting in the game. No new room, no fifth `ENTRIES` row —
a room is a reading, and this is one boolean.

**Off is the default and there is no negotiating it.** `showBlob` ships defaulted
on with a first-run notice; this is the opposite and deliberately so. A crowd
cameo is a drawing inside an app somebody already opened. A push notification is
this app reaching a phone that is in somebody's pocket. Absent consent is *no*.

**We do store one thing: whether they have been asked.** That is ours, not
Reddit's, and it is the third state `showBlob` taught the codebase to want. It
goes on the `user:` hash as `pushAsked`, absent meaning never asked.

**The ask does not fire on somebody's first answer.** `blobNotice` already owns
that moment, and two consent questions on one reveal is a screen that reads as a
permissions wizard. This one waits for a streak of `PUSH_ASK_AFTER_STREAK` (2),
which is both a moment when the offer is honest — you came back, want a nudge? —
and a population worth asking.

---

## Step 0 — Find out whether this works at all, and throw it away

Before any of the code below exists. Add a temporary moderator menu item that
calls `notifications.getGameBadgeStatus()` and
`notifications.listOptedInUsers({ limit: 1 })`, run it on `playoutlier_dev`, and
read the result out of the logs.

You are answering one question: does an experimental plugin call from this app
return, or throw? If it throws, capture the exact error, **stop**, and report it
— the rest of this prompt is not worth building against an API that is not
switched on for this app, and the answer determines whether the flag in step 1
ships `false`.

Delete the menu item and its endpoint before moving on. It is a probe, not a
feature.

---

## Step 1 — Constants and the pure half

### `src/shared/config.ts`

Append a block with a header in the register of the coin-economy block above it.

```ts
/*
 * ── Push notifications ────────────────────────────────────────────────────
 *
 * Opt-in, off by default, and the only part of this game that reaches a
 * player who is not currently looking at it. Reddit holds the opt-in ledger;
 * everything here is about what we do with it once somebody has said yes.
 */

/**
 * The master switch. `@devvit/notifications` ships marked experimental, so
 * this exists to turn the whole feature off without unpicking it: false means
 * the switch never renders, the ask never fires, and nothing is ever enqueued.
 */
export const PUSH_ENABLED = true;   // ship as `false` if step 0 said no

/**
 * The streak at which a player is asked, once, whether they want this.
 *
 * Not their first answer — `blobNotice` has that moment, and two consent
 * questions on one reveal is a permissions wizard. Two days running is the
 * first point at which "want to be told when the next one is up" is a
 * description of what they are already doing rather than a guess.
 */
export const PUSH_ASK_AFTER_STREAK = 2;

/** `enqueue` takes at most this many recipients. Reddit's cap, not a taste call. */
export const PUSH_BATCH_SIZE = 1000;

/**
 * The most recipients one broadcast will walk before it stops and says so.
 *
 * A bound rather than a plan: at fifty batches this is already a scheduler run
 * doing nothing else, and a run that times out halfway leaves an unknown
 * fraction notified. If the subreddit ever gets near this the fan-out needs a
 * resumable cursor, which is a different prompt. Until then the cap logs what
 * it dropped — a silent truncation reads as "everybody got it".
 */
export const PUSH_MAX_RECIPIENTS_PER_RUN = 50_000;

/** How much of a question fits in a notification body before it is trimmed. */
export const PUSH_BODY_MAX_LENGTH = 120;
```

### `src/shared/push.ts` — new, pure, tested

No imports from `@devvit/*`. This is the side of the seam the tests can see.

- `fitPushBody(text: string): string` — trims to `PUSH_BODY_MAX_LENGTH` on a
  word boundary with an ellipsis, the same way `fitTitle` in `validate.ts`
  handles Reddit's 300. Reuse `fitTitle`'s helper if it factors cleanly; do not
  copy its body.
- `dailyPushCopy(questionText: string): { title: string; body: string }` —
  `{ title: "Today's Outlier is up", body: fitPushBody(questionText) }`.
- `promotionPushCopy(questionText: string, coins: number): { title, body }` —
  `{ title: 'Your question is today\'s Outlier', body: `${fitPushBody(questionText)} +${coins} coins.` }`.
- `chunk<T>(items: readonly T[], size: number): T[][]` — batching. Yes it is four
  lines; it is four lines that are wrong in a specific way at `size` 0 and on an
  empty list, and this is the file where that gets pinned down.
- `shouldAskForPush(input: { enabled: boolean; available: boolean; optedIn: boolean; asked: boolean; blobNotice: boolean; streak: number }): boolean` —
  every gate on the first-run ask in one pure predicate, so step 5 is a field
  assignment and not a condition nobody can read. True only when the feature is
  on and available, they are not already opted in, they have not been asked, the
  blob notice is **not** also firing, and `streak >= PUSH_ASK_AFTER_STREAK`.

**No copy contains a count, a percentage, a tally or anything derived from one.**
A notification is delivered to somebody who has not voted on the question it is
about, by definition — it is the thing telling them the question exists. See the
invariant. The question text is public the moment the post is created; nothing
else about that question is.

### `tests/push.test.ts` — new

Cover `chunk` (empty, exact multiple, remainder, size larger than the list, size
of 1), `fitPushBody` (under, exactly at, over, a single word longer than the
limit, and that it never returns something longer than the limit), both copy
builders (that neither ever emits a number that is not the coin award), and
`shouldAskForPush` — one case per gate, each flipping exactly one field.

---

## Step 2 — `src/server/core/keys.ts`

Add one field to `userFields`, with a comment that says what makes it different
from the one above it:

```ts
  /**
   * `"1"` — has this player been asked about push notifications?
   *
   * Deliberately *not* the answer. Reddit holds the opt-in ledger and a player
   * can change it somewhere this app never sees, so a cached copy here would
   * eventually be a boolean that lies on the one screen that shows it. This
   * records only that the question was put to them, which is ours to know and
   * which is what stops the ask firing twice.
   *
   * Unlike `showBlob` above, absent does not mean on. It means never asked
   * *and* not opted in, because the default for reaching somebody's phone is
   * no and a missing field is not consent.
   */
  pushAsked: 'pushAsked',
```

No new `keys` entry. This is one field on a hash that is already read on the
paths that need it.

---

## Step 3 — `src/server/core/push.ts` — new, the seam

Open with a prose header covering: Reddit owns the ledger and we own `pushAsked`;
every function here swallows its own failure; and why the fan-out lives here
rather than in `daily.ts`.

**Nothing in this file may throw.** Every export wraps its plugin calls in
`try`/`catch`, logs with `console.error`, and returns a value that means "no".
That is not defensive habit, it is the specific thing that keeps an experimental
API from costing the subreddit its Daily — see step 6.

```ts
export type PushState = {
  /** The feature is on and the plugin answered. False hides the switch entirely. */
  available: boolean;
  /** Reddit's answer, or false when unavailable. */
  optedIn: boolean;
  /** They have been put the question. Absent `pushAsked` is false. */
  asked: boolean;
};

export async function readPushState(userId: string): Promise<PushState>
export async function setPushOptIn(userId: string, optIn: boolean): Promise<PushState>
export async function markPushAsked(userId: string): Promise<void>
export async function broadcastDaily(postId: string, questionText: string, skipUserId?: string): Promise<void>
export async function notifyPromotedAuthor(authorId: string, postId: string, questionText: string): Promise<void>
```

Notes on each:

- `readPushState` — `PUSH_ENABLED` false short-circuits to
  `{ available: false, optedIn: false, asked: true }`; `asked: true` because a
  feature that is off must not leave a pending question that fires later as a
  surprise. Otherwise `isOptedIn(userId as T2)` and the `pushAsked` `hGet` go
  together in one `Promise.all`. A throw from `isOptedIn` degrades to
  `available: false`.
- `setPushOptIn` — calls `optInCurrentUser` / `optOutCurrentUser`, and writes
  `pushAsked` on **either** answer, for the same reason `setShowBlob` retires
  its notice: being asked and answering no is still having been asked. Returns
  the state the caller should render, built from the plugin's own `success`
  rather than from what was requested — a `success: false` means the switch goes
  back where it was.
- `broadcastDaily` — walk `listOptedInUsersIterator()`, drop `skipUserId`,
  buffer, `chunk` at `PUSH_BATCH_SIZE`, `enqueue` each batch with
  `link: postId as T3` and `data: {}` (no templating — every recipient gets the
  same sentence, and a template with nothing in it is a moving part for free).
  Stop at `PUSH_MAX_RECIPIENTS_PER_RUN` and `console.warn` the number reached
  when it stops early. Log the summed `successCount` / `failureCount`. A batch
  that throws is logged and the walk continues — one bad page must not cost
  everybody after it.
- `notifyPromotedAuthor` — a one-recipient `enqueue`. An empty `authorId` is a
  no-op, not an error: a house question has no author and that is the normal
  case, exactly as `creditCoins('' , …)` already handles it in `daily.ts`.

`skipUserId` on the broadcast is what implements "the promotion notice replaces
the broadcast". Put the reason in the comment, not just the parameter.

---

## Step 4 — The wire and the routes

### `src/shared/types.ts`

`AvatarResponse` gains two fields; `AvatarRequest` gains one.

```ts
  /**
   * Whether this player has said yes to push notifications, and whether the
   * feature can be offered at all.
   *
   * Here for the same reason `showBlob` is here and not on a settings
   * endpoint of its own: Your record is where a player reads and changes the
   * things that are true of them, this response is what that room already
   * waits for, and a third endpoint would be a third thing to keep in step.
   *
   * It costs the wardrobe one plugin call it has no use for, which is the
   * price of not splitting the settings across two shapes. If the wardrobe
   * ever gets slow, that call is the first thing to look at.
   */
  push: boolean;
  /** False when the feature is off or the plugin did not answer. The switch does not render. */
  pushAvailable: boolean;
```

`AvatarRequest` becomes `Partial<Equipped> & { showBlob?: boolean; push?: boolean }`,
and the header comment on it — the one explaining why every field is optional —
grows a sentence for the third caller.

`Reveal` gains one field, next to `blobNotice` and phrased against it:

```ts
  /**
   * Ask this player, once, whether they want to be told when the next Daily
   * goes up. Never true on the same reveal as `blobNotice` — see
   * `shouldAskForPush`.
   */
  pushNotice: boolean;
```

### `src/server/routes/api.ts`

- `GET /api/avatar`: add `readPushState(userId)` to the existing `Promise.all`;
  the signed-out branch returns `push: false, pushAvailable: false`.
- `POST /api/avatar`: `push` becomes a third thing that may arrive alone.
  Extend `wantsVisibility` into a sibling `wantsPush`, add it to the
  "request asking for nothing at all" guard, call `setPushOptIn` in the parallel
  write, and — unlike `showBlob`, which the route answers with what was asked
  for — answer with **what `setPushOptIn` returned**. This is the one setting in
  the app whose write can legitimately be refused by something other than us.
- Where the reveal is built, nothing changes: `pushNotice` is computed inside
  `buildReveal`.

### `src/server/core/votes.ts`

`buildReveal` already reads `readBlobVisibility` to compute `blobNotice`. Add
`readPushState` beside it in the same wave, and set
`pushNotice: shouldAskForPush({ … })` using the `blobNotice` it just computed.
One extra parallel read on the reveal path; do not add a round trip for it.

---

## Step 5 — The client

### `src/client/api.ts`

One function, modelled on `saveShowBlob` and with a comment that says why it is
not just another field on the same call site:

```ts
export function savePush(push: boolean): Promise<AvatarResponse>
```

### `src/client/components/Menu.tsx`

- `useAvatar` gains `push(next: boolean)`, written exactly like `show` — its own
  optimistic write, not folded into the coalescing one, and rolled back on
  failure. The rollback here has one extra job: `savePush` can resolve
  *successfully* carrying `push: false` when the plugin refused, so the handler
  must reconcile against the response rather than only catching. Say that in the
  comment; it is the one place this differs from `show`.
- A `PushSwitch` component beside `ShowBlob`, same `role="switch"` markup, same
  `switch__track` / `switch__knob` / `switch__state` classes. **No new CSS.**
  If two switches stacked in `record__side` need spacing, that is one existing
  rule gaining a `+ .switch` sibling selector, not a new component style.
- Rendered only when `avatar?.canSave && avatar.pushAvailable`.
- Copy, one line above it in a `record__note`, in the register of the `showBlob`
  note — plain, specific about what happens, no exclamation:
  *"We'll send one notification a day, when the new question goes up. Nothing
  else, and you can switch it off here."*

  That sentence is a promise the code has to keep. If a future prompt adds a
  second trigger, this line changes in the same commit or the line is a lie.

### `src/client/App.tsx` — the ask

`pushNotice` fires the same kind of one-time panel `blobNotice` already fires,
reusing that component if it takes its copy as a prop and forking it only if it
does not. Two buttons, both of which answer: **Notify me** → `savePush(true)`,
**No thanks** → a `POST /api/avatar` with `push: false`, which is what writes
`pushAsked` and retires the notice. Neither button may be the quiet one; a
dismiss that writes nothing is a notice that fires again tomorrow.

No colour. The two-accents rule is not suspended for a consent panel, and
`--signal` is you — it is not "yes".

---

## Step 6 — Sending

### `src/server/core/daily.ts`

One change only: `PostDailyResult`'s `created` variant carries what the task
needs to notify.

```ts
| { status: 'created'; day: string; questionId: string; postId: string;
    /** Empty on a house question. The author who is about to be told, and skipped in the broadcast. */
    promotedAuthorId: string;
    /** The question itself, so the task does not re-read the record to write a sentence. */
    questionText: string }
```

**Do not import `push.ts` into `daily.ts`.** The `try`/`catch` in `postDaily`
releases `daily:claims` on any throw, and a notification failure inside it would
release the claim on a day whose post already exists — recoverable only because
`daily:{day}` is set by then, and not a risk worth taking for a buzz. The
notification is not part of posting the Daily; it is something that happens
afterwards because the Daily was posted. Keep the seam where the failure modes
already are.

### `src/server/routes/tasks.ts`

`post-daily` gains a tail, after `postDaily` has returned and only on `created`:

```ts
if (result.status === 'created') {
  await notifyPromotedAuthor(result.promotedAuthorId, result.postId, result.questionText);
  await broadcastDaily(result.postId, result.questionText, result.promotedAuthorId || undefined);
}
```

Author first, so that if the run dies between the two the one person with a
specific reason to hear has heard. Both swallow their own failures, so no
`try`/`catch` here — and note in a comment that this is why there isn't one, or
somebody will add one.

`/internal/triggers/install` calls `postDaily` too, and gets the same tail for
free by *not* getting it: leave install alone. A fresh install has nobody opted
in, and an install-time broadcast is a notification about a post nobody was
waiting for.

---

## Step 7 — The game badge, only if step 0 was clean

`requestShowGameBadge({ post, expiresAt })` is a lighter touch than a push — a
dot rather than a buzz — and it needs no opt-in, which is also why it needs
care. Its signature takes no `userId`, so whether it is app-wide or scoped to a
user context is **not established by the type**, and a scheduler task has no
user on it.

So: call `getGameBadgeStatus()` from the step-0 probe and from a task run, and
find out. If it behaves app-wide from a task, add one line to the `post-daily`
tail — `requestShowGameBadge({ post: result.postId as T3, expiresAt: nextMidnightUtc() })`,
with `nextMidnightUtc()` living in `shared/day.ts` beside `toDayKey` and tested
there. If it does not, **skip this step entirely** and say so in the summary.
Do not guess, and do not ship it behind a flag that nobody will ever come back
to resolve.

---

## Step 8 — Verify

`npm run verify` — typecheck, tests, build. Then on `playoutlier_dev`:

1. Open Your record signed out → no switch, no crash.
2. Signed in, switch on → reload the app → it is still on (which proves you are
   reading Reddit's ledger and not something you cached).
3. Switch off → on → off. Three round trips, no flicker back to a stale value.
4. Force the ask: clear `pushAsked` on your own `user:` hash, get a streak of 2,
   answer a question → the panel appears. Answer it either way → answer another
   question → it does not appear again.
5. Confirm the ask does **not** appear on a fresh account's first ever answer,
   where `blobNotice` is firing.
6. Run **Outlier: post today's Daily now** with yourself opted in → one
   notification, linking to the new post.
7. Approve one of your own questions, get it promoted, run it again → you get
   the promotion notice and **not** the broadcast. One buzz, not two.
8. Set `PUSH_ENABLED = false`, rebuild → the switch is gone, the ask never
   fires, the Daily still posts. This is the rollback and it must be tested,
   not assumed.

Note that under `REPLAY_MODE` the streak is one of the few things that does not
inflate, so step 4's precondition is real rather than an artefact — see the
README's list of what the flag does and does not distort.

---

## Files touched

| File | What |
|---|---|
| `src/shared/config.ts` | the push block, five constants |
| `src/shared/push.ts` | **new** — copy, `chunk`, `fitPushBody`, `shouldAskForPush` |
| `src/shared/types.ts` | `push` + `pushAvailable` on `AvatarResponse`, `push?` on `AvatarRequest`, `pushNotice` on `Reveal` |
| `src/server/core/keys.ts` | `userFields.pushAsked` |
| `src/server/core/push.ts` | **new** — the seam, and the only file that imports the plugin |
| `src/server/core/votes.ts` | `pushNotice` in `buildReveal` |
| `src/server/core/daily.ts` | two fields on `PostDailyResult`; no plugin import |
| `src/server/routes/api.ts` | read and write push on `/api/avatar` |
| `src/server/routes/tasks.ts` | the send, after `postDaily` returns |
| `src/client/api.ts` | `savePush` |
| `src/client/components/Menu.tsx` | `PushSwitch`, `useAvatar.push` |
| `src/client/App.tsx` | the one-time ask |
| `src/client/styles.css` | at most one sibling selector for two stacked switches |
| `tests/push.test.ts` | **new** |
| `docs/prompts/README.md` | a row for 07 in the table, and any decision above that supersedes this file |

`devvit.json` and `package.json` are **not** on this list. If you find yourself
editing either, stop and work out why — the schema has no notifications
permission and the package is already installed, so a change to either means
something upstream of this plan has moved.

---

## What this does not do

- **No streak reminder.** Cut with reasons, above. Do not add one "while you're
  in here".
- **No per-user quiet hours, no digest, no frequency control.** One notification
  a day is the frequency, and the switch is the control.
- **No notification about somebody else's activity** — no "three people
  answered your question", no reply pings. Reddit already does replies, and
  every one of those shapes wants a count.
- **No local mirror of the opt-in state.** If a later feature needs to know who
  is opted in, it asks `listOptedInUsers`; it does not get a Redis set added
  here to make itself cheaper.
- **No change to what a signed-out visitor sees**, beyond two `false` fields on
  a response they already receive.

## When you are done

Summarise: what step 0 returned, whether step 7 shipped and why, the observed
`successCount`/`failureCount` from the dev broadcast, and anything above you
implemented as written but think is wrong.
