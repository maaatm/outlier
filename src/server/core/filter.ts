/**
 * Content filter applied to everything a player writes before a post is
 * created — the question, and the title it is posted under.
 *
 * Two jobs: keep slurs and abuse out of the subreddit, and keep the tone of the
 * game where it belongs. Questions about ordinary habits work; questions that
 * are really statements about identity, politics, or someone's health do not —
 * they invite brigading and the answer stops being a habit.
 *
 * The rules do not vary by subject. A slur is a slur in a title, and a title is
 * the more public of the two — it is what the feed shows. All `subject` decides
 * is which word the refusal uses, so a player who is told no knows which field
 * to fix.
 *
 * Matching is on word boundaries against a normalised copy of the text, so
 * "Scunthorpe" and "assemble" survive. This is a coarse net on purpose: the mod
 * approval gate in front of the Daily slot is the real control.
 */

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
};

function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[013457@$]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Slurs and sexual content. Deliberately short; mods handle the long tail. */
const BLOCKED = [
  'anal',
  'bestiality',
  'blowjob',
  'bukkake',
  'cameltoe',
  'chink',
  'clitoris',
  'cocksucker',
  'coon',
  'cunt',
  'cum',
  'deepthroat',
  'dildo',
  'ejaculate',
  'faggot',
  'fellatio',
  'gangbang',
  'handjob',
  'incest',
  'jizz',
  'kike',
  'masturbate',
  'molest',
  'nigger',
  'nigga',
  'paedophile',
  'pedophile',
  'porn',
  'pornhub',
  'rape',
  'raping',
  'retard',
  'rimjob',
  'sodomy',
  'spic',
  'tranny',
  'wank',
  'whore',
];

/** Topics that are off-tone for this game rather than abusive. */
const OFF_TOPIC = [
  'abortion',
  'antifa',
  'antivax',
  'biden',
  'brexit',
  'chemotherapy',
  'communist',
  'conservative',
  'democrat',
  'depression',
  'diagnosed',
  'election',
  'fascist',
  'gender',
  'genocide',
  'immigrant',
  'immigration',
  'islam',
  'jewish',
  'liberal',
  'medication',
  'muslim',
  'nazi',
  'palestine',
  'political',
  'politics',
  'president',
  'prescribed',
  'republican',
  'suicide',
  'trans',
  'transgender',
  'trump',
  'vaccine',
  'vaccinated',
  'voted',
  'zionist',
];

export type FilterResult = { ok: true } | { ok: false; reason: string };

function firstMatch(haystack: string, needles: readonly string[]): string | null {
  const words = new Set(haystack.split(' '));
  for (const needle of needles) {
    if (words.has(needle)) return needle;
  }
  return null;
}

export function filterText(text: string, subject: 'question' | 'title'): FilterResult {
  const normalised = normalise(text);

  if (firstMatch(normalised, BLOCKED)) {
    return { ok: false, reason: `That language does not belong in a ${subject} here.` };
  }

  const offTopic = firstMatch(normalised, OFF_TOPIC);
  if (offTopic) {
    return {
      ok: false,
      reason:
        `Keep ${subject}s to ordinary habits. Nothing political, medical, or about identity — ` +
        'the answer stops being a habit and becomes a statement.',
    };
  }

  // Shouting reads as a statement rather than as something being asked.
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length > 12 && letters === letters.toUpperCase()) {
    return { ok: false, reason: `That ${subject} is shouting. Sentence case, please.` };
  }

  if (/(.)\1{5,}/.test(text)) {
    return { ok: false, reason: `That reads as noise rather than a ${subject}.` };
  }

  return { ok: true };
}
