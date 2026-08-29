import { Injectable, Logger } from '@nestjs/common';
import { CredentialKind, MotivationUploadKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SecureFileStorageService } from '../common/secure-file-storage.service';
import { FLAGS, SettingsService } from '../settings/settings.service';
import { VaultConsentService } from '../users/vault-consent.service';
import { documentLabel } from './motivation-documents';

// ────────────────────────────────────────────────────────────────────
// KEEPING THE PAPERWORK FROM AN APPLICATION.
//
// Operator, 2026-08-22: "When a person does their first application, WE need to
// store all the attachments they save. So if a new application is started we
// can prompt them if we may use previously loaded documents."
//
// A document attached to a motivation dies with it: motivation uploads are
// purged on a two-year retention clock, and there is no way to add or remove
// one except from inside the application it belongs to. So the most reusable
// documents a person owns — their ID copy, proof of address, the photographs
// of their safe — were the ones they could not manage, while a competency
// certificate sat safely in a vault with no clock at all. This copies the
// reusable ones across.
//
// ⚠️ ONLY ON A YES. mayKeepFor() fails CLOSED: no row, no answer, an answer to
// older wording — all mean no. Keeping is NEW processing and needs a consent we
// can point at, which is the whole reason the window exists.
//
// ⚠️ IT COPIES BYTES; IT NEVER SHARES A KEY. Motivation uploads are purged on
// the writer's clock and vault documents are not, so a shared storageKey would
// mean the writer's retention silently blanking a document out of somebody's
// Centre. Three write sites existed before this; this is the fourth, and every
// one of them mints a fresh key. A fifth is a review failure.
//
// ⚠️ IT LIVES IN MotivationsModule, NOT IN THE CENTRE'S. LicenceCentreModule
// imports MotivationsModule for the renewal one-tap and a spec asserts that
// edge stays one-way — so a service the motivations side calls cannot live on
// the other end of it. It talks to Prisma and the file store directly and must
// NOT call LicenceCentreService: every method there begins with
// quota.assertEnabled(), and a flag-gated copy would silently copy nothing
// while reporting success.
// ────────────────────────────────────────────────────────────────────

/**
 * What is worth keeping past the application it arrived on.
 *
 * ⚠️ THE INVERSE OF NEVER_REUSABLE IS NOT THE ANSWER. A document can be safe to
 * offer on another application and still not belong in a permanent library —
 * an executor's letter of appointment is reusable within one estate and means
 * nothing after it, and an incident report belongs to the incident. This list
 * is only the paperwork that describes the PERSON and stays true.
 *
 * Each of these has a CredentialKind of the same name, so the mapping is an
 * identity and there is no translation table to get wrong.
 */
export const VAULTABLE: ReadonlySet<MotivationUploadKind> = new Set([
  MotivationUploadKind.IDENTITY_DOCUMENT,
  MotivationUploadKind.ADDRESS_CONFIRMATION,
  MotivationUploadKind.EMPLOYMENT_CONFIRMATION,
  MotivationUploadKind.SAFE_PHOTOGRAPHS,
  // ⚠️ THE RETIRED FOUR STAY. The migration moved every row onto
  // SAFE_PHOTOGRAPHS, but the backfill walks documents attached long before
  // that and a row written during the deploy window would otherwise be the one
  // photograph of a safe the Centre never learns about — silently, with nothing
  // to explain it.
  MotivationUploadKind.SAFE_PHOTO_CLOSED,
  MotivationUploadKind.SAFE_PHOTO_AJAR,
  MotivationUploadKind.SAFE_PHOTO_BOLTS,
  MotivationUploadKind.SAFE_INSTALLATION,
  MotivationUploadKind.SHOOTING_ACTIVITY_LOG,
  // ⚠️ ADDED 2026-08-24. Operator, item 2 of twelve: "Letter of good standing
  // not in Document Centre so can't pull anything from there or save it once
  // it's been uploaded in the Motivation Centre." The save half was this set:
  // a good standing letter photographed on an application had NO route into
  // the vault at all — adoptUpload returned false before doing anything, and
  // because the caller is a swallowed `void ... .catch()`, it did so without
  // even a log line. The same was true of the competency certificate and the
  // two association documents: all four could be PULLED from the Centre and
  // none of them could be SAVED to it.
  MotivationUploadKind.GOOD_STANDING_LETTER,
  MotivationUploadKind.COMPETENCY_CERTIFICATE,
  MotivationUploadKind.ASSOCIATION_CARD,
  // ⚠️ ADDED 2026-08-29, AND THE SAME PULL-BUT-NEVER-SAVE BUG AS THE FOUR
  // ABOVE. Operator: "we need to keep the documents for future use if the
  // applicant has other motivations they would need to do."
  //
  // CREDENTIAL_TO_UPLOAD has mapped PROFICIENCY and FIREARM_LICENCE into a
  // motivation since the module was written, so both could always be PULLED
  // out of the Centre — and neither could ever be SAVED to it. A statement of
  // results photographed on an application lived on that application's
  // two-year retention clock and then vanished.
  //
  // A statement of results is the WORST document to lose. It never expires,
  // and every future application needs it again: the operator holds 117705 on
  // a 2014 handgun statement and must file that same page alongside a rifle
  // statement to apply for a rifle. Losing it means going back to a training
  // provider for a reprint of a course passed a decade ago.
  MotivationUploadKind.PROFICIENCY_CERTIFICATE,
  // ⚠️ CURRENT_LICENCE IS DELIBERATELY NOT HERE, AND IT WAS TRIED. A firearm
  // licence is pullable from the Centre and looks like the same omission, but
  // the spec below already ruled on it: it is tied to one firearm, and the
  // Licence Centre is the route by which a member's own licences reach the
  // vault — adopting them from an application as well would file a second row
  // for a licence the Centre already holds. Left to the operator to decide,
  // not overruled here.
]);

