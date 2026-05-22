import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { KycService } from './kyc.service';
import { ConsentDto } from './dto/consent.dto';
import { VerifyIdDto } from './dto/verify-id.dto';
import { FaceMatchDto } from './dto/face-match.dto';

// All endpoints here are seller-self-service. They run under ClerkGuard
// so we have a clerkId on every request — there's no admin / cross-user
// surface here (admin tooling for forcing/overriding KYC will live under
// /admin/kyc once we have the VerifyNow balance + credits APIs wired).
@Controller('kyc')
@UseGuards(ClerkGuard)
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
  async verifyId(@CurrentUser() clerkId: string, @Body() dto: VerifyIdDto) {
    return this.kyc.verifyId(clerkId, dto.idNumber);
  }

  // Step 2: selfie face-match. The frontend captures from getUserMedia()
  // and posts the base64 image plus the same idNumber from step 1 so the
  // VerifyNow request body has both fields.
  @Post('face-match')
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
  async selfieOnly(
    @CurrentUser() clerkId: string,
    @Body() body: { selfieBase64: string },
  ) {
    return this.kyc.completeKycWithSelfie(clerkId, body.selfieBase64);
  }

  // Poll endpoint for the frontend to refresh the status pill without a
  // full /users/me round-trip.
  @Get('status')
  async status(@CurrentUser() clerkId: string) {
    return this.kyc.getStatus(clerkId);
  }
}
