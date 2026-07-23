import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ClerkGuard } from '../auth/clerk.guard';
import { ClerkOrTokenGuard } from '../auth/clerk-or-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import {
  UsersService,
  ProfileUpdate,
  ProfileCompleteDto,
  BankDetailsDto,
} from './users.service';

// Per-method guards instead of class-level, so the two endpoints
// reachable from the SMS-link checkout flow (GET + PATCH /me) can
// accept EITHER a Clerk session OR a CHECKOUT action token, while
// the more sensitive endpoints (KYC upload, profile-complete with
// banking, phone OTP) stay Clerk-only.
@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly users: UsersService,
  ) {}

  // ─────────────────── Read /users/me ────────────────────────────────
  // Returns the trimmed Me record that drives the profile + nav. The
  // new address + phone-verified fields are included so /profile/edit
  // can hydrate its forms in a single request.
  //
  // Also computes `profileCompleteness` so the nav ring + the
  // setup-progress UI don't each need their own /users/me variant. We
  // count three sections (name, verified phone, address with coords);
  // each contributes ~33% to the percent. Email isn't counted — it's
  // implicit (the seller can't reach this endpoint without it).
  @Get('me')
  @UseGuards(ClerkOrTokenGuard) // accept Clerk OR ?t=<checkout-token>
  async me(
    @CurrentUser() clerkId: string,
    @Req() req: Request & { viaActionToken?: boolean },
  ) {
    const meQuery = () => this.prisma.user.findUnique({
      where: { clerkId },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        phone: true,
        phoneVerified: true,
        avatarUrl: true,
        sellerTier: true,
        kycStatus: true,
        kycVerifiedAt: true,
        kycRequiredAt: true,
        trustScore: true,
        averageRating: true,
        totalSales: true,
        createdAt: true,
        // Address
        addrBuilding: true,
        addrStreet: true,
        addrAddress2: true,
        addrSuburb: true,
        addrCity: true,
        addrPostalCode: true,
        addrProvince: true,
        addrLat: true,
        addrLng: true,
        // Saved address book + notification channel preferences (Phase 2).
        savedAddresses: {
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        },
        notifyEmailEnabled: true,
        notifySmsEnabled: true,
        // Seller default parcel size (Phase 6 P6.3) — pre-fills the sell form.
        defaultWeightGrams: true,
        defaultLengthCm: true,
        defaultWidthCm: true,
        defaultHeightCm: true,
        // Post-publish profile-completion modal state. The frontend
        // checks profileCompletedAt to decide whether to show the
        // modal on first listing publish; bankVerifiedAt + bankName
        // surface in the "your banking" section of /profile/edit
        // (account number itself is masked client-side).
        profileCompletedAt: true,
        bankVerifiedAt: true,
        bankName: true,
        bankAccountHolder: true,
        bankAccountNumber: true,
        bankBranchCode: true,
        bankAccountType: true,
        // Seller completeness sections (identity + verification) — the
        // listings count decides buyer-shape vs seller-shape.
        kycIdVerifiedAt: true,
        _count: { select: { listings: true } },
      },
    });
    let user = await meQuery();
    if (!user && !req.viaActionToken) {
      // Valid Clerk session but no DB row (missed webhook / deleted row /
      // instance switch): provision from the Clerk API so the app never
      // renders an empty profile for a signed-in user, then re-read.
      const provisioned = await this.users.lazyProvisionFromClerk(clerkId);
      if (provisioned) user = await meQuery();
    }
    if (!user) return null;
    // Compute completeness BEFORE the action-token bank strip below —
    // the banking section must reflect reality, not the redaction.
    const profileCompleteness = computeCompleteness({
      ...user,
      listingsCount: user._count.listings,
    });
    // When reached via a CHECKOUT action token (a replayable 24h
    // URL-bearer credential, not a full Clerk session) NEVER return the
    // user's banking details. The token is for completing a checkout, not
    // for reading the seller's payout account. Strip bank* fields.
    if (req.viaActionToken) {
      user.bankName = null;
      user.bankAccountHolder = null;
      user.bankAccountNumber = null;
      user.bankBranchCode = null;
      user.bankAccountType = null;
    }
    const { _count, ...rest } = user;
    void _count;
    return { ...rest, profileCompleteness };
  }

  // ─────────────────── Urgent notifications strip ───────────────────
  // Aggregates the four "you need to act NOW" surfaces into one pill
  // payload for the 35px UrgentNotifications strip in the root layout:
  //   1. KYC required (blocks payout for the seller)
  //   2. Auction wins awaiting payment (one pill per win, 24h countdown)
  //   3. Offers accepted by seller awaiting payment (one pill per offer)
  //   4. Sales paid + waiting on seller dispatch (single aggregated pill)
  //
  // Returned shape mirrors the UrgentNotification type on the frontend
  // exactly so the component doesn't need a translation layer.
  @Get('me/urgent')
  @UseGuards(ClerkGuard)
  async urgent(@CurrentUser() clerkId: string) {
    // Aggregation extracted to UsersService.getUrgentSummary (Ask GG
    // Everywhere W5) — shared with the getMyAccountOverview tool.
    return this.users.getUrgentSummary(clerkId);
  }

  // ─────────────────── Edit /users/me ────────────────────────────────
  // Patch any of: firstName, lastName, username, address fields.
  // Email + avatar + password live on Clerk; phone goes through its own
  // OTP-gated endpoints below.
  @Patch('me')
  @UseGuards(ClerkOrTokenGuard) // accept Clerk OR ?t=<checkout-token>
  async updateMe(
    @CurrentUser() clerkId: string,
    @Body() patch: ProfileUpdate,
  ) {
    // Whitelist defensively — only known keys hit Prisma. Anything else
    // (e.g. `kycStatus`, `sellerTier`) gets dropped on the floor.
    const allowed: (keyof ProfileUpdate)[] = [
      'firstName',
      'lastName',
      'username',
      'addrBuilding',
      'addrStreet',
      'addrAddress2',
      'addrSuburb',
      'addrCity',
      'addrPostalCode',
      'addrProvince',
      'addrLat',
      'addrLng',
    ];
    const safe: ProfileUpdate = {};
    for (const key of allowed) {
      if (key in patch) {
        (safe as Record<string, unknown>)[key] = patch[key];
      }
    }
    return this.users.updateProfile(clerkId, safe);
  }

  // ─────────────────── Address book (Phase 2) ────────────────────────
  // Multiple saved delivery addresses. Clerk-only (managing the book
  // needs a real account; the SMS-token checkout flow still works via
  // the inline address override on the checkout form).
  @Get('me/addresses')
  @UseGuards(ClerkGuard)
  listAddresses(@CurrentUser() clerkId: string) {
    return this.users.listAddresses(clerkId);
  }

  @Post('me/addresses')
  @UseGuards(ClerkGuard)
  createAddress(
    @CurrentUser() clerkId: string,
    @Body() body: import('./users.service').AddressInput,
  ) {
    return this.users.createAddress(clerkId, body);
  }

  @Patch('me/addresses/:id')
  @UseGuards(ClerkGuard)
  updateAddress(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body() body: Partial<import('./users.service').AddressInput>,
  ) {
    return this.users.updateAddress(clerkId, id, body);
  }

  @Delete('me/addresses/:id')
  @UseGuards(ClerkGuard)
  deleteAddress(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.users.deleteAddress(clerkId, id);
  }

  // ─────────────────── Notification preferences (Phase 2) ────────────
  @Patch('me/notification-prefs')
  @UseGuards(ClerkGuard)
  updateNotificationPrefs(
    @CurrentUser() clerkId: string,
    @Body() body: { emailEnabled?: boolean; smsEnabled?: boolean },
  ) {
    return this.users.updateNotificationPrefs(clerkId, body);
  }

  // ─────────────────── Seller shipping defaults (Phase 6 P6.3) ────────
  @Patch('me/shipping-defaults')
  @UseGuards(ClerkGuard)
  updateShippingDefaults(
    @CurrentUser() clerkId: string,
    @Body()
    body: {
      weightGrams?: number | null;
      lengthCm?: number | null;
      widthCm?: number | null;
      heightCm?: number | null;
    },
  ) {
    return this.users.updateShippingDefaults(clerkId, body);
  }

  // Submitted by the post-first-publish ProfileCompletionModal. ALL
  // fields are required (the modal won't let the seller submit a
  // partial). Backend validates the banking quartet + encrypts the
  // SA ID at rest. Sets profileCompletedAt on success. Throws a
  // BadRequestException with the modal-displayable message on any
  // validation failure. Note: Peach AVS was removed in 2026-06;
  // bank details are now verified manually by admin at payout time
  // (no automated verification with Stitch Express).
  @Post('me/profile-complete')
  @UseGuards(ClerkGuard)
  completeProfile(
    @CurrentUser() clerkId: string,
    @Body() body: ProfileCompleteDto,
  ) {
    return this.users.completeProfile(clerkId, body);
  }

  // FLOW-F2 — banking-details-only update from the /profile/edit
  // "Banking details" section. Buyer refunds AND seller payouts are
  // paid to this account by the daily FNB EFT batch; refund
  // notifications link buyers here when no bank details are on file
  // (profile-complete can't be reused — it demands the full seller
  // pack: SA ID, address, username, phone). Clerk-only: banking is
  // sensitive, never reachable via a checkout action token.
  @Patch('me/bank-details')
  @UseGuards(ClerkGuard)
  updateBankDetails(
    @CurrentUser() clerkId: string,
    @Body() body: BankDetailsDto,
  ) {
    return this.users.updateBankDetails(clerkId, body);
  }

  // Buyer phone capture — NO OTP. Sellers go through the OTP flow
  // below (their phone matters for tracking + sale notifications);
  // buyers just need a number on file so we can SMS dispatch /
  // out-for-delivery / "where's my parcel" alerts. Per operator
  // decision: we don't OTP buyers because Clerk doesn't do phones
  // (we'd be paying SMSPortal per signup for verification on top
  // of normal transactional SMS).
  //
  // Stores phone but leaves phoneVerified false. The seller OTP flow
  // is what flips phoneVerified true, so seller features can keep
  // gating on that bit if they need real verification.
  @Post('me/buyer-phone')
  @UseGuards(ClerkGuard)
  async saveBuyerPhone(
    @CurrentUser() clerkId: string,
    @Body() body: { phone?: string },
  ) {
    const phone = (body?.phone ?? '').trim();
    if (!phone) {
      throw new BadRequestException('Phone number is required');
    }
    if (!/^\+?\d{9,15}$/.test(phone)) {
      throw new BadRequestException('Phone number looks invalid');
    }
    return this.users.saveBuyerPhone(clerkId, phone);
  }

  // ─────────────────── Sign-up consent (POPIA) ──────────────────────
  // Called by the sign-up flow right after auth completes (email + OAuth),
  // recording the Terms / Privacy / 18+ affirmation as a durable, timestamped
  // consent record. ClerkGuard lazy-upserts the User row first, so this works
  // even in the create-webhook race. Marketing is a separate explicit opt-in.
  @Post('me/consent')
  @UseGuards(ClerkGuard)
  async recordConsent(
    @CurrentUser() clerkId: string,
    @Body()
    body: {
      terms?: boolean;
      privacy?: boolean;
      age?: boolean;
      marketing?: boolean;
      policyVersion?: string;
    },
  ) {
    const recorded = await this.users.recordSignupConsent(clerkId, {
      terms: body?.terms === true,
      privacy: body?.privacy === true,
      age: body?.age === true,
      marketing: typeof body?.marketing === 'boolean' ? body.marketing : undefined,
      policyVersion:
        typeof body?.policyVersion === 'string' ? body.policyVersion : undefined,
    });
    // recorded=false ⇒ the User row wasn't there yet (rare create-race); the
    // client keeps its pending record and retries rather than losing consent.
    return { recorded };
  }

  // ─────────────────── Phone change: request OTP ─────────────────────
  // Body: { phone: "0820000000" | "+27820000000" }
  // Sends a 4-digit code to the new number. Returns { sent: true } on
  // success. stub:true in dev means the SMS was logged rather than
  // actually sent (no SMSPortal config) — the code is in SmsLog.
  @Post('me/phone/request-otp')
  @UseGuards(ClerkGuard)
  async requestPhoneOtp(
    @CurrentUser() clerkId: string,
    @Body() body: { phone?: string },
  ) {
    if (!body?.phone) {
      throw new BadRequestException('Phone number is required');
    }
    return this.users.requestPhoneChange(clerkId, body.phone);
  }

  // ─────────────────── Phone change: verify OTP ──────────────────────
  // Body: { code: "1234" }
  // On success: { verified: true } and the phone is now marked verified.
  @Post('me/phone/verify')
  @UseGuards(ClerkGuard)
  async verifyPhoneOtp(
    @CurrentUser() clerkId: string,
    @Body() body: { code?: string },
  ) {
    if (!body?.code) {
      throw new BadRequestException('Verification code is required');
    }
    return this.users.verifyPhoneChange(clerkId, body.code);
  }

  // ─────────────────── KYC document upload (existing) ────────────────
  @Post('kyc')
  @UseGuards(ClerkGuard)
  @UseInterceptors(FileInterceptor('document', { storage: memoryStorage() }))
  async submitKyc(
    @CurrentUser() clerkId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }), // 10 MB
          new FileTypeValidator({ fileType: /image\/(jpeg|png|webp|heic|heif)|application\/pdf/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new BadRequestException('User not found');
    if (user.kycStatus === 'VERIFIED') throw new BadRequestException('KYC already verified');

    const { url } = await this.cloudinary.uploadImage(file.buffer, 'kyc-documents');

    await this.prisma.user.update({
      where: { clerkId },
      data: {
        kycStatus: 'PENDING',
        kycDocumentUrl: url,
      },
    });

    return { submitted: true, status: 'PENDING' };
  }
}

