/**
 * Question validation. Shared so the submission form can fail fast on the
 * client, but every rule here is re-run on the server before a post is created —
 * client-side validation is a courtesy, not a gate.
 */

import { TITLE_MAX_LENGTH } from './config.js';

export type ValidationResult = { ok: true } | { ok: false; reason: string };

const OK: ValidationResult = { ok: true };

/** Collapse whitespace and strip the invisible characters people paste in. */
export function normalizeQuestionText(raw: string): string {
  return raw
    .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeLabel(raw: string, fallback: string): string {
  const cleaned = normalizeQuestionText(raw);
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * The post title, falling back to the question when nothing was typed.
 *
 * An empty title is not a mistake and never has been: every question posted
 * before the field existed was titled with its own text, and the fallback is
 * what keeps those records and these identical.
 *
 * The fallback is trimmed to Reddit's cap and a typed title is not, because the
 * two failures are different. A title somebody typed past the cap is refused,
 * with a reason, by `validateTitle` — they wrote it and can shorten it. A
 * question past the cap is not a title anybody wrote; refusing it would be
 * refusing a perfectly good question for the length of a field the player was
 * told was optional, so it is cut instead. Same trim `dailyTitle` uses.
 */
export function normalizeTitle(raw: string, fallback: string): string {
  const cleaned = normalizeQuestionText(raw);
  if (cleaned.length > 0) return cleaned;
  return fitTitle(normalizeQuestionText(fallback));
}

/** Reddit's cap, applied by trimming rather than by refusing. */
export function fitTitle(title: string): string {
  if (title.length <= TITLE_MAX_LENGTH) return title;
  return `${title.slice(0, TITLE_MAX_LENGTH - 3)}...`;
}

/**
 * What a question has to be, which is deliberately little.
 *
 * Length is not a rule and neither is punctuation. A question that has to be ten
 * characters, or under a hundred and twenty, or ended in a question mark, was a
 * house style being enforced as a validity check on somebody else's writing —
 * and every one of those refusals fell on a player who had already typed the
 * thing. `docs/writing-questions.md` still says what a good question looks like,
 * and the mod queue in front of the Daily slot is still the gate that matters.
 *
 * What is left is the part that is not about taste: something was written, it
 * reads as words rather than as punctuation, and it is not a link or a username.
 */
export function validateQuestionText(raw: string): ValidationResult {
  const text = normalizeQuestionText(raw);

  if (text.length === 0) {
    return { ok: false, reason: 'Ask something first.' };
  }
  if (!/[a-z]/i.test(text)) {
    return { ok: false, reason: 'That does not read as a question.' };
  }
  if (/(https?:\/\/|www\.|\bu\/|\br\/)/i.test(text)) {
    return { ok: false, reason: 'No links or usernames in questions.' };
  }
  return OK;
}

/**
 * The post title, judged as a title rather than as a question.
 *
 * The one length still enforced anywhere in a submission, and only because
 * Reddit enforces it: a `submitCustomPost` over `TITLE_MAX_LENGTH` is refused on
 * their side, so a title that long is not a matter of taste but a post that will
 * not be created. Everything else carries over from the question — something
 * that reads as words, no links or usernames — and nothing carries over from the
 * rules about being a question, because a title is not one.
 */
export function validateTitle(raw: string): ValidationResult {
  const title = normalizeQuestionText(raw);

  if (title.length === 0) {
    return { ok: false, reason: 'A title needs something in it.' };
  }
  if (title.length > TITLE_MAX_LENGTH) {
    return { ok: false, reason: `Reddit caps titles at ${TITLE_MAX_LENGTH} characters.` };
  }
  if (!/[a-z]/i.test(title)) {
    return { ok: false, reason: 'That does not read as a title.' };
  }
  if (/(https?:\/\/|www\.|\bu\/|\br\/)/i.test(title)) {
    return { ok: false, reason: 'No links or usernames in titles.' };
  }
  return OK;
}

/**
 * An answer needs to exist. That is the whole rule.
 *
 * A long one will be a long button — the two choices are rendered at whatever
 * width they come out at — but that is a question being asked badly rather than
 * a question being asked wrongly, and the person it looks worst for is the one
 * who wrote it.
 */
export function validateLabel(raw: string, which: string): ValidationResult {
  const label = normalizeQuestionText(raw);
  if (label.length === 0) return { ok: false, reason: `${which} needs a label.` };
  return OK;
}

/**
 * Everything a submission has to be, in the order the room reads its fields.
 *
 * `title` is a required parameter rather than an optional one so that no call
 * site can forget it, and it is the **raw** field rather than a resolved title:
 * an untyped title means the question is the title, and the question has just
 * been checked by its own rules. Validating the fallback here would refuse a
 * question for the length of a field the player was told was optional —
 * `normalizeTitle` trims it instead.
 */
export function validateSubmission(
  text: string,
  labelA: string,
  labelB: string,
  title: string
): ValidationResult {
  const textResult = validateQuestionText(text);
  if (!textResult.ok) return textResult;

  const a = validateLabel(labelA, 'The first answer');
  if (!a.ok) return a;

  const b = validateLabel(labelB, 'The second answer');
  if (!b.ok) return b;

  if (
    normalizeQuestionText(labelA).toLowerCase() === normalizeQuestionText(labelB).toLowerCase()
  ) {
    return { ok: false, reason: 'The two answers need to differ.' };
  }

  if (normalizeQuestionText(title).length > 0) {
    const titleResult = validateTitle(title);
    if (!titleResult.ok) return titleResult;
  }
  return OK;
}

/**
 * A short, stable key for "this exact submission".
 *
 * Used as the field of the dedupe guard in `core/submit.ts`, which refuses an
 * identical submission from the same player inside a short window. It is a hash
 * rather than the text itself because the text is up to 120 characters of
 * arbitrary user input and this ends up in a Redis hash field.
 *
 * FNV-1a: not a cryptographic hash and not trying to be. A collision would
 * refuse one submission that happened to collide with another the same player
 * made in the last minute, which is a shrug rather than a bug — and the input is
 * normalized and lowercased first, so the near-misses that matter (a retry with
 * different spacing or capitalisation) collapse to the same key deliberately.
 */
export function submissionFingerprint(text: string, labelA: string, labelB: string): string {
  const subject = [text, labelA, labelB].map(normalizeQuestionText).join('\n').toLowerCase();

  let hash = 0x811c9dc5;
  for (let i = 0; i < subject.length; i++) {
    hash ^= subject.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Guidance shown directly in the submission form. Same words as docs/writing-questions.md. */
export const SUBMISSION_GUIDANCE =
  'A question works when people cannot predict the split. ' +
  'Good: do you eat the pizza crust? Bad: do you brush your teeth? — everyone answers the same way. ' +
  'Keep it to ordinary habits. Nothing political, medical, or about identity.';
