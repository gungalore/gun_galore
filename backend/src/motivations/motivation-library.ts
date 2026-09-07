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
// ⚠️ AND FOLDED BY PAIR, WHICH SHA256 CANNOT DO. A two-page document is two
// photographs of two different pages, so the hashes differ by definition and
// both pages passed every filter here — every proficiency appeared twice.
// See otherSideId and leadsPair below; picking the survivor attaches BOTH
// pages, which is attachWithOtherSide's job in motivation-documents.service.
//
// ⚠️ AND THE FOLD SPANS BOTH STORES, BECAUSE THE FIRST ONE DID NOT AND LOST A
// PAGE. The fold was applied to the vault half only, ahead of the sha256
// dedupe, so a copy of the LEAD page sitting on an earlier application could
// remove the lead from the list after the follower had already stood down —
// and the document was then offered NOWHERE. Run against the real function on
// 2026-09-07: a vault pair plus one upload copy of the back page offered
// `["upload:u2"]`, and picking it attached a statement of results with no
// certificate behind it. The same two gates hid a page the member had DELETED
// from the pack they were filling in, so it could never be put back.
//
// The rule this file now keeps, and every fold spec below asserts:
//   ONE ENTRY PER DOCUMENT — never two, and NEVER ZERO.
// A page of a vault pair is listed from the VAULT, whichever store the member
// happens to hold copies in, because a vault entry is the only one that knows
// where its other page is. See partnerOf/vaultPageOf below.
//
// ⚠️ ONE CASE STAYS DOUBLE, AND IT IS DOUBLE BECAUSE NOTHING KNOWS BETTER.
// Two upload copies whose vault rows the member has since DELETED from their
// Centre: `otherSideId` went with the rows, and `sourceCredentialId` is nulled
// by the delete (schema.prisma, onDelete: SetNull), so no column anywhere
// records that those two files are one document. Two lines is then the honest
// answer — folding on a guess would hide a page. Attaching both by hand still
// produces a complete pack, which is the outcome that matters.
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
  /**
   * WHICH document of its kind this is, where the kind covers several.
   *
   * ⚠️ THE GOOD STANDING LETTER NEEDS THIS TO BE REACHABLE AT ALL. Four
   * association documents were folded into one CredentialKind, so a sworn
   * letter and a status card are both DEDICATED_DISCIPLINE — and the slot a
   * credential is offered in came from primaryUploadKind(), which returns the
   * FIRST covered kind and nothing else. Every association document therefore
   * appeared under "dedicated status certificate" and the "letter of good
   * standing" slot's reuse list was permanently empty, whatever the member had
   * in their Centre. Set on adoption; see vault-adoption DISCIPLINE_TYPE.
   */
  disciplineType?: string | null;
  /**
   * The other page of a two-sided document, where the vault has paired them.
   *
   * ⚠️ WITHOUT IT THE PICKER SHOWS EVERY PROFICIENCY TWICE. A two-page
   * proficiency is TWO Credential rows — the provider's certificate (front)
   * and the PFTC statement of results (back) — carrying the same derived
   * title and the same day. The only de-duplication here is sha256, and two
   * photographs of two different pages can never share one; both also map to
   * PROFICIENCY_CERTIFICATE, so both survived the slot filter too. Four
   * documents rendered as eight lines (operator, 2026-09-07: "the
   * proficiencies are still double in that dropdown").
   *
   * Set on BOTH rows by the Licence Centre's pairing pass, so either page can
   * find the other.
   */
  otherSideId?: string | null;
  /**
   * Which page this is, as the reader recorded it.
   *
   * ⚠️ DECRYPTED BY THE CALLER. `document_side` lives in the details blob
   * behind blob-crypto, and this module's header promises no decryption — so
   * the service reads it and hands it in already resolved.
   */
  documentSide?: 'front' | 'back' | null;
  storageKey: string | null;
  purgedAt: Date | null;
  sha256: string | null;
}

/** One page of a two-page document, as far as the lead rule is concerned. */
interface PairPage {
  id: string;
  createdAt: Date;
  documentSide?: 'front' | 'back' | null;
}

