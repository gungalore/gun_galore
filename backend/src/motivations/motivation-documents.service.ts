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
import { SecureFileStorageService } from '../common/secure-file-storage.service';
import { encryptJson, decryptJson } from '../common/blob-crypto';
import { parseProvenance, stamp } from '../common/answer-provenance';
import { MotivationQuotaService } from './motivation-quota.service';
import { requiredEndorsement } from './motivation-eligibility';
import { decideAutolink } from './motivation-autolink';
import {
  primaryUploadKind,
  asksPlace,
  uploadKindsFor,
  S16_AUTO_ATTACH,
  validLongEnough,
  toIsoDay,
} from './motivation-credentials';
import { buildLibrary, NEVER_REUSABLE } from './motivation-library';
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
  async library(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(clerkId);
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
        },
      }),
    ]);

    const now = new Date();
    const items = buildLibrary(
      credentials.map((c) => ({
        ...c,
        issuedOn: c.issuedOn ? toIsoDay(c.issuedOn) : null,
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
  async autolink(clerkId: string, id: string, placeConfirmed = false) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(clerkId);
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
    if (row.autolinkedAt) {
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
          // The competency's own "covers" wording, for the endorsement test.
          detailsEncrypted: true,
          extractionOk: true,
        },
      }),
      this.prisma.motivationUpload.findMany({
        where: { motivationId: row.id },
        select: { kind: true, sha256: true, sourceCredentialId: true },
      }),
    ]);

    const wanted = documentStatus(row.licenceType, [], {}).needs.map(
      (n) => n.kind,
    );

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

    // What firearm is this application for? Null when they have not said, and
    // null switches the endorsement test off rather than failing it.
    const needed = requiredEndorsement(
      this.shared.readAnswers(row.answersEncrypted),
    );

    const candidates = credentials
      .filter((c) => !refuse.has(c.id))
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

    const decision = decideAutolink(
      candidates,
      wanted,
      uploads.map((u) => u.kind),
      new Date(),
      { needed, placeConfirmed, attachedProficiencyCovers },
    );

    // ⚠️ THE APPLICATION IS OPENED ONCE FOR THE WHOLE RUN. M17. This used to
    // call addFromLibrary per document, and every one of those calls resolved
    // the Clerk subject again and re-read the motivation again — two round
    // trips per document to learn two things that cannot change inside a run.
    const openRow = await this.openForAttach(user.id, row.id);

    // ⚠️ THREE AT A TIME, AND THE CEILING IS THE POINT. Each attachment is a
    // decrypt, a re-encrypt, a disk write and — for a kind the vault could not
    // already answer — a Claude vision call of a second or more. Serially that
    // is a request nginx cuts off at 60s. Unbounded, a member with a full Centre
    // fires eight concurrent model calls and meets the API's own rate limit,
    // which fails the whole run instead of one document.
    const attached: { kind: string; title: string }[] = [];
    const queue = [...decision.attach];
    const worker = async () => {
      for (;;) {
        const c = queue.shift();
        if (!c) return;
        try {
          await this.attachOne(
            { userId: user.id, row: openRow },
            c.source,
            c.sourceId,
            // A safe photograph only ever reaches here on an explicit yes —
            // decideAutolink refuses it otherwise — and attachOne's own
            // asksPlace check is the boundary, so the answer travels with it.
            placeConfirmed,
          );
          attached.push({ kind: c.kind, title: c.title });
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

    return {
      attached,
      // Said out loud, so "why is my competency not on here" has an answer
      // the member can read rather than a silence they have to guess at.
      skipped: decision.skipped.map((s) => ({
        kind: s.candidate.kind,
        title: s.candidate.title,
        why: s.why,
      })),
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
    clerkId: string,
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
    const user = await this.shared.requireUser(clerkId);
    const row = await this.openForAttach(user.id, id);
    return this.attachOne({ userId: user.id, row }, source, sourceId, placeConfirmed);
  }

  /**
   * The application, opened once for a run of attachments.
   *
   * ⚠️ HOISTED SO A BATCH DOES NOT RE-ASK. M17. The auto-link loop called
   * addFromLibrary per document, and every call re-resolved the Clerk subject,
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
    ctx: {
      userId: string;
      row: {
        id: string;
        status: MotivationStatus;
        licenceType: MotivationLicenceType;
        answersEncrypted: string | null;
      };
    },
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
          const kept = Object.fromEntries(
            Object.entries(details).filter(([k, v]) => wanted.has(k) && v),
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
        suggestions = Object.entries(read ?? {}).map(([key, value]) => ({
          key,
          value,
          label: key,
        }));
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
  async readingFor(clerkId: string, id: string, uploadId: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(clerkId);
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
        suggestions = Object.entries(read ?? {})
          .filter(([, value]) => typeof value === 'string' && value.trim())
          .map(([key, value]) => ({ key, value, label: key }));
      } catch {
        // A blob we cannot read costs the convenience, never the document.
      }
    }
    return { id: up.id, suggestions };
  }

  async rereadUpload(clerkId: string, id: string, uploadId: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(clerkId);
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
    clerkId: string,
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
    const user = await this.shared.requireUser(clerkId);

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
          await this.prisma.motivationUpload.update({
            where: { id: created.id },
            data: {
              extractionOk: suggestions.length > 0,
              // KEYS only in the clear — the registry is not PII, the values
              // are. The values themselves are encrypted.
              extractedFields: suggestions.map((f) => f.key),
              extractionEncrypted: suggestions.length
                ? encryptJson(
                    Object.fromEntries(suggestions.map((f) => [f.key, f.value])),
                  )
                : null,
            },
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
          // ⚠️ ONLY FIELDS THE APPLICANT CAN ACTUALLY SEE. Six of the firearm
          // fields (the barrel / frame / receiver rows and their makes) are
          // formOnly, so they exist only once somebody has opted into having
          // the SAPS 271 filled. Offering a value for a box that is not on
          // screen produces a "we read 7 things" panel listing fields the
          // applicant cannot find, which reads as the feature being broken.
          //
          // isVisible also covers the conditional fields generally, so this
          // stays correct if any firearm field later hangs off a showIf.
          const answersNow = this.shared.readAnswers(row.answersEncrypted);
          const visible = new Set(
            fieldsFor(row.licenceType)
              .filter((f) => isVisible(f, answersNow))
              .map((f) => f.key),
          );
          for (const [key, value] of Object.entries(firearm)) {
            if (already.has(key) || !visible.has(key)) continue;
            suggestions.push({
              key,
              value,
              // Read without knowing what the document is, so it is offered
              // for confirmation like everything else here rather than
              // trusted outright.
              trusted: false,
              note: 'Read off the document you uploaded — check it against the paperwork.',
            } as (typeof suggestions)[number]);
          }
        } catch (err) {
          // Same rule as above: a failed read costs the convenience, never
          // the upload.
          this.logger.warn(
            `Motivation ${row.id}: firearm read failed for upload ${created.id}: ${(err as Error).message}`,
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
      // adoptUpload itself decides whether there is consent and whether this
      // kind is worth keeping — nothing here needs to know.
      void this.vaultAdoption
        .adoptUpload(user.id, created.id)
        .catch((err: unknown) =>
          this.logger.warn(
            `Motivation ${row.id}: could not copy upload ${created.id} to the Document Centre: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );

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
    clerkId: string,
    id: string,
    accepted: Record<string, unknown>,
  ) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(clerkId);
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

    await this.prisma.motivation.update({
      where: { id: row.id },
      data: {
        answersEncrypted: encryptJson(merged),
        answersSchemaVersion: FIELD_REGISTRY_VERSION,
        answerProvenance: provenance as unknown as object,
      },
    });

    return {
      filled: Object.keys(clean).length,
      missingRequired: missingRequired(row.licenceType, merged),
    };
  }

  /** The annexure list. Metadata only — never the bytes. */
  async listUploads(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(clerkId);
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
  async readUpload(clerkId: string, id: string, uploadId: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(clerkId);

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
  async removeUpload(clerkId: string, id: string, uploadId: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(clerkId);

    const up = await this.prisma.motivationUpload.findFirst({
      where: { id: uploadId, motivation: { id, userId: user.id } },
      select: {
        id: true,
        storageKey: true,
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
    clerkId: string,
    id: string,
    uploadId: string,
    kind: MotivationUploadKind,
  ) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(clerkId);

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
