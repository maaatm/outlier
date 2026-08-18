/**
 * The X, drawn rather than typed.
 *
 * The bundled fonts are subsetted to the Latin ranges they need, so a
 * multiplication sign or a dingbat would fall through to whatever the device
 * happens to have. A stroked path is two lines of markup and always the same
 * shape.
 *
 * Its own file because three things close now — the blob notice, the join offer
 * and the ledger — and two of them live in `App.tsx` while the third is in
 * `Menu.tsx`, which `App.tsx` imports. A copy in each would be the same drawing
 * twice, and importing back the other way would be a cycle.
 */
export function Cross(): React.JSX.Element {
  return (
    <svg className="cross" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M 4 4 L 12 12 M 12 4 L 4 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
