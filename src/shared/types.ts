/** Wire types shared by the client and the server. */

import type { BadgeId } from './badges.js';
import type { Earning } from './earnings.js';
import type { Equipped } from './items.js';
import type { Award } from './points.js';

/** Which side of a question a player took. Always exactly two. */
export type Choice = 'a' | 'b';

/** Where a question came from. Only `house` and `community` exist in v1. */
export type QuestionSource = 'house' | 'community';

/** A question as the client needs to render it. */
export type Question = {
  id: string;
  text: string;
  labelA: string;
  labelB: string;
  source: QuestionSource;
  /** Username of the submitter, for community questions. */
  authorName?: string;
  /** Set when this question ran as a Daily, as `YYYY-MM-DD`. */
  dailyDate?: string;
  /** Only changes what the header reads. Every question counts the same. */
  isDaily: boolean;
  /** This is the Daily for the current UTC day, rather than one from the archive. */
  isToday: boolean;
  /**
   * No further votes accepted. Never set by the daily cycle — an old Daily stays
   * open — so this only ever means somebody closed the question by hand.
   */
  locked: boolean;
};

/** Raw counts. Never sent to a player who has not voted. */
export type Tally = {
  a: number;
  b: number;
  total: number;
};

/**
 * One other player, in the crowd on the reveal.
 *
 * This is the only shape in the app that says how a *named* person answered a
 * question, so where it can travel matters: it rides on `Reveal` and nowhere
 * else, which puts it behind the same gate the tally is behind — see the header
 * on `server/core/votes.ts`. A player appears here only if their stored
 * preference says they may, checked at render time rather than at vote time, so
 * turning it off empties every crowd they are in rather than only the next one.
 *
 * No userId. The reveal needs a name, a side, and a pair of items to draw with;
 * anything more would be more than the screen has any use for.
 */
export type Cameo = {
  /** Username, without the `u/`. Somebody the names hash has never seen is dropped. */
  name: string;
  /** The side they actually answered, read from `voted:{questionId}`. */
  choice: Choice;
  avatar: Equipped;
};

/** The result of one player's vote, computed server-side. */
export type Reveal = {
  choice: Choice;
  guess: number;
  /** Percent of voters who picked the same side, rounded. */
  actual: number;
  /** `|guess - actual|`. */
  error: number;
  /** `error <= HIT_THRESHOLD`. */
  hit: boolean;
  /** Your side holds less than `MINORITY_THRESHOLD` of the vote. */
  minority: boolean;
  badge: BadgeId;
  tally: Tally;
  /** How many of the hundred dots sit on your side. */
  dotsWithYou: number;
  /** Guess distribution, ten buckets of ten points. */
  histogram: number[];
  /** Too few votes for the split to mean anything yet. */
  provisional: boolean;
  /**
   * What this vote paid.
   *
   * Banked at vote time from the error as it stood then, because it moved a
   * stored total. Everything else on this screen is recomputed live, so on a
   * busy question `error` above can drift a point or two after the fact — the
   * points already in the bank cannot.
   */
  award: Award;
  /** Player totals as of this vote. */
  stats: PlayerStats;
  /** The comment the player can post with one tap. */
  commentPreview: string;
  /** Set once this player has posted their comment. */
  commented: boolean;
  /**
   * Up to `CAMEO_COUNT` other players who answered this question, each on the
   * side they chose. Empty when nobody else has answered yet — a fresh open
   * question is the common case, not the edge one.
   */
  cameos: Cameo[];
  /**
   * This player has never been told their own blob can appear in other people's
   * crowds. True exactly once: the first answer they give, either way, settles
   * it. See `showBlob` on the user hash.
   */
  blobNotice: boolean;
  /**
   * Offer them the subreddit, and the free box that comes with it.
   *
   * Gated on `JOIN_OFFER_MIN_PLAYS` rather than firing on a first reveal: a
   * player who has answered twice has shown up on purpose, and one who is on
   * their first is still working out what the game is. It rides beside
   * `blobNotice` and is deliberately not on the same slide — two first-run
   * interruptions on one screen means both are dismissed unread.
   */
  joinOffer: boolean;
};

/** The two counters in the header, plus what the menu reads off them. */
export type PlayerStats = {
  /** Consecutive UTC days with at least one vote on them. */
  streak: number;
  /** The longest `streak` ever reached. A missed day never reduces it. */
  bestStreak: number;
  /** Lifetime points. Never spent, never decremented — see `shared/coins.ts`. */
  points: number;
  /**
   * The spendable balance. A different ledger from `points` and never the same
   * number: this one goes down when a box is opened.
   *
   * It is the middle counter in the header `StatBar`, between the streak that
   * pays it and the points it is not, and it is read again in full in "Your
   * record" and in the wardrobe where it is spent. Because it is on screen
   * while things are being paid for, anything that moves a balance hands the
   * new one back on its own response rather than leaving this to go stale.
   */
  coins: number;
  totalPlayed: number;
  /** Votes inside `HIT_THRESHOLD`, which is what the read rate is made of. */
  totalHits: number;
  /** True once today's vote is in, so the streak tile can go live. */
  extendedToday: boolean;
  /**
   * Something has been paid since this player last opened their record.
   *
   * A boolean rather than a count: the marker is a dot, and a dot does not need
   * a number. It is derived from two fields on the user hash, so `projectStats`
   * answers it out of the `hGetAll` it was already making — the dot costs no
   * read on the vote path, the state path, or anywhere else.
   */
  unseenEarnings: boolean;
};

