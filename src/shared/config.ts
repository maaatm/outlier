/**
 * Tunable constants. Everything a designer might want to move lives here so it
 * can be changed without reading any logic.
 */

/** Upvotes an approved community question needs before it can take the Daily slot. */
export const PROMOTION_THRESHOLD = 10;

/** `error <= HIT_THRESHOLD` counts as reading the room correctly. */
export const HIT_THRESHOLD = 10;

/**
 * What every vote pays before any accuracy bonus. The bonus bands, and the words
 * for them, live in `points.ts`.
 */
export const POINTS_BASE = 10;

/** Your side is the minority when it holds less than this share of the vote. */
export const MINORITY_THRESHOLD = 35;

/*
 * ── The coin economy ──────────────────────────────────────────────────────
 *
 * Coins are not points. `points` is the leaderboard score: cumulative, never
 * decremented, never spent — a score that can be spent stops being a score,
 * because a player who buys three boxes drops fifty places and the board
 * quietly becomes a ranking of who bought the least. `coins` is the spendable
 * balance, and it is the only one of the two that ever goes down.
 *
 * Both live on the `user:{userId}` hash. Nothing in the economy reads, writes
 * or decrements `points`.
 */

/** The first vote of a UTC day. Turning up is what this one pays for. */
export const COINS_FIRST_VOTE = 5;

/** Paid on every `STREAK_BONUS_EVERY`th consecutive day — days 7, 14, 21. */
export const COINS_STREAK_BONUS = 20;
export const STREAK_BONUS_EVERY = 7;

/** Paid when a question is posted, whatever becomes of it afterwards. */
export const COINS_SUBMISSION = 10;

/** Paid to the *author* when their question takes the Daily slot. */
export const COINS_PROMOTION = 30;

/**
 * How many submissions in a UTC day still pay coins. Submission itself is
 * uncapped — this caps only the reward, so a flood costs the farmer nothing
 * but earns them nothing either. `Infinity` disables it.
 */
export const COIN_ELIGIBLE_SUBMISSIONS_PER_DAY = Infinity;

/**
 * What a gift box costs.
 *
 * Showing up pays 5 a day plus 20 every seventh, which averages a little under
 * 8 — so a box is about four days of turning up, or three questions asked. Slow
 * enough that the fourteen rollable items are a season rather than an evening,
 * fast enough that a player who plays every day is never more than a few days
 * from the next one.
 */
export const BOX_PRICE = 30;

/**
 * What a repeat pays back, as a share of the price.
 *
 * Without it a player holding most of the catalogue opens boxes for nothing and
 * stops opening them. With it, the last few items cost more per new item rather
 * than costing everything.
 */
export const DUPLICATE_REFUND_FRACTION = 0.4;

/**
 * A rare is guaranteed within this many boxes. Cheap to carry — one counter on
 * the user hash — and it turns the worst case from "I opened twelve and got
 * nothing" into a bounded promise.
 */
export const BOX_PITY_ROLLS = 8;

/**
 * The odds a box lands in each rarity band, before pity.
 *
 * The band is drawn first and the item uniformly inside it, so these numbers
 * mean what they say however many items each band happens to hold — adding
 * three commons later must not quietly make rares rarer.
 */
export const BOX_RARITY_ODDS = { common: 60, uncommon: 30, rare: 10 } as const;

/** The crowd is always drawn as this many dots, whatever the real vote count. */
export const CROWD_SIZE = 100;

/**
 * How many of the crowd's dots are drawn as real players, and how many recent
 * voters the reveal draws them from.
 *
 * The window is a small multiple of the count so that after the ineligible have
 * been filtered out there are still ten to choose from. It is capped at all
 * because a question with ten thousand voters must not grow a ten-thousand
 * member zset for a feature that shows ten — and because a cameo is only
 * interesting while it is recent.
 */
export const CAMEO_COUNT = 10;
export const RECENT_VOTER_CAP = 30;

/**
 * The sizes a blob is drawn at, in pixels, and the only ones it is tuned for.
 *
 * `crowd` is where a dot lands on a phone once the crowd has measured itself,
 * and is the size the accessory silhouettes have to survive; `inline` sits in
 * front of a community question's author line; `panel` is the player's own
 * record; `wardrobe` is the one the player is actually working on, which is the
 * only screen where the blob is the subject rather than a label.
 *
 * A short list rather than a scale, because an item that reads at 18 and at 40
 * reads everywhere in between.
 */
export const BLOB_SIZE = { crowd: 18, inline: 24, panel: 40, wardrobe: 72 } as const;

