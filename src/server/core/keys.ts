/**
 * Every Redis key the app touches, in one place.
 *
 * The shape follows the data model in the spec. Three keys are additions, all
 * of them derived indexes kept so a hot read does not have to scan a set:
 *
 *   hist:{questionId}   ten-bucket guess histogram, so the reveal does not read
 *                       the whole `guesses` zset on every open
 *   stats:misjudged     questionId -> avgError, so the leaderboard is one range
 *                       read instead of a scan over every question
 *   commented:{id}      userId -> commentId, so one tap cannot post twice
 *
 * `guesses:{questionId}` is still the record of truth for the distribution; the
 * histogram is a cache of it.
 */

export const keys = {
  /** hash: text, labelA, labelB, authorId, authorName, source, createdAt, postId, permalink, lockedAt, dailyDate */
  question: (questionId: string) => `q:${questionId}`,

  /** string: questionId of the Daily for a `YYYY-MM-DD` day. */
  daily: (day: string) => `daily:${day}`,

  /**
   * hash: day -> "1". The double-fire guard for `post-daily`.
   *
   * A separate key from `daily:{day}` because the claim has to happen *before*
   * the question is resolved — otherwise two overlapping runs both draw from the
   * house pool and one of the draws is thrown away.
   */
  dailyClaims: 'daily:claims',

  /**
   * hash: day -> "1". The double-post guard for `summarize-daily`.
   *
   * Its own key rather than a flag on the question, because the question is
   * never modified by the summary — the Daily stays open and unchanged, and the
   * only thing that happened is that a comment went up.
   */
  dailySummaries: 'daily:summaries',

  /** string: questionId behind a post. */
  post: (postId: string) => `post:${postId}`,

  /**
   * string: postId of the pinned menu post, which has no question on it.
   *
   * Read only when `post:{postId}` misses, so a playable post never pays for it.
   * One at a time by design — a second pinned menu post would be a second thing
   * to keep current, and there is only ever one menu.
   */
  menuPost: 'menu:post',

  /** hash: a, b, guessSum, guessCount, errSum */
  votes: (questionId: string) => `votes:${questionId}`,

  /** zset: userId -> guess. The distribution record. */
  guesses: (questionId: string) => `guesses:${questionId}`,

  /**
   * hash: userId -> "a:45:21" — choice, guess, and the error the points were
   * paid on. Dedupe guard and the record of what to re-render.
   */
  voted: (questionId: string) => `voted:${questionId}`,

  /** hash: bucket index "0".."9" -> count. Derived from `guesses`. */
  histogram: (questionId: string) => `hist:${questionId}`,

  /** hash: userId -> commentId. */
  commented: (questionId: string) => `commented:${questionId}`,

  /** hash: streak, bestStreak, lastPlayedDay, points, totalPlayed, totalHits */
  user: (userId: string) => `user:${userId}`,

  /** string with a 24h TTL. Presence means "already submitted today". */
  submissionCooldown: (userId: string) => `sub:cooldown:${userId}`,

  /** zset: questionId -> upvotes on the open post. */
  queuePending: 'queue:pending',

  /** zset: questionId -> upvotes. Only these may reach the Daily slot. */
  queueApproved: 'queue:approved',

  /** zset: questionId -> avgError. */
  misjudged: 'stats:misjudged',

  /** string: index into the shuffled house pool. */
  poolCursor: 'pool:cursor',
} as const;

/** Field names on the `votes:` hash, kept in one place to avoid typos. */
export const voteFields = {
  a: 'a',
  b: 'b',
  guessSum: 'guessSum',
  guessCount: 'guessCount',
  errSum: 'errSum',
} as const;
