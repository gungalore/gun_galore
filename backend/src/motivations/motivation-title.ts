import { MotivationLicenceType } from '@prisma/client';
import { LICENCE_TYPE_LABELS } from './motivation-fields';

// ────────────────────────────────────────────────────────────────────
// WHAT A MOTIVATION IS CALLED ON A LIST.
//
// Operator, 2026-09-20: "Once the firearm that is being applied for is in the
// pack the name of the motivation should change to the Make and calibre of the
// firearm followed by which section it is."
//
// ⚠️ DERIVED ON READ, NEVER STORED. The `label` column is the member's own
// name for their own application and is never written by this function. When
// it is set it wins; when it is null the title is composed from the answers
// the application already carries. That means a member who renames a
// motivation keeps their name, and one who never does still sees which firearm
// and which section each row is, rather than four identical "Section 16 —
// Dedicated sport shooter" rows.
//
// ⚠️ THE FALLBACK IS THE LICENCE LABEL, NOT A BLANK. Before the firearm is
// described there is no make or calibre to name, and a list row with no title
// is worse than the section it is applying under.
// ────────────────────────────────────────────────────────────────────

/** "Section 13 — Self-defence" → "Section 13", whatever separator is used. */
function sectionOf(licenceType: MotivationLicenceType): string {
  const label = LICENCE_TYPE_LABELS[licenceType];
  return label.match(/^Section \d+/)?.[0] ?? label;
}

/**
 * The firearm being applied for, as a person names it.
 *
 * ⚠️ MODEL IS INCLUDED EVEN THOUGH THE REQUEST SAID "MAKE AND CALIBRE". A
 * Glock and a Glock 19 are different rows, and the operator's own approved
 * example was "Glock 19 9mm — Section 13". Make + model + calibre is the
 * shortest string that identifies one firearm among several.
 */
function firearmOf(answers: Record<string, string>): string {
  return [answers.firearm_make, answers.firearm_model, answers.firearm_calibre]
    .map((v) => (v ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

export function motivationTitle(
  licenceType: MotivationLicenceType,
  answers: Record<string, string>,
  label?: string | null,
): string {
  const custom = (label ?? '').trim();
  if (custom) return custom;

  const firearm = firearmOf(answers);
  return firearm
    ? `${firearm} — ${sectionOf(licenceType)}`
    : LICENCE_TYPE_LABELS[licenceType];
}
