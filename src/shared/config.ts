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

/** The crowd is always drawn as this many dots, whatever the real vote count. */
export const CROWD_SIZE = 100;

/**
 * The sizes a blob is drawn at, in pixels, and the only ones it is tuned for.
 *
 * `crowd` is where a dot lands on a phone once the crowd has measured itself,
 * and is the size the accessory silhouettes have to survive; `inline` sits in
 * front of a community question's author line; `panel` is the wardrobe and the
 * player's own record. Three sizes rather than a scale, because an item that
 * reads at 18 and at 40 reads everywhere in between.
 */
export const BLOB_SIZE = { crowd: 18, inline: 24, panel: 40 } as const;

/** One submission per user per 24h, enforced server-side with a TTL. */
export const SUBMISSION_COOLDOWN_SECONDS = 24 * 60 * 60;

/** Question text bounds, enforced on both sides of the wire. */
export const QUESTION_MIN_LENGTH = 10;
export const QUESTION_MAX_LENGTH = 120;
export const LABEL_MAX_LENGTH = 12;

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
