/**
 * The two camps on the guess screen, coloured.
 *
 * Unlike everything in `jitter.ts` — which is seeded so the crowd looks drawn
 * rather than randomised — this pair is drawn fresh each time a question opens.
 * The colours carry no meaning beyond "these dots, not those", so a new pair
 * each time keeps either side from reading as the app's own answer.
 *
 * Saturation and lightness are fixed. Only the hue moves, so whatever comes out
 * still holds its own against the 2px ink border in both light and dark mode.
 */

export type GroupColors = {
  /** The side the player picked. */
  yours: string;
  /** Everyone else. */
  theirs: string;
};

const SATURATION = 72;
const LIGHTNESS = 52;

/**
 * How far apart the two hues sit. Anything under a right angle reads as one
 * colour and a slightly wrong version of it, which is exactly the thing the
 * split is supposed to make obvious.
 */
const MIN_SEPARATION = 100;
const MAX_SEPARATION = 260;

/** Two clearly different colours, one per group. */
export function randomGroupColors(): GroupColors {
  const first = Math.random() * 360;
  const second = first + MIN_SEPARATION + Math.random() * (MAX_SEPARATION - MIN_SEPARATION);
  return { yours: hue(first), theirs: hue(second) };
}

function hue(degrees: number): string {
  const wrapped = ((degrees % 360) + 360) % 360;
  return `hsl(${wrapped.toFixed(0)} ${SATURATION}% ${LIGHTNESS}%)`;
}
