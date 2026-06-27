import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { User, Province, NotificationCategory } from '@prisma/client';
import { createHash, randomInt } from 'crypto';
import { createClerkClient } from '@clerk/backend';
import { encryptSaIdNumber, hashSaIdNumber } from '../common/id-crypto';

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
// validates every field, then writes to the DB. (Automated bank AVS was
// removed with Peach — Stitch Express has no account-verification
// endpoint; bank details are reviewed manually at payout instead.)
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

// Editable subset of the user record. Anything not in this shape can't
// be reached via PATCH /users/me. Phone is intentionally excluded —
// it goes through the OTP request/verify flow below.
export interface ProfileUpdate {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
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

// OTP code config. Short codes (4 digits) keep mobile-typing painless;
// 10-minute window is long enough for SMS delivery hiccups but short
// enough that a leaked code can't be reused tomorrow.
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_LENGTH = 4;

function hashOtp(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  // Clerk client used to push DB changes back to the identity provider.
  // Same secret as ClerkGuard — Clerk's Backend SDK is cheap to construct,
  // we just keep one instance per service.
  private readonly clerk = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY,
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
  ) {}

  // Pulls the user-friendly message out of a Clerk SDK error. Clerk
  // returns structured errors with `errors[].longMessage` that's already
  // worded for end-users (e.g. "That username is taken."). Fall back to
  // the JS Error message if the shape doesn't match.
  private extractClerkError(err: unknown): string {
    if (err && typeof err === 'object' && 'errors' in err) {
      const errs = (err as {
        errors?: { longMessage?: string; message?: string }[];
      }).errors;
      if (Array.isArray(errs) && errs.length > 0) {
        return (
          errs[0].longMessage ??
          errs[0].message ??
          'Identity provider rejected the change'
        );
      }
    }
    if (err instanceof Error) return err.message;
    return 'Identity provider rejected the change';
  }

