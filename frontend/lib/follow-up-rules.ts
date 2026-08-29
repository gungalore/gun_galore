import type { FollowUp } from './motivations-api';

// ────────────────────────────────────────────────────────────────────
// WHICH OF BOET'S QUESTIONS ARE STILL OPEN.
//
// The follow-up thread is not a chat. When the quality gate scores a draft it
// returns `thin_fields` — registry keys whose answer was too sparse to build
// an argument on — and one short question is written per field. The answer is
// merged back into `answersEncrypted` under that same fieldKey, which is what
// the schema means by "a form-filler rather than a transcript".
//
// ⚠️ AN UNANSWERED QUESTION BLOCKS THE DOCUMENT. The gate moves the
// application to NEEDS_MORE_INFO and answering is what moves it back, so a
// member who cannot see these questions is not merely missing a feature — they
// are stuck, with no visible reason and no way out. That is why this is the
// last blocker before the old page can go.
// ────────────────────────────────────────────────────────────────────

/**
 * The questions nobody has answered yet.
 *
 * ⚠️ ANSWERED MEANS "ANSWERED AFTER IT WAS ASKED", NOT "HAS AN ANSWER
 * SOMEWHERE". The gate can ask about the same field twice — a second draft can
 * still find `daily_movements` thin even after one reply — and a reply that
 * came BEFORE the newer question does not answer it. Matching on fieldKey
 * alone would silently swallow the second ask and leave the member on
 * NEEDS_MORE_INFO with nothing on screen to do about it.
 *
 * A question with no fieldKey is plain conversation and is never treated as
 * outstanding: there is no field for an answer to land in.
 */
export function openQuestions(messages: readonly FollowUp[]): FollowUp[] {
  return messages.filter(
    (m, i) =>
      m.role === 'assistant' &&
      m.fieldKey !== null &&
      !messages
        .slice(i + 1)
        .some((u) => u.role === 'user' && u.fieldKey === m.fieldKey),
  );
}

/**
 * Has this member finished answering?
 *
 * Kept separate from `openQuestions(...).length === 0` so a caller cannot
 * accidentally treat "no messages at all" as "there was nothing to answer" —
 * they are the same number and different situations.
 */
export function hasOutstandingQuestions(
  messages: readonly FollowUp[],
): boolean {
  return openQuestions(messages).length > 0;
}
