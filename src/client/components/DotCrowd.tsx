/**
 * One hundred counters, tipped onto the table. Each one is a person. One of
 * them is you.
 *
 * This replaces the percentage bar. The count *is* the visual: nineteen pieces
 * against eighty-one lands harder than "19%". It is the one place in the app
 * worth spending effort on, so everything else on the screen stays quiet.
 *
 * The crowd sizes itself to whatever box it is given — it measures its parent
 * and derives the cell from that, so the counters grow to fill the slide rather
 * than sitting at a fixed size in the middle of it. When the box changes, and it
 * does the moment an answer is picked, the crowd travels to its new size instead
 * of snapping: every piece moves and resizes on one clock, so a hundred of them
 * read as a single group being scaled.
 *
 * While the player drags the slider the crowd previews their guess: the first
 * `split` counters go yellow and the rest stay cream, so the two groups appear
 * without anything moving. The grid is the same grid — colour is the only thing
 * that travels, which leaves the reveal's journey still to come.
 *
 * On reveal the counters sweep from a neutral scatter into two piles over
 * ~600ms with a 6ms stagger and a light spring overshoot. Yours lands last,
 * ~150ms behind the pack, and settles. They do not otherwise move: these are
 * moulded pieces lying on felt, and the sweep is the only moment the crowd is
 * allowed.
 *
 * ## The cameos
 *
 * On the reveal, and nowhere else, up to ten of the counters are real players
 * drawn as their own, each standing in the camp they actually answered in. They
 * are *of* the hundred rather than added to it — a cameo is one of the pieces
 * drawn larger, so the count on screen is still the count — and they are scattered
 * through their camp rather than lined up at the front of it, so the difference
 * in size reads as "some of these people are ones we know" rather than as a cast
 * standing in front of an audience.
 *
 * Three things they deliberately do not get. They do not travel on their own
 * clock: they leave the scatter with everybody else and grow into place over the
 * same 600ms, because the reveal is one moment and not two. They do not take the
 * top-left cell of your camp, which belongs to you. And they get no extra
 * imperfection — the same seeded tilt as everyone else, and nothing more.
 *
 * A counter with no name is decoration, and ten names printed under ten of them
 * is a wall of text on the most carefully composed screen in the app. So a name is
 * something you ask for: hover where a hover means something, tap where it does
 * not, and the name appears in the caption slot the crowd already has. For a
 * reader who can do neither, the field keeps its one-breath summary and the
 * names follow it as a list.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { CROWD_SIZE } from '../../shared/config.js';
import type { Equipped } from '../../shared/items.js';
import {
  DOT_RATIO,
  PER_ROW,
  PROUD_CELLS,
  REFERENCE_CELL,
  SCATTER_SPREAD,
  cameoBlob,
  cameoCapacity,
  campLayout,
  cellFor,
  scatterLayout,
} from '../crowdLayout.js';
import { counterTilt } from '../counterArt.js';
import { facedDots, jitterFor, scatterFor } from '../jitter.js';
import { Blob } from './Blob.js';

const FACES = 8;
const STAGGER_MS = 6;
/** Your counter lands this far behind the pack. */
const MINE_DELAY_MS = 150;

/**
 * One player in the crowd.
 *
 * Which camp they stand in arrives already decided, as a boolean about the
 * viewer, rather than as the side they picked. The crowd draws two camps and has
 * never known what either of them means; keeping it that way is what stops a
 * component about dots from learning about votes.
 */
export type CrowdCameo = {
  name: string;
  avatar: Equipped;
  withYou: boolean;
};

type Props = {
  /** How many of the hundred stand with you. Null before the reveal. */
  withYou: number | null;
  /**
   * The guess being previewed: this many counters go yellow and the rest stay
   * cream. The crowd stays in its scatter — only the colour moves. Null when
   * there is nothing to preview, and ignored once `withYou` arrives, because
   * the reveal has its own arrangement and its own colours.
   */
  split?: number | null;
  /** The label of the side the player picked, for the accessible summary. */
  yourLabel?: string;
  otherLabel?: string;
  /**
   * Run the travel. False when a player reopens a post they already answered —
   * the reveal is a verdict on a vote just cast, not a thing to replay.
   */
  animate?: boolean;
  /**
   * The players in this crowd. Only ever passed on the reveal: the pre-vote
   * scatter is undifferentiated on purpose, and putting known faces in it would
   * start hinting at a split nobody has earned yet.
   */
  cameos?: readonly CrowdCameo[];
  /**
   * Somebody has asked who one of them is, or stopped asking. The name goes
   * wherever the caller already had room for one.
   */
  onName?: (name: string | null) => void;
};

