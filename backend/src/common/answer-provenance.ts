// WHERE EVERY PREFILLED ANSWER CAME FROM, kept alongside the answers.
//
// Operator, board review 2026-08-27: "Automation and prefill is what we must
// get 100% correct with these two centres." The prefill itself has worked for
// a while. What has never been kept is the RECORD of it — which is why the
// wizard cannot say "we filled 23 things before you typed anything", cannot
// put a "From your Document Centre" chip on a row, and cannot tell a value it
// wrote itself apart from one the member typed.
//
// ────────────────────────────────────────────────────────────────────
// WHY THIS IS ITS OWN UNENCRYPTED COLUMN.
//
// The answers live in `Motivation.answersEncrypted` — one AES-GCM blob,
// deliberately opaque to SQL because it holds an ID number, a home address and
// firearm serials. Provenance is the opposite kind of data: it holds a SOURCE
// NAME and a ROW ID and never a value. Putting it inside the blob would mean
// decrypting the whole thing to paint a chip or count a banner, on every
// render, forever.
//
// ⚠️ SO THE ONE RULE THIS MODULE ENFORCES IS THAT NO VALUE EVER ENTERS IT.
// `AnswerProvenance` has no `value` field and must never grow one. `from` is a
// document TITLE, which the member wrote themselves and which `Credential.title`
// already stores in the clear for exactly this reason ("In the clear so the
// list can be rendered and the reminder addressed"). Everything else is an
// enum member, a cuid and a timestamp.
//
// ────────────────────────────────────────────────────────────────────
// ⚠️ MEMBER ALWAYS WINS, AND IT IS THIS MODULE'S JOB TO MAKE THAT TRUE.
//
// The moment somebody edits a field by hand, that field stops being ours. No
// later prefill pass — a second document uploaded, a profile re-sync, the
// Licence Centre offer being applied again — may overwrite it. `stamp()`
// refuses to write over a MEMBER entry, so a caller cannot forget: the only
// way to clear a MEMBER mark is `markMember`'s counterpart, and there isn't
// one on purpose.
//
// This is the same discipline as never moving a field while somebody is
// typing. A value the member corrected and the system silently corrected back
// is worse than no prefill at all.

/**
 * Who supplied a value.
 *
 * ⚠️ THESE STRINGS ARE PERSISTED. They are written into an unencrypted Json
 * column and read back by code that will be older or newer than the writer, so
 * a member may be RENAMED only with a migration. Adding one is free; changing
 * the spelling of one is not.
 */
export type ProvenanceSource =
  /** Copied from the member's account profile. */
  | 'PROFILE'
  /** Copied from a document already in the Document Centre. Carries credentialId. */
  | 'VAULT'
  /** Read by the extractor off a document uploaded to THIS application. Carries uploadId. */
  | 'READ'
  /** Supplied by the seller through his own consent link. Carries consentId. */
  | 'SELLER'
  /** Synced from the member's association profile — activity logs, membership. */
  | 'ASSOCIATION'
  /**
   * Typed or corrected by hand.
   *
   * ⚠️ ABSORBING, NOT ONE OF A SET. Every other member of this union describes
   * something we did; this one describes something the member did, and once it
   * is set nothing automatic may replace it. See stamp().
   */
  | 'MEMBER';

/** Every source, in the order a human would read them. Also the runtime guard's set. */
export const PROVENANCE_SOURCES: readonly ProvenanceSource[] = [
  'PROFILE',
  'VAULT',
  'READ',
  'SELLER',
  'ASSOCIATION',
  'MEMBER',
] as const;

/**
 * The chip text, in the member's language rather than ours.
 *
 * Kept here rather than in the frontend so the API and the PDF cannot drift
 * from the screen — the same words appear on the pack row, in the "we filled N
 * things" banner and in the printed provenance note.
 */
