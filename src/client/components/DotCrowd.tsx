/**
 * One hundred dots. Each dot is a person. One of them is you.
 *
 * This replaces the percentage bar. The count *is* the visual: nineteen dots
 * against eighty-one lands harder than "19%". It is the one place in the app
 * worth spending effort on, so everything else on the screen stays quiet.
 *
 * On reveal the dots travel from a neutral scatter into two camps over ~600ms
 * with a 6ms stagger and a light spring overshoot. Your dot lands last, ~150ms
 * behind the pack, with a small pop.
 */

import { useEffect, useMemo, useState } from 'react';

import type { BadgeAccent } from '../../shared/badges.js';
import { CROWD_SIZE } from '../../shared/config.js';
import { facedDots, jitterFor, scatterFor } from '../jitter.js';

const CELL = 20;
const PER_ROW = 10;
/** Separation between your camp and theirs. */
const CAMP_GAP = 14;
const FACES = 8;
const STAGGER_MS = 6;
/** Your dot lands this far behind the pack. */
const MINE_DELAY_MS = 150;

type Props = {
  /** How many of the hundred stand with you. Null before the reveal. */
  withYou: number | null;
  accent: BadgeAccent;
  /** The label of the side the player picked, for the accessible summary. */
  yourLabel?: string;
  otherLabel?: string;
  /**
   * Run the travel. False when a player reopens a post they already answered —
   * the reveal is a verdict on a vote just cast, not a thing to replay.
   */
  animate?: boolean;
};

type Placement = { x: number; y: number };

/**
 * Two blocks, ten to a row: your camp on top, theirs below, with a gap between.
 * The row counts carry the proportion on their own.
 */
function campLayout(withYou: number): { places: Placement[]; height: number } {
  const yourRows = Math.ceil(withYou / PER_ROW);
  const places: Placement[] = [];

  for (let i = 0; i < CROWD_SIZE; i++) {
    const mine = i < withYou;
    const indexInCamp = mine ? i : i - withYou;
    const row = Math.floor(indexInCamp / PER_ROW);
    const column = indexInCamp % PER_ROW;
    places.push({
      x: column * CELL,
      y: row * CELL + (mine ? 0 : yourRows * CELL + CAMP_GAP),
    });
  }

  const theirRows = Math.ceil((CROWD_SIZE - withYou) / PER_ROW);
  const gap = withYou > 0 && withYou < CROWD_SIZE ? CAMP_GAP : 0;
  return { places, height: (yourRows + theirRows) * CELL + gap };
}

const CROWD_WIDTH = PER_ROW * CELL;
/**
 * Fixed for every state. Two camps split across a row boundary need eleven
 * rows, and a box that resized between the scatter and the camps would shove
 * the rest of the page around mid-reveal.
 */
const CROWD_HEIGHT = 11 * CELL + CAMP_GAP;

export function DotCrowd({
  withYou,
  accent,
  yourLabel,
  otherLabel,
  animate = true,
}: Props): React.JSX.Element {
  const revealed = withYou !== null;

  // Held one frame so the dots mount in the scatter and then transition out of
  // it. Painting them straight into the camps would skip the whole moment.
  const [settled, setSettled] = useState(revealed && !animate);

  useEffect(() => {
    if (!revealed) {
      setSettled(false);
      return;
    }
    if (!animate) {
      setSettled(true);
      return;
    }
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  }, [revealed, animate]);

  const faces = useMemo(() => facedDots(FACES, CROWD_SIZE), []);
  const layout = useMemo(() => campLayout(withYou ?? 0), [withYou]);

  return (
    <div
      className="crowd"
      style={{ width: CROWD_WIDTH, height: CROWD_HEIGHT }}
      role="img"
      aria-label={
        revealed
          ? `${withYou} of ${CROWD_SIZE} people answered ${yourLabel ?? 'the same as you'}, ` +
            `${CROWD_SIZE - (withYou ?? 0)} answered ${otherLabel ?? 'the other way'}.`
          : 'A hundred people, undecided.'
      }
    >
      {Array.from({ length: CROWD_SIZE }, (_, index) => {
        const jitter = jitterFor(index);
        const mine = index === 0;
        const onYourSide = revealed && index < (withYou ?? 0);

        const resting = layout.places[index]!;
        const scatter = scatterFor(index, PER_ROW, CELL);
        const target = settled && revealed ? resting : scatter;

        // Your dot sits slightly proud of the pack.
        const proud = mine && revealed ? -3 : 0;

        const classes = ['dot'];
        if (mine && revealed) classes.push('dot--mine', `dot--${accent}`);
        else if (onYourSide) classes.push(`dot--${accent}`);
        if (mine && settled && revealed && animate) classes.push('is-landed');

        return (
          <span
            key={index}
            className={classes.join(' ')}
            style={{
              transform:
                `translate(${(target.x + jitter.dx + proud).toFixed(2)}px, ` +
                `${(target.y + jitter.dy + proud).toFixed(2)}px) ` +
                `rotate(${jitter.rotation.toFixed(2)}deg)`,
              transitionDelay:
                revealed && animate
                  ? `${index * STAGGER_MS + (mine ? MINE_DELAY_MS : 0)}ms`
                  : '0ms',
            }}
          >
            {faces.has(index) && (
              <>
                <span className="dot__eye dot__eye--left" />
                <span className="dot__eye dot__eye--right" />
              </>
            )}
          </span>
        );
      })}
    </div>
  );
}
