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
/**
 * One application's unsent state.
 *
 * ⚠️ IT IS A RECORD NOW, NOT A BARE ANSWER MAP, and a legacy flat map still
 * reads. Two review queues used to be component state — what we filed each
 * uploaded document as, and the values we read off one that conflict with
 * something typed — and both are questions only a human can settle. Held in
 * useState they survived exactly as long as the tab did: a refresh mid-review
 * left six documents filed as whatever we guessed, with nobody ever asked, and
 * a required-documents list ticking a line the pack does not actually meet.
 * That is the Document Centre's lost-licences bug in a second costume.
 */
export interface DraftRecord {
  answers: Record<string, string>;
  /** What we filed each auto-named document as, pending confirmation. */
  filed: FiledDoc[];
  /** Values read off a document that disagree with something already typed. */
  suggestions: DraftSuggestion[];
  /**
   * One-shot acknowledgements, by name.
   *
   * ⚠️ FOR THINGS THE MEMBER HAS ALREADY DONE ONCE. The seller-card adoption
   * lived in component state, so a reload re-offered "use these details in my
   * application" to somebody who had used them — an invitation to overwrite
   * their own corrections with the same card a second time.
   */
  flags: Record<string, boolean>;
}

export interface FiledDoc {
  id: string;
  name: string;
  kind: string;
  confident: boolean;
}

export interface DraftSuggestion {
  key: string;
  value: string;
  label: string;
  from: string;
  trusted?: boolean;
  note?: string;
}

const EMPTY: DraftRecord = { answers: {}, filed: [], suggestions: [], flags: {} };

/** Only string values survive. A draft is answers; anything else got in by mistake. */
function strings(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (typeof x === 'string') out[k] = x;
  }
  return out;
}

function bools(v: unknown): Record<string, boolean> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (typeof x === 'boolean') out[k] = x;
  }
  return out;
}

function filedRows(v: unknown): FiledDoc[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((r) => {
    if (!r || typeof r !== 'object') return [];
    const o = r as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.kind !== 'string') return [];
    return [
      {
        id: o.id,
        kind: o.kind,
        name: typeof o.name === 'string' ? o.name : '',
        // ⚠️ MISSING MEANS NOT SURE. Defaulting the other way would restore a
        // row as confirmed that nobody ever confirmed.
        confident: o.confident === true,
      },
    ];
  });
}

function suggestionRows(v: unknown): DraftSuggestion[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((r) => {
    if (!r || typeof r !== 'object') return [];
    const o = r as Record<string, unknown>;
    if (
      typeof o.key !== 'string' ||
      typeof o.value !== 'string' ||
      typeof o.label !== 'string'
    ) {
      return [];
    }
    return [
      {
        key: o.key,
        value: o.value,
        label: o.label,
        from: typeof o.from === 'string' ? o.from : '',
        trusted: o.trusted === true,
        ...(typeof o.note === 'string' ? { note: o.note } : {}),
      },
    ];
  });
}

/**
 * Read the whole record, or an empty one.
 *
 * ⚠️ NEVER THROWS — see readDraft. A LEGACY FLAT MAP (the shape written before
 * the review queues joined it) is read as answers, so a member mid-sentence
 * across the deploy keeps their sentence.
 */
export function readRecord(id: string): DraftRecord {
  try {
    const raw = localStorage.getItem(DRAFT_KEY(id));
    if (!raw) return { ...EMPTY };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...EMPTY };
    }
    const rec = parsed as Record<string, unknown>;
    if (!('answers' in rec)) {
      // Written by the version before this one: the object IS the answers.
      return { answers: strings(rec), filed: [], suggestions: [], flags: {} };
    }
    return {
      answers: strings(rec.answers),
      filed: filedRows(rec.filed),
      suggestions: suggestionRows(rec.suggestions),
      flags: bools(rec.flags),
    };
  } catch {
    return { ...EMPTY };
  }
}

/** Write the whole record, silently doing nothing where storage is unavailable. */
function writeRecord(id: string, rec: DraftRecord): void {
  try {
    localStorage.setItem(DRAFT_KEY(id), JSON.stringify(rec));
  } catch {
    // Quota, private mode, or storage disabled. The debounced save is still
    // on its way to the server; losing the belt does not justify an error.
  }
}

/**
 * The review queues for one application.
 *
 * ⚠️ READ SEPARATELY FROM THE ANSWERS, because they are restored at a
 * different moment: the answers merge over the server's copy on load, the
 * queues are restored once the uploads list is known so a row for a document
 * that has since been deleted can be dropped.
 */
export function readReview(id: string): {
  filed: FiledDoc[];
  suggestions: DraftSuggestion[];
} {
  const rec = readRecord(id);
  return { filed: rec.filed, suggestions: rec.suggestions };
}

/** Replace the review queues, leaving the unsent answers untouched. */
export function writeReview(
  id: string,
  review: { filed?: FiledDoc[]; suggestions?: DraftSuggestion[] },
): void {
  const cur = readRecord(id);
  writeRecord(id, {
    answers: cur.answers,
    filed: review.filed ?? cur.filed,
    suggestions: review.suggestions ?? cur.suggestions,
    flags: cur.flags,
  });
}

/** Has this member already done the thing `name` stands for, on this pack? */
export function readFlag(id: string, name: string): boolean {
  return readRecord(id).flags[name] === true;
}

/** Remember that they have. Never throws — see readDraft. */
export function writeFlag(id: string, name: string, value = true): void {
  const cur = readRecord(id);
  writeRecord(id, { ...cur, flags: { ...cur.flags, [name]: value } });
}

export function readDraft(id: string): Record<string, string> {
  return readRecord(id).answers;
}

/**
 * Write the unsent answers, silently doing nothing where storage is
 * unavailable.
 *
 * ⚠️ IT MERGES INTO THE RECORD RATHER THAN REPLACING IT. This fires on every
 * keystroke; a blind overwrite would drop the review queues on the first
 * character typed after a batch of documents went up — which is precisely the
 * wholesale-replace bug that lost six licences in the Document Centre.
 */
export function writeDraft(id: string, answers: Record<string, string>): void {
  const cur = readRecord(id);
  writeRecord(id, {
    answers,
    filed: cur.filed,
    suggestions: cur.suggestions,
    flags: cur.flags,
  });
}

/** Drop the draft once the server has the answers. */
export function clearDraft(id: string): void {
  try {
    localStorage.removeItem(DRAFT_KEY(id));
  } catch {
    /* see writeDraft */
  }
}
