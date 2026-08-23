import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { KycOrTokenGuard } from '../auth/kyc-or-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { KycService } from './kyc.service';
import { ConsentDto } from './dto/consent.dto';
import { VerifyIdDto } from './dto/verify-id.dto';
import { FaceMatchDto } from './dto/face-match.dto';
import { KycDetailsDto } from './dto/kyc-details.dto';
import { KycSelfieDto } from './dto/kyc-selfie.dto';

// ID-document upload constraints (Claude flow). PDF is allowed because
// many sellers only have a scanned copy of their ID; magic-byte sniffing
// in the service catches PDFs with lying extensions.
//
// ⚠️ EXPORTED SO THE PHONE'S DOOR CANNOT DRIFT FROM THE DESK'S. The QR
// hand-off posts the same document to the same service through
// kyc-scan.controller.ts; a second copy of these limits is a second thing to
// remember to change, and the one that gets forgotten is always the one that
// lets something in.
export const ID_DOC_MIME_RE =
  /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;
export const ID_DOC_MAX_BYTES = 10 * 1024 * 1024; // 10 MB — same as dealer uploads

// All endpoints here are seller-self-service. They run under
// KycOrTokenGuard, which accepts EITHER a Clerk session OR a KYC_VERIFY
// action token via ?t=<token> — the latter lets a seller complete
// verification straight from the SMS link without signing in. Either way
// @CurrentUser() resolves to the seller's clerkId, so the handlers are
// identical. There's no admin / cross-user surface here (admin KYC
// override tooling lives under /admin/kyc).
@Controller('kyc')
@UseGuards(KycOrTokenGuard)
export class KycController {
  constructor(private readonly kyc: KycService) {}

  // POPIA consent. Empty body — the timestamp is what matters.
  @Post('consent')
  async consent(@CurrentUser() clerkId: string, @Body() _dto: ConsentDto) {
    return this.kyc.recordConsent(clerkId);
  }

  // Step 1: Home Affairs ID lookup. Returns the official names so the
  // frontend can show the seller a "is this you?" confirmation before
  // they move on to the selfie step.
  @Post('verify-id')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async verifyId(@CurrentUser() clerkId: string, @Body() dto: VerifyIdDto) {
    return this.kyc.verifyId(clerkId, dto.idNumber);
  }

  // Step 2: selfie face-match. The frontend captures from getUserMedia()
  // and posts the base64 image plus the same idNumber from step 1 so the
  // VerifyNow request body has both fields.
  @Post('face-match')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async faceMatch(
    @CurrentUser() clerkId: string,
    @Body() dto: FaceMatchDto,
  ) {
    return this.kyc.submitFaceMatch(clerkId, dto.selfieBase64, dto.idNumber);
  }

  // Selfie-only KYC for sellers who already submitted their SA ID
  // via the post-publish profile-completion modal. We read the
  // encrypted ID off User, run Home Affairs + facematch in one shot,
  // then purge the encrypted blob. The frontend only has to send the
  // selfie — no ID re-typing.
  @Post('selfie-only')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async selfieOnly(
    @CurrentUser() clerkId: string,
    @Body() body: { selfieBase64: string },
  ) {
    return this.kyc.completeKycWithSelfie(clerkId, body.selfieBase64);
  }

  // ── Claude-vision flow (kyc_claude_flow_enabled) ──────────────────
  // The service throws when the flag is off, so these are inert until
  // rollout and the legacy endpoints above remain the fallback.

  // Step 2: SA ID number + date of birth. Luhn + SA ID Basic (1 credit).
  @Post('details')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async details(@CurrentUser() clerkId: string, @Body() dto: KycDetailsDto) {
    return this.kyc.submitDetails(clerkId, dto.idNumber, dto.dob);
  }

  // Step 3: the ID document itself (photo or PDF scan).
  @Post('id-document')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('document', { limits: { fileSize: ID_DOC_MAX_BYTES } }),
  )
  async idDocument(
    @CurrentUser() clerkId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No document uploaded.');
    if (!ID_DOC_MIME_RE.test(file.mimetype)) {
      throw new BadRequestException(
        'Upload your ID as a photo (JPEG/PNG/WEBP/HEIC) or a PDF scan.',
      );
    }
    return this.kyc.submitIdDocument(clerkId, file);
  }

  // Step 4: live selfie → the single Claude verdict.
  @Post('selfie')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async selfie(@CurrentUser() clerkId: string, @Body() dto: KycSelfieDto) {
    return this.kyc.submitSelfieClaudeVerdict(clerkId, dto.selfieBase64);
  }

  // "SMS me the link" — desktop-without-camera handoff to the phone.
  // Tighter throttle than the steps; the service adds a per-user 3/hour
  // mint cap on top (the throttler is IP-keyed).
  @Post('handoff-sms')
  @Throttle({ default: { limit: 3, ttl: 600_000 } })
  async handoffSms(@CurrentUser() clerkId: string) {
    return this.kyc.sendHandoffSms(clerkId);
  }

  // Poll endpoint for the frontend to refresh the status pill without a
  // full /users/me round-trip. Extended with flow/steps/nextStep — the
  // wizard's save-&-resume state.
  @Get('status')
  async status(@CurrentUser() clerkId: string) {
    return this.kyc.getStatus(clerkId);
  }
}
