/**
 * THE ANNEXURE LETTER IS NOT THE MODEL'S TO REMEMBER.
 *
 * A pack is lettered from what is actually attached, and that set changes
 * while an application is being finished: a document is added, another is
 * dropped, an endorsement arrives late. The writer, though, is given the list
 * once, at generation time. So a document generated before the letters settled
 * cites the right title against the wrong letter \u2014 MO000057 said
 * "(Refer to Annexure E: Association membership proof)" when E was the existing
 * firearm licences and membership was F \u2014 and a DFO opening tab E finds the
 * wrong document.
 *
 * \u26a0\ufe0f SO THE LETTER IS RE-DERIVED FROM THE TITLE WHENEVER THE PACK IS
 * ASSEMBLED. Matching is by the annexure's own title, which is stable across a
 * re-lettering, and a citation whose title is not in the pack at all is left
 * exactly as written \u2014 this function corrects a known pair or does nothing.
 * It never invents an annexure and never silently drops a reference.
 */
export interface CitedAnnexure {
  letter: string;
  label: string;
}

const REFERENCE =
  /\(Refer to Annexure\s+([A-Z])\s*(?::\s*([^)]+?))?\)/gi;

/** Case, spacing and a trailing full stop are not part of a title. */
function key(label: string): string {
  return label
    .toLowerCase()
    .replace(/[.\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Rewrite every "(Refer to Annexure X: Title)" so its letter is the one that
 * title actually carries in `annexures`.
 */
export function repointAnnexureRefs(
  text: string,
  annexures: readonly CitedAnnexure[],
): string {
  if (!text || !annexures.length) return text;

  const byTitle = new Map<string, CitedAnnexure>();
  for (const annexure of annexures) {
    // ⚠️ A caller that has not been updated can hand us rows with no label;
    // one of those must not take the whole render down.
    if (!annexure?.label || !annexure.letter) continue;
    const id = key(annexure.label);
    if (id) byTitle.set(id, annexure);
  }

  return text.replace(REFERENCE, (whole, letter, title) => {
    if (!title) return whole;
    const match = byTitle.get(key(title));
    if (match) return `(Refer to Annexure ${match.letter}: ${match.label})`;
    /**
     * ⚠️ A CITATION TO SOMETHING THE PACK DOES NOT CARRY LOSES ITS LETTER.
     *
     * MO000074 cited "(Refer to Annexure C: Proficiency / training
     * certificate)" on the page a DFO reads most closely — and C was the proof
     * of residential address. The writer was given its letters at generation
     * time; the pack re-letters every time it is assembled from what is
     * actually attached, and a motivation-only pack never carries an uploaded
     * proficiency at all. A stale letter sends the reader to the wrong tab with
     * the applicant's signature under it, which is worse than pointing at no
     * tab: the document is still named, so nothing is lost but the error.
     */
    return `(Refer to my ${title.trim()})`;
  });
}