/**
 * The CredentialKind an adopted upload is filed as.
 *
 * Almost always the same name — that is the point of the identity naming, and
 * see CREDENTIAL_TO_UPLOAD in motivation-credentials.ts for the other
 * direction.
 *
 * ⚠️ EXCEPT FOR THE RETIRED SAFE KINDS, AND WITHOUT THIS THEY WERE ADOPTED
 * INTO A HOLE. VAULTABLE keeps admitting them on purpose (see the note above
 * it) so a photograph attached before 2026-08-23 still reaches the Centre —
 * and then `kind: u.kind as CredentialKind` filed it in the Centre under a
 * value the backfill migration had already emptied, which is outside the safe
 * row, outside the vault picker's safe slot, and outside anything that would
 * ever tell its owner. Admitting a row and then losing it is worse than not
 * admitting it.
 *
 * ⚠️ THE ANSWER IS A MAP, NOT A CAST, so the compiler names this line the next
 * time a kind is retired. Deliberately narrow: only kinds VAULTABLE admits can
 * arrive here.
 */
const VAULT_KIND: Partial<Record<MotivationUploadKind, CredentialKind>> = {
  [MotivationUploadKind.SAFE_PHOTO_CLOSED]: CredentialKind.SAFE_PHOTOGRAPHS,
  [MotivationUploadKind.SAFE_PHOTO_AJAR]: CredentialKind.SAFE_PHOTOGRAPHS,
  [MotivationUploadKind.SAFE_PHOTO_BOLTS]: CredentialKind.SAFE_PHOTOGRAPHS,
  [MotivationUploadKind.SAFE_INSTALLATION]: CredentialKind.SAFE_PHOTOGRAPHS,
  // ⚠️ REQUIRED IN THE SAME BREATH AS THE VAULTABLE ENTRIES ABOVE, OR THE
  // ADOPTION FAILS SILENTLY FOREVER. There is no GOOD_STANDING_LETTER or
  // ASSOCIATION_CARD member of CredentialKind — the four association kinds
  // were folded into DEDICATED_DISCIPLINE on 2026-08-20 — so vaultKindFor's
  // `kind as unknown as CredentialKind` fallback would hand Prisma a value
  // its enum does not contain, the create would reject, and the swallowed
  // caller would never say so. Exactly the "adopted into a hole" failure the
  // note above this map describes.
  [MotivationUploadKind.GOOD_STANDING_LETTER]: CredentialKind.DEDICATED_DISCIPLINE,
  [MotivationUploadKind.ASSOCIATION_CARD]: CredentialKind.DEDICATED_DISCIPLINE,
  // ⚠️ REQUIRED IN THE SAME BREATH AS THE TWO VAULTABLE ENTRIES ABOVE.
  // CredentialKind has no PROFICIENCY_CERTIFICATE and no CURRENT_LICENCE — it
  // calls them PROFICIENCY and FIREARM_LICENCE — so without these two lines
  // vaultKindFor's cast fallback hands Prisma a value its enum does not
  // contain, the create rejects, and the swallowed caller never says so.
  // Adopted into a hole, exactly as the note above this map warns.
  [MotivationUploadKind.PROFICIENCY_CERTIFICATE]: CredentialKind.PROFICIENCY,
};

