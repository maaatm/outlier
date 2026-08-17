/**
 * The wordmark's geometry, in the one place its numbers are decided.
 *
 * The wordmark is one orange counter followed by the letters `UTLIER`. The
 * counter is the default game piece — plain disc, two eyes, moulded bottom
 * face — tilted the way a piece lands on the table and overlapping the U. It is
 * deliberately not a letter: it reads as a counter dropped into the word, which
 * is why it is drawn from the same orange as the primary button rather than
 * from anything typographic.
 *
 * Everything here scales off one number, the font size `S`, so the lockup is
 * one component used at two sizes rather than two drawings kept in step by
 * hand. The ratios are chosen to land exactly on the reference at both of the
 * sizes the reference documents:
 *
 *              S = 58 (menu)   S = 22 (header)
 *   disc            46              17
 *   overlap         -3              -1
 *   depth            7               3
 *   mould            4               2
 *   shadowY         13               5
 *   shadowBlur      16               7
 *
 * `shadowY` and `shadowBlur` hang off the depth rather than off `S`, because
 * the reference's blur is not linear in `S` — 16/58 against 7/22 — but is
 * linear in the depth. Which is also what that shadow physically is: the piece
 * is lifted by `depth`, and the shadow it throws is a reading of that lift.
 *
 * Pure, and in its own module rather than inside the component, for the same
 * reason `counterArt.ts` is: the numbers are the part worth pinning down in a
 * test, and a test in this repo does not render React.
 */

/**
 * Below this the eyes stop resolving and the lockup gives way to plain type.
 *
 * The eyes are 18% of a disc that is itself 79% of the font size, so at 18px
 * they are already under 2.6px across. Smaller than that and the counter reads
 * as a smudge with an O's job — worse than the O it replaced. The fallback is
 * not a smaller lockup; it is no lockup.
 */
export const WORDMARK_MIN_SIZE = 18;

/** The two sizes the reference documents, and the only two the app asks for. */
export const WORDMARK_SIZE = {
  /** The menu root, on the felt. */
  menu: 58,
  /** The app header, on every screen that shows the wordmark. */
  header: 22,
} as const;

export type WordmarkGeometry = {
  /** Disc diameter, px. */
  disc: number;
  /** How far the disc sits over the U, px. Negative — it is a margin. */
  overlap: number;
  /** The bottom face on both the disc and the letters, px. */
  depth: number;
  /** The counter's own moulded edge, inset along its bottom, px. */
  mould: number;
  /** Offset of the soft shadow cast on the felt, px. */
  shadowY: number;
  /** Blur of that shadow, px. */
  shadowBlur: number;
};

/**
 * The lockup at one font size.
 *
 * The depth has a floor because a bottom face thinner than 3px stops being a
 * face and becomes a dark line under a circle. Nothing else has one: every
 * other number here is still legible as it shrinks, and the size floor above is
 * what stops the whole thing being asked to work at 9px.
 */
export function wordmarkGeometry(size: number): WordmarkGeometry {
  const depth = Math.max(3, Math.round(size * 0.12));

  return {
    disc: Math.round(size * 0.79),
    overlap: -Math.round(size * 0.05),
    depth,
    mould: Math.max(1, Math.round(size * 0.07)),
    shadowY: Math.round(depth * 1.8),
    shadowBlur: Math.round(depth * 2.3),
  };
}
