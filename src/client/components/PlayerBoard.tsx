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
import { COUNTER_SIZE, rowTint } from '../counterArt.js';
import { Blob } from './Blob.js';

const TABS: { id: BoardRange; label: string }[] = [
  { id: 'week', label: 'This week' },
  { id: 'all', label: 'All time' },
];

/**
 * The three fills a row's counter can take, keyed by what `rowTint` picked.
 *
 * Handed to the drawing rather than inherited into it. The board used to set
 * `--counter` per row and let the `fill` inside the SVG pick it up, which is a
 * custom property whose value differs between one copy of a drawing and the
 * next — the one case Chromium is liable not to repaint. A board of counters
 * would arrive wrong and correct itself the moment the pointer crossed one.
 * These three are defined once on `:root` and never redefined, so what a row
 * asks for is what a row gets on the first paint.
 */
const ROW_FILL: Record<'cream' | 'orange' | 'yellow', string> = {
  cream: 'var(--counter)',
  orange: 'var(--counter-mine)',
  yellow: 'var(--yellow)',
};

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
    return <p className="notice notice--quiet notice--spaced">Loading...</p>;
  }

  // A fresh week is empty every Monday and a fresh install is empty outright.
  // Neither is an error, and neither should read like one.
  if (board.rows.length === 0) {
    return (
      <p className="notice notice--spaced">
        {range === 'week'
          ? 'Nobody on the board this week yet. Answer a question to get on it.'
          : 'Nobody on the board yet. Answer a question to get on it.'}
      </p>
    );
  }

  return (
    <div className="board">
      {/* Nothing in the well scrolls: the well is as tall as the players in it
          and the room around it is what moves. A list scrolling inside a fixed
          well put the only draggable box on a phone in a strip that held four
          of these ten rows, which is not a board anybody can read. On a wide
          table the same list reads across in two columns — which is the one
          thing about this list the stylesheet cannot work out for itself, so
          the column's length is handed to it here. */}
      <ol
        className="board__rows"
        style={
          { '--board-rows': Math.ceil(board.rows.length / 2) } as React.CSSProperties
        }
      >
        {board.rows.map((row) => (
          <Row key={row.userId} row={row} />
        ))}
      </ol>

      {/* Returned even when the viewer is already in the list above: a board you
          are absent from is a board you stop opening, and the second glance
          costs a line. Pinned — `position: sticky` on a phone, the floor of the
          well on a wide table — so it is on screen the moment the board is,
          however far down the room the players run, and it is the one row that
          never moves when the tab changes. */}
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
 * One player, wearing what they are actually wearing.
 *
 * The counter is their own — the board pays one extra `hMGet` for the whole
 * page of them — and its fill is drawn from the id, so the pieces read as a
 * handful of different people rather than a column of identical discs. The
 * colour carries no meaning: it is stable for a given player and mixed down
 * the board, and that is all it is for.
 *
 * A counter's drawing is half again as tall as the piece in it, because the
 * accessory lives above the disc. The cell here is the disc's size and the
 * drawing hangs out of the top of it, which is what puts the ears above the
 * row instead of stretching every row to fit them.
 */
function Row({ row }: { row: PlayerBoardEntry }): React.JSX.Element {
  return (
    <li className="board__row">
      <span className="board__rank">{row.rank}</span>
      <span className="board__avatar">
        <Blob
          face={row.avatar.face}
          accessory={row.avatar.accessory}
          size={COUNTER_SIZE.row}
          fill={ROW_FILL[rowTint(row.userId)]}
        />
      </span>
      <span className="board__name">{row.name}</span>
      <span className="board__points">{row.points}</span>
    </li>
  );
}
