/**
 * The divider under the question. An inline SVG path with a slight hand-drawn
 * waver rather than an `<hr>` — a straight rule is the giveaway that nobody
 * drew anything.
 */

import { useMemo } from 'react';

import { wobblePath } from '../jitter.js';

export function WobbleRule({ salt = 5 }: { salt?: number }): React.JSX.Element {
  const path = useMemo(() => wobblePath(320, salt), [salt]);

  return (
    <svg
      className="rule"
      viewBox="0 0 320 8"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
