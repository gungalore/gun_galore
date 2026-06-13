import {
  Controller,
  Get,
  Post,
  Patch,
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
    const user = await this.prisma.user.findUnique({
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
      },
    });
    if (!user) return null;
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
    return { ...user, profileCompleteness: computeCompleteness(user) };
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
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true, kycStatus: true, kycRequiredAt: true },
    });
    if (!user) return { notifications: [] };

    const [winningBids, acceptedOffers, salesNeedingDispatch] =
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
      ]);

    const notifications: {
      id: string;
      label: string;
      href: string;
      severity: 'info' | 'warning' | 'critical';
    }[] = [];

    // 1. KYC first — it gates the seller's payout entirely.
    if (user.kycRequiredAt && user.kycStatus !== 'VERIFIED') {
      notifications.push({
        id: 'kyc-required',
        label: 'Verify identity to release payout',
        href: '/kyc/verify',
        severity: 'critical',
      });
    }

    // 2. Auction wins awaiting payment.
    for (const b of winningBids) {
      if (!b.listing) continue;
      const countdown = formatHoursLeft(b.listing.expiresAt);
      notifications.push({
        id: `auction-${b.listing.id}`,
        label: `Auction won: ${truncate(b.listing.title, 28)}${countdown}`,
        href: `/listings/${b.listing.id}`,
        severity: 'critical',
      });
    }

    // 3. Accepted offers awaiting payment.
    for (const o of acceptedOffers) {
      const countdown = formatHoursLeft(o.expiresAt);
      notifications.push({
        id: `offer-${o.id}`,
        label: `Offer accepted: ${truncate(o.listing.title, 28)}${countdown}`,
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
          new FileTypeValidator({ fileType: /image\/(jpeg|png|webp)|application\/pdf/ }),
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

// ─────────────────── Urgent notifications helpers ─────────────────
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function formatHoursLeft(deadline: Date | null): string {
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

// ─────────────────── Profile completeness ─────────────────────────
// Drives the nav ring + the setup prompt. Three sections; each
// contributes ~33% to the percent. `missing` is the array the
// frontend renders into a checklist with deep-links to the right
// section on /profile/edit.
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
}

function computeCompleteness(u: CompletenessInput): {
  percent: number;
  missing: ('name' | 'phone' | 'address')[];
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
  const done = [hasName, hasPhone, hasAddress].filter(Boolean).length;
  const missing: ('name' | 'phone' | 'address')[] = [];
  if (!hasName) missing.push('name');
  if (!hasPhone) missing.push('phone');
  if (!hasAddress) missing.push('address');
  return { percent: Math.round((done / 3) * 100), missing };
}
