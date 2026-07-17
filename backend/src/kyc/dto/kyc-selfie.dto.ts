import { IsString, MinLength } from 'class-validator';

// Claude-flow Step 4 — the live selfie captured via getUserMedia,
// posted as bare base64 JPEG (no data: prefix).
export class KycSelfieDto {
  @IsString()
  @MinLength(100, { message: 'Selfie image data is missing or too small.' })
  selfieBase64!: string;
}