// ─────────────────── Profile completeness ─────────────────────────
// Drives the nav ring + the setup prompt. Two shapes:
//   Buyers (no listings, never forced into KYC): four sections at 25%
//   each — name, phone, address, banking. Banking counts for BUYERS
//   too (operator decision 2026-07-18): refunds are EFT'd to this
//   account, so it's required of everyone, not just sellers — and the
//   profile editor's Banking step reads red-until-filled like the
//   Verification step instead of "optional".
//   Sellers (≥1 listing OR kycRequiredAt set): five sections at 20%
//   each — the buyer four plus the two identity-verification stages
//   (folded into one Verification section in the UI). UNDER_REVIEW
//   counts as done for the percent (nothing more is needed FROM the
//   seller); the "being reviewed" state renders on the verification
//   progress bar instead.
// `missing` is the array the frontend renders into a checklist with
// deep-links to the right page.
export type CompletenessMissing =
  | 'name'
  | 'phone'
  | 'address'
  | 'banking'
  | 'identity'
  | 'verification';

interface CompletenessInput {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  phoneVerified: boolean;
  addrStreet: string | null;
  addrCity: string | null;
  addrPostalCode: string | null;
  addrLat: number | null;
  addrLng: number | null;
  bankAccountNumber?: string | null;
  bankBranchCode?: string | null;
  bankAccountHolder?: string | null;
  kycStatus?: string | null;
  kycIdVerifiedAt?: Date | null;
  kycRequiredAt?: Date | null;
  listingsCount?: number;
}