/**
 * WHICH association document this actually is, preserved on the credential.
 *
 * ⚠️ WITHOUT THIS, FILING IS LOSSY IN A WAY A DFO SEES. A sworn good standing
 * letter and a dedicated status card both file as DEDICATED_DISCIPLINE, so on
 * the way back out the Centre cannot tell them apart — and the pack would
 * caption a member's sworn letter "Your dedicated status certificate", which
 * is the wrong document name on evidence in front of the Registrar.
 *
 * The schema already anticipated this: Credential.disciplineType is documented
 * as where the distinction "now lives, where it can be read rather than
 * inferred from which pile the document landed in". Nothing had ever written
 * it. This does.
 */
const DISCIPLINE_TYPE: Partial<Record<MotivationUploadKind, string>> = {
  [MotivationUploadKind.GOOD_STANDING_LETTER]: 'GOOD_STANDING_LETTER',
  [MotivationUploadKind.ASSOCIATION_CARD]: 'ASSOCIATION_CARD',
};

export function vaultKindFor(kind: MotivationUploadKind): CredentialKind {
  return VAULT_KIND[kind] ?? (kind as unknown as CredentialKind);
}

/**
 * How many older documents one backfill request copies.
 *
 * ⚠️ FIFTEEN, BECAUSE THE REQUEST HAS A CEILING. Each adoption is a decrypt, a
 * re-encrypt and a disk write, and a member with three applications can hold
 * forty rows. nginx caps a request at 60s and Cloudflare at 100s, and this
 * project has already lost a paid-for motivation to a 504 that hid work which
 * had actually completed. The client loops; a closed tab simply resumes.
 */
export const BACKFILL_BATCH = 15;

export interface BackfillStep {
  adopted: number;
  /** Bytes already deleted by the motivation retention clock. Unrecoverable. */
  skippedPurged: number;
  /** The Centre is full. Not an error — they can delete something and resume. */
  cappedOut: number;
  done: boolean;
}

@Injectable()
export class VaultAdoptionService {
  private readonly logger = new Logger(VaultAdoptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: SecureFileStorageService,
    private readonly settings: SettingsService,
    private readonly consent: VaultConsentService,
  ) {}