/**
 * `GET /api/state/:postId`.
 *
 * Two kinds of post carry this app: the ones with a question on them, and the
 * pinned menu post, which has none. The discriminator is what stops the client
 * from having to infer which it is from a missing field.
 */
export type StateResponse = QuestionState | MenuState;

/** A playable post. Tallies are present only once `reveal` is. */
export type QuestionState = {
  kind: 'question';
  question: Question;
  /** Present if and only if this user has already voted. */
  reveal: Reveal | null;
  /** Header counters, whether or not they have voted today. */
  stats: PlayerStats;
  /** Signed-out users can read the question but cannot vote. */
  canVote: boolean;
  /**
   * Whether the menu offers the room that asks a question.
   *
   * A boolean about the viewer and nothing else — the same shape and the same
   * job as `canVote` above and `canSave` on the wardrobe. It deliberately does
   * not carry how many of today's three are left: that would be a Redis read on
   * every state load for a number nobody needs until the room is open, and the
   * server's refusal is what settles it either way.
   */
  canSubmit: boolean;
  /**
   * The blob of whoever asked, for the author line.
   *
   * Null on house questions, which carry no author line at all. It rides on the
   * state rather than costing the client a second fetch — one extra field on a
   * response it already waits for, off a `authorId` already in hand.
   *
   * Here rather than on `Question` because the public question projection is
   * deliberately narrow and this is presentation, not content. It carries no
   * vote information of any kind.
   */
  authorAvatar: Equipped | null;
};

/**
 * The pinned menu post. There is nothing to vote on, so there is no question, no
 * reveal, and — importantly — no tally anywhere in this shape.
 */
export type MenuState = {
  kind: 'menu';
  stats: PlayerStats;
  /**
   * As on `QuestionState`, and needed here most: the pinned menu post is where
   * a signed-out visitor is most likely to be, and this shape carries no other
   * signal about who is reading it.
   */
  canSubmit: boolean;
};

export type VoteRequest = {
  postId: string;
  choice: Choice;
  guess: number;
};

export type CommentRequest = {
  postId: string;
  /** Optional and skippable. Appended to the generated comment. */
  note?: string;
  /**
   * The answer being shared. Read only when no vote was stored — which happens
   * only under `REPLAY_MODE`, where nothing is remembered. Normally the server
   * ignores these and reads the stored vote instead, so the client cannot claim
   * a result it did not earn. The split and the score are recomputed from the
   * live tally either way.
   */
  choice?: Choice;
  guess?: number;
};

export type CommentResponse = {
  ok: true;
  permalink: string;
  /**
   * What posting it paid, which is `COINS_COMMENT` or nothing at all.
   *
   * Zero is reachable: a comment posted a second time is refused before it
   * reaches the payment, and the client renders the receipt without it. Both
   * this and the balance ride on the response so the share slide can say what
   * happened without a second fetch.
   */
  earned: number;
  /** The balance afterwards. */
  coins: number;
};

/**
 * `GET /api/earnings` — the last few coin events, and what they add up to.
 *
 * Its own fetch rather than a field on `/api/state`: only the record room reads
 * it, and every other screen would be paying a zset read for something nobody
 * has opened. Reading it is also what marks it seen — see the route.
 */
export type EarningsResponse = {
  /** Newest first, at most `EARNINGS_LOG_SIZE`. */
  entries: Earning[];
  /** The balance, so the room agrees with itself without a second read. */
  coins: number;
};

/**
 * `POST /api/join` — subscribe, and take the free box that comes with it.
 *
 * `granted` is false on the decline, and on a second tap by somebody who has
 * already claimed: the subscription is idempotent and the grant is not.
 */
export type JoinResponse = {
  joined: boolean;
  granted: boolean;
  freeRolls: number;
};

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

export type QueueEntry = {
  id: string;
  text: string;
  labelA: string;
  labelB: string;
  authorName: string;
  upvotes: number;
  postId: string;
  createdAt: number;
};

export type QueueResponse = {
  pending: QueueEntry[];
  approved: QueueEntry[];
};

/**
 * One row of the most-misjudged-questions board.
 *
 * No longer a wire type: the board came off both in-app surfaces and its only
 * reader is now the moderator-posted event post, which renders on the server.
 * It stays here because `server/core/stats.ts` returns it and this is where the
 * shapes that cross between question and presentation live.
 */
export type MisjudgedEntry = {
  id: string;
  text: string;
  avgError: number;
  votes: number;
  source: QuestionSource;
};

