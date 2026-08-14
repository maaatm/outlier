/**
 * Keeping something remote in step with something local, when the local thing
 * changes faster than the round trip.
 *
 * The wardrobe's arrows are why this exists. A press is instant and a write is
 * not, so pressing twice quickly starts a second write while the first is still
 * out, and two rules are needed to keep that honest:
 *
 *   1. **One request at a time.** Requests that overlap can be committed in the
 *      order they arrive rather than the order they were sent, which can leave
 *      the stored value on the *first* press of a run. Serialising them removes
 *      the question.
 *   2. **Only the last write speaks.** The answer to a superseded write is
 *      already out of date by the time it lands. Applying one is what made a
 *      fast second press snap back to the item before it.
 *
 * The two together also make a run of presses cost two requests rather than one
 * per press: whichever was already going out, and one more carrying wherever the
 * run ended up. Everything in between is skipped, because nobody was ever going
 * to see it.
 *
 * Nothing here touches the DOM or the network directly — `send` and `recover`
 * are handed in — so the rules above are testable without either.
 */

export type CoalescingWriter<T, R> = {
  send: (value: T) => Promise<R>;
  /**
   * The answer to whichever write turned out to be the last one. Never called
   * for a write that something newer has already replaced.
   */
  onLatest: (result: R) => void;
  /**
   * Asked for the stored truth when a write fails, since at that point what is
   * on screen is not known to be what is stored — and an earlier write in the
   * same run may well have landed, so there is no local value worth reverting
   * to. Its answer is applied under the same rule as `onLatest`: only if
   * nothing has been pushed in the meantime. Return null to leave things alone.
   */
  recover?: () => Promise<R | null>;
};

/**
 * Returns the one way in: hand it the value that should be stored. Anything not
 * yet sent is replaced rather than queued behind it.
 */
export function coalescingWriter<T, R>({
  send,
  onLatest,
  recover,
}: CoalescingWriter<T, R>): (value: T) => void {
  // Wrapped, so that "nothing waiting" stays distinguishable from a `T` that is
  // itself null or undefined.
  let waiting: { value: T } | null = null;
  let running = false;

  /**
   * Bumped by every push. A result compares this against what it was when its
   * own write went out; if it has moved, somebody has asked for something else
   * since and this answer is no longer the answer.
   */
  let asked = 0;

  async function drain(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (waiting !== null) {
        const { value } = waiting;
        waiting = null;
        const generation = asked;

        try {
          const result = await send(value);
          if (asked === generation) onLatest(result);
        } catch {
          const truth = recover ? await recover().catch(() => null) : null;
          if (truth !== null && asked === generation) onLatest(truth);
        }
      }
    } finally {
      running = false;
    }
  }

  return (value: T) => {
    asked++;
    waiting = { value };
    void drain();
  };
}
