import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import {
  BallisticsService,
  type BallisticsInput,
} from './ballistics.service';
import {
  BallisticsBulletLookupService,
  type BulletLookupResult,
} from './ballistics-bullet-lookup.service';
import { BallisticsPurchaseService } from './ballistics-purchase.service';
import {
  BallisticsProfilesService,
  type ProfileDto,
} from './ballistics-profiles.service';
import { PeachService } from '../payments/peach.service';

/**
 * /api/ballistics — the standalone Ballistic Calculator PWA backend.
 *
 *   POST   /ballistics/calculate              public — pure-math (server fallback for shareable URLs)
 *   POST   /ballistics/lookup-bullet          Clerk-authed — Claude bullet lookup (demo OR paid)
 *   POST   /ballistics/purchase/checkout      Clerk-authed — start Peach checkout for R299 license
 *   POST   /ballistics/purchase/refund        admin-only — refund + clear license (called from /admin)
 *   GET    /ballistics/license                Clerk-authed — { purchased: bool, demoUsed: bool }
 *   GET    /ballistics/profiles               purchasers only
 *   POST   /ballistics/profiles               purchasers only
 *   PATCH  /ballistics/profiles/:id           purchasers only
 *   DELETE /ballistics/profiles/:id           purchasers only
 *   POST   /ballistics/profiles/:id/duplicate purchasers only
 *
 * `calculate` is the ONLY public endpoint (no auth) — shareable URLs
 * (`/ballistics?bw=168&bc=0.491&...`) need server-side render fallback
 * for SEO + first-paint speed. The math is cheap and identical to the
 * client-side TS port, so no abuse-amplification risk.
 *
 * Other routes require Clerk auth. Profile CRUD additionally requires
 * `ballisticsPurchasedAt` to be set on the User row (the paid license).
 */
@Controller('ballistics')
export class BallisticsController {
  private readonly logger = new Logger(BallisticsController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ballistics: BallisticsService,
    private readonly lookup: BallisticsBulletLookupService,
    private readonly purchase: BallisticsPurchaseService,
    private readonly profiles: BallisticsProfilesService,
    private readonly peach: PeachService,
  ) {}

  // ── Peach webhook (ballistics-specific) ─────────────────────────────
  // Peach POSTs here for every ballistic-license payment because
  // `createCheckout` overrides the notificationUrl to point at this
  // route. Marketplace transactions go to /api/payments/webhook/peach
  // unchanged. Single 200 response always (CLAUDE.md rule).
  @SkipThrottle()
  @Post('webhook/peach')
  @HttpCode(200)
  async peachWebhook(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ) {
    this.logger.log('Peach webhook received (ballistics)');
    try {
      const result = this.peach.parseWebhookPayload(body);
      if (!result.isSuccess) {
        this.logger.warn(
          `Ballistics webhook: payment ${result.paymentId} not successful (${result.resultCode})`,
        );
        return { received: true };
      }
      await this.purchase.applyVerifiedPayment({
        merchantTransactionId: result.merchantTransactionId,
        peachPaymentId: result.paymentId,
        amountCents: result.amount,
      });
    } catch (err) {
      this.logger.error(
        `Ballistics webhook handler threw: ${err instanceof Error ? err.message : err}`,
      );
    }
    return { received: true };
  }

  // ── Public math endpoint ────────────────────────────────────────────
  // No auth. Used by:
  //   - Server-rendered shareable URL pages on first paint
  //   - Anyone who wants to call the calc via API (parity vs client TS)
  // The math is identical to the client-side port so the result is
  // always the same — keeping the server route is just for the SSR
  // hydration path + non-PWA contexts.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('calculate')
  @HttpCode(200)
  calculate(@Body() body: BallisticsInput) {
    this.assertBallisticsInput(body);
    return this.ballistics.calculate(body);
  }

