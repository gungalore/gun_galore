import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  HttpCode,
  UseGuards,
  UploadedFiles,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import { ClerkGuard } from '../auth/clerk.guard';
import { ClerkOrTokenGuard } from '../auth/clerk-or-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { TransactionsService } from './transactions.service';
import { TrackingService } from '../shipping/tracking.service';
import { DealerVerificationService } from './dealer-verification.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { BANDS, MIN_COMMISSION_CENTS } from './fee.calculator';

@Controller('transactions')
export class TransactionsController {
  private readonly logger = new Logger(TransactionsController.name);

  constructor(
    private readonly txService: TransactionsService,
    private readonly tracking: TrackingService,
    private readonly dealerVerification: DealerVerificationService,
  ) {}

  // Public — exposes the platform fee schedule for the Sell form
  // explainer. Bands + minimum fee come from FeeCalculator constants so
  // there's one source of truth across the codebase.
  @Get('fees/schedule')
  feeSchedule() {
    return {
      bands: BANDS.map((b) => ({
        // `limit` is the WIDTH of the slice in cents — frontend converts
        // to cumulative caps for display.
        widthCents: isFinite(b.limit) ? b.limit : null,
        rate: b.rate,
        label: b.label,
      })),
      minimumCommissionCents: MIN_COMMISSION_CENTS,
    };
  }

  // ---------------------------------------------------------------
  // Create transaction + Peach checkout (buyer)
  //
  // Accepts EITHER a Clerk session OR a CHECKOUT action token via
  // ?t=<token>. When called via token, we double-check the token's
  // targetId matches the body's listingId — otherwise a stolen
  // token could be used to buy a DIFFERENT listing than the SMS
  // intended (would be a high-value leak otherwise).
  //
  // The token is NOT consumed here. A CHECKOUT token spans several
  // requests (load user, save address, this call) and we want it to
  // stay valid through the whole flow. Consumption is a follow-up
  // task; for v1 the token just naturally expires at its 24h TTL.
  // ---------------------------------------------------------------
  @Post()
  @UseGuards(ClerkOrTokenGuard)
  async create(
    @CurrentUser() clerkId: string,
    @Body() dto: CreateTransactionDto,
    @Req() req: Request & { viaActionToken?: boolean; actionTokenTargetId?: string },
  ) {
    // Token-auth safety check — the token authorises checkout on
    // ONE specific listing. Refuse if the body's listingId doesn't
    // match (defence against SMS-link redirection / mix-up).
    if (req.viaActionToken && req.actionTokenTargetId !== dto.listingId) {
      throw new BadRequestException(
        'This checkout link is for a different listing.',
      );
    }
    const frontendUrl =
      process.env.FRONTEND_URL ?? `${req.protocol}://${req.get('host') ?? 'localhost:3000'}`;
    return this.txService.create(clerkId, dto, frontendUrl);
  }

  // ---------------------------------------------------------------
  // Verify Peach result (called from result page)
  // ---------------------------------------------------------------
  @Post(':id/verify-result')
  verifyResult(
    @Param('id') id: string,
    @Body('resourcePath') resourcePath: string,
  ) {
    return this.txService.verifyResult(id, resourcePath);
  }

  // ---------------------------------------------------------------
  // Fetch all transactions (buyer or seller view)
  // ---------------------------------------------------------------
  @Get()
  @UseGuards(ClerkGuard)
  findAll(
    @CurrentUser() clerkId: string,
    @Query('role') role: 'buyer' | 'seller' = 'buyer',
  ) {
    return this.txService.findForUser(clerkId, role);
  }

  // ---------------------------------------------------------------
  // Single transaction detail
  // ---------------------------------------------------------------
  @Get(':id')
  @UseGuards(ClerkGuard)
  findOne(@Param('id') id: string, @CurrentUser() clerkId: string) {
    return this.txService.findById(id, clerkId);
  }

  // ---------------------------------------------------------------
  // Buyer confirms delivery → releases payment
  // ---------------------------------------------------------------
  @Post(':id/confirm-delivery')
  @UseGuards(ClerkGuard)
  confirmDelivery(@Param('id') id: string, @CurrentUser() clerkId: string) {
    return this.txService.confirmDelivery(id, clerkId);
  }

