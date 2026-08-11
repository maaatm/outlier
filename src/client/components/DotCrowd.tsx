/**
 * One hundred dots. Each dot is a person. One of them is you.
 *
 * This replaces the percentage bar. The count *is* the visual: nineteen dots
 * against eighty-one lands harder than "19%". It is the one place in the app
 * worth spending effort on, so everything else on the screen stays quiet.
 *
 * The crowd sizes itself to whatever box it is given — it measures its parent
 * and derives the cell from that, so the dots grow to fill the slide rather
 * than sitting at a fixed size in the middle of it. When the box changes, and it
 * does the moment an answer is picked, the crowd travels to its new size instead
 * of snapping: every dot moves and resizes on one clock, so a hundred of them
 * read as a single group being scaled.
 *
 * While the player drags the slider the crowd previews their guess: the first
 * `split` dots take one colour and the rest take the other, so the two groups
 * appear without anything moving. The grid is the same grid — colour is the only
 * thing that travels, which leaves the reveal's journey still to come.
 *
 * On reveal the dots travel from a neutral scatter into two camps over ~600ms
 * with a 6ms stagger and a light spring overshoot. Your dot lands last, ~150ms
 * behind the pack, with a small pop. Underneath all of that they bob gently and
 * out of step with each other, so the crowd reads as alive rather than parked.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { BadgeAccent } from '../../shared/badges.js';
import { CROWD_SIZE } from '../../shared/config.js';
import type { GroupColors } from '../colors.js';
import { facedDots, hashUnit, jitterFor, scatterFor } from '../jitter.js';

const PER_ROW = 10;
/** Blank space between the two camps, in cells. */
const CAMP_GAP_CELLS = 0.7;

/** A dot fills most of its cell; the remainder is the breathing room. */
const DOT_RATIO = 0.9;
/** The size everything was tuned against, so jitter scales with the cell. */
const REFERENCE_CELL = 20;

/** Jitter is ±2px at the reference cell, which is a constant in cells. */
const JITTER_CELLS = 2 / REFERENCE_CELL;
/** How far your dot sits proud of the pack, up and to the left. */
const PROUD_CELLS = 0.16;
/** How far a dot strays from its cell in the pre-reveal scatter. */
const SCATTER_SPREAD = 0.45;

const FACES = 8;
const STAGGER_MS = 6;
/** Your dot lands this far behind the pack. */
const MINE_DELAY_MS = 150;

/** Idle bob, in seconds. Each dot picks its own from a seeded hash. */
const BOB_MIN = 1.9;
const BOB_MAX = 3.4;

