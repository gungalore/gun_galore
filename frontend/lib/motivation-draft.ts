// ────────────────────────────────────────────────────────────────────
// THE UNSENT DRAFT, AND THE ONE KEY BOTH SCREENS MUST AGREE ON.
//
// A member's answers are debounced before they are saved. Whatever is typed
// inside that window lives only in localStorage, so this key is the difference
// between a refresh that restores what they wrote and a refresh that throws it
// away.
//
// ⚠️ IT LIVES HERE BECAUSE THERE ARE NOW TWO SCREENS FOR ONE APPLICATION.
// `/motivations/[id]` (the wizard) and `/licence-services/[id]` (the pack) both
// read and write this draft for the same id. While the key was a private
// constant inside the wizard's own file, the second screen could only get at it
// by copying the string — and two copies of a cache key are one refactor away
// from silently dropping somebody's unsaved answers, with nothing failing and
// no error to notice.
//
// One definition, imported by both. Never re-declare it.
// ────────────────────────────────────────────────────────────────────

/**
 * How long to wait after the last keystroke before saving.
 *
 * Long enough that typing a sentence is one request rather than forty; short
 * enough that a member who types and immediately closes the tab has almost
 * always been saved. The draft below covers the rest.
 */
export const AUTOSAVE_MS = 1200;

/** Where the unsent answers for one application live. */
export const DRAFT_KEY = (id: string) => `motivation-draft:${id}`;

/**
 * Read the local draft for an application, or `{}` if there is none.
 *
 * ⚠️ NEVER THROWS, AND THAT IS THE POINT. `localStorage` is unavailable in a
 * private window on some browsers and throws on ACCESS, not just on write —
 * and the caller is a page load. A member whose browser refuses storage should
 * see their application, not a blank error page, so a draft we cannot read is
 * treated as a draft that does not exist.
 *
 * Corrupt JSON is the same case: something wrote nonsense under our key, and
 * the server's copy is the one to trust.
 */
export function readDraft(id: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(DRAFT_KEY(id));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    // Only string values. A draft is answers; anything else got in by mistake
    // and must not reach a field renderer expecting a string.
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Write the draft, silently doing nothing where storage is unavailable. */
export function writeDraft(id: string, answers: Record<string, string>): void {
  try {
    localStorage.setItem(DRAFT_KEY(id), JSON.stringify(answers));
  } catch {
    // Quota, private mode, or storage disabled. The debounced save is still
    // on its way to the server; losing the belt does not justify an error.
  }
}

/** Drop the draft once the server has the answers. */
export function clearDraft(id: string): void {
  try {
    localStorage.removeItem(DRAFT_KEY(id));
  } catch {
    /* see writeDraft */
  }
}