export function computeCompleteness(u: CompletenessInput): {
  percent: number;
  missing: CompletenessMissing[];
  shape: 'buyer' | 'seller';
} {
  const hasName = !!(u.firstName && u.lastName);
  const hasPhone = !!(u.phone && u.phoneVerified);
  const hasAddress = !!(
    u.addrStreet &&
    u.addrCity &&
    u.addrPostalCode &&
    u.addrLat != null &&
    u.addrLng != null
  );

  const hasBanking = !!(
    u.bankAccountNumber &&
    u.bankBranchCode &&
    u.bankAccountHolder
  );

  const isSeller = (u.listingsCount ?? 0) > 0 || !!u.kycRequiredAt;
  if (!isSeller) {
    const done = [hasName, hasPhone, hasAddress, hasBanking].filter(
      Boolean,
    ).length;
    const missing: CompletenessMissing[] = [];
    if (!hasName) missing.push('name');
    if (!hasPhone) missing.push('phone');
    if (!hasAddress) missing.push('address');
    if (!hasBanking) missing.push('banking');
    return {
      percent: Math.round((done / 4) * 100),
      missing,
      shape: 'buyer',
    };
  }

  const hasIdentity = !!u.kycIdVerifiedAt;
  const hasVerification =
    u.kycStatus === 'VERIFIED' || u.kycStatus === 'UNDER_REVIEW';

  const sections: [boolean, CompletenessMissing][] = [
    [hasName && hasPhone, hasName ? 'phone' : 'name'],
    [hasAddress, 'address'],
    [hasBanking, 'banking'],
    [hasIdentity, 'identity'],
    [hasVerification, 'verification'],
  ];
  const done = sections.filter(([ok]) => ok).length;
  const missing = sections.filter(([ok]) => !ok).map(([, key]) => key);
  return { percent: done * 20, missing, shape: 'seller' as const };
}
