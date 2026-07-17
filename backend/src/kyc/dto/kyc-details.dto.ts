import { IsString, Matches } from 'class-validator';

// Claude-flow Step 2 — the seller's SA ID number + date of birth.
// Format-only validation here: the DOB↔ID-digit consistency check is
// DELIBERATELY absent (it runs silently at verdict time — see
// kyc-cross-check.ts). Luhn runs in the service, before any credit burn.
export class KycDetailsDto {
  @IsString()
  @Matches(/^\d{13}$/, { message: 'ID number must be 13 digits.' })
  idNumber!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Date of birth must be YYYY-MM-DD.',
  })
  dob!: string;
}