/**
 * Of a two-page document, the page that stands for both in a list.
 *
 * ⚠️ THE SAME RULE AS THE DOCUMENT CENTRE'S, AND IT HAS TO STAY THAT WAY.
 * `leadsPair` in frontend/lib/document-centre-sections.ts decides which page
 * the member sees on the Licence Centre list; this decides which one they see
 * in the reuse picker and which one auto-link treats as the candidate. Two
 * different answers means the line they recognise from their Centre is not the
 * line they are offered here.
 *
 * The statement of results leads, because it is the page carrying the unit
 * standards; a front page loses to any partner; and where the reading never
 * said which side is which, the older page leads with the id breaking a tie,
 * so the answer is the same on every call.
 *
 * ⚠️ ONE PLACE IT IS STRICTER THAN THE CENTRE'S. Two pages recorded as the
 * SAME side both "lead" under the frontend's wording, which shows the document
 * twice — the exact fault this is here to fix. That pairing cannot happen
 * today (findOtherSide only ever pairs opposite sides) but a re-read can
 * change a side after the fact, so the tie falls through to the date and the
 * id and exactly one page leads whatever the two of them say.
 */
export function leadsPair(row: PairPage, other: PairPage): boolean {
  const s = row.documentSide ?? null;
  const t = other.documentSide ?? null;
  if (s !== t) {
    if (s === 'back') return true;
    if (t === 'back') return false;
    if (s === 'front') return false;
    if (t === 'front') return true;
  }
  const a = row.createdAt.getTime();
  const b = other.createdAt.getTime();
  if (a !== b) return a < b;
  return row.id < other.id;
}

export interface LibraryUploadRow {
  id: string;
  motivationId: string;
  kind: MotivationUploadKind;
  createdAt: Date;
  storageKey: string | null;
  purgedAt: Date | null;
  sha256: string;
  /**
   * The vault row this copy was taken from, where there is one.
   *
   * ⚠️ THE UPLOAD HALF OF THE PAIR FOLD, AND ITS ABSENCE IS WHY THE OPERATOR
   * STILL SAW A DOUBLE. Pairing is recorded on Credential.otherSideId and
   * nowhere else, so a copy of a page can only find its partner through the
   * vault row it came from. `library()` selected this column for the auto-link
   * query and not for the picker's, so two upload copies of one proficiency —
   * the state of every member who has already filed one application — rendered
   * as two identical lines whatever the vault half did.
   *
   * Optional because a copy taken before the column existed, or one adopted
   * the other way round (upload first, vault second), carries null. Content
   * answers those: see vaultPageOf.
   */
  sourceCredentialId?: string | null;
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
/** Is this string a real MotivationUploadKind? Guards the stored disciplineType. */
function isUploadKind(v: string): boolean {
  return Object.prototype.hasOwnProperty.call(MotivationUploadKind, v);
}

/**
 * The upload slot a vault document is offered in, or null for one that fills
 * nothing here.
 *
 * ⚠️ WHAT IT ACTUALLY IS BEATS WHAT ITS KIND DEFAULTS TO. primaryUploadKind
 * returns the first covered kind, which is right for a credential whose kind
 * means one thing and wrong for DEDICATED_DISCIPLINE, which covers both the
 * status card and the sworn good standing letter. Offering a member's sworn
 * letter as their "dedicated status certificate" attaches it under the wrong
 * annexure heading in front of a DFO — and leaves the good standing slot
 * claiming they have nothing.
 *
 * Hoisted out of takeCredential so the pair fold below can ask the same
 * question of a page it is NOT about to emit — see `offerable`: a partner that
 * fills no slot is not in the list, so the page in hand must not fold itself
 * away behind it.
 */
function slotFor(c: LibraryCredentialRow): MotivationUploadKind | null {
  const declared = (c.disciplineType ?? '').trim();
  return declared && isUploadKind(declared)
    ? (declared as MotivationUploadKind)
    : (primaryUploadKind(c.kind) ?? null);
}

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

  // ── the vault, indexed twice, because a pair can be reached from either
  //    store and from either page ──────────────────────────────────────
  //
  // ⚠️ BY CONTENT AS WELL AS BY ID. An upload adopted INTO the vault carries
  // no sourceCredentialId — the copy went the other way — so the only thing
  // tying that upload to the vault row holding its pairing is the bytes. Both
  // rows hash the same plaintext, so the hash is a reliable join and it costs
  // nothing here.
  const vault = new Map<string, LibraryCredentialRow>();
  const vaultBySha = new Map<string, LibraryCredentialRow>();
  for (const c of credentials) {
    vault.set(c.id, c);
    if (c.sha256 && !vaultBySha.has(c.sha256)) vaultBySha.set(c.sha256, c);
  }

