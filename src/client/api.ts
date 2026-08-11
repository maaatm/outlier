/** Thin fetch wrapper. Every call goes to the app's own `/api/` server. */

import type {
  ApiError,
  CommentResponse,
  LeaderboardResponse,
  Reveal,
  StateResponse,
} from '../shared/types.js';

export class ApiFailure extends Error {
  readonly status: number;
  /** Present on a 409: the reveal this player already earned. */
  readonly reveal: Reveal | undefined;

  constructor(message: string, status: number, reveal?: Reveal) {
    super(message);
    this.name = 'ApiFailure';
    this.status = status;
    this.reveal = reveal;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiFailure('Could not reach the server.', 0);
  }

  const body = (await response.json().catch(() => null)) as (T & ApiError) | null;

  if (!response.ok) {
    throw new ApiFailure(
      body?.error ?? 'Something went wrong.',
      response.status,
      body?.reveal
    );
  }
  if (body === null) throw new ApiFailure('The server sent nothing back.', response.status);
  return body;
}

export function fetchState(postId: string): Promise<StateResponse> {
  return request<StateResponse>(`/api/state/${encodeURIComponent(postId)}`);
}

export function castVote(postId: string, choice: 'a' | 'b', guess: number): Promise<Reveal> {
  return request<Reveal>('/api/vote', {
    method: 'POST',
    body: JSON.stringify({ postId, choice, guess }),
  });
}

export function postComment(postId: string, note?: string): Promise<CommentResponse> {
  return request<CommentResponse>('/api/comment', {
    method: 'POST',
    body: JSON.stringify({ postId, note }),
  });
}

export function fetchLeaderboard(): Promise<LeaderboardResponse> {
  return request<LeaderboardResponse>('/api/leaderboard');
}
