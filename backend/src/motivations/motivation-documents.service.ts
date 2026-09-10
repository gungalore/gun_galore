import { DocumentReadCacheService } from './document-read-cache.service';
import {
  BadRequestException,
  GoneException,
  ServiceUnavailableException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  MotivationLicenceType,
  MotivationStatus,
  MotivationUploadKind,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { VaultLogService } from '../common/vault-log.service';
import { SecureFileStorageService } from '../common/secure-file-storage.service';
import { encryptJson, decryptJson } from '../common/blob-crypto';
import { parseProvenance, stamp } from '../common/answer-provenance';
// "NONE" on a licence card is the card saying there is nothing in that row —
// never an answer on a form somebody signs. The readers and the vault keep the
// card verbatim; this is the answer boundary. See card-placeholder.ts.
import { answerValue } from '../common/card-placeholder';
import { MotivationQuotaService } from './motivation-quota.service';
import { requiredEndorsement } from './motivation-eligibility';
import { decideAutolink, endorsementMoved } from './motivation-autolink';
import {
  primaryUploadKind,
  asksPlace,
  uploadKindsFor,
  S16_AUTO_ATTACH,
  validLongEnough,
  toIsoDay,
} from './motivation-credentials';
import { buildLibrary, leadsPair, NEVER_REUSABLE } from './motivation-library';
import { VaultAdoptionService } from './vault-adoption.service';
import { VaultConsentService } from '../users/vault-consent.service';
import { buildAnnexures, UPLOAD_KIND_LABELS } from './motivation-checklist';
import {
  FIELD_REGISTRY_VERSION,
  fieldsFor,
  isVisible,
  missingRequired,
  sanitiseAnswers,
} from './motivation-fields';
import {
  ExtractedField,
  MotivationExtractService,
} from './motivation-extract.service';
import {
  documentLabel,
  documentStatus,
  pickableKinds,
} from './motivation-documents';
import { EDITABLE, MotivationSharedService } from './motivation-shared.service';
import { MotivationPrefillService } from './motivation-prefill.service';

// ────────────────────────────────────────────────────────────────────
// THE DOCUMENTS ON AN APPLICATION — the library the member picks from,
// the auto-link that picks for them, and the uploads themselves. The only
// writer to the encrypted store.
// ────────────────────────────────────────────────────────────────────

/**
 * How many library documents one auto-link run copies at once.
 *
 * ⚠️ THREE. Each attachment is a decrypt, a re-encrypt, a disk write and
 * — for a kind the vault could not already answer — a Claude vision call. One
 * at a time is a request nginx cuts off at 60s; all at once is eight concurrent
 * model calls into a rate limit that fails the run rather than one document.
 */
const AUTOLINK_CONCURRENCY = 3;

/** How many same-type documents to compare against for sameness. */
/**
 * Upload limits.
 *
 * 10 MB matches the tier this codebase already uses for identity documents and
 * AI-backed uploads (kyc.controller.ts, transactions.controller.ts). It is a
 * SECOND check behind the interceptor's: multer aborts the request with a bare
 * 413, which is not something an applicant can act on, so the size is checked
 * again here where a readable message can be returned.
 *
 * The document cap exists so a runaway client cannot fill the encrypted store,
 * and it has to clear the largest legitimate pack with room to spare. Splitting
 * the safe photograph into three shots (2026-08-19) took the recommended set
 * for a dedicated licence from eight to ten, which left the old cap of twelve
 * with room for two extra documents — so sixteen, not twelve. A cap that a
 * thorough applicant can hit is a bug that only shows up in the field.
 */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_UPLOADS = 16;

/**
 * One application, opened once for a run of attachments.
 *
 * Named because two methods take it now — the copy itself and the pair
 * ride-along above it — and a run must not re-read the row between them.
 * See openForAttach.
 */
type AttachContext = {
  userId: string;
  row: {
    id: string;
    status: MotivationStatus;
    licenceType: MotivationLicenceType;
    answersEncrypted: string | null;
  };
};

@Injectable()
export class MotivationDocumentsService {
  private readonly logger = new Logger(MotivationDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: MotivationQuotaService,
    private readonly files: SecureFileStorageService,
    private readonly extract: MotivationExtractService,
    private readonly vaultAdoption: VaultAdoptionService,
    private readonly vaultConsent: VaultConsentService,
    private readonly shared: MotivationSharedService,
    private readonly vaultLog: VaultLogService,
    /**
     * The competency re-derivation, borrowed from the prefill service.
     *
     * ⚠️ BECAUSE applyExtraction IS ONE OF THE THREE WRITERS OF THE FIREARM,
     * AND THE ONLY HOOK WAS ON ANOTHER. `requiredEndorsement` reads
     * `firearm_type` and `firearm_action`, and this method writes both — off a
     * dealer-prefilled SAPS 271 or an association endorsement, which the
     * routing spec calls the common real-world case. saveAnswers re-derives
     * the competency when either changes; a firearm that arrived by DOCUMENT
     * did not, so the member's four competency boxes kept whatever was chosen
     * before anything knew which firearm this was — the exact fault the
     * operator hit on a fresh section 13, arriving by a second door.
     *
     * ⚠️ OPTIONAL IN THE SIGNATURE, INJECTED IN PRACTICE. Nest resolves it
     * from MotivationsModule like every other provider; the `?` is so a spec
     * that builds this service by hand for something else entirely does not
     * have to know about it. `?.` below means the worst case is the behaviour
     * that existed before, never a crash. No import cycle: the prefill service
     * knows nothing about this one.
     */
    /**
     * Before the optional prefill, because a required parameter cannot
     * follow an optional one — not because the order means anything.
     */
    private readonly readCache: DocumentReadCacheService,
    private readonly prefill?: MotivationPrefillService,
  ) {}

  // ── the document library ──────────────────────────────────────────

  /**
   * Everything the member could reuse on this motivation.
   *
   * ⚠️ IT READS BOTH STORES, because neither is the library on its own — the
   * vault chases expiry and has no concept of an ID copy or a photograph of a
   * safe; those exist only as uploads. See motivation-library.ts.
   *
   * ⚠️ EVERY UPLOAD THE MEMBER OWNS, NOT JUST THIS PACK'S. That is the whole
   * point: the second application should not ask for the ID again. Scoped by
   * `motivation: { userId: user.id }`, which is the only thing standing
   * between one member's library and another's.
   */
  async library(userId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(userId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: { id: true, licenceType: true, status: true },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    const offerAcross = await this.vaultConsent.mayOfferAcross(user.id);

    const [credentials, uploads] = await Promise.all([
      this.prisma.credential.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          kind: true,
          title: true,
          createdAt: true,
          storageKey: true,
          purgedAt: true,
          sha256: true,
          expiresOn: true,
          // WHICH association document this is, where its kind covers several.
          // Without it a sworn good standing letter is indistinguishable from a
          // status card in the vault, and the good standing slot's reuse list
          // is empty however many the member holds — see motivation-library.
          disciplineType: true,
          // The date PRINTED on the document, which is what a proof of address
          // is judged on — not when it was photographed.
          issuedOn: true,
          // ⚠️ THE OTHER PAGE, AND WITHOUT IT THE PICKER DOUBLED EVERY
          // PROFICIENCY. Two Credential rows, one document: the certificate
          // and its statement of results share a title and a day, and their
          // hashes differ by definition, so buildLibrary's sha256 fold could
          // never see them. Operator, 2026-09-07: "the proficiencies are still
          // double in that dropdown."
          otherSideId: true,
          // WHICH page it is, for the fold's lead rule. Read below, only for a
          // row that actually has a partner — see readSide.
          detailsEncrypted: true,
        },
      }),
      this.prisma.motivationUpload.findMany({
        // ⚠️ THE SCOPE NARROWS TO THIS APPLICATION WHERE SOMEBODY HAS SAID NO.
        //
        // Offering documents across applications is what the product already
        // does, so it is NOT switched off for people who have simply never
        // been asked — that would take a working feature away to punish them
        // for our omission. It stops for `declined` and `withdrawn`, the two
        // states where a person actually answered no.
        //
        // ⚠️ HERE, AND NOT INSIDE buildLibrary. That module's header promises
        // "rows in, list out, no Prisma, no clock", and the honest place to
        // narrow a result set is the query that produces it.
        where: {
          motivation: offerAcross ? { userId: user.id } : { id: row.id },
        },
        select: {
          id: true,
          motivationId: true,
          kind: true,
          createdAt: true,
          storageKey: true,
          purgedAt: true,
          sha256: true,
          // ⚠️ THE UPLOAD HALF OF THE PAIR FOLD, AND ITS ABSENCE LEFT THE
          // OPERATOR'S DOUBLE LIVE ON THE COMMONEST PATH. The auto-link query
          // 190 lines below has always selected it; this one did not, so
          // buildLibrary could not tell that two copies on an earlier
          // application were two pages of ONE proficiency and listed both.
          // Anyone who has filed a single application before is in that state.
          sourceCredentialId: true,
        },
      }),
    ]);

    const now = new Date();
    const items = buildLibrary(
      // ⚠️ THE BLOB STAYS HERE. motivation-library promises "rows in, list
      // out, no Prisma, no decryption", so the side is read on this side of
      // the boundary and handed over already resolved — and only for a page
      // that has a partner, because it is the only page the fold asks about.
      credentials.map(({ detailsEncrypted, ...c }) => ({
        ...c,
        issuedOn: c.issuedOn ? toIsoDay(c.issuedOn) : null,
        documentSide: c.otherSideId ? this.readSide(detailsEncrypted) : null,
      })),
      uploads,
      row.id,
      documentLabel,
      now,
    );

    // ── what a section 16 pack could be handed automatically ─────────
    //
    // ⚠️ OFFERED, NOT DONE. Attaching documents to somebody's licence
    // application without being asked is a decision made on their behalf
    // about what a DFO will see — and the one time it is wrong, they find out
    // at the counter. The list is returned and the wizard offers it in one
    // press; the press is theirs.
    //
    // ⚠️ NEVER THE ENDORSEMENT. It names ONE firearm, so a previous
    // application's endorsement describes the wrong gun. Status and good
    // standing describe the PERSON, and the person has not changed.
    const isS16 =
      row.licenceType === 'S16_DEDICATED_HUNTER' ||
      row.licenceType === 'S16_DEDICATED_SPORT';
    const expiryByCredential = new Map(
      credentials.map((c) => [
        c.id,
        c.expiresOn ? toIsoDay(c.expiresOn) : null,
      ]),
    );
    const suggested = !isS16
      ? []
      : items.filter(
          (i) =>
            S16_AUTO_ATTACH.includes(i.kind) &&
            !i.alreadyHere &&
            // Only vault documents carry an expiry we can judge. A previous
            // motivation's upload has no date on the row, so it is offered in
            // the library like anything else and simply not suggested.
            (i.source === 'credential'
              ? validLongEnough(
                  expiryByCredential.get(i.sourceId) ?? null,
                  now,
                )
              : false),
        );

    return { items, suggested };
  }

  /**
   * Attach a document the member already has, without asking for it again.
   *
   * ⚠️ THE BYTES ARE COPIED, NOT THE STORAGE KEY. Sharing one encrypted blob
   * between two motivations would mean the retention sweep purging one
   * application silently blanking a document in another — and the row that
   * lost its file would look, to its owner, exactly like a bug. A licence
   * card is under a megabyte; correctness is worth the disk.
   *
   * ⚠️ THE EXTRACTION IS COPIED TOO, when the source has one. Same file, same
   * kind, same answer — re-running vision would spend money to arrive back
   * where we started.
   */
  /**
   * Attach everything this application needs that the member already holds.
   *
   * Operator, 2026-08-24: "why can't the server add the relevant documents in
   * place and mark them green for me?"
   *
   * ⚠️ A POST, NEVER A SIDE EFFECT OF READING. The wizard calls this once when
   * the documents step is first opened. Attaching on a GET would mean a page
   * refresh, a poll or a second tab silently changing what is on somebody's
   * licence application — and the 20-second poll on that page would do it
   * every twenty seconds.
   *
   * ⚠️ CONSENT FIRST, AND `given` MEANS GIVEN. Not "has not said no". Reusing
   * vault documents unasked is new automatic processing and needs a yes;
   * mayKeep() is the one function allowed to answer that, so this asks it
   * rather than reading a column.
   *
   * Idempotent: a kind already attached is skipped, so calling it twice
   * attaches nothing twice.
   */
  async autolink(userId: string, id: string, placeConfirmed = false) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(userId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        licenceType: true,
        status: true,
        autolinkedAt: true,
        // Which vault rows this application has already been given and no
        // longer carries. See the column, and the note at the stamp below.
        autolinkSkippedIds: true,
        // The endorsement test needs to know what firearm this is for.
        answersEncrypted: true,
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');
    if (!EDITABLE.includes(row.status)) {
      return { attached: [], skipped: [], reason: 'not-editable' as const };
    }

    // ⚠️ ONCE PER APPLICATION, NOT ONCE PER PAGE LOAD, AND THIS GUARD IS THE
    // WHOLE DIFFERENCE BETWEEN A FEATURE AND A FIGHT. decideAutolink skips a
    // kind that is ALREADY ATTACHED — so the moment the member deleted a
    // document it was no longer attached, and the next load put it straight
    // back. The operator hit it within hours of the feature shipping: "why
    // can't I delete the proof of address?"
    //
    // A feature that silently undoes somebody's own deletions is worse than no
    // feature. The routing spec fills vault slots "at generator open", which
    // is once — so this records that it happened, and a delete stays deleted.
    /**
     * ⚠️ EXCEPT WHEN THE MEMBER HAS JUST ANSWERED THE ONE QUESTION THE FIRST
     * RUN ASKED, WHICH IS WHY THE SAFE PHOTOGRAPHS NEVER ARRIVED.
     *
     * The M6 design is: run once, hold the safe photographs back, report
     * `needsPlaceConfirm`, let the member tick "these are the safe at THIS
     * address", and run again with `placeConfirmed`. The first run stamps —
     * the held-back photographs land in `skipped`, so `considered > 0` — and
     * the second run then hit this guard and returned nothing. The tick could
     * never do anything, on any application, since the day it shipped.
     *
     * ⚠️ THE GUARD'S PURPOSE IS UNTOUCHED, and it is worth restating because
     * this is the exact bug it exists for: a member deletes a document, the
     * next load silently puts it back, and they cannot get rid of it. That is
     * about a run nobody asked for. `placeConfirmed` only ever arrives from a
     * tick the member just made, so this run is not silent and is not
     * unasked — and `wanted` is narrowed to the safe photographs below, so a
     * second run cannot resurrect anything else they deleted.
     */
    const placeRerun = !!row.autolinkedAt && placeConfirmed;
    if (row.autolinkedAt && !placeRerun) {
      return { attached: [], skipped: [], reason: 'already-done' as const };
    }

    if (!(await this.vaultConsent.mayKeepFor(user.id))) {
      // Not an error: they have simply not agreed, or have withdrawn. The
      // library still offers everything for them to attach by hand.
      return { attached: [], skipped: [], reason: 'no-consent' as const };
    }

    // ⚠️ CREDENTIALS ONLY, NOT UPLOADS FROM OTHER APPLICATIONS. The freshness
    // rule needs a date we can stand behind, and only a vault credential
    // carries one the member has CONFIRMED. An upload on a previous
    // application has no date on the row at all, so "is it still valid" would
    // be unanswerable — and answering it anyway is how a stale document gets
    // attached silently. Those still appear in the library to be attached by
    // hand, where the member can see what they are.
    const [credentials, uploads] = await Promise.all([
      this.prisma.credential.findMany({
        where: {
          userId: user.id,
          storageKey: { not: null },
          purgedAt: null,
          // ⚠️ SETTLED DATES, NOT CONFIRMED ONES, AND THE OLD PREDICATE MADE
          // THIS FEATURE DO NOTHING FOR AN ORDINARY MEMBER. C2. It read
          // `confirmedAt: { not: null }` on the grounds that "an unconfirmed
          // expiry is our reading of a document, not the member's answer, and
          // the whole freshness rule rests on it" — which was true when a tick
          // was the only way a date became trustworthy.
          //
          // Since 2026-08-25 the Document Centre fills in and ARMS dates
          // itself: `dateSource` set, `confirmedAt` still null, the reminder
          // sweep already acting on the value. That is the NORMAL state — the
          // operator's own vault holds five firearm licences and ZERO confirmed
          // rows — so this query returned an empty list for everybody and the
          // whole run reported "nothing to attach".
          //
          // Same predicate as the reminder sweep and as credentialsFor's
          // dateSettled: a date somebody stands behind, whether that somebody is
          // the member or our own arming. Two independent conditions, so they
          // go in an AND — Prisma takes one OR per object and would silently
          // keep only the last.
          AND: [
            { OR: [{ confirmedAt: { not: null } }, { dateSource: { not: null } }] },
          ],
        },
        select: {
          id: true,
          kind: true,
          coversKinds: true,
          disciplineType: true,
          title: true,
          expiresOn: true,
          // The pair's tie-breaker, for two pages the reader never labelled.
          // See leadsPair.
          createdAt: true,
          // The competency's own "covers" wording, for the endorsement test.
          detailsEncrypted: true,
          extractionOk: true,
          // The other half of a two-sided proficiency, attached with it.
          otherSideId: true,
        },
      }),
      this.prisma.motivationUpload.findMany({
        where: { motivationId: row.id },
        select: { kind: true, sha256: true, sourceCredentialId: true },
      }),
    ]);

    // What firearm is this application for? Null when they have not said, and
    // null switches the endorsement test off rather than failing it.
    const answersNow = this.shared.readAnswers(row.answersEncrypted);

    /**
     * What this application actually wants, by kind.
     *
     * ⚠️ WITH THE ANSWERS, AND IT SHIPPED WITH `{}`. Several needs are
     * CONDITIONAL — CURRENT_LICENCE is required only once the applicant has
     * said they own something, because "a first-time applicant owns nothing
     * and is never asked for one". Asking documentStatus with an empty blob
     * therefore describes a first-time applicant every time, and every
     * conditional kind was filtered straight out of the candidate list before
     * decideAutolink ever saw it. The operator's five firearm licences did not
     * come back as skipped; they came back as nothing at all.
     *
     * ⚠️ AND `[]` FOR THE ATTACHED KINDS STAYS. That argument is "what is
     * already on the application", and passing the real list would mark a need
     * satisfied and drop it out of `wanted` — which is the opposite of what
     * this is for. Whether a kind is already held is decided by `haveSet`
     * inside decideAutolink, which knows the difference between "settled" and
     * "wants more" (see TAKE_ALL_KINDS).
     */
    const wantedAll = documentStatus(row.licenceType, [], answersNow).needs.map(
      (n) => n.kind,
    );
    /**
     * ⚠️ A PLACE RE-RUN MAY ATTACH THE SAFE PHOTOGRAPHS AND NOTHING ELSE.
     *
     * The member ticked a box about their safe. That is consent to attach
     * safe photographs; it is not consent to re-run the whole library and put
     * back the proof of address they deleted an hour ago. Narrowing `wanted`
     * is all it takes — decideAutolink drops every candidate whose kind is not
     * in it, before any other rule runs.
     */
    const wanted = placeRerun
      ? wantedAll.filter((k) => k === MotivationUploadKind.SAFE_PHOTOGRAPHS)
      : wantedAll;

    /**
     * Vault rows this application must never be offered again.
     *
     * ⚠️ THE HALF THE RE-ARM WOULD OTHERWISE BREAK. `autolinkedAt` used to be
     * the whole guarantee: run once, never again, so a document the member
     * deleted stayed deleted. rearmAutolinkFor now clears that stamp when a
     * Credential is added or confirmed — which is the point, and which re-opens
     * "why can't I delete the proof of address?" unless something else
     * remembers.
     *
     * Two sources, and they answer different questions. `autolinkSkippedIds` is
     * what was attached and REMOVED, written at the removal because the upload
     * row is hard-deleted and takes its own sourceCredentialId with it.
     * `sourceCredentialId` on the surviving rows is what is attached RIGHT NOW,
     * which decideAutolink would otherwise only notice at the level of the
     * KIND — so a second competency certificate could be attached beside the
     * first.
     */
    const refuse = new Set<string>([
      ...row.autolinkSkippedIds,
      ...uploads
        .map((u) => u.sourceCredentialId)
        .filter((x): x is string => x !== null),
    ]);

    const needed = requiredEndorsement(answersNow);

    // ⚠️ A TWO-SIDED PROFICIENCY IS ONE CANDIDATE, NOT TWO. The certificate
    // and its statement of results both cover the same firearm, so both
    // would pass the gate and decideAutolink would see two candidates and
    // attach neither. The statement (the back) stands for the pair; when it
    // is attached, the front goes on with it (operator, 2026-09-07).
    //
    // ⚠️ ONE RULE, SHARED WITH THE PICKER, AND THE LOCAL COPY THIS REPLACES
    // COULD DROP BOTH PAGES. It read only its OWN side: a page the reader
    // never labelled, paired with a front, fell through to `id < other` — and
    // where that came out false the front had already said no, so neither page
    // stood for the pair and the proficiency vanished from the run. leadsPair
    // reads both sides, and is the same function buildLibrary and the Document
    // Centre's list decide with.
    const byId = new Map(
      credentials
        .filter((c) => !refuse.has(c.id))
        .map((c) => [
          c.id,
          {
            id: c.id,
            createdAt: c.createdAt,
            documentSide: this.readSide(c.detailsEncrypted),
          },
        ]),
    );
    const standsForPair = (c: (typeof credentials)[number]): boolean => {
      const mine = byId.get(c.id);
      const other = c.otherSideId ? byId.get(c.otherSideId) : undefined;
      if (!mine || !other) return true;
      return leadsPair(mine, other);
    };

    const candidates = credentials
      .filter((c) => !refuse.has(c.id) && standsForPair(c))
      .map((c) => {
        // The slot it actually belongs in — disciplineType beats the primary
        // kind, so a sworn good standing letter is not offered as a card.
        const declared = (c.disciplineType ?? '').trim();
        const kind =
          declared && declared in MotivationUploadKind
            ? (declared as MotivationUploadKind)
            : primaryUploadKind(c.kind);
        return kind
          ? {
              sourceId: c.id,
              source: 'credential' as const,
              kind,
              expiresOn: c.expiresOn ? toIsoDay(c.expiresOn) : null,
              title: c.title,
              covers: this.readCovers(c.detailsEncrypted, c.extractionOk),
            }
          : null;
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    // The unit standards of every proficiency ALREADY on this application, so
    // the pair rule can add the other half: a handgun statement attached by
    // hand still wants the 117705 one beside it (operator, 2026-09-07).
    const attachedIds = new Set(
      uploads
        .filter((u) => u.kind === MotivationUploadKind.PROFICIENCY_CERTIFICATE)
        .map((u) => u.sourceCredentialId)
        .filter((x): x is string => x !== null),
    );
    const attachedProficiencyCovers = credentials
      .filter((c) => attachedIds.has(c.id))
      .map((c) => this.readCovers(c.detailsEncrypted, c.extractionOk))
      .filter(Boolean);

    // The same, for the competency side. ⚠️ THE PAIR RULE COMPARES A CANDIDATE
    // AGAINST WHAT IS ALREADY THERE, not only against the other candidate in
    // the same run — otherwise a proficiency attached on Monday and a
    // competency attached on Tuesday end up describing different categories,
    // and the pack says two different things about what the applicant is
    // qualified for. Operator, 2026-09-08: "One cant be without the other."
    const attachedCompetencyIds = new Set(
      uploads
        .filter((u) => u.kind === MotivationUploadKind.COMPETENCY_CERTIFICATE)
        .map((u) => u.sourceCredentialId)
        .filter((x): x is string => x !== null),
    );
    const attachedCompetencyCovers = credentials
      .filter((c) => attachedCompetencyIds.has(c.id))
      .map((c) => this.readCovers(c.detailsEncrypted, c.extractionOk))
      .filter(Boolean);

    const decision = decideAutolink(
      candidates,
      wanted,
      uploads.map((u) => u.kind),
      new Date(),
      {
        needed,
        placeConfirmed,
        attachedProficiencyCovers,
        attachedCompetencyCovers,
      },
    );

    // ⚠️ THE APPLICATION IS OPENED ONCE FOR THE WHOLE RUN. M17. This used to
    // call addFromLibrary per document, and every one of those calls resolved
    // the provider subject again and re-read the motivation again — two round
    // trips per document to learn two things that cannot change inside a run.
    const openRow = await this.openForAttach(user.id, row.id);

    // ⚠️ THREE AT A TIME, AND THE CEILING IS THE POINT. Each attachment is a
    // decrypt, a re-encrypt, a disk write and — for a kind the vault could not
    // already answer — a Claude vision call of a second or more. Serially that
    // is a request nginx cuts off at 60s. Unbounded, a member with a full Centre
    // fires eight concurrent model calls and meets the API's own rate limit,
    // which fails the whole run instead of one document.
    // ⚠️ ONE ENTRY PER DOCUMENT, NOT PER PAGE. A proficiency is a certificate
    // and its statement of results, and the operator's rule for the Document
    // Centre is explicit — "once they are combined they should be seen as 1
    // document" (2026-09-07). This list is what the wizard's banner counts and
    // names, and it read "We added 4 documents from your Document Centre: ID
    // document, Proof of address, Proficiency - Handgun, Proficiency - Handgun
    // (other side)" on the operator's live section 16. Three documents, four
    // lines, the same proficiency twice. `pages` carries the second side
    // instead, so nothing is lost and nothing is double-counted.
    const attached: { kind: string; title: string; pages?: number }[] = [];
    /**
     * Documents that went on with a page missing.
     *
     * ⚠️ MERGED INTO `skipped` BELOW RATHER THAN LOGGED AND FORGOTTEN. The
     * skipped list is the one place this run says why something is not on the
     * pack — "so 'why is my competency not on here' has an answer the member
     * can read rather than a silence they have to guess at" — and a half
     * document is exactly that question asked about a page.
     */
    const partial: { kind: string; title: string; why: string }[] = [];
    /**
     * The rows this run is allowed to touch at all — the gated candidate query
     * above, by id. Passed to the pair ride-along so a partner faces the same
     * settled-date rule its lead did. See otherSideOf.
     */
    const gated = new Set(credentials.map((c) => c.id));
    const queue = [...decision.attach];
    const worker = async () => {
      for (;;) {
        const c = queue.shift();
        if (!c) return;
        try {
          const done = await this.attachWithOtherSide(
            { userId: user.id, row: openRow },
            c.source,
            c.sourceId,
            // A safe photograph only ever reaches here on an explicit yes —
            // decideAutolink refuses it otherwise — and attachOne's own
            // asksPlace check is the boundary, so the answer travels with it.
            placeConfirmed,
            // ⚠️ AND THE REFUSALS APPLY TO THE OTHER PAGE TOO. A member who
            // deleted the certificate must not have it handed back by the
            // statement of results riding in beside it — "why can't I delete
            // the proof of address?", one page along. The picker passes no
            // refusals, because there the member is doing the asking.
            //
            // ⚠️ AND `only` IS THE SETTLED-DATE GATE THIS RUN ALREADY APPLIED.
            // `credentials` is the gated candidate query above — confirmedAt
            // or dateSource, "a date somebody stands behind" — and looking the
            // partner up from the whole vault walked past it. See otherSideOf.
            { refuse, only: gated },
          );
          attached.push({
            kind: c.kind,
            title: c.title,
            ...(done.alsoAttached.length
              ? { pages: 1 + done.alsoAttached.length }
              : {}),
          });
          // ⚠️ SAID OUT LOUD, NOT ONLY LOGGED. A two-page document that
          // arrived as one page is the failure the ride-along exists to
          // prevent; when it happens anyway the member has to be able to see
          // it, and `skipped` is the list the wizard already reads.
          if (done.alsoFailed) {
            partial.push({
              kind: c.kind,
              title: `${c.title} (other side)`,
              why: done.alsoFailed.reason,
            });
          }
        } catch (err) {
          // ⚠️ ONE FAILURE MUST NOT COST THE REST. A purged file or a
          // since-deleted credential is a reason to skip that document, not to
          // abandon the other five the member does hold.
          this.logger.warn(
            `Motivation ${row.id}: could not auto-attach ${c.kind}: ${
              (err as Error).message
            }`,
          );
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(AUTOLINK_CONCURRENCY, queue.length) }, worker),
    );

    // ⚠️ STAMPED ONLY WHEN THERE WAS SOMETHING TO DECIDE. C2.
    //
    // It used to be stamped unconditionally, "even when nothing was attached",
    // on the reading that "we looked and there was nothing to add" is a
    // completed run. That was right while the candidate query worked. It was
    // catastrophic while the query was returning nothing for everybody: the
    // FIRST load of the documents step burned the one run the application ever
    // gets, against an empty list, and the member could never get it back — not
    // by uploading to their Centre, not by confirming anything, not by
    // reloading. The feature was permanently spent before it had ever run.
    //
    // So the stamp now means what it says: this application has been shown its
    // own library and a decision was taken about each document in it. No
    // candidates at all is not a decision, and leaving the stamp off costs one
    // cheap query on the next load.
    const considered = decision.attach.length + decision.skipped.length;
    if (considered > 0) {
      await this.prisma.motivation.update({
        where: { id: row.id },
        data: { autolinkedAt: new Date() },
      });
    }

    // The ledger: every candidate's fate, so "why did nothing attach" can be
    // answered later, across members, without anyone's documents.
    for (const c of decision.attach) {
      this.vaultLog?.note({
        stage: 'autolink',
        outcome: 'ok',
        code: 'attached',
        userId: user.id,
        motivationId: row.id,
        credentialId: c.source === 'credential' ? c.sourceId : null,
        detail: { kind: c.kind, needed: needed ?? null },
      });
    }
    for (const sk of decision.skipped) {
      this.vaultLog?.note({
        stage: 'autolink',
        outcome: 'skipped',
        code: sk.why,
        userId: user.id,
        motivationId: row.id,
        credentialId: sk.candidate.source === 'credential' ? sk.candidate.sourceId : null,
        detail: { kind: sk.candidate.kind, needed: needed ?? null },
      });
    }
    this.vaultLog?.note({
      stage: 'autolink',
      outcome: decision.attach.length ? 'ok' : 'missed',
      code: 'run',
      userId: user.id,
      motivationId: row.id,
      detail: {
        wanted,
        attached: attached.length,
        skipped: decision.skipped.length,
        needsPlaceConfirm: decision.needsPlaceConfirm,
        candidates: candidates.length,
      },
    });

    return {
      attached,
      // Said out loud, so "why is my competency not on here" has an answer
      // the member can read rather than a silence they have to guess at.
      skipped: [
        ...decision.skipped.map((s) => ({
          kind: s.candidate.kind,
          title: s.candidate.title,
          why: s.why as string,
        })),
        ...partial,
      ],
      needsPlaceConfirm: decision.needsPlaceConfirm,
      reason: 'ok' as const,
    };
  }

  /**
   * Let this member's open drafts look at their Document Centre again.
   *
   * C2. Auto-link runs ONCE per application, which is what stops it undoing
   * somebody's deletions — and it also meant that uploading the competency
   * certificate the wizard had just told you was missing changed nothing. The
   * member went back to the documents step and it still said missing, because
   * the one run had happened before the document existed.
   *
   * ⚠️ THE RE-ARM IS SAFE ONLY BECAUSE THE REFUSALS OUTLIVE IT. Clearing
   * `autolinkedAt` on its own re-opens "why can't I delete the proof of
   * address?": decideAutolink skips a kind that is ALREADY ATTACHED, so a
   * document the member removed is no longer attached and comes straight back.
   * `Motivation.autolinkSkippedIds` is the record that survives the removal —
   * see removeUpload, which writes it, and the `refuse` set in autolink, which
   * reads it.
   *
   * ⚠️ DRAFTS ONLY. An application that has been generated, paid for or
   * lodged is a fixed set of evidence; adding a page to it after the fact would
   * change what a DFO is holding.
   *
   * ⚠️ AND IT NEVER THROWS. The caller is the Licence Centre's upload path,
   * where a failure here must not cost somebody their document.
   */
  async rearmAutolinkFor(userId: string): Promise<number> {
    try {
      const { count } = await this.prisma.motivation.updateMany({
        where: {
          userId,
          status: { in: EDITABLE },
          autolinkedAt: { not: null },
        },
        data: { autolinkedAt: null },
      });
      if (count > 0) {
        this.logger.log(`Auto-link re-armed on ${count} draft(s) for ${userId}`);
      }
      return count;
    } catch (err) {
      this.logger.warn(
        `Could not re-arm auto-link for ${userId}: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  /**
   * The `covers` line off a vault document, for the endorsement test.
   *
   * Fail-soft in the module's established way: a blob we cannot open costs the
   * test, which reads an empty string as "we have not read this" and therefore
   * does not refuse. See competencyCovers — unknown is a yes, deliberately.
   */
  /**
   * Which side of a two-sided proficiency this is, as the reader recorded it.
   *
   * ⚠️ IT DOES NOT ASK extractionOk, AND THAT IS DELIBERATE. That column
   * answers "did anything read off this document at all"; a blob that
   * decrypts and names a side has plainly been read, whatever the column says
   * about the rest of it. The Document Centre's own `pageSide` reads the blob
   * with no such gate — and a fold that disagreed with the Centre about which
   * page leads would offer the member a different line from the one they
   * recognise.
   */
  private readSide(blob: string | null): 'front' | 'back' | null {
    if (!blob) return null;
    try {
      const d = decryptJson<Record<string, string>>(blob) ?? {};
      const s = (d.document_side ?? '').trim().toLowerCase();
      return s === 'front' || s === 'back' ? s : null;
    } catch {
      return null;
    }
  }

  private readCovers(blob: string | null, ok: boolean): string {
    if (!ok || !blob) return '';
    try {
      const d = decryptJson<Record<string, string>>(blob) ?? {};
      return (d.covers ?? d.unit_standard ?? '').trim();
    } catch {
      return '';
    }
  }

  async addFromLibrary(
    userId: string,
    id: string,
    source: 'credential' | 'upload',
    sourceId: string,
    /**
     * "These are the safe at the address on this application."
     *
     * ⚠️ REQUIRED FOR EVERY PHOTOGRAPH OF THE SAFE — one kind since
     * 2026-08-23, plus the retired four an older application still carries;
     * asksPlace() is the authority. CHECKED HERE RATHER THAN IN THE
     * PICKER. A photograph of a safe is a photograph of one safe at one
     * dwelling; a member who has moved house and reuses last year's shots has
     * submitted pictures of somebody else's wall, and nothing on the file says
     * so. There is no structured address stored against the photograph to
     * compare with, and inferring one wrongly is the exact failure this whole
     * feature exists to avoid — so it is asked.
     *
     * The route is directly callable, so a tick the frontend renders is a
     * convenience and this is the check.
     */
    placeConfirmed = false,
  ) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(userId);
    const row = await this.openForAttach(user.id, id);
    return this.attachWithOtherSide(
      { userId: user.id, row },
      source,
      sourceId,
      placeConfirmed,
    );
  }

  /**
   * Attach a library document AND the other page of it, where there is one.
   *
   * ⚠️ THE FOLD MUST NOT LOSE THE OTHER PAGE. The picker now shows a two-page
   * proficiency as ONE line — see buildLibrary — so the page the member cannot
   * see has to come with the one they pick. Without this the doubling is gone
   * and something far worse takes its place: a certificate filed with no
   * statement of results behind it, in front of a DFO, over the applicant's
   * signature. A cosmetic double is a nuisance; an incomplete pack is a wasted
   * trip to a police station.
   *
   * ⚠️ THE PARTNER IS FOUND FROM THE VAULT, NOT FROM THE REQUEST. The caller
   * names one document; which page rides with it is ours to decide, and a
   * client-supplied second id would be a second thing to check ownership of.
   *
   * ⚠️ AND ITS FAILURE COSTS ONE PAGE, NEVER BOTH. The member asked for the
   * document in front of them: a full store, a purged partner or a dead
   * connection is a reason to log and hand back what did attach, not to
   * refuse the pick they made.
   */
  private async attachWithOtherSide(
    ctx: AttachContext,
    source: 'credential' | 'upload',
    sourceId: string,
    placeConfirmed = false,
    opts: {
      /**
       * Vault rows this application must never be offered again — auto-link's
       * record of what the member has already removed. Empty for the picker.
       */
      refuse?: ReadonlySet<string>;
      /**
       * The only vault rows a partner may be taken from, where the caller has
       * already gated its own candidates.
       *
       * ⚠️ THIS IS THE SETTLED-DATE GATE, RESTORED. autolink()'s candidate
       * query admits a credential only on `confirmedAt` OR `dateSource` — "a
       * date somebody stands behind" — and the comment above that query says
       * why: the freshness rule needs one, and "answering it anyway is how a
       * stale document gets attached silently". The ride-along looked its
       * partner up from the whole vault and walked straight past it. Handing
       * the gated set down restores the `present.has(p.other)` test the local
       * pair rule used to make, without writing the predicate down twice.
       *
       * ⚠️ THE PICKER PASSES NOTHING, DELIBERATELY, and it is the same
       * distinction `refuse` already draws: there the member is doing the
       * asking, has the document in front of them, and the freshness note is
       * printed beside it.
       *
       * ⚠️ AND THE GATE COSTS SOMETHING THE OPERATOR SHOULD KNOW ABOUT.
       * PROFICIENCY is not in ARMABLE_KINDS (credential-auto-date.ts), so a
       * proficiency row carries `dateSource: null` until somebody confirms it,
       * and confirmExpiry stamps ONE row rather than both sides. So inside an
       * auto-link run the second page rides along only where both pages have
       * been confirmed. The picker — where the fold actually lives, and where
       * the member can see what they picked — is unaffected.
       */
      only?: ReadonlySet<string>;
    } = {},
  ) {
    /**
     * The vault row this pick is anchored to: the pick itself when it is a
     * credential, and the row a copy was taken from when it is an upload.
     *
     * ⚠️ RESOLVED BEFORE ANYTHING IS WRITTEN, which is the whole difference
     * between a document arriving whole and arriving half. See the ceiling.
     *
     * ⚠️ AND THE UPLOAD BRANCH IS NOT DEAD CODE. buildLibrary now lists a
     * paired document from the vault, so the picker should not send an upload
     * that has a partner — but this route is directly callable, a stale client
     * holds yesterday's list, and `suggested` is built from the same array. A
     * filter the client applies is a convenience; this is the check.
     */
    const anchor =
      source === 'credential'
        ? sourceId
        : await this.vaultPageBehind(ctx.userId, sourceId);
    const other = anchor
      ? await this.otherSideOf(ctx.userId, anchor, opts)
      : null;

    const alsoAttached: { id: string; kind: MotivationUploadKind; label: string }[] =
      [];
    /**
     * The page that did NOT come across, in words a member could read.
     *
     * ⚠️ RETURNED BECAUSE THE TRUTH HAS TO EXIST SOMEWHERE. A silently
     * half-attached document is the failure this method exists to prevent, so
     * when the second page fails anyway the caller is told rather than left to
     * infer it from a count. Auto-link folds `alsoAttached` into the banner
     * the member reads; the picker does not render this field yet — one line
     * of copy, in a component this file does not own.
     */
    let alsoFailed: { reason: 'unavailable' | 'error'; message: string } | null =
      null;

    if (!anchor || !other) {
      const single = await this.attachOne(ctx, source, sourceId, placeConfirmed);
      return { ...single, alsoAttached, alsoFailed };
    }

    // ⚠️ ROOM FOR THE WHOLE DOCUMENT, DECIDED BEFORE EITHER PAGE IS WRITTEN.
    // attachOne checks the ceiling per page, which is right for one document
    // and silent for two: at 15 of 16 the member picks a two-page proficiency,
    // gets the certificate, gets no error — and with the picker hiding a
    // folded entry it believes is already here, no way to add the page that
    // was refused. All or nothing, and the message names the limit either way.
    if (!(await this.roomForPair(ctx, anchor, other))) {
      throw new ConflictException(
        `An application can carry ${MAX_UPLOADS} documents, and that one is two pages. Remove one before adding it.`,
      );
    }

    const first = await this.attachOne(ctx, source, sourceId, placeConfirmed);
    /** The lead's reading, and the follower's where it answered anything else. */
    let suggestions: { key: string; value: string; label: string }[] = [
      ...first.suggestions,
    ];

    try {
      const partner = await this.attachOne(
        ctx,
        'credential',
        other,
        placeConfirmed,
      );
      alsoAttached.push({
        id: partner.id,
        kind: partner.kind,
        label: partner.label,
      });
      // ⚠️ AND WHAT THE SECOND PAGE SAID IS NOT THROWN AWAY. Only `first`
      // spreads into the response, so the partner's reading used to be dropped
      // on the floor — harmless while the follower is the provider's
      // certificate and the lead carries the unit standards, and wrong the
      // moment leadsPair picks the other way round (two pages recorded as the
      // same side fall through to the date and the id). The lead still wins
      // every key it answered: the member picked THAT page.
      const known = new Set(suggestions.map((sg) => sg.key));
      const extra: { key: string; value: string; label: string }[] = [
        ...partner.suggestions,
      ];
      suggestions = [
        ...suggestions,
        ...extra.filter((sg) => !known.has(sg.key)),
      ];
    } catch (err) {
      // ⚠️ ITS FAILURE COSTS ONE PAGE, NEVER BOTH. The member asked for the
      // document in front of them: a purged partner or a dead connection is a
      // reason to hand back what did attach, not to refuse the pick they made.
      alsoFailed = {
        reason: err instanceof GoneException ? 'unavailable' : 'error',
        message:
          'We could not attach the second page of that document — add it from your Document Centre.',
      };
      this.logger.warn(
        `Motivation ${ctx.row.id}: could not attach the other page of ${sourceId}: ${(err as Error).message}`,
      );
    }
    return { ...first, suggestions, alsoAttached, alsoFailed };
  }

  /**
   * The vault row a motivation upload was copied from, where we can tell.
   *
   * By id where the copy recorded one; otherwise by CONTENT, because an upload
   * ADOPTED into the vault carries no sourceCredentialId — the copy went the
   * other way — and both rows hash the same plaintext bytes. The same join
   * buildLibrary makes in memory, made here against the database because this
   * route is reachable without ever having read the list.
   *
   * Narrowed to a row that HAS a partner: this is only ever asked to find a
   * second page, and it keeps the query off every ordinary one-page pick.
   */
  private async vaultPageBehind(
    userId: string,
    uploadId: string,
  ): Promise<string | null> {
    const up = await this.prisma.motivationUpload.findFirst({
      where: { id: uploadId, motivation: { userId } },
      select: { sourceCredentialId: true, sha256: true },
    });
    if (!up) return null;
    if (up.sourceCredentialId) return up.sourceCredentialId;
    const byBytes = await this.prisma.credential.findFirst({
      where: { userId, sha256: up.sha256, otherSideId: { not: null } },
      select: { id: true },
    });
    return byBytes?.id ?? null;
  }

  /**
   * Is there room on this pack for both pages of one document?
   *
   * ⚠️ A PAGE ALREADY ON THE PACK COSTS NO SLOT. attachOne hands back the row
   * that already exists rather than writing a second one, so the question is
   * how many of the two are NEW — which is what keeps re-adding a deleted page
   * possible at fifteen of sixteen, the exact repair the fold made necessary.
   */
  private async roomForPair(
    ctx: AttachContext,
    firstCredentialId: string,
    otherCredentialId: string,
  ): Promise<boolean> {
    const motivationId = ctx.row.id;
    const [pages, count] = await Promise.all([
      this.prisma.credential.findMany({
        // Ownership is a WHERE clause here as it is everywhere else in this
        // module: `firstCredentialId` can be a client-supplied id.
        where: {
          userId: ctx.userId,
          id: { in: [firstCredentialId, otherCredentialId] },
        },
        select: { sha256: true },
      }),
      this.prisma.motivationUpload.count({ where: { motivationId } }),
    ]);
    const shas = pages.map((x) => x.sha256).filter((x): x is string => !!x);
    // No hashes to compare — a vault row that predates the column, or a
    // partner we could not read. Ask for two slots, which is the safe way to
    // be wrong: it refuses at the ceiling rather than half-attaching.
    if (!shas.length) return count + 2 <= MAX_UPLOADS;
    const here = await this.prisma.motivationUpload.findMany({
      where: { motivationId, sha256: { in: shas } },
      select: { sha256: true },
    });
    const have = new Set(here.map((h) => h.sha256));
    const needed = shas.filter((x) => !have.has(x)).length;
    return count + needed <= MAX_UPLOADS;
  }

  /**
   * The other page of a vault document, where it is still attachable.
   *
   * Ownership is a WHERE clause in BOTH halves: `otherSideId` is a plain id
   * copied off a row, so the partner is looked up as this member's own
   * document or not at all. Purged bytes mean there is nothing to copy, which
   * is a reason to attach one page rather than to fail the pick.
   */
  private async otherSideOf(
    userId: string,
    credentialId: string,
    opts: { refuse?: ReadonlySet<string>; only?: ReadonlySet<string> } = {},
  ): Promise<string | null> {
    const mine = await this.prisma.credential.findFirst({
      where: { id: credentialId, userId },
      select: { otherSideId: true },
    });
    if (!mine?.otherSideId) return null;
    // ⚠️ BOTH REFUSALS ARE ASKED BEFORE THE QUERY, AND BEFORE ANY BYTES MOVE.
    // `refuse` is what this application has already been given and the member
    // removed — "why can't I delete the proof of address?", one page along.
    // `only` is the caller's own gate on which rows are candidates at all,
    // which for auto-link is the settled-date rule. Neither is a display
    // filter: this is the boundary.
    if (opts.refuse?.has(mine.otherSideId)) return null;
    if (opts.only && !opts.only.has(mine.otherSideId)) return null;
    const other = await this.prisma.credential.findFirst({
      where: {
        id: mine.otherSideId,
        userId,
        storageKey: { not: null },
        purgedAt: null,
      },
      select: { id: true },
    });
    return other?.id ?? null;
  }

  /**
   * The application, opened once for a run of attachments.
   *
   * ⚠️ HOISTED SO A BATCH DOES NOT RE-ASK. M17. The auto-link loop called
   * addFromLibrary per document, and every call re-resolved the provider subject,
   * re-read the motivation and re-counted its uploads — three round trips per
   * document to learn three things that cannot change inside one run.
   */
  private async openForAttach(userId: string, id: string) {
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId },
      // licenceType and answersEncrypted are for the vision read below: the
      // extractor needs the licence type to know what it is looking at, and
      // the current answers to decide WHICH owned-firearm row a licence fills.
      select: {
        id: true,
        status: true,
        licenceType: true,
        answersEncrypted: true,
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');
    if (!EDITABLE.includes(row.status)) {
      throw new ConflictException('This application can no longer be changed.');
    }
    return row;
  }

  /**
   * Copy ONE library document onto an already-opened application.
   *
   * ⚠️ THE CEILING IS CHECKED HERE, NOT BY THE CALLER, and it is deliberately
   * one cheap count per document rather than one per run. Attachments inside a
   * batch run concurrently, so a run that counted once could overshoot
   * MAX_UPLOADS by as many documents as it has in flight.
   */
  private async attachOne(
    ctx: AttachContext,
    source: 'credential' | 'upload',
    sourceId: string,
    placeConfirmed = false,
  ) {
    const user = { id: ctx.userId };
    const row = ctx.row;

    const count = await this.prisma.motivationUpload.count({
      where: { motivationId: row.id },
    });
    if (count >= MAX_UPLOADS) {
      throw new ConflictException(
        `An application can carry ${MAX_UPLOADS} documents. Remove one before adding another.`,
      );
    }

    // ⚠️ OWNERSHIP IS A WHERE CLAUSE, in both branches. A sourceId is a
    // client-supplied id: the only thing stopping it naming another member's
    // document is that the query cannot find one.
    let kind: MotivationUploadKind;
    /** Extra checklist rows this one attachment answers. See coversKinds. */
    let alsoSatisfies: MotivationUploadKind[] = [];
    /**
     * The Document Centre row this copy is being taken from, where there is
     * one.
     *
     * ⚠️ M5. addFromLibrary has always known this and always thrown it away
     * at the create, so nothing downstream could answer "is the document behind
     * this page still in my Centre" — nor, for auto-link, "have we offered this
     * exact row before". Null for a copy of another application's upload: there
     * is no vault row behind that.
     */
    let sourceCredentialId: string | null = null;
    let storageKey: string | null;
    let mimeType: string | null;
    let purgedAt: Date | null;
    let extraction: { ok: boolean; fields: string[]; blob: string | null } = {
      ok: false,
      fields: [],
      blob: null,
    };

    if (source === 'credential') {
      const c = await this.prisma.credential.findFirst({
        where: { id: sourceId, userId: user.id },
        select: {
          kind: true,
          storageKey: true,
          mimeType: true,
          purgedAt: true,
          detailsEncrypted: true,
          extractionOk: true,
        },
      });
      if (!c) throw new NotFoundException('Document not found');
      sourceCredentialId = sourceId;
      const mapped = uploadKindsFor(c.kind);
      if (!mapped.length) {
        throw new BadRequestException(
          'That document does not answer anything on this application.',
        );
      }
      // ⚠️ FILED AS THE FIRST, COUNTING FOR ALL OF THEM. A membership
      // certificate is both the association card and the letter of good
      // standing; a second row for the same bytes would collide with the
      // sha256 unique index and print the same page twice in the pack.
      kind = mapped[0];
      alsoSatisfies = mapped.slice(1);
      storageKey = c.storageKey;
      mimeType = c.mimeType;
      purgedAt = c.purgedAt;

      // ⚠️ READABILITY FIRST, AND IT IS NOT THE SAME QUESTION AS AUTOFILL.
      //
      // `suspect` — the amber "we could not read anything off it" — asks ONE
      // thing: did anybody ever successfully read this document? The vault
      // already answered that, in c.extractionOk. Carry it across verbatim.
      //
      // This line is the fix for a bug that survived two attempts because the
      // two questions were conflated. The `kept` filter below answers a
      // DIFFERENT question — which of the vault's values fit THIS form's boxes
      // — and it is an exact key-name match between two registries that name
      // the same things differently. The vault reads a licence as
      // {licence_number, make, calibre, frame_serial}; the motivation registry
      // wants {existing_firearm_1_licence_no, _make, _calibre, _frame_serial}.
      // The intersection is EMPTY, for that kind and for every dedicated-status
      // and proficiency kind too. Deriving `ok` from that intersection meant a
      // document the vault had read perfectly was reported as unreadable
      // whenever its field names happened not to collide — which was nine of
      // the ten kinds that reach here.
      //
      // Nothing is lost by not aliasing. Those values DO reach the member, via
      // credentialOffer (GET :id/credential-offer), which has the alias table,
      // the owned-firearm slot logic and the association-slot precedence, and
      // offers them for confirmation rather than writing them. Duplicating any
      // of that here would be a second copy of the hardest logic in the module
      // to serve a badge.
      extraction = { ok: c.extractionOk, fields: [], blob: null };

      // ⚠️ AND THE AUTOFILL ON TOP, where the names do line up.
      //
      // Nothing needs re-reading: the vault already ran vision over this
      // exact file and kept what it found. Copying it also means picking a
      // competency certificate from the list fills the number, the same as
      // photographing one.
      if (c.detailsEncrypted) {
        try {
          const details =
            decryptJson<Record<string, string>>(c.detailsEncrypted) ?? {};
          // ⚠️ ONLY KEYS THIS UPLOAD KIND ACTUALLY ANSWERS. A vault reading
          // carries things the motivation registry has no field for — a
          // holder name, what a competency covers — and offering those as
          // suggestions would propose values for boxes that do not exist.
          // ⚠️ THE `covers` LINE NOW CROSSES OVER, AND IT IS SAFE BECAUSE
          // IT IS NO LONGER A COPY. This note used to read "NO ALIASING,
          // DELIBERATELY", on the grounds that the vault's `covers` is free
          // text off a photograph ("handgun and rifle", "H, R") while
          // `competency_for` is a MULTI constrained to the registry's
          // endorsement labels — so carrying one into the other would put an
          // unmatchable value into a constrained box on a form somebody signs.
          // True of a raw copy, and it is why the exact-name filter below still
          // stands for every other key.
          //
          // credentialOffer no longer copies it. parseEndorsements reads SAPS's
          // own wording and returns typed Endorsement values or NOTHING, and
          // those are rendered back through the registry's own labels — so the
          // box can only receive a value it already offers, and an unreadable
          // line yields '' and is dropped. See endorsementLabels in
          // motivation-credentials.ts, which is the single place that
          // translation happens.
          //
          // Nothing here changes: this filter is still exact-name-only, the
          // competency NUMBER is still the one key that crosses on it, and the
          // endorsements reach the member through credentialOffer, which owns
          // the alias table and offers rather than writes.
          const wanted = new Set(MotivationExtractService.wantedFor(kind));
          // ⚠️ AND "NONE" IS NOT A VALUE. A licence card prints NONE in a row
          // that does not apply to that firearm — the operator's own Glock
          // card reads "Model NONE" — and the old `&& v` guard tested only for
          // emptiness, so the word travelled from the vault into a suggestion
          // and on into a SAPS 271 the applicant signs. The card keeps its
          // wording; the ANSWER does not get one. See card-placeholder.ts.
          const kept = Object.fromEntries(
            Object.entries(details)
              .filter(([k]) => wanted.has(k))
              .map(([k, v]) => [k, answerValue(v)] as const)
              .filter(([, v]) => v !== ''),
          );
          if (Object.keys(kept).length > 0) {
            // ok is already true whenever the vault read it; restating it here
            // covers the row that carries values without extractionOk set.
            extraction = {
              ok: true,
              fields: Object.keys(kept),
              blob: encryptJson(kept),
            };
          }
        } catch {
          // An unreadable blob costs the autofill, not the attachment.
        }
      }
    } else {
      // ⚠️ THE SAME NARROWING, ON THE ROUTE THAT CAN BE CALLED DIRECTLY. A
      // list the frontend never renders is not a boundary.
      const offerAcross = await this.vaultConsent.mayOfferAcross(user.id);
      const u = await this.prisma.motivationUpload.findFirst({
        where: {
          id: sourceId,
          motivation: offerAcross ? { userId: user.id } : { id: row.id },
        },
        select: {
          kind: true,
          // Which application it was filed with — the whole question the
          // NEVER_REUSABLE check below is asking.
          motivationId: true,
          storageKey: true,
          mimeType: true,
          purgedAt: true,
          extractionOk: true,
          extractedFields: true,
          extractionEncrypted: true,
        },
      });
      if (!u) throw new NotFoundException('Document not found');
      // ⚠️ THE BOUNDARY IS HERE, NOT IN THE PICKER. buildLibrary already keeps
      // these out of the list, but this route is directly callable — and the
      // document it is protecting against is one that names a DIFFERENT
      // firearm by serial. A filter the client applies is a convenience; this
      // is the check.
      if (u.motivationId !== row.id && NEVER_REUSABLE.has(u.kind)) {
        throw new BadRequestException(
          'That document belongs to the application it was filed with and cannot be reused here.',
        );
      }
      kind = u.kind;
      storageKey = u.storageKey;
      mimeType = u.mimeType;
      purgedAt = u.purgedAt;
      extraction = {
        ok: u.extractionOk,
        fields: u.extractedFields,
        blob: u.extractionEncrypted,
      };
    }

    if (asksPlace(kind) && !placeConfirmed) {
      throw new BadRequestException(
        'Please confirm this is the safe at the address on this application.',
      );
    }

    if (!storageKey || purgedAt) {
      throw new GoneException(
        'That document is no longer stored, so it cannot be reused.',
      );
    }

    let bytes: Buffer;
    try {
      bytes = await this.files.read(storageKey);
    } catch (err) {
      this.logger.error(
        `Motivation ${row.id}: could not read library source ${sourceId}: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'We could not open that document just now. Please try again.',
      );
    }

    let stored: { storageKey: string; sha256: string; byteSize: number };
    try {
      stored = await this.files.write('motivations', bytes, new Date());
    } catch (err) {
      this.logger.error(
        `Motivation ${row.id}: could not store library copy: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'We could not store that document just now. Please try again.',
      );
    }

    // Already on this pack? The unique index says so — and the honest answer
    // is the row they already have, not an error about a mistake they did not
    // make.
    const existing = await this.prisma.motivationUpload.findFirst({
      where: { motivationId: row.id, sha256: stored.sha256 },
      select: { id: true, kind: true, byteSize: true, createdAt: true },
    });
    if (existing) {
      await this.files.remove(stored.storageKey).catch(() => undefined);
      return {
        id: existing.id,
        kind: existing.kind,
        label: documentLabel(existing.kind),
        byteSize: existing.byteSize,
        available: true,
        annexure: null,
        suggestions: [],
        alreadyHad: true,
      };
    }

    // ── READ THE DOCUMENT ITSELF, RATHER THAN TRANSLATING WHAT THE VAULT
    //    THOUGHT IT SAID ────────────────────────────────────────────────
    //
    // Operator, 2026-08-23: "Just use claude vision to extract the information
    // when preparing the motivation to insert the information into the
    // document."
    //
    // ⚠️ THIS REPLACES A KEY-MAPPING PROBLEM THAT HAD ALREADY PRODUCED FOUR
    // BUGS. The vault and the motivation registry name the same values
    // differently — a licence is read into the vault as
    // {licence_number, make, calibre, frame_serial} and the form wants
    // {existing_firearm_1_licence_no, _make, _calibre, _frame_serial} — so
    // carrying a reading across meant either an exact-name intersection that
    // was empty for nine of ten kinds, or a third copy of an alias table.
    //
    // Reading the bytes we have just copied sidesteps all of it: this
    // extractor emits registry keys BY CONSTRUCTION, and it owns the
    // owned-firearm slot logic (a licence describes one firearm and somebody
    // may attach four), which no alias table could have reproduced without
    // duplicating it.
    //
    // ⚠️ IT COSTS A VISION CALL PER PICK, which is what the vault copy was
    // avoiding. That trade is deliberate: the call is the same one
    // photographing the document would have cost, and the thing it buys is
    // the values actually landing in the boxes instead of a badge being the
    // right colour.
    //
    // ⚠️ ONLY WHERE THE VAULT HAS NOT ALREADY ANSWERED. A competency
    // certificate's number crosses over on an exact name match, for free —
    // paying to re-read it would spend money to learn what is already in
    // hand. So this runs when `extraction.fields` is empty, which is exactly
    // the set of kinds the intersection was failing.
    //
    // FAIL-SOFT, like every other read in this module: the bytes are stored
    // and the row is about to exist, so a timeout or a model outage costs the
    // autofill, not the attachment. The vault's readability verdict survives
    // underneath, so the row does not go amber just because the call failed.
    if (
      extraction.fields.length === 0 &&
      MotivationExtractService.canExtract(kind)
    ) {
      try {
        const fresh = await this.extract.extract({
          kind,
          licenceType: row.licenceType,
          bytes,
          mimeType: mimeType ?? 'image/jpeg',
          answers: this.shared.readAnswers(row.answersEncrypted),
        });
        if (fresh.length > 0) {
          extraction = {
            ok: true,
            fields: fresh.map((f) => f.key),
            blob: encryptJson(
              Object.fromEntries(fresh.map((f) => [f.key, f.value])),
            ),
          };
        }
      } catch (err) {
        this.logger.warn(
          `Motivation ${row.id}: could not read library copy ${sourceId}: ${(err as Error).message}`,
        );
      }
    }

    // ⚠️ THE BYTES MUST NOT OUTLIVE A FAILED ROW. M17. addUpload has had this
    // compensating delete since it was written and this path never did — so a
    // create that lost the @@unique race, or hit a dead connection, left an
    // encrypted file on disk with nothing pointing at it. Undeletable except by
    // hand, invisible to the retention sweep (which walks rows), and counted
    // against the member's storage forever.
    let created: { id: string; kind: MotivationUploadKind; byteSize: number };
    try {
      created = await this.prisma.motivationUpload.create({
        data: {
          motivationId: row.id,
          kind,
          coversKinds: alsoSatisfies,
          storageKey: stored.storageKey,
          mimeType: mimeType ?? 'image/jpeg',
          byteSize: stored.byteSize,
          sha256: stored.sha256,
          extractionOk: extraction.ok,
          extractedFields: extraction.fields,
          extractionEncrypted: extraction.blob,
          // Which Centre document this page is a copy of. See the declaration.
          sourceCredentialId,
        },
        select: { id: true, kind: true, byteSize: true },
      });
    } catch (err) {
      await this.files.remove(stored.storageKey).catch(() => undefined);
      // A concurrent attach of the same file won the race — the row they got is
      // the honest answer, not an error about a mistake nobody made. Same
      // reading as the pre-flight duplicate check above.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const dup = await this.prisma.motivationUpload.findFirst({
          where: { motivationId: row.id, sha256: stored.sha256 },
          select: { id: true, kind: true, byteSize: true },
        });
        if (dup) {
          return {
            id: dup.id,
            kind: dup.kind,
            label: documentLabel(dup.kind),
            byteSize: dup.byteSize,
            available: true,
            annexure: null,
            suggestions: [],
            alreadyHad: true,
          };
        }
      }
      this.logger.error(
        `Motivation ${row.id}: could not record library copy: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'We could not attach that document just now. Please try again.',
      );
    }

    // The values the source had already been read for, so picking a document
    // from the library fills the same boxes photographing it would have.
    let suggestions: { key: string; value: string; label: string }[] = [];
    if (extraction.ok && extraction.blob) {
      try {
        const read = decryptJson<Record<string, string>>(extraction.blob);
        // ⚠️ AND THIS IS AN ANSWER BOUNDARY, WITH NO TEST ON IT AT ALL — not
        // for a placeholder, not even for emptiness. What comes back here is
        // handed to the wizard, which writes it straight in
        // (`setAnswer(sg.key, sg.value, { onlyIfEmpty: true })`), so a licence
        // read as "Frame Serial No NONE" — the card being complete, not a
        // serial — became a box on a SAPS 271 the applicant signs. Seen live
        // on 2026-09-07: "Firearm 6 — frame serial NONE · barrel serial NONE".
        //
        // ⚠️ THE GUARD HAS TO BE HERE, NOT ONLY WHERE THE BLOB WAS WRITTEN.
        // For an upload source this is `extractionEncrypted` as it was stored,
        // possibly long before card-placeholder.ts existed, and CURRENT_LICENCE
        // is not in NEVER_REUSABLE — so those readings cross applications. The
        // same reasoning readingFor() already carries, on the same blobs.
        // Absent stays absent. See card-placeholder.ts.
        suggestions = Object.entries(read ?? {})
          .map(([key, value]) => ({
            key,
            value: typeof value === 'string' ? answerValue(value) : '',
            label: key,
          }))
          .filter((sg) => sg.value !== '');
      } catch {
        // A blob we cannot read costs a convenience, not the attachment.
      }
    }

    return {
      id: created.id,
      kind: created.kind,
      label: documentLabel(created.kind),
      byteSize: created.byteSize,
      available: true,
      annexure: null,
      suggestions,
      alreadyHad: false,
      // ⚠️ THE SAME VERDICT THE LIST WILL GIVE, SENT NOW. Without it the
      // checklist has no `suspect` to read, renders the row green, and then
      // flips it amber a second later when the next refresh arrives — which
      // is exactly what the operator saw with a proof of address that was
      // perfectly good. A row that changes its mind in front of somebody is
      // worse than one that was amber from the start.
      suspect:
        MotivationExtractService.canExtract(created.kind) && !extraction.ok,
    };
  }

  /**
   * Read an attached document again.
   *
   * ⚠️ ONE SHOT WAS NOT ENOUGH. extract() is fail-soft by design — a timeout,
   * a 529, any error at all returns [] and the upload survives, which is the
   * right trade. But nothing ever tried again, so a transient failure marked a
   * good document "we could not read anything on this" permanently, and the
   * copy blamed the photograph. Seen live: an address document that reads
   * perfectly on a second attempt, stored with extractionOk false.
   *
   * The bytes are already ours and the read is cheap. Offering it costs a
   * button; not offering it costs the applicant a document they cannot fix.
   */
  /**
   * WHAT WE ALREADY READ OFF AN ATTACHED DOCUMENT, without reading it again.
   *
   * ⚠️ THE PHONE HAND-OFF NEEDED THIS AND NOTHING SUPPLIED IT. A document
   * scanned on the phone is read once, on upload, and the reading goes back
   * to the phone — the desktop that started the hand-off only ever saw the
   * file arrive. `rereadUpload` returns field KEYS and spends a vision call
   * to do it; the uploads list returns keys too. So the desktop rebuilt the
   * reading from the vault, which is right only while the member keeps
   * documents there. This returns the stored reading itself, in the same
   * shape `addFromLibrary` proposes it, so both routes go through the same
   * review before anything is written into a form the member signs.
   */
  async readingFor(userId: string, id: string, uploadId: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(userId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    const up = await this.prisma.motivationUpload.findFirst({
      where: { id: uploadId, motivationId: row.id },
      select: { id: true, extractionOk: true, extractionEncrypted: true },
    });
    if (!up) throw new NotFoundException('Document not found');

    let suggestions: { key: string; value: string; label: string }[] = [];
    if (up.extractionOk && up.extractionEncrypted) {
      try {
        const read = decryptJson<Record<string, string>>(
          up.extractionEncrypted,
        );
        // ⚠️ THE EMPTINESS TEST WAS NOT ENOUGH. A stored reading can hold the
        // word the card prints for "nothing here" — NONE, N/A, a dash — and
        // this list is offered straight into the member's answers. Cards read
        // before card-placeholder.ts existed still carry those values, so the
        // guard has to be here at the offer, not only where they are written.
        suggestions = Object.entries(read ?? {})
          .map(([key, value]) => ({
            key,
            value: typeof value === 'string' ? answerValue(value) : '',
            label: key,
          }))
          .filter((s) => s.value !== '');
      } catch {
        // A blob we cannot read costs the convenience, never the document.
      }
    }
    return { id: up.id, suggestions };
  }

  async rereadUpload(userId: string, id: string, uploadId: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(userId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: { id: true, licenceType: true, answersEncrypted: true },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    const up = await this.prisma.motivationUpload.findFirst({
      where: { id: uploadId, motivationId: row.id },
      select: {
        id: true,
        kind: true,
        storageKey: true,
        mimeType: true,
        purgedAt: true,
      },
    });
    if (!up) throw new NotFoundException('Document not found');
    if (!up.storageKey || up.purgedAt) {
      throw new GoneException('That document is no longer stored.');
    }
    if (!MotivationExtractService.canExtract(up.kind)) {
      // A photograph of a safe yields nothing by design; re-reading it would
      // spend a call to confirm that.
      return { ok: false, fields: [] as string[], readable: false };
    }

    const bytes = await this.files.read(up.storageKey);
    const found = await this.extract.extract({
      kind: up.kind,
      licenceType: row.licenceType,
      bytes,
      mimeType: up.mimeType ?? 'image/jpeg',
      answers: this.shared.readAnswers(row.answersEncrypted),
    });

    // ⚠️ NEVER WORSE THAN BEFORE. A second failure must not wipe a reading
    // that succeeded earlier, so an empty result leaves the row untouched.
    if (!found.length) {
      return { ok: false, fields: [], readable: true };
    }

    const values = Object.fromEntries(found.map((f) => [f.key, f.value]));
    await this.prisma.motivationUpload.update({
      where: { id: up.id },
      data: {
        extractionOk: true,
        extractedFields: found.map((f) => f.key),
        extractionEncrypted: encryptJson(values),
      },
    });
    return { ok: true, fields: found.map((f) => f.key), readable: true };
  }

  // ────────────────────────────────────────────────────────────────
  // UPLOADS — the annexures, and the only writer to the encrypted store
  // ────────────────────────────────────────────────────────────────

  /**
   * Accept one supporting document.
   *
   * The bytes go to SecureFileStorageService, never to Cloudinary. Every other
   * upload in this codebase lands on a PUBLIC Cloudinary secure_url, which is
   * fine for a photograph of a tent and unthinkable for someone's identity
   * document — the operator's own instruction was to keep these on our own
   * server, encrypted.
   *
   * ORDER MATTERS: bytes first, row second, and if the row fails the bytes are
   * removed again. The other order would leave a row pointing at a file that
   * does not exist; this order's failure leaves nothing behind at all.
   */
  async addUpload(
    userId: string,
    id: string,
    /**
     * NULL MEANS "SORT IT FOR ME".
     *
     * A member uploading a whole pack at once cannot pick a type per file
     * before the files exist, so the batch path sends no kind and the document
     * is named from its contents. A kind they DID choose is never overruled.
     */
    kind: MotivationUploadKind | null,
    file: { buffer: Buffer; mimetype: string },
    /**
     * Skip the vision read.
     *
     * Set by the Licence Centre's renewal one-tap, which is copying a document
     * it has ALREADY read and whose values it has already seeded. Reading it a
     * second time would spend a model call to learn what we just wrote.
     */
    opts: { skipExtraction?: boolean } = {},
  ) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(userId);

    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: { id: true, status: true, licenceType: true, answersEncrypted: true },
    });
    if (!row) throw new NotFoundException('Motivation not found');
    if (!EDITABLE.includes(row.status)) {
      throw new ConflictException(
        'This application can no longer be edited, so documents cannot be added.',
      );
    }

    if (!file?.buffer?.length) {
      throw new BadRequestException('That file appears to be empty.');
    }
    if (file.buffer.length > MAX_UPLOAD_BYTES) {
      throw new BadRequestException('That file is larger than 10 MB.');
    }

    const count = await this.prisma.motivationUpload.count({
      where: { motivationId: row.id },
    });
    if (count >= MAX_UPLOADS) {
      throw new ConflictException(
        `An application can carry ${MAX_UPLOADS} documents. Remove one before adding another.`,
      );
    }

    // READ THE PAGE ONCE. Operator, 2026-08-29: "is it possible to OCR all
    // documents and keep the raw files".
    //
    // ⚠️ THE SAME IMAGE WAS GOING TO GOOGLE TWICE ON EVERY AUTO-FILED UPLOAD.
    // classify() read the bytes to look for a marker and extract() read them
    // again for the model, each billing separately for the identical string,
    // and both discarded it when the request ended. One read now, handed to
    // both, and stored on the row — so re-running the marker library over a
    // document uploaded last month costs nothing, and a member can be shown
    // what we actually read rather than only what we concluded.
    //
    // Null for a PDF and whenever Vision is unavailable, which includes every
    // local run: the key is IP-restricted to the live box BY DESIGN. Both
    // consumers already treat null as "nothing to add", so this degrades to
    // exactly the previous behaviour rather than to a broken upload.
    const ocrText = await this.extract
      .ocr(file.buffer, file.mimetype)
      .catch(() => null);

    // NAME IT, if they did not. Before the row, because the kind is a column
    // on it — and fail-soft: an unsortable document becomes OTHER, which reads
    // as unsorted rather than as a satisfied requirement.
    let resolved: MotivationUploadKind = kind ?? 'OTHER';
    let autoFiled = false;
    let confident = false;
    if (!kind) {
      const guess = await this.extract
        .classify({ bytes: file.buffer, mimeType: file.mimetype, ocrText })
        .catch(() => null);
      autoFiled = true;
      if (guess) {
        resolved = guess.kind;
        confident = guess.confident;
      }
    }

    // Written before the row so a duplicate is detected by the DATABASE rather
    // than by reading first and writing after — that read-then-write is a race,
    // and two uploads of one file arriving together would both survive it.
    let stored: { storageKey: string; sha256: string; byteSize: number };
    try {
      stored = await this.files.write('motivations', file.buffer, new Date());
    } catch (err) {
      // SecureFileStorageService throws PLAIN Errors — an unconfigured
      // ID_HASH_SECRET among them. Unwrapped, those become a 500 with a stack
      // trace instead of something an applicant can act on.
      this.logger.error(
        `Motivation ${row.id}: could not store upload: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'We could not store that document just now. Please try again.',
      );
    }

    try {
      const created = await this.prisma.motivationUpload.create({
        data: {
          motivationId: row.id,
          kind: resolved,
          storageKey: stored.storageKey,
          mimeType: file.mimetype,
          byteSize: stored.byteSize,
          sha256: stored.sha256,
          // ⚠️ ENCRYPTED. This is the whole page — an ID number, an address,
          // every serial on it — and more sensitive than the fields we asked
          // for. ocrChars is the only part safe in the clear, and it is what
          // separates "read, and the page was blank" from "not read".
          ocrTextEncrypted: ocrText ? encryptJson({ text: ocrText }) : null,
          ocrChars: ocrText === null ? null : ocrText.length,
        },
        select: { id: true, kind: true, byteSize: true, createdAt: true },
      });

      // READ IT, if there is anything on it worth reading.
      //
      // FAIL-SOFT: the bytes are already stored and the row already exists, so
      // an unreadable photograph or a model outage costs the applicant a
      // convenience, not their upload. extractionOk stays false and they type
      // the values themselves — which is what they would have done anyway.
      //
      // The suggestions are NOT written into their answers here. They are
      // returned for confirmation: a misread digit in an ID number would
      // otherwise become a false statement on a form they sign.
      let suggestions: ExtractedField[] = [];
      if (!opts.skipExtraction && MotivationExtractService.canExtract(resolved)) {
        try {
          suggestions = await this.extract.extract({
            kind: resolved,
            licenceType: row.licenceType,
            bytes: file.buffer,
            mimeType: file.mimetype,
            // Decides which "firearms you already own" row a licence fills.
            // Without it every licence lands on row 1 and the second upload
            // overwrites the first.
            answers: this.shared.readAnswers(row.answersEncrypted),
            // Already read above — this is what saves the second call.
            ocrText,
          });
        } catch (err) {
          this.logger.warn(
            `Motivation ${row.id}: extraction failed for upload ${created.id}: ${(err as Error).message}`,
          );
        }
      }

      // ── the firearm, off whatever this document is ──────────────────
      //
      // Operator, 2026-08-28: "Can we write the ai to accepts any kind of
      // document and process the information on it? As we need the firearm
      // details and not the details of the owner for this part."
      //
      // ⚠️ A SECOND READ, NOT A REPLACEMENT. extract() above answers "what does
      // a document of this KIND carry" and is right for an ID or a proof of
      // address. This answers "what firearm is this about", which no
      // classifier needs to have recognised the genre to do — and the genre is
      // exactly what an applicant holding "atleast something" cannot promise.
      //
      // ⚠️ ONLY ON KINDS THAT COULD DESCRIBE A FIREARM. A second vision call on
      // a safe photograph or a municipal bill would spend money to find
      // nothing, and give a model the chance to invent a firearm from a stray
      // number on the page.
      //
      // ⚠️ AND IT NEVER OVERWRITES THE KIND EXTRACTOR. Those suggestions came
      // from a document we had identified; these came from one we had not. On
      // a key both produced, the identified read wins.
      // ⚠️ WHAT GETS PERSISTED, NOT JUST WHAT GETS OFFERED RIGHT NOW. Starts
      // as a copy of `suggestions` and gains every readable firearm field
      // below, visible or not — see the note inside the loop for why. The
      // immediate response still only offers what the applicant can see;
      // `readable` is what survives to the row, so nothing read is thrown
      // away for having arrived before an unrelated question was answered.
      // Named apart from the file-storage `stored` above — same word, a
      // different thing, already taken in this scope.
      const readable: ExtractedField[] = [...suggestions];

      if (
        !opts.skipExtraction &&
        MotivationExtractService.readsFirearm(resolved)
      ) {
        try {
          const firearm = await this.extract.readFirearm({
            bytes: file.buffer,
            mimeType: file.mimetype,
          });
          const already = new Set(suggestions.map((f) => f.key));
          // ⚠️ VISIBLE GATES THE OFFER, NOT THE STORE. Six of the firearm
          // fields (the barrel / frame / receiver rows and their makes) are
          // formOnly, so they exist as a QUESTION only once somebody has
          // opted into having the SAPS 271 filled. Offering a value for a box
          // that is not on screen produces a "we read 7 things" panel listing
          // fields the applicant cannot find, which reads as the feature
          // being broken — so the offer below stays gated on `visible`.
          //
          // ⚠️ BUT THE COMMON ORDER IS UPLOAD THE FIREARM'S OWN LICENCE
          // FIRST — before the applicant has even reached the SAPS 271
          // question — and this used to DROP the invisible fields instead of
          // just not offering them yet. Nothing re-reads a document once it
          // is attached, so a serial read off the very first thing an
          // applicant uploads was gone for good by the time they answered
          // the question that would have shown it. Operator, 2026-09-07:
          // "why can't it just cache the information until I make a
          // selection". `readable` below is that cache — everything readable
          // is kept regardless of visibility, and GET
          // :id/uploads/:uploadId/reading (readingFor) already serves the
          // full stored reading back on demand once a field becomes visible.
          //
          // isVisible also covers the conditional fields generally, so this
          // stays correct if any firearm field later hangs off a showIf.
          const answersNow = this.shared.readAnswers(row.answersEncrypted);
          const visible = new Set(
            fieldsFor(row.licenceType)
              .filter((f) => isVisible(f, answersNow))
              .map((f) => f.key),
          );
          for (const [key, raw] of Object.entries(firearm)) {
            if (already.has(key)) continue;
            // ⚠️ AND NEVER THE CARD'S OWN "NOTHING HERE". This loop had no
            // guard at all, so a licence reading "Frame Serial No NONE" — the
            // card being complete, not a serial — became a proposed answer.
            // Seen live on 2026-09-07: "Firearm 6 — frame serial NONE ·
            // barrel serial NONE". Absent stays absent.
            const value = answerValue(raw);
            if (!value) continue;
            const field = {
              key,
              value,
              // Read without knowing what the document is, so it is offered
              // for confirmation like everything else here rather than
              // trusted outright.
              trusted: false,
              note: 'Read off the document you uploaded — check it against the paperwork.',
            } as (typeof suggestions)[number];
            readable.push(field);
            if (visible.has(key)) suggestions.push(field);
          }
        } catch (err) {
          // Same rule as above: a failed read costs the convenience, never
          // the upload.
          this.logger.warn(
            `Motivation ${row.id}: firearm read failed for upload ${created.id}: ${(err as Error).message}`,
          );
        }
      }

      // PERSIST WHAT WAS ACTUALLY READ — AFTER BOTH PASSES, AND EVERYTHING
      // READABLE, NOT JUST WHAT IS ON SCREEN RIGHT NOW.
      //
      // ⚠️ MOVED HERE 2026-09-07. This used to write immediately after the
      // kind-based extract() above, before the firearm second pass even ran —
      // so a document where extract() failed or found nothing (every
      // SELLER_LICENCE, which extract() does not read at all, and any
      // FIREARM_SOURCE_PROOF whose extract() call came back unparseable) was
      // permanently stored as extractionOk: false, extractedFields: [],
      // whatever readFirearm() went on to find. Seen live: a licence card
      // read 8 firearm fields through readFirearm() and correctly offered
      // several of them on screen, while the stored row still said the
      // document could not be read. The checklist reads its amber straight
      // off extractionOk, so a member whose serial genuinely got read was
      // shown a requirement the system claims is unmet.
      //
      // ⚠️ AND `readable`, NOT `suggestions` — same date, same operator.
      // Storing only what was OFFERED meant a field hidden behind the SAPS
      // 271 opt-in was gone the moment this request ended, however
      // visibility changed afterwards: nothing re-reads a document once it
      // is attached. `readable` carries every readable field regardless of
      // visibility; `suggestions` (used for the response returned to THIS
      // request) stays visibility-gated so the confirmation panel never
      // lists a box the applicant cannot find. readingFor() serves the full
      // stored row back once a field becomes visible, from GET
      // :id/uploads/:uploadId/reading.
      //
      // Same attempt-gate as before — write only where at least one pass was
      // actually attempted, so a kind neither reads (a safe photograph, a
      // proof of address) gets no write at all, same as it always has.
      if (
        !opts.skipExtraction &&
        (MotivationExtractService.canExtract(resolved) ||
          MotivationExtractService.readsFirearm(resolved))
      ) {
        try {
          await this.prisma.motivationUpload.update({
            where: { id: created.id },
            data: {
              extractionOk: readable.length > 0,
              // KEYS only in the clear — the registry is not PII, the values
              // are. The values themselves are encrypted.
              extractedFields: readable.map((f) => f.key),
              extractionEncrypted: readable.length
                ? encryptJson(
                    Object.fromEntries(readable.map((f) => [f.key, f.value])),
                  )
                : null,
            },
          });
        } catch (err) {
          this.logger.warn(
            `Motivation ${row.id}: could not persist extraction result for upload ${created.id}: ${(err as Error).message}`,
          );
        }
      }

      // KEEP A COPY, WHERE THEY HAVE AGREED TO IT.
      //
      // "When a person does their first application, WE need to store all the
      // attachments they save" — operator, 2026-08-22. A motivation upload
      // dies with its application on a two-year clock; this is what lets the
      // reusable half outlive it.
      //
      // ⚠️ AFTER THE ROW, OUTSIDE ITS TRY, AND SWALLOWED. An application must
      // never fail because the Centre was full, or the disk hiccuped, or a
      // consent lookup timed out. The upload is the thing the member came to
      // do; the copy is a convenience on top of it.
      //
      // ⚠️ THE AUTOMATIC COPY IS GONE, ON PURPOSE. Every upload used to be
      // swept into the Document Centre the moment it landed, behind a single
      // blanket consent and with no UI at all — a member could not see what had
      // been kept, could not decline one page of six, and the swallowed
      // `void ... .catch()` meant a refusal left no trace either.
      //
      // Operator, 2026-09-08: "yes, stop auto copy. we need to ask consent to
      // add items to the license centre." The member ticks what they want kept
      // on the shelf and POSTs :id/keep-in-centre; VaultAdoptionService
      // .keepChosen is the only route in now, and it reports `needsConsent`
      // rather than failing quietly.

      // The wizard shows what each document was filed as, and `autoFiled` is
      // what tells it which rows to put a correction control on.
      return { ...created, suggestions, autoFiled, confident };
    } catch (err) {
      // Whatever went wrong, the bytes must not outlive the attempt: a file
      // with no row pointing at it is undeletable except by hand.
      await this.files.remove(stored.storageKey).catch(() => undefined);

      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // ⚠️ THE CONSTRAINT IS ON (motivationId, sha256) — THE BYTES, NOT THE
        // KIND — which is exactly why several photographs can sit under one
        // kind. What it refuses is the same picture twice, and that is worth
        // saying plainly on the safe row: three copies of one photograph
        // cannot fill a row that wants three, and without this the wizard
        // reads as broken — it goes on showing the row short right after
        // accepting nothing.
        //
        // ⚠️ ONLY ON THE SAFE ROW. The second sentence went out on every
        // duplicate, so somebody re-sending their ID copy was answered with a
        // rule about photographing a safe — advice about a document they were
        // not uploading, which reads as us having lost track of what they did.
        throw new ConflictException(
          resolved === 'SAFE_PHOTOGRAPHS'
            ? 'That exact file is already attached to this application. Each of the safe photographs has to be a different picture.'
            : 'That exact file is already attached to this application.',
        );
      }
      throw err;
    }
  }

  /**
   * Write suggestions the applicant has CONFIRMED.
   *
   * Separate from the upload on purpose. Extraction proposes; the applicant
   * decides. Anything they have already answered themselves is left alone —
   * the same rule profile prefill follows, and for the same reason: a form that
   * quietly contradicts what someone typed is the worst outcome here.
   */
  async applyExtraction(
    userId: string,
    id: string,
    accepted: Record<string, unknown>,
  ) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(userId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        licenceType: true,
        status: true,
        answersEncrypted: true,
        answerProvenance: true,
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');
    if (!EDITABLE.includes(row.status)) {
      throw new ConflictException('This application can no longer be edited.');
    }

    const answers = this.shared.readAnswers(row.answersEncrypted);
    const fresh: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(accepted ?? {})) {
      if ((answers[k] ?? '').trim()) continue; // never overwrite
      fresh[k] = v;
    }

    const { answers: clean } = sanitiseAnswers(row.licenceType, fresh);
    const merged = { ...answers, ...clean };

    // READ: these values came off a document uploaded to THIS application.
    //
    // ⚠️ NO sourceId YET, AND THAT IS A KNOWN GAP RATHER THAN AN OVERSIGHT.
    // The route (`POST :id/uploads/apply`) reuses SaveAnswersDto and carries no
    // uploadId — not in the DTO, not in the frontend caller. Wiring one is a
    // DTO plus frontend change, which belongs with the screen that renders the
    // chip. Until then the entry is honest about the source and silent about
    // which document, which beats inventing an id.
    let provenance = parseProvenance(row.answerProvenance);
    for (const key of Object.keys(clean)) {
      provenance = stamp(provenance, [key], {
        source: 'READ',
        from: 'a document you uploaded',
      });
    }

    // ── and the competency, now that a document has named the firearm ──
    //
    // ⚠️ THE SAME HOOK saveAnswers CARRIES, ON THE DOOR IT WAS MISSING FROM.
    // Operator, 2026-09-07: "the wrong competency chosen before it even knows
    // which firearm is being applied for." A firearm reaches an application
    // three ways — the member types it, a seller consent writes it, or a
    // document is read and confirmed here — and only the first re-derived the
    // certificate. So a member whose firearm arrived on a dealer-prefilled
    // SAPS 271 or an association endorsement kept whatever competency was
    // chosen on no information, all the way to the eligibility check, which
    // then told them their certificate did not cover their own firearm.
    //
    // Both keys, because requiredEndorsement reads both: the action is what
    // separates a self-loading rifle from a manually operated one.
    //
    // ⚠️ AND IT MAY CLEAR A BOX. competencyOffer returns empty strings for a
    // certificate the new firearm rules out, and it decides for itself what it
    // is allowed to replace off the provenance map — MEMBER is theirs for
    // ever. A wrong certificate number left on a form somebody signs is worse
    // than an empty box they are asked to fill.
    if (
      this.prefill &&
      ('firearm_type' in clean || 'firearm_action' in clean)
    ) {
      const competency = await this.prefill.competencyOffer(
        row.licenceType,
        user.id,
        merged,
        provenance,
      );
      if (competency) {
        provenance = { ...provenance };
        for (const [key, value] of Object.entries(competency.values)) {
          // ⚠️ BELT AND BRACES, AND WORTH THE TWO LINES: `stamp()` protects a
          // MEMBER *provenance entry* and nothing else — it has never guarded
          // the answer. competencyOffer already refuses a MEMBER key, so this
          // can only ever be a no-op; it is here because the day somebody
          // widens that filter, the damage lands on a signed declaration.
          if (provenance[key]?.source === 'MEMBER') continue;
          merged[key] = value;
          // ⚠️ AND A BOX WE EMPTIED LOSES ITS CHIP. The map has no "unstamp" —
          // deliberately, because the one thing it must never do is forget a
          // MEMBER mark — so a removal is done here, by hand, and only for
          // keys competencyOffer already established were OURS. Left behind,
          // the entry would put "From your Document Centre — <the certificate
          // we just ruled out>" against a blank field. The same handling
          // saveAnswers does, because it is the same offer.
          const entry = competency.provenance[key];
          if (entry) provenance[key] = entry;
          else delete provenance[key];
        }
      }
    }

    await this.prisma.motivation.update({
      where: { id: row.id },
      data: {
        answersEncrypted: encryptJson(merged),
        answersSchemaVersion: FIELD_REGISTRY_VERSION,
        answerProvenance: provenance as unknown as object,
        /**
         * ⚠️ THE SAME RE-ARM THE COMPETENCY OFFER ABOVE ALREADY GETS, ON THE
         * DOCUMENTS RATHER THAN ON THE ANSWERS. Confirming a read that names
         * the firearm re-derives which certificate is right — and then left
         * the autolink stamp shut, so the certificate it had just identified
         * could never be attached. One rule, three doors.
         */
        ...(endorsementMoved(answers, merged) ? { autolinkedAt: null } : {}),
      },
    });

    return {
      filled: Object.keys(clean).length,
      missingRequired: missingRequired(row.licenceType, merged),
    };
  }

  /** The annexure list. Metadata only — never the bytes. */
  async listUploads(userId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(userId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        licenceType: true,
        answersEncrypted: true,
        uploads: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            kind: true,
            coversKinds: true,
            mimeType: true,
            byteSize: true,
            createdAt: true,
            purgedAt: true,
            storageKey: true,
            extractionOk: true,
            extractedFields: true,
            // ⚠️ THE DATE A DFO CHECKS FIRST, AND THE ROW NEVER CARRIED IT.
            // The expiry has always existed — on the vault row this page was
            // copied from, and in the reading vision took off it — and was
            // never put where the member could see it, so a complete-looking
            // checklist could be a letter of good standing that lapsed in March.
            // See expiresOnFor below for which of the two wins.
            extractionEncrypted: true,
            sourceCredential: { select: { expiresOn: true } },
            sourceRemovedAt: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    const proficiency = await this.shared.proficiencyFor(user.id);

    // One clock for the whole list, so two rows dated the same day can never
    // disagree about which side of ninety days they are on.
    const now = new Date();

    const annexures = buildAnnexures(row.uploads.map((u) => u.kind));
    const letterFor = new Map(annexures.map((a) => [a.kind, a.letter]));

    const files = row.uploads.map((u) => ({
      id: u.id,
      kind: u.kind,
      label: UPLOAD_KIND_LABELS[u.kind],
      annexure: letterFor.get(u.kind) ?? null,
      mimeType: u.mimeType,
      byteSize: u.byteSize,
      createdAt: u.createdAt,
      // The row can outlive its bytes after a retention purge. Say so, rather
      // than let a download fail with a puzzling error.
      available: u.storageKey !== null && u.purgedAt === null,
      extractionOk: u.extractionOk,
      extractedFields: u.extractedFields,
      /**
       * Filed as something it does not look like.
       *
       * ⚠️ INFERRED FROM THE EXTRACTION WE ALREADY RAN, not from a second
       * vision call. When somebody names the document type, we skip
       * classification and go straight to reading the fields that type
       * carries — so a competency certificate filed as proof of address comes
       * back having yielded none of the things an address document carries.
       * That silence is the signal, and it costs nothing.
       *
       * ⚠️ ONLY FOR KINDS WE CAN ACTUALLY READ. A photograph of a safe
       * extracts nothing by design; flagging it would be crying wolf at every
       * pack.
       */
      suspect:
        MotivationExtractService.canExtract(u.kind) && !u.extractionOk,
      ...this.shared.expiryFor(u, now),
    }));

    // What the APPLICATION still needs, weighed against what is attached.
    // Named specifically rather than "some documents are missing", because the
    // alternative to naming them is a wasted trip to a police station.
    const answers = this.shared.readAnswers(row.answersEncrypted);

    return {
      files,
      documents: documentStatus(
        row.licenceType,
        // ⚠️ kind AND coversKinds. One membership certificate is both the
        // association card and the letter of good standing; counting only
        // `kind` would leave the second row asking for a paper already in the
        // pack. buildAnnexures deliberately still sees `kind` ALONE — the
        // document gets one annexure letter, because it is one page.
        row.uploads.flatMap((u) => [u.kind, ...u.coversKinds]),
        // Their answers decide one of the requirements: a licence is needed
        // for every firearm they have told us they already own.
        answers,
      ),
      // ⚠️ SERVED, NOT DERIVED ON THE CLIENT. The same object feeds the
      // checklist banner and the competency step, because two surfaces
      // computing this separately is how they come to disagree about whether
      // somebody's paperwork is complete.
      proficiency,
      // The choices in the wizard's "document type" menu, ordered so the next
      // thing to photograph is the next thing in the list. Served rather than
      // hard-coded in the frontend: the two lists had already drifted apart,
      // the client's omitting two kinds and describing the safe in the
      // singular while this side described three.
      kinds: pickableKinds(
        row.licenceType,
        answers,
        // Same union as the checklist: a row already answered by a covering
        // document must not still be offered as the next thing to photograph.
        row.uploads.flatMap((u) => [u.kind, ...u.coversKinds]),
      ),
    };
  }

  /**
   * Read one document back.
   *
   * The buffer is decrypted BEFORE the caller sets any header: a tampered file
   * fails its authentication tag here, and headers-then-throw would emit a 200
   * that dies halfway through the body.
   */
  async readUpload(userId: string, id: string, uploadId: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(userId);

    // Ownership is a WHERE CLAUSE, so "not yours" and "does not exist" are the
    // same answer and neither confirms the other exists.
    const up = await this.prisma.motivationUpload.findFirst({
      where: { id: uploadId, motivation: { id, userId: user.id } },
      select: {
        id: true,
        kind: true,
        mimeType: true,
        storageKey: true,
        purgedAt: true,
      },
    });
    if (!up) throw new NotFoundException('Document not found');
    if (!up.storageKey || up.purgedAt) {
      throw new GoneException(
        'That document has been deleted under our retention policy.',
      );
    }

    let bytes: Buffer;
    try {
      bytes = await this.files.read(up.storageKey);
    } catch (err) {
      this.logger.error(
        `Motivation ${id}: could not read upload ${up.id}: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException('We could not open that document.');
    }

    const ext = up.mimeType === 'application/pdf' ? 'pdf' : 'jpg';
    return {
      bytes,
      mimeType: up.mimeType,
      filename: `${up.kind.toLowerCase()}-${up.id.slice(-6)}.${ext}`,
    };
  }

  /** Remove a document, bytes first. */
  async removeUpload(userId: string, id: string, uploadId: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(userId);

    const up = await this.prisma.motivationUpload.findFirst({
      where: { id: uploadId, motivation: { id, userId: user.id } },
      select: {
        id: true,
        storageKey: true,
        // The bytes' fingerprint, so any cached reading of them goes too.
        sha256: true,
        // Which vault row this copy came from, so the refusal below can outlive
        // the row we are about to delete.
        sourceCredentialId: true,
        motivation: { select: { status: true } },
      },
    });
    if (!up) throw new NotFoundException('Document not found');
    if (!EDITABLE.includes(up.motivation.status)) {
      throw new ConflictException('This application can no longer be edited.');
    }

    if (up.storageKey) {
      try {
        await this.files.remove(up.storageKey);
      } catch (err) {
        // Deleting the row anyway would orphan the bytes forever, so this one
        // does NOT continue past the failure.
        this.logger.error(
          `Motivation ${id}: could not remove ${up.storageKey}: ${(err as Error).message}`,
        );
        throw new ServiceUnavailableException(
          'We could not delete that document just now. Please try again.',
        );
      }
    }

    await this.prisma.motivationUpload.delete({ where: { id: up.id } });

    /**
     * ⚠️ AND ANYTHING WE READ OFF IT, or the delete is a lie. A cached
     * reading holds the name, the ID number and the serials transcribed from
     * this document; leaving it behind for the rest of its thirty days would
     * mean a member who removed a licence card had not removed it.
     *
     * Content-addressed, so this drops every reading of these exact bytes
     * whatever kind they were read as. Fail-soft: the row is already gone and
     * the member has their answer, so a cache that will not purge is a log
     * line and the nightly sweep's problem, never a failed delete.
     */
    if (up.sha256) void this.readCache.forget(up.sha256);

    // ⚠️ THE ROW IS GONE, SO THE REFUSAL HAS TO LIVE SOMEWHERE ELSE. C2. Until
    // auto-link could re-arm, "a delete stays deleted" was guaranteed by the
    // run happening exactly once; now that adding or confirming a Credential
    // clears `autolinkedAt`, a later run would see the kind as unattached and
    // put the member's own deletion straight back — which is the operator's
    // "why can't I delete the proof of address?", re-opened.
    //
    // Written AFTER the delete, and additively, so nothing here can cost the
    // member the removal they asked for. A duplicate entry is harmless; the
    // reader is a Set.
    if (up.sourceCredentialId) {
      await this.prisma.motivation
        .update({
          where: { id },
          data: { autolinkSkippedIds: { push: up.sourceCredentialId } },
        })
        .catch((err) =>
          this.logger.warn(
            `Motivation ${id}: could not record auto-link refusal: ${(err as Error).message}`,
          ),
        );
    }

    return { removed: true };
  }

  /**
   * REFILE A DOCUMENT UNDER A DIFFERENT TYPE.
   *
   * Needed the moment anything files documents automatically, and needed
   * anyway: the type is what the required-documents checklist counts, so a
   * mislabelled upload silently satisfies a requirement the pack does not meet.
   * Before this there was no way to correct one short of deleting the file and
   * uploading it again.
   */
  async changeUploadKind(
    userId: string,
    id: string,
    uploadId: string,
    kind: MotivationUploadKind,
  ) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(userId);

    // Ownership through the parent, in the WHERE clause — never a post-fetch
    // check.
    const claim = await this.prisma.motivationUpload.updateMany({
      where: { id: uploadId, motivation: { id, userId: user.id } },
      data: { kind },
    });
    if (claim.count === 0) throw new NotFoundException('Document not found');
    return { kind };
  }
}