export const SOURCE_LABELS: Record<ProvenanceSource, string> = {
  PROFILE: 'From your profile',
  VAULT: 'From your Document Centre',
  READ: 'Read from your upload',
  SELLER: 'From the seller',
  ASSOCIATION: 'Synced from your association',
  MEMBER: 'You entered this',
};

/** One answer's provenance. NEVER carries the answer. */
export interface AnswerProvenance {
  source: ProvenanceSource;
  /**
   * credentialId | uploadId | consentId — whichever the source implies.
   *
   * Absent for PROFILE (the profile is the member, there is no row to point
   * at) and for MEMBER.
   */
  sourceId?: string;
  /**
   * The member's own name for the source — "My .308 licence".
   *
   * ⚠️ A SNAPSHOT FOR DISPLAY, NOT THE TRUTH. `sourceId` is the truth. This is
   * denormalised so a chip can render without a join, and so the chip still
   * says something useful after the document is purged by retention or deleted
   * by the member. It goes stale if they rename the document; a reader holding
   * a live row should prefer that row's title.
   */
  from: string;
  /** ISO 8601, when we wrote the value. */
  at: string;
  /**
   * READ only: the value was inferred rather than read verbatim.
   *
   * The case this exists for: a licence card printing "MANUALLY OPERATED
   * RIFLE" gives us both a type and an action, but only by splitting one
   * string. The type is read; the action is inferred, and the screen tags it
   * "split from 'manually operated rifle' — check". One field that wants a
   * human, marked rather than buried.
   */
  inferred?: boolean;
}

/** Answer key → provenance. The shape stored in `Motivation.answerProvenance`. */
export type ProvenanceMap = Record<string, AnswerProvenance>;

/** Sources that mean "we did this", as opposed to the member doing it. */
export function isAutomatic(source: ProvenanceSource): boolean {
  return source !== 'MEMBER';
}

/** Runtime guard — the column is Json and predates any given deploy. */
export function isProvenanceSource(value: unknown): value is ProvenanceSource {
  return (
    typeof value === 'string' &&
    (PROVENANCE_SOURCES as readonly string[]).includes(value)
  );
}

/** ISO timestamp for a stamp. Injected in specs so a run is reproducible. */
function isoAt(at?: Date): string {
  return (at ?? new Date()).toISOString();
}

/**
 * Read the Json column back into a map, dropping anything that is not a
 * well-formed entry.
 *
 * ⚠️ DEFENSIVE ON PURPOSE. This column is not encrypted, not validated by
 * Postgres beyond "is Json", and will be read by code both older and newer
 * than whatever wrote it. A malformed entry must cost that one chip, never the
 * whole screen — the same fail-soft posture as an unreadable upload costing
 * the autofill rather than the attachment.
 *
 * A null column (every motivation that predates this feature) parses to `{}`,
 * which renders as no chips and counts zero. That is UNKNOWN, and it must not
 * be confused with MEMBER: we do not know who filled those answers, and
 * claiming the member did would be a lie told by a default.
 */
export function parseProvenance(raw: unknown): ProvenanceMap {
  if (raw === null || raw === undefined) return {};
  let source: unknown = raw;
  // Prisma hands back parsed Json, but a hand-written migration or a raw query
  // can hand back the string. Accept both rather than losing the column.
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      return {};
    }
  }
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    return {};
  }

  const out: ProvenanceMap = {};
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (!key || typeof value !== 'object' || value === null) continue;
    const entry = value as Record<string, unknown>;
    if (!isProvenanceSource(entry.source)) continue;
    if (typeof entry.from !== 'string') continue;
    if (typeof entry.at !== 'string') continue;

    const clean: AnswerProvenance = {
      source: entry.source,
      from: entry.from,
      at: entry.at,
    };
    if (typeof entry.sourceId === 'string' && entry.sourceId) {
      clean.sourceId = entry.sourceId;
    }
    if (entry.inferred === true) clean.inferred = true;
    out[key] = clean;
  }
  return out;
}

