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
  UploadedFile,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { AuthOrTokenGuard } from '../auth/auth-or-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { TransactionsService } from './transactions.service';
import { TrackingService } from '../shipping/tracking.service';
import { parseAcceptSchedule } from '../shipping/pickup-dates';
import { DealerVerificationService } from './dealer-verification.service';
import { ReceiptService } from './receipt.service';
import { ActionTokensService } from '../actions/action-tokens.service';
import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { Res } from '@nestjs/common';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { CreateHoldDto } from './dto/create-hold.dto';
import { BANDS, MIN_COMMISSION_CENTS } from './fee.calculator';

@Controller('transactions')
export class TransactionsController {
  private readonly logger = new Logger(TransactionsController.name);

  constructor(
    private readonly txService: TransactionsService,
    private readonly tracking: TrackingService,
    private readonly dealerVerification: DealerVerificationService,
    private readonly receipts: ReceiptService,
    private readonly tokens: ActionTokensService,
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
  // 15-minute BUY_NOW checkout hold
  //
  // The checkout page calls GET to reuse an existing hold (or to render after
  // a reload) and POST to take one when it opens. Both accept a CHECKOUT action
  // token so an SMS-link buyer without a session can hold too. Only ONE unit is
  // reserved; extra units are reserved at Pay.
  // ---------------------------------------------------------------
  @Get('hold')
  @UseGuards(AuthOrTokenGuard)
  getHold(
    @CurrentUser() userId: string,
    @Query('listingId') listingId: string,
    @Req()
    req: Request & {
      viaActionToken?: boolean;
      actionTokenTargetId?: string;
    },
  ) {
    if (!listingId) {
      throw new BadRequestException('listingId is required.');
    }
    // A CHECKOUT token authorises ONE listing only.
    if (req.viaActionToken && req.actionTokenTargetId !== listingId) {
      throw new BadRequestException(
        'This checkout link is for a different listing.',
      );
    }
    return this.txService.getCheckoutHold(userId, listingId);
  }

  @Post('hold')
  @UseGuards(AuthOrTokenGuard)
  createHold(
    @CurrentUser() userId: string,
    @Body() dto: CreateHoldDto,
    @Req()
    req: Request & {
      viaActionToken?: boolean;
      actionTokenTargetId?: string;
    },
  ) {
    if (req.viaActionToken && req.actionTokenTargetId !== dto.listingId) {
      throw new BadRequestException(
        'This checkout link is for a different listing.',
      );
    }
    return this.txService.createCheckoutHold(userId, dto.listingId);
  }

  // ---------------------------------------------------------------
  // Create transaction + Ozow checkout (buyer)
  //
  // Accepts EITHER a member session OR a CHECKOUT action token via
  // ?t=<token>. When called via token, we double-check the token's
  // targetId matches the body's listingId — otherwise a stolen
  // token could be used to buy a DIFFERENT listing than the SMS
  // intended (would be a high-value leak otherwise).
  //
  // The token is consumed HERE, AFTER a successful checkout create — the
  // same token legitimately spans the earlier "load user" / "save address"
  // requests, so it can't be consumed on first read. Once the transaction is
  // committed the flow is done (the return leg is the unauthenticated
  // verify-result), so a leaked SMS link is single-use. Consume is best-effort:
  // the reservation CAS is the real double-buy guard, and a lost consume race
  // must not fail an already-created order.
  // ---------------------------------------------------------------
  @Post()
  @UseGuards(AuthOrTokenGuard)
  async create(
    @CurrentUser() userId: string,
    @Body() dto: CreateTransactionDto,
    @Req()
    req: Request & {
      viaActionToken?: boolean;
      actionToken?: string;
      actionTokenTargetId?: string;
    },
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
    const result = await this.txService.create(userId, dto, frontendUrl);
    if (req.viaActionToken && req.actionToken) {
      await this.tokens
        .consume(req.actionToken, req.ip, req.get('user-agent') ?? undefined)
        .catch((err) =>
          this.logger.warn(
            `CHECKOUT token consume failed after successful create: ${(err as Error).message}`,
          ),
        );
    }
    return result;
  }

  // ---------------------------------------------------------------
  // Verify Ozow payment result (called from /checkout/complete)
  // ---------------------------------------------------------------
  // INTENTIONALLY UNAUTHENTICATED — the return-from-gateway flow has no
  // the identity provider session (SMS-token buyers were never signed in) and no token
  // (the CHECKOUT token wasn't passed back). Security relies on:
  //   1. The endpoint re-fetches authoritative payment status from
  //      Ozow using the STORED payment id on the transaction — an
  //      attacker controlling only the URL's txId cannot fabricate a
  //      "paid" state.
  //   2. markPaid binds the exact amount.
  //   3. Idempotent — already-paid txs return immediately.
  //
  // What an attacker COULD do without rate limiting: enumerate
  // transaction IDs and trigger confirm side-effects (SMS to seller,
  // PRIVATE_ARRANGE immediate payout) for orders the buyer paid but
  // didn't return on. M4 — narrow per-IP throttle bounds that.
  @Post(':id/verify-result')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
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
  @UseGuards(AuthGuard)
  findAll(
    @CurrentUser() userId: string,
    @Query('role') role: 'buyer' | 'seller' = 'buyer',
  ) {
    return this.txService.findForUser(userId, role);
  }

  // ---------------------------------------------------------------
  // Single transaction detail
  // ---------------------------------------------------------------
  @Get(':id')
  @UseGuards(AuthGuard)
  findOne(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.txService.findById(id, userId);
  }

  // ---------------------------------------------------------------
  // Buyer downloads their purchase receipt (PDF). Buyer-only, paid
  // orders only — both enforced in ReceiptService.
  // ---------------------------------------------------------------
  @Get(':id/receipt')
  @UseGuards(AuthGuard)
  async receipt(
    @Param('id') id: string,
    @CurrentUser() userId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { pdf, filename } = await this.receipts.generateReceiptPdf(
      id,
      userId,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': String(pdf.length),
    });
    return new StreamableFile(Buffer.from(pdf));
  }

