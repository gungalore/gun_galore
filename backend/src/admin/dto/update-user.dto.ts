import { IsEnum, IsIn, IsOptional, IsBoolean, IsString, MinLength, MaxLength } from 'class-validator';
import { SellerTier, KycStatus, SubscriptionTier } from '@prisma/client';

export class UpdateUserDto {
  @IsOptional()
  @IsEnum(SellerTier)
  sellerTier?: SellerTier;

  @IsOptional()
  @IsEnum(KycStatus)
  kycStatus?: KycStatus;

  // AO PRO subscription tier — an admin manual grant (comp accounts,
  // support goodwill) that bypasses the paid checkout, mirroring the KYC
  // override. FREE | PRO only: MEMBER was retired 2026-07-19 (the enum
  // value survives in Postgres for legacy rows but must not be GRANTED).
  @IsOptional()
  @IsIn(['FREE', 'PRO'])
  subscriptionTier?: SubscriptionTier;

  @IsOptional()
  @IsBoolean()
  isBanned?: boolean;

  // ── Profile fields (support edits — "help a member fix their profile").
  // Every change is audited per-field. Email is deliberately NOT here:
  // it is Clerk-owned (login identity) and must be changed by the member
  // through account settings, never by an admin.
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  // Required for every PATCH — the admin must explain why they're
  // changing this user's state. Persisted to AdminAuditEvent.
  // Minimum 3 chars so a stray "ok" can't sneak through.
  @IsString()
  @MinLength(3)
  reason!: string;
}
