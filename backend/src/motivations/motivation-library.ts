import { MotivationUploadKind } from '@prisma/client';
import {
  asksPlace,
  primaryUploadKind,
  reuseCaution,
} from './motivation-credentials';

// ────────────────────────────────────────────────────────────────────
// THE MEMBER'S DOCUMENT LIBRARY.
//
// A firearm licence application is mostly the same paperwork as the last one.
// The ID copy never changes. The safe photographs never change until the safe
// does. The competency certificate changes only when a new one is issued —
// and there are four of them, so which one is a real question, but "do I have
// to photograph it again" should not be.
//
// ⚠️ IT IS A UNION OF TWO STORES, because neither one is the library on its
// own. The Licence Centre vault holds documents that EXPIRE — licences,
// competency, dedicated status — because expiry is what it exists to chase.
// It has no concept of an ID copy or a photograph of a safe, and it should
// not: nothing about them expires. Those live only as uploads against a
// motivation. So the library is the vault PLUS everything the member has
// already attached to any of their motivations.
//
// ⚠️ DEDUPED ON SHA256, ACROSS BOTH STORES. The same photograph reaches a
// second motivation as a copy with its own row and its own encrypted blob;
// listing both would show the member two identical entries and make them
// choose between them. One document, one line, newest first.
//
// Pure: rows in, list out. No Prisma, no decryption, no clock.
// ────────────────────────────────────────────────────────────────────

export interface LibraryCredentialRow {
  id: string;
  kind: string;
  title: string;
  createdAt: Date;
  /**
   * The date printed on the document, yyyy-mm-dd, where the vault holds one.
   *
   * ⚠️ NOT createdAt. A proof of address is judged on the date printed on it,
   * and somebody can upload a six-month-old bill today.
   */
  issuedOn?: string | null;
  storageKey: string | null;
  purgedAt: Date | null;
  sha256: string | null;
}

export interface LibraryUploadRow {
  id: string;
  motivationId: string;
  kind: MotivationUploadKind;
  createdAt: Date;
  storageKey: string | null;
  purgedAt: Date | null;
  sha256: string;
}

/**
 * DOCUMENTS THAT BELONG TO ONE APPLICATION AND MUST NEVER BE OFFERED ON ANOTHER.
 *
 * ⚠️ THIS FIXES A LIVE BUG, not a theoretical one. `library()` scopes its
 * upload query to `motivation: { userId }` — every application the member has
 * ever filed — and takeUpload below applied NO kind filter, so a second
 * section 16 was offered LAST YEAR'S ASSOCIATION ENDORSEMENT under the label
 * "The association's endorsement for this firearm". That endorsement names one
 * firearm by serial. Attaching it would have put a document describing a
 * different rifle in front of a Designated Firearms Officer, over the
 * applicant's signature.
 *
 * The guard existed and was in the wrong place: motivations.service.ts kept
 * the endorsement out of `suggested` (the auto-attach offer) and left it in
 * `items` (the picker), which is the list a member actually chooses from.
 *
 * Each entry is here for a reason written in the schema's own enum comments:
 *  - ASSOCIATION_ENDORSEMENT — names ONE firearm.
 *  - FIREARM_SOURCE_PROOF   — "a given application has exactly one answer to
 *                              'whose firearm is this'".
 *  - SELLER_LICENCE         — another living person's licence. Not the
 *                              member's document to carry forward.
 *  - PREVIOUS_MOTIVATION    — a past application, filed against a past firearm.
 *  - OTHER                  — unclassified by definition; we cannot say what it
 *                              is, so we cannot say it is safe to reuse.
 *  - SAFE_PHOTO             — retired, and unlike the four shots that replaced
 *                              it, NOT worth carrying forward: it predates any
 *                              of the guidance about what to photograph, so
 *                              nobody can say what it shows.
 *
 * ⚠️ NOT A DISPLAY FILTER. It is applied here AND again in addFromLibrary,
 * because POST /motivations/:id/uploads/from-library is directly callable and
 * a frontend that never shows the option is not a boundary.
 */
export const NEVER_REUSABLE: ReadonlySet<MotivationUploadKind> = new Set([
  MotivationUploadKind.ASSOCIATION_ENDORSEMENT,
  MotivationUploadKind.FIREARM_SOURCE_PROOF,
  MotivationUploadKind.SELLER_LICENCE,
  MotivationUploadKind.PREVIOUS_MOTIVATION,
  MotivationUploadKind.OTHER,
  MotivationUploadKind.SAFE_PHOTO,
]);

export interface LibraryItem {
  source: 'credential' | 'upload';
  sourceId: string;
  /** The upload slot this document can fill on a motivation. */
  kind: MotivationUploadKind;
  /** The document's own name, in the member's words. */
  title: string;
  addedOn: string;
  /** Already attached to the motivation being filled in. */
  alreadyHere: boolean;
  /**
   * A note to show beside it, or null.
   *
   * ⚠️ IT IS A WARNING, NOT A BLOCK. A proof of address four months old is
   * still the applicant's proof of address and they may have a good reason to
   * send it; what must never happen is it going in silently and a DFO being
   * the one to notice. 'stale' means we can see the problem from the date;
   * 'ask' means only the applicant can know.
   */
  caution: { tone: 'ask' | 'stale'; text: string } | null;
  /**
   * Needs "this is the safe at the address on this application" ticked before
   * it can be attached.
   *
   * ⚠️ ASKED, NEVER INFERRED. There is no structured address on a stored
   * photograph to compare against, and guessing wrong means somebody submits
   * pictures of the wall at their old house.
   */
  askPlace: boolean;
}