export function DotCrowd({
  withYou,
  split = null,
  yourLabel,
  otherLabel,
  animate = true,
  cameos = [],
  onName,
}: Props): React.JSX.Element {
  const revealed = withYou !== null;
  // The preview exists only before the reveal, and only once a side has been
  // picked — there is nothing to be with until then.
  const previewCount =
    !revealed && split !== null ? Math.min(CROWD_SIZE, Math.max(0, Math.round(split))) : null;
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

  // Who is actually drawn. A camp can hold no more cameos than it has dots —
  // see `cameoCapacity` — so a recent window that disagrees with the tally
  // loses its overflow here rather than asking the layout for room that does
  // not exist.
  const drawn = useMemo(() => splitByCamp(cameos, withYou), [cameos, withYou]);

  const layout = useMemo(
    () =>
      withYou === null
        ? scatterLayout(scatter)
        : campLayout(withYou, drawn.yours.length, drawn.theirs.length),
    [withYou, scatter, drawn]
  );

  // Which dot indices came out as blocks. Read off the layout rather than
  // worked out again here: where the blocks landed is the layout's business,
  // and a second rule for it here would be a second rule to keep in step.
  const cameoAt = useMemo(() => assignCameos(layout, drawn, withYou), [layout, drawn, withYou]);

  const cell = cellFor(box, layout);
  const dot = cell * DOT_RATIO;
  const jitterScale = cell / REFERENCE_CELL;
  const inset = cell * layout.margin;
  const blob = cameoBlob();
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

  // Which blob is currently being asked about, by index rather than by name:
  // two players are allowed to share a display name, and neither should light
  // up when the other is pointed at.
  const [asked, setAsked] = useState<number | null>(null);
  const precise = usePreciseHover();

  function name(index: number | null): void {
    setAsked(index);
    onName?.(index === null ? null : (cameoAt.get(index)?.name ?? null));
  }

  return (
    <div className="crowd" ref={boxRef}>
      <div
        className="crowd__field"
        role="img"
        aria-label={
          revealed
            ? `${withYou} of ${CROWD_SIZE} people answered ${yourLabel ?? 'the same as you'}, ` +
              `${CROWD_SIZE - (withYou ?? 0)} answered ${otherLabel ?? 'the other way'}.` +
              namesSummary(cameoAt.size)
            : previewCount !== null
              ? `Your guess: ${previewCount} of ${CROWD_SIZE} answered ` +
                `${yourLabel ?? 'the same as you'}, ${CROWD_SIZE - previewCount} ` +
                `answered ${otherLabel ?? 'the other way'}.`
              : 'A hundred people, undecided.'
        }
      >
        {cell > 0 &&
          Array.from({ length: CROWD_SIZE }, (_, index) => {
            const jitter = jitterFor(index);
            const mine = index === 0;
            const onYourSide = revealed && index < (withYou ?? 0);

            const settledHere = settled && revealed;
            const target = settledHere ? layout.places[index]! : scatter[index]!;
            const cameo = settledHere ? cameoAt.get(index) : undefined;

            // Your counter sits slightly proud of the pack.
            const proud = mine && revealed ? -cell * PROUD_CELLS : 0;

            const slotClasses = ['dot-slot'];
            if (mine && settled && revealed && animate) slotClasses.push('is-landed');
            if (cameo) slotClasses.push('dot-slot--cameo');
            if (cameo && asked === index) slotClasses.push('is-asked');

            // Orange is your camp and cream is everyone else, on every screen.
            // While the slider is moving there is no camp yet, only a guess, so
            // the counters standing with you go yellow instead — the same
            // yellow the fill under the thumb is, and a colour the reveal never
            // uses on a piece.
            const counterClasses = ['counter'];
            if (mine && revealed) counterClasses.push('counter--mine', 'counter--you');
            else if (onYourSide) counterClasses.push('counter--mine');
            else if (previewCount !== null && index < previewCount) {
              // The counters fill in index order, so a group is always a
              // contiguous run of the grid rather than a colour sprayed across
              // it.
              counterClasses.push('counter--guess');
            }

            // A cameo's counter is drawn to fit its block, so the whole shape —
            // accessory included — stays inside the crowd's measured box. The
            // block is wider than the drawing, so it is centred across it.
            const centering = cameo ? blob.inset * cell : 0;

            return (
              <span
                key={index}
                className={slotClasses.join(' ')}
                style={{
                  width: cameo ? blob.width * cell : dot,
                  height: cameo ? blob.height * cell : dot,
                  transform:
                    `translate(${(originX + inset + target.x * cell + centering + jitter.dx * jitterScale + proud).toFixed(2)}px, ` +
                    `${(originY + inset + target.y * cell + jitter.dy * jitterScale + proud).toFixed(2)}px)`,
                  transitionDelay:
                    revealed && animate
                      ? `${index * STAGGER_MS + (mine ? MINE_DELAY_MS : 0)}ms`
                      : '0ms',
                  // Handed down rather than applied here. The slot carries the
                  // travel, and CSS applies the `rotate` property *before* the
                  // `transform` one about the same origin — so tilting the slot
                  // would spin its journey around the top-left of the field
                  // instead of tipping the piece where it landed. The counter
                  // inside takes it, which is what a plain one does too.
                  '--tilt': counterTilt(index),
                }as React.CSSProperties}
                // A pointer affordance and nothing more: this sits inside a
                // `role="img"`, which prunes its own subtree, so anything
                // focusable in here would be a tab stop a screen reader could
                // not see. The list under the field is where the names actually
                // live.
                onPointerEnter={precise && cameo ? () => name(index) : undefined}
                onPointerLeave={precise && cameo ? () => name(null) : undefined}
                onClick={cameo ? () => name(asked === index ? null : index) : undefined}
              >
                {cameo ? (
                  <Blob
                    face={cameo.avatar.face}
                    accessory={cameo.avatar.accessory}
                    size={blob.width * cell}
                    // Their camp's colour, not their own: a cream counter
                    // standing in an orange camp reads as being on the other
                    // side, which is the one thing a cameo must never do.
                    fill={cameo.withYou ? 'var(--counter-mine)' : undefined}
                  />
                ) : (
                  <span className={counterClasses.join(' ')}>
                    {faces.has(index) && (
                      <>
                        <span className="counter__eye counter__eye--left" />
                        <span className="counter__eye counter__eye--right" />
                      </>
                    )}
                  </span>
                )}
              </span>
            );
          })}
      </div>

      {/*
        The names, one item each, for the reader the hover and the tap are no use
        to. Deliberately not folded into the label above: ten usernames read out
        in one breath is not a summary of anything.
      */}
      {cameoAt.size > 0 && (
        <ul className="visually-hidden">
          {[...cameoAt.values()].map((cameo, index) => (
            <li key={index}>
              u/{cameo.name} answered{' '}
              {cameo.withYou
                ? (yourLabel ?? 'the same as you')
                : (otherLabel ?? 'the other way')}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type ByCamp = { yours: CrowdCameo[]; theirs: CrowdCameo[] };

/** The cameos each camp can actually hold, in the order they will be dealt. */
function splitByCamp(cameos: readonly CrowdCameo[], withYou: number | null): ByCamp {
  if (withYou === null) return { yours: [], theirs: [] };

  return {
    yours: cameos.filter((cameo) => cameo.withYou).slice(0, cameoCapacity(withYou, true)),
    // Your own dot holds index 0 wherever it stands. Ordinarily that is the head
    // of your camp; when the rounding leaves your side with no dots at all it is
    // the head of theirs, and the cameos step around it either way.
    theirs: cameos
      .filter((cameo) => !cameo.withYou)
      .slice(0, cameoCapacity(CROWD_SIZE - withYou, withYou === 0)),
  };
}

/**
 * Which dot index each cameo was dealt to.
 *
 * The layout decides *where* the blocks landed and the placements come back in
 * reading order, so walking them in order and handing out the camp's cameos as
 * blocks turn up is the whole of it. The counts cannot disagree — both sides
 * clamp with the same `cameoCapacity` — but a missing one is skipped rather
 * than drawn as an empty block.
 */
function assignCameos(
  layout: { places: { span: number }[] },
  drawn: ByCamp,
  withYou: number | null
): Map<number, CrowdCameo> {
  const at = new Map<number, CrowdCameo>();
  if (withYou === null) return at;

  let mine = 0;
  let other = 0;
  layout.places.forEach((place, index) => {
    if (place.span < 2) return;
    const cameo = index < withYou ? drawn.yours[mine++] : drawn.theirs[other++];
    if (cameo) at.set(index, cameo);
  });

  return at;
}

/** What the field's one-breath summary says about the blobs in it. */
function namesSummary(count: number): string {
  if (count === 0) return '';
  return count === 1
    ? ' One of the crowd is a player, named in the list that follows.'
    : ` ${count} of the crowd are players, named in the list that follows.`;
}

/**
 * Whether a hover means anything here.
 *
 * The same test the stylesheet makes before letting a button lift, and for the
 * same reason: on a touch screen a hover is a tap that has not been taken back,
 * so a name shown on hover would stick until something else was pressed.
 */
function usePreciseHover(): boolean {
  const [precise, setPrecise] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(hover: hover) and (pointer: fine)');
    const read = (): void => setPrecise(query.matches);
    read();
    query.addEventListener('change', read);
    return () => query.removeEventListener('change', read);
  }, []);

  return precise;
}
