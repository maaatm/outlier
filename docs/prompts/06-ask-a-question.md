# 06 — Ask a question, from inside the game

Give players a way to write a question without leaving the app. The whole submission
pipeline already exists on the server and has never had a client; this change builds the
client, adds a post title to the payload, and replaces the daily cooldown with a small
daily allowance.

It also takes the misjudged board off both in-app surfaces — the menu room and the
reveal's detail tabs — which is what frees the menu slot. The board itself survives as the
moderator-posted event post, which is where it does its teaching in public.

Medium. One new room, one new field on the wire, one storage key swapped.

---

## Context

Read `README.md` first — **The menu**, **Question sources**, and **The pinned menu post** —
then `src/server/core/submit.ts`, `src/shared/validate.ts`, `src/server/core/filter.ts`,
`src/client/components/Menu.tsx`, and `src/client/components/Compose.tsx`.

The thing to understand before touching anything: **`POST /api/submit` already works.**
`submitRoutes` is mounted in `src/server/index.ts`, and `submitOpenQuestion` already
normalises, validates, filters, writes the question record, rate-limits, creates the post
as the user, links it, and enqueues it for promotion. What it has never had is a caller —
`src/client/api.ts` contains no submit function. The only way to reach it today is the
Devvit subreddit menu form at `/internal/menu/submit-question`.

So this is not a new feature. It is a client for one that shipped without a front door,
plus the changes that front door makes necessary.

**Nothing about moderation changes.** Player questions already become live posts
immediately; the approval queue only ever gated the *Daily slot*, and it still does. What
changes is friction, and therefore volume — see §3.

---

## What to build

### 1. Take the misjudged board off both in-app surfaces

Two surfaces go. The `stats:misjudged` zset, the `zAdd` that maintains it,
`src/server/core/stats.ts`, and the moderator menu item that posts the board all **stay** —
that post is now the board's only reader, and it is the one that reaches people who are
not already in the app.

Delete:

| File | What goes |
|---|---|
| `src/client/components/MisjudgedBoard.tsx` | the whole file |
| `src/client/api.ts` | `fetchMisjudged`, and the `MisjudgedResponse` import |
| `src/client/App.tsx` | the `detail` state, the `.detail` block and both tab buttons on the score slide, the `MisjudgedBoard` import |
| `src/client/components/Menu.tsx` | the `Misjudged` panel, the `'misjudged'` arm of `PanelId`, its `TITLES`/`ENTRIES` rows, the `MisjudgedBoard` and `LEADERBOARD_MIN_VOTES` imports |
| `src/server/routes/api.ts` | `GET /api/leaderboard/questions`, the `misjudgedLeaderboard` import, the `MisjudgedResponse` type import |
| `src/shared/types.ts` | `MisjudgedResponse`. **Keep `MisjudgedEntry`** — `stats.ts` still returns it |
| `src/server/core/votes.ts` | `readAverageError`, which has zero callers today and is only found by grep |

On the score slide the histogram becomes the only thing in that area. Render it directly;
do not leave a one-tab tab strip behind.

**Two deletions that would break the player leaderboard — do not make them:**

- `.detail`, `.detail__tabs`, `.detail__tab` in `styles.css`. `PlayerBoard.tsx` uses all
  three for its week/all-time tabs; it deliberately borrows the reveal's tab idiom.
- `.board`, `.board__row`. Also `PlayerBoard`'s.

Only `.board__text` and `.board__error` are misjudged-only and can go.

Also update: the menu table and the endpoint list in `README.md`, the `stats:misjudged`
line in its data model (the key survives, its readers changed), the header comment on
`src/server/core/menuPost.ts` which still says the front door shows the misjudged
leaderboard, and the row in `docs/proposed-features.md` about the room keeping its name.

### 2. The post title

The post title is currently the question text. Splitting them is the only part of this
change that adds a new way for content to reach the subreddit, so it gets the same
treatment the question text already gets and then some.

**The title is optional and defaults to the question.** The game's pitch is two taps and
no typing; a room that demands four fields before it will do anything is the heaviest
screen in the app by a wide margin. Prefill the field with the question text as it is
typed, let the player edit it, and treat an empty title as "the question was the title" —
which is exactly what every existing record means.

`src/shared/config.ts`:

```ts
/**
 * Post title bounds. Reddit's own cap is 300; the feed truncates long before
 * that and so does the card, so this is set by what is readable rather than by
 * what is allowed.
 */
export const TITLE_MIN_LENGTH = 8;
export const TITLE_MAX_LENGTH = 100;
```

`src/shared/validate.ts`:

- `normalizeTitle(raw: string, fallback: string): string` — same cleanup as
  `normalizeQuestionText`, falling back to the question text when the result is empty.
  Mirror `normalizeLabel`, which already has this shape.
- `validateTitle(raw: string): ValidationResult` — length bounds, must contain a letter,
  no links or usernames. **Do not reuse `validateQuestionText`**: the trailing question
  mark and the one-question-mark rules are rules about a question, and a title is not one.
  A title with no `?` is fine; a title that is three questions is fine.