  // ── AI Bullet Lookup ───────────────────────────────────────────────
  // Clerk-required (so we can bill the demo lookup against the user's
  // ballisticsDemoLookupAt flag). Behaviour:
  //   - Purchaser → unlimited within fair-use (4 lookups/min cap below
  //     is the only rate limit; lifetime usage tracked for cost view).
  //   - Demo (not purchased) AND no demo used → set
  //     ballisticsDemoLookupAt and serve.
  //   - Demo used AND not purchased → 403 with the purchase CTA.
  @UseGuards(ClerkGuard)
  @Throttle({ default: { limit: 4, ttl: 60_000 } })
  @Post('lookup-bullet')
  async lookupBullet(
    @CurrentUser() clerkId: string,
    @Body() body: { query?: string },
  ): Promise<BulletLookupResult & { wasDemo: boolean }> {
    const query = (body.query ?? '').trim();
    if (!query) {
      throw new BadRequestException('Bullet description is required.');
    }
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: {
        id: true,
        ballisticsPurchasedAt: true,
        ballisticsDemoLookupAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found.');

    const purchased = !!user.ballisticsPurchasedAt;
    if (!purchased) {
      if (user.ballisticsDemoLookupAt) {
        throw new ForbiddenException({
          message:
            'You\'ve used your free demo lookup. Buy the lifetime license (R299) to keep going.',
          code: 'ballistics-demo-exhausted',
          priceCents: 29900,
        });
      }
    }

    const result = await this.lookup.lookup(query);

    // Stamp the demo flag AFTER the lookup completes so a Claude
    // failure mid-flight doesn't burn the user's one free try.
    if (!purchased && !user.ballisticsDemoLookupAt) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { ballisticsDemoLookupAt: new Date() },
      });
    }

    return { ...result, wasDemo: !purchased };
  }

  // ── License + purchase ──────────────────────────────────────────────
  @UseGuards(ClerkGuard)
  @Get('license')
  async license(@CurrentUser() clerkId: string) {
    const u = await this.prisma.user.findUnique({
      where: { clerkId },
      select: {
        ballisticsPurchasedAt: true,
        ballisticsDemoLookupAt: true,
        ballisticsPurchaseAmountCents: true,
      },
    });
    if (!u) throw new NotFoundException('User not found.');
    return {
      purchased: !!u.ballisticsPurchasedAt,
      purchasedAt: u.ballisticsPurchasedAt,
      amountCents: u.ballisticsPurchaseAmountCents,
      demoLookupUsed: !!u.ballisticsDemoLookupAt,
      priceCents: 29900,
    };
  }

  @UseGuards(ClerkGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('purchase/checkout')
  async startPurchase(@CurrentUser() clerkId: string) {
    return this.purchase.createCheckout(clerkId);
  }

  // ── Profile CRUD (purchasers only) ──────────────────────────────────
  @UseGuards(ClerkGuard)
  @Get('profiles')
  async listProfiles(@CurrentUser() clerkId: string) {
    const userId = await this.purchase.requireLicense(clerkId);
    return this.profiles.list(userId);
  }

  @UseGuards(ClerkGuard)
  @Post('profiles')
  async createProfile(
    @CurrentUser() clerkId: string,
    @Body() body: ProfileDto,
  ) {
    const userId = await this.purchase.requireLicense(clerkId);
    return this.profiles.create(userId, body);
  }

  @UseGuards(ClerkGuard)
  @Patch('profiles/:id')
  async updateProfile(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body() body: Partial<ProfileDto>,
  ) {
    const userId = await this.purchase.requireLicense(clerkId);
    return this.profiles.update(userId, id, body);
  }

  @UseGuards(ClerkGuard)
  @Delete('profiles/:id')
  async deleteProfile(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
  ) {
    const userId = await this.purchase.requireLicense(clerkId);
    return this.profiles.delete(userId, id);
  }

  @UseGuards(ClerkGuard)
  @Post('profiles/:id/duplicate')
  async duplicateProfile(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body() body: { name?: string },
  ) {
    const userId = await this.purchase.requireLicense(clerkId);
    return this.profiles.duplicate(userId, id, body.name ?? '');
  }

  // ── Validators ─────────────────────────────────────────────────────
  private assertBallisticsInput(input: BallisticsInput): void {
    if (
      typeof input.bulletWeightGr !== 'number' ||
      input.bulletWeightGr <= 0 ||
      input.bulletWeightGr > 1000
    ) {
      throw new BadRequestException('bulletWeightGr must be 1–1000 grains.');
    }
    if (
      typeof input.bcG1 !== 'number' ||
      input.bcG1 <= 0 ||
      input.bcG1 > 1.5
    ) {
      throw new BadRequestException('bcG1 must be 0.05–1.5.');
    }
    if (
      typeof input.muzzleVelocityFps !== 'number' ||
      input.muzzleVelocityFps < 100 ||
      input.muzzleVelocityFps > 5000
    ) {
      throw new BadRequestException('muzzleVelocityFps must be 100–5000.');
    }
    if (
      typeof input.zeroM !== 'number' ||
      input.zeroM < 5 ||
      input.zeroM > 1000
    ) {
      throw new BadRequestException('zeroM must be 5–1000 metres.');
    }
    if (input.ranges) {
      if (!Array.isArray(input.ranges) || input.ranges.length > 30) {
        throw new BadRequestException('ranges must be an array of ≤ 30 entries.');
      }
      for (const r of input.ranges) {
        if (typeof r !== 'number' || r < 1 || r > 3000) {
          throw new BadRequestException('Each range must be 1–3000 metres.');
        }
      }
    }
  }
}
