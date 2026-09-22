import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReportContentDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