- `validateSubmission(text, labelA, labelB, title)` — add the title as a fourth required
  parameter rather than an optional one, so no call site can forget it. There is exactly
  one caller in `src/`; `tests/validation.test.ts` has three assertions to update.

`src/server/core/filter.ts`:

- Rename `filterQuestionText` → `filterText` and give it a second parameter,
  `subject: 'question' | 'title'`, interpolated into the two reasons that name a
  question. The word lists, the shouting rule and the repeated-character rule apply to
  both unchanged.
- Run it on the title as well as the question, in `submitOpenQuestion`. This is the
  point of the section: a title field that skipped the filter would be an unfiltered
  path to a real post made under the player's own account.

`src/server/core/questions.ts`:

- `NewQuestion` and `QuestionRecord` gain `title: string`. `writeQuestion` writes it;
  `getQuestion` reads it with a `''` fallback, the way `postId` already does.
- **Keep it off `toPublicQuestion`.** The client renders `question.text`. The title is a
  Reddit artifact, not game content, and the public projection is deliberately narrow.

`src/server/core/submit.ts`:

- Use the title as the post title.
- Add it to `userGeneratedContent.text` alongside the question. That field is what
  Reddit's safety review reads, and the title is now user-authored content that is not
  otherwise in it.

### 3. An allowance, not a cooldown

`docs/prompts/README.md` says submission is uncapped from prompt 04. That decision was
made when submitting meant finding a subreddit menu item most players never open. This
change puts it one tap from the front door — including the pinned menu post, where
somebody who has never played lands — so expect the submission rate to move by an order
of magnitude, and `queue:pending` with it. Uncapped plus one-tap is an unbounded source
of real posts on the subreddit attached to the lowest-friction control in the app.

The middle path: more than one a day, still bounded.

`src/shared/config.ts` — replace `SUBMISSION_COOLDOWN_SECONDS` with:

```ts
/** Questions one player may post in a UTC day. */
export const SUBMISSIONS_PER_DAY = 3;

/** How long the counter outlives its day. Only needs to exceed one day. */
export const SUBMISSION_COUNT_TTL_SECONDS = 48 * 60 * 60;
```

`src/server/core/keys.ts` — replace `submissionCooldown` with:

```ts
/**
 * string with a TTL: how many questions this player has posted today.
 *
 * Keyed by UTC day rather than a rolling 24h window, so the allowance turns over
 * with the game's own day boundary — the same one the streak and the Daily use.
 * The TTL is a cleanup mechanism, not the limit; the day in the key is the limit.
 */
submissionCount: (userId: string, day: string) => `sub:count:${userId}:${day}`,
```

`src/server/core/submit.ts` — replace `checkCooldown`/`startCooldown` with
`remainingSubmissions(userId): Promise<number>` and `countSubmission(userId): Promise<void>`
(`incrBy` then `expire`). Update the caller in `src/server/routes/menu.ts`, which uses
`checkCooldown` to decide whether to open the form at all.

### 4. Two ordering bugs in `submitOpenQuestion` that only surface at volume

The current order is: check limit → validate → filter → `writeQuestion` → start cooldown →
`submitCustomPost` → link → enqueue.

**The limit is checked before validation and consumed after it.** That is already correct
and matters far more now: a submission rejected by the filter must not cost the player one
of their three. Keep it that way.

**A failed `submitCustomPost` leaves an orphan.** The question record is written before
the post exists, so a post call that throws leaves a `q:{id}` hash with no post, no
`post:` mapping, and no way to reach it — and the allowance is already spent. Rare through
a subreddit menu, routine once the button is in the app and people retry.

Fix by wrapping the post call:

```
count → writeQuestion → try { submitCustomPost } catch { del q:{id}; return rejected } → link → enqueue
```

Consume the allowance *before* the post call, not after. A failed post costing one of
three is the safe direction; the alternative is an unlimited retry loop, which is what the
existing comment on `startCooldown` is guarding against.

### 5. `canSubmit` on the state response

The menu has to know whether to offer the room. `MenuState` carries only `stats` today,
and the pinned menu post — where a signed-out visitor is most likely to be — has no other
signal.

Add `canSubmit: boolean` to **both** `QuestionState` and `MenuState` in
`src/shared/types.ts`, set from `Boolean(userId)` in `GET /api/state/:postId`.

Do not put the remaining allowance on it. That would be a Redis read on every state load
for a number nobody needs until the room is open, and the 429 already carries the message.
This is the same call the wardrobe makes with `canSave`: one boolean about whether the
control is offered, and the server's answer is what settles the rest.

### 6. The client

`src/shared/types.ts`:

```ts
export type SubmitQuestionRequest = {
  text: string;
  labelA: string;
  labelB: string;
  /** Empty means the question text is the title. */
  title?: string;
};

export type SubmitQuestionResponse = {
  ok: true;
  questionId: string;
  postId: string;
  permalink: string;
};
```

