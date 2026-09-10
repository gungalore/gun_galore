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
import { NotificationsService } from '../notifications/notifications.service';
import { SmsService } from '../sms/sms.service';
import { ActionTokensService } from '../actions/action-tokens.service';
import { SecureFileStorageService } from '../common/secure-file-storage.service';
import { DiditService } from '../didit/didit.service';
import { DiditError, type DiditDecision } from '../didit/didit.types';
import {
  saIdLuhnValid,
  normaliseDob,
  dobMatchesIdDigits,
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

/**
 * Didit's statuses, mapped onto ours.
 *
 * ⚠️ "In Review" MUST NOT become VERIFIED and MUST NOT become REJECTED. It is
 * the state where a human at Didit has not decided yet, and collapsing it
 * either way is the difference between paying out to an unverified seller and
 * refusing a real one. UNDER_REVIEW is exactly what it means.
 *
 * ⚠️ Anything unrecognised parks in UNDER_REVIEW too. A status we have never
 * seen is not evidence of a pass.
 */
type Verdict = 'VERIFIED' | 'REJECTED' | 'UNDER_REVIEW' | 'PENDING';

function verdictFor(status: string): Verdict {
  switch (status) {
    case 'Approved':
      return 'VERIFIED';
    case 'Declined':
      return 'REJECTED';
    case 'Not Started':
    case 'In Progress':
    case 'Resubmitted':
    case 'Awaiting User':
      return 'PENDING';
    default:
      // "In Review", "Abandoned", "Expired", "Kyc Expired", and anything
      // Didit adds later.
      return 'UNDER_REVIEW';
  }
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
  // ⚠️ THE ALERT TYPE IS A STORED STRING and stays 'kyc-claude-outage' —
  // historical, from when the scanner was Claude. Existing rows carry it and
  // the admin panel filters on it; a new vocabulary would just split the
  // same alert into two names nobody queries together.
  private lastKycOutageAlertAt = 0;

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private sms: SmsService,
    // @Global ActionTokensModule — mints the KYC_VERIFY token so the "verify
    // your identity" SMS link works without signing in.
    private actionTokens: ActionTokensService,
    // @Global DiditModule — the one adapter. Document capture, passive
    // liveness and face match all happen on Didit's hosted page now, so this
    // service no longer reads a document, calls a model, or touches AWS.
    private didit: DiditService,
    // ⚠️ STILL NEEDED DESPITE NOTHING WRITING TO IT. Members verified under
    // the old flow have an encrypted identity document and selfie on disk, and
    // a Prisma cascade cannot reach the filesystem — purgeKycFiles is what
    // stops an erasure leaving them orphaned.
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

  // ─────────────────── POPIA consent ────────────────────────────────
  // Stored as a timestamp so we know when it was given (audit). Must be
  // set before any Home Affairs query — verifyId() refuses without it.
  async recordConsent(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { kycConsentGivenAt: new Date() },
    });
    return { success: true };
  }

  // ─────────────────── Status poll ──────────────────────────────────
  // Extended for the Claude flow: `flow` tells the wizard which pipeline
  // to render; `steps`/`nextStep` are the server-side save-&-resume state
  // (every step persists onto User, so "continue later" is just leaving
  // and coming back — the wizard jumps to nextStep). Superset of the
  // legacy shape so old clients keep working.
  async getStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
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

    // The most recent Didit session, if any. It is what makes "waiting" a
    // distinct state from "not started" — the member is on Didit's page and
    // the verdict is coming by webhook, which the old synchronous flow had no
    // way to be in.
    const session = await this.prisma.diditVerification.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { diditSessionId: true, status: true, updatedAt: true },
    });

    const steps = {
      consent: !!user.kycConsentGivenAt,
      details: !!user.kycIdVerifiedAt && !!user.dateOfBirth,
      // One step where there used to be two: Didit's hosted flow captures the
      // document AND the selfie, and only tells us when both are done.
      verification: !!session,
    };

    let nextStep:
      | 'consent'
      | 'details'
      | 'verify'
      | 'waiting'
      | 'review'
      | 'done'
      | 'failed';
    if (user.kycStatus === 'VERIFIED') nextStep = 'done';
    else if (user.kycStatus === 'UNDER_REVIEW') nextStep = 'review';
    else if (user.kycStatus === 'REJECTED' && user.kycAttempts >= 3)
      nextStep = 'failed';
    else if (!steps.consent) nextStep = 'consent';
    else if (!steps.details) nextStep = 'details';
    else if (session && verdictFor(session.status) === 'PENDING')
      nextStep = 'waiting';
    else nextStep = 'verify';

    const { phone, dateOfBirth, kycIdDocumentUrl, kycSelfieUrl, ...rest } =
      user;
    void dateOfBirth;
    void kycIdDocumentUrl;
    void kycSelfieUrl;
    return {
      ...rest,
      steps,
      nextStep,
      session: session
        ? { id: session.diditSessionId, status: session.status }
        : null,
      phoneMasked: phone ? `•••${phone.slice(-4)}` : null,
    };
  }

  // ═══════════════════ AI-vision KYC flow ════════════════════════════
  // kyc_claude_flow_enabled: ID document upload + live selfie judged by an
  // AI review; VerifyNow only runs the 1-credit SA ID (Basic) record
  // check. See kyc-model.service.ts + kyc-cross-check.ts for the verdict
  // mechanics. All endpoints throw when the flag is off so the legacy
  // pipeline stays the single source of truth until rollout.

  // ── Step 2: Details (SA ID number + date of birth) ─────────────────
  // DELIBERATELY does NOT validate the DOB against the ID number's YYMMDD
  // prefix — that silent cross-check happens only at verdict time so a
  // faker typing a borrowed ID number isn't coached into fixing the DOB.
  // Luhn (typo) validation IS surfaced: it reveals nothing about the DOB
  // linkage and saves a VerifyNow credit on fat-fingered numbers.
  async submitDetails(userId: string, idNumber: string, dob: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
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

    // One ID = one account, and this runs before anything else costs money.
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

    // ⚠️ THERE IS NO HOME AFFAIRS LOOKUP HERE ANY MORE, AND THAT IS A REAL
    // LOSS, NOT A TIDY-UP. This step used to call VerifyNow's SA ID Basic
    // check, which returned the applicant's official first name and surname
    // and let the verdict cross-check the typed DOB against Home Affairs'
    // own record. Didit's free tier has no equivalent: the names now come
    // from the document Didit reads, and the DOB is checked only against the
    // ID number's own digits.
    //
    // Didit sells the replacement as `zaf_africa_national_id` (DHA, $1.10 a
    // check). Turning it on is a pricing decision the operator has not made,
    // so this comment stands in for the check until they do — and nothing in
    // user-facing copy may claim a Home Affairs verification meanwhile.

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
          `Failed to encrypt SA ID for ${userId}: ${(err as Error).message}`,
        );
      }
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        kycIdVerifiedAt: new Date(),
        kycStatus: 'PENDING',
        kycIdHash: idHash,
        // ⚠️ A STORED STRING, NOT A LABEL WE ARE FREE TO RENAME. Historical
        // rows carry 'CLAUDE' and 'VERIFYNOW'; 'DIDIT' joins them rather than
        // replacing them, so an old row still says what actually checked it.
        kycMethod: 'DIDIT',
        dateOfBirth: dob,
        ...(idNumberEncrypted ? { idNumberEncrypted } : {}),
      },
    });

    // ⚠️ NOTHING ABOUT THE ID GOES BACK. The names used to come from Home
    // Affairs and were echoed so the member could see we had matched them.
    // We have no such answer now, and inventing one from what they typed
    // would be showing them their own input as if it were confirmation.
    return { success: true };
  }

  // ── "SMS me the link" phone handoff ─────────────────────────────────
  // Desktop sellers without a webcam scan the QR — but a good portion of
  // sellers are not QR-literate, so this sends the same token link by SMS.
  // Service-side cap (3/hour) because the IP-keyed throttler doesn't stop
  // a single user hammering mint.
  async sendHandoffSms(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
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
    score: number,
  ) {
    try {
      await this.prisma.adminAlert.create({
        data: {
          type: 'KYC_REPEATED_FAILURE',
          referenceId: userId,
          context: `KYC face match failed 3+ times for user ${userId}. Last score: ${score}`,
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


  // ─────────────────── The Didit verification session ───────────────────

  /**
   * Hand the member a hosted Didit page that captures their identity
   * document, runs passive liveness and matches the two faces.
   *
   * ⚠️ THE FREE-TIER WORKFLOW DOES NOT ALLOW DESKTOP. Didit refuses to run
   * the flow on a desktop browser (`is_desktop_allowed: false`) because a
   * laptop webcam cannot resolve a document, which is the same conclusion the
   * scanner reached independently. A desktop member reaches this through the
   * QR / SMS hand-off, exactly as they already do for the ID scan.
   *
   * Didit is idempotent on (workflow, vendor_data) while a session is
   * unfinished, so a member who reloads gets the SAME session back rather
   * than a second billable one — which is why this can be called freely.
   */
  async startVerification(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        kycStatus: true,
        kycConsentGivenAt: true,
        kycIdVerifiedAt: true,
        dateOfBirth: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.kycConsentGivenAt) {
      throw new ForbiddenException(
        'POPIA consent must be given before identity verification.',
      );
    }
    if (!user.kycIdVerifiedAt || !user.dateOfBirth) {
      throw new ForbiddenException(
        'Enter your ID number and date of birth before verifying.',
      );
    }
    // Re-verifying something already settled would spend a session for
    // nothing and could only downgrade a member who has already passed.
    if (user.kycStatus === 'VERIFIED' || user.kycStatus === 'UNDER_REVIEW') {
      throw new BadRequestException(
        'Your verification is already complete or being reviewed.',
      );
    }

    const appUrl = (
      process.env.FRONTEND_URL ?? 'https://alloutdoor.co.za'
    ).replace(/\/+$/, '');

    let created;
    try {
      created = await this.didit.createKycSession({
        vendorData: user.id,
        callback: `${appUrl}/kyc/verify?returned=1`,
        email: user.email,
        phone: user.phone ?? undefined,
      });
    } catch (err) {
      if (err instanceof DiditError) {
        this.log.error(`Didit session create failed: ${err.message}`);
        await this.alertVerificationOutage(err.message);
        throw new BadRequestException(
          'We could not start identity verification right now. Please try again shortly.',
        );
      }
      throw err;
    }

    await this.prisma.diditVerification.upsert({
      where: { diditSessionId: created.session_id },
      create: {
        userId: user.id,
        diditSessionId: created.session_id,
        workflowId: created.workflow_id,
        status: created.status,
      },
      update: { status: created.status },
    });

    if (user.kycStatus === 'NONE') {
      await this.prisma.user.updateMany({
        where: { id: user.id, kycStatus: 'NONE' },
        data: { kycStatus: 'PENDING' },
      });
    }

    return { url: created.url, sessionId: created.session_id };
  }

  /**
   * Apply a Didit outcome. Called by the webhook, and by the status poll as a
   * cold-start reconciliation when a webhook was missed.
   *
   * ⚠️ IDEMPOTENT, BECAUSE WEBHOOKS ARRIVE MORE THAN ONCE. Didit retries on
   * any non-2xx and can deliver the same status twice; the guarded updateMany
   * below is what stops a redelivery incrementing kycAttempts again or
   * re-sending the member an SMS they already got.
   */
  async applyDecision(
    sessionId: string,
    decision: DiditDecision,
  ): Promise<{ applied: boolean; status?: string }> {
    const row = await this.prisma.diditVerification.findUnique({
      where: { diditSessionId: sessionId },
      select: { id: true, userId: true, status: true },
    });
    if (!row) {
      // A session we never recorded. Not an error — a stale replay, or a
      // session created against another environment pointed at this URL.
      this.log.warn(`Didit decision for unknown session ${sessionId}`);
      return { applied: false };
    }

    const verdict = verdictFor(decision.status);
    await this.prisma.diditVerification.update({
      where: { id: row.id },
      data: {
        status: decision.status,
        decision: decision as unknown as Prisma.InputJsonValue,
      },
    });

    // Still in flight — record it and wait for the next event.
    if (verdict === 'PENDING') return { applied: false, status: decision.status };

    const user = await this.prisma.user.findUnique({
      where: { id: row.userId },
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        username: true,
        dateOfBirth: true,
        kycAttempts: true,
      },
    });
    if (!user) return { applied: false };

    // ⚠️ THE CROSS-CHECK IS THE HALF DIDIT CANNOT DO. Didit proves the
    // document is genuine and the face matches it. It does not know which ID
    // number the member TYPED at the details step, so an approved session on
    // somebody else's genuine document would sail through. Comparing the two
    // is what binds the verified identity to this account.
    const read = decision.id_verifications?.[0];
    const mismatch = this.crossCheckAgainstTyped(read, user.dateOfBirth);

    let finalStatus: 'VERIFIED' | 'REJECTED' | 'UNDER_REVIEW' = verdict;
    if (verdict === 'VERIFIED' && mismatch) {
      this.log.warn(
        `Didit approved ${sessionId} but the document disagrees with what the member typed (${mismatch}) — parking for review`,
      );
      finalStatus = 'UNDER_REVIEW';
    }

    const now = new Date();
    // Guarded so a redelivered webhook is a no-op rather than a second strike.
    const guarded = await this.prisma.user.updateMany({
      where: { id: user.id, kycStatus: { in: ['PENDING', 'REJECTED'] } },
      data: {
        kycAttempts: { increment: 1 },
        kycStatus: finalStatus,
        ...(finalStatus === 'VERIFIED' ? { kycVerifiedAt: now } : {}),
        kycFaceMatchScore: decision.face_matches?.[0]?.score ?? undefined,
        kycFaceMatchStatus: decision.face_matches?.[0]?.status ?? undefined,
        // Names come off the document Didit read — the only source we have
        // for them now. Never overwrite with an empty read.
        ...(read?.first_name ? { firstName: read.first_name } : {}),
        ...(read?.last_name ? { lastName: read.last_name } : {}),
      },
    });
    if (guarded.count === 0) {
      return { applied: false, status: decision.status };
    }

    await this.announceVerdict(user, finalStatus, mismatch);
    return { applied: true, status: finalStatus };
  }

  /**
   * Compare Didit's reading of the document against what the member typed.
   *
   * Returns a short reason when they disagree, or null when they agree (or
   * when the read is too thin to say anything, which is not a disagreement).
   */
  private crossCheckAgainstTyped(
    read: { personal_number?: string | null; document_number?: string | null; date_of_birth?: string | null } | undefined,
    typedDob: string | null,
  ): string | null {
    if (!read) return null;

    // A SA ID number can come back in either field depending on the document.
    const candidates = [read.personal_number, read.document_number]
      .filter((v): v is string => !!v)
      .map((v) => v.replace(/\D/g, ''))
      .filter((v) => v.length === 13);

    if (candidates.length && typedDob) {
      // The ID number carries its own YYMMDD. If none of the numbers on the
      // document agree with the date of birth we were given, the document and
      // the claim are not about the same person.
      const anyAgrees = candidates.some((n) => dobMatchesIdDigits(n, typedDob));
      if (!anyAgrees) return 'id-digits-vs-typed-dob';
    }

    if (read.date_of_birth && typedDob) {
      const printed = normaliseDob(read.date_of_birth);
      if (printed && printed !== normaliseDob(typedDob)) {
        return 'printed-dob-vs-typed-dob';
      }
    }

    return null;
  }

  private async announceVerdict(
    user: {
      id: string;
      email: string;
      phone: string | null;
      firstName: string | null;
      username: string;
    },
    status: 'VERIFIED' | 'REJECTED' | 'UNDER_REVIEW',
    mismatch: string | null,
  ) {
    const name = user.firstName ?? user.username;

    if (status === 'VERIFIED') {
      await this.notifications
        .sellerKycApproved(user.email, name)
        .catch(() => undefined);
      if (user.phone) {
        await this.sms
          .sendSms({
            to: user.phone,
            message:
              'All Outdoor: your identity has been verified. You can now sell.',
            reference: `kyc-approved-${user.id}`,
          })
          .catch(() => undefined);
      }
      return;
    }

    if (status === 'UNDER_REVIEW') {
      // No strike, no SMS — a human has to look, and telling the member they
      // failed when they have not is the one message we cannot take back.
      await this.prisma.adminAlert
        .create({
          data: {
            type: 'KYC_REVIEW',
            referenceId: user.id,
            urgent: true,
            context: mismatch
              ? `Didit approved the session but the document disagrees with the member's typed details (${mismatch}).`
              : 'Didit returned a review outcome.',
          },
        })
        .catch(() => undefined);
      return;
    }

    // REJECTED. ⚠️ The message stays generic on purpose: naming the check
    // that failed tells somebody working through a stolen document exactly
    // which field to fix next time.
    await this.notifications
      .sellerKycRejected(
        user.email,
        name,
        `We could not verify your identity. Contact ${SUPPORT_EMAIL} if you think this is wrong.`,
      )
      .catch(() => undefined);
    if (user.phone) {
      await this.sms
        .sendSms({
          to: user.phone,
          message: `All Outdoor: we could not verify your identity. Contact ${SUPPORT_EMAIL}.`,
          reference: `kyc-failed-${user.id}`,
        })
        .catch(() => undefined);
    }
  }

  /** One alert per 6h window, so an outage does not bury the Desk. */
  private async alertVerificationOutage(detail: string) {
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    if (Date.now() - this.lastKycOutageAlertAt < SIX_HOURS) return;
    this.lastKycOutageAlertAt = Date.now();
    await this.prisma.adminAlert
      .create({
        data: {
          type: 'kyc-claude-outage',
          referenceId: 'didit',
          urgent: true,
          context: `Identity verification is failing: ${detail.slice(0, 400)}`,
        },
      })
      .catch(() => undefined);
  }

}
