import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  VerifyNowService,
  KycException,
  type CreditBalance,
} from './verifynow.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SmsService } from '../sms/sms.service';
import { ActionTokensService } from '../actions/action-tokens.service';

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

  constructor(
    private prisma: PrismaService,
    private verifyNow: VerifyNowService,
    private notifications: NotificationsService,
    private sms: SmsService,
    // @Global ActionTokensModule — used to mint the KYC_VERIFY token so
    // the "verify your identity" SMS link works without a Clerk login.
    private actionTokens: ActionTokensService,
  ) {}

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
    // their record, hard-block here: one ID = one Gun Galore account.
    const idHash = hashSaIdNumber(idNumber);
    const existing = await this.prisma.user.findUnique({
      where: { kycIdHash: idHash },
      select: { id: true },
    });
    if (existing && existing.id !== user.id) {
      throw new BadRequestException(
        'This SA ID number is already linked to another Gun Galore account. Contact support if this is an error.',
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
  // facematch in one shot, and PURGE the encrypted blob on success
  // so the raw ID doesn't sit on disk indefinitely. The seller only
  // has to take the selfie — no re-typing the 13-digit number.
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
            'Gun Galore: Your identity has been verified. Your pending sale can now proceed.',
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
        message: `Gun Galore: ${retryMessage}`,
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
  async getStatus(clerkId: string) {
    return this.prisma.user.findUnique({
      where: { clerkId },
      select: {
        kycStatus: true,
        kycVerifiedAt: true,
        kycFaceMatchScore: true,
        kycConsentGivenAt: true,
        kycIdVerifiedAt: true,
        kycRequiredAt: true,
        kycAttempts: true,
      },
    });
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
          message: `Gun Galore: You have a pending sale. Verify your identity to release the payout: ${kycUrl}`,
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

    // Trigger low-balance alerts AFTER the cache is updated, so even if
    // the alert sender throws the cached value is still in place.
    // Fire-and-forget so callers (the cron, the admin refresh button)
    // never see SMS/email failures.
    void this.maybeAlertLowBalance(live.available).catch((err) =>
      this.log.warn(
        `Low-balance alert failed: ${(err as Error).message}`,
      ),
    );

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
            message: `Gun Galore: VerifyNow credits at ${available} (threshold ${LOW_BALANCE_THRESHOLD}). Top up to keep KYC running.`,
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