`POST /api/submit` already returns that shape untyped. Type it, and have it read
`body.title`.

`src/client/api.ts` — add `submitQuestion(input: SubmitQuestionRequest)`.

`src/client/components/Menu.tsx`:

- `PanelId` becomes `'record' | 'wardrobe' | 'board' | 'ask'`.
- `TITLES.ask = 'Ask a question'`; blurb: `'write one for the subreddit and post it'`.
- Place it **last** in `ENTRIES`. The list runs you → everyone else, and this is neither;
  last also puts the only room that does something irreversible furthest from where a
  mis-tap lands.

The panel itself:

- Four fields, in the order they are read: question, first answer, second answer, title.
  Default the two answers to `Yes`/`No` the way the Devvit form does.
- Autosizing textarea for the question, borrowed from `Compose.tsx`'s note field, and its
  `{MAX - value.length} left` counter idiom on every bounded field. The room should feel
  like a screen this app already has.
- The title field's placeholder is the question text as currently typed, so it is visibly
  a refinement of something that already works rather than a fifth thing to invent.
- A preview of the post as it will appear: the title on one line, the question under it,
  the two answers as the labels they will become.
- Client-side validation with the shared `validateSubmission`, disabling the button and
  showing the reason. This is a courtesy — every rule is re-run server-side and that is
  the gate.
- **One primary button, and the panel is the confirm.** This is the first room in the menu
  that does something a player cannot undo: the wardrobe writes, but you undo the wardrobe
  by pressing the other arrow. Nothing here submits on blur or on the last keystroke.
- On success, `navigateTo` the new post. `REDDIT_ORIGIN` and the `new URL(permalink, …)`
  pattern are already in this file for the Daily action.
- Signed out (`canSubmit === false`), render the fields disabled under a
  `notice--quiet` — the same shape the wardrobe uses for `canSave`.
- Surface the 429 verbatim as a `notice--quiet`; the server's message is the honest one.

**The file header comment becomes wrong.** It currently says everything in the list is a
read and the wardrobe is the one thing that writes. Rewrite that paragraph: this room
creates a public Reddit post under the player's own name, and that is a different
category from changing what a blob looks like.

### 7. Keep the Devvit form

Do not remove `/internal/menu/submit-question` or the `submitQuestion` form. It is the
only path for somebody who never opens a post, and both entry points already read the same
constants, so there is no copy to keep in sync. Add an optional `title` field to the form
and pass it through `src/server/routes/forms.ts`, so the two paths produce identical
records.

### 8. Tests

Pure logic only, per the house rule. Add to `tests/validation.test.ts`:

- `normalizeTitle` falls back to the question text on empty, whitespace, and zero-width
  input.
- Title length bounds at both ends; links and usernames rejected; a title with no `?`
  accepted; a title with three `?` accepted.
- `filterText` gives the same verdict on the same string whichever `subject` it is given,
  and names the right one in the reason.
- `validateSubmission` rejects a bad title with a good question, and the three existing
  assertions still pass with their new fourth argument.

---

## Copy deliverable

Add a short section to `docs/writing-questions.md` on titles: what the field is for, that
leaving it alone is fine, and that a title which misrepresents the question is the one
thing that will get a post removed. Same voice as the rest of that file — dry,
declarative, no exclamation marks.

`SUBMISSION_GUIDANCE` in `validate.ts` stays as it is and becomes the room's fine print,
in the `Panel` footnote slot every other room uses.

---

## Acceptance

- The menu lists Your record, Wardrobe, Leaderboard, Ask a question. No misjudged room,
  no misjudged tab on the score slide, no `MisjudgedBoard.tsx`.
- The player leaderboard's week/all tabs still render and still switch. This is the
  regression the CSS deletions cause and it is not visible from the menu root.
- The moderator menu item **Outlier: post the misjudged leaderboard** still works and
  still produces the same post body.
- A question submitted from the room appears as a post with the title the player typed,
  and opening that post plays the question they wrote.
- A submission with an empty title posts under the question text, byte for byte what the
  old path produced.
- A title containing a slur, a link, or `WRITTEN ENTIRELY IN CAPITALS` is rejected with a
  reason naming the title, and does **not** consume one of the three.
- The fourth submission in a UTC day is refused with a 429 and the room says so.
- A signed-out visitor on the pinned menu post sees the room, sees why it is inert, and
  cannot fire the request.
- `GET /api/state` still carries no tally for a user who has not voted. `canSubmit` is a
  boolean about the viewer and nothing else.
- `npm run verify` passes.

## Out of scope

Duplicate detection — nothing dedupes question text today, and at one-tap volume the same
question will be asked several times. It is the first complaint this change will generate
and it is worth a follow-up (a normalised-text hash key with a long TTL), but it is not
this one.

Also out: any change to the approval queue or the review form, coins for submitting
(prompt 04), editing or deleting a question after it is posted, and the moderator
affordance for `lockQuestion`, which still has no caller.

---

*Add the row to the table in `docs/prompts/README.md`: `06 | Ask a question | 01 | medium`.*
