/**
 * The wordmark: a counter, then `UTLIER`.
 *
 * One component at two sizes rather than two drawings — 58px on the menu root,
 * 22px in the header — because the two have to stay the same mark, and the only
 * way to guarantee that is for there to be one of them. The geometry lives next
 * door in `wordmarkArt.ts`, where it is tested.
 *
 * ## How it is sized
 *
 * The prop is the nominal size, and it is what the derived numbers are computed
 * against. Everything below the wrapper is then written in `em`, so the whole
 * lockup — disc, overlap, both bottom faces, both shadows — scales with the
 * wrapper's font size and holds its proportions exactly.
 *
 * That is what lets the stylesheet keep the responsive steps the wordmark
 * already had, in the same three media queries every other responsive step in
 * this app lives in: `--wm-step` is the size CSS chose and `--wm-size` is the
 * size the component was given, and the wrapper reads the first that is there.
 * The alternative was a viewport subscription per call site, which is a lot of
 * machinery for what is a font size.
 *
 * ## Accessibility
 *
 * The letters spell `utlier`, because the disc is the O. Nothing must ever
 * announce that. So the lockup is one `img` with an `aria-label`, and both the
 * disc and the letters are hidden from the tree beneath it.
 */

import { WORDMARK_MIN_SIZE, wordmarkGeometry } from '../wordmarkArt.js';

export function Wordmark({ size }: { size: number }): React.JSX.Element {
  /*
   * Under the floor there is no counter to draw, so this is real text and needs
   * none of the treatment above it: no `img` role and no label, because
   * `Outlier` already reads as `Outlier`.
   */
  if (size < WORDMARK_MIN_SIZE) {
    return (
      <span
        className="wordmark wordmark--plain"
        style={{ '--wm-size': `${size}px` } as React.CSSProperties}
      >
        Outlier
      </span>
    );
  }

  const g = wordmarkGeometry(size);
  /* Exact at the nominal size, proportional at any other. */
  const em = (px: number): string => `${px / size}em`;

  return (
    <span
      className="wordmark"
      role="img"
      aria-label="Outlier"
      style={
        {
          '--wm-size': `${size}px`,
          '--wm-disc': em(g.disc),
          '--wm-overlap': em(g.overlap),
          '--wm-depth': em(g.depth),
          '--wm-mould': em(g.mould),
          '--wm-shadow-y': em(g.shadowY),
          '--wm-shadow-blur': em(g.shadowBlur),
        } as React.CSSProperties
      }
    >
      {/* The tilt is on the disc and not on the wrapper: the counter is the one
          thing in this app allowed to rotate, and the letters stay level. The
          eyes are children of the disc, so they go round with it. */}
      <span className="wordmark__disc" aria-hidden="true">
        <span className="wordmark__eye wordmark__eye--left" />
        <span className="wordmark__eye wordmark__eye--right" />
      </span>
      <span className="wordmark__text" aria-hidden="true">
        utlier
      </span>
    </span>
  );
}