  // ---------------------------------------------------------------
  // Seller prints the platform-booked waybill/label (PDF). Seller-only,
  // key-safe proxy — carrier auth is applied server-side in the service.
  // ---------------------------------------------------------------
  // Seller re-books a shipment that failed. The service refuses until they
  // have actually corrected whatever broke it (see rebookShipment) — a parcel
  // that did not fit will not fit the second time.
  @Post(':id/shipment/rebook')
  @UseGuards(AuthGuard)
  async rebookShipment(
    @Param('id') id: string,
    @CurrentUser() userId: string,
  ) {
    return this.txService.rebookShipmentForSeller(id, userId);
  }

  // What the seller is told about a failed shipment: the reason in their own
  // language, whether they were charged, and whether they must re-measure.
  @Get(':id/shipment/failure')
  @UseGuards(AuthGuard)
  async shipmentFailure(
    @Param('id') id: string,
    @CurrentUser() userId: string,
  ) {
    return this.txService.shipmentFailureForSeller(id, userId);
  }

  @Get(':id/waybill')
  @UseGuards(AuthGuard)
  async waybill(
    @Param('id') id: string,
    @CurrentUser() userId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { pdf, filename } = await this.txService.getWaybillPdf(id, userId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': String(pdf.length),
    });
    return new StreamableFile(pdf);
  }

  // ---------------------------------------------------------------
  // Seller re-downloads the pre-filled SAPS 534 transfer form (PDF).
  // Seller-only, firearm DEALER_TRANSFER + paid only — all enforced in
  // the service. Rebuilt on demand so a bounced/deleted email attachment
  // is never a dead end (M21).
  // ---------------------------------------------------------------
  @Get(':id/saps534')
  @UseGuards(AuthGuard)
  async saps534(
    @Param('id') id: string,
    @CurrentUser() userId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { pdf, filename } = await this.txService.getSaps534Pdf(id, userId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': String(pdf.length),
    });
    return new StreamableFile(pdf);
  }

  // ---------------------------------------------------------------
  // Buyer confirms delivery → releases payment
  // ---------------------------------------------------------------
  @Post(':id/confirm-delivery')
  @UseGuards(AuthGuard)
  confirmDelivery(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.txService.confirmDelivery(id, userId);
  }

  // ---------------------------------------------------------------
  // Seller uploads SAPS 534 + stock register + firearm serial photos.
  // Multipart form, three named fields. Service runs Cloudinary
  // upload → Claude vision scoring in sequence and returns the
  // verification verdict.
  // ---------------------------------------------------------------
  @Post(':id/dealer-verification')
  @UseGuards(AuthGuard)
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
    @CurrentUser() userId: string,
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
    // M12 — payload-level file-type validation. Without this, multer
    // would happily accept arbitrary content types (SVG / HTML / shell
    // script with an image extension), passing them on to Claude
    // vision + Cloudinary. Restrict to common photo types only; mirror
    // the bound used in the ask-gg uploads endpoint. Reject the whole
    // submission on any single file failing — these are linked
    // payout-gating evidence; one bad file means the seller resubmits.
    const PHOTO_RE = /^image\/(jpeg|png|webp|heic|heif)$/;
    // The dealer-stamped SAP 534 may come back as a scanned PDF OR a
    // phone photo; the two evidence photos must be images. A PDF 534 is
    // sent to Claude vision as a document block (no rasterisation needed).
    const SAPS534_RE = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;
    if (!SAPS534_RE.test(saps534.mimetype)) {
      throw new BadRequestException(
        `Unsupported SAP 534 file type "${saps534.mimetype}" — upload a PDF or a JPEG/PNG/WebP/HEIC photo.`,
      );
    }
    for (const f of [stockRegister, firearmSerial]) {
      if (!PHOTO_RE.test(f.mimetype)) {
        throw new BadRequestException(
          `Unsupported file type "${f.mimetype}" — please upload JPEG, PNG, WebP or HEIC photos only.`,
        );
      }
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
      userId,
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
  @UseGuards(AuthGuard)
  @HttpCode(200)
  raiseDispute(
    @Param('id') id: string,
    @CurrentUser() userId: string,
    @Body() body: { reason?: string; details?: string },
  ) {
    const allowed = ['DAMAGED', 'WRONG_ITEM', 'NEVER_ARRIVED', 'OTHER'] as const;
    const reason = (body.reason ?? '').toUpperCase() as (typeof allowed)[number];
    if (!allowed.includes(reason)) {
      throw new BadRequestException('Invalid dispute reason');
    }
    return this.txService.raiseDispute(id, userId, reason, body.details ?? '');
  }

  // ---------------------------------------------------------------
  // Tracking timeline (buyer or seller view)
  // ---------------------------------------------------------------
  @Get(':id/tracking')
  @UseGuards(AuthGuard)
  getTracking(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.tracking.getTimeline(id, userId);
  }

  // ---------------------------------------------------------------
  // Seller confirms dispatch
  // ---------------------------------------------------------------
  @Post(':id/dispatch')
  @UseGuards(AuthGuard)
  confirmDispatch(
    @Param('id') id: string,
    @CurrentUser() userId: string,
    @Body() body: { trackingReference?: string },
  ) {
    return this.txService.confirmDispatch(id, userId, body);
  }

  // ---------------------------------------------------------------
  // Seller accepts the sale (TOK-7 Phase 2)
  // ---------------------------------------------------------------
  // Signed-in seller's Accept button on /transactions/[id]. Mirrors the
  // /actions/:token/accept-transaction endpoint that the SMS one-tap
  // uses, just guarded by the identity provider session instead of a token. Idempotent.
  @Post(':id/accept')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  accept(
    @Param('id') id: string,
    @CurrentUser() userId: string,
    @Body() body: { collectionNotBefore?: string; collectionWindow?: string },
  ) {
    return this.txService.acceptTransaction(
      id,
      userId,
      parseAcceptSchedule(body ?? {}),
    );
  }

  // ---------------------------------------------------------------
  // Seller rejects the sale (TOK-7 Phase 2)
  // ---------------------------------------------------------------
  // Reason required. Fires Ozow refund + reactivates listing + notifies
  // buyer. Allowed reason codes are validated client-side in the picker
  // and a free-text "other" reason gets passed through to the service.
  @Post(':id/reject')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  reject(
    @Param('id') id: string,
    @CurrentUser() userId: string,
    @Body() body: { reason?: string },
  ) {
    return this.txService.rejectTransaction(id, userId, body?.reason ?? '');
  }

  // ---------------------------------------------------------------
  // Buyer REQUESTs a cancellation of a paid-but-undispatched order
  // (Phase 4 rework). Reason required. This FREEZES the order (no accept,
  // booking, dispatch or payout), notifies the seller and raises an admin
  // alert — no money moves. Support resolves it with a fee-retained refund.
  // Available on every HELD rail.
  // ---------------------------------------------------------------
  @Post(':id/cancel-request')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  requestCancellation(
    @Param('id') id: string,
    @CurrentUser() userId: string,
    @Body() body: { reason?: string },
  ) {
    return this.txService.requestCancellation(id, userId, body?.reason ?? '');
  }

  // ---------------------------------------------------------------
  // Private Arrangement handover (Phase 4 W2). Funds stay HELD: the seller
  // marks "delivered", the buyer confirms "received" (releases the payout),
  // or either party disputes (freezes + admin). All in-app + WhatsApp.
  // ---------------------------------------------------------------
  @Post(':id/private-arrange/delivered')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  privateArrangeDelivered(
    @Param('id') id: string,
    @CurrentUser() userId: string,
  ) {
    return this.txService.markPrivateArrangeDelivered(id, userId);
  }

  @Post(':id/private-arrange/received')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  privateArrangeReceived(
    @Param('id') id: string,
    @CurrentUser() userId: string,
  ) {
    return this.txService.confirmPrivateArrangeReceived(id, userId);
  }

  @Post(':id/private-arrange/dispute')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  privateArrangeDispute(
    @Param('id') id: string,
    @CurrentUser() userId: string,
    @Body() body: { reason?: string },
  ) {
    return this.txService.disputePrivateArrange(id, userId, body?.reason ?? '');
  }

  // ---------------------------------------------------------------
  // ---------------------------------------------------------------
  // Proof-of-delivery photo upload (Phase 5 P5.3). Buyer OR seller may
  // attach a single delivery photo as dispute evidence — does NOT gate
  // payout (that stays on the buyer's Confirm Delivery). Owner-checked +
  // dispatch-gated in the service.
  // ---------------------------------------------------------------
  @Post(':id/pod-proof')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('photo', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  uploadPodProof(
    @Param('id') id: string,
    @CurrentUser() userId: string,
    @UploadedFile() photo: Express.Multer.File,
  ) {
    return this.txService.uploadPodProof(id, userId, photo);
  }
}

// ---------------------------------------------------------------
// Ozow webhooks — separate controller so path is /api/payments/...
// ---------------------------------------------------------------
@Controller('payments')
export class PaymentsWebhookController {
  private readonly logger = new Logger(PaymentsWebhookController.name);

  constructor(private readonly txService: TransactionsService) {}

  // One API signs each webhook with Svix headers (svix-id, svix-timestamp,
  // svix-signature) over `${id}.${timestamp}.${rawBody}`. NestFactory is
  // created with { rawBody: true } (main.ts) so req.rawBody is the exact
  // bytes signed — re-serialising would reorder keys and never match. A
  // bad-signature drop is logged + alerted and returns 200 (retrying a
  // forged delivery is pointless). A handler FAILURE returns 500 so Ozow
  // re-delivers — there is no poll fallback for a missed notification.
  // Verification fails closed in production.
  @Post('webhook/ozow')
  @HttpCode(200)
  async ozowWebhook(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ) {
    this.logger.log('Ozow webhook received');
    const headers = {
      id: req.headers['svix-id'] as string | undefined,
      timestamp: req.headers['svix-timestamp'] as string | undefined,
      signature: req.headers['svix-signature'] as string | undefined,
    };
    const rawBody =
      (req as Request & { rawBody?: Buffer }).rawBody?.toString('utf8') ??
      JSON.stringify(body);
    const valid = this.txService.verifyOzowWebhook(rawBody, headers);
    if (!valid) {
      this.logger.warn('Ozow webhook signature invalid — dropping');
      void this.txService.alertWebhookSignatureFailure('ozow-payment');
      return { received: true };
    }
    try {
      await this.txService.handleOzowWebhook(body);
    } catch (err) {
      // Re-throw as a 500 so Ozow RETRIES the delivery. Swallowing this with a
      // 200 consumed the one notification on any transient failure (DB, OAuth)
      // and, with no poll/reconcile fallback, stranded a paid order forever.
      // Genuine "cannot process" cases (bad amount on markPaid, unmatched ref,
      // non-success status) are handled inside handleOzowWebhook and return
      // normally — only unexpected errors reach here, and those are retryable.
      this.logger.error(
        `Ozow webhook handler failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw new InternalServerErrorException('Webhook processing failed');
    }
    return { received: true };
  }

  // Ozow payout VERIFICATION webhook. Ozow authenticates with the AccessToken
  // header and signs the payload with a SHA-512 hashCheck. We verify both,
  // confirm the payout was initiated by us, and return the AES decryption key
  // Ozow needs to decrypt the destination account number it is about to pay.
  @Post('webhook/ozow-payout-verify')
  @HttpCode(200)
  async ozowPayoutVerify(@Req() req: Request, @Body() body: Record<string, unknown>) {
    this.logger.log('Ozow payout verification webhook received');
    const accessToken = req.headers['accesstoken'] as string | undefined;
    if (!this.txService.ozowPayoutAccessTokenValid(accessToken)) {
      this.logger.warn('Ozow payout verification: invalid access token');
      const rawPayoutId = body.payoutId ?? body.PayoutId;
      return {
        payoutId: typeof rawPayoutId === 'string' ? rawPayoutId : '',
        isVerified: false,
        accountNumberDecryptionKey: '',
        reason: 'Unauthorized webhook call',
      };
    }
    try {
      return await this.txService.handleOzowPayoutVerify(body);
    } catch (err) {
      this.logger.error(
        `Ozow payout verification handler failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
      const rawPayoutId = body.payoutId ?? body.PayoutId;
      return {
        payoutId: typeof rawPayoutId === 'string' ? rawPayoutId : '',
        isVerified: false,
        accountNumberDecryptionKey: '',
        reason: 'Server error',
      };
    }
  }

  // Ozow payout NOTIFICATION webhook (final payout status). SHA-512 hash
  // checked before any ledger change; always 200.
  @Post('webhook/ozow-payout')
  @HttpCode(200)
  async ozowPayoutNotification(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ) {
    this.logger.log('Ozow payout notification webhook received');
    try {
      await this.txService.handleOzowPayoutNotification(body);
    } catch (err) {
      this.logger.error(
        `Ozow payout notification handler failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
    return { received: true };
  }
}
