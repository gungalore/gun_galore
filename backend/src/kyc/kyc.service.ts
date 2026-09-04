import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SUPPORT_EMAIL } from '../common/brand';
import {
  VerifyNowService,
  KycException,
  type CreditBalance,
  type IdBasicResult,
} from './verifynow.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SmsService } from '../sms/sms.service';
import { ActionTokensService } from '../actions/action-tokens.service';
import { SettingsService, FLAGS } from '../settings/settings.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { SecureFileStorageService } from '../common/secure-file-storage.service';
import { sniffMime } from '../common/sniff-mime';
import { ClaudeKycService, type KycClaudeFindings } from './claude-kyc.service';
import { AwsKycService, NoFaceInSelfieError } from './aws-kyc.service';
import type { AwsFindings } from './aws-kyc-findings';
import {
  ageFromSaIdNumber,
  crossCheckIdentity,
  saIdLuhnValid,
} from './kyc-cross-check';

// SHA-256 hash of a SA ID number with a per-app salt. We never store
// the raw 13-digit number — only the hash — so even if the User table
// leaks, the IDs themselves don't. The hash is deterministic so we can
// still spot collisions (same ID = same hash = duplicate detected) and
// the DB-level @unique constraint on User.kycIdHash physically refuses
// to insert a second row with the same hash.
function hashSaIdNumber(idNumber: string): string {
  const salt =
    process.env.ID_HASH_SECRET ||
    'gungalore-id-salt-v1-rotate-on-compromise';
  return createHash('sha256').update(salt + idNumber).digest('hex');
}

// Settings table key for the cached VerifyNow balance. JSON-encoded so
// we can stash both the credit count and when it was last fetched.
const CREDIT_BALANCE_SETTING_KEY = 'verifynow.balance';
// Tracks the last time we notified admins about a low credit balance,
// plus the value we saw then. Used to dedupe so the 5-min cron doesn't
// fire repeat alerts every poll while the balance stays low.
const LOW_BALANCE_NOTIFY_KEY = 'verifynow.lowBalanceNotifiedAt';
// Threshold at which we start nagging the admin to top up. Tweak in env
// (LOW_CREDIT_THRESHOLD) if 100 turns out to be the wrong wake-up line.
const LOW_BALANCE_THRESHOLD = Number(process.env.LOW_CREDIT_THRESHOLD) || 100;
// Re-alert no more than once per 24h while still below the threshold.
const LOW_BALANCE_RENOTIFY_MS = 24 * 60 * 60 * 1000;

interface LowBalanceState {
  notifiedAt: string; // ISO timestamp of last alert
  available: number; // balance when we last alerted
}

export interface CachedBalance {
  available: number;
  lastRefreshAt: string | null; // from VerifyNow (production only)
  fetchedAt: string; // when we last hit VerifyNow
}

// PORTED from the old project's kyc.service.ts with two adaptations:
//   1. Uses our SmsService + NotificationsService instead of the old
//      project's combined "notifications" service.
//   2. NEW: triggerSellerVerification(sellerId) — called from
//      TransactionsService when a buyer kicks off the first sale on an
//      unverified seller's listing. Sets kycRequiredAt, fires SMS +
//      email, and is idempotent so repeat sales don't re-notify.

@Injectable()
export class KycService {
  private readonly log = new Logger(KycService.name);
  // Damper for the kyc-claude-outage admin alert (one per 6h window).
  private lastKycOutageAlertAt = 0;

  constructor(
    private prisma: PrismaService,
    private verifyNow: VerifyNowService,
    private notifications: NotificationsService,
    private sms: SmsService,
    // @Global ActionTokensModule — used to mint the KYC_VERIFY token so
    // the "verify your identity" SMS link works without a Clerk login.
    private actionTokens: ActionTokensService,
    // Claude-flow additions (all @Global except ClaudeKycService, which
    // kyc.module.ts provides locally).
    private settings: SettingsService,
    // ⚠️ STILL HERE ONLY FOR THE BACKFILL'S SAKE. Nothing in this service
    // uploads to Cloudinary any more — identity documents and selfies go into
    // the encrypted store below. The dependency stays until the last legacy
    // URL has been moved and the columns dropped.
    private cloudinary: CloudinaryService,
    private claudeKyc: ClaudeKycService,
    private aws: AwsKycService,
    // Where identity documents actually live now. See the `kyc` namespace.
    private files: SecureFileStorageService,
  ) {}

