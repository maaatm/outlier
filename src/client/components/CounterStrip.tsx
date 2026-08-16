/**
 * Your camp alone, in a band under the header.
 *
 * The score slide and the share slide come after the crowd has already been
 * spent, so neither of them gets to stage it again — but arriving at a page of
 * numbers with no trace of the hundred people they are about would be a
 * different game's screen. This is the trace: the pieces that stood with you,
 * tipped into a fixed strip, still overlapping and still tilted.
 *
 * It is not the crowd. It never travels, it is never measured against a box,
 * and nothing in it can be pointed at — `DotCrowd` owns all of that and this
 * deliberately borrows none of it. What the two share is the paint and the
 * seeded tilt, which is what makes the same nineteen people recognisable one
 * slide later.
 *
 * How big a piece is comes from how many there are, in three steps rather than
 * from a measurement: a camp of ninety has to fit the same band as a camp of
 * nine, and a band that measured itself would be a second thing to keep in
 * step with the crowd's own arithmetic for no gain.
 */

import { useMemo } from 'react';

import { CROWD_SIZE } from '../../shared/config.js';
import { counterTilt } from '../counterArt.js';
import { facedDots } from '../jitter.js';

/** The same share of the crowd that gets a face there: a few, not all. */
const FACE_RATE = 0.08;

export function CounterStrip({ count, label }: { count: number; label: string }): React.JSX.Element {
  const shown = Math.max(0, Math.min(CROWD_SIZE, Math.round(count)));
  const faces = useMemo(
    () => facedDots(Math.round(shown * FACE_RATE), shown, 9),
    [shown]
  );

  const size = shown <= 24 ? '' : shown <= 48 ? ' strip--some' : ' strip--many';

  return (
    <div className={`strip${size}`} role="img" aria-label={label}>
      {Array.from({ length: shown }, (_, index) => (
        <span
          key={index}
          className="strip__piece"
          style={{ '--tilt': counterTilt(index) } as React.CSSProperties}
        >
          <span
            // The first piece is you, wherever the camp starts — the same
            // standing your counter has in the crowd, and the same collar.
            className={`counter counter--mine${index === 0 ? ' counter--you' : ''}`}
          >
            {faces.has(index) && (
              <>
                <span className="counter__eye counter__eye--left" />
                <span className="counter__eye counter__eye--right" />
              </>
            )}
          </span>
        </span>
      ))}
    </div>
  );
}
