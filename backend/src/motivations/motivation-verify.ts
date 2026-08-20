// ────────────────────────────────────────────────────────────────────
// MECHANICAL VERIFICATION OF A BUILT DOCUMENT.
//
// The writer is a model; the pack is a legal submission. Between the two sit
// checks that must never be probabilistic: the serial number on the cover of
// a motivation IS the firearm being licensed, an annexure letter cited in the
// body IS a promise about what the DFO will find behind the tab, and the ID
// number is the applicant. A model verifier opines on these; this module
// KNOWS, for free, deterministically.
//
// This is the cheap half of the pipeline's verification pair — the model
// half is MotivationClaudeService.verifyDocument(). Two verifiers per
// document, per the operator, and not more.
// ────────────────────────────────────────────────────────────────────

export interface AnnexureRef {
  letter: string;
  label: string;
}

/** Every annexure letter the document cites: "Annexure D", "(Annexure K: …)". */
export function citedAnnexures(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\bAnnexure\s+([A-Z])\b/g)) out.add(m[1]);
  return [...out].sort();
}

/** Digits only — how two renderings of one ID number are compared. */
const digits = (v: string) => v.replace(/\D+/g, '');

/**
 * Squash to a comparable token: lowercase, no spaces or punctuation. The same
 * calibre arrives as "6.35 mm Browning", "6,35mm Browning" and ".223 REM" /
 * "223 Rem" depending on who typed it — the letters and digits are the
 * identity, the furniture is not.
 */
const squash = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Everything mechanically wrong with a built document, as human sentences.
 *
 * Empty means clean. ⚠️ EVERY CHECK ONLY FIRES WHEN THE ANSWER EXISTS — a
 * pack with no serial answered cannot fail the serial check; absence of an
 * answer is the wizard's business, not this module's.
 */
export function packConsistency(
  text: string,
  answers: Record<string, string>,
  annexures: AnnexureRef[],
): string[] {
  const issues: string[] = [];
  const doc = squash(text);

  // ── annexure citations are promises ───────────────────────────────
  const offered = new Set(annexures.map((a) => a.letter));
  for (const letter of citedAnnexures(text)) {
    if (!offered.has(letter)) {
      issues.push(
        `The document cites Annexure ${letter}, but the pack has no annexure ${letter} — a DFO turning to that tab finds nothing.`,
      );
    }
  }

  // ── the firearm is the firearm ────────────────────────────────────
  const serial = (answers.firearm_serial ?? '').trim();
  if (serial && !doc.includes(squash(serial))) {
    issues.push(
      `The firearm's serial number (${serial}) does not appear in the document — the motivation must identify the exact firearm applied for.`,
    );
  }
  const calibre = (answers.firearm_calibre ?? '').trim();
  if (calibre && !doc.includes(squash(calibre))) {
    issues.push(
      `The calibre the applicant gave (${calibre}) does not appear in the document.`,
    );
  }

  // ── the applicant is the applicant ────────────────────────────────
  const id = digits(answers.id_number ?? '');
  if (id.length === 13 && !digits(text).includes(id)) {
    issues.push(
      'The applicant’s ID number does not appear in the document — a motivation is filed under an identity, not a name alone.',
    );
  }

  // ── serial numbers that are NOT this firearm must not be invented ──
  // The other direction of the serial check: if the document contains what
  // reads as a serial for the applied-for firearm ("Serial Number: X") that
  // does not match the answer, the writer substituted one. Owned-firearm
  // serials legitimately appear, so only the labelled applied-for form is
  // policed.
  if (serial) {
    for (const m of text.matchAll(/Serial\s*(?:Number|No)\.?\s*:?\s*([A-Z0-9-]{4,})/gi)) {
      const found = squash(m[1]);
      const owned = [1, 2, 3, 4, 5, 6].some((n) =>
        [
          answers[`existing_firearm_${n}_frame_serial`],
          answers[`existing_firearm_${n}_barrel_serial`],
        ].some((v) => v && squash(v) === found),
      );
      if (found !== squash(serial) && !owned) {
        issues.push(
          `The document states a serial number (${m[1]}) that is neither the firearm applied for nor one the applicant listed as already owned.`,
        );
      }
    }
  }

  return issues;
}
