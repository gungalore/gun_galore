/**
 * The one matching normaliser for every type-to-filter picker in the app.
 *
 * Lowercase, `×` → `x` (written as an escape, not the literal: a regex whose
 * behaviour depends on one non-ASCII byte surviving every editor and
 * re-encoding is a regex that can silently match nothing), then strip every
 * non-alphanumeric character. So "6,5 Creedmoor", "6.5 Creedmoor" and
 * "65creedmoor" all fold to "65creedmoor", and ".308 Win." folds to "308win".
 *
 * Lifted from components/bench/CartridgePicker.tsx so the community composer's
 * vocab picker matches exactly the way the Bench already proved.
 */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/\u00d7/g, 'x')
    .replace(/[^a-z0-9]/g, '');
}
