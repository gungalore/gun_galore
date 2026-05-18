import { IsEnum, IsOptional, IsBoolean } from 'class-validator';
import { SellerTier, KycStatus } from '@prisma/client';

export class UpdateUserDto {
  @IsOptional()
  @IsEnum(SellerTier)
  sellerTier?: SellerTier;

  @IsOptional()
  @IsEnum(KycStatus)
  kycStatus?: KycStatus;

  @IsOptional()
  @IsBoolean()
  isBanned?: boolean;
}
