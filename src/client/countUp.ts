/**
 * A number that counts up to its target once, on mount.
 *
 * The point total is the only number in the app that is *earned* rather than
 * reported, so it is the only one that arrives moving. Everything else on the
 * slide is already at its final value when the slide appears.
 *
 * The reduced-motion check has to happen here rather than in the stylesheet:
 * the movement is in the value, and no media query can reach it. With motion
 * reduced the number starts at its target and never travels — the same final
 * state the animation would have landed on.
 */

import { useEffect, useState } from 'react';

/** Short enough to read as a flourish rather than a wait. */
const DURATION_MS = 700;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function useCountUp(target: number, animate: boolean): number {
  const [value, setValue] = useState(() => (animate && !prefersReducedMotion() ? 0 : target));

  useEffect(() => {
    if (!animate || prefersReducedMotion()) {
      setValue(target);
      return;
    }

    let frame = 0;
    let start = 0;

    const step = (now: number): void => {
      if (start === 0) start = now;
      const elapsed = Math.min(1, (now - start) / DURATION_MS);
      // Ease-out cubic: the count sprints away, then settles onto the number
      // instead of stopping dead on it.
      setValue(Math.round(target * (1 - (1 - elapsed) ** 3)));
      if (elapsed < 1) frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, animate]);

  return value;
}
