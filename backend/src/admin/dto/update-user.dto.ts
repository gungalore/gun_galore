import { IsEnum, IsOptional, IsBoolean, IsString, MinLength } from 'class-validator';
import { SellerTier, KycStatus, SubscriptionTier } from '@prisma/client';

export class UpdateUserDto {
  @IsOptional()
  @IsEnum(SellerTier)
  sellerTier?: SellerTier;

  @IsOptional()
  @IsEnum(KycStatus)
  kycStatus?: KycStatus;

  // GG+ / Pro subscription tier — an admin manual grant (comp accounts,
  // support goodwill) that bypasses the paid checkout, mirroring the KYC
  // override. FREE | MEMBER | PRO.
  @IsOptional()
  @IsEnum(SubscriptionTier)
  subscriptionTier?: SubscriptionTier;

  @IsOptional()
  @IsBoolean()
  isBanned?: boolean;

  // Required for every PATCH — the admin must explain why they're
  // changing this user's state. Persisted to AdminAuditEvent.
  // Minimum 3 chars so a stray "ok" can't sneak through.
  @IsString()
  @MinLength(3)
  reason!: string;
}
