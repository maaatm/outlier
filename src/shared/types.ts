/** Wire types shared by the client and the server. */

import type { BadgeId } from './badges.js';

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
  /** Open questions do not count toward streaks. */
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
  /** Streak state after this vote. Absent for open questions. */
  streaks?: Streaks;
  /** The comment the player can post with one tap. */
  commentPreview: string;
  /** Set once this player has posted their comment. */
  commented: boolean;
};

export type Streaks = {
  playStreak: number;
  readStreak: number;
  totalPlayed: number;
  totalHits: number;
  /** True only on the vote that extended the streak, for the counter animation. */
  extendedToday: boolean;
};

/** `GET /api/state/:postId`. Tallies are present only once `reveal` is. */
export type StateResponse = {
  question: Question;
  /** Present if and only if this user has already voted. */
  reveal: Reveal | null;
  /** Streak state for the header, whether or not they have voted today. */
  streaks: Streaks;
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
