import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../auth/session.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { SmsService } from '../sms/sms.service';
import {
  User,
  Province,
  NotificationCategory,
  NotifyFallbackChannel,
  Prisma,
} from '@prisma/client';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { encryptSaIdNumber, hashSaIdNumber, decryptSaIdNumber } from '../common/id-crypto';
import { PeachService } from '../payments/peach.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MotivationRetentionService } from '../motivations/motivation-retention.service';
import { LicenceCentreRetentionService } from '../licence-centre/licence-centre-retention.service';
import { KycService } from '../kyc/kyc.service';
import { AccountClosureService } from './account-closure.service';

// Address-book create/update payload (Phase 2).
export interface AddressInput {
  label?: string | null;
  building?: string | null;
  street: string;
  address2?: string | null;
  suburb?: string | null;
  city: string;
  postalCode: string;
  province: Province;
  lat?: number | null;
  lng?: number | null;
  isDefault?: boolean;
}

// Submitted by the ProfileCompletionModal post-first-publish. Hard
// wall — the seller can't skip it before the modal closes. Backend
// validates every field, then writes to the DB. (Bank details are reviewed
// manually at payout — see the note in completeProfile below.)
export interface ProfileCompleteDto {
  firstName: string;
  lastName: string;
  username: string;
  phone: string;
  addrBuilding?: string | null;
  addrStreet: string;
  addrAddress2?: string | null;
  addrSuburb: string;
  addrCity: string;
  addrPostalCode: string;
  addrProvince: Province;
  addrLat?: number | null;
  addrLng?: number | null;
  idNumber: string; // SA ID, 13 digits
  bankName: string;
  bankAccountHolder: string;
  bankAccountNumber: string;
  bankBranchCode: string;
  bankAccountType: 'cheque' | 'savings' | 'transmission';
}

// FLOW-F2 — bank-details-only update from /profile/edit. Buyer refunds
// (and seller payouts) are paid to this account by the daily FNB bulk
// batch; a buyer who is owed a refund has no reason to complete the
// full seller profile (SA ID, address, username…), so this DTO carries
// ONLY the banking quartet + account type, validated exactly like the
// profile-completion modal path.
export interface BankDetailsDto {
  bankName: string;
  bankAccountHolder: string;
  bankAccountNumber: string;
  bankBranchCode: string;
  bankAccountType: 'cheque' | 'savings' | 'transmission';
}

// Editable subset of the user record. Anything not in this shape can't
// be reached via PATCH /users/me. Phone is intentionally excluded —
// it goes through the OTP request/verify flow below.
export interface ProfileUpdate {
  firstName?: string | null;
  lastName?: string | null;
  /** ⚠️ Never null: username is non-null now, so clearing it is not a
   *  state a member can put their profile into. */
  username?: string;
  addrBuilding?: string | null;
  addrStreet?: string | null;
  addrAddress2?: string | null;
  addrSuburb?: string | null;
  addrCity?: string | null;
  addrPostalCode?: string | null;
  addrProvince?: Province | null;
  addrLat?: number | null;
  addrLng?: number | null;
}

/**
 * The phone OTP — minted, hashed and checked HERE, delivered over SMSPortal.
 *
 * ⚠️ THIS WENT TO DIDIT AND CAME STRAIGHT BACK, 2026-09-11. Two independent
 * reasons, either sufficient:
 *
 *   * Didit bills $0.1048 per ZA SMS against SMSPortal's ~$0.01-0.02, on the
 *     rail that already carries every action SMS this platform sends.
 *   * Didit REFUSES phone verification outright until the organisation's
 *     first top-up — HTTP 403, "phone verification is disabled until your
 *     organization's first top-up". It is an account state, not a bad number,
 *     and it surfaced as members being told to check a number that was fine.
 *
 * What is genuinely given up is Didit's phone intelligence — VoIP, disposable
 * number, recent-port (a SIM-swap signal) and trust index. We were not buying
 * those anyway; if they are ever wanted, they are a separate decision and NOT
 * a reason to move the OTP back.
 *
 * ⚠️ THE CAP IS THE SECURITY, NOT THE LENGTH. Six digits is a million
 * combinations — trivial to walk if guesses are unbounded. Lengthening the
 * code is not a substitute for keeping PHONE_OTP_MAX_ATTEMPTS.
 */
const PHONE_CODE_LENGTH = 6;
const PHONE_OTP_TTL_MS = 10 * 60 * 1000;
const PHONE_OTP_MAX_ATTEMPTS = 5;

/** sha256 hex. The code is never stored in the clear. */
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Profile photo limits. Matches what the edit form tells the member. */
const AVATAR_MIME_RE = /^image\/(jpeg|png|webp)$/;
const AVATAR_MAX_BYTES = 10 * 1024 * 1024;

