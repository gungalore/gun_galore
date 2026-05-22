import { IsString, Matches, MinLength } from 'class-validator';

export class FaceMatchDto {
  // The seller's SA ID (we re-validate against the value they entered
  // in step 1 inside the service to make sure they can't face-match
  // someone else's ID).
  @IsString()
  @Matches(/^\d{13}$/, { message: 'SA ID number must be exactly 13 digits' })
  idNumber!: string;

  // Selfie as base64. May or may not include a "data:image/..." prefix —
  // VerifyNow's SDK strips it either way. We just need a reasonable
  // length so an empty/missing payload doesn't burn a credit.
  @IsString()
  @MinLength(500, { message: 'Selfie image is missing or too small' })
  selfieBase64!: string;
}