/** What a caller supplies to stamp a set of keys. `at` is filled in for them. */
export interface StampInput {
  source: ProvenanceSource;
  sourceId?: string;
  from: string;
  inferred?: boolean;
}

/**
 * Record that `keys` were filled from `input`, returning a NEW map.
 *
 * ⚠️ REFUSES TO OVERWRITE A MEMBER ENTRY, and that refusal is the whole point
 * of routing every write through here. A caller that wrote the map directly
 * would eventually — on a re-sync, a second upload, a re-applied offer —
 * overwrite a correction the member made by hand, and nothing would catch it
 * because the answer blob and the provenance map are written in the same
 * breath.
 *
 * Stamping MEMBER over MEMBER is allowed: that is a member editing twice.
 */
export function stamp(
  map: ProvenanceMap,
  keys: readonly string[],
  input: StampInput,
  at?: Date,
): ProvenanceMap {
  if (!keys.length) return map;
  const stampedAt = isoAt(at);
  const out: ProvenanceMap = { ...map };

  for (const key of keys) {
    if (!key) continue;
    // The one invariant. An automatic pass may not touch a hand-edited field.
    if (out[key]?.source === 'MEMBER' && input.source !== 'MEMBER') continue;

    const entry: AnswerProvenance = {
      source: input.source,
      from: input.from,
      at: stampedAt,
    };
    if (input.sourceId) entry.sourceId = input.sourceId;
    if (input.inferred) entry.inferred = true;
    out[key] = entry;
  }
  return out;
}

/**
 * Mark `keys` as the member's own, returning a NEW map.
 *
 * Called from the answers-update path for exactly the keys whose VALUE
 * CHANGED — not for every key in the payload. The wizard sends the whole step
 * back on every save, so stamping the payload's keys would flip every
 * prefilled field on the step to MEMBER the first time the member pressed
 * Continue without touching anything, and the banner would empty itself.
 */
export function markMember(
  map: ProvenanceMap,
  keys: readonly string[],
  at?: Date,
): ProvenanceMap {
  return stamp(map, keys, { source: 'MEMBER', from: SOURCE_LABELS.MEMBER }, at);
}

/**
 * The keys whose value differs between two answer sets.
 *
 * Used to decide what `markMember` is called with. A key present in `next` and
 * absent from `previous` counts as changed; a key the member CLEARED counts as
 * changed too, because deleting a prefilled value is a decision about it.
 */
export function changedKeys(
  previous: Record<string, string>,
  next: Record<string, string>,
): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(next)) {
    if ((previous[key] ?? '') !== (value ?? '')) out.push(key);
  }
  return out;
}

/**
 * How many answers we filled without being asked — the wizard's opening line.
 *
 * Counts only keys that still hold a value: a prefilled field the member later
 * cleared is not something we filled for them, and counting it would make the
 * banner claim credit for work that is not on the screen.
 */
export function automaticCount(
  map: ProvenanceMap,
  answers: Record<string, string> = {},
): number {
  let count = 0;
  for (const [key, entry] of Object.entries(map)) {
    if (!isAutomatic(entry.source)) continue;
    if (Object.keys(answers).length && !(answers[key] ?? '').trim()) continue;
    count += 1;
  }
  return count;
}

/**
 * The distinct sources behind the automatic fills, most-used first.
 *
 * Drives the banner's second line — "your ID and proof of address came from
 * your Document Centre; the firearm was read off the card you photographed" —
 * without the frontend having to group the map itself.
 */
export function automaticSources(map: ProvenanceMap): ProvenanceSource[] {
  const counts = new Map<ProvenanceSource, number>();
  for (const entry of Object.values(map)) {
    if (!isAutomatic(entry.source)) continue;
    counts.set(entry.source, (counts.get(entry.source) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || PROVENANCE_SOURCES.indexOf(a[0]) - PROVENANCE_SOURCES.indexOf(b[0]))
    .map(([source]) => source);
}