type Props = {
  /** How many of the hundred stand with you. Null before the reveal. */
  withYou: number | null;
  accent: BadgeAccent;
  /**
   * The guess being previewed: this many dots take one colour, the rest the
   * other. The crowd stays in its scatter — only the colours move. Null when
   * there is nothing to preview, and ignored once `withYou` arrives, because the
   * reveal has its own arrangement and its own accent.
   */
  split?: number | null;
  /** The pair the preview is drawn in. Without it there is no preview. */
  groupColors?: GroupColors | null;
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
 * Where the dots rest, and the box that exactly holds them.
 *
 * The box is measured from the arrangement actually on screen rather than from
 * a worst case, so the crowd fills the space it is given and sits centered in
 * it — a fifty-fifty split needs ten rows, a fifty-five split needs eleven, and
 * the scatter before the reveal needs ten. Everything is in cells; the caller
 * multiplies by the measured cell size.
 */
type Layout = {
  places: Placement[];
  width: number;
  height: number;
  /** Slack on every side, for what strays outside its cell. Kept symmetric so
      the crowd stays centered in the box. */
  margin: number;
};

/** How much room a run of `count` cells needs: the span, the dot, the slack. */
function extent(count: number, margin: number): number {
  return count - 1 + DOT_RATIO + margin * 2;
}

/**
 * Two blocks, ten to a row: your camp on top, theirs below, with a gap between.
 * The row counts carry the proportion on their own.
 */
function campLayout(withYou: number): Layout {
  const yourRows = Math.ceil(withYou / PER_ROW);
  const otherRows = Math.ceil((CROWD_SIZE - withYou) / PER_ROW);
  // Nothing to separate when one camp took every dot.
  const gap = yourRows > 0 && otherRows > 0 ? CAMP_GAP_CELLS : 0;
  const places: Placement[] = [];

  for (let i = 0; i < CROWD_SIZE; i++) {
    const mine = i < withYou;
    const indexInCamp = mine ? i : i - withYou;
    const row = Math.floor(indexInCamp / PER_ROW);
    const column = indexInCamp % PER_ROW;
    places.push({
      x: column,
      y: row + (mine ? 0 : yourRows + gap),
    });
  }

  // Your dot is the top-left one, so its proud offset is what decides the slack.
  const margin = JITTER_CELLS + PROUD_CELLS;
  return {
    places,
    width: extent(PER_ROW, margin),
    height: extent(yourRows + otherRows, margin) + gap,
    margin,
  };
}

/** The loose neutral scatter, which strays a good part of a cell either way. */
function scatterLayout(places: Placement[]): Layout {
  const margin = SCATTER_SPREAD + JITTER_CELLS;
  return {
    places,
    width: extent(PER_ROW, margin),
    height: extent(Math.ceil(CROWD_SIZE / PER_ROW), margin),
    margin,
  };
}

/** Largest cell that fits the whole layout into the measured box. */
function cellFor(box: { width: number; height: number }, layout: Layout): number {
  if (box.width <= 0 || box.height <= 0) return 0;
  return Math.min(box.width / layout.width, box.height / layout.height);
}

export function DotCrowd({
  withYou,
  accent,
  split = null,
  groupColors = null,
  yourLabel,
  otherLabel,
  animate = true,
}: Props): React.JSX.Element {
  const revealed = withYou !== null;
  // The preview exists only before the reveal, and only once there is a pair of
  // colours to draw it in.
  const preview =
    !revealed && groupColors !== null && split !== null
      ? { colors: groupColors, count: Math.min(CROWD_SIZE, Math.max(0, Math.round(split))) }
      : null;
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  // Measured before paint so the dots never flash at the wrong size, then kept
  // in step with the box as the slide or the viewport changes.
  useLayoutEffect(() => {
    const element = boxRef.current;
    if (!element) return;

    const measure = (): void => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      setBox((last) => (last.width === width && last.height === height ? last : { width, height }));
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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
  const scatter = useMemo(
    () =>
      Array.from({ length: CROWD_SIZE }, (_, index) =>
        scatterFor(index, PER_ROW, 1, SCATTER_SPREAD)
      ),
    []
  );
  const layout = useMemo(
    () => (withYou === null ? scatterLayout(scatter) : campLayout(withYou)),
    [withYou, scatter]
  );

  const cell = cellFor(box, layout);
  const dot = cell * DOT_RATIO;
  const jitterScale = cell / REFERENCE_CELL;
  const inset = cell * layout.margin;
  /*
   * The field is the whole box, and the crowd is centered inside it by this
   * offset. Sizing the field to the crowd instead and letting flex center it
   * would be simpler to read, but the box changes size — the guess screen gives
   * the crowd less room than the question screen does — and a field that resizes
   * teleports its own origin, taking every dot with it in a single frame. With
   * the centering carried in the transform there is nothing to teleport: every
   * dot's target moves, and every dot's transition takes it there.
   */
  const originX = (box.width - cell * layout.width) / 2;
  const originY = (box.height - cell * layout.height) / 2;

  return (
    <div className="crowd" ref={boxRef}>
      <div
        className="crowd__field"
        role="img"
        aria-label={
          revealed
            ? `${withYou} of ${CROWD_SIZE} people answered ${yourLabel ?? 'the same as you'}, ` +
              `${CROWD_SIZE - (withYou ?? 0)} answered ${otherLabel ?? 'the other way'}.`
            : preview
              ? `Your guess: ${preview.count} of ${CROWD_SIZE} answered ` +
                `${yourLabel ?? 'the same as you'}, ${CROWD_SIZE - preview.count} ` +
                `answered ${otherLabel ?? 'the other way'}.`
              : 'A hundred people, undecided.'
        }
      >
        {cell > 0 &&
          Array.from({ length: CROWD_SIZE }, (_, index) => {
            const jitter = jitterFor(index);
            const mine = index === 0;
            const onYourSide = revealed && index < (withYou ?? 0);

            const target = settled && revealed ? layout.places[index]! : scatter[index]!;

            // Your dot sits slightly proud of the pack.
            const proud = mine && revealed ? -cell * PROUD_CELLS : 0;

            const slotClasses = ['dot-slot'];
            if (mine && settled && revealed && animate) slotClasses.push('is-landed');

            const dotClasses = ['dot'];
            if (mine && revealed) dotClasses.push('dot--mine', `dot--${accent}`);
            else if (onYourSide) dotClasses.push(`dot--${accent}`);

            // Which group this dot is in while the slider moves. The dots fill
            // in index order, so a group is always a contiguous run of the grid
            // rather than a colour sprayed across it.
            const groupColor = preview
              ? index < preview.count
                ? preview.colors.yours
                : preview.colors.theirs
              : undefined;

            const bob = BOB_MIN + hashUnit(index, 21) * (BOB_MAX - BOB_MIN);

            return (
              <span
                key={index}
                className={slotClasses.join(' ')}
                style={{
                  width: dot,
                  height: dot,
                  transform:
                    `translate(${(originX + inset + target.x * cell + jitter.dx * jitterScale + proud).toFixed(2)}px, ` +
                    `${(originY + inset + target.y * cell + jitter.dy * jitterScale + proud).toFixed(2)}px)`,
                  transitionDelay:
                    revealed && animate
                      ? `${index * STAGGER_MS + (mine ? MINE_DELAY_MS : 0)}ms`
                      : '0ms',
                }}
              >
                <span
                  className={dotClasses.join(' ')}
                  style={{
                    // The dot's own transition carries this, so a dot crossing
                    // the boundary fades rather than flicks.
                    backgroundColor: groupColor,
                    rotate: `${jitter.rotation.toFixed(2)}deg`,
                    // Out of step on purpose: a crowd bobbing in unison reads
                    // as a machine, not as people.
                    animationDuration: `${bob.toFixed(2)}s`,
                    animationDelay: `${(hashUnit(index, 22) * -bob).toFixed(2)}s`,
                  }}
                >
                  {faces.has(index) && (
                    <>
                      <span className="dot__eye dot__eye--left" />
                      <span className="dot__eye dot__eye--right" />
                    </>
                  )}
                </span>
              </span>
            );
          })}
      </div>
    </div>
  );
}