  // ---------------------------------------------------------------
  // Seller uploads SAPS 534 + stock register + firearm serial photos.
  // Multipart form, three named fields. Service runs Cloudinary
  // upload → Claude vision scoring in sequence and returns the
  // verification verdict.
  // ---------------------------------------------------------------
  @Post(':id/dealer-verification')
  @UseGuards(ClerkGuard)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'saps534', maxCount: 1 },
        { name: 'stockRegister', maxCount: 1 },
        { name: 'firearmSerial', maxCount: 1 },
      ],
      // 10MB per file — accommodates a phone photo even when the
      // client-side downscale couldn't run (e.g. desktop upload of an
      // un-optimised iPhone export).
      { limits: { fileSize: 10 * 1024 * 1024 } },
    ),
  )
  uploadDealerVerification(
    @Param('id') id: string,
    @CurrentUser() clerkId: string,
    @UploadedFiles()
    files: {
      saps534?: Express.Multer.File[];
      stockRegister?: Express.Multer.File[];
      firearmSerial?: Express.Multer.File[];
    },
    @Body()
    body: {
      dealerStockRegisterRef?: string;
      stockedAtDealerName?: string;
      stockedAtDealerAddress?: string;
      stockedAtDealerPhone?: string;
    },
  ) {
    const saps534 = files.saps534?.[0];
    const stockRegister = files.stockRegister?.[0];
    const firearmSerial = files.firearmSerial?.[0];
    if (!saps534 || !stockRegister || !firearmSerial) {
      throw new BadRequestException(
        'All three photos are required: saps534, stockRegister, firearmSerial.',
      );
    }
    // Dealer contact details captured at upload time — these get
    // surfaced to the buyer on approval so they know where the
    // firearm is sitting + can arrange the rest. Required, not just
    // optional: the whole point of the new flow is that the buyer
    // gets these details on payout release.
    const name = (body?.stockedAtDealerName ?? '').trim();
    const address = (body?.stockedAtDealerAddress ?? '').trim();
    const phone = (body?.stockedAtDealerPhone ?? '').trim();
    if (!name || !address || !phone) {
      throw new BadRequestException(
        "Provide the receiving dealer's name, address, and phone number — these go to the buyer once the verification approves.",
      );
    }
    return this.dealerVerification.uploadAndScore(
      id,
      clerkId,
      { saps534, stockRegister, firearmSerial },
      body?.dealerStockRegisterRef,
      { name, address, phone },
    );
  }

  // ---------------------------------------------------------------
  // Buyer raises a dispute. Body: { reason, details }
  // reason: 'DAMAGED' | 'WRONG_ITEM' | 'NEVER_ARRIVED' | 'OTHER'
  // details: min 10 chars free-text describing the issue.
  // ---------------------------------------------------------------
  @Post(':id/dispute')
  @UseGuards(ClerkGuard)
  @HttpCode(200)
  raiseDispute(
    @Param('id') id: string,
    @CurrentUser() clerkId: string,
    @Body() body: { reason?: string; details?: string },
  ) {
    const allowed = ['DAMAGED', 'WRONG_ITEM', 'NEVER_ARRIVED', 'OTHER'] as const;
    const reason = (body.reason ?? '').toUpperCase() as (typeof allowed)[number];
    if (!allowed.includes(reason)) {
      throw new Error('Invalid dispute reason');
    }
    return this.txService.raiseDispute(id, clerkId, reason, body.details ?? '');
  }

  // ---------------------------------------------------------------
  // Tracking timeline (buyer or seller view)
  // ---------------------------------------------------------------
  @Get(':id/tracking')
  @UseGuards(ClerkGuard)
  getTracking(@Param('id') id: string, @CurrentUser() clerkId: string) {
    return this.tracking.getTimeline(id, clerkId);
  }

  // ---------------------------------------------------------------
  // Seller confirms dispatch
  // ---------------------------------------------------------------
  @Post(':id/dispatch')
  @UseGuards(ClerkGuard)
  confirmDispatch(
    @Param('id') id: string,
    @CurrentUser() clerkId: string,
    @Body() body: { pudoDropoffLockerId?: string; trackingReference?: string },
  ) {
    return this.txService.confirmDispatch(id, clerkId, body);
  }

  // ---------------------------------------------------------------
  // Seller accepts the sale (TOK-7 Phase 2)
  // ---------------------------------------------------------------
  // Signed-in seller's Accept button on /transactions/[id]. Mirrors the
  // /actions/:token/accept-transaction endpoint that the SMS one-tap
  // uses, just guarded by Clerk session instead of a token. Idempotent.
  @Post(':id/accept')
  @UseGuards(ClerkGuard)
  @HttpCode(200)
  accept(@Param('id') id: string, @CurrentUser() clerkId: string) {
    return this.txService.acceptTransaction(id, clerkId);
  }

  // ---------------------------------------------------------------
  // Seller rejects the sale (TOK-7 Phase 2)
  // ---------------------------------------------------------------
  // Reason required. Fires Peach refund + reactivates listing + notifies
  // buyer. Allowed reason codes are validated client-side in the picker
  // and a free-text "other" reason gets passed through to the service.
  @Post(':id/reject')
  @UseGuards(ClerkGuard)
  @HttpCode(200)
  reject(
    @Param('id') id: string,
    @CurrentUser() clerkId: string,
    @Body() body: { reason?: string },
  ) {
    return this.txService.rejectTransaction(id, clerkId, body?.reason ?? '');
  }
}

// ---------------------------------------------------------------
// Peach webhook — separate controller so path is /api/payments/...
// ---------------------------------------------------------------
@Controller('payments')
export class PaymentsWebhookController {
  private readonly logger = new Logger(PaymentsWebhookController.name);

  constructor(private readonly txService: TransactionsService) {}

  // Peach signs webhooks with HMAC-SHA256 over the raw body. We verify with
  // the merchant secret if PEACH_WEBHOOK_SECRET is set; otherwise we pass
  // through (dev / not-yet-configured). The controller ALWAYS returns 200
  // (CLAUDE.md rule) — silent rejection on bad signatures is logged.
  @Post('webhook/peach')
  @HttpCode(200)
  async peachWebhook(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ) {
    this.logger.log('Peach webhook received');

    // The signature header name is Peach's — confirm with BANVR docs.
    const signature =
      (req.headers['x-peach-signature'] as string | undefined) ??
      (req.headers['x-signature'] as string | undefined);

    // Use the TRUE raw request body for HMAC verification. NestFactory is
    // created with { rawBody: true } (main.ts), so req.rawBody holds the
    // exact bytes Peach signed. Re-serialising via JSON.stringify(body)
    // would reorder/reformat keys and never match the signature. Fall back
    // to the serialized form only if rawBody is somehow absent (it won't be
    // in prod) — verifyWebhookSignature fails closed in production anyway.
    const rawBody =
      (req as Request & { rawBody?: Buffer }).rawBody?.toString('utf8') ??
      JSON.stringify(body);
    const valid = this.txService.verifyPeachWebhook(rawBody, signature);
    if (!valid) {
      this.logger.warn('Peach webhook signature invalid — dropping');
      return { received: true };
    }

    await this.txService.handlePeachWebhook(body);
    return { received: true };
  }
}