/** A Date to yyyy-mm-dd, in UTC — the same day boundary the vault uses. */
function isoDay(d: Date): string {
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

/**
 * Everything the member could reuse, newest first.
 *
 * @param credentials  vault rows, any kind
 * @param uploads      the member's uploads across ALL their motivations
 * @param currentId    the motivation being filled in
 * @param labelFor     upload kind → the member-facing name
 */
export function buildLibrary(
  credentials: LibraryCredentialRow[],
  uploads: LibraryUploadRow[],
  currentId: string,
  labelFor: (kind: MotivationUploadKind) => string,
  /**
   * ⚠️ A PARAMETER, NOT `new Date()`. This module's header promises "no
   * clock", and the staleness notes below are the first thing in it that
   * depends on today's date. Passing it in keeps the function pure and keeps
   * the tests honest at a frozen date.
   *
   * Defaulted so the many existing callers that do not care keep working.
   */
  today: Date = new Date(0),
): LibraryItem[] {
  // What is already on this motivation, by content — so a document the member
  // has attached here shows as attached even though its row is a different id
  // from the library copy they took it from.
  const here = new Set(
    uploads
      .filter((u) => u.motivationId === currentId && !u.purgedAt)
      .map((u) => u.sha256),
  );

  const items: LibraryItem[] = [];
  const seen = new Set<string>();

  const takeUpload = (u: LibraryUploadRow) => {
    // ⚠️ ONLY FROM ANOTHER APPLICATION. A document that is ALREADY on this one
    // still has to appear, or the slot it fills would render as empty and the
    // member would be asked to photograph a paper sitting right there. What
    // must never happen is CARRYING one across.
    if (u.motivationId !== currentId && NEVER_REUSABLE.has(u.kind)) return;
    // ⚠️ NOT PURGED, AND STILL ON DISK. A row whose bytes retention has
    // deleted is a record that the document once existed — offering it as
    // something to reuse would fail at the moment of copying, after the
    // member had chosen it.
    if (!u.storageKey || u.purgedAt) return;
    if (seen.has(u.sha256)) return;
    seen.add(u.sha256);
    const addedOn = isoDay(u.createdAt);
    items.push({
      source: 'upload',
      sourceId: u.id,
      kind: u.kind,
      title: labelFor(u.kind),
      addedOn,
      alreadyHere: here.has(u.sha256),
      // ⚠️ NOTHING TO SAY ABOUT ONE THAT IS ALREADY ON THIS APPLICATION. The
      // caution is about carrying a document ACROSS; warning somebody that
      // the proof of address they attached this morning might be stale is
      // noise that teaches them to ignore the notes that matter.
      caution:
        u.motivationId === currentId
          ? null
          : // A motivation upload has no issue date of its own — only the
            // vault records one — so freshness falls back to when it arrived.
            reuseCaution(u.kind, null, addedOn, today),
      askPlace: u.motivationId !== currentId && asksPlace(u.kind),
    });
  };

  const takeCredential = (c: LibraryCredentialRow) => {
    if (!c.storageKey || c.purgedAt) return;
    // The row it would be filed as. A document covering several rows is still
    // ONE library entry — the extra roles ride on the stored upload.
    const kind = primaryUploadKind(c.kind);
    // A vault document with no motivation slot — a PROFESSIONAL_HUNTER
    // registration, an OTHER — is kept and tracked, and simply has nothing to
    // fill here.
    if (!kind) return;
    if (c.sha256 && seen.has(c.sha256)) return;
    if (c.sha256) seen.add(c.sha256);
    const addedOn = isoDay(c.createdAt);
    items.push({
      source: 'credential',
      sourceId: c.id,
      kind: kind as MotivationUploadKind,
      // The vault's own title, which the member typed or we read off it —
      // more use than the generic slot name when they hold four competency
      // certificates.
      title: c.title,
      addedOn,
      alreadyHere: c.sha256 ? here.has(c.sha256) : false,
      // ⚠️ THE ISSUE DATE, WHERE THE VAULT HAS ONE. A member can photograph a
      // six-month-old municipal bill today, so judging it by when it reached
      // us would call a stale document fresh — which is the one direction this
      // check must never fail in.
      caution: reuseCaution(
        kind as MotivationUploadKind,
        c.issuedOn ?? null,
        addedOn,
        today,
      ),
      askPlace: asksPlace(kind as MotivationUploadKind),
    });
  };

  // ⚠️ UPLOADS ON THIS MOTIVATION ARE CONSIDERED FIRST, so that when the same
  // document exists in both stores the entry the member sees is the one
  // already in front of them, marked as attached, rather than a vault copy
  // that looks like a new choice.
  const ordered = [...uploads].sort((a, b) => {
    const aHere = a.motivationId === currentId ? 0 : 1;
    const bHere = b.motivationId === currentId ? 0 : 1;
    if (aHere !== bHere) return aHere - bHere;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
  for (const u of ordered) takeUpload(u);
  for (const c of [...credentials].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )) {
    takeCredential(c);
  }

  return items;
}

/** Just the items that could fill one slot. */
export function libraryFor(
  items: LibraryItem[],
  kind: MotivationUploadKind,
): LibraryItem[] {
  return items.filter((i) => i.kind === kind);
}
