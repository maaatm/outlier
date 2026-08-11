/**
 * The most misjudged questions ever.
 *
 * This is the teaching surface: it shows the subreddit what a good question
 * looks like far better than a rules page does.
 */

import { useEffect, useState } from 'react';

import type { LeaderboardEntry } from '../../shared/types.js';
import { fetchLeaderboard } from '../api.js';

export function Leaderboard(): React.JSX.Element | null {
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

  if (failed || entries === null || entries.length === 0) return null;

  return (
    <div className="card">
      <p className="section__title">hardest to read, all time</p>
      <ol className="board">
        {entries.map((entry) => (
          <li key={entry.id} className="board__row">
            <span className="board__text">{entry.text}</span>
            <span className="board__error">off by {entry.avgError.toFixed(1)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
