import type { CredentialKind } from './licence-centre-api';

/**
 * The kinds that draw as photographs rather than as rows in the safe section.
 *
 * The installation certificate is a document; the rest are pictures of a box,
 * and a list of four rows called "Photographs of my safe" tells the member
 * nothing a 4-across grid does not tell them at a glance.
 */
export const SAFE_PHOTO_KINDS: CredentialKind[] = [
  'SAFE_PHOTOGRAPHS',
  'SAFE_PHOTO_CLOSED',
  'SAFE_PHOTO_AJAR',
  'SAFE_PHOTO_BOLTS',
];

/**
 * What the scanner treatment must never touch.
 *
 * ⚠️ THE WHITE-WASH PROBLEM IS NOT ONLY THE SAFE. The colour and light
 * normalise that makes a licence legible flattens every photograph: a safe,
 * a hunt, a range, a reloading bench. `EVIDENCE` is the upload kind for all
 * of those, and a member who chose it has already told us it is a photograph
 * even when the classifier guessed `OTHER`.
 */
export const UNTOUCHED_PHOTO_KINDS: ReadonlySet<string> = new Set([
  ...SAFE_PHOTO_KINDS,
  'EVIDENCE',
]);

/**
 * Is this verdict a photograph that must be uploaded as picked?
 *
 * `role: 'evidence'` is enough on its own: evidence is body content (a hunt,
 * a range, a permission letter), never a page to flatten and crop.
 */
export function isUntouchedPhotograph(v: {
  role?: string | null;
  kind?: string | null;
}): boolean {
  return v.role === 'evidence' || UNTOUCHED_PHOTO_KINDS.has(v.kind ?? '');
}