  /**
   * Remove a member's stored identity document and selfie from disk.
   *
   * ⚠️ A PRISMA CASCADE CANNOT REACH THE FILESYSTEM, which is the same reason
   * the motivation and Licence Centre retention services are exported for the
   * deletion path. Deleting the row without this leaves two encrypted files
   * nobody has a pointer to — undeletable except by hand, and the most
   * sensitive pair we hold.
   *
   * ⚠️ FAILS SOFT AND SAYS SO. An erasure must never be blocked by a file that
   * will not unlink; the count of failures is returned so the caller can log
   * what still needs removing by hand.
   */
  async purgeKycFiles(
    userId: string,
  ): Promise<{ removed: number; failed: number }> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { kycIdStorageKey: true, kycSelfieStorageKey: true },
    });
    let removed = 0;
    let failed = 0;
    for (const key of [u?.kycIdStorageKey, u?.kycSelfieStorageKey]) {
      if (!key) continue;
      try {
        await this.files.remove(key);
        removed += 1;
      } catch (err) {
        failed += 1;
        this.log.error(
          `Erasure: could not remove KYC file ${key}: ${(err as Error).message}`,
        );
      }
    }
    return { removed, failed };
  }

  /**
   * The identity document, as bytes, wherever it happens to live.
   *
   * ⚠️ STORAGE KEY FIRST, URL SECOND, and the fallback is temporary. Rows
   * verified before the move still carry only a Cloudinary URL; once the
   * backfill has moved them the second branch is dead and the columns go.
   */
  private async readIdDocument(u: {
    kycIdStorageKey: string | null;
    kycIdMimeType: string | null;
    kycIdDocumentUrl: string | null;
  }): Promise<{ bytes: Buffer; mimeType: string } | null> {
    if (u.kycIdStorageKey) {
      try {
        const bytes = await this.files.read(u.kycIdStorageKey);
        return { bytes, mimeType: u.kycIdMimeType || sniffMime(bytes) };
      } catch (err) {
        this.log.error(
          `KYC document unreadable at ${u.kycIdStorageKey}: ${(err as Error).message}`,
        );
        return null;
      }
    }
    if (!u.kycIdDocumentUrl) return null;
    try {
      const res = await fetch(u.kycIdDocumentUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      return { bytes, mimeType: sniffMime(bytes) };
    } catch (err) {
      this.log.error(
        `Legacy KYC document fetch failed: ${(err as Error).message}`,
      );
      return null;
    }
  }

  // ─────────────────── POPIA consent ────────────────────────────────
  // Stored as a timestamp so we know when it was given (audit). Must be
  // set before any Home Affairs query — verifyId() refuses without it.
  async recordConsent(clerkId: string) {
    await this.prisma.user.update({
      where: { clerkId },
      data: { kycConsentGivenAt: new Date() },
    });
    return { success: true };
  }

  // ─────────────────── Step 1: SA ID lookup ─────────────────────────
  // Pulls official first/last name + photo from Home Affairs via
  // VerifyNow. Writes the verified names directly onto User (the seller
  // can't edit these from /profile/edit — they're locked once KYC clears).
  async verifyId(clerkId: string, idNumber: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true, kycConsentGivenAt: true },
    });

    if (!user) throw new NotFoundException('User not found');
    if (!user.kycConsentGivenAt) {
      throw new ForbiddenException(
        'POPIA consent must be given before identity verification.',
      );
    }

    // Hash the SA ID FIRST so we can refuse a duplicate before burning
    // a VerifyNow credit. We never persist the raw idNumber — only the
    // salted SHA-256 hash. If another user already has this hash on
    // their record, hard-block here: one ID = one All Outdoor account.
    const idHash = hashSaIdNumber(idNumber);
    const existing = await this.prisma.user.findUnique({
      where: { kycIdHash: idHash },
      select: { id: true },
    });
    if (existing && existing.id !== user.id) {
      throw new BadRequestException(
        'This SA ID number is already linked to another All Outdoor account. Contact support if this is an error.',
      );
    }

    let result;
    try {
      result = await this.verifyNow.verifyIdNumber(idNumber);
    } catch (err) {
      if (err instanceof KycException) {
        this.log.warn(
          `VerifyNow ID lookup failed for ${clerkId}: ${err.message}`,
        );
        throw new BadRequestException(
          'We could not verify your ID right now. Please try again in a moment.',
        );
      }
      throw err;
    }

    await this.prisma.user.update({
      where: { clerkId },
      data: {
        kycIdVerifiedAt: new Date(),
        kycStatus: 'PENDING',
        kycIdHash: idHash,
        firstName: result.firstName || undefined,
        lastName: result.surname || undefined,
      },
    });

    return {
      success: true,
      firstName: result.firstName,
      surname: result.surname,
      dob: result.dob,
    };
  }

  // ─────────────────── One-step KYC for sellers who completed profile ─
  // When the seller filled the post-publish profile modal, their SA
  // ID was AES-encrypted onto User.idNumberEncrypted. At KYC time
  // we decrypt it, run Home Affairs lookup (if not done) + the
  // facematch in one shot. The encrypted blob is RETAINED after
  // success (see Step 3 below) — as a firearms marketplace we must
  // reproduce the seller's ID on the SAP 534 form if a firearm later
  // sells, and the raw ID is only available here at submission time.
  // The seller only has to take the selfie — no re-typing the ID.
  async completeKycWithSelfie(clerkId: string, selfieBase64: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: {
        id: true,
        kycConsentGivenAt: true,
        idNumberEncrypted: true,
        kycIdVerifiedAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.kycConsentGivenAt) {
      throw new ForbiddenException(
        'POPIA consent must be given before identity verification.',
      );
    }
    if (!user.idNumberEncrypted) {
      throw new BadRequestException(
        'Complete your profile first so we have your ID on file.',
      );
    }

    let idNumber: string;
    try {
      // Inline import so we don't load the crypto module at boot when
      // not strictly required. Tiny cost on first KYC call only.
      const { decryptSaIdNumber } = await import('../common/id-crypto');
      idNumber = decryptSaIdNumber(user.idNumberEncrypted);
    } catch (err) {
      this.log.error(
        `Failed to decrypt stored SA ID for ${clerkId}: ${(err as Error).message}`,
      );
      throw new BadRequestException(
        'Could not read your saved ID. Re-enter it on your profile page.',
      );
    }

    // Step 1 — Home Affairs lookup if not already passed.
    if (!user.kycIdVerifiedAt) {
      await this.verifyId(clerkId, idNumber);
    }

    // Step 2 — facematch. submitFaceMatch handles VERIFIED stamping,
    // strike counting, and the AdminAlert on repeated failure.
    const result = await this.submitFaceMatch(clerkId, selfieBase64, idNumber);

    // Step 3 — RETAIN the encrypted SA ID after verification (we used to
    // purge it here). This is a firearms marketplace: when any of a
    // seller's firearms later sells via dealer transfer we must prefill
    // the seller's SA ID into Section C of the SAP 534 "Transfer of
    // Firearm Ownership" form. That need can arise long after KYC, and
    // the raw ID is ONLY ever available here at submission time — so we
    // cannot purge-then-recover it later (gating on "has firearm
    // listings" fails because KYC almost always precedes the first
    // firearm listing). The blob stays AES-GCM encrypted at rest and is
    // retained under the firearms-transfer regulatory-compliance basis
    // (FCA s125 / SAP 534). If POPIA minimisation later requires
    // narrowing this, re-capture the ID at firearm-listing time instead.

    return result;
  }

  // ─────────────────── Step 2: selfie face-match ────────────────────
  // The seller has just taken a selfie. We send it to VerifyNow's
  // facematch endpoint along with their ID number (re-supplied by the
  // client). Approved → kycStatus = VERIFIED + kycVerifiedAt = now,
  // a confirmation SMS + email goes out. ≥3 fails → AdminAlert raised
  // and we tell the seller to contact support.
  async submitFaceMatch(
    clerkId: string,
    selfieBase64: string,
    idNumber: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: {
        id: true,
        kycIdVerifiedAt: true,
        kycAttempts: true,
        phone: true,
        email: true,
        firstName: true,
      },
    });

    if (!user) throw new NotFoundException('User not found');

    if (!user.kycIdVerifiedAt) {
      throw new ForbiddenException('ID verification must be completed first.');
    }

    let result;
    try {
      result = await this.verifyNow.faceMatch(idNumber, selfieBase64);
    } catch (err) {
      if (err instanceof KycException) {
        this.log.warn(
          `VerifyNow face match failed for ${clerkId}: ${err.message}`,
        );
        throw new BadRequestException(
          'We could not verify your selfie right now. Please try again in a moment.',
        );
      }
      throw err;
    }

    const approved =
      result.confidenceScore >= 75 && result.matchStatus === 'Approved';

    // Guarded transition: only update if the user is still in a non-terminal
    // KYC state. Two concurrent selfie submissions would otherwise both
    // double-increment kycAttempts and double-fire the approval notifications.
    const guarded = await this.prisma.user.updateMany({
      where: {
        clerkId,
        kycStatus: { in: ['PENDING', 'REJECTED'] },
      },
      data: {
        kycAttempts: { increment: 1 },
        kycFaceMatchScore: result.confidenceScore,
        kycFaceMatchStatus: result.matchStatus,
        kycVerifyNowTransactionId: result.transactionId,
        kycStatus: approved ? 'VERIFIED' : 'REJECTED',
        kycVerifiedAt: approved ? new Date() : undefined,
      },
    });

    if (guarded.count === 0) {
      this.log.log(
        `submitFaceMatch no-op for ${clerkId} (already processed by another request)`,
      );
      return {
        success: false,
        message: 'KYC already processed. Check your account status.',
      };
    }

    // Re-read so strike-count logic and admin alert reflect the post-increment value.
    const fresh = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { kycAttempts: true },
    });
    const newAttempts = fresh?.kycAttempts ?? (user.kycAttempts ?? 0) + 1;

    if (approved) {
      // Tell the seller — they can now ship the pending sale.
      if (user.phone) {
        await this.sms.sendSms({
          to: user.phone,
          message:
            'All Outdoor: Your identity has been verified. Your pending sale can now proceed.',
          reference: `kyc-approved-${user.id}`,
        });
      }
      if (user.email) {
        await this.notifications.sellerKycApproved(
          user.email,
          user.firstName ?? 'Seller',
        );
      }
      return { success: true };
    }

    if (newAttempts >= 3) {
      await this.flagForAdminReview(user.id, clerkId, result.confidenceScore);
    }

    // Failure messaging (same content via both channels).
    const retryMessage =
      newAttempts >= 3
        ? 'Please contact support for assistance with identity verification.'
        : 'We could not verify your identity. Please ensure good lighting and your face is clearly visible, then try again.';

    if (user.phone) {
      await this.sms.sendSms({
        to: user.phone,
        message: `All Outdoor: ${retryMessage}`,
        reference: `kyc-failed-${user.id}-${newAttempts}`,
      });
    }
    if (user.email) {
      await this.notifications.sellerKycRejected(
        user.email,
        user.firstName ?? 'Seller',
        retryMessage,
      );
    }

    return { success: false, message: retryMessage };
  }

  // ─────────────────── Status poll ──────────────────────────────────
  // Extended for the Claude flow: `flow` tells the wizard which pipeline
  // to render; `steps`/`nextStep` are the server-side save-&-resume state
  // (every step persists onto User, so "continue later" is just leaving
  // and coming back — the wizard jumps to nextStep). Superset of the
  // legacy shape so old clients keep working.
  async getStatus(clerkId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: {
        kycStatus: true,
        kycVerifiedAt: true,
        kycFaceMatchScore: true,
        kycConsentGivenAt: true,
        kycIdVerifiedAt: true,
        kycRequiredAt: true,
        kycAttempts: true,
        dateOfBirth: true,
        kycIdDocumentUrl: true,
        kycIdStorageKey: true,
        kycSelfieUrl: true,
        kycSelfieStorageKey: true,
        phone: true,
      },
    });
    if (!user) return null;

    const claudeFlow = await this.settings.get(FLAGS.kycClaudeFlowEnabled);

    const steps = {
      consent: !!user.kycConsentGivenAt,
      // Legacy users may have kycIdVerifiedAt without a dateOfBirth — the
      // Claude flow re-runs Details for them (cheap: dup-hash short-circuits
      // apply and the Basic credit re-burn is a one-off).
      details: !!user.kycIdVerifiedAt && !!user.dateOfBirth,
      // Either store counts. A member part-way through when identity
      // documents moved off the CDN must not be sent back to re-upload
      // something we already hold.
      document: !!(user.kycIdStorageKey || user.kycIdDocumentUrl),
      selfie: !!(user.kycSelfieStorageKey || user.kycSelfieUrl),
    };

    let nextStep:
      | 'consent'
      | 'details'
      | 'document'
      | 'selfie'
      | 'review'
      | 'done'
      | 'failed';
    if (user.kycStatus === 'VERIFIED') nextStep = 'done';
    else if (user.kycStatus === 'UNDER_REVIEW') nextStep = 'review';
    else if (user.kycStatus === 'REJECTED' && user.kycAttempts >= 3)
      nextStep = 'failed';
    else if (!steps.consent) nextStep = 'consent';
    else if (!steps.details) nextStep = 'details';
    else if (!steps.document) nextStep = 'document';
    else nextStep = 'selfie';

    const { phone, dateOfBirth, kycIdDocumentUrl, kycSelfieUrl, ...legacy } =
      user;
    void dateOfBirth;
    void kycIdDocumentUrl;
    void kycSelfieUrl;
    return {
      ...legacy,
      flow: claudeFlow ? ('CLAUDE' as const) : ('VERIFYNOW' as const),
      steps,
      nextStep,
      phoneMasked: phone ? `•••${phone.slice(-4)}` : null,
    };
  }

  // ═══════════════════ Claude-vision KYC flow ════════════════════════
  // kyc_claude_flow_enabled: ID document upload + live selfie judged by
  // Claude vision; VerifyNow only runs the 1-credit SA ID (Basic) record
  // check. See claude-kyc.service.ts + kyc-cross-check.ts for the verdict
  // mechanics. All endpoints throw when the flag is off so the legacy
  // pipeline stays the single source of truth until rollout.

  private async assertClaudeFlow(): Promise<void> {
    const on = await this.settings.get(FLAGS.kycClaudeFlowEnabled);
    if (!on) {
      throw new BadRequestException(
        'This verification method is not available.',
      );
    }
  }

  // ── Step 2: Details (SA ID number + date of birth) ─────────────────
  // DELIBERATELY does NOT validate the DOB against the ID number's YYMMDD
  // prefix — that silent cross-check happens only at verdict time so a
  // faker typing a borrowed ID number isn't coached into fixing the DOB.
  // Luhn (typo) validation IS surfaced: it reveals nothing about the DOB
  // linkage and saves a VerifyNow credit on fat-fingered numbers.
  async submitDetails(clerkId: string, idNumber: string, dob: string) {
    await this.assertClaudeFlow();

    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true, kycConsentGivenAt: true, idNumberEncrypted: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.kycConsentGivenAt) {
      throw new ForbiddenException(
        'POPIA consent must be given before identity verification.',
      );
    }

    if (!saIdLuhnValid(idNumber)) {
      throw new BadRequestException(
        'That does not look like a valid SA ID number — please check it and try again.',
      );
    }
    // 18+ gate (safe to surface — unrelated to the ID-digit linkage).
    const dobDate = new Date(`${dob}T00:00:00Z`);
    if (Number.isNaN(dobDate.getTime())) {
      throw new BadRequestException('Please enter a valid date of birth.');
    }
    const age =
      (Date.now() - dobDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (age < 18) {
      throw new BadRequestException(
        'You must be at least 18 to sell on All Outdoor.',
      );
    }

    // Dup-check BEFORE burning the VerifyNow credit (one ID = one account).
    const idHash = hashSaIdNumber(idNumber);
    const existing = await this.prisma.user.findUnique({
      where: { kycIdHash: idHash },
      select: { id: true },
    });
    if (existing && existing.id !== user.id) {
      throw new BadRequestException(
        'This SA ID number is already linked to another All Outdoor account. Contact support if this is an error.',
      );
    }

    let result: IdBasicResult;
    try {
      result = await this.verifyNow.verifyIdBasic(idNumber);
    } catch (err) {
      if (err instanceof KycException) {
        this.log.warn(
          `VerifyNow SA ID Basic failed for ${clerkId}: ${err.message}`,
        );
        throw new BadRequestException(
          'We could not verify your ID right now. Please try again in a moment.',
        );
      }
      throw err;
    }

    // Encrypt-at-rest copy of the raw ID for SAP 534 prefill + the
    // verdict-time cross-check (only written if the profile modal hasn't
    // already stored one).
    let idNumberEncrypted: string | undefined;
    if (!user.idNumberEncrypted) {
      try {
        const { encryptSaIdNumber } = await import('../common/id-crypto');
        idNumberEncrypted = encryptSaIdNumber(idNumber);
      } catch (err) {
        this.log.error(
          `Failed to encrypt SA ID for ${clerkId}: ${(err as Error).message}`,
        );
      }
    }

    await this.prisma.user.update({
      where: { clerkId },
      data: {
        kycIdVerifiedAt: new Date(),
        kycStatus: 'PENDING',
        kycIdHash: idHash,
        kycMethod: 'CLAUDE',
        dateOfBirth: dob,
        firstName: result.firstName || undefined,
        lastName: result.surname || undefined,
        kycHaCheckJson: {
          firstName: result.firstName,
          surname: result.surname,
          dob: result.dob,
          gender: result.gender,
          transactionId: result.transactionId,
        } as Prisma.InputJsonValue,
        ...(idNumberEncrypted ? { idNumberEncrypted } : {}),
      },
    });

    // NB: never return the HA dob to the client — it would leak the very
    // value the silent cross-check compares against.
    return { success: true, firstName: result.firstName, surname: result.surname };
  }

  // ── Step 3: ID document upload ──────────────────────────────────────
  async submitIdDocument(clerkId: string, file: Express.Multer.File) {
    await this.assertClaudeFlow();

    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true, kycIdVerifiedAt: true, dateOfBirth: true, kycStatus: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.kycIdVerifiedAt || !user.dateOfBirth) {
      throw new ForbiddenException('Complete your details first.');
    }
    if (user.kycStatus === 'VERIFIED' || user.kycStatus === 'UNDER_REVIEW') {
      throw new BadRequestException('Your verification is already in progress.');
    }

    // PDF by declared type OR magic bytes (extension lies happen).
    const isPdf =
      file.mimetype === 'application/pdf' ||
      file.buffer.subarray(0, 5).toString('latin1') === '%PDF-';

    // ⚠️ THE ENCRYPTED STORE, NOT CLOUDINARY. These went up with Cloudinary's
    // defaults — no `type: 'private'`, no access_mode — so the resulting
    // secure_url was world-readable, and the operator's own decision to RETAIN
    // the document after verification turned a momentary exposure into a
    // permanent one. Operator, 2026-08-22: "remove the ID from cloudinary and
    // save it in the document centre."
    //
    // Same store, same key and same posture as every other document a member
    // gives us, reachable only through an authenticated route.
    const stored = await this.files.write('kyc', file.buffer, new Date());

    await this.prisma.user.update({
      where: { clerkId },
      data: {
        kycIdStorageKey: stored.storageKey,
        // Read from the bytes, not from the declared type: the upload path
        // above already distrusts file.mimetype enough to sniff for %PDF-.
        kycIdMimeType: isPdf ? 'application/pdf' : sniffMime(file.buffer),
        // A re-upload replaces a legacy CDN copy. Leaving the URL behind would
        // keep serving the old document from a public link forever.
        kycIdDocumentUrl: null,
      },
    });

    return { success: true };
  }

  // ── Step 4: live selfie → the one vision verdict ────────────────────
  /**
   * Open an AWS Face Liveness session for a seller who is mid-verification.
   *
   * The region goes back with it because Amplify's FaceLivenessDetector
   * needs to talk to the SAME region the session was created in, and
   * hard-coding it in the frontend is how the two drift apart.
   */
  async createLivenessSession(clerkId: string) {
    await this.assertClaudeFlow();
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { kycStatus: true, kycIdVerifiedAt: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.kycIdVerifiedAt) {
      throw new ForbiddenException(
        'Complete your details and ID document upload first.',
      );
    }
    if (user.kycStatus === 'VERIFIED' || user.kycStatus === 'UNDER_REVIEW') {
      throw new BadRequestException('Your verification is already in progress.');
    }
    const sessionId = await this.aws.createLivenessSession();
    return { sessionId, region: process.env.AWS_REGION || 'eu-west-1' };
  }
  async submitSelfieClaudeVerdict(
    clerkId: string,
    selfieBase64: string,
    livenessSessionId?: string,
  ) {
    await this.assertClaudeFlow();

    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: {
        id: true,
        kycIdVerifiedAt: true,
        dateOfBirth: true,
        kycIdDocumentUrl: true,
        kycIdStorageKey: true,
        kycIdMimeType: true,
        kycStatus: true,
        kycAttempts: true,
        idNumberEncrypted: true,
        kycHaCheckJson: true,
        phone: true,
        email: true,
        firstName: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    if (
      !user.kycIdVerifiedAt ||
      !user.dateOfBirth ||
      !(user.kycIdStorageKey || user.kycIdDocumentUrl)
    ) {
      throw new ForbiddenException(
        'Complete your details and ID document upload first.',
      );
    }
    if (user.kycStatus === 'VERIFIED' || user.kycStatus === 'UNDER_REVIEW') {
      throw new BadRequestException('Your verification is already in progress.');
    }

    // Persist the selfie first (audit trail + admin review + the silent
    // anchored upgrade later reuses it).
    // ⚠️ AND THE SELFIE TOO, for the same reason and by the same route. A
    // world-readable photograph of somebody's face, paired with a
    // world-readable copy of their ID, is the pair — fixing one and leaving
    // the other would be most of the exposure with none of the reassurance.
    const selfieStored = await this.files.write(
      'kyc',
      Buffer.from(selfieBase64, 'base64'),
      new Date(),
    );

    // Decrypt the entered ID for the server-side cross-check.
    let idNumber: string;
    try {
      const { decryptSaIdNumber } = await import('../common/id-crypto');
      idNumber = decryptSaIdNumber(user.idNumberEncrypted ?? '');
    } catch (err) {
      this.log.error(
        `Verdict: failed to decrypt SA ID for ${clerkId}: ${(err as Error).message}`,
      );
      throw new BadRequestException(
        'Could not read your saved ID. Please restart verification.',
      );
    }

    // Tier is resolved server-side and is invisible to the seller: high-
    // value sellers additionally get the official Home Affairs photo
    // pulled and matched (the "anchored" gate).
    const tier = await this.resolveKycTier(user.id);
    let haPhotoBase64: string | undefined;
    if (tier === 'ANCHORED') {
      try {
        const anchored = await this.verifyNow.verifyIdNumber(idNumber);
        haPhotoBase64 = anchored.idPhotoBase64 || undefined;
      } catch (err) {
        // No HA photo → we can't run the anchored gate. Do NOT silently
        // downgrade a high-value seller to the cheap gate — park for a
        // human instead.
        this.log.warn(
          `Anchored HA photo pull failed for ${clerkId}: ${(err as Error).message}`,
        );
      }
    }

    // THE DOCUMENT, AS BYTES. It used to be handed to Claude as a URL for
    // images and fetched only for PDFs — which worked because the URL was
    // public, and stops working the moment it is not. Both paths now read the
    // bytes and send them inline.
    const doc = await this.readIdDocument(user);
    const isPdfDoc = doc?.mimeType === 'application/pdf';

    const mode: 'standard' | 'anchored' =
      tier === 'ANCHORED' && haPhotoBase64 ? 'anchored' : 'standard';

    // Vision scan — failure NEVER auto-verifies or auto-rejects.
    let findings: AwsFindings | null = null;
    // Kept at 0 and still persisted: the best-of-3 consensus pass belonged
    // to the Claude flow and has no analogue in AWS, which returns one
    // deterministic reading. Dropping the field would silently change the
    // shape of every stored dossier, including the historical ones an
    // admin may still open.
    const consensusSamples = 0;
    try {
      // ⚠️ NO BYTES MEANS NO SCAN, EVER. A missing document must reach the
      // catch below and park the member for a human — never fall through to a
      // scan with nothing to look at.
      if (!doc) throw new Error('ID document bytes unavailable');
      // The synchronous Textract API takes images, not PDFs. Throwing
      // parks the seller for a human, which is the correct outcome while
      // the asynchronous S3 path is unbuilt — it is not a claim that PDF
      // identity documents are handled.
      if (isPdfDoc) {
        throw new Error(
          'PDF identity documents are not supported by the synchronous Textract path',
        );
      }

      findings = await this.aws.scan({
        documentBytes: doc.bytes,
        selfieBase64,
        haPhotoBase64,
        livenessSessionId,
      });
      if (!findings.provenance?.livenessRan) {
        this.log.warn(
          `KYC for ${clerkId} ran WITHOUT a completed liveness challenge — anti-spoofing unchecked, verdict cannot auto-approve`,
        );
      }
    } catch (err) {
      // A selfie with no detectable face is a camera problem, not a
      // verdict: no strike, no alert, no status write. Mirrors the RETAKE
      // early-return further down.
      if (err instanceof NoFaceInSelfieError) {
        this.log.log(
          `KYC selfie unusable for ${clerkId} — no face detected (no strike)`,
        );
        return {
          success: false,
          outcome: 'RETAKE' as const,
          status: user.kycStatus,
          message:
            'We could not find a face in your selfie. Please make sure your whole face is in frame, well lit and not covered, then try again.',
        };
      }
      this.log.error(
        `AWS KYC scan failed for ${clerkId}: ${(err as Error).message}`,
      );
      // Outage signal (audit fix 2026-07-20): a dead API silently parks
      // every KYC check in UNDER_REVIEW — surface it so the operator
      // notices the outage, not just the growing review queue. Damped to
      // one alert per 6h; best-effort.
      const now = Date.now();
      if (now - this.lastKycOutageAlertAt > 6 * 60 * 60 * 1000) {
        this.lastKycOutageAlertAt = now;
        void this.prisma.adminAlert
          .create({
            data: {
              type: 'kyc-claude-outage',
              urgent: true,
              context:
                `Claude KYC scans are failing (${(err as Error).message.slice(0, 160)}). ` +
                `New verifications are parking in UNDER_REVIEW — check the Anthropic API on /admin/health.`,
            },
          })
          .catch(() => undefined);
      }
    }

    const ha = (user.kycHaCheckJson ?? {}) as {
      firstName?: string;
      surname?: string;
      dob?: string;
    };
    const crossCheck = crossCheckIdentity({
      enteredIdNumber: idNumber,
      enteredDob: user.dateOfBirth,
      doc: {
        idNumber: findings?.document?.extracted_id_number ?? null,
        surname: findings?.document?.extracted_surname ?? null,
        names: findings?.document?.extracted_names ?? null,
        dob: findings?.document?.extracted_dob ?? null,
        legibility: findings?.document?.legibility ?? 0,
      },
      ha: {
        firstName: ha.firstName ?? '',
        surname: ha.surname ?? '',
        dob: ha.dob ?? '',
      },
    });

    // Verdict: hard cross-check lies reject even without Claude; a missing
    // scan otherwise parks for a human; anchored sellers whose HA photo
    // pull failed also park (never silently downgraded).
    let status: 'VERIFIED' | 'REJECTED' | 'UNDER_REVIEW' | 'RETAKE';
    if (crossCheck.hardFails.length > 0) {
      status = 'REJECTED';
    } else if (!findings || (tier === 'ANCHORED' && mode === 'standard')) {
      status = 'UNDER_REVIEW';
    } else {
      status = this.claudeKyc.statusFromFindings(
        findings,
        crossCheck,
        mode,
        // Lets the verdict relax the face-match reject floor when the
        // reference photo is old — a green book photo can be 25+ years old
        // and there is no fresher official image in SA to fall back on.
        ageFromSaIdNumber(idNumber) ?? undefined,
      );
    }

    // RETAKE — the images were too poor to read, with nothing pointing at
    // the wrong person or a forged document. That is a camera problem, so
    // it must not look like a verdict: no attempt increment (no march
    // toward the 3-strike escalation), no failure SMS, no admin alert, and
    // kycStatus is left exactly as it was so the wizard stays open and the
    // seller can simply try again. Returning early is what keeps all of
    // that from happening — everything below this point is verdict
    // machinery. The selfie is deliberately not persisted either: it is not
    // evidence of anything and the next attempt supersedes it.
    if (status === 'RETAKE') {
      if (findings) {
        this.log.log(
          `KYC retake requested for ${clerkId} — capture quality too low to judge (no strike)`,
        );
        return {
          success: false,
          // ⚠️ RETAKE IS NOT A FAILURE, AND THE CLIENT CANNOT INFER THAT.
          // `status` here is the seller's EXISTING status, deliberately
          // left untouched — so it is indistinguishable from any other
          // mid-flow state. Without this field the wizard read a retake as
          // a rejection, showed the "email support" screen and burned one
          // of its three local attempts, for a photo the server never
          // counted against anyone.
          outcome: 'RETAKE' as const,
          status: user.kycStatus,
          message: this.claudeKyc.retakeReason(findings),
        };
      }
      // Unreachable: statusFromFindings is only consulted when findings
      // exist. Kept so RETAKE can never fall through to the kycStatus write
      // below — it is not a member of the KycStatus enum, and a future edit
      // that breaks that invariant should park the seller for a human
      // rather than throw a Prisma error at them mid-verification.
      status = 'UNDER_REVIEW';
    }

    const persistedFindings = {
      ...(findings ?? { scanFailed: true }),
      crossCheck: {
        hardFails: crossCheck.hardFails,
        softFails: crossCheck.softFails,
      },
      tier,
      mode,
      consensusSamples,
    } as unknown as Prisma.InputJsonValue;

    // Guarded transition — mirrors submitFaceMatch so two concurrent
    // submissions can't double-increment attempts or double-notify.
    const guarded = await this.prisma.user.updateMany({
      where: { clerkId, kycStatus: { in: ['PENDING', 'REJECTED'] } },
      data: {
        kycAttempts: { increment: 1 },
        kycStatus: status,
        kycVerifiedAt: status === 'VERIFIED' ? new Date() : undefined,
        kycSelfieStorageKey: selfieStored.storageKey,
        kycSelfieUrl: null,
        kycClaudeFindings: persistedFindings,
        kycTier: tier,
      },
    });
    if (guarded.count === 0) {
      this.log.log(
        `submitSelfieClaudeVerdict no-op for ${clerkId} (already processed)`,
      );
      return {
        success: false,
        outcome: 'ALREADY_PROCESSED' as const,
        status: user.kycStatus,
        message: 'KYC already processed. Check your account status.',
      };
    }

    if (status === 'VERIFIED') {
      if (user.phone) {
        await this.sms.sendSms({
          to: user.phone,
          message:
            'All Outdoor: Your identity has been verified. Your pending sale can now proceed.',
          reference: `kyc-approved-${user.id}`,
        });
      }
      if (user.email) {
        await this.notifications.sellerKycApproved(
          user.email,
          user.firstName ?? 'Seller',
        );
      }
      return {
        success: true,
        outcome: 'VERIFIED' as const,
        status,
        message: 'Identity verified.',
      };
    }

    if (status === 'UNDER_REVIEW') {
      // No strike, no failure SMS — nothing more is needed from the
      // seller; a human decides from the admin dossier.
      try {
        await this.prisma.adminAlert.create({
          data: {
            type: 'KYC_REVIEW',
            referenceId: user.id,
            context: `Claude KYC inconclusive for ${user.firstName ?? clerkId} — review the ID document + selfie in the user dossier and approve/reject.`,
            urgent: true,
          },
        });
      } catch (err) {
        this.log.error('Failed to create KYC_REVIEW alert', err);
      }
      return {
        success: true,
        outcome: 'UNDER_REVIEW' as const,
        status,
        message:
          'Your verification is being reviewed — nothing more is needed from you. We will SMS you when it is done.',
      };
    }

    // REJECTED — reuse the legacy strike/messaging ladder. The copy stays
    // GENERIC on purpose: never name the DOB cross-check as the reason.
    const fresh = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { kycAttempts: true },
    });
    const newAttempts = fresh?.kycAttempts ?? (user.kycAttempts ?? 0) + 1;
    if (newAttempts >= 3) {
      await this.flagForAdminReview(user.id, clerkId, 0);
    }
    // A sub-50 Claude verdict (or a hard cross-check fail) is a confident
    // rejection — the 50-69 band already routes borderline cases to a human,
    // so we don't loop these through retries; we point them to support. Copy
    // stays generic (never names the DOB cross-check).
    const supportEmail = process.env.SUPPORT_EMAIL ?? SUPPORT_EMAIL;
    const retryMessage = `We couldn't verify your identity from the document and selfie you provided. Please email ${supportEmail} and our team will help you get verified.`;
    if (user.phone) {
      await this.sms.sendSms({
        to: user.phone,
        message: `All Outdoor: ${retryMessage}`,
        reference: `kyc-failed-${user.id}-${newAttempts}`,
      });
    }
    if (user.email) {
      await this.notifications.sellerKycRejected(
        user.email,
        user.firstName ?? 'Seller',
        retryMessage,
      );
    }
    return {
      success: false,
      outcome: 'REJECTED' as const,
      status,
      message: retryMessage,
    };
  }

  // ── "SMS me the link" phone handoff ─────────────────────────────────
  // Desktop sellers without a webcam scan the QR — but a good portion of
  // sellers are not QR-literate, so this sends the same token link by SMS.
  // Service-side cap (3/hour) because the IP-keyed throttler doesn't stop
  // a single user hammering mint.
  async sendHandoffSms(clerkId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true, phone: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.phone) {
      throw new BadRequestException(
        'No phone number on file — add one on your profile first.',
      );
    }

    const recentMints = await this.prisma.actionToken.count({
      where: {
        purpose: 'KYC_VERIFY',
        authorisedUserId: user.id,
        createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });
    if (recentMints >= 3) {
      throw new BadRequestException(
        'Too many links requested — use the most recent SMS, or try again in an hour.',
      );
    }

    const appUrl = process.env.FRONTEND_URL ?? 'https://gungalore.co.za';
    const token = await this.actionTokens.mint({
      purpose: 'KYC_VERIFY',
      targetType: 'user',
      targetId: user.id,
      authorisedUserId: user.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    await this.sms.sendSms({
      to: user.phone,
      message: `All Outdoor: Continue your identity verification on your phone: ${appUrl}/a/${token}`,
      reference: `kyc-handoff-${user.id}`,
    });

    return { sent: true, phoneMasked: `•••${user.phone.slice(-4)}` };
  }

  // ── Value tier (invisible to the seller) ────────────────────────────
  // ANCHORED when the seller's highest active listing or pending-payout
  // sale is at/above kyc_anchored_threshold_cents — those sellers get the
  // official Home Affairs photo pulled (10cr) and matched, because the
  // uploaded-document reference is forgeable and high-value fraud is
  // where that matters.
  async resolveKycTier(userId: string): Promise<'STANDARD' | 'ANCHORED'> {
    const threshold = await this.settings.get(FLAGS.kycAnchoredThresholdCents);
    if (threshold <= 0) return 'ANCHORED'; // 0 = anchor everyone

    const [maxListing, maxPendingSale] = await Promise.all([
      this.prisma.listing.aggregate({
        where: { sellerId: userId, status: 'ACTIVE', price: { not: null } },
        _max: { price: true },
      }),
      this.prisma.transaction.findFirst({
        where: {
          listing: { sellerId: userId },
          paymentStatus: { in: ['HELD', 'RELEASED'] },
          paidOutAt: null,
          refundOfId: null,
        },
        orderBy: { listing: { price: 'desc' } },
        select: { listing: { select: { price: true } } },
      }),
    ]);

    const top = Math.max(
      maxListing._max.price ?? 0,
      maxPendingSale?.listing?.price ?? 0,
    );
    return top >= threshold ? 'ANCHORED' : 'STANDARD';
  }

  // ── Silent tier upgrade ─────────────────────────────────────────────
  // Called (fire-and-forget) from the first-payment hook when a sale at/
  // above the threshold lands on a seller who was VERIFIED on the cheap
  // STANDARD tier. Re-runs the anchored gate against the STORED selfie —
  // zero user interaction. Pass → tier bumped silently. Fail or
  // inconclusive → VERIFIED flips to UNDER_REVIEW (payout auto-holds via
  // the existing gates) + admins alerted. The seller only ever notices if
  // something is actually wrong.
  async maybeUpgradeKycTier(
    sellerId: string,
    salePriceCents: number,
  ): Promise<void> {
    try {
      const claudeFlow = await this.settings.get(FLAGS.kycClaudeFlowEnabled);
      if (!claudeFlow) return;
      const threshold = await this.settings.get(
        FLAGS.kycAnchoredThresholdCents,
      );
      if (threshold <= 0 || salePriceCents < threshold) return;

      const seller = await this.prisma.user.findUnique({
        where: { id: sellerId },
        select: {
          id: true,
          clerkId: true,
          kycStatus: true,
          kycTier: true,
          kycMethod: true,
          kycSelfieUrl: true,
          kycSelfieStorageKey: true,
          kycIdDocumentUrl: true,
          kycIdStorageKey: true,
          kycIdMimeType: true,
          idNumberEncrypted: true,
          firstName: true,
        },
      });
      if (
        !seller ||
        seller.kycStatus !== 'VERIFIED' ||
        seller.kycMethod !== 'CLAUDE' ||
        seller.kycTier !== 'STANDARD' ||
        !(seller.kycSelfieStorageKey || seller.kycSelfieUrl) ||
        !seller.idNumberEncrypted
      ) {
        return;
      }

      const { decryptSaIdNumber } = await import('../common/id-crypto');
      const idNumber = decryptSaIdNumber(seller.idNumberEncrypted);

      // Pull the official photo + refetch the stored selfie.
      const anchored = await this.verifyNow.verifyIdNumber(idNumber);
      if (!anchored.idPhotoBase64) throw new Error('No HA photo returned');
      // Storage key first, legacy URL second — the same order as everywhere
      // else, and the second branch dies with the backfill.
      let selfieBytes: Buffer;
      if (seller.kycSelfieStorageKey) {
        selfieBytes = await this.files.read(seller.kycSelfieStorageKey);
      } else {
        const selfieRes = await fetch(seller.kycSelfieUrl!);
        if (!selfieRes.ok) {
          throw new Error(`selfie fetch HTTP ${selfieRes.status}`);
        }
        selfieBytes = Buffer.from(await selfieRes.arrayBuffer());
      }

      const doc = await this.readIdDocument(seller);
      if (!doc) throw new Error('ID document bytes unavailable');

      // Same seam as the interactive verdict. No liveness session exists
      // here — this is a background re-check of a selfie captured weeks
      // ago — but that costs nothing on this path: it reads ONLY the
      // Home Affairs comparison below, and its failure branch parks the
      // seller for a human rather than approving anything.
      const findings = await this.aws.scan({
        documentBytes: doc.bytes,
        selfieBase64: selfieBytes.toString('base64'),
        haPhotoBase64: anchored.idPhotoBase64,
      });

      // Same 70% pass bar as the interactive flow (AUTO_APPROVE_FLOOR).
      const anchorScore = findings.face_match?.same_person_vs_ha_photo ?? 0;
      if (anchorScore >= 70) {
        await this.prisma.user.update({
          where: { id: seller.id },
          data: { kycTier: 'ANCHORED' },
        });
        this.log.log(`KYC tier silently upgraded to ANCHORED for ${seller.id}`);
        return;
      }

      // Anchored gate failed or inconclusive — hold payout, human decides.
      await this.prisma.user.updateMany({
        where: { id: seller.id, kycStatus: 'VERIFIED' },
        data: {
          kycStatus: 'UNDER_REVIEW',
          kycClaudeFindings: {
            ...findings,
            upgradeCheck: true,
            anchorScore,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      await this.prisma.adminAlert.create({
        data: {
          type: 'KYC_REVIEW',
          referenceId: seller.id,
          context: `High-value sale (R${(salePriceCents / 100).toFixed(0)}) triggered an anchored identity re-check for ${seller.firstName ?? seller.id} and the official-photo match scored ${anchorScore}. Payout is held — review in the user dossier.`,
          urgent: true,
        },
      });
      this.log.warn(
        `KYC anchored upgrade FAILED for ${seller.id} (score ${anchorScore}) — flipped to UNDER_REVIEW`,
      );
    } catch (err) {
      // Never break the payment path over an upgrade check; leave the
      // seller on STANDARD and let the next qualifying sale retry.
      this.log.warn(
        `maybeUpgradeKycTier failed for ${sellerId}: ${(err as Error).message}`,
      );
    }
  }

  // ─────────────────── Trigger: first sale forces verification ──────
  // Called from TransactionsService.create() when a buyer kicks off a
  // purchase on an unverified seller's listing. Idempotent — if
  // kycRequiredAt is already set (or seller is already VERIFIED), this
  // is a no-op, so repeat sales don't spam notifications.
  //
  // Failure-mode: notification sends fail open. We never block the
  // buyer's checkout because of an SMS hiccup.
  async triggerSellerVerification(sellerId: string): Promise<void> {
    const seller = await this.prisma.user.findUnique({
      where: { id: sellerId },
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        kycStatus: true,
        kycRequiredAt: true,
      },
    });
    if (!seller) {
      this.log.warn(
        `triggerSellerVerification called with unknown sellerId ${sellerId}`,
      );
      return;
    }
    if (seller.kycStatus === 'VERIFIED') return;
    // UNDER_REVIEW = the file is with the admins — nothing for the seller
    // to do, so a "verify your identity" SMS would only confuse them.
    if (seller.kycStatus === 'UNDER_REVIEW') return;
    if (seller.kycRequiredAt) return; // already notified — banner is up

    // Mark the deadline so the in-app banner shows on next login.
    await this.prisma.user.update({
      where: { id: seller.id },
      data: { kycRequiredAt: new Date() },
    });

    // Mint a KYC_VERIFY token so the SMS link works without a Clerk
    // login (the SMS opens in the phone's default browser, which has no
    // PWA session). 7-day TTL. If minting fails we fall back to the bare
    // /kyc/verify URL (login-gated) rather than dropping the SMS.
    const appUrl = process.env.FRONTEND_URL ?? 'https://gungalore.co.za';
    let kycUrl = `${appUrl}/kyc/verify`;
    try {
      const kycToken = await this.actionTokens.mint({
        purpose: 'KYC_VERIFY',
        targetType: 'user',
        targetId: seller.id,
        authorisedUserId: seller.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      kycUrl = `${appUrl}/a/${kycToken}`;
    } catch (mintErr) {
      this.log.warn(
        `KYC_VERIFY token mint failed for ${seller.id}; using login-gated link: ${(mintErr as Error).message}`,
      );
    }

    try {
      if (seller.phone) {
        await this.sms.sendSms({
          to: seller.phone,
          message: `All Outdoor: You have a pending sale. Verify your identity to release the payout: ${kycUrl}`,
          reference: `kyc-required-${seller.id}`,
        });
      }
      if (seller.email) {
        await this.notifications.sellerKycRequired(
          seller.email,
          seller.firstName ?? 'Seller',
        );
      }
    } catch (err) {
      this.log.warn(
        `KYC required notifications failed for ${seller.id}: ${(err as Error).message}`,
      );
    }
  }

  // ─────────────────── Admin alert on repeated failure ──────────────
  private async flagForAdminReview(
    userId: string,
    clerkId: string,
    score: number,
  ) {
    try {
      await this.prisma.adminAlert.create({
        data: {
          type: 'KYC_REPEATED_FAILURE',
          referenceId: userId,
          context: `KYC face match failed 3+ times for user ${clerkId}. Last score: ${score}`,
          urgent: false,
        },
      });
    } catch (err) {
      this.log.error('Failed to create admin KYC alert', err);
    }
  }

  // ─────────────────── VerifyNow credit balance ─────────────────────
  // Cached in the Settings table (key: verifynow.balance, JSON-encoded).
  // The 5-min cron in TasksService keeps it fresh; admins can also force
  // a refresh from the panel. The /my_credits endpoint doesn't burn a
  // credit itself so polling is free.
  //
  // VerifyNow doesn't expose a "buy credits" API — the admin UI surfaces
  // a deep-link to verifynow.co.za's billing page instead.

  /** Read the cached balance from Settings. Returns null if never fetched. */
  async getCachedCreditBalance(): Promise<CachedBalance | null> {
    const row = await this.prisma.setting.findUnique({
      where: { key: CREDIT_BALANCE_SETTING_KEY },
    });
    if (!row) return null;
    try {
      return JSON.parse(row.value) as CachedBalance;
    } catch {
      this.log.warn('Stale verifynow.balance setting could not be parsed');
      return null;
    }
  }

  /**
   * Hit VerifyNow and write the result into Settings. Returns the new
   * cached value. Called by the cron + by the admin "refresh now" button.
   * Throws if VerifyNow can't be reached so the admin sees an error
   * banner instead of a silently-stale balance.
   */
  async refreshCreditBalance(): Promise<CachedBalance> {
    let live: CreditBalance;
    try {
      live = await this.verifyNow.getCreditBalance();
    } catch (err) {
      if (err instanceof KycException) {
        this.log.warn(
          `VerifyNow credit balance refresh failed: ${err.message}`,
        );
        throw new BadRequestException(
          'Could not refresh VerifyNow credit balance. Try again shortly.',
        );
      }
      throw err;
    }
    const cached: CachedBalance = {
      available: live.available,
      lastRefreshAt: live.lastRefreshAt,
      fetchedAt: new Date().toISOString(),
    };
    await this.prisma.setting.upsert({
      where: { key: CREDIT_BALANCE_SETTING_KEY },
      create: { key: CREDIT_BALANCE_SETTING_KEY, value: JSON.stringify(cached) },
      update: { value: JSON.stringify(cached) },
    });

    // NO ALERT FROM HERE ANY MORE.
    //
    // The credit-poll cron (TasksService.checkCreditThreshold) already alerts
    // on VerifyNow, from the CreditThreshold table, with operator-tunable
    // warn/alarm levels and edge-triggered dedup. This method was a second,
    // older, VerifyNow-only path with its own threshold and its own 24h timer,
    // so a single low balance produced alerts from two systems that knew
    // nothing about each other — the operator got told the same fact twice
    // over on different schedules.
    //
    // maybeAlertLowBalance is kept below (unused by this path) because it is
    // still the only thing that clears the stale dedup flag; deleting it
    // outright would strand that key. Refreshing the cache is now all this
    // does, which is what the callers actually want from it.

    return cached;
  }

  // ─────────────────── Low-balance alert (dedup'd) ──────────────────
  // Called from refreshCreditBalance() with the freshly-polled value.
  // We notify every active admin (SMS via SmsService, email via
  // NotificationsService) only when:
  //   1. balance < threshold (100 by default), AND
  //   2. we haven't already alerted in the past 24h with the same or
  //      lower number (so a quick top-up + drop doesn't get spammed).
  // When the balance climbs back above the threshold we clear the
  // dedup flag so the next dip triggers a fresh alert.
  //
  // Admin contact info comes from Clerk-linked User rows (clerkId on
  // AdminUser → User.phone / User.email). The admin's own email on
  // AdminUser is the fallback when no User row is linked yet.
  private async maybeAlertLowBalance(available: number): Promise<void> {
    if (available >= LOW_BALANCE_THRESHOLD) {
      // Balance is healthy — clear any stale dedup flag so a future dip
      // alerts again right away.
      const stale = await this.prisma.setting.findUnique({
        where: { key: LOW_BALANCE_NOTIFY_KEY },
      });
      if (stale) {
        await this.prisma.setting.delete({
          where: { key: LOW_BALANCE_NOTIFY_KEY },
        });
      }
      return;
    }

    // Below threshold — check dedup.
    const last = await this.prisma.setting.findUnique({
      where: { key: LOW_BALANCE_NOTIFY_KEY },
    });
    if (last) {
      try {
        const state = JSON.parse(last.value) as LowBalanceState;
        const age = Date.now() - new Date(state.notifiedAt).getTime();
        if (age < LOW_BALANCE_RENOTIFY_MS) return; // already alerted recently
      } catch {
        // Stale/unparseable row — fall through and re-alert.
      }
    }

    const admins = await this.prisma.adminUser.findMany({
      where: { isActive: true },
      select: { id: true, clerkId: true, email: true, firstName: true },
    });

    // Pull each admin's User row (when linked) so we can SMS the phone
    // stored there. We batch into a single IN-query to avoid N+1.
    const clerkIds = admins.map((a) => a.clerkId).filter(Boolean) as string[];
    const linkedUsers = clerkIds.length
      ? await this.prisma.user.findMany({
          where: { clerkId: { in: clerkIds } },
          select: { clerkId: true, email: true, phone: true, firstName: true },
        })
      : [];
    const userByClerkId = new Map(
      linkedUsers.map((u) => [u.clerkId, u] as const),
    );

    let alertedCount = 0;
    for (const admin of admins) {
      const linked = admin.clerkId
        ? userByClerkId.get(admin.clerkId)
        : undefined;
      const email = linked?.email ?? admin.email;
      const phone = linked?.phone ?? null;
      const name =
        linked?.firstName ??
        admin.firstName ??
        'Admin';

      try {
        await this.notifications.adminLowVerifyNowCredits(
          email,
          name,
          available,
          LOW_BALANCE_THRESHOLD,
        );
        if (phone) {
          await this.sms.sendSms({
            to: phone,
            message: `All Outdoor: VerifyNow credits at ${available} (threshold ${LOW_BALANCE_THRESHOLD}). Top up to keep KYC running.`,
            reference: `verifynow-low-${admin.id}`,
          });
        }
        alertedCount++;
      } catch (err) {
        this.log.warn(
          `Failed to alert admin ${admin.id} of low credits: ${(err as Error).message}`,
        );
      }
    }

    if (alertedCount === 0) {
      // Don't write the dedup flag — we never reached anyone, so let
      // the next cron tick try again.
      this.log.warn('Low-balance alert raised but no admins notified');
      return;
    }

    const state: LowBalanceState = {
      notifiedAt: new Date().toISOString(),
      available,
    };
    await this.prisma.setting.upsert({
      where: { key: LOW_BALANCE_NOTIFY_KEY },
      create: { key: LOW_BALANCE_NOTIFY_KEY, value: JSON.stringify(state) },
      update: { value: JSON.stringify(state) },
    });
    this.log.log(
      `Low VerifyNow balance (${available}) — alerted ${alertedCount} admin(s)`,
    );
  }
}
