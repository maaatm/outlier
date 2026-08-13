/**
 * Who has banked the most points.
 *
 * Two tabs, weekly first. Points never stop being available — the archive stays
 * playable forever — so an all-time board rewards grinding it more than reading
 * the room, and it carries a lead nobody joining late can close. The week is
 * the board that greets you; all time is still there for anyone who wants it.
 *
 * Rows stay terse on purpose. **Your record** is the room next door and it owns
 * the prose about streaks and rates; if the rows here start explaining
 * themselves the two rooms are competing. Rank is carried by position, so no
 * row takes an accent — the two-accents-per-screen rule is not suspended for a
 * leaderboard.
 */

import { useEffect, useState } from 'react';

import type { BoardRange, PlayerBoardResponse } from '../../shared/types.js';
import { fetchPlayerBoard } from '../api.js';

const TABS: { id: BoardRange; label: string }[] = [
  { id: 'week', label: 'this week' },
  { id: 'all', label: 'all time' },
];

export function PlayerBoard(): React.JSX.Element {
  const [range, setRange] = useState<BoardRange>('week');
  const [board, setBoard] = useState<PlayerBoardResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    // Cleared on the way out so a slow second tab cannot show the first tab's
    // rows under the second tab's heading.
    setBoard(null);
    setFailed(false);

    fetchPlayerBoard(range)
      .then((response) => live && setBoard(response))
      .catch(() => live && setFailed(true));

    return () => {
      live = false;
    };
  }, [range]);

  return (
    <div className="detail">
      {/* The same tab idiom as the reveal's detail strip, rather than a second
          one invented for the menu. */}
      <div className="detail__tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`detail__tab${range === tab.id ? ' is-active' : ''}`}
            onClick={() => setRange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <Rows board={board} failed={failed} range={range} />
    </div>
  );
}

function Rows({
  board,
  failed,
  range,
}: {
  board: PlayerBoardResponse | null;
  failed: boolean;
  range: BoardRange;
}): React.JSX.Element {
  if (failed) {
    return <p className="notice notice--quiet">The board did not load.</p>;
  }
  if (board === null) {
    return <p className="notice notice--quiet">Loading.</p>;
  }

  // A fresh week is empty every Monday and a fresh install is empty outright.
  // Neither is an error, and neither should read like one.
  if (board.rows.length === 0) {
    return (
      <p className="notice notice--quiet">
        {range === 'week'
          ? 'Nothing banked this week yet. Answer anything and the board starts.'
          : 'Nothing banked yet. Answer anything and the board starts.'}
      </p>
    );
  }

  return (
    <>
      <ol className="board">
        {board.rows.map((row) => (
          <li key={row.userId} className="board__row board__row--player">
            <span className="board__rank">{row.rank}</span>
            <span className="board__name">{row.name}</span>
            <span className="board__points">{row.points}</span>
          </li>
        ))}
      </ol>

      {/* Returned even when the viewer is already in the list above: a board you
          are absent from is a board you stop opening, and the second glance
          costs a line. */}
      {board.you && (
        <div className="board__row board__row--player board__you">
          <span className="board__rank">{board.you.rank}</span>
          <span className="board__name">you</span>
          <span className="board__points">{board.you.points}</span>
        </div>
      )}
    </>
  );
}
