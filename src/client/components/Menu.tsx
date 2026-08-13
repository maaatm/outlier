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
import { useEffect, useState } from 'react';

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
  STARTER_ACCESSORY,
} from '../../shared/items.js';
import type { AvatarResponse, DailyPointer, PlayerStats } from '../../shared/types.js';
import { fetchAvatar, fetchDaily, saveAvatar } from '../api.js';
import { Blob } from './Blob.js';
import { MisjudgedBoard } from './MisjudgedBoard.js';
import { PlayerBoard } from './PlayerBoard.js';
import { StatBar } from './StatBar.js';
import { WobbleRule } from './WobbleRule.js';

type PanelId = 'record' | 'board' | 'misjudged' | 'wardrobe';

/**
 * Every room's title, including the one that is not in the list below.
 *
 * The wardrobe is deliberately missing from `ENTRIES`. The menu is two levels
 * and no more, and a wardrobe reached from the blob it changes is more obvious
 * than a fourth line in a list of things to read. It is the only room that opens
 * from inside another, which is also why it is the only one whose way back goes
 * somewhere other than the root.
 */
const TITLES: Record<PanelId, string> = {
  record: 'Your record',
  board: 'Leaderboard',
  misjudged: 'Hardest to read',
  wardrobe: 'Wardrobe',
};

type Entry = {
  id: PanelId;
  /** One dry line under the label. Says what the room holds, not why to open it. */
  blurb: string;
};

const ENTRIES: Entry[] = [
  { id: 'record', blurb: 'your blob, your streak, and how often you read the room' },
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
          {panel === 'record' && (
            <Record stats={stats} avatar={avatar} onChange={() => setPanel('wardrobe')} />
          )}
          {panel === 'board' && <Board />}
          {panel === 'misjudged' && <Misjudged />}
          {panel === 'wardrobe' && <Wardrobe avatar={avatar} onEquip={equip} />}
        </div>

        {showBack && (
          <button
            type="button"
            className="button menu__back"
            onClick={() => {
              if (panel === null) onExit?.();
              // The one room opened from inside another is the one that goes
              // back to it rather than to the list.
              else setPanel(panel === 'wardrobe' ? 'record' : null);
            }}
          >
            {panel === null
              ? 'Back to the question'
              : panel === 'wardrobe'
                ? 'Back to your record'
                : 'Back to the menu'}
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

  function equip(next: Equipped): void {
    if (avatar === null) return;
    const previous = avatar;

    // The tap is the whole interaction, so the grid marks the new pick now
    // rather than a round trip later. A refused save puts the old pair back —
    // the server decides what is worn, this only decides what is drawn.
    setAvatar({ ...avatar, ...next });
    saveAvatar(next)
      .then(setAvatar)
      .catch(() => setAvatar(previous));
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
 * The blob is above the figures because it is the only thing in the room that is
 * a choice rather than a total, and because **Change** has to be next to the
 * thing it changes for the wardrobe to be findable at all.
 */
function Record({
  stats,
  avatar,
  onChange,
}: {
  stats: PlayerStats;
  avatar: AvatarResponse | null;
  onChange: () => void;
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
      <div className="record__blob">
        <Blob
          face={avatar?.face}
          accessory={avatar?.accessory}
          size={BLOB_SIZE.panel}
          label="Your blob"
        />
        {/* Disabled until the pair arrives, for the same reason the Daily button
            is: a control that changes state under the pointer is worse than one
            that was briefly inert. */}
        <button
          type="button"
          className="button button--quiet"
          onClick={onChange}
          disabled={avatar === null}
        >
          Change
        </button>
      </div>

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
 * Two racks and no save button.
 *
 * Tapping equips. This is a two-tap game and the wardrobe should not be the
 * heaviest screen in it, so there is nothing to confirm and nothing to commit —
 * the blob above the racks changing is all the receipt the change needs.
 *
 * Rarity is a word on the tile and the weight of the tile's outline, and no
 * colour at all: the screen is allowed two accents with one meaning each, and a
 * rarity ladder would spend five of them here on its own.
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
          Tapping puts something on &mdash; there is nothing to save. An accessory is drawn
          to break the outline of the dot rather than sit inside it, because that is what
          still reads when you are one of a hundred.
        </>
      }
    >
      {avatar === null ? (
        <p className="notice notice--quiet">Loading.</p>
      ) : (
        <div className="wardrobe">
          <div className="wardrobe__preview">
            <Blob face={avatar.face} accessory={avatar.accessory} size={BLOB_SIZE.panel} />
          </div>

          {!avatar.canSave && <p className="notice notice--quiet">Sign in to change your blob.</p>}

          <Rack label="faces" items={FACES} equipped={avatar} onEquip={onEquip} />
          <Rack label="accessories" items={ACCESSORIES} equipped={avatar} onEquip={onEquip} />
        </div>
      )}
    </Panel>
  );
}

/** One kind's worth of tiles. Both racks are the same grid. */
function Rack({
  label,
  items,
  equipped,
  onEquip,
}: {
  label: string;
  items: readonly Item[];
  equipped: AvatarResponse;
  onEquip: (next: Equipped) => void;
}): React.JSX.Element {
  return (
    <div className="wardrobe__rack">
      <p className="wardrobe__rack-label">{label}</p>
      <ul className="wardrobe__grid">
        {items.map((item) => {
          const face = item.kind === 'face';
          const worn = face ? equipped.face === item.id : equipped.accessory === item.id;

          // What tapping this tile would leave you in.
          const next: Equipped = face
            ? { face: item.id, accessory: equipped.accessory }
            : { face: equipped.face, accessory: item.id };

          /*
           * What the tile draws, which is not the same thing. A face tile shows
           * the face bare, so the only thing varying down the rack is the face;
           * an accessory has to sit on a head, so it borrows the one being worn.
           */
          const shown: Equipped = face
            ? { face: item.id, accessory: STARTER_ACCESSORY.id }
            : next;

          return (
            <li key={item.id}>
              <button
                type="button"
                className={`button wardrobe__tile wardrobe__tile--${item.rarity}${
                  worn ? ' is-worn' : ''
                }`}
                aria-pressed={worn}
                disabled={!equipped.canSave}
                onClick={() => onEquip(next)}
              >
                <Blob face={shown.face} accessory={shown.accessory} size={BLOB_SIZE.panel} />
                <span className="wardrobe__name">{item.name}</span>
                <span className="wardrobe__meta">
                  {worn ? `${item.rarity} · worn` : item.rarity}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
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
