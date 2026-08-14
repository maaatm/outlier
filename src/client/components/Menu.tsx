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
  BOX_PRICE,
  CROWD_SIZE,
  HIT_THRESHOLD,
  LEADERBOARD_MIN_VOTES,
} from '../../shared/config.js';
import {
  ACCESSORIES,
  type Equipped,
  FACES,
  ITEMS,
  type Item,
  findItem,
  itemIndex,
  ownedItems,
  resolveAccessory,
  resolveFace,
  stepItem,
} from '../../shared/items.js';
import type {
  AvatarResponse,
  BoxResponse,
  DailyPointer,
  PlayerStats,
} from '../../shared/types.js';
import { fetchAvatar, fetchDaily, openBox, saveAvatar, saveShowBlob } from '../api.js';
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

  const { avatar, equip, absorb, show } = useAvatar(panel === 'record' || panel === 'wardrobe');

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
          {panel === 'record' && <Record stats={stats} avatar={avatar} onShow={show} />}
          {panel === 'wardrobe' && (
            <Wardrobe avatar={avatar} onEquip={equip} onOpened={absorb} />
          )}
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
  absorb: (box: BoxResponse) => void;
  show: (showBlob: boolean) => void;
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

  /**
   * Fold a box result into what is held, rather than refetching it.
   *
   * The response already carries both halves of what changed — the balance and,
   * on a new item, one more thing owned — so a second round trip would only be
   * a chance for the screen to flicker back to what it already knows.
   */
  function absorb(box: BoxResponse): void {
    setAvatar((current) =>
      current === null
        ? current
        : {
            ...current,
            coins: box.coins,
            owned: current.owned.includes(box.item) ? current.owned : [...current.owned, box.item],
          }
    );
  }

  /**
   * Show the blob to other players, or stop.
   *
   * Its own write rather than a field on the coalescing one above. That writer
   * exists because a stepper can be pressed faster than a round trip completes;
   * a switch cannot be, and folding this into it would mean a slow answer about
   * an accessory could arrive carrying a stale opinion about this.
   *
   * Optimistic, like equipping: the press is the answer, and the request is only
   * there to make the server agree. If it does not, the switch goes back —
   * silently, because the state it goes back to *is* the truth and a player who
   * sees it flip has been told.
   */
  function show(showBlob: boolean): void {
    setAvatar((current) => (current ? { ...current, showBlob } : current));
    saveShowBlob(showBlob).catch(() => {
      setAvatar((current) => (current ? { ...current, showBlob: !showBlob } : current));
    });
  }

  return { avatar, equip, absorb, show };
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
 *
 * The wardrobe is the one room without one. It is the only panel taller than the
 * card it sits in — a balance, a blob, two steppers and the box — and fine print
 * under all of that is a line nobody scrolls to and something for the box button
 * to collide with on the way.
 */
function Panel({
  title,
  aside,
  note,
  children,
}: {
  title: string;
  /** One figure on the title's own line. The wardrobe's balance, and nothing
   *  else so far — a room that has a single number worth carrying at all times
   *  gets it here rather than spending a row of the card on it. */
  aside?: React.ReactNode;
  note?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <>
      <div className="menu__panel">
        <div className="menu__title">
          <h1 className="menu__heading">{title}</h1>
          {aside}
        </div>
        {children}
      </div>
      {note !== undefined && <p className="notice notice--quiet">{note}</p>}
    </>
  );
}

/**
 * Banked state, read off the same counters the header shows — and the blob those
 * counters belong to.
 *
 * The blob is here to say whose record this is. The one thing on this page that
 * can be pressed sits beside it, and it is not about what the blob looks like —
 * that is the wardrobe's job — but about who else gets to see it. It belongs
 * here for the same reason the blob does: this is the page about you.
 */
