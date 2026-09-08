/**
 * The comment, as richtext.
 *
 * Reddit's own `devvit-HotAndCold` posts its comment this way — a
 * `RichTextBuilder` of paragraphs, with the caption line carrying a superscript
 * span — and this is the same shape, built from `commentBlocks` so the wording
 * still has one source.
 *
 * Richtext rather than markdown because markdown in a comment body is Reddit
 * parsing a string and hoping: `**` around a label the player never chose, a
 * `^(...)` footer that is one stray bracket away from being printed literally,
 * and a note field that a player can put asterisks in. The runs say what is
 * bold instead of spelling it, so nothing in a note can reach the formatter.
 *
 * `FormattingFlag` is imported from `@devvit/shared-types` rather than
 * `@devvit/web/server`, which re-exports the richtext module with `export type
 * *` and so carries the enum's type without its value. That is the same import
 * HotAndCold uses, and the reason `@devvit/shared-types` is a direct dependency
 * here rather than a transitive one.
 */

import { RichTextBuilder } from '@devvit/web/server';
import { FormattingFlag, type FormatRange } from '@devvit/shared-types/richtext/types.js';

import type { CommentBlock } from '../../shared/comment.js';

/**
 * Blocks to a builder, one paragraph each.
 *
 * A `FormatRange` is `[flag, startIndex, length]` — not a start and an end —
 * and each run is formatted over the whole of itself, so the index is always
 * zero and the length is always the run's own. Getting that pair the wrong way
 * round would not throw; it would post a comment styled across the wrong
 * characters, which is why it is spelled out here rather than inlined twice.
 */
export function toRichText(blocks: CommentBlock[]): RichTextBuilder {
  const builder = new RichTextBuilder();

  for (const block of blocks) {
    builder.paragraph((paragraph) => {
      for (const run of block.runs) {
        const formatting: FormatRange[] = [];
        if (run.bold) formatting.push([FormattingFlag.bold, 0, run.text.length]);
        if (block.superscript) {
          formatting.push([FormattingFlag.superscript, 0, run.text.length]);
        }
        paragraph.text(
          formatting.length > 0 ? { text: run.text, formatting } : { text: run.text }
        );
      }
    });
  }

  return builder;
}
