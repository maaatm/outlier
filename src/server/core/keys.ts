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
 *
 * The `lb:points:*` boards and `users:names` arrived later, with the player
 * leaderboard. Neither is a cache: a weekly total is not derivable from
 * anything else once the week has turned, and a voter's username is not stored
 * anywhere else at all.
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

  /**
   * zset: userId -> vote timestamp, trimmed to `RECENT_VOTER_CAP` on write.
   *
   * The pool the reveal's cameos are drawn from, and the reason it is a window
   * rather than the whole electorate: a question with ten thousand voters must
   * not carry a ten-thousand-member zset for a feature that puts ten blobs on a
   * screen. Written next to `guesses:` on the vote path, so it costs one more
   * parallel write and not another round trip — and, like `guesses:`, it is not
   * written at all under REPLAY_MODE.
   *
   * Membership is not a permission. Whether a voter in here may actually be
   * drawn is decided at render time against `showBlob`, so a player who opts
   * out disappears from every crowd rather than from the next one.
   */
  recent: (questionId: string) => `recent:${questionId}`,

  /** hash: userId -> commentId. */
  commented: (questionId: string) => `commented:${questionId}`,

  /**
   * hash: streak, bestStreak, lastPlayedDay, points, totalPlayed, totalHits,
   * weekPoints, weekKey, coins, pity, subDay, subCount
   *
   * Two ledgers on one hash. `points` is the leaderboard score and only ever
   * increases; `coins` is the spendable balance and goes both ways. Crediting
   * coins on a vote is therefore another field on an `hSet` that `recordPlay`
   * was already issuing, rather than a second key and a second round trip.
   *
   * `pity` counts boxes since the last rare, `subDay`/`subCount` count today's
   * submissions for the coin-eligibility cap. Both belong to one player and
   * neither is worth a key of its own.
   */
  user: (userId: string) => `user:${userId}`,

  /**
   * hash: submission fingerprint -> "1", TTL `SUBMISSION_DEDUPE_SECONDS`.
   *
   * Not a rate limit — the 24h submission cooldown this replaced is gone, and a
   * player may post as many *different* questions as they like. This refuses an
   * identical one, because nothing in `submitOpenQuestion` is idempotent and a
   * retried timeout would otherwise be a second post and a second payment.
   *
   * One hash per player rather than a key per submission, so the TTL is set
   * once on a key that already exists rather than on every entry.
   */
  submissionRecent: (userId: string) => `sub:recent:${userId}`,

  /** zset: questionId -> upvotes on the open post. */
  queuePending: 'queue:pending',

  /** zset: questionId -> upvotes. Only these may reach the Daily slot. */
  queueApproved: 'queue:approved',

  /** zset: questionId -> avgError. */
  misjudged: 'stats:misjudged',

  /**
   * zset: userId -> points banked this ISO week, tiebreak folded in.
   *
   * Weekly rather than lifetime because nothing in this game closes on a
   * schedule: the archive stays playable forever, so on an all-time board the
   * fastest climb is grinding it rather than reading the room well. A week
   * bounds that, since the archive can only be farmed once per player.
   *
   * Written with a 9-day TTL, so a week that has closed cleans itself up
   * without a sweep job — and stays readable for a day or two after it closed.
   */
  pointsWeek: (week: string) => `lb:points:${week}`,

  /** zset: userId -> lifetime points, tiebreak folded in. The second tab. */
  pointsAll: 'lb:points:all',

  /**
   * hash: userId -> username.
   *
   * Both boards render names and a vote otherwise stores none. Written once per
   * player, because the name behind a userId costs a Reddit API call and the
   * vote path cannot afford one every time.
   */
  names: 'users:names',

  /**
   * hash: userId -> "faceId:accessoryId". Everyone's equipped blob, in one key.
   *
   * Packed into a single field of a single shared hash rather than a key per
   * player, so a screen wanting ten players' blobs pays one `hMGet` instead of
   * ten round trips. Absent means the starter pair, so nothing has to be
   * back-filled for players who have never opened the wardrobe.
   */
  avatars: 'avatars',

  /**
   * hash: itemId -> "1". What one player owns.
   *
   * Starter items are never in here: they are owned implicitly, and writing them
   * to every player's hash would be a row per person to say what is true of
   * everyone.
   *
   * Written by the gift box, and once by the migration in `readInventory` for
   * anyone who equipped something while the catalogue was unlocked.
   */
  inventory: (userId: string) => `inv:${userId}`,

  /** string: index into the shuffled house pool. */
  poolCursor: 'pool:cursor',
} as const;

/**
 * Field names on the `user:` hash that are written from more than one place.
 *
 * The totals are written only by `recordPlay`, which spells them out; these
 * four are touched by the economy — from `users.ts`, `coins.ts` and `boxes.ts` —
 * and a typo in one of those would be a silently separate field.
 */
export const userFields = {
  coins: 'coins',
  /** Boxes opened since the last rare. */
  pity: 'pity',
  /** The UTC day `subCount` belongs to. */
  subDay: 'subDay',
  /** Submissions made on `subDay`, for the coin-eligibility cap. */
  subCount: 'subCount',
  /**
   * `"1" | "0"` — may this player's blob appear in other players' crowds?
   *
   * Absent is a third state and it carries most of the weight: it means **on**,
   * and it means **never told**. So the default is one `?? '1'` rather than a
   * migration across everybody who was playing before cameos existed, and the
   * first-run notice fires exactly while the field is missing. Either answer to
   * that notice writes something here, which is what stops it firing twice.
   */
  showBlob: 'showBlob',
} as const;

/** Field names on the `votes:` hash, kept in one place to avoid typos. */
export const voteFields = {
  a: 'a',
  b: 'b',
  guessSum: 'guessSum',
  guessCount: 'guessCount',
  errSum: 'errSum',
} as const;
