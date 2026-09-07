// ────────────────────────────────────────────────────────────────────
// WHAT AN EMPTY BOX SAYS, IN ONE PLACE.
//
// Two panels draw the wizard's rows — FieldGrid ("About you", "Your case") and
// ReadResult (every step that reads a document) — and they had grown two
// different vocabularies for the same three states. This is the one rule.
//
// ⚠️ "NOT ON THE DOCUMENT" IS A CLAIM ABOUT A DOCUMENT WE HAVE READ. Said over
// a step where no such document has ever been handed to us, it is simply
// untrue: it blames a page that does not exist for not carrying a value. On
// the operator's live section 16 dedicated-hunter application, 2026-09-07, the
// association step said it ten times in a row — over "Your hunting
// association", "Membership number", "Dedicated status held since" — with no
// association letter attached to the application at all.
//
// So the sentence turns on whether the document is actually here:
//
//   the document is attached, the value is not on it   "Not on the document"
//   the document has not reached us yet                "Not read yet"
//   nothing but the member can answer it               "You may know it"
//
// Pass no `attachedKinds` and the middle case is unreachable — the caller is
// saying it does not know what is attached, and the old wording stands.
// ────────────────────────────────────────────────────────────────────

import type { MotivationField } from '@/lib/motivations-api';

export const NOT_ON_DOCUMENT = 'Not on the document';
export const NOT_READ_YET = 'Not read yet';
export const MEMBER_ANSWERS = 'You may know it';

/**
 * The words for a row whose answer is empty.
 *
 * `attachedKinds` is the set of MotivationUploadKinds this application
 * actually holds — the same union the step list is built from. Omit it where
 * the caller cannot know.
 */
export function emptyAnswerLabel(
  field: Pick<MotivationField, 'docSourced'>,
  attachedKinds?: ReadonlySet<string>,
): string {
  const kind = field.docSourced;
  if (!kind) return MEMBER_ANSWERS;
  if (!attachedKinds) return NOT_ON_DOCUMENT;
  return attachedKinds.has(kind) ? NOT_ON_DOCUMENT : NOT_READ_YET;
}
