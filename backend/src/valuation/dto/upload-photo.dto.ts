import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const SOURCES = ['DESKTOP', 'PHONE'];

/** Multipart text fields that accompany an uploaded valuation photo. */
export class UploadPhotoDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  viewTag?: string;

  @IsOptional()
  @IsIn(SOURCES)
  source?: string;
}