  async findByClerkId(clerkId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { clerkId } });
  }

  async upsertFromClerk(data: {
    clerkId: string;
    email: string;
    username?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    avatarUrl?: string;
  }): Promise<User> {
    // Lowercase usernames before persisting — matches the check endpoint.
    const username = data.username
      ? data.username.trim().toLowerCase()
      : null;

    return this.prisma.user.upsert({
      where: { clerkId: data.clerkId },
      create: {
        clerkId: data.clerkId,
        email: data.email,
        username,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        avatarUrl: data.avatarUrl,
      },
      update: {
        email: data.email,
        // Only update username if Clerk gave us one — never wipe an existing value.
        ...(username ? { username } : {}),
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        phone: data.phone ?? null,
        avatarUrl: data.avatarUrl ?? null,
      },
    });
  }

  async deleteByClerkId(clerkId: string): Promise<void> {
    // H3 — Clerk user.deleted webhook handler. Hard delete fails for
    // any user with transactions/ratings/offers (FK RESTRICT in the
    // financial models), which would 500 the webhook and make Clerk
    // retry forever AND leave the seller's PII on file indefinitely.
    //
    // This minimal interim fix wraps the delete in try/catch so the
    // webhook always 200s. When delete is blocked by financial-row
    // RESTRICTs, we PII-scrub the row in-place (POPIA erasure
    // semantics) while preserving the financial history needed for
    // SARS / dispute defence. A proper soft-delete column + DTO
    // exclusion is tracked on the launch checklist.
    try {
      await this.prisma.user.deleteMany({ where: { clerkId } });
    } catch (err) {
      this.logger.warn(
        `Hard delete of clerk user ${clerkId} blocked by FK constraints — falling back to PII scrub: ${(err as Error).message}`,
      );
      try {
        await this.prisma.user.updateMany({
          where: { clerkId },
          data: {
            // Strip the directly-identifying PII while keeping the row
            // for FK targets (transactions, offers, ratings).
            email: `deleted+${Date.now()}@gungalore.local`,
            firstName: null,
            lastName: null,
            phone: null,
            avatarUrl: null,
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
            bankAccountHolder: null,
            bankAccountNumber: null,
            bankBranchCode: null,
            bankName: null,
            bankAccountType: null,
            isBanned: true,
          },
        });
      } catch (scrubErr) {
        this.logger.error(
          `PII scrub of clerk user ${clerkId} also failed: ${(scrubErr as Error).message}`,
        );
      }
    }
  }

  // ─────────────────── Profile editing ─────────────────────────────
  // PATCH /users/me body. Only the fields in ProfileUpdate are accepted;
  // every other column on User is off-limits via this endpoint.
  //
  // Username changes are mirrored to Clerk so the seller's identity
  // profile stays in sync. We push to Clerk BEFORE writing to our DB —
  // if Clerk rejects (username taken globally, invalid format, etc.) the
  // seller gets a single error and our DB stays consistent. Address /
  // name fields are NOT pushed because Clerk doesn't own them (KYC does).
  // Submitted by the post-first-publish profile modal. One shot —
  // all fields required, Peach AVS validates the bank quartet, SA ID
  // is encrypted at rest (purged after the KYC selfie passes), and
  // profileCompletedAt is the gate the payout flow checks. Throws a
  // user-readable BadRequestException for any failure so the modal
  // can show the message inline.
  async completeProfile(clerkId: string, dto: ProfileCompleteDto): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
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
          'That SA ID number is already associated with another Gun Galore account',
        );
      }
    }

    // Automated bank-account verification (AVS) was removed with Peach —
    // Stitch Express has no account-verification endpoint. Bank details
    // are captured as entered; an admin reviews them before the manual
    // payout EFT (the manual check that replaced automated AVS).

    // ─── Push username to Clerk first so the two stores stay in sync ──
    if (username !== user.username) {
      try {
        await this.clerk.users.updateUser(clerkId, { username });
      } catch (err) {
        const message = this.extractClerkError(err);
        throw new BadRequestException(message);
      }
    }

    // ─── Save everything in one update ────────────────────────────
    const encryptedId = encryptSaIdNumber(idNumber);
    const updated = await this.prisma.user.update({
      where: { clerkId },
      data: {
        firstName,
        lastName,
        username,
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
        profileCompletedAt: new Date(),
      },
    });

    this.logger.log(
      `Profile completed for ${clerkId} (bank=${dto.bankName})`,
    );
    return updated;
  }

  // Buyer phone capture without OTP. Per operator decision, we trust
  // buyers to type their own number — we just need it so dispatch
  // SMS reaches them. Leaves phoneVerified false; only the seller
  // OTP flow flips that bit. If the seller later wants their phone
  // properly verified they can run the OTP request/verify flow and
  // overwrite this same column.
  async saveBuyerPhone(clerkId: string, phone: string): Promise<User> {
    return this.prisma.user.update({
      where: { clerkId },
      data: { phone },
    });
  }

  async updateProfile(clerkId: string, patch: ProfileUpdate): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
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

    // If username actually changed (set, renamed, or cleared), push to
    // Clerk first. Clerk has its own uniqueness scope (all Clerk users on
    // this instance, not just ours) and stricter character/length rules,
    // so it can reject what we accept. On rejection we abort the DB
    // update so the two stores can't drift apart.
    if (username !== undefined && username !== user.username) {
      try {
        await this.clerk.users.updateUser(clerkId, {
          // Clerk uses empty string to clear an optional username. null
          // wouldn't match the SDK's typing.
          username: username ?? '',
        });
      } catch (err) {
        const message = this.extractClerkError(err);
        this.logger.warn(
          `Clerk rejected username change for ${clerkId}: ${message}`,
        );
        throw new BadRequestException(message);
      }
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
      where: { clerkId },
      data: {
        ...cleanedPatch,
        // Only include username if the caller actually sent it.
        ...(username !== undefined ? { username } : {}),
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
    clerkId: string,
    rawPhone: string,
  ): Promise<{ sent: boolean; stub?: boolean }> {
    if (!rawPhone || rawPhone.trim().length === 0) {
      throw new BadRequestException('Phone number is required');
    }
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new NotFoundException('User not found');

    // Hard-block duplicates: one SA mobile = one Gun Galore account.
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
        'That phone number is already linked to another Gun Galore account.',
      );
    }

    // Generate a zero-padded 4-digit code (`randomInt` is uniform — no
    // modulo bias). The plain code goes out via SMS; we only persist
    // its sha256 + the expiry.
    const code = String(randomInt(0, 10000)).padStart(OTP_LENGTH, '0');
    const otpHash = hashOtp(code);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    const sms = await this.sms.sendSms({
      to: rawPhone,
      message: `Gun Galore verification code: ${code}\n\nValid for 10 minutes. If you didn't request this, ignore this message.`,
      reference: `phone-change-${user.id}`,
    });

    if (!sms.success) {
      // Don't persist the OTP — the user never got it.
      throw new BadRequestException(
        'Could not send verification SMS. Check the number and try again.',
      );
    }

    // Store the new phone in plain text + the OTP hash. phoneVerified
    // stays false until they submit the matching code.
    await this.prisma.user.update({
      where: { clerkId },
      data: {
        phone: rawPhone.trim(),
        phoneVerified: false,
        phoneOtpHash: otpHash,
        phoneOtpExpiresAt: expiresAt,
      },
    });

    return { sent: true, stub: sms.stub };
  }

  // Submit the 4-digit code. On success: phoneVerified=true, OTP wiped.
  // On failure: clear error so the seller knows whether to re-request.
  async verifyPhoneChange(
    clerkId: string,
    code: string,
  ): Promise<{ verified: true }> {
    if (!code || !/^\d{4}$/.test(code.trim())) {
      throw new BadRequestException('Enter the 4-digit code');
    }
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.phoneOtpHash || !user.phoneOtpExpiresAt) {
      throw new BadRequestException(
        'No verification code is pending — request a new one.',
      );
    }
    if (user.phoneOtpExpiresAt < new Date()) {
      // Expired — wipe so the next request starts clean.
      await this.prisma.user.update({
        where: { clerkId },
        data: { phoneOtpHash: null, phoneOtpExpiresAt: null },
      });
      throw new BadRequestException(
        'The code has expired. Request a new one.',
      );
    }
    if (hashOtp(code.trim()) !== user.phoneOtpHash) {
      throw new BadRequestException('That code doesn\'t match — try again.');
    }
    await this.prisma.user.update({
      where: { clerkId },
      data: {
        phoneVerified: true,
        phoneOtpHash: null,
        phoneOtpExpiresAt: null,
      },
    });
    return { verified: true };
  }

  // ─────────────────── Address book (Phase 2) ────────────────────────
  private async userIdFor(clerkId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    if (!u) throw new NotFoundException('User not found');
    return u.id;
  }

  async listAddresses(clerkId: string) {
    const userId = await this.userIdFor(clerkId);
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createAddress(clerkId: string, input: AddressInput) {
    const userId = await this.userIdFor(clerkId);
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
    clerkId: string,
    id: string,
    input: Partial<AddressInput>,
  ) {
    const userId = await this.userIdFor(clerkId);
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

  async deleteAddress(clerkId: string, id: string) {
    const userId = await this.userIdFor(clerkId);
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
  // per-device. Only email + SMS are user-mutable here.
  async updateNotificationPrefs(
    clerkId: string,
    prefs: { emailEnabled?: boolean; smsEnabled?: boolean },
  ) {
    const data: { notifyEmailEnabled?: boolean; notifySmsEnabled?: boolean } = {};
    if (typeof prefs.emailEnabled === 'boolean')
      data.notifyEmailEnabled = prefs.emailEnabled;
    if (typeof prefs.smsEnabled === 'boolean')
      data.notifySmsEnabled = prefs.smsEnabled;
    return this.prisma.user.update({
      where: { clerkId },
      data,
      select: { notifyEmailEnabled: true, notifySmsEnabled: true },
    });
  }

  // Seller default parcel size (Phase 6 P6.3). Each field is independently
  // settable; passing null clears it. Non-negative ints only.
  async updateShippingDefaults(
    clerkId: string,
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
      where: { clerkId },
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
}