// The accepted values for the fallback channel, spelled out rather than
// derived, because updateNotificationPrefs has to check an untrusted string
// against them at runtime and a TS union type is gone by then. Listed
// explicitly so adding an enum member to the schema does not silently widen
// what the endpoint accepts before anyone has decided it should.
const FALLBACK_CHANNELS: NotifyFallbackChannel[] = [
  'NONE',
  'WHATSAPP',
  'SMS',
  'EMAIL',
];

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
    // @Global PeachModule — bank-account verification (BANV) requests.
    private readonly peach: PeachService,
    // @Global NotificationsModule — clears the "fix your banking details"
    // inbox task the moment the user re-saves details.
    private readonly notifications: NotificationsService,
    // Not @Global on purpose: SecureFileStorageService stays scoped to
    // MotivationsModule so nothing else can write to the encrypted store. Only
    // the retention service is exported, and only so account deletion can
    // remove a member's licence documents before their rows disappear.
    private readonly motivationRetention: MotivationRetentionService,
    // Same reasoning, and the same one exported service: the member's Licence
    // Centre documents are encrypted files on our own disk, and a Prisma
    // cascade cannot reach the filesystem.
    private readonly licenceCentreRetention: LicenceCentreRetentionService,
    // Same reasoning again, for the pair of files that matter most: the
    // identity document and the selfie. They used to be Cloudinary assets
    // whose deletion was a written-down "tracked follow-up" and never
    // happened, so an erasure nulled our record of them and left the files
    // themselves readable to anybody with the link.
    private readonly kyc: KycService,
    // Closing an account without erasing the evidence. Same module, so no
    // new edge; kept out of this file because the predicate set that
    // decides whether a closure may go ahead is a page on its own.
    private readonly closure: AccountClosureService,
    // NOTE: no DiditService. The phone OTP is minted here and delivered by
    // SmsService; Didit's only remaining job is the KYC identity session.
    // Closing an account has to end every live session; the access token is
    // not revocable, so revoking the refresh side is what actually locks a
    // closed account out.
    private readonly sessions: SessionService,
    // @Global CloudinaryModule — profile photos are public by design and go
    // to the CDN. Identity documents deliberately do not; see setAvatar.
    private readonly cloudinary: CloudinaryService,
  ) {}

  // ── Peach bank-account verification (AVS) ─────────────────────────
  // Fired (fire-and-forget) after EVERY bank-details save. Sends the
  // account + the seller's SA ID to Peach BANV; the result webhook
  // (/payments/webhook/peach-banv) stamps bankVerifiedAt on a pass or
  // raises a BANK_VERIFY_MISMATCH alert on a fail. No-op when Peach
  // payouts aren't configured — the manual admin review remains the
  // gate until then. The ID number is decrypted in memory only and
  // NEVER logged.
  async requestBankVerification(userId: string): Promise<void> {
    if (!this.peach.isBanvEnabled()) return;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        bankAccountNumber: true,
        bankBranchCode: true,
        bankAccountType: true,
        idNumberEncrypted: true,
        firstName: true,
        lastName: true,
      },
    });
    if (
      !user ||
      !user.bankAccountNumber ||
      !user.bankBranchCode ||
      !user.idNumberEncrypted
    ) {
      // No ID on file yet (buyer refund details before profile completion)
      // — verification runs once the seller profile adds the ID.
      return;
    }
    try {
      const idNumber = decryptSaIdNumber(user.idNumberEncrypted);
      const res = await this.peach.verifyBankAccount({
        accountNumber: user.bankAccountNumber,
        branchCode: user.bankBranchCode,
        accountType: user.bankAccountType ?? 'unknown',
        idNumber,
        initials: user.firstName ? user.firstName.trim().charAt(0) : undefined,
        lastName: user.lastName ?? undefined,
      });
      if (!res) return;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          bankVerificationId: res.bankVerificationId,
          bankAvsResult: `REQUESTED:${res.resultCode ?? res.status}`,
        },
      });
      this.logger.log(
        `BANV requested for user ${user.id} (verification ${res.bankVerificationId})`,
      );
    } catch (err) {
      this.logger.warn(
        `BANV request failed for user ${userId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Replace the member's profile photo.
   *
   * ⚠️ AVATARS ARE PUBLIC BY DESIGN, WHICH IS WHY THEY GO TO THE CDN AND THE
   * IDENTITY DOCUMENTS DO NOT. Every other member sees this image next to a
   * username; a KYC selfie is the opposite kind of file and lives encrypted on
   * our own disk. Do not be tempted to unify the two paths.
   */
  async setAvatar(
    userId: string,
    file: { buffer: Buffer; mimetype: string; size: number },
  ): Promise<{ avatarUrl: string }> {
    if (!AVATAR_MIME_RE.test(file.mimetype)) {
      throw new BadRequestException('Use a JPEG, PNG or WebP image.');
    }
    if (file.size > AVATAR_MAX_BYTES) {
      throw new BadRequestException('Photo must be under 10 MB.');
    }
    let uploaded: { url: string };
    try {
      // Deterministic public id, so a re-upload REPLACES the old image rather
      // than leaving every photo the member ever had readable on the CDN.
      uploaded = await this.cloudinary.uploadImage(
        file.buffer,
        'avatars',
        `avatar-${userId}`,
      );
    } catch (err) {
      this.logger.error(`Avatar upload failed for ${userId}: ${(err as Error).message}`);
      throw new BadRequestException(
        'We could not save that photo. Please try again.',
      );
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: uploaded.url },
    });
    return { avatarUrl: uploaded.url };
  }

  /** Clear the profile photo. The CDN copy is left to expire. */
  async removeAvatar(userId: string): Promise<{ avatarUrl: null }> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: null },
    });
    return { avatarUrl: null };
  }

  /**
   * Refuse a username somebody else already holds.
   *
   * ⚠️ CASE-INSENSITIVELY, via usernameLower. Username is the ONLY identity
   * this platform shows other members, so "Gerhard" and "gerhard" being two
   * accounts is not an untidiness — it is impersonation one rename away.
   *
   * This check used to be the identity provider's. It is ours now, which also means every
   * write to `username` must write `usernameLower` in the same statement or
   * the unique index silently stops matching what is displayed.
   */
  private async assertUsernameFree(
    username: string,
    ownerId: string,
  ): Promise<void> {
    const taken = await this.prisma.user.findFirst({
      where: {
        usernameLower: username.trim().toLowerCase(),
        NOT: { id: ownerId },
      },
      select: { id: true },
    });
    if (taken) throw new BadRequestException('That username is taken.');
  }

  async findById(userId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }

  // Record sign-up consent (POPIA accountability) for the current identity-provider user.
  // Timestamps are set-once — a repeat call never moves the original consent
  // moment. Age affirmation + Terms + Privacy are captured together at sign-up;
  // marketing is a separate, explicit opt-in (only stamped when true, and
  // cleared to null when the user later opts out).
  /**
   * Attribute a member to the marketing campaign they arrived on. FIRST-TOUCH
   * and idempotent: the updateMany only matches while campaignKey is null, so
   * replaying this endpoint (or a returning member clicking a later blast)
   * can never re-attribute an account or inflate a campaign's sign-up count.
   * Returns false when there was nothing to write — the caller uses that to
   * decide whether to keep retrying (User row not provisioned yet) or stop.
   */
  async recordCampaignAttribution(
    userId: string,
    key?: string,
  ): Promise<boolean> {
    const campaignKey = key?.trim().slice(0, 40);
    if (!campaignKey) return false;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, campaignKey: true },
    });
    // No row yet (create-race): report false so the client retries later.
    if (!user) return false;
    // Already attributed — nothing to do, but the client should stop retrying.
    if (user.campaignKey) return true;
    await this.prisma.user.updateMany({
      where: { id: user.id, campaignKey: null },
      data: { campaignKey },
    });
    return true;
  }

  async recordSignupConsent(
    userId: string,
    dto: {
      terms?: boolean;
      privacy?: boolean;
      age?: boolean;
      marketing?: boolean;
      policyVersion?: string;
    },
  ): Promise<boolean> {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        termsAcceptedAt: true,
        privacyConsentAt: true,
        ageAffirmedAt: true,
      },
    });
    // Row not there yet (create-webhook race that the lazy-sync also missed).
    // Report false so the caller can retry rather than dropping the record.
    if (!existing) return false;
    const now = new Date();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.terms && !existing.termsAcceptedAt ? { termsAcceptedAt: now } : {}),
        ...(dto.privacy && !existing.privacyConsentAt ? { privacyConsentAt: now } : {}),
        ...(dto.age && !existing.ageAffirmedAt ? { ageAffirmedAt: now } : {}),
        ...(dto.policyVersion ? { consentPolicyVersion: dto.policyVersion.slice(0, 40) } : {}),
        // Marketing is toggleable both ways (explicit opt-in / opt-out).
        ...(dto.marketing === true
          ? { marketingConsentAt: now }
          : dto.marketing === false
            ? { marketingConsentAt: null }
            : {}),
      },
    });
    return true;
  }

  /**
   * Close the signed-in member's own account.
   *
   * ⚠️ THE ORDER IS THE WHOLE SAFETY ARGUMENT, and it is the opposite of the
   * obvious guess.
   *
   *   1. OUR DATABASE FIRST, in one transaction. Until accountClosedAt is
   *      committed, the identity-provider webhook has no way to know this was a closure —
   *      and its old default was to hard-delete the row, taking the complaints
   *      register with it. Deleting the identity-provider user first would race exactly
   *      that.
   *   2. CLERK SECOND. The webhook fires, sees accountClosedAt, does nothing
   *      but tombstone the userId.
   *
   * If step 2 fails the member is closed in our database and can still sign in
   * to a dead account — every write gate refuses them and the resurrection
   * guard in upsertFromClerk stops a stray `user.updated` undoing anything.
   * That is a recoverable state; the reverse is not.
   */
  async closeMyAccount(
    userId: string,
    reason: string,
  ): Promise<{ closed: true; cancelledListings: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const { cancelledListingIds } = await this.closure.close(user.id, {
      closedBy: 'MEMBER',
      reason: this.closure.assertReason(reason),
    });

    // ⚠️ REVOKE EVERY SESSION AFTER THE COMMIT. Closure used to end with a
    // delete against the identity provider; now that we own the sessions, the
    // equivalent — and the only thing standing between a closed account and
    // somebody still using it — is killing the refresh tokens. Fail-soft: a
    // closure the member has already been told about must not roll back, and
    // the access token expires within fifteen minutes regardless.
    try {
      await this.sessions.revokeAllForUser(user.id);
    } catch (err) {
      this.logger.error(
        `Account ${user.id} closed, but its sessions could not be revoked — they can still use a live token until it expires: ${(err as Error).message}`,
      );
    }

    // ⚠️ THE DB IS ALREADY CORRECT; ONLY THE SEARCH INDEX LAGS. The listings
    // are CANCELLED, so browseViaPrisma and every PDP already exclude them.
    // A stale Meilisearch document can still surface in ?q= until the next
    // reindex, which is why the ids are on the closure record — see
    // AccountClosure.cancelledListingIds.
    if (cancelledListingIds.length) {
      this.logger.log(
        `Account ${user.id}: ${cancelledListingIds.length} listing(s) cancelled and awaiting reindex`,
      );
    }

    return { closed: true, cancelledListings: cancelledListingIds.length };
  }

  async deleteById(userId: string): Promise<void> {
    // H3 — identity-provider user.deleted webhook handler. Hard delete fails for
    // any user with transactions/ratings/offers (FK RESTRICT in the
    // financial models), which would 500 the webhook and make the identity provider
    // retry forever AND leave the seller's PII on file indefinitely.
    //
    // This minimal interim fix wraps the delete in try/catch so the
    // webhook always 200s. When delete is blocked by financial-row
    // RESTRICTs, we PII-scrub the row in-place (POPIA erasure
    // semantics) while preserving the financial history needed for
    // SARS / dispute defence. A proper soft-delete column + DTO
    // exclusion is tracked on the launch checklist.
    // FIRST, and outside both branches: remove the member's encrypted licence
    // documents and the motivations that point at them.
    //
    // Both branches below leaked, in different directions. A hard delete
    // cascades the motivation rows away, and a cascade cannot reach the
    // filesystem — so the ID copies and licence scans stayed on disk with
    // nothing left pointing at them, invisible to the nightly retention sweep,
    // which finds files THROUGH rows. The scrub branch leaked worse: it keeps
    // the User row when financial FKs block the delete, so the motivations
    // survived untouched and an erasure request left the applicant's ID number,
    // home address and account of their own security circumstances exactly
    // where they were.
    //
    // Never throws — this is a webhook, and an exception makes the identity provider retry
    // forever while the account stays undeleted.
    const target = await this.prisma.user.findFirst({
      where: { id: userId },
      select: { id: true, accountClosedAt: true },
    });
    if (target) {
      // Guarded HERE as well as inside purgeForUser. That method swallows its
      // own failures, but a webhook must not depend on a promise another module
      // makes — if it ever stops keeping it, the identity provider retries forever and the
      // account is never deleted at all.
      try {
        const purged = await this.motivationRetention.purgeForUser(target.id);
        if (purged.motivations > 0) {
          this.logger.log(
            `Erasure for user ${userId}: removed ${purged.motivations} motivation(s) and ${purged.filesRemoved} encrypted document(s)` +
              (purged.filesFailed > 0
                ? `; ${purged.filesFailed} file(s) FAILED to delete and need removing by hand`
                : ''),
          );
        }
      } catch (err) {
        this.logger.error(
          `Erasure for user ${userId}: motivation purge threw, continuing with account deletion: ${(err as Error).message}`,
        );
      }

      // ⚠️ THE ROWS ARE DELETED EXPLICITLY, not left to the cascade. The
      // fallback branch below KEEPS the User row and scrubs its PII when a
      // financial foreign key blocks the delete — under that branch no cascade
      // ever happens, and the member's licence documents would survive an
      // erasure request entirely.
      try {
        const lc = await this.licenceCentreRetention.purgeForUser(target.id);
        if (lc.credentials > 0) {
          this.logger.log(
            `Erasure for user ${userId}: removed ${lc.credentials} Licence Centre document(s), ${lc.filesRemoved} file(s)` +
              (lc.filesFailed > 0
                ? `; ${lc.filesFailed} file(s) FAILED to delete and need removing by hand`
                : ''),
          );
        }
      } catch (err) {
        this.logger.error(
          `Erasure for user ${userId}: licence-centre purge threw, continuing with account deletion: ${(err as Error).message}`,
        );
      }

      // ⚠️ BEFORE THE COLUMNS ARE CLEARED, or the keys that point at the files
      // are gone and the files are unreachable rather than deleted.
      try {
        const k = await this.kyc.purgeKycFiles(target.id);
        if (k.removed > 0 || k.failed > 0) {
          this.logger.log(
            `Erasure for user ${userId}: removed ${k.removed} KYC file(s)` +
              (k.failed > 0
                ? `; ${k.failed} FAILED to delete and need removing by hand`
                : ''),
          );
        }
      } catch (err) {
        this.logger.error(
          `Erasure for user ${userId}: KYC file purge threw, continuing with account deletion: ${(err as Error).message}`,
        );
      }
    }

    // ⚠️ AN ALREADY-CLOSED ACCOUNT IS DONE. Its identity has been snapshotted
    // onto an AccountClosure row, its uniqueness claims released and its
    // documents purged — and the closure flow deletes the identity-provider user itself,
    // so this webhook is the ECHO of that deletion, not a new instruction.
    // Running the scrub again would null columns the closure deliberately held
    // (the SAP 534 identity) and log a second erasure that never happened.
    if (target?.accountClosedAt) {
      this.logger.log(
        `identity-provider user ${userId} deleted — account already closed at ${target.accountClosedAt.toISOString()}, nothing to do`,
      );
      // Tombstone the userId so /sellers/:userId 404s for free and a future
      // sign-up cannot collide with it.
      //
      // ⚠️ THE TOMBSTONE IS GONE BECAUSE WHAT IT GUARDED IS GONE. It wrote
      // `closed_<id>` over the identity-provider subject so a returning member
      // could sign up again on the same provider account. We own the identity
      // now, and AccountClosure already frees the username, email and phone —
      // which is the whole of what "the claims go back into the namespace"
      // ever meant. Nothing else here needs writing.
      return;
    }

    // ── FROM HERE ON THE ROW ALWAYS SURVIVES ──────────────────────────
    //
    // ⚠️ THIS USED TO ATTEMPT A HARD DELETE FIRST, and the scrub below was only
    // the `catch`. So the member with the CLEANEST record got the most
    // thorough wipe: a foreign key had to BLOCK the delete for anything to be
    // preserved at all, which meant anyone who had never traded was removed
    // outright — and with them, by cascade, their Complaint rows and every
    // ComplaintPhoto, their SupportTicket history, their LoginEvent trail and
    // their Ask Boet conversations.
    //
    // Operator, 2026-08-22: "if a user commited a crime or something they cant
    // just vanish by deleting and wiping evidence." The delete was exactly
    // that, and it was the DEFAULT path.
    //
    // The row is now always kept and always scrubbed. Every financial relation
    // (Transaction, Order, Rating, Offer, Bid, Swap) is ON DELETE RESTRICT and
    // stays pointed at it.
    try {
      // ⚠️ WHAT WE MAY NOT ERASE, AND WHY — READ BEFORE ADDING A COLUMN HERE.
      //
      // assembleSaps534Data (payments/transactions.service.ts) builds Section C
      // of the SAP 534 firearm-transfer form LIVE off this row: firstName,
      // lastName, idNumberEncrypted, phone, email and the address block.
      // Transaction carries NO identity snapshot of its own.
      //
      // So nulling those six on a member who has transferred a firearm makes
      // the statutory form unregenerable — a re-download comes back with the
      // whole of Section C blank. The comment that used to sit here, claiming
      // this data "lives on the Transaction, not here", was simply false.
      //
      // A firearm transfer is a legal obligation that outlives an erasure
      // request, so where one exists the identity is HELD and the rest is
      // still scrubbed. Where none exists, everything goes.
      const firearmHold = await this.prisma.transaction.count({
        where: {
          OR: [{ sellerId: target?.id ?? '' }, { buyerId: target?.id ?? '' }],
          listing: { isFirearm: true },
        },
      });

      // ⚠️ AND MONEY WE STILL OWE THEM. hasBank() is the readiness predicate
      // for every payout run; clearing the quartet while a payout is due makes
      // that money permanently unpayable, with no alert and no way to
      // re-collect the details from somebody whose account is gone. The
      // published privacy policy already promises this carve-out.
      const payoutDue = await this.prisma.transaction.count({
        where: {
          sellerId: target?.id ?? '',
          paymentStatus: 'RELEASED',
          sellerPayout: { gt: 0 },
          paidOutAt: null,
          payoutHeldAt: null,
          refundOfId: null,
        },
      });

      await this.prisma.user.updateMany({
        where: { id: userId },
        data: {
          // ⚠️ @accounts.invalid, NOT @gungalore.local. RFC 6761 reserves
          // .invalid precisely so it can never resolve; a made-up subdomain of
          // a domain we own can be created by accident and start accepting
          // mail addressed to erased members.
          ...(firearmHold === 0
            ? {
                email: `deleted+${Date.now()}@accounts.invalid`,
                firstName: null,
                lastName: null,
                phone: null,
                idNumberEncrypted: null,
                addrBuilding: null,
                addrStreet: null,
                addrAddress2: null,
                addrSuburb: null,
                addrCity: null,
                addrPostalCode: null,
                addrProvince: null,
                addrLat: null,
                addrLng: null,
              }
            : {}),
          // ⚠️ THE PHONE'S VERIFICATION STATE GOES WITH THE PHONE. Nulling the
          // number and leaving phoneVerified true left a row claiming a
          // verified phone it does not have.
          ...(firearmHold === 0
            ? { phoneVerified: false }
            : {}),

          // Erased in every case — none of it is needed by any statutory form.
          avatarUrl: null,
          dateOfBirth: null,
          kycIdDocumentUrl: null,
          kycIdStorageKey: null,
          kycIdMimeType: null,
          kycSelfieUrl: null,
          kycSelfieStorageKey: null,
          kycClaudeFindings: Prisma.DbNull,

          // ⚠️ SILENCE EVERY CHANNEL. The row survives now, so without this a
          // cron could still address an erased member — and the address it
          // would use is the sentinel above.
          notifyEmailEnabled: false,
          notifySmsEnabled: false,
          notifyWhatsappEnabled: false,

          ...(payoutDue === 0
            ? {
                bankAccountHolder: null,
                bankAccountNumber: null,
                bankBranchCode: null,
                bankName: null,
                bankAccountType: null,
              }
            : {}),

          // ⚠️ isBanned IS NO LONGER SET. Deleting an account is not
          // misconduct, and stamping it made every admin view and every
          // isBanned filter read a departure as an enforcement action —
          // including the ones that decide what an admin sees when they go
          // looking for people we have actually banned.
        },
      });

      this.logger.log(
        `Erasure for user ${userId}: row preserved and scrubbed` +
          (firearmHold > 0
            ? `; identity HELD — ${firearmHold} firearm transaction(s) need Section C of the SAP 534`
            : '') +
          (payoutDue > 0
            ? `; bank details HELD — ${payoutDue} payout(s) still owed`
            : ''),
      );
    } catch (scrubErr) {
      this.logger.error(
        `PII scrub of clerk user ${userId} failed: ${(scrubErr as Error).message}`,
      );
    }
  }

  // ─────────────────── Profile editing ─────────────────────────────
  // PATCH /users/me body. Only the fields in ProfileUpdate are accepted;
  // every other column on User is off-limits via this endpoint.
  //
  // Username changes are mirrored to the identity provider so the seller's identity
  // profile stays in sync. We push to the identity provider BEFORE writing to our DB —
  // if the identity provider rejects (username taken globally, invalid format, etc.) the
  // seller gets a single error and our DB stays consistent. Address /
  // name fields are NOT pushed because the identity provider doesn't own them (KYC does).
  // Submitted by the post-first-publish profile modal. One shot —
  // all fields required, Peach AVS validates the bank quartet, SA ID
  // is encrypted at rest (purged after the KYC selfie passes), and
  // profileCompletedAt is the gate the payout flow checks. Throws a
  // user-readable BadRequestException for any failure so the modal
  // can show the message inline.
  async completeProfile(userId: string, dto: ProfileCompleteDto): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // ─── Hard-validate inputs before touching Peach or the DB ─────
    const firstName = dto.firstName.trim();
    const lastName = dto.lastName.trim();
    const username = dto.username.trim().toLowerCase();
    const phone = dto.phone.trim();
    const idNumber = dto.idNumber.replace(/\s/g, '');
    if (!firstName || !lastName) {
      throw new BadRequestException('First and last name are required');
    }
    if (!/^[a-z0-9_]{3,30}$/.test(username)) {
      throw new BadRequestException(
        'Username must be 3-30 lowercase letters/digits/underscores',
      );
    }
    if (!/^\+?\d{9,15}$/.test(phone)) {
      throw new BadRequestException('Phone number looks invalid');
    }
    if (!/^\d{13}$/.test(idNumber)) {
      throw new BadRequestException('SA ID must be exactly 13 digits');
    }
    if (!dto.addrStreet.trim() || !dto.addrCity.trim() || !dto.addrPostalCode.trim()) {
      throw new BadRequestException('Full address (street, city, postal code) is required');
    }
    const validAccountTypes = ['cheque', 'savings', 'transmission'] as const;
    if (!validAccountTypes.includes(dto.bankAccountType)) {
      throw new BadRequestException('Invalid bank account type');
    }
    if (!/^\d{4,20}$/.test(dto.bankAccountNumber.trim())) {
      throw new BadRequestException('Bank account number looks invalid');
    }
    if (!/^\d{4,8}$/.test(dto.bankBranchCode.trim())) {
      throw new BadRequestException('Branch code looks invalid');
    }

    // ─── Uniqueness checks (don't reach Peach if we'd reject anyway) ──
    if (username !== user.username) {
      const clash = await this.prisma.user.findUnique({ where: { username } });
      if (clash && clash.id !== user.id) {
        throw new BadRequestException('That username is taken');
      }
    }
    const idHash = hashSaIdNumber(idNumber);
    if (idHash !== user.kycIdHash) {
      const idClash = await this.prisma.user.findUnique({
        where: { kycIdHash: idHash },
      });
      if (idClash && idClash.id !== user.id) {
        throw new BadRequestException(
          'That SA ID number is already associated with another All Outdoor account',
        );
      }
    }

    // No automated bank-account verification runs here. Peach BANV is built
    // and deployed but INERT (it gates payouts via bankVerifiedAt once the
    // PEACH_* credentials are live), so today bank details are captured as
    // entered and an ADMIN reviews the account holder against the KYC-verified
    // identity before the first payout. Do not upgrade any user-facing copy to
    // claim automated verification until BANV is actually switched on.

    // ─── Username uniqueness is ours to enforce now ──────────────────
    if (username !== user.username) {
      await this.assertUsernameFree(username, userId);
    }

    // ─── Save everything in one update ────────────────────────────
    const encryptedId = encryptSaIdNumber(idNumber);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName,
        lastName,
        username,
        usernameLower: username.trim().toLowerCase(),
        phone,
        addrBuilding: dto.addrBuilding ?? null,
        addrStreet: dto.addrStreet.trim(),
        addrAddress2: dto.addrAddress2 ?? null,
        addrSuburb: dto.addrSuburb.trim(),
        addrCity: dto.addrCity.trim(),
        addrPostalCode: dto.addrPostalCode.trim(),
        addrProvince: dto.addrProvince,
        addrLat: dto.addrLat ?? null,
        addrLng: dto.addrLng ?? null,
        idNumberEncrypted: encryptedId,
        kycIdHash: idHash,
        bankName: dto.bankName.trim(),
        bankAccountHolder: dto.bankAccountHolder.trim(),
        bankAccountNumber: dto.bankAccountNumber.trim(),
        bankBranchCode: dto.bankBranchCode.trim(),
        bankAccountType: dto.bankAccountType,
        bankVerifiedAt: null,
        bankAvsResult: null,
        bankVerificationId: null,
        profileCompletedAt: new Date(),
      },
    });

    this.logger.log(
      `Profile completed for ${userId} (bank=${dto.bankName})`,
    );
    // Saving new details is the "fix" action — clear any open bank-verify
    // task, then kick off a fresh Peach verification (no-op until
    // configured; re-notifies if it fails again).
    void this.notifications.resolveByEntity('bank', updated.id);
    void this.requestBankVerification(updated.id);
    return updated;
  }

  // FLOW-F2 — set/replace ONLY the banking quartet (+ account type)
  // from /profile/edit. Seller payouts (and any owed refunds) are paid
  // to this account via Peach Payouts; refund notifications link buyers
  // here when they have no bank details on file. Same validation rules
  // as completeProfile's banking section. Changing details resets
  // bankVerifiedAt/bankAvsResult/bankVerificationId and re-runs Peach
  // bank-account verification (BANV); until BANV is configured, the
  // manual admin holder-name review remains the pre-payout gate.
  async updateBankDetails(userId: string, dto: BankDetailsDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const bankName = (dto.bankName ?? '').trim();
    const bankAccountHolder = (dto.bankAccountHolder ?? '').trim();
    const bankAccountNumber = (dto.bankAccountNumber ?? '').trim();
    const bankBranchCode = (dto.bankBranchCode ?? '').trim();
    if (!bankName) {
      throw new BadRequestException('Bank name is required');
    }
    if (!bankAccountHolder) {
      throw new BadRequestException('Account holder name is required');
    }
    const validAccountTypes = ['cheque', 'savings', 'transmission'] as const;
    if (!validAccountTypes.includes(dto.bankAccountType)) {
      throw new BadRequestException('Invalid bank account type');
    }
    if (!/^\d{4,20}$/.test(bankAccountNumber)) {
      throw new BadRequestException('Bank account number looks invalid');
    }
    if (!/^\d{4,8}$/.test(bankBranchCode)) {
      throw new BadRequestException('Branch code looks invalid');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        bankName,
        bankAccountHolder,
        bankAccountNumber,
        bankBranchCode,
        bankAccountType: dto.bankAccountType,
        bankVerifiedAt: null,
        bankAvsResult: null,
        bankVerificationId: null,
      },
      // Trimmed response — exactly the fields /profile/edit needs to
      // refresh its "account on file" summary. Never the whole User.
      select: {
        bankName: true,
        bankAccountHolder: true,
        bankAccountNumber: true,
        bankBranchCode: true,
        bankAccountType: true,
        bankVerifiedAt: true,
      },
    });
    this.logger.log(`Bank details updated for ${userId} (bank=${bankName})`);
    // Saving new details is the "fix" action — clear any open bank-verify
    // task, then kick off a fresh Peach verification (no-op until
    // configured; silently skips buyers who have no SA ID on file yet).
    void this.notifications.resolveByEntity('bank', user.id);
    void this.requestBankVerification(user.id);
    return updated;
  }

  // Buyer phone capture without OTP. Per operator decision, we trust
  // buyers to type their own number — we just need it so dispatch
  // SMS reaches them. Leaves phoneVerified false; only the seller
  // OTP flow flips that bit. If the seller later wants their phone
  // properly verified they can run the OTP request/verify flow and
  // overwrite this same column.
  async saveBuyerPhone(userId: string, phone: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { phone },
    });
  }

  async updateProfile(userId: string, patch: ProfileUpdate): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Normalise username (lowercase) + check uniqueness ourselves so we
    // can return a friendly error instead of a Prisma constraint hit.
    let username: string | null | undefined = patch.username;
    if (typeof username === 'string') {
      username = username.trim().toLowerCase();
      if (username.length === 0) username = null;
      if (username && username !== user.username) {
        const clash = await this.prisma.user.findUnique({
          where: { username },
        });
        if (clash && clash.id !== user.id) {
          throw new BadRequestException('That username is taken');
        }
      }
    }

    // If the username actually changed, check it is free before writing.
    // ⚠️ It can no longer be CLEARED: username is non-null now, because it is
    // the only name other members ever see and "Anonymous seller" as a
    // permanent state is not a profile.
    if (username !== undefined && username !== user.username) {
      if (!username) {
        throw new BadRequestException('A username is required.');
      }
      await this.assertUsernameFree(username, userId);
    }

    // Once KYC has verified the seller, their first/last name on file
    // is the official Home Affairs version. We refuse incoming patches
    // for either field at that point — the UI also locks the inputs,
    // this is defence-in-depth against a tampered request body.
    const cleanedPatch = { ...patch };
    if (user.kycStatus === 'VERIFIED') {
      delete cleanedPatch.firstName;
      delete cleanedPatch.lastName;
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...cleanedPatch,
        // Only include username if the caller actually sent it — and never
        // without usernameLower, which is what the unique index is on.
        ...(username
          ? { username, usernameLower: username.trim().toLowerCase() }
          : {}),
      },
    });

    // Address soft-flag — never blocks. If 4+ accounts now share the
    // same lat/lng + street + postal code, raise an AdminAlert so the
    // operator can decide whether it's a legit shared household or a
    // fraud cluster. Family of 3 → fine. Stash house with 10 accounts
    // → admin sees it and decides. Dedupes alerts by including the
    // address fingerprint in the type slug.
    void this.maybeFlagSharedAddress(updated).catch((err) =>
      this.logger.warn(
        `Shared-address check failed for ${updated.id}: ${(err as Error).message}`,
      ),
    );

    return updated;
  }

  // Raises a DUPLICATE_ADDRESS AdminAlert when 4+ users share the
  // exact same physical address (lat/lng + street + postal code).
  // Idempotent per cluster: same fingerprint within 30 days is treated
  // as already-reported, no second alert. We pick the strict 4-account
  // threshold because 1-3 covers most legitimate family households.
  private async maybeFlagSharedAddress(user: User): Promise<void> {
    if (
      !user.addrStreet ||
      !user.addrPostalCode ||
      user.addrLat == null ||
      user.addrLng == null
    ) {
      return; // partial address — nothing to fingerprint on
    }
    const matches = await this.prisma.user.count({
      where: {
        addrStreet: user.addrStreet,
        addrPostalCode: user.addrPostalCode,
        addrLat: user.addrLat,
        addrLng: user.addrLng,
      },
    });
    if (matches < 4) return;

    // Dedupe: only one alert per address per 30-day window.
    const fingerprint = `DUPLICATE_ADDRESS:${user.addrPostalCode}:${user.addrLat?.toFixed(5)},${user.addrLng?.toFixed(5)}`;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recent = await this.prisma.adminAlert.findFirst({
      where: { type: fingerprint, createdAt: { gt: thirtyDaysAgo } },
    });
    if (recent) return;

    await this.prisma.adminAlert.create({
      data: {
        type: fingerprint,
        referenceId: user.id,
        context: `${matches} accounts share address: ${user.addrStreet}, ${user.addrCity ?? ''} ${user.addrPostalCode}. May be a household, may be fraud — review the linked users.`,
        urgent: false,
      },
    });
    this.logger.log(
      `Flagged shared address (${matches} accounts) at ${user.addrPostalCode}`,
    );
  }

  // ─────────────────── Phone change + OTP ──────────────────────────
  // The seller submits a new phone number. We generate a 4-digit OTP,
  // hash + store it with a 10-minute TTL, and send the plain code via
  // SMSPortal. The OLD phone (if any) keeps working until they verify
  // the new one. If SMS sending fails the OTP isn't persisted.
  async requestPhoneChange(
    userId: string,
    rawPhone: string,
  ): Promise<{ sent: boolean; stub?: boolean }> {
    if (!rawPhone || rawPhone.trim().length === 0) {
      throw new BadRequestException('Phone number is required');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Hard-block duplicates: one SA mobile = one All Outdoor account.
    // Phone @unique isn't enforced at the DB level yet (there's a
    // pre-existing test-account dupe we're handling pre-rollout), so
    // we enforce in app code. Own-row match (re-verifying the same
    // phone you already have) is allowed.
    const trimmedPhone = rawPhone.trim();
    const owner = await this.prisma.user.findFirst({
      where: { phone: trimmedPhone, id: { not: user.id } },
      select: { id: true },
    });
    if (owner) {
      throw new BadRequestException(
        'That phone number is already linked to another All Outdoor account.',
      );
    }

    // ⚠️ E.164 OR NOTHING. A locally-typed "0821234567" has to become
    // "+27821234567" before it goes anywhere — the carrier needs it, and the
    // uniqueness check above only works if every stored number has one shape.
    const e164 = this.sms.toE164(trimmedPhone);
    if (!e164) {
      throw new BadRequestException(
        'Enter a valid phone number, including the country code.',
      );
    }

    const code = String(randomInt(0, 10 ** PHONE_CODE_LENGTH)).padStart(
      PHONE_CODE_LENGTH,
      '0',
    );

    // ⚠️ PERSIST FIRST, SEND SECOND — the opposite of the order this had while
    // the provider held the code, and deliberately so. The hash has to be on
    // the row before the SMS can arrive, or a member who reads a fast SMS and
    // types the code beats the write and is told their correct code is wrong.
    // The cost is a stored hash for a message that may fail to send, which is
    // harmless: it expires, and the send failure below is reported.
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        phone: e164,
        phoneVerified: false,
        phoneOtpHash: sha256(code),
        phoneOtpExpiresAt: new Date(Date.now() + PHONE_OTP_TTL_MS),
        phoneOtpAttempts: 0,
      },
    });

    const minutes = Math.round(PHONE_OTP_TTL_MS / 60_000);
    let result: { success: boolean };
    try {
      result = await this.sms.sendSms({
        to: e164,
        message: `${code} is your All Outdoor verification code. It expires in ${minutes} minutes.`,
        // ⚠️ The `phone-change-` prefix is not decoration: SmsService derives
        // "never auto-retry" from it. A code redelivered twenty minutes later
        // by the retry cron is expired, confusing, and bills us twice.
        reference: `phone-change-${userId}`,
      });
    } catch {
      // A transport throw is not a bad number. Telling somebody their valid
      // number is wrong makes them change a correct answer.
      throw new BadRequestException(
        'We could not send the code just now. Please try again shortly.',
      );
    }
    if (!result.success) {
      throw new BadRequestException(
        'We could not send the code just now. Please try again shortly.',
      );
    }

    return { sent: true };
  }

  // Submit the 4-digit code. On success: phoneVerified=true, OTP wiped.
  // On failure: clear error so the seller knows whether to re-request.
  async verifyPhoneChange(
    userId: string,
    code: string,
  ): Promise<{ verified: true }> {
    const entered = code?.trim() ?? '';
    // Reject a malformed code HERE, before any database work. A string that
    // is not even the right shape cannot be the code, so it must not consume
    // one of PHONE_OTP_MAX_ATTEMPTS — otherwise a member fat-fingering a
    // letter burns a guess they never really made.
    if (!new RegExp(`^\\d{4,${PHONE_CODE_LENGTH + 2}}$`).test(entered)) {
      throw new BadRequestException(
        `Enter the ${PHONE_CODE_LENGTH}-digit code`,
      );
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        phoneVerified: true,
        phoneOtpHash: true,
        phoneOtpExpiresAt: true,
        phoneOtpAttempts: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.phone || !user.phoneOtpHash || !user.phoneOtpExpiresAt) {
      throw new BadRequestException(
        'No verification code is pending — request a new one.',
      );
    }

    if (user.phoneOtpExpiresAt.getTime() < Date.now()) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { phoneOtpHash: null, phoneOtpExpiresAt: null },
      });
      throw new BadRequestException(
        'That code has expired — request a new one.',
      );
    }

    // ⚠️ CAP CHECKED BEFORE THE COMPARISON, and the code discarded when it
    // trips. Counting afterwards hands the attacker one free guess past the
    // limit on every code issued.
    if (user.phoneOtpAttempts >= PHONE_OTP_MAX_ATTEMPTS) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { phoneOtpHash: null, phoneOtpExpiresAt: null },
      });
      throw new BadRequestException(
        'Too many incorrect codes — request a new one.',
      );
    }

    // Constant-time: how long the comparison took must not say how much of
    // the code was right.
    const given = sha256(entered);
    const match =
      given.length === user.phoneOtpHash.length &&
      timingSafeEqual(Buffer.from(given), Buffer.from(user.phoneOtpHash));

    if (!match) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { phoneOtpAttempts: { increment: 1 } },
      });
      throw new BadRequestException(
        "That code doesn't match — try again, or request a new one.",
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        phoneVerified: true,
        // Spent. A live code after verification would re-verify a number the
        // member has since changed.
        phoneOtpHash: null,
        phoneOtpExpiresAt: null,
        phoneOtpAttempts: 0,
      },
    });
    return { verified: true };
  }

  // ─────────────────── Address book (Phase 2) ────────────────────────
  /**
   * Assert the caller's User row still exists, so a request carrying a valid
   * token for a deleted account gets a clean 404 rather than a foreign-key
   * error further down.
   *
   * This used to translate an identity provider subject into a User.id. There is only one
   * identifier now, so the translation is gone and the existence check is all
   * that remains — which is why it returns nothing and callers no longer
   * rebind the id.
   */
  private async assertUserExists(userId: string): Promise<void> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!u) throw new NotFoundException('User not found');
  }

  async listAddresses(userId: string) {
    await this.assertUserExists(userId);
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createAddress(userId: string, input: AddressInput) {
    await this.assertUserExists(userId);
    this.assertAddress(input);
    const count = await this.prisma.address.count({ where: { userId } });
    // First saved address is the default; otherwise honour the flag.
    const makeDefault = count === 0 ? true : !!input.isDefault;
    return this.prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.address.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.address.create({
        data: {
          ...(this.cleanAddress(input) as object),
          street: input.street.trim(),
          city: input.city.trim(),
          postalCode: input.postalCode.trim(),
          province: input.province,
          userId,
          isDefault: makeDefault,
        },
      });
    });
  }

  async updateAddress(
    userId: string,
    id: string,
    input: Partial<AddressInput>,
  ) {
    await this.assertUserExists(userId);
    const existing = await this.prisma.address.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('Address not found');
    const data = this.cleanAddress(input);
    return this.prisma.$transaction(async (tx) => {
      if (input.isDefault === true) {
        await tx.address.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
        data.isDefault = true;
      }
      return tx.address.update({ where: { id }, data });
    });
  }

  async deleteAddress(userId: string, id: string) {
    await this.assertUserExists(userId);
    const existing = await this.prisma.address.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('Address not found');
    await this.prisma.address.delete({ where: { id } });
    // If the default was removed, promote the most recent remaining address.
    if (existing.isDefault) {
      const next = await this.prisma.address.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      if (next) {
        await this.prisma.address.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
      }
    }
    return { deleted: true };
  }

  private assertAddress(input: AddressInput) {
    if (!input.street?.trim())
      throw new BadRequestException('Street address is required');
    if (!input.city?.trim())
      throw new BadRequestException('City is required');
    if (!input.postalCode?.trim())
      throw new BadRequestException('Postal code is required');
    if (!input.province)
      throw new BadRequestException('Province is required');
  }

  // Normalise the optional/string fields; leaves required fields to the
  // caller (create supplies them explicitly).
  private cleanAddress(input: Partial<AddressInput>): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    const strFields: (keyof AddressInput)[] = [
      'label',
      'building',
      'street',
      'address2',
      'suburb',
      'city',
      'postalCode',
    ];
    for (const f of strFields) {
      if (f in input) {
        const v = input[f] as string | null | undefined;
        data[f] = v != null && v.toString().trim() ? v.toString().trim() : null;
      }
    }
    if ('province' in input && input.province) data.province = input.province;
    if ('lat' in input) data.lat = input.lat ?? null;
    if ('lng' in input) data.lng = input.lng ?? null;
    return data;
  }

  // ─────────────────── Notification preferences (Phase 2) ────────────
  // Per-channel mute. The in-app inbox is always on; web-push is managed
  // per-device. Email, SMS and WhatsApp are settable here, plus the
  // fallback channel — WhatsApp now carries shipping updates only.
  async updateNotificationPrefs(
    userId: string,
    prefs: {
      emailEnabled?: boolean;
      smsEnabled?: boolean;
      whatsappEnabled?: boolean;
      fallbackChannel?: string;
    },
  ) {
    const data: {
      notifyEmailEnabled?: boolean;
      notifySmsEnabled?: boolean;
      notifyWhatsappEnabled?: boolean;
      notifyFallbackChannel?: NotifyFallbackChannel;
    } = {};
    if (typeof prefs.emailEnabled === 'boolean')
      data.notifyEmailEnabled = prefs.emailEnabled;
    if (typeof prefs.smsEnabled === 'boolean')
      data.notifySmsEnabled = prefs.smsEnabled;
    if (typeof prefs.whatsappEnabled === 'boolean')
      data.notifyWhatsappEnabled = prefs.whatsappEnabled;
    // ⚠️ Validated BY HAND, and it has to be. This endpoint takes an inline
    // body type rather than a DTO class, so the global ValidationPipe has no
    // metadata to work from and waves the value straight through — an
    // unchecked string reaches Prisma and dies as a 500 on an enum cast, or
    // worse, a future `as` silences it. Treat the value as hostile: only the
    // four names of the enum are accepted, anything else is a 400.
    if (prefs.fallbackChannel !== undefined) {
      const channel = prefs.fallbackChannel as NotifyFallbackChannel;
      if (
        typeof prefs.fallbackChannel !== 'string' ||
        !FALLBACK_CHANNELS.includes(channel)
      )
        throw new BadRequestException(
          `fallbackChannel must be one of: ${FALLBACK_CHANNELS.join(', ')}`,
        );
      data.notifyFallbackChannel = channel;
    }
    // ⚠️ At least one of EMAIL or SMS has to survive the patch, or the
    // member has silenced every way we have of telling them their order
    // shipped. NEITHER of the other two counts towards that floor:
    //   * WhatsApp carries SHIPPING UPDATES ONLY, so a member sitting on
    //     WhatsApp alone would never hear about an offer, a payment, a KYC
    //     step or a dealer hand-off — and it stays operator-gated
    //     (whatsapp_enabled) on top of that.
    //   * the fallback channel only fires when a send on an enabled channel
    //     FAILS, so it is not a channel anyone is reachable on in the normal
    //     case. It is a retry, not a subscription.
    // Setting fallbackChannel on its own therefore cannot trip the floor
    // either — it never touches the email/SMS pair, so it takes no guard.
    //
    // ⚠️ AND THE FLOOR IS ENFORCED IN THE `where`, NOT AFTER A READ. Reading
    // the row, deciding, then writing leaves a window: two tabs flipping email
    // off and SMS off at the same moment each read a legal state, both writes
    // land, and the member ends up with no channel at all — precisely the
    // outcome this guard exists to prevent. Pushing the condition into the
    // UPDATE lets Postgres settle it; the second write stops matching and
    // updateMany reports count 0.
    const FLOOR =
      'Keep either email or SMS switched on — we need one way to reach you about your orders.';

    if (Object.keys(data).length > 0) {
      // Both halves off in one body is decidable without touching the row.
      if (data.notifyEmailEnabled === false && data.notifySmsEnabled === false)
        throw new BadRequestException(FLOOR);

      // Turning ONE half off is legal only while the other half is on. As a
      // `where` that reads: match this member, but only if the channel I am
      // not touching is still enabled. A patch that sets one half true can
      // never trip the floor, so it needs no guard.
      const guard: {
        notifyEmailEnabled?: boolean;
        notifySmsEnabled?: boolean;
      } = {};
      if (data.notifyEmailEnabled === false && data.notifySmsEnabled === undefined)
        guard.notifySmsEnabled = true;
      if (data.notifySmsEnabled === false && data.notifyEmailEnabled === undefined)
        guard.notifyEmailEnabled = true;

      const { count } = await this.prisma.user.updateMany({
        where: { id: userId, ...guard },
        data,
      });
      // count 0 is ambiguous — no such member, or the guard refused. Only the
      // follow-up read can tell them apart, and it runs on the failure path
      // only, so the happy path stays at two statements.
      if (count === 0) {
        const exists = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { id: true },
        });
        if (!exists) throw new NotFoundException('User not found');
        throw new BadRequestException(FLOOR);
      }
    }

    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        notifyEmailEnabled: true,
        notifySmsEnabled: true,
        notifyWhatsappEnabled: true,
        notifyFallbackChannel: true,
      },
    });
    if (!row) throw new NotFoundException('User not found');
    return row;
  }

  // Seller default parcel size (Phase 6 P6.3). Each field is independently
  // settable; passing null clears it. Non-negative ints only.
  async updateShippingDefaults(
    userId: string,
    dims: {
      weightGrams?: number | null;
      lengthCm?: number | null;
      widthCm?: number | null;
      heightCm?: number | null;
    },
  ) {
    const clean = (v: number | null | undefined): number | null | undefined => {
      if (v === undefined) return undefined;
      if (v === null) return null;
      const n = Math.floor(Number(v));
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        defaultWeightGrams: clean(dims.weightGrams),
        defaultLengthCm: clean(dims.lengthCm),
        defaultWidthCm: clean(dims.widthCm),
        defaultHeightCm: clean(dims.heightCm),
      },
      select: {
        defaultWeightGrams: true,
        defaultLengthCm: true,
        defaultWidthCm: true,
        defaultHeightCm: true,
      },
    });
  }

  // ─────────────────── Urgent notifications summary ──────────────────
  // Extracted from users.controller.ts GET /users/me/urgent (Ask GG
  // Everywhere W5) so the controller AND the Ask GG account tools share
  // one aggregation. Four "act NOW" surfaces: KYC gate, auction wins
  // awaiting payment, accepted offers awaiting payment, sales awaiting
  // dispatch. Shape mirrors the frontend UrgentNotification type.
  async getUrgentSummary(userId: string): Promise<{
    notifications: {
      id: string;
      label: string;
      href: string;
      severity: 'info' | 'warning' | 'critical';
    }[];
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        kycStatus: true,
        kycRequiredAt: true,
        // Claude-flow partial-progress markers for the kyc-finish nudge.
        kycConsentGivenAt: true,
        kycIdVerifiedAt: true,
        kycIdDocumentUrl: true,
        kycIdStorageKey: true,
        kycSelfieUrl: true,
      },
    });
    if (!user) return { notifications: [] };

    const [winningBids, acceptedOffers, salesNeedingDispatch, listingsCount] =
      await Promise.all([
        this.prisma.bid.findMany({
          where: {
            bidderId: user.id,
            isWinner: true,
            listing: { status: 'PAYMENT_PENDING' },
          },
          select: {
            listing: {
              select: { id: true, title: true, expiresAt: true },
            },
          },
        }),
        this.prisma.offer.findMany({
          where: {
            buyerId: user.id,
            status: 'ACCEPTED',
          },
          select: {
            id: true,
            expiresAt: true,
            listing: { select: { id: true, title: true } },
          },
        }),
        this.prisma.transaction.count({
          where: {
            sellerId: user.id,
            paymentStatus: 'HELD',
            shippingStatus: 'PENDING',
          },
        }),
        this.prisma.listing.count({ where: { sellerId: user.id } }),
      ]);

    const notifications: {
      id: string;
      label: string;
      href: string;
      severity: 'info' | 'warning' | 'critical';
    }[] = [];

    // 1. KYC first — it gates the seller's payout entirely. UNDER_REVIEW
    // is suppressed: the file is with the admins, nothing to act on.
    const kycSettled =
      user.kycStatus === 'VERIFIED' || user.kycStatus === 'UNDER_REVIEW';
    if (user.kycRequiredAt && !kycSettled) {
      notifications.push({
        id: 'kyc-required',
        label: 'Verify identity to release payout',
        href: '/kyc/verify',
        severity: 'critical',
      });
    } else if (
      !kycSettled &&
      listingsCount >= 1 &&
      (user.kycConsentGivenAt ||
        user.kycIdVerifiedAt ||
        user.kycIdStorageKey ||
        user.kycIdDocumentUrl)
    ) {
      // 1b. Started-but-unfinished verification (no forcing sale yet).
      // Softer nudge so a seller who bailed mid-wizard picks it back up
      // BEFORE a sale forces it. Never shown to pure buyers, and never
      // alongside kyc-required (that branch already won above).
      notifications.push({
        id: 'kyc-finish',
        label: 'Finish your identity verification',
        href: '/kyc/verify',
        severity: 'warning',
      });
    }

    // 2. Auction wins awaiting payment.
    for (const b of winningBids) {
      if (!b.listing) continue;
      const countdown = urgentHoursLeft(b.listing.expiresAt);
      notifications.push({
        id: `auction-${b.listing.id}`,
        label: `Auction won: ${urgentTruncate(b.listing.title, 28)}${countdown}`,
        href: `/listings/${b.listing.id}`,
        severity: 'critical',
      });
    }

    // 3. Accepted offers awaiting payment.
    for (const o of acceptedOffers) {
      const countdown = urgentHoursLeft(o.expiresAt);
      notifications.push({
        id: `offer-${o.id}`,
        label: `Offer accepted: ${urgentTruncate(o.listing.title, 28)}${countdown}`,
        href: '/my/offers',
        severity: 'critical',
      });
    }

    // 4. Sales paid + waiting on seller to confirm dispatch.
    if (salesNeedingDispatch > 0) {
      notifications.push({
        id: 'dispatch-pending',
        label: `${salesNeedingDispatch} sale${salesNeedingDispatch === 1 ? '' : 's'} need dispatch`,
        href: '/my/sales',
        severity: 'warning',
      });
    }

    return { notifications };
  }

  // ─────────────────── Account summary (Account board) ────────────────
  // GET /users/me/account-summary — the one aggregate that feeds every
  // stat line on the Account hub ("3 active · 1 draft", "2 offers need
  // your answer", "1 parcel in transit", "R 12,650 paid out"). Distinct
  // from getUrgentSummary above: that one surfaces "act NOW" notification
  // pills, this one is the passive counts/totals row. Five independent
  // reads, batched via $transaction([...]) (same pattern as
  // NotificationsFeedController.activeCount) so the hot Account-hub visit
  // costs one round trip to Postgres, not five sequential ones.
  //
  // ⚠️ PAYOUT FIGURE: summed straight off Transaction.sellerPayout — the
  // column fee-presentation.ts itself reads as "what seller receives after
  // deductions" (FeeFacts.sellerPayout) and the same column
  // seller-tools.service.ts#analytics sums for its netPayoutCents KPI.
  // PaymentStatus.RELEASED already means "payout sent to seller" (see the
  // enum comment), so no separate paidOutAt filter is needed. No per-line
  // breakdown is rendered here (fee-presentation.ts's job is a receipt with
  // labelled lines) — this is one total, and a stored column summed by
  // Postgres is more honest than reconstructing it. swapId: null mirrors
  // the analytics query: swap legs carry zeroed money fields by design, so
  // this is defensive parity with existing code, not a fix for a real bug.
  //
  // Returns zeros throughout for a user with no activity (or no DB row at
  // all — a lazy-provisioning race) so the frontend never has to branch on
  // undefined.
  async getAccountSummary(userId: string): Promise<{
    listings: {
      active: number;
      draft: number;
      pendingReview: number;
      paymentPending: number;
      sold: number;
      cancelled: number;
      expired: number;
    };
    pendingOffersAsSeller: number;
    pendingBidsAsBuyer: number;
    parcelsInTransit: number;
    totalPayoutReleasedCents: number;
  }> {
    const zero = {
      listings: {
        active: 0,
        draft: 0,
        pendingReview: 0,
        paymentPending: 0,
        sold: 0,
        cancelled: 0,
        expired: 0,
      },
      pendingOffersAsSeller: 0,
      pendingBidsAsBuyer: 0,
      parcelsInTransit: 0,
      totalPayoutReleasedCents: 0,
    };

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) return zero; // no row yet — nothing to summarise

    // groupBy is kept out of the $transaction([...]) tuple below on purpose:
    // batched alongside plain count()/aggregate() calls there, TS's groupBy
    // overload resolution stops narrowing `_count` to the literal shape we
    // passed (it widens to `true | GroupByAggregateInput`, i.e. `_all`
    // becomes unreachable) — a Prisma/TS inference gap, not a behaviour
    // difference. Run concurrently via Promise.all instead: still one round
    // trip for the four batched counts plus one more alongside it, not four
    // (or six) sequential ones.
    const [listingGroups, [pendingOffersAsSeller, pendingBidsAsBuyer, parcelsInTransit, payoutAgg]] =
      await Promise.all([
        // Listing counts by status, this user as seller.
        this.prisma.listing.groupBy({
          by: ['status'],
          where: { sellerId: user.id },
          _count: { _all: true },
          orderBy: { status: 'asc' },
        }),
        this.prisma.$transaction([
          // Offers on THEIR listings still awaiting THEIR response.
          // COUNTERED is excluded on purpose — that status means the seller
          // already acted and it's the buyer's move next (OfferStatus enum).
          this.prisma.offer.count({
            where: { status: 'PENDING', listing: { sellerId: user.id } },
          }),
          // Distinct auctions they've bid on that haven't ended yet — the
          // outcome is still pending. Bid has no status column of its own
          // (isWinner is only ever set by the end-auctions cron once the
          // auction closes), so "pending" is read off the listing.
          this.prisma.listing.count({
            where: {
              listingType: 'AUCTION',
              status: 'ACTIVE',
              bids: { some: { bidderId: user.id } },
            },
          }),
          // Parcels in transit as buyer: dispatched, but not yet delivered
          // (carrier-confirmed) OR confirmed (buyer-confirmed) — the two
          // independent "done" signals on Transaction.
          this.prisma.transaction.count({
            where: {
              buyerId: user.id,
              dispatchedAt: { not: null },
              deliveredAt: null,
              confirmedDeliveryAt: null,
            },
          }),
          this.prisma.transaction.aggregate({
            where: { sellerId: user.id, paymentStatus: 'RELEASED', swapId: null },
            _sum: { sellerPayout: true },
          }),
        ]),
      ]);

    const listings = { ...zero.listings };
    for (const g of listingGroups) {
      const n = g._count._all;
      switch (g.status) {
        case 'ACTIVE':
          listings.active = n;
          break;
        case 'DRAFT':
          listings.draft = n;
          break;
        case 'PENDING_REVIEW':
          listings.pendingReview = n;
          break;
        case 'PAYMENT_PENDING':
          listings.paymentPending = n;
          break;
        case 'SOLD':
          listings.sold = n;
          break;
        case 'CANCELLED':
          listings.cancelled = n;
          break;
        case 'EXPIRED':
          listings.expired = n;
          break;
      }
    }

    return {
      listings,
      pendingOffersAsSeller,
      pendingBidsAsBuyer,
      parcelsInTransit,
      totalPayoutReleasedCents: payoutAgg._sum.sellerPayout ?? 0,
    };
  }
}

// ─────────────────── Urgent summary helpers ──────────────────────────
function urgentTruncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function urgentHoursLeft(deadline: Date | null): string {
  if (!deadline) return '';
  const ms = deadline.getTime() - Date.now();
  if (ms <= 0) return ' — expired';
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return ` — ${days}d ${hours % 24}h left`;
  }
  if (hours >= 1) return ` — ${hours}h left`;
  const mins = Math.floor(ms / 60_000);
  return ` — ${mins}m left`;
}
