/**
 * What a control pays, on the control.
 *
 * An incentive nobody knows about is not one, and the point of decision is the
 * button itself rather than a line of fine print under it — so the rate travels
 * with the label instead of in a paragraph the reader has already walked past.
 *
 * Two things separate it from the label it follows, and neither is doing the
 * job alone: it keeps its own case where the label is shouted, and it takes its
 * own colour — the deep orange coins already carry on a cream block, the dark
 * ink on an orange one, where that same orange would be invisible. Both are
 * accents these screens already have rather than a new one, and the number is
 * bracketed as well, so nothing here rests on colour.
 *
 * Its own file because three screens carry it — the menu list, the ask room and
 * the share slide — and the last of those does not otherwise know the menu
 * exists.
 */
export function CoinTag({ coins }: { coins: number }): React.JSX.Element {
  return <span className="coin-tag">(+{coins} Coins)</span>;
}
