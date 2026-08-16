/**
 * Who has banked the most points.
 *
 * Two tabs, weekly first. Points never stop being available — the archive stays
 * playable forever — so an all-time board rewards grinding it more than reading
 * the room, and it carries a lead nobody joining late can close. The week is
 * the board that greets you; all time is still there for anyone who wants it.
 *
 * Which tab you are on is said with depth rather than with colour: the one you
 * are reading is a block standing on the table and the other is pressed into
 * it. That is the same rule every selected thing in the app follows, and it is
 * why neither tab needs a word explaining which is which.
 *
 * Rows stay terse on purpose. **Your record** is the room next door and it owns
 * the prose about streaks and rates; if the rows here start explaining
 * themselves the two rooms are competing.
 */

import { useEffect, useState } from 'react';

import type { BoardRange, PlayerBoardEntry, PlayerBoardResponse } from '../../shared/types.js';
import { fetchPlayerBoard } from '../api.js';
import { rowTint } from '../counterArt.js';

const TABS: { id: BoardRange; label: string }[] = [
  { id: 'week', label: 'This week' },
  { id: 'all', label: 'All time' },
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
    <>
      <div className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`button block block--yellow block--md tab${
              range === tab.id ? '' : ' tab--off'
            }`}
            aria-pressed={range === tab.id}
            onClick={() => setRange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <Rows board={board} failed={failed} range={range} />
    </>
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
    return <p className="notice notice--quiet notice--spaced">The board did not load.</p>;
  }
  if (board === null) {
    return <p className="notice notice--quiet notice--spaced">Loading.</p>;
  }

  // A fresh week is empty every Monday and a fresh install is empty outright.
  // Neither is an error, and neither should read like one.
  if (board.rows.length === 0) {
    return (
      <p className="notice notice--spaced">
        {range === 'week'
          ? 'Nothing banked this week yet. Answer anything and the board starts.'
          : 'Nothing banked yet. Answer anything and the board starts.'}
      </p>
    );
  }

  return (
    <div className="board">
      {/* The list scrolls; the well does not. That is what keeps the row below
          it on the floor of the well rather than somewhere off the bottom of a
          long board. On a wide table the same list reads across in two columns
          instead of scrolling at all. */}
      <ol className="board__rows">
        {board.rows.map((row) => (
          <Row key={row.userId} row={row} />
        ))}
      </ol>

      {/* Returned even when the viewer is already in the list above: a board you
          are absent from is a board you stop opening, and the second glance
          costs a line. Pinned, so it is the one row that never moves when the
          tab changes. */}
      {board.you && (
        <div className="board__row board__you">
          <span className="board__rank">{board.you.rank}</span>
          <span className="board__counter" aria-hidden="true" />
          <span className="board__name">you</span>
          <span className="board__points">{board.you.points}</span>
        </div>
      )}
    </div>
  );
}

/**
 * One player.
 *
 * The counter beside the name is plain — a piece in one of the three fills,
 * drawn from the id so it is stable for a given player and mixed down the
 * board. It is not their equipped one: the board knows ids, names and points,
 * and asking the server for eleven players' wardrobes would be a second round
 * trip for eleven pieces of decoration.
 */
function Row({ row }: { row: PlayerBoardEntry }): React.JSX.Element {
  return (
    <li className="board__row">
      <span className="board__rank">{row.rank}</span>
      <span className={`board__counter board__counter--${rowTint(row.userId)}`} aria-hidden="true" />
      <span className="board__name">{row.name}</span>
      <span className="board__points">{row.points}</span>
    </li>
  );
}
