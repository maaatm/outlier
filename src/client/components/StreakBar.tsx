/**
 * The two counters. `playStreak` is the habit, `readStreak` is the brag.
 *
 * Sun is the only colour used here and it is used nowhere else in the app.
 */

import type { Streaks } from '../../shared/types.js';

export function StreakBar({ streaks }: { streaks: Streaks }): React.JSX.Element {
  return (
    <div className="streaks">
      <span className={`streak${streaks.extendedToday ? ' streak--live' : ''}`}>
        played
        <span className="streak__count">{streaks.playStreak}</span>
      </span>
      <span className={`streak${streaks.extendedToday && streaks.readStreak > 0 ? ' streak--live' : ''}`}>
        read
        <span className="streak__count">{streaks.readStreak}</span>
      </span>
    </div>
  );
}