function Record({
  stats,
  avatar,
  onShow,
}: {
  stats: PlayerStats;
  avatar: AvatarResponse | null;
  onShow: (showBlob: boolean) => void;
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
          best keeps the number it reached. The day turns over at midnight UTC. Points are
          the score and are never spent; coins are, in the wardrobe.
        </>
      }
    >
      <div className="record__blob">
        <Blob
          face={avatar?.face}
          accessory={avatar?.accessory}
          size={BLOB_SIZE.panel}
          label="Your blob"
        />
        {avatar?.canSave && (
          <ShowBlob showBlob={avatar.showBlob} onShow={onShow} />
        )}
      </div>

      {/* Four figures rather than three, in pairs: the coin balance belongs
          beside the totals it is earned alongside, and a fourth tile in a
          three-up grid would sit on a row of its own looking like an
          afterthought. */}
      <div className="figures figures--pairs">
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
        <div className="figure">
          <span className="figure__label">coins</span>
          <span className="figure__value">{stats.coins}</span>
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
 * Whether your blob stands in other people's crowds.
 *
 * One line of plain copy, because the thing it decides is not obvious from the
 * label and is worth being unambiguous about: turning it off is retroactive. It
 * is a filter applied every time a crowd is drawn rather than a flag stamped on
 * a vote, so switching it off takes the blob out of questions answered months
 * ago as well as the next one.
 *
 * A switch rather than two buttons, because this is a setting being read as
 * often as it is changed, and a setting should show its state without being
 * pressed.
 */
function ShowBlob({
  showBlob,
  onShow,
}: {
  showBlob: boolean;
  onShow: (showBlob: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="show-blob">
      <button
        type="button"
        className="switch"
        role="switch"
        aria-checked={showBlob}
        onClick={() => onShow(!showBlob)}
      >
        <span className="switch__track" aria-hidden="true">
          <span className="switch__knob" />
        </span>
        <span className="switch__label">Show my blob to other players</span>
      </button>
      <p className="show-blob__note">
        Other players see your blob in the crowd on questions you have both answered, on the
        side you picked. Turn it off and it comes out of every crowd, including the ones it
        is already in.
      </p>
    </div>
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
  onOpened,
}: {
  avatar: AvatarResponse | null;
  onEquip: (next: Equipped) => void;
  onOpened: (box: BoxResponse) => void;
}): React.JSX.Element {
  return (
    <Panel
      title={TITLES.wardrobe}
      /* The balance sits on the heading's line rather than on a row of its own.
         This room has to fit a 512px card without scrolling — see the note on
         `.wardrobe` in the stylesheet — and the title row was the one line here
         with space going spare.

         Absent rather than zero when signed out: a balance of nothing reads as
         an account with nothing in it, and there is no account. */
      aside={
        avatar?.canSave ? (
          <p className="menu__aside">
            <span className="menu__aside-label">coins</span>
            <span className="menu__aside-value">{avatar.coins}</span>
          </p>
        ) : undefined
      }
    >
      {/* The wrapper is unconditional so the room keeps its shape while the pair
          is in flight — a panel that re-lays-out the moment the blob arrives
          moves everything under the reader. */}
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

            {/* The steppers walk what this player owns and nothing else, using
                the same rule the equip endpoint enforces. A ring that includes
                items the server will refuse is a ring where most steps do
                nothing. */}
            <Layer
              kind="face"
              items={ownedItems(FACES, avatar.owned)}
              current={avatar.face}
              locked={!avatar.canSave}
              onPick={(id) => onEquip({ face: id, accessory: avatar.accessory })}
            />
            <Layer
              kind="accessory"
              items={ownedItems(ACCESSORIES, avatar.owned)}
              current={avatar.accessory}
              locked={!avatar.canSave}
              onPick={(id) => onEquip({ face: avatar.face, accessory: id })}
            />

            {avatar.canSave && <GiftBox avatar={avatar} onOpened={onOpened} />}
          </>
        )}
      </div>
    </Panel>
  );
}

/**
 * The box, and the one moment in this room.
 *
 * It sits under the layers because it is what fills them: the reader sees what
 * they have, then the way to have more. The count of the catalogue lives here
 * rather than beside the steppers — those now walk what you own, so this is the
 * only place left that can say how much there is to want.
 *
 * Two rows, always exactly two, because this room has a height budget and the
 * bottom of it is a button that has to stay pressable without scrolling. The
 * result takes the status row's place rather than pushing it down, and the
 * shortfall is spoken by the button itself rather than by a notice under it.
 */
