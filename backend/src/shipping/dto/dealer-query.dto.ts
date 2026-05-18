import { IsOptional, IsEnum } from 'class-validator';
import { Province } from '@prisma/client';

export class DealerQueryDto {
  @IsOptional()
  @IsEnum(Province)
  province?: Province;
}
