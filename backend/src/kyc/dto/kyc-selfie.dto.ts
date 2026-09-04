import { IsOptional, IsString, MinLength } from 'class-validator';

// Step 4 — the live selfie captured via getUserMedia, posted as bare
// base64 JPEG (no data: prefix).
//
// ⚠️ THE SELFIE ALONE CANNOT PROVE LIVENESS. Anti-spoofing needs an AWS
// Face Liveness session, which the BROWSER runs as a challenge against a
// session id obtained from POST /kyc/liveness-session. Without one the
// verdict cannot auto-approve and the seller parks for a human review —
// deliberately, rather than passing a check nobody ran.
export class KycSelfieDto {
  @IsString()
  @MinLength(100, { message: 'Selfie image data is missing or too small.' })
  selfieBase64!: string;

  /**
   * Session id from POST /kyc/liveness-session, after the browser has
   * completed the challenge. Optional so the endpoint keeps working while
   * the frontend adopts the component — but see the warning above.
   */
  @IsOptional()
  @IsString()
  livenessSessionId?: string;
}
