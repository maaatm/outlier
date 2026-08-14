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
 *
 * ## The cameos
 *
 * On the reveal, and nowhere else, up to ten of the dots are real players drawn
 * as their blobs, each standing in the camp they actually answered in. They are
 * *of* the hundred rather than added to it — a cameo is one of the dots drawn
 * larger, so the count on screen is still the count — and they are pulled to the
 * front of their camp with the pack flowing around them, so the difference in
 * size reads as "these are the ones we know" rather than as a second population.
 *
 * Three things they deliberately do not get. They do not travel on their own
 * clock: they leave the scatter with everybody else and grow into place over the
 * same 600ms, because the reveal is one moment and not two. They do not take the
 * top-left cell of your camp, which belongs to your dot. And they get no extra
 * imperfection — the same seeded jitter as everyone else, and nothing more.
 *
 * A blob with no name is decoration, and ten names printed under ten blobs is a
 * wall of text on the most carefully composed screen in the app. So a name is
 * something you ask for: hover where a hover means something, tap where it does
 * not, and the name appears in the caption slot the crowd already has. For a
 * reader who can do neither, the field keeps its one-breath summary and the
 * names follow it as a list.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { BadgeAccent } from '../../shared/badges.js';
import { CROWD_SIZE } from '../../shared/config.js';
import type { Equipped } from '../../shared/items.js';
import type { GroupColors } from '../colors.js';
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
import { facedDots, hashUnit, jitterFor, scatterFor } from '../jitter.js';
import { Blob } from './Blob.js';

const FACES = 8;
const STAGGER_MS = 6;
/** Your dot lands this far behind the pack. */
const MINE_DELAY_MS = 150;

/** Idle bob, in seconds. Each dot picks its own from a seeded hash. */
const BOB_MIN = 1.9;
const BOB_MAX = 3.4;

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
  accent,
  split = null,
  groupColors = null,
  yourLabel,
  otherLabel,
  animate = true,
  cameos = [],
  onName,
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

  // Who is actually drawn, and where in the index order they sit. A camp can
  // hold no more cameos than it has dots — see `cameoCapacity` — so a recent
  // window that disagrees with the tally loses its overflow here rather than
  // asking the layout for room that does not exist.
  const drawn = useMemo(() => byIndex(cameos, withYou), [cameos, withYou]);

  const layout = useMemo(
    () =>
      withYou === null
        ? scatterLayout(scatter)
        : campLayout(withYou, drawn.yours.length, drawn.theirs.length),
    [withYou, scatter, drawn]
  );

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
    onName?.(index === null ? null : (drawn.at.get(index)?.name ?? null));
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
              namesSummary(drawn.at.size)
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

            const settledHere = settled && revealed;
            const target = settledHere ? layout.places[index]! : scatter[index]!;
            const cameo = settledHere ? drawn.at.get(index) : undefined;

            // Your dot sits slightly proud of the pack.
            const proud = mine && revealed ? -cell * PROUD_CELLS : 0;

            const slotClasses = ['dot-slot'];
            if (mine && settled && revealed && animate) slotClasses.push('is-landed');
            if (cameo) slotClasses.push('dot-slot--cameo');
            if (cameo && asked === index) slotClasses.push('is-asked');

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

            // A cameo's blob is drawn to fit its block, so the whole shape —
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
                  rotate: cameo ? `${jitter.rotation.toFixed(2)}deg` : undefined,
                }}
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
                    // Their camp's colour, not their own: a neutral blob
                    // standing in an accented camp reads as being on the other
                    // side, which is the one thing a cameo must never do.
                    fill={cameo.withYou ? `var(--${accent})` : undefined}
                  />
                ) : (
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
      {drawn.at.size > 0 && (
        <ul className="visually-hidden">
          {[...drawn.at.values()].map((cameo, index) => (
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

/**
 * The cameos, split by camp and mapped onto the indices they are drawn at.
 *
 * The index order is the one the layout packs in: your dot, then your camp's
 * cameos, then the rest of your camp, then the other camp's cameos, then the
 * rest of it. Keeping the two in step here — rather than having the layout hand
 * back the assignment — is what lets the render loop go on using a plain index
 * for its stagger, its jitter and its bob.
 */
function byIndex(
  cameos: readonly CrowdCameo[],
  withYou: number | null
): { yours: CrowdCameo[]; theirs: CrowdCameo[]; at: Map<number, CrowdCameo> } {
  const at = new Map<number, CrowdCameo>();
  if (withYou === null) return { yours: [], theirs: [], at };

  const yours = cameos
    .filter((cameo) => cameo.withYou)
    .slice(0, cameoCapacity(withYou, true));
  const theirs = cameos
    .filter((cameo) => !cameo.withYou)
    .slice(0, cameoCapacity(CROWD_SIZE - withYou, withYou === 0));

  // Your dot holds index 0 wherever it stands. Ordinarily that is the head of
  // your own camp; when the rounding leaves your side with no dots at all it is
  // the head of theirs, and the cameos step around it either way.
  yours.forEach((cameo, index) => at.set(1 + index, cameo));
  theirs.forEach((cameo, index) => at.set(Math.max(withYou, 1) + index, cameo));

  return { yours, theirs, at };
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
