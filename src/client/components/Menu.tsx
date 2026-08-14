/**
 * The main menu.
 *
 * Reached from the comment slide, which is the one place in the loop where the
 * player has finished the question and has nothing left to tap. It is also the
 * whole of the pinned menu post, where somebody may be meeting the game for the
 * first time.
 *
 * Everything in the list is a read — what they have banked, who is ahead, the
 * questions the subreddit misjudged most. Nothing on this screen can change a
 * vote, and nothing on it exposes a tally the player has not already earned. The
 * wardrobe is the one thing here that writes, and what it writes is what their
 * blob looks like.
 *
 * The one exception is the Daily action at the top, which is not a room: every
 * entry below it opens in place, and that one leaves the post entirely. It sits
 * above the rule for exactly that reason — a player should be able to tell which
 * way a control goes before tapping it.
 */

import { navigateTo } from '@devvit/web/client';
import { useEffect, useRef, useState } from 'react';

import {
  BLOB_SIZE,
  CROWD_SIZE,
  HIT_THRESHOLD,
  LEADERBOARD_MIN_VOTES,
} from '../../shared/config.js';
import {
  ACCESSORIES,
  type Equipped,
  FACES,
  type Item,
  itemIndex,
  resolveAccessory,
  resolveFace,
  stepItem,
} from '../../shared/items.js';
import type { AvatarResponse, DailyPointer, PlayerStats } from '../../shared/types.js';
import { fetchAvatar, fetchDaily, saveAvatar } from '../api.js';
import { coalescingWriter } from '../coalesce.js';
import { Blob } from './Blob.js';
import { MisjudgedBoard } from './MisjudgedBoard.js';
import { PlayerBoard } from './PlayerBoard.js';
import { StatBar } from './StatBar.js';
import { WobbleRule } from './WobbleRule.js';

type PanelId = 'record' | 'wardrobe' | 'board' | 'misjudged';

const TITLES: Record<PanelId, string> = {
  record: 'Your record',
  wardrobe: 'Wardrobe',
  board: 'Leaderboard',
  misjudged: 'Hardest to read',
};

type Entry = {
  id: PanelId;
  /** One dry line under the label. Says what the room holds, not why to open it. */
  blurb: string;
};

/**
 * The wardrobe sits next to Your record because both are about the player and
 * everything below them is about everyone else. It is the only room in the list
 * that writes anything, which is the one thing its blurb has to make obvious.
 */
const ENTRIES: Entry[] = [
  { id: 'record', blurb: 'your blob, your streak, and how often you read the room' },
  { id: 'wardrobe', blurb: 'change the face and the accessory your blob wears' },
  { id: 'board', blurb: 'who has banked the most points' },
  { id: 'misjudged', blurb: 'what the subreddit misjudged most' },
];

/** How many leaderboard rows fit here. The reveal's strip shows fewer. */
const BOARD_ROWS = 5;

/**
 * Reddit hands back permalinks as paths, and `navigateTo` throws on anything it
 * cannot parse as a whole URL, so the origin is applied at the last moment
 * rather than stored on the wire as part of the permalink.
 */
const REDDIT_ORIGIN = 'https://www.reddit.com';

/**
 * `onExit` is absent on the pinned menu post, where the menu *is* the post and
 * there is no question behind it to go back to. The button goes with it rather
 * than sitting there pointing at nothing.
 *
 * `postId` is the post the menu is open on, and is only used to ask the server
 * whether that post is today's Daily. The menu post has no question on it, so
 * the server cannot work it out from a `post:` lookup.
 */
