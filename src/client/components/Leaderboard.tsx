/**
 * The most misjudged questions ever, as a strip that fits where the histogram
 * sits. This is the teaching surface: it shows the subreddit what a good
 * question looks like far better than a rules page does.
 */

import { useEffect, useState } from 'react';

import type { LeaderboardEntry } from '../../shared/types.js';
import { fetchLeaderboard } from '../api.js';

const ROWS = 3;

export function Leaderboard(): React.JSX.Element {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetchLeaderboard()
      .then((response) => live && setEntries(response.entries))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  if (failed || (entries !== null && entries.length === 0)) {
    return <p className="notice notice--quiet">No question has enough votes to rank yet.</p>;
  }
  if (entries === null) {
    return <p className="notice notice--quiet">Loading.</p>;
  }

  return (
    <ol className="board">
      {entries.slice(0, ROWS).map((entry) => (
        <li key={entry.id} className="board__row">
          <span className="board__text">{entry.text}</span>
          <span className="board__error">off by {entry.avgError.toFixed(1)}</span>
        </li>
      ))}
    </ol>
  );
}
