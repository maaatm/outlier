/**
 * Question validation. Shared so the submission form can fail fast on the
 * client, but every rule here is re-run on the server before a post is created —
 * client-side validation is a courtesy, not a gate.
 */

import { LABEL_MAX_LENGTH, QUESTION_MAX_LENGTH, QUESTION_MIN_LENGTH } from './config.js';

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

export function validateQuestionText(raw: string): ValidationResult {
  const text = normalizeQuestionText(raw);

  if (text.length < QUESTION_MIN_LENGTH) {
    return { ok: false, reason: `Questions are at least ${QUESTION_MIN_LENGTH} characters.` };
  }
  if (text.length > QUESTION_MAX_LENGTH) {
    return { ok: false, reason: `Questions are at most ${QUESTION_MAX_LENGTH} characters.` };
  }
  if (!text.endsWith('?')) {
    return { ok: false, reason: 'Questions end in a question mark.' };
  }
  if (text.split('?').length > 2) {
    return { ok: false, reason: 'One question at a time.' };
  }
  if (!/[a-z]/i.test(text)) {
    return { ok: false, reason: 'That does not read as a question.' };
  }
  if (/(https?:\/\/|www\.|\bu\/|\br\/)/i.test(text)) {
    return { ok: false, reason: 'No links or usernames in questions.' };
  }
  return OK;
}

export function validateLabel(raw: string, which: string): ValidationResult {
  const label = normalizeQuestionText(raw);
  if (label.length === 0) return { ok: false, reason: `${which} needs a label.` };
  if (label.length > LABEL_MAX_LENGTH) {
    return { ok: false, reason: `${which} is at most ${LABEL_MAX_LENGTH} characters.` };
  }
  return OK;
}

export function validateSubmission(
  text: string,
  labelA: string,
  labelB: string
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
  return OK;
}

/** Guidance shown directly in the submission form. Same words as docs/writing-questions.md. */
export const SUBMISSION_GUIDANCE =
  'A question works when people cannot predict the split. ' +
  'Good: do you eat the pizza crust? Bad: do you brush your teeth? — everyone answers the same way. ' +
  'Keep it to ordinary habits. Nothing political, medical, or about identity.';