export function Menu({
  stats,
  postId,
  onExit,
}: {
  stats: PlayerStats;
  postId?: string;
  onExit?: () => void;
}): React.JSX.Element {
  const [panel, setPanel] = useState<PanelId | null>(null);
  const showBack = panel !== null || onExit !== undefined;

  // Fetched here rather than in `Root`, which remounts on every trip into a
  // room and back: one pointer per menu open, and no second flash of the
  // disabled state on the way back to the list.
  const [daily, setDaily] = useState<DailyPointer | null>(null);
  useEffect(() => {
    let live = true;
    fetchDaily(postId)
      .then((pointer) => live && setDaily(pointer))
      // A pointer that never arrives leaves the button inert. Better than
      // offering a trip to a post that may not be there.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [postId]);

  const { avatar, equip } = useAvatar(panel === 'record' || panel === 'wardrobe');

  return (
    <main className="app">
      {/* The same header as the game, down to the counters, so opening the menu
          moves nothing on the way in or back out. */}
      <header className="header">
        <span className="header__mark">Outlier</span>
        <span className="header__day">menu</span>
        <StatBar stats={stats} />
      </header>

      <section className="card">
        {/* Keyed so a page change remounts and cross-fades, and so a panel
            opened after a long one starts at the top rather than mid-scroll. */}
        <div className="menu__body fade-in" key={panel ?? 'root'}>
          {panel === null && <Root onOpen={setPanel} daily={daily} />}
          {panel === 'record' && <Record stats={stats} avatar={avatar} />}
          {panel === 'wardrobe' && <Wardrobe avatar={avatar} onEquip={equip} />}
          {panel === 'board' && <Board />}
          {panel === 'misjudged' && <Misjudged />}
        </div>

        {showBack && (
          <button
            type="button"
            className="button menu__back"
            onClick={() => (panel === null ? onExit?.() : setPanel(null))}
          >
            {panel === null ? 'Back to the question' : 'Back to the menu'}
          </button>
        )}
      </section>
    </main>
  );
}

/**
 * The equipped pair, fetched the first time a room needs it and held for the
 * rest of the menu's life.
 *
 * It lives up in `Menu` rather than inside `Record`, which unmounts on the way
 * into the wardrobe: state held in either room would refetch on every trip
 * between the two and flash the starter blob in the gap. The menu root never
 * pays for it at all, because nothing there shows a blob.
 */
function useAvatar(needed: boolean): {
  avatar: AvatarResponse | null;
  equip: (next: Equipped) => void;
} {
  const [avatar, setAvatar] = useState<AvatarResponse | null>(null);

  useEffect(() => {
    if (!needed || avatar !== null) return;
    let live = true;
    fetchAvatar()
      .then((next) => live && setAvatar(next))
      // Nothing to say if it never arrives: the rooms render the starter pair
      // while this is null, which is what the player would be wearing anyway.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [needed, avatar]);

  /*
   * One writer for the life of the menu, built on first render rather than in a
   * `useMemo`, which is free to throw its result away. A second writer would be
   * a second thing able to have a write in flight, and having only one is half
   * of what it is for.
   */
  const write = useRef<((next: Equipped) => void) | null>(null);
  write.current ??= coalescingWriter<Equipped, AvatarResponse>({
    send: saveAvatar,
    onLatest: setAvatar,
    recover: () => fetchAvatar().catch(() => null),
  });

  function equip(next: Equipped): void {
    if (avatar === null) return;

    // What is drawn is settled here and by nothing else. A press is instant, so
    // the round trip it starts has nothing to add to the picture — it is only
    // there to make the server agree, and `coalesce.ts` is what stops a slow
    // answer to an old press from arriving as if it were news.
    setAvatar((current) => (current ? { ...current, ...next } : current));
    write.current?.(next);
  }

  return { avatar, equip };
}

/** The list itself, under the wordmark, with the one way out above it. */
function Root({
  onOpen,
  daily,
}: {
  onOpen: (id: PanelId) => void;
  daily: DailyPointer | null;
}): React.JSX.Element {
  return (
    <div className="menu__root">
      <div>
        <h1 className="menu__wordmark">Outlier</h1>
        {/* With the rules gone to the sidebar, this is the only thing in the app
            that says what the game is. It has to name both things being scored
            without turning into a rules page. */}
        <p className="menu__tagline">
          One question a day about ordinary behavior. Answer it, then guess how many
          people out of {CROWD_SIZE} answered the same way. You are scored on both &mdash;
          how unusual your answer was, and how close the guess landed.
        </p>
        <DailyAction daily={daily} />
        <WobbleRule salt={11} />
      </div>

      <ul className="menu__list">
        {ENTRIES.map((entry) => (
          <li key={entry.id}>
            <button type="button" className="button menu__item" onClick={() => onOpen(entry.id)}>
              <span className="menu__item-label">{TITLES[entry.id]}</span>
              <span className="menu__item-blurb">{entry.blurb}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The trip out to today's Daily.
 *
 * Inert while the pointer is in flight rather than absent: this sits at the top
 * of the screen, so a control that arrives a moment late shifts everything under
 * it just as the reader settles on it.
 *
 * `none` is the one state that is not a button at all. There is nothing to press
 * until midnight, and a disabled button invites a press.
 */
function DailyAction({ daily }: { daily: DailyPointer | null }): React.JSX.Element {
  if (daily?.state === 'none') {
    return (
      <p className="notice notice--quiet menu__daily">
        Tomorrow&rsquo;s question posts at midnight UTC.
      </p>
    );
  }

  if (daily?.state === 'here') {
    return (
      <button type="button" className="button menu__daily" disabled>
        You&rsquo;re on today&rsquo;s question
      </button>
    );
  }

  const permalink = daily?.permalink;
  const played = daily?.state === 'voted';

  return (
    <button
      type="button"
      // Answered already, so it still travels — it just stops being the thing to
      // do next, and gives up the primary fill accordingly.
      className={`button menu__daily${played ? '' : ' button--primary'}`}
      disabled={!permalink}
      onClick={() => permalink && navigateTo(new URL(permalink, REDDIT_ORIGIN).toString())}
    >
      {played ? "You've played today's" : "Today's question"}
    </button>
  );
}

/**
 * Every panel is the same shape: a title with its substance under it, flowing
 * from the top, and one quiet footnote pinned to the bottom of the card. The
 * footnote is where the fine print goes — the rule that would clutter the
 * substance above it but that somebody will eventually want.
 */
function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <>
      <div className="menu__panel">
        <h1 className="menu__heading">{title}</h1>
        {children}
      </div>
      <p className="notice notice--quiet">{note}</p>
    </>
  );
}

/**
 * Banked state, read off the same counters the header shows — and the blob those
 * counters belong to.
 *
 * The blob is here to say whose record this is, and nothing more: the way to
 * change it is its own room on the menu, so this one stays what it has always
 * been, a page of totals with nothing on it to press.
 */
function Record({
  stats,
  avatar,
}: {
  stats: PlayerStats;
  avatar: AvatarResponse | null;
}): React.JSX.Element {
  const rate =
    stats.totalPlayed > 0 ? Math.round((stats.totalHits / stats.totalPlayed) * 100) : 0;

  return (
    <Panel
      title={TITLES.record}
      note={
        <>
          streak counts days you answered something, not questions &mdash; a second one the
          same day pays points but does not move it. Miss a day and it goes back to zero;
          best keeps the number it reached. The day turns over at midnight UTC.
        </>
      }
    >
      <Blob
        face={avatar?.face}
        accessory={avatar?.accessory}
        size={BLOB_SIZE.panel}
        label="Your blob"
      />

      <div className="figures">
        <div className="figure">
          <span className="figure__label">streak</span>
          <span className="figure__value">{stats.streak}</span>
        </div>
        <div className="figure">
          <span className="figure__label">best</span>
          <span className="figure__value">{stats.bestStreak}</span>
        </div>
        <div className="figure">
          <span className="figure__label">points</span>
          <span className="figure__value">{stats.points}</span>
        </div>
      </div>

      {stats.totalPlayed > 0 ? (
        <p className="axis__line">
          {stats.totalPlayed} {stats.totalPlayed === 1 ? 'question' : 'questions'} answered.
          You landed within {HIT_THRESHOLD} points on {stats.totalHits} of them &mdash;{' '}
          {rate}%.
        </p>
      ) : (
        <p className="axis__line">Nothing banked yet. Answer anything and the counters start.</p>
      )}
    </Panel>
  );
}

/**
 * The blob you are making, and the two layers it is made of.
 *
 * A blob is a face with an accessory over it, so the wardrobe is that same pair
 * of layers with a way to step through each — the face above, the accessory
 * below, in the order they stack. Everything is on one screen at one time: the
 * grid this replaced put nine tiles under nine more and made choosing an
 * accessory a scroll away from seeing what it looked like on.
 *
 * There is no save button and no confirm. Stepping *is* equipping, and the blob
 * at the top redrawing is the whole receipt — this is a two-tap game and the
 * wardrobe should not be the heaviest screen in it.
 *
 * Rarity is the colour of the layer's border and the word beside the count. The
 * colours are their own tokens rather than any of the four the rest of the app
 * assigns meanings to, and they appear on this screen and no other — see the
 * note on the ladder in `styles.css`.
 */
function Wardrobe({
  avatar,
  onEquip,
}: {
  avatar: AvatarResponse | null;
  onEquip: (next: Equipped) => void;
}): React.JSX.Element {
  return (
    <Panel
      title={TITLES.wardrobe}
      note={
        <>
          Every change is worn straight away &mdash; there is nothing to save. An accessory
          is drawn to break the outline of the dot rather than sit inside it, because that
          is what still reads when you are one of a hundred.
        </>
      }
    >
      {/* The wrapper is unconditional so the room keeps its shape while the pair
          is in flight — the centring hangs off it, and a panel that re-centres
          the moment the blob arrives moves everything under the reader. */}
      <div className="wardrobe">
        {avatar === null ? (
          <p className="notice notice--quiet">Loading.</p>
        ) : (
          <>
            <div className="wardrobe__preview">
              <Blob
                face={avatar.face}
                accessory={avatar.accessory}
                size={BLOB_SIZE.wardrobe}
                label={`Your blob: ${resolveFace(avatar.face).name}, ${resolveAccessory(
                  avatar.accessory
                ).name}`}
              />
            </div>

            {!avatar.canSave && (
              <p className="notice notice--quiet">Sign in to change your blob.</p>
            )}

            <Layer
              kind="face"
              items={FACES}
              current={avatar.face}
              locked={!avatar.canSave}
              onPick={(id) => onEquip({ face: id, accessory: avatar.accessory })}
            />
            <Layer
              kind="accessory"
              items={ACCESSORIES}
              current={avatar.accessory}
              locked={!avatar.canSave}
              onPick={(id) => onEquip({ face: avatar.face, accessory: id })}
            />
          </>
        )}
      </div>
    </Panel>
  );
}

/**
 * One layer, and the two arrows that walk it.
 *
 * The count is spelled out beside the rarity because the arrows alone say
 * nothing about how far there is to go, and a ring with no end needs some other
 * way to tell you that you have seen all of it.
 */
function Layer({
  kind,
  items,
  current,
  locked,
  onPick,
}: {
  kind: string;
  items: readonly Item[];
  current: string;
  locked: boolean;
  onPick: (id: string) => void;
}): React.JSX.Element {
  const item = items[itemIndex(items, current)]!;

  return (
    <div className={`wardrobe__layer wardrobe__layer--${item.rarity}`}>
      <p className="wardrobe__layer-label">{kind}</p>
      <div className="wardrobe__stepper">
        <button
          type="button"
          className="wardrobe__arrow"
          aria-label={`Previous ${kind}`}
          disabled={locked}
          onClick={() => onPick(stepItem(items, current, -1).id)}
        >
          <Chevron back />
        </button>

        {/* Announced as one string on change, so a reader hears "Wink, rare, 7
            of 8" rather than three separate updates racing each other. */}
        <span className="wardrobe__pick" aria-live="polite">
          <span className="wardrobe__name">{item.name}</span>
          <span className="wardrobe__meta">
            {item.rarity} &middot; {itemIndex(items, current) + 1} of {items.length}
          </span>
        </span>

        <button
          type="button"
          className="wardrobe__arrow"
          aria-label={`Next ${kind}`}
          disabled={locked}
          onClick={() => onPick(stepItem(items, current, 1).id)}
        >
          <Chevron back={false} />
        </button>
      </div>
    </div>
  );
}

/**
 * The arrows, drawn rather than typed.
 *
 * The bundled fonts are subsetted to the Latin ranges they need, so an arrow
 * glyph would fall through to whatever the device happens to have. A stroked
 * path is two lines of markup, always the same shape, and is the drawing
 * language the rest of the app is already in.
 */
function Chevron({ back }: { back: boolean }): React.JSX.Element {
  return (
    <svg className="chevron" viewBox="0 0 12 20" width="12" height="20" aria-hidden="true">
      <path
        d={back ? 'M 9.5 3 L 2.5 10 L 9.5 17' : 'M 2.5 3 L 9.5 10 L 2.5 17'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Players by points banked, weekly by default. */
function Board(): React.JSX.Element {
  return (
    <Panel
      title={TITLES.board}
      note={
        <>
          Points are banked per vote, so every question pays &mdash; the Daily, an open
          question, or one from the archive. The weekly board starts over on Monday at
          midnight UTC; all time never resets.
        </>
      }
    >
      <PlayerBoard />
    </Panel>
  );
}

function Misjudged(): React.JSX.Element {
  return (
    <Panel
      title={TITLES.misjudged}
      note={
        <>
          Average gap between guess and reality, across every vote a question has taken.{' '}
          {LEADERBOARD_MIN_VOTES} votes to qualify.
        </>
      }
    >
      <MisjudgedBoard rows={BOARD_ROWS} />
    </Panel>
  );
}