/**
 * Which player board is being read.
 *
 * `week` is the default everywhere. Nothing in this game closes on a schedule,
 * so an all-time board rewards grinding the archive over reading the room; a
 * week bounds that, because the archive can only be farmed once per player.
 */
export type BoardRange = 'week' | 'all';

/** One row of the player leaderboard. */
export type PlayerBoardEntry = {
  /** Position on the board, from 1. */
  rank: number;
  userId: string;
  name: string;
  /** Points banked — this week on the weekly board, lifetime on the other. */
  points: number;
  /**
   * What their counter is wearing, so the board draws the player rather than a
   * disc standing in for one.
   *
   * Not gated on `showBlob`, and deliberately: that setting is about standing
   * anonymously in somebody else's crowd, on a question you both answered,
   * where the counter says something about how you voted. A leaderboard row is
   * already a name and a score the player put there on purpose, and the
   * drawing beside it discloses nothing the row does not.
   *
   * Absent equipment is the starter pair rather than an empty slot — see
   * `unpackAvatar` — so this is never null.
   */
  avatar: Equipped;
};

/**
 * `GET /api/leaderboard/players` — points banked, and nothing else.
 *
 * Every number in this shape is a per-player aggregate over every question that
 * player ever answered. None of them narrows down how anyone answered any
 * individual question, and there is no field here a `Tally` could travel in.
 */
export type PlayerBoardResponse = {
  range: BoardRange;
  rows: PlayerBoardEntry[];
  /**
   * Where the viewer stands. Returned even when they are already in `rows` —
   * the client decides whether to render it twice. Null when they have never
   * banked a point on this board, or are not signed in.
   */
  you: { rank: number; points: number } | null;
};

/**
 * `GET /api/daily` — where today's Daily is, and nothing else.
 *
 * `state` is the whole answer. It says whether this player can still play
 * today's question; it never says how anyone answered it. There is no field
 * here that a tally could be derived from, and that is deliberate — see the
 * header on the route.
 */
export type DailyPointer = {
  /** `YYYY-MM-DD`, UTC, resolved on the server. The client never reads a clock. */
  day: string;
  /**
   * `playable` — a Daily exists and this player has not answered it.
   * `voted`    — they have. The button still travels; it just stops leading.
   * `here`     — the post this menu is open on *is* today's Daily.
   * `none`     — no Daily today yet. Reachable: `post-daily` runs at midnight
   *              UTC, so an install at 00:30 has none until the next one.
   */
  state: 'playable' | 'voted' | 'here' | 'none';
  postId?: string;
  /** Reddit path, not a URL. Absent when there is nowhere to go. */
  permalink?: string;
};

/**
 * `GET /api/avatar` and what `POST /api/avatar` answers with.
 *
 * `owned` is the real inventory and it now gates: the wardrobe's steppers walk
 * it rather than the whole catalogue, and `POST /api/avatar` refuses anything
 * outside it. Starter items are never listed twice — they are in here because
 * `readInventory` adds them on the way out, not because they are stored.
 *
 * `coins` rides along so the wardrobe can show the balance and price a box
 * without a second fetch, on a response it already waits for.
 */
export type AvatarResponse = Equipped & {
  owned: string[];
  coins: number;
  /** Signed-out players get the starter pair and no way to change it. */
  canSave: boolean;
  /**
   * Whether this blob may appear in other players' crowds. Defaults to true,
   * including for everyone who was already playing before it existed — see the
   * note on `showBlob` in `server/core/keys.ts`.
   */
  showBlob: boolean;
  /** Boxes owed that cost nothing. Spent before coins are, and priced as free. */
  freeRolls: number;
};

/**
 * `POST /api/avatar`. Every field optional, and not out of laziness.
 *
 * The pair comes from the wardrobe, which knows what is equipped. `showBlob`
 * comes from the reveal's first-run notice, which does not — and making it go
 * and find out, so that it could send a pair back unchanged, would be a round
 * trip spent to say nothing. A request carrying neither is refused.
 */
export type AvatarRequest = Partial<Equipped> & { showBlob?: boolean };

/**
 * `POST /api/box/open` — what one box gave you.
 *
 * The roll happens on the server and this is its receipt; the client animates
 * the arrival and nothing more. A client-side roll is a client-side inventory.
 *
 * `item` is an id, resolved against the shared catalogue with `findItem`. There
 * is no tally, no vote count, and nothing a tally could be derived from here.
 */
export type BoxResponse = {
  item: string;
  /** Already owned. The refund is what happened instead of a new item. */
  duplicate: boolean;
  /** Coins paid back for a duplicate, or 0. A free roll never refunds. */
  refunded: number;
  /** The balance after the box was paid for and any refund applied. */
  coins: number;
  /** Opened with a free roll, so the balance did not move. */
  free: boolean;
  /** Free rolls left. What the *next* tap will cost. */
  freeRolls: number;
};

export type ApiError = {
  error: string;
  /** Populated on a 409 so the client can render the reveal it already earned. */
  reveal?: Reveal;
};
