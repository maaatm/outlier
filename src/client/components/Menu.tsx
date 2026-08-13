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
 * vote, and nothing on it exposes a tally the player has not already earned.
 *
 * The one exception is the Daily action at the top, which is not a room: every
 * entry below it opens in place, and that one leaves the post entirely. It sits
 * above the rule for exactly that reason — a player should be able to tell which
 * way a control goes before tapping it.
 */

import { navigateTo } from '@devvit/web/client';
import { useEffect, useState } from 'react';

import { CROWD_SIZE, HIT_THRESHOLD, LEADERBOARD_MIN_VOTES } from '../../shared/config.js';
import type { DailyPointer, PlayerStats } from '../../shared/types.js';
import { fetchDaily } from '../api.js';
import { Leaderboard } from './Leaderboard.js';
import { StatBar } from './StatBar.js';
import { WobbleRule } from './WobbleRule.js';

type PanelId = 'record' | 'board' | 'misjudged';

type Entry = {
  id: PanelId;
  label: string;
  /** One dry line under the label. Says what the room holds, not why to open it. */
  blurb: string;
};

const ENTRIES: Entry[] = [
  { id: 'record', label: 'Your record', blurb: 'streak, points, and how often you read the room' },
  { id: 'board', label: 'Leaderboard', blurb: 'who has banked the most points' },
  { id: 'misjudged', label: 'Hardest to read', blurb: 'what the subreddit misjudged most' },
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
  const open = ENTRIES.find((entry) => entry.id === panel) ?? null;
  const showBack = open !== null || onExit !== undefined;

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
        <div className="menu__body fade-in" key={open ? open.id : 'root'}>
          {open === null && <Root onOpen={setPanel} daily={daily} />}
          {open?.id === 'record' && <Record title={open.label} stats={stats} />}
          {open?.id === 'board' && <Board title={open.label} />}
          {open?.id === 'misjudged' && <Misjudged title={open.label} />}
        </div>

        {showBack && (
          <button
            type="button"
            className="button menu__back"
            onClick={() => (open === null ? onExit?.() : setPanel(null))}
          >
            {open === null ? 'Back to the question' : 'Back to the menu'}
          </button>
        )}
      </section>
    </main>
  );
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
              <span className="menu__item-label">{entry.label}</span>
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

/** Banked state, read off the same counters the header shows. */
function Record({ title, stats }: { title: string; stats: PlayerStats }): React.JSX.Element {
  const rate =
    stats.totalPlayed > 0 ? Math.round((stats.totalHits / stats.totalPlayed) * 100) : 0;

  return (
    <Panel
      title={title}
      note={
        <>
          streak counts days you answered something, not questions &mdash; a second one the
          same day pays points but does not move it. Miss a day and it goes back to zero;
          best keeps the number it reached. The day turns over at midnight UTC.
        </>
      }
    >
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

/** An empty room with its door already hung. The board itself is the next change. */
function Board({ title }: { title: string }): React.JSX.Element {
  return (
    <Panel
      title={title}
      note={
        <>
          Points are banked per vote, so every question pays &mdash; the Daily, an open
          question, or one from the archive.
        </>
      }
    >
      <p className="notice notice--quiet">Nothing ranked yet.</p>
    </Panel>
  );
}

function Misjudged({ title }: { title: string }): React.JSX.Element {
  return (
    <Panel
      title={title}
      note={
        <>
          Average gap between guess and reality, across every vote a question has taken.{' '}
          {LEADERBOARD_MIN_VOTES} votes to qualify.
        </>
      }
    >
      <Leaderboard rows={BOARD_ROWS} />
    </Panel>
  );
}