  /**
   * Could this vault page be offered at all — bytes still on disk, and a slot
   * on this application to fill?
   *
   * The fold asks it of a page it is NOT about to emit, so it has to be the
   * same question a page is listed under. A partner that fills no slot, or
   * whose bytes retention has deleted, is not in the list — so the page in
   * hand must not fold itself away behind it.
   */
  const offerable = (c: LibraryCredentialRow): boolean =>
    !!c.storageKey && !c.purgedAt && !!slotFor(c);

  /**
   * The other page of this document, where BOTH pages can still be offered.
   *
   * ⚠️ SYMMETRIC ON `offerable`, AND THAT IS WHAT MAKES "NEVER ZERO" TRUE. A
   * pair exists only when each page would stand on its own, so the page that
   * leads is always a page this function is willing to emit. Fold one of them
   * away on a condition the other does not share and the document disappears.
   */
  const partnerOf = (
    c: LibraryCredentialRow,
  ): LibraryCredentialRow | undefined => {
    if (!c.otherSideId || !offerable(c)) return undefined;
    const other = vault.get(c.otherSideId);
    return other && offerable(other) ? other : undefined;
  };

  /** The vault page an upload is a copy of, by id where we have one, else by content. */
  const vaultPageOf = (u: LibraryUploadRow): LibraryCredentialRow | undefined =>
    (u.sourceCredentialId ? vault.get(u.sourceCredentialId) : undefined) ??
    vaultBySha.get(u.sha256);

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
    // ⚠️ A PAGE OF A VAULT PAIR IS LISTED FROM THE VAULT, NEVER FROM HERE, AND
    // THIS IS THE HALF THAT WAS MISSING. Two upload copies of one proficiency
    // rendered as two identical lines — same slot, same label, same day —
    // which is the double the operator reported, on the path every member who
    // has already filed an application is on.
    //
    // ⚠️ AND IT IS NOT ONLY COSMETIC. A copy cannot carry its other page: the
    // pairing lives on the Credential row. Offering the copy and hiding the
    // vault entry behind it is how a certificate reached a DFO with no
    // statement of results behind it. Deliberately NOT added to `seen`, so the
    // vault entry that replaces it is free to be emitted.
    const behind = vaultPageOf(u);
    if (behind && partnerOf(behind)) return;
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
    // ⚠️ ONE LINE PER DOCUMENT, NOT ONE PER PAGE OF IT. Both pages of a
    // proficiency carry the same title and the same day, and their sha256s
    // differ by definition — two photographs of two different pages — so
    // nothing else here folds them. See leadsPair, and the note on
    // otherSideId: the picker was showing four documents as eight options.
    //
    // ⚠️ A PAGE WHOSE PARTNER IS ABSENT STILL STANDS ALONE. A lone
    // certificate is still a document the member can attach; disappearing
    // with a partner that was never uploaded would be worse than the double.
    const other = partnerOf(c);
    if (other && !leadsPair(c, other)) return;
    // The row it would be filed as. A document covering several rows is still
    // ONE library entry — the extra roles ride on the stored upload.
    const kind = slotFor(c);
    // A vault document with no motivation slot — a PROFESSIONAL_HUNTER
    // registration, an OTHER — is kept and tracked, and simply has nothing to
    // fill here.
    if (!kind) return;
    // ⚠️ THE CONTENT DEDUPE MAY NOT OUTRANK THE FOLD, and letting it did the
    // damage. The follower has already stood down by this line; dropping the
    // LEAD as well — which an upload copy of the same bytes used to do — left
    // the document offered nowhere at all. A page that leads a pair is
    // therefore never removed by `seen`, and both pages' hashes go in, so
    // nothing later can list either of them a second time.
    if (!other && c.sha256 && seen.has(c.sha256)) return;
    if (c.sha256) seen.add(c.sha256);
    if (other?.sha256) seen.add(other.sha256);
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
      // ⚠️ THE WHOLE DOCUMENT, NOT THE PAGE THAT LEADS IT, AND THE DIFFERENCE
      // IS A PACK THE MEMBER CANNOT REPAIR. The picker hides an
      // `alreadyHere` row outright, so a pair whose lead was still attached
      // and whose follower the member had DELETED read as "you already have
      // this" with half of it missing, and no screen offered a way back.
      // Attaching the entry again is idempotent per page — attachOne hands
      // back the row that already exists — so an incomplete document is
      // exactly the thing that must stay on offer.
      alreadyHere: (other ? [c, other] : [c]).every(
        (p) => !!p.sha256 && here.has(p.sha256),
      ),
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
