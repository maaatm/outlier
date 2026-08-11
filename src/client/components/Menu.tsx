/**
 * The main menu.
 *
 * Reached from the comment slide, which is the one place in the loop where the
 * player has finished the question and has nothing left to tap. Everything here
 * is a read — the rules, what they have banked, the 2x2, the questions the
 * subreddit misjudged most. Nothing on this screen can change a vote, and
 * nothing on it exposes a tally the player has not already earned.
 *
 * Two levels and no more: a list of four rooms, and one room at a time. The
 * numbers and the badge copy come from `shared/`, so the menu cannot drift away
 * from what the game actually does.
 */

import { useState } from 'react';

import { badgeFor, getBadge } from '../../shared/badges.js';
import {
  CROWD_SIZE,
  HIT_THRESHOLD,
  LEADERBOARD_MIN_VOTES,
  MINORITY_THRESHOLD,
  POINTS_BASE,
} from '../../shared/config.js';
import { BANDS } from '../../shared/points.js';
import type { PlayerStats } from '../../shared/types.js';
import { Leaderboard } from './Leaderboard.js';
import { StatBar } from './StatBar.js';
import { WobbleRule } from './WobbleRule.js';

type PanelId = 'play' | 'record' | 'outcomes' | 'misjudged';

type Entry = {
  id: PanelId;
  label: string;
  /** One dry line under the label. Says what the room holds, not why to open it. */
  blurb: string;
};

const ENTRIES: Entry[] = [
  { id: 'play', label: 'How to play', blurb: 'two taps, under fifteen seconds' },
  { id: 'record', label: 'Your record', blurb: 'streak, points, and how often you read the room' },
  { id: 'outcomes', label: 'The four outcomes', blurb: 'where the badge comes from' },
  { id: 'misjudged', label: 'Hardest to read', blurb: 'what the subreddit misjudged most' },
];

/** How many leaderboard rows fit here. The reveal's strip shows fewer. */
const BOARD_ROWS = 5;

export function Menu({
  stats,
  onExit,
}: {
  stats: PlayerStats;
  onExit: () => void;
}): React.JSX.Element {
  const [panel, setPanel] = useState<PanelId | null>(null);
  const open = ENTRIES.find((entry) => entry.id === panel) ?? null;

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
          {open === null && <Root onOpen={setPanel} />}
          {open?.id === 'play' && <HowToPlay title={open.label} />}
          {open?.id === 'record' && <Record title={open.label} stats={stats} />}
          {open?.id === 'outcomes' && <Outcomes title={open.label} />}
          {open?.id === 'misjudged' && <Misjudged title={open.label} />}
        </div>

        <button
          type="button"
          className="button menu__back"
          onClick={() => (open === null ? onExit() : setPanel(null))}
        >
          {open === null ? 'Back to the question' : 'Back to the menu'}
        </button>
      </section>
    </main>
  );
}

/** The list itself, under the wordmark. */
function Root({ onOpen }: { onOpen: (id: PanelId) => void }): React.JSX.Element {
  return (
    <div className="menu__root">
      <div>
        <h1 className="menu__wordmark">Outlier</h1>
        <p className="menu__tagline">
          One question a day about ordinary behavior. Answer it, then guess how many
          people out of {CROWD_SIZE} answered the same way.
        </p>
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

function HowToPlay({ title }: { title: string }): React.JSX.Element {
  return (
    <Panel
      title={title}
      note={
        <>
          Every question counts &mdash; the Daily, an open question, or one from the
          archive. One a day is all a streak needs. To ask the subreddit your own question,
          use &ldquo;Submit a question&rdquo; in the subreddit menu &mdash; one a day.
        </>
      }
    >
      <ol className="steps">
        <li>Tap the answer that is true for you. There are always exactly two.</li>
        <li>Guess how many people out of {CROWD_SIZE} answered the same way.</li>
        <li>Lock it in. The crowd splits, and you find out two things at once.</li>
      </ol>

      <div className="axes">
        <div className="axis">
          <p className="section__title">rarity</p>
          <p className="axis__line">
            Whether you took the minority side. Your side is the minority below{' '}
            {MINORITY_THRESHOLD}% of the vote.
          </p>
        </div>
        <div className="axis">
          <p className="section__title">accuracy</p>
          <p className="axis__line">
            How far your guess sat from the real split. Within {HIT_THRESHOLD} points counts
            as reading the room.
          </p>
        </div>
      </div>

      {/* Read off the same table the reveal pays from, so the rates here cannot
          drift from the ones actually awarded. */}
      <div className="axis">
        <p className="section__title">points</p>
        <p className="axis__line">{POINTS_BASE} a vote, and the closer you land the more.</p>
        <ul className="bands">
          {BANDS.filter((band) => band.bonus > 0).map((band) => (
            <li key={band.id} className="band">
              {band.label}
              <span className="band__bonus">+{band.bonus}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
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

/**
 * The 2x2, built by asking the scoring code for each corner rather than by
 * restating it. Deliberately unaccented: four badges would put three meanings of
 * color on one screen, and the rule is two.
 */
function Outcomes({ title }: { title: string }): React.JSX.Element {
  const corners = [
    { minority: false, hit: true },
    { minority: false, hit: false },
    { minority: true, hit: true },
    { minority: true, hit: false },
  ];

  return (
    <Panel
      title={title}
      note={
        <>
          The two axes are independent, so being unusual and being right are scored
          separately. Neither one is the good outcome.
        </>
      }
    >
      <div className="outcomes">
        {corners.map(({ minority, hit }) => {
          const badge = getBadge(badgeFor(minority, hit));
          return (
            <div key={badge.id} className="outcome">
              <p className="outcome__axes">
                {minority ? 'against the room' : 'with the room'} &middot;{' '}
                {hit ? 'read it' : 'missed it'}
              </p>
              <p className="outcome__title">{badge.title}</p>
              <p className="outcome__line">{badge.line}</p>
            </div>
          );
        })}
      </div>
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