/**
 * How long an identical submission from the same player is refused.
 *
 * This is duplicate protection, not a rate limit: submission is uncapped, and a
 * player with two different questions may post both inside the window. It exists
 * because nothing in `submitOpenQuestion` is idempotent — a client retrying a
 * request that timed out halfway would otherwise create a second post and be
 * paid a second time.
 */
export const SUBMISSION_DEDUPE_SECONDS = 60;

/**
 * Questions one player may post in a UTC day.
 *
 * Submission used to be uncapped, which was defensible while the only way to
 * reach it was a subreddit menu item most players never open. The room in the
 * app puts it one tap from the front door — including the pinned menu post,
 * where somebody who has never played lands — so the rate moves by an order of
 * magnitude and `queue:pending` with it. This is the middle path: more than one
 * a day, still bounded.
 */
export const SUBMISSIONS_PER_DAY = 3;

/** How long the counter outlives its day. Only needs to exceed one day. */
export const SUBMISSION_COUNT_TTL_SECONDS = 48 * 60 * 60;

/**
 * The house pool's own style bounds, and no longer a rule anybody is held to.
 *
 * A player's question and answers are checked for being *something* — not blank,
 * reads as words, no links — and not for being short. What the shipped pool in
 * `data/questions.json` is held to is a different question from what a player is
 * allowed to ask, and these are the first: `tests/pool.test.ts` measures our own
 * content against them so a 200-character house question cannot quietly ship.
 */
export const QUESTION_MIN_LENGTH = 10;
export const QUESTION_MAX_LENGTH = 120;
export const LABEL_MAX_LENGTH = 12;

/**
 * What a player may type, and the only length rule the submission path holds
 * anybody to.
 *
 * These are not the taste bounds above. They are what the screens are built to
 * hold: the question block is measured to fit 150 characters and the two answer
 * buttons to fit 30 each, at every size the app is checked at, down to a 320px
 * phone. Past that the layout is guessing, and a question nobody can read on
 * the screen it is asked from is not a question that got through — it is one
 * that got cut off.
 *
 * The house pool sits well inside both, so `data/questions.json` is unaffected.
 */
export const SUBMITTED_QUESTION_MAX_LENGTH = 150;
export const SUBMITTED_LABEL_MAX_LENGTH = 30;

/**
 * The longest a post title may be.
 *
 * This is Reddit's own cap rather than a taste judgement — a `submitCustomPost`
 * with a longer title is refused by Reddit, so it is the one length in the
 * submission path that has to stay enforced. The feed truncates long before it,
 * which is the player's business and not ours.
 */
export const TITLE_MAX_LENGTH = 300;

/** Optional note appended to the generated comment. Short on purpose. */
export const NOTE_MAX_LENGTH = 140;

/**
 * Below this many votes an open question's split is noise, so the reveal says
 * so rather than presenting a two-person sample as a finding. This never
 * exposes tallies before a vote — see the invariant in `votes.ts`.
 */
export const PROVISIONAL_VOTE_FLOOR = 20;

/** How many pending questions a moderator sees in one review pass. */
export const MOD_QUEUE_PAGE_SIZE = 20;

/** Questions on the most-misjudged leaderboard, and the sample each needs to qualify. */
export const LEADERBOARD_SIZE = 10;
export const LEADERBOARD_MIN_VOTES = 25;

/** Rows on each tab of the player leaderboard, above the viewer's own row. */
export const PLAYER_BOARD_SIZE = 10;

/**
 * How long a weekly board outlives the week it is for. Nine days rather than
 * seven, so a board is still readable for a day or two after its week closes —
 * and so old weeks expire themselves instead of needing a sweep job.
 */
export const WEEK_BOARD_TTL_SECONDS = 9 * 24 * 60 * 60;

/** Buckets in the guess-distribution histogram: 0-9, 10-19, ... 90-100. */
export const HISTOGRAM_BUCKETS = 10;

/**
 * Seed for the house-pool shuffle. Fixed so the draw order is reproducible
 * across restarts and across every installation of the app.
 */
export const POOL_SHUFFLE_SEED = 0x0dd1e5;

/**
 * TESTING ONLY — set to false before this goes anywhere real.
 *
 * When true the game forgets that you played: your answer is never written to
 * `voted:{questionId}`, so every time you open a post you get the question
 * again instead of the reveal you already earned.
 *
 * This deliberately disables the server-side dedupe guard, which is the only
 * thing stopping one account from voting a hundred times. Votes still count
 * toward the tallies, so a test subreddit builds up a real distribution to look
 * at — and a live subreddit would build up a fake one. The streak is untouched
 * and still works normally; points are not, since every replay pays again.
 */
export const REPLAY_MODE = true;

/** Post flair applied to player-submitted questions. */
export const OPEN_QUESTION_FLAIR = 'Open question';
export const DAILY_FLAIR = 'Daily';
