/** Wire types shared by the client and the server. */

import type { BadgeId } from './badges.js';
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
  /** No further votes accepted once the Daily is locked. */
  locked: boolean;
};

/** Raw counts. Never sent to a player who has not voted. */
export type Tally = {
  a: number;
  b: number;
  total: number;
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
};

/** The two counters in the header, plus what the menu reads off them. */
export type PlayerStats = {
  /** Consecutive UTC days with at least one vote on them. */
  streak: number;
  /** The longest `streak` ever reached. A missed day never reduces it. */
  bestStreak: number;
  /** Lifetime points. */
  points: number;
  totalPlayed: number;
  /** Votes inside `HIT_THRESHOLD`, which is what the read rate is made of. */
  totalHits: number;
  /** True once today's vote is in, so the streak tile can go live. */
  extendedToday: boolean;
};

/** `GET /api/state/:postId`. Tallies are present only once `reveal` is. */
export type StateResponse = {
  question: Question;
  /** Present if and only if this user has already voted. */
  reveal: Reveal | null;
  /** Header counters, whether or not they have voted today. */
  stats: PlayerStats;
  /** Signed-out users can read the question but cannot vote. */
  canVote: boolean;
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
};

export type SubmitQuestionRequest = {
  text: string;
  labelA: string;
  labelB: string;
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

/** One row of the most-misjudged-questions leaderboard. */
export type LeaderboardEntry = {
  id: string;
  text: string;
  avgError: number;
  votes: number;
  source: QuestionSource;
};

export type LeaderboardResponse = {
  entries: LeaderboardEntry[];
};

export type ApiError = {
  error: string;
  /** Populated on a 409 so the client can render the reveal it already earned. */
  reveal?: Reveal;
};