function GiftBox({
  avatar,
  onOpened,
}: {
  avatar: AvatarResponse;
  onOpened: (box: BoxResponse) => void;
}): React.JSX.Element {
  const [opening, setOpening] = useState(false);
  const [result, setResult] = useState<BoxResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const affordable = avatar.coins >= BOX_PRICE;

  async function open(): Promise<void> {
    setOpening(true);
    setError(null);
    try {
      const box = await openBox();
      setResult(box);
      onOpened(box);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The box would not open.');
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="box">
      {result ? (
        <BoxResult result={result} avatar={avatar} />
      ) : (
        <div className="box__head">
          <span className="box__label">gift box</span>
          <span className="box__owned">
            you own {avatar.owned.length} of {ITEMS.length}
          </span>
        </div>
      )}

      <button
        type="button"
        className={`button box__open${affordable ? ' button--primary' : ''}`}
        disabled={!affordable || opening}
        onClick={() => void open()}
      >
        {opening
          ? 'Opening...'
          : affordable
            ? `Open a box · ${BOX_PRICE}`
            : `${BOX_PRICE - avatar.coins} more coins`}
      </button>

      {error && <p className="notice notice--quiet">{error}</p>}
    </div>
  );
}

/**
 * What came out, on one line.
 *
 * The item is drawn on the player's own blob rather than alone, because an
 * accessory is a change to a silhouette and a silhouette needs the head it
 * breaks. Rarity is the word beside the name and the colour of the row's border
 * — the same three-step ladder the layers use, which lives on this screen and no
 * other.
 *
 * Keyed on the item and the balance together, so opening two of the same
 * duplicate in a row still replays the moment rather than sitting still.
 */
function BoxResult({
  result,
  avatar,
}: {
  result: BoxResponse;
  avatar: AvatarResponse;
}): React.JSX.Element {
  // An id the catalogue no longer has is not a crash: it is a box opened across
  // a deploy that removed an item, and the receipt still has to render.
  const item = findItem(result.item);
  if (!item) {
    return (
      <p className="notice notice--quiet" key={`${result.item}:${result.coins}`}>
        Something arrived, but the wardrobe does not recognise it.
      </p>
    );
  }

  return (
    <div
      className={`box__result box__result--${item.rarity}`}
      key={`${result.item}:${result.coins}`}
      role="status"
    >
      <Blob
        face={item.kind === 'face' ? item.id : avatar.face}
        accessory={item.kind === 'accessory' ? item.id : avatar.accessory}
        size={BLOB_SIZE.inline}
      />
      <span className="box__result-name">{item.name}</span>
      <span className="box__result-meta">
        {/* The receipt is the last thing and the first thing to be cut when the
            row runs out of width: the name and the rarity are what the moment is
            about, and the refund is already in the balance above. */}
        {item.rarity} &middot; {result.duplicate ? `+${result.refunded} back` : 'new'}
      </span>
    </div>
  );
}

/**
 * One layer, and the two arrows that walk it.
 *
 * The count is spelled out beside the rarity because the arrows alone say
 * nothing about how far there is to go, and a ring with no end needs some other
 * way to tell you that you have seen all of it. It counts what you *own* now, so
 * it grows as boxes are opened — how big the catalogue is is the box's line to
 * deliver, once, rather than a reproach attached to both steppers.
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
  // One item is a ring with nowhere to go. The arrows say so rather than
  // offering a press that lands back where it started.
  const stuck = locked || items.length < 2;

  return (
    <div className={`wardrobe__layer wardrobe__layer--${item.rarity}`}>
      <div className="wardrobe__stepper">
        <button
          type="button"
          className="wardrobe__arrow"
          aria-label={`Previous ${kind}`}
          disabled={stuck}
          onClick={() => onPick(stepItem(items, current, -1).id)}
        >
          <Chevron back />
        </button>

        {/* Announced as one string on change, so a reader hears "Wink, face,
            rare, 7 of 8" rather than four separate updates racing each other.

            Which layer this is used to be a line of its own above the stepper.
            It moved into the meta because the room has a height budget and that
            line was a whole row per layer to carry one word — and the word is
            the least of what this line says. */}
        <span className="wardrobe__pick" aria-live="polite">
          <span className="wardrobe__name">{item.name}</span>
          <span className="wardrobe__meta">
            {kind} &middot; {item.rarity} &middot; {itemIndex(items, current) + 1} of{' '}
            {items.length}
          </span>
        </span>

        <button
          type="button"
          className="wardrobe__arrow"
          aria-label={`Next ${kind}`}
          disabled={stuck}
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