  /**
   * Copy ONE upload into the member's Centre.
   *
   * Called as a fail-soft tail on addUpload, and by the backfill below.
   * Returns false for every ordinary reason not to — no consent, wrong kind,
   * already held, Centre full — and throws only on something genuinely wrong.
   */
  async adoptUpload(userId: string, uploadId: string): Promise<boolean> {
    if (!(await this.consent.mayKeepFor(userId))) return false;

    const u = await this.prisma.motivationUpload.findFirst({
      where: { id: uploadId, motivation: { userId } },
      select: {
        kind: true,
        storageKey: true,
        purgedAt: true,
        mimeType: true,
        sha256: true,
        extractionEncrypted: true,
        extractionOk: true,
        extractedFields: true,
        motivation: { select: { referenceNumber: true } },
      },
    });
    if (!u || !u.storageKey || u.purgedAt) return false;
    if (!VAULTABLE.has(u.kind)) return false;

    // Already held, by content. @@unique([userId, sha256]) is the real
    // guarantee; this only saves the work.
    const dup = await this.prisma.credential.count({
      where: { userId, sha256: u.sha256 },
    });
    if (dup > 0) return false;

    const cap = await this.settings.get(FLAGS.licenceCentreMaxCredentials);
    const held = await this.prisma.credential.count({ where: { userId } });
    if (held >= cap) return false;

    const bytes = await this.files.read(u.storageKey);
    // ⚠️ A FRESH BLOB IN THE VAULT'S OWN NAMESPACE. Pointing at the upload's
    // key would let the motivation retention sweep — which nulls storageKey
    // and stamps purgedAt — blank a document out of the member's Centre two
    // years later, with nothing in the Centre's own code to explain it.
    const stored = await this.files.write('credentials', bytes, new Date());

    try {
      await this.prisma.credential.create({
        data: {
          userId,
          kind: vaultKindFor(u.kind),
          // Which association document it really is — see DISCIPLINE_TYPE.
          disciplineType: DISCIPLINE_TYPE[u.kind] ?? null,
          // ⚠️ THE TITLE STILL COMES FROM THE ORIGINAL KIND. The row is filed
          // forward so the Centre can find it; what the member called it is
          // theirs, and "Your safe, closed" is the one record left of which
          // shot they said this was.
          title: documentLabel(u.kind),
          storageKey: stored.storageKey,
          mimeType: u.mimeType,
          byteSize: stored.byteSize,
          sha256: stored.sha256,
          addedVia: 'application',
          addedForRef: u.motivation?.referenceNumber ?? null,
          // ⚠️ THE READING GOES IN detailsEncrypted, NOT extractionEncrypted.
          // MotivationUpload keeps vision output in the latter; Credential's
          // copy of that column is documented NEVER WRITTEN, and a reader that
          // trusted the mirror once decrypted null on every row for months —
          // which is how the vault silently failed to fill anything on a
          // motivation.
          detailsEncrypted: u.extractionEncrypted,
          extractionOk: u.extractionOk,
          extractedFields: u.extractedFields,
          // No dates, and no vision call. The document has been read once
          // already; re-reading it spends money to arrive back here. The
          // member confirms the dates in the Centre when they want to.
        },
      });
      return true;
    } catch (err) {
      // The bytes must not outlive a failed row.
      await this.files.remove(stored.storageKey).catch(() => undefined);
      // A concurrent adoption won the race. Nothing to do and nothing wrong.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return false;
      }
      throw err;
    }
  }

  /**
   * One bounded pass over what they attached BEFORE they agreed.
   *
   * ⚠️ THE CURSOR IS WHY NOTHING RESURRECTS. It walks strictly older than the
   * watermark and advances it every batch, so a document the member deletes
   * from their Centre afterwards is never re-copied by a later step. Without
   * that, "delete" would mean "delete until the next batch".
   */
  async backfillStep(clerkId: string): Promise<BackfillStep> {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: {
        id: true,
        documentVaultBackfillCursor: true,
        documentVaultBackfilledAt: true,
      },
    });
    if (!user) return { adopted: 0, skippedPurged: 0, cappedOut: 0, done: true };

    // ⚠️ RE-CHECKED EVERY BATCH, not once at the start. Somebody who withdraws
    // half way through a long backfill must stop half way through it.
    if (!(await this.consent.mayKeepFor(user.id))) {
      return { adopted: 0, skippedPurged: 0, cappedOut: 0, done: true };
    }
    if (user.documentVaultBackfilledAt) {
      return { adopted: 0, skippedPurged: 0, cappedOut: 0, done: true };
    }

    const cursor = user.documentVaultBackfillCursor ?? new Date();
    const rows = await this.prisma.motivationUpload.findMany({
      where: {
        motivation: { userId: user.id },
        kind: { in: [...VAULTABLE] },
        createdAt: { lt: cursor },
      },
      orderBy: { createdAt: 'desc' },
      take: BACKFILL_BATCH,
      select: { id: true, createdAt: true, storageKey: true, purgedAt: true },
    });

    if (rows.length === 0) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { documentVaultBackfilledAt: new Date() },
      });
      return { adopted: 0, skippedPurged: 0, cappedOut: 0, done: true };
    }

    let adopted = 0;
    let skippedPurged = 0;
    let cappedOut = 0;
    const cap = await this.settings.get(FLAGS.licenceCentreMaxCredentials);

    for (const r of rows) {
      // ⚠️ A PURGED ROW IS COUNTED, NEVER READ. The row survives its bytes so
      // the application's annexure list still says what was attached; offering
      // to copy one would fail at the moment of copying, after the member had
      // been told a number.
      if (!r.storageKey || r.purgedAt) {
        skippedPurged += 1;
        continue;
      }
      const held = await this.prisma.credential.count({
        where: { userId: user.id },
      });
      if (held >= cap) {
        cappedOut += 1;
        continue;
      }
      try {
        if (await this.adoptUpload(user.id, r.id)) adopted += 1;
      } catch (err) {
        // One bad document must not stop the pass. It stays where it is and
        // the cursor moves past it; nothing is lost.
        this.logger.error(
          `Backfill: could not adopt upload ${r.id}: ${(err as Error).message}`,
        );
      }
    }

    // Oldest in the batch — the next step starts strictly before it.
    const oldest = rows[rows.length - 1].createdAt;
    await this.prisma.user.update({
      where: { id: user.id },
      data: { documentVaultBackfillCursor: oldest },
    });

    return {
      adopted,
      skippedPurged,
      cappedOut,
      done: rows.length < BACKFILL_BATCH,
    };
  }

  /** How many older documents are still waiting to be copied. */
  async backfillRemaining(clerkId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true, documentVaultBackfillCursor: true },
    });
    if (!user) return 0;
    return this.prisma.motivationUpload.count({
      where: {
        motivation: { userId: user.id },
        kind: { in: [...VAULTABLE] },
        storageKey: { not: null },
        purgedAt: null,
        createdAt: { lt: user.documentVaultBackfillCursor ?? new Date() },
      },
    });
  }
}
