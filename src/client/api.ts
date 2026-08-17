/** Thin fetch wrapper. Every call goes to the app's own `/api/` server. */

import type {
  ApiError,
  AvatarRequest,
  AvatarResponse,
  BoardRange,
  BoxResponse,
  CommentResponse,
  DailyPointer,
  EarningsResponse,
  JoinResponse,
  PlayerBoardResponse,
  Reveal,
  StateResponse,
  SubmitQuestionRequest,
  SubmitQuestionResponse,
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

/**
 * `choice` and `guess` are a fallback the server only reads when it has no
 * stored vote for this player, which happens under REPLAY_MODE. Normally it
 * ignores them and uses what it recorded.
 */
export function postComment(
  postId: string,
  note: string | undefined,
  answer: { choice: 'a' | 'b'; guess: number }
): Promise<CommentResponse> {
  return request<CommentResponse>('/api/comment', {
    method: 'POST',
    body: JSON.stringify({ postId, note, ...answer }),
  });
}

/**
 * Ask the subreddit something. The one call in this file that creates a post.
 *
 * Every rule the room checks before enabling its button is checked again on the
 * other side of this, and that side is the gate: the client's copy exists to
 * save a round trip, not to decide anything. A refusal comes back as an
 * `ApiFailure` carrying the server's own words, which is what the room shows —
 * 429 for the day's allowance, 409 for the same question twice, 400 for the
 * rest.
 */
export function submitQuestion(input: SubmitQuestionRequest): Promise<SubmitQuestionResponse> {
  return request<SubmitQuestionResponse>('/api/submit', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Who has banked the most points. One read per tab, no cache behind it. */
export function fetchPlayerBoard(range: BoardRange): Promise<PlayerBoardResponse> {
  return request<PlayerBoardResponse>(`/api/leaderboard/players?range=${range}`);
}

/** What this player is wearing, and everything they own. */
export function fetchAvatar(): Promise<AvatarResponse> {
  return request<AvatarResponse>('/api/avatar');
}

/**
 * Put a pair on. The server re-checks both ids against the catalogue and the
 * slot they arrived in, so this is a request rather than an instruction.
 */
export function saveAvatar(equipped: AvatarRequest): Promise<AvatarResponse> {
  return request<AvatarResponse>('/api/avatar', {
    method: 'POST',
    body: JSON.stringify(equipped),
  });
}

/**
 * Decide whether your blob may stand in other players' crowds.
 *
 * The same endpoint as the wardrobe's, carrying only this — the reveal's
 * first-run notice is one of the two callers and it has no idea what the player
 * is wearing. A settings endpoint for one boolean would have been the third
 * thing to keep in step with the other two.
 */
export function saveShowBlob(showBlob: boolean): Promise<AvatarResponse> {
  return request<AvatarResponse>('/api/avatar', {
    method: 'POST',
    body: JSON.stringify({ showBlob }),
  });
}

/**
 * Open a gift box.
 *
 * No arguments, because there is nothing about this the client gets to decide:
 * the price, the roll and the refund are all the server's, and this is the
 * request that says "go". What comes back is the receipt.
 */
export function openBox(): Promise<BoxResponse> {
  return request<BoxResponse>('/api/box/open', { method: 'POST' });
}

/**
 * Where the coins came from.
 *
 * Fetched on opening Your record and nowhere else, which is also what marks the
 * ledger seen — so the dot on the menu goes out because this ran, not because a
 * second call said it had.
 */
export function fetchEarnings(): Promise<EarningsResponse> {
  return request<EarningsResponse>('/api/earnings');
}

/**
 * Join the subreddit and take the free box, or say no thanks.
 *
 * One call for both answers, because they are one decision written to one
 * field. The server subscribes either way it is asked to join — the grant is
 * the part that happens once.
 */
export function joinSubreddit(decline = false): Promise<JoinResponse> {
  return request<JoinResponse>('/api/join', {
    method: 'POST',
    body: JSON.stringify({ decline }),
  });
}

/**
 * Where today's Daily is. `from` is the post the menu is open on, which is the
 * only way the server can tell that the Daily is the post you are already
 * standing on — the pinned menu post has no question to look it up by.
 */
export function fetchDaily(from?: string): Promise<DailyPointer> {
  const query = from ? `?from=${encodeURIComponent(from)}` : '';
  return request<DailyPointer>(`/api/daily${query}`);
}
