import { Body, Controller, Get, Header, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { KycOrTokenGuard } from '../auth/kyc-or-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { KycService } from './kyc.service';
import { ConsentDto } from './dto/consent.dto';
import { KycDetailsDto } from './dto/kyc-details.dto';

/** Identity data. A shared cache holding one of these is somebody's ID. */
const NoStore = () => Header('Cache-Control', 'private, no-store');

/**
 * Seller self-service identity verification.
 *
 * Every endpoint runs under KycOrTokenGuard, which accepts EITHER a member
 * session OR a KYC_VERIFY action token via `?t=<token>` — the latter lets a
 * seller finish verification straight from the SMS link without signing in.
 * Either way `@CurrentUser()` resolves to the seller's User.id, so the
 * handlers are identical. There is no admin / cross-user surface here; admin
 * override tooling lives under /admin/kyc.
 *
 * ⚠️ THE DOCUMENT AND SELFIE ROUTES ARE GONE, NOT MISLAID. Didit's hosted
 * page captures both, runs passive liveness and matches the faces, and tells
 * us by webhook. We never receive the images, which is also why there is no
 * upload limit to keep in step with the phone's door any more — that door
 * (kyc-scan.controller.ts) went with them.
 */
@Controller('kyc')
@UseGuards(KycOrTokenGuard)
export class KycController {
  constructor(private readonly kyc: KycService) {}

  /** POPIA consent. Empty body — the timestamp is what matters. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('consent')
  @NoStore()
  async consent(@CurrentUser() userId: string, @Body() _dto: ConsentDto) {
    return this.kyc.recordConsent(userId);
  }

  /**
   * ID number + date of birth.
   *
   * Tighter than the rest at 3 per 10 minutes: this is the step that decides
   * which identity the account is claiming, and the dup-hash check makes it
   * the one worth probing.
   */
  @Throttle({ default: { limit: 3, ttl: 600_000 } })
  @Post('details')
  @NoStore()
  async details(@CurrentUser() userId: string, @Body() dto: KycDetailsDto) {
    return this.kyc.submitDetails(userId, dto.idNumber, dto.dob);
  }

  /**
   * Start (or resume) the hosted verification and return the URL to open.
   *
   * ⚠️ MOBILE ONLY, BY THE PROVIDER'S RULE. The free-tier workflow sets
   * `is_desktop_allowed: false`, so a desktop member has to reach this
   * through the QR or the SMS hand-off below. The response is the same either
   * way — it is the browser that opens it that has to be a phone.
   */
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @Post('session')
  @NoStore()
  async session(@CurrentUser() userId: string) {
    return this.kyc.startVerification(userId);
  }

  /** "SMS me the link" — the desktop hand-off. */
  @Throttle({ default: { limit: 3, ttl: 600_000 } })
  @Post('handoff-sms')
  @NoStore()
  async handoffSms(@CurrentUser() userId: string) {
    return this.kyc.sendHandoffSms(userId);
  }

  /**
   * Where the member's wizard sits while the verdict is in flight.
   *
   * The verdict arrives asynchronously now, so this is polled rather than
   * being the tail of a long POST. It is also the cold-start reconciliation:
   * if a webhook was dropped, this is what notices.
   */
  @Get('status')
  @NoStore()
  async status(@CurrentUser() userId: string) {
    return this.kyc.getStatus(userId);
  }
}
