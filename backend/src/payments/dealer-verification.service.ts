import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ZohoBooksService } from '../zoho/zoho-books.service';
import { ShippingService } from '../shipping/shipping.service';

/**
 * Dealer stock-in verification — when a firearm DEALER_TRANSFER
 * transaction reaches the dealer, the seller submits 3 photos that
 * prove the firearm is actually in the dealer's stock and lawfully
 * booked in:
 *
 *   1. SAPS 534 form — "Notification of Change in Ownership /
 *      Possession" — completed by the dealer, stamped (or signed +
 *      printed name) in BLOCK LETTERS.
 *
 *   2. Last line of the dealer's stock register (FCA Regulation 86) —
 *      the dealer's most recent entry, with the firearm's make /
 *      model / serial and the entry number visible. Sellers are
 *      instructed to photograph ONLY the last line so no other
 *      customers' details are exposed.
 *
 *   3. The firearm itself with its serial number visible, next to a
 *      slip of paper showing the Gun Galore order reference.
 *
 * Claude vision (Sonnet — same model the listing moderator uses)
 * scans all three in a single call and returns a structured JSON
 * with per-criterion scores. We compute a weighted average + decide
 * the outcome:
 *
 *   - All criteria ≥ 80 confidence  → APPROVED (auto, payout fires)
 *   - Any criterion 50-79           → PENDING_ADMIN_REVIEW (human eyes)
 *   - Any criterion < 50            → REJECTED (seller must reshoot)
 *
 * The full findings JSON is persisted on the Transaction so the admin
 * panel can re-render Claude's reasoning without burning another
 * vision call.
 */

// Same model the listing moderator uses — Sonnet for vision reasoning.
const MODEL_VISION =
  process.env.ANTHROPIC_MODEL_JUDGE ?? 'claude-sonnet-4-6';

// Score thresholds. Mirror the listing-moderation convention.
const AUTO_APPROVE_FLOOR = 80;
const AUTO_REJECT_CEILING = 50;

export type DealerVerificationStatus =
  | 'PENDING_UPLOAD'
  | 'PENDING_CLAUDE'
  | 'PENDING_ADMIN_REVIEW'
  | 'APPROVED'
  | 'REJECTED';

export interface DealerVerificationFindings {
  saps534: {
    all_fields_filled: number;          // 0..100 confidence the form is complete
    dealer_stamp_or_signature: number;  // stamp visible OR signed + printed name visible
    block_letters: number;              // handwriting is in block capitals
    dealer_licence_visible: number;     // dealer's licence number readable on the form
    extracted_dealer_licence: string | null; // what Claude read; we compare to our Dealer record
    // Section D firearm "type" — deliberately left blank on the prefilled
    // form (P3); the dealer fills it, and we read it back here.
    firearm_type: string | null;
    // Serial as written in Section D of the returned form, cross-checked
    // against the listing's recorded serial.
    extracted_firearm_serial: string | null;
    firearm_serial_matches_listing: number; // 0..100
    issues: string[];
  };
  stockRegister: {
    last_line_only: number;             // privacy check — no other entries visible
    extracted_serial: string | null;
    serial_matches_listing: number;     // does the extracted serial match listing.make/model serial?
    extracted_entry_number: string | null; // the dealer's stock-register row number
    issues: string[];
  };
  firearm: {
    serial_legible: number;
    extracted_serial: string | null;
    serial_matches_listing: number;
    order_reference_visible: number;    // proves the photo was taken FOR THIS order
    issues: string[];
  };
  // Cross-photo coherence: does the serial number appear consistently
  // across SAPS 534, register entry, and the firearm photo?
  serial_consistency_across_photos: number;
  overall_confidence: number;           // weighted average, 0..100
  recommendation: 'APPROVE' | 'ADMIN_REVIEW' | 'REJECT';
  recommendation_reason: string;
}

@Injectable()
export class DealerVerificationService {
  private readonly logger = new Logger(DealerVerificationService.name);
  private readonly client: Anthropic | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly notifications: NotificationsService,
    // Zoho Books accounting integration. Posts the commission
    // invoice + mark-paid the moment verification approves. Feature-
    // flagged via ZOHO_BOOKS_ENABLED — when off, the service is
    // injected but every method no-ops.
    private readonly zohoBooks: ZohoBooksService,
    // S6 — a swap firearm leg drives its "delivery" (dealer stock-in) through
    // the normal shipping-update path so the swap both-delivered rollup fires.
    private readonly shipping: ShippingService,
  ) {
    const key = process.env.ANTHROPIC_API_KEY;
    this.client = key ? new Anthropic({ apiKey: key }) : null;
    if (!key) {
      this.logger.warn(
        'ANTHROPIC_API_KEY not set — dealer verification will queue for admin review',
      );
    }
  }

  // -------------------------------------------------------------------
  // Upload + scan flow
  // -------------------------------------------------------------------
  // The controller calls this with the three Multer files. We push
  // each to Cloudinary, then ask Claude to score the trio against the
  // listing's expected serial + the dealer's expected licence number.
  // -------------------------------------------------------------------
  async uploadAndScore(
    transactionId: string,
    sellerClerkId: string,
    files: {
      saps534: Express.Multer.File;
      stockRegister: Express.Multer.File;
      firearmSerial: Express.Multer.File;
    },
    dealerStockRegisterRef: string | undefined,
    // Where the firearm has been booked into stock. The seller types
    // these into the upload form alongside the 3 photos. Required —
    // the buyer needs them once verification approves so they know
    // where the firearm is. Claude vision also uses the dealer name
    // to cross-check the SAPS 534 (if the form is well-filled, the
    // dealer name and address should match what the seller typed).
    stockedAtDealer: { name: string; address: string; phone: string },
  ): Promise<{
    status: DealerVerificationStatus;
    score: number;
    findings: DealerVerificationFindings | null;
  }> {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        seller: { select: { clerkId: true } },
        listing: { select: { make: true, model: true, calibre: true, isFirearm: true } },
        swap: { select: { status: true } },
      },
    });
    if (!tx) throw new BadRequestException('Transaction not found');
    if (tx.seller.clerkId !== sellerClerkId) {
      throw new BadRequestException('Only the seller can upload dealer-verification photos');
    }
    if (!tx.listing.isFirearm) {
      throw new BadRequestException('Dealer verification is only required for firearm transactions');
    }
    if (tx.shippingMethod !== 'DEALER_TRANSFER') {
      throw new BadRequestException(
        'Dealer verification applies only to DEALER_TRANSFER shipping. Private arrangement uses a different flow.',
      );
    }
    // FLOW-F1 — a verification that already APPROVED is FINAL: the payout
    // released and the buyer was sent the dealer's details. A re-upload here
    // used to reset the status to PENDING_CLAUDE — "un-approving" a released
    // transaction, wiping the audit trail the payout was granted on, and
    // hiding the buyer's dealer panel. Same for a settled/reversed payment
    // state: no re-upload once money has moved either way.
    if (tx.dealerVerificationStatus === 'APPROVED') {
      throw new BadRequestException(
        'This transfer has already been verified and settled — the paperwork cannot be re-submitted. Contact support if something is wrong.',
      );
    }
    if (tx.paymentStatus !== 'HELD') {
      throw new BadRequestException(
        'This transaction is no longer awaiting verification — payment has already been settled or reversed. Contact support if something is wrong.',
      );
    }
    // SWOP S6 — a swap firearm leg may only be stocked-in once the swap has
    // LOCKED (both parties funded). The dealer-verify APPROVED path sets the
    // leg's deliveredAt, which drives the swap rollup; allowing it during
    // AWAITING_FUNDING would let a swap progress before it's paid. (A normal
    // sale's tx only exists post-capture, so it gets this for free.)
    if (
      tx.swapId &&
      tx.swap?.status !== 'LOCKED' &&
      tx.swap?.status !== 'IN_TRANSIT'
    ) {
      throw new BadRequestException(
        'You can only book this firearm into a dealer once the swap is locked — both parties must have paid first.',
      );
    }
    // We no longer require a pre-selected Dealer record on the
    // transaction — the seller chooses any SAPS-licensed dealer and
    // tells us about it via the upload form. The expected-dealer
    // cross-check Claude vision used to do is now soft (we just pass
    // the seller-supplied name as a hint).

    // Upload all 3 photos in parallel. Cloudinary handles HEIF→JPEG
    // on its side too as a belt-and-braces fallback to the
    // client-side conversion the frontend does.
    // The stamped 534 may be a PDF (dealer scan) or a photo. A PDF is
    // stored raw (byte-for-byte, opens intact for admin) and sent to
    // Claude as a document block; a photo goes through the image path.
    const saps534IsPdf =
      files.saps534.mimetype === 'application/pdf' ||
      files.saps534.buffer.subarray(0, 5).toString('latin1') === '%PDF-';
    const [saps534Upload, stockRegisterUpload, firearmSerialUpload] =
      await Promise.all([
        saps534IsPdf
          ? this.cloudinary.uploadRaw(
              files.saps534.buffer,
              `dealer-verification/${transactionId}`,
            )
          : this.cloudinary.uploadImage(
              files.saps534.buffer,
              `dealer-verification/${transactionId}`,
            ),
        this.cloudinary.uploadImage(files.stockRegister.buffer, `dealer-verification/${transactionId}`),
        this.cloudinary.uploadImage(files.firearmSerial.buffer, `dealer-verification/${transactionId}`),
      ]);

    // Stamp the URLs + put us into PENDING_CLAUDE while the vision
    // call runs. If Claude is down, the row stays in
    // PENDING_ADMIN_REVIEW and admin can review the uploaded photos
    // manually.
    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        saps534PhotoUrl: saps534Upload.url,
        stockRegisterPhotoUrl: stockRegisterUpload.url,
        firearmSerialPhotoUrl: firearmSerialUpload.url,
        dealerVerificationStatus: 'PENDING_CLAUDE',
        dealerStockRegisterRef:
          dealerStockRegisterRef?.trim().slice(0, 40) || null,
        // Persist the dealer contact the seller typed in. Surfaced
        // to the buyer when verification approves + included in the
        // payout-released notification.
        stockedAtDealerName: stockedAtDealer.name.slice(0, 120),
        stockedAtDealerAddress: stockedAtDealer.address.slice(0, 300),
        stockedAtDealerPhone: stockedAtDealer.phone.slice(0, 40),
      },
    });

    // Call Claude (no fail-fast — if Claude is unavailable, queue for admin).
    const expectedSerial = await this.findExpectedSerial(transactionId);
    let findings: DealerVerificationFindings | null = null;
    let status: DealerVerificationStatus = 'PENDING_ADMIN_REVIEW';
    let score = 0;

    if (this.client) {
      try {
        findings = await this.runClaudeVisionScan({
          saps534Url: saps534Upload.url,
          saps534Pdf: saps534IsPdf ? files.saps534.buffer : undefined,
          stockRegisterUrl: stockRegisterUpload.url,
          firearmSerialUrl: firearmSerialUpload.url,
          expectedSerial,
          // We don't have a verified-dealer DB lookup anymore. Pass
          // the seller-supplied dealer name so Claude can flag a
          // mismatch (the SAPS 534 should show the same dealer name
          // the seller said booked it in) but we don't fail on it.
          // expectedDealerLicence stays empty — Claude will just
          // extract whatever's on the form without comparison.
          expectedDealerLicence: '',
          expectedDealerName: stockedAtDealer.name,
          listingMake: tx.listing.make,
          listingModel: tx.listing.model,
          orderReference: transactionId.slice(-8).toUpperCase(),
        });
        score = findings.overall_confidence;
        status = this.statusFromFindings(findings);
      } catch (err) {
        this.logger.warn(
          `Dealer verification Claude call failed (queueing for admin): ${(err as Error).message}`,
        );
        status = 'PENDING_ADMIN_REVIEW';
      }
    }

    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        dealerVerificationStatus: status,
        dealerVerificationScore: score,
        dealerVerificationFindings: findings as never,
        dealerVerifiedAt: status === 'APPROVED' ? new Date() : null,
      },
    });

    // Read-back: persist the firearm "type" the dealer wrote into Section
    // D of the returned 534 (it was left blank on the prefill). Best-effort
    // — never let it disturb the verification flow.
    const readType = findings?.saps534?.firearm_type?.trim();
    if (readType) {
      try {
        await this.prisma.listing.update({
          where: { id: tx.listingId },
          data: { firearmType: readType.slice(0, 60) },
        });
      } catch (err) {
        this.logger.warn(
          `Could not persist firearmType for ${transactionId}: ${(err as Error).message}`,
        );
      }
    }

    // Fire-and-forget notifications based on the outcome. PENDING_ADMIN_REVIEW
    // doesn't send the seller anything yet — the verification result page
    // already told them "we're reviewing".
    if (status === 'APPROVED') {
      void this.sendOutcomeEmail(transactionId, 'APPROVED');
      // Per the new flow: APPROVED means Gun Galore's job is done.
      // Release the held funds to the seller AND notify the buyer
      // with the dealer's contact details. We fire-and-forget so a
      // notification or payout failure doesn't break the upload
      // response — admin can retry from the dossier if needed.
      void this.releaseAndNotifyOnApproval(transactionId);
    } else if (status === 'REJECTED') {
      void this.sendOutcomeEmail(
        transactionId,
        'REJECTED',
        findings?.recommendation_reason,
      );
    } else if (status === 'PENDING_ADMIN_REVIEW') {
      // FLOW-F4 (H17) — a firearm verification lands here whenever Claude
      // returns 50-79% on any criterion, the vision call throws, or no API key
      // is configured (the prompt even says "recommend ADMIN_REVIEW when
      // uncertain"), so it is a designed-for common outcome — yet nothing used
      // to signal the admin. The buyer's funds sit HELD and the promised 48h
      // human review had no queue behind it. Raise an urgent admin alert
      // pointing at the dossier override panel. Fire-and-forget so a failed
      // insert never breaks the upload response; the hourly ageing sweep +
      // attentionQueue count are the durable backstops.
      void this.prisma.adminAlert
        .create({
          data: {
            type: 'DEALER_VERIFICATION_NEEDS_REVIEW',
            referenceId: transactionId,
            urgent: true,
            context:
              `Firearm verification ${transactionId.slice(-8).toUpperCase()} ` +
              `(${[tx.listing.make, tx.listing.model].filter(Boolean).join(' ') || 'firearm'}) ` +
              `needs a human decision — Claude confidence ${Math.round(score)}%. ` +
              `Buyer's payment is HELD until it's approved. Review the SAPS 534 / ` +
              `stock-register / serial photos in the transaction dossier.`,
          },
        })
        .catch((err) =>
          this.logger.warn(
            `dealer-verification review alert failed for ${transactionId}: ${(err as Error).message}`,
          ),
        );
    }

    return { status, score, findings };
  }

  // -------------------------------------------------------------------
  // Admin override paths — approve, reject, or re-queue for reshoot.
  // -------------------------------------------------------------------
  async adminOverride(
    transactionId: string,
    decision: 'APPROVE' | 'REJECT',
    adminUserId: string,
    reason: string,
  ): Promise<void> {
    const trimmedReason = (reason ?? '').trim();
    if (trimmedReason.length < 5) {
      throw new BadRequestException(
        'Provide a reason of ≥5 characters for the audit log.',
      );
    }
    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        dealerVerificationStatus: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        dealerVerifiedAt: decision === 'APPROVE' ? new Date() : null,
        adminNote: `[Dealer verification ${decision} by admin] ${trimmedReason}`,
        adminReviewedById: adminUserId,
        adminReviewedAt: new Date(),
      },
    });

    // Send the seller the same email + SMS the auto-path sends, so an
    // admin override has the same downstream experience as a Claude
    // pass / reject.
    void this.sendOutcomeEmail(
      transactionId,
      decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      trimmedReason,
    );

    // Same auto-release-and-notify-buyer the Claude APPROVED path
    // fires. Idempotent — won't double-release if the auto-path
    // already ran first.
    if (decision === 'APPROVE') {
      void this.releaseAndNotifyOnApproval(transactionId);
    }
  }

  // -------------------------------------------------------------------
  // Internal — auto-release held funds + notify buyer of dealer details
  // -------------------------------------------------------------------
  // Fires whenever a transaction's dealer-verification status becomes
  // APPROVED (either via auto-Claude or admin override). This is the
  // moment Gun Galore is done with the transaction: the seller gets
  // their payout, the buyer gets the dealer's contact details so they
  // can arrange the inter-dealer transfer themselves.
  //
  // Idempotent on paymentStatus — if funds are already RELEASED we
  // just no-op. That makes it safe to call from both auto + admin
  // paths without coordinating between them.
  private async releaseAndNotifyOnApproval(
    transactionId: string,
  ): Promise<void> {
    try {
      const tx = await this.prisma.transaction.findUnique({
        where: { id: transactionId },
        include: {
          buyer: { select: { email: true, firstName: true, lastName: true, phone: true } },
          seller: { select: { email: true, firstName: true, lastName: true, phone: true } },
          listing: { select: { title: true } },
        },
      });
      if (!tx) return;

      // Idempotency guard. Both auto-Claude and admin-override paths
      // call us; the second one in shouldn't re-fire payout.
      if (tx.paymentStatus !== 'HELD') {
        this.logger.log(
          `releaseAndNotifyOnApproval: tx ${transactionId} already in paymentStatus=${tx.paymentStatus}, skipping`,
        );
        return;
      }

      // FLOW-F1 — PROOF-OF-PAYMENT guard. HELD is the schema DEFAULT at
      // creation, so an UNPAID dealer-transfer order is state-identical to a
      // funded one; without this check an APPROVED verification would release
      // real money for an EFT that never arrived (the same class of hole the
      // admin manual-release path closed in P5.3). Swap firearm legs are
      // exempt below — they carry zero per-leg money and their funding is
      // enforced on the Swap parent.
      if (!tx.swapId && (!tx.paidAt || tx.manualCancelledAt)) {
        this.logger.error(
          `releaseAndNotifyOnApproval: tx ${transactionId} is NOT PAID (paidAt=${String(
            tx.paidAt,
          )}, manualCancelledAt=${String(tx.manualCancelledAt)}) — refusing to release; surfacing to admin`,
        );
        await this.prisma.adminAlert
          .create({
            data: {
              type: 'DEALER_VERIFY_UNPAID',
              referenceId: transactionId,
              urgent: true,
              context: `Dealer verification APPROVED on tx ${transactionId} but the order shows no payment (paidAt null or cancelled). Funds NOT released — investigate before any manual release.`,
            },
          })
          .catch(() => undefined);
        return;
      }

      // S6 — a swap firearm leg carries ZERO money (settlement happens on the
      // Swap parent in S5), so there is NO per-leg payout or totalSales bump.
      // The dealer stock-in IS this leg's delivery: route it through the normal
      // shipping path so the swap both-delivered rollup (→ AWAITING_VERIFICATION
      // → cash release) fires uniformly for firearm + courier legs alike, and
      // tell the recipient where to collect. Guard on deliveredAt so a second
      // call (auto + admin override) is a no-op.
      if (tx.swapId) {
        if (tx.deliveredAt) return;
        void this.shipping.applyShippingUpdate(transactionId, 'DELIVERED');
        const buyerNameSwap =
          [tx.buyer.firstName, tx.buyer.lastName].filter(Boolean).join(' ') ||
          'there';
        const sellerNameSwap =
          [tx.seller.firstName, tx.seller.lastName].filter(Boolean).join(' ') ||
          'the sender';
        await this.notifications.firearmStockedAtDealerBuyer({
          buyerEmail: tx.buyer.email,
          buyerName: buyerNameSwap,
          buyerPhone: tx.buyer.phone,
          listingTitle: tx.listing.title,
          transactionId,
          dealerName: tx.stockedAtDealerName ?? 'the dealer',
          dealerAddress: tx.stockedAtDealerAddress ?? '',
          dealerPhone: tx.stockedAtDealerPhone ?? '',
          sellerName: sellerNameSwap,
        });
        this.logger.log(
          `Dealer verification APPROVED for swap leg ${transactionId} — drove swap rollup (no per-leg payout)`,
        );
        return;
      }

      const now = new Date();
      // FLOW-F1 — the release is an atomic CAS, not a blind update: HELD +
      // paid-and-not-cancelled must still hold AT WRITE TIME (the pre-reads
      // above are advisory). count===0 ⇒ a concurrent path already settled
      // or reversed the row — no release, no totalSales bump.
      const claim = await this.prisma.transaction.updateMany({
        where: {
          id: transactionId,
          paymentStatus: 'HELD',
          paidAt: { not: null },
          manualCancelledAt: null,
        },
        data: {
          paymentStatus: 'RELEASED',
          releasedAt: now,
          // deliveredAt = stocked-in-at-dealer for firearm DEALER_TRANSFER.
          // We don't have a buyer-side "confirm delivery" event anymore;
          // the verification approval IS the deliverable for our scope.
          deliveredAt: tx.deliveredAt ?? now,
          shippingStatus: 'DELIVERED',
        },
      });
      if (claim.count === 0) {
        this.logger.warn(
          `releaseAndNotifyOnApproval: tx ${transactionId} release claim lost (state changed concurrently) — skipping`,
        );
        return;
      }
      await this.prisma.user.update({
        where: { id: tx.sellerId },
        data: { totalSales: { increment: 1 } },
      });

      this.logger.log(
        `Dealer verification APPROVED for tx ${transactionId} — payout released`,
      );

      // Seller notification: the DEALER-TRANSFER release is driven by
      // SAPS-534 verification, NOT a buyer confirm-delivery — so send the
      // dealer-verification-approved copy (dealerVerificationApproved),
      // not the generic paymentReleasedSeller ("buyer has confirmed
      // delivery") which is false on this path.
      const sellerName =
        [tx.seller.firstName, tx.seller.lastName].filter(Boolean).join(' ') ||
        'Seller';
      await this.notifications.dealerVerificationApproved({
        sellerEmail: tx.seller.email,
        sellerName,
        sellerPhone: tx.seller.phone,
        listingTitle: tx.listing.title,
        sellerPayout: tx.sellerPayout,
        transactionId,
      });

      // Buyer notification with the dealer contact details — this
      // is the moment they find out where the firearm has been
      // booked into stock + that Gun Galore is now hands-off.
      const buyerName =
        [tx.buyer.firstName, tx.buyer.lastName].filter(Boolean).join(' ') ||
        'Buyer';
      await this.notifications.firearmStockedAtDealerBuyer({
        buyerEmail: tx.buyer.email,
        buyerName,
        buyerPhone: tx.buyer.phone,
        listingTitle: tx.listing.title,
        transactionId,
        dealerName: tx.stockedAtDealerName ?? 'the dealer',
        dealerAddress: tx.stockedAtDealerAddress ?? '',
        dealerPhone: tx.stockedAtDealerPhone ?? '',
        sellerName,
      });

      // FLOW-F4 (M20) — a firearm DT buyer never reaches confirmDelivery (the
      // button is hidden and the tx is RELEASED here, so its HELD-guard would
      // reject anyway), so the buyer's non-dismissible "your order is on the
      // way / confirm receipt" inbox row and the seller's reshoot row were
      // never resolved — they lingered forever on a completed sale. This
      // approval IS the terminal event for GG, so clear every open inbox row
      // linked to the transaction (unscoped). No-throw; fired after release.
      void this.notifications.resolveByEntity('transaction', transactionId);

      // ── Zoho Books accounting hooks ──────────────────────────────
      // Create the commission invoice (Gun Galore → Seller) and
      // immediately mark it paid from Client Funds Payable. Both
      // are gated by ZOHO_BOOKS_ENABLED — feature-flagged so we
      // can deploy this code without affecting Books until you're
      // ready to flip it on. Both methods are no-throw; failures
      // get persisted as zohoSyncStatus=FAILED on the transaction
      // and surface in the admin panel for manual retry.
      await this.zohoBooks.createCommissionInvoice(transactionId);
      await this.zohoBooks.markCommissionInvoicePaid(transactionId);
    } catch (err) {
      this.logger.error(
        `releaseAndNotifyOnApproval failed for tx ${transactionId}: ${(err as Error).message}`,
      );
    }
  }

  // -------------------------------------------------------------------
  // Internal — send outcome notification to the seller
  // -------------------------------------------------------------------
  private async sendOutcomeEmail(
    transactionId: string,
    outcome: 'APPROVED' | 'REJECTED',
    reason?: string,
  ): Promise<void> {
    try {
      const tx = await this.prisma.transaction.findUnique({
        where: { id: transactionId },
        include: {
          seller: { select: { email: true, firstName: true, lastName: true, phone: true } },
          listing: { select: { title: true } },
        },
      });
      if (!tx) return;
      const sellerName =
        [tx.seller.firstName, tx.seller.lastName].filter(Boolean).join(' ') ||
        'Seller';
      if (outcome === 'APPROVED') {
        await this.notifications.dealerVerificationApproved({
          sellerEmail: tx.seller.email,
          sellerName,
          sellerPhone: tx.seller.phone,
          listingTitle: tx.listing.title,
          transactionId,
          sellerPayout: tx.sellerPayout,
        });
      } else {
        await this.notifications.dealerVerificationRejected({
          sellerEmail: tx.seller.email,
          sellerName,
          sellerPhone: tx.seller.phone,
          listingTitle: tx.listing.title,
          transactionId,
          reason,
        });
      }
    } catch (err) {
      this.logger.warn(
        `Outcome notification failed for tx ${transactionId}: ${(err as Error).message}`,
      );
    }
  }

  // -------------------------------------------------------------------
  // Internal — Claude vision scan
  // -------------------------------------------------------------------
  private async runClaudeVisionScan(args: {
    saps534Url: string;
    // When the seller uploaded the stamped 534 as a PDF, the raw bytes
    // are passed here and sent to Claude as a document block (no
    // rasterisation needed — the model reads the PDF directly). When
    // it's a photo, this is undefined and we use saps534Url as an image.
    saps534Pdf?: Buffer;
    stockRegisterUrl: string;
    firearmSerialUrl: string;
    expectedSerial: string | null;
    expectedDealerLicence: string;
    expectedDealerName: string;
    listingMake: string | null;
    listingModel: string | null;
    orderReference: string;
  }): Promise<DealerVerificationFindings> {
    if (!this.client) throw new Error('Anthropic client not configured');

    const systemPrompt = `You are the dealer stock-in verifier for Gun Galore, a South African firearms marketplace.

You will be shown THREE documents in order:
  1. A completed SAP 534 form (Transfer of Firearm Ownership, s125(2)(a)(iii)) stamped or signed by a SAPS-licensed dealer. This may be a multi-page PDF or a photo — read every page.
  2. The last line of the dealer's stock register (FCA Reg. 86) — only ONE line should be visible to protect other customers' privacy.
  3. The firearm itself with its serial number visible, next to a slip of paper showing the Gun Galore order reference.

Your job is to score each photo against a rubric and return a single JSON object. Score every numeric field 0-100 where 100 = confident the criterion is met, 0 = confident it is not. Be honest — if a field is illegible or the photo is blurry, score it 50 or lower.

Output ONLY a single valid JSON object. The first character MUST be the literal "{". No preamble, no markdown fences.

Schema:
{
  "saps534": {
    "all_fields_filled": <0-100>,
    "dealer_stamp_or_signature": <0-100>,   // stamp OR (signature + printed dealer name + date) is acceptable
    "block_letters": <0-100>,               // handwriting is in block capitals — Gun Galore requires this
    "dealer_licence_visible": <0-100>,
    "extracted_dealer_licence": "<string or null>",  // what you read on the form
    "firearm_type": "<the firearm TYPE from Section D, e.g. Pistol / Rifle / Shotgun / Self-loading rifle, or null>",
    "extracted_firearm_serial": "<the firearm serial number written in Section D, or null>",
    "firearm_serial_matches_listing": <0-100>,  // does Section D's serial match the expected serial in the user context?
    "issues": ["short human-readable string", ...]
  },
  "stockRegister": {
    "last_line_only": <0-100>,              // privacy: ideally only the last entry visible; mask if other rows are blurred or covered
    "extracted_serial": "<serial number or null>",
    "serial_matches_listing": <0-100>,      // does it match the listing serial passed in user context?
    "extracted_entry_number": "<register row number or null>",
    "issues": [...]
  },
  "firearm": {
    "serial_legible": <0-100>,
    "extracted_serial": "<serial or null>",
    "serial_matches_listing": <0-100>,
    "order_reference_visible": <0-100>,     // proves the photo was taken for THIS order, not recycled
    "issues": [...]
  },
  "serial_consistency_across_photos": <0-100>,
  "overall_confidence": <0-100>,            // your weighted judgement
  "recommendation": "APPROVE" | "ADMIN_REVIEW" | "REJECT",
  "recommendation_reason": "<one-sentence summary>"
}

Rules:
- If ANY photo is missing or unreadable, set the relevant scores low and recommend REJECT or ADMIN_REVIEW.
- If the extracted_dealer_licence does NOT match the expected dealer licence in the user context, score dealer_licence_visible low and add an issue.
- If the extracted_serial values across the three photos disagree, score serial_consistency_across_photos low and add an issue.
- Block letters is REQUIRED for SAPS 534 — cursive / mixed case scores low.
- "Stamp" includes an inked rubber stamp, a printed dealer letterhead, or a clearly signed + printed name + date combination.
- Be conservative with REJECT — only recommend REJECT when at least one field is below 50 and cannot be salvaged by a reshoot. Recommend ADMIN_REVIEW when you're uncertain.
- Read the firearm TYPE and SERIAL from Section D of the 534. If Section D's serial does not match the expected serial in the user context, score firearm_serial_matches_listing low and add an issue. If the type is blank or unreadable, set firearm_type to null and do not penalise other scores for it.`;

    const saps534Block = args.saps534Pdf
      ? ({
          type: 'document' as const,
          source: {
            type: 'base64' as const,
            media_type: 'application/pdf' as const,
            data: args.saps534Pdf.toString('base64'),
          },
        })
      : ({
          type: 'image' as const,
          source: { type: 'url' as const, url: args.saps534Url },
        });

    const userContent: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'url'; url: string } }
      | {
          type: 'document';
          source: {
            type: 'base64';
            media_type: 'application/pdf';
            data: string;
          };
        }
    > = [
      {
        type: 'text',
        text: [
          `Expected dealer licence: ${args.expectedDealerLicence}`,
          `Expected dealer name: ${args.expectedDealerName}`,
          `Expected firearm serial (from listing): ${args.expectedSerial ?? '(unknown — listing has no recorded serial; do not penalise for mismatch)'}`,
          `Expected listing: ${[args.listingMake, args.listingModel].filter(Boolean).join(' ') || '(unknown)'}`,
          `Order reference that should appear on photo 3: ${args.orderReference}`,
          '',
          'Document 1: SAP 534 form (PDF or photo)',
        ].join('\n'),
      },
      saps534Block,
      { type: 'text', text: 'Photo 2: Stock register last line' },
      { type: 'image', source: { type: 'url', url: args.stockRegisterUrl } },
      { type: 'text', text: 'Photo 3: Firearm with serial + order reference' },
      { type: 'image', source: { type: 'url', url: args.firearmSerialUrl } },
    ];

    const msg = await this.client.messages.create({
      model: MODEL_VISION,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    });

    const block = msg.content.find((b) => b.type === 'text');
    const raw = (block as { text?: string } | undefined)?.text ?? '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error('Claude did not return JSON');
    }
    return JSON.parse(match[0]) as DealerVerificationFindings;
  }

  // -------------------------------------------------------------------
  // Internal — decide status from Claude's findings
  // -------------------------------------------------------------------
  private statusFromFindings(f: DealerVerificationFindings): DealerVerificationStatus {
    // Collect every numeric score so we can apply the threshold rules
    // uniformly. "Issues lists" don't gate the decision — only the
    // numeric confidences do.
    const allScores: number[] = [
      f.saps534.all_fields_filled,
      f.saps534.dealer_stamp_or_signature,
      f.saps534.block_letters,
      f.saps534.dealer_licence_visible,
      f.saps534.firearm_serial_matches_listing,
      f.stockRegister.last_line_only,
      f.stockRegister.serial_matches_listing,
      f.firearm.serial_legible,
      f.firearm.serial_matches_listing,
      f.firearm.order_reference_visible,
      f.serial_consistency_across_photos,
    ];

    if (allScores.some((s) => s < AUTO_REJECT_CEILING)) return 'REJECTED';
    if (allScores.every((s) => s >= AUTO_APPROVE_FLOOR)) return 'APPROVED';
    return 'PENDING_ADMIN_REVIEW';
  }

  // -------------------------------------------------------------------
  // Internal — derive expected serial from the listing
  // -------------------------------------------------------------------
  // Today's schema doesn't have a dedicated `serialNumber` field on
  // Listing (we capture make / model / calibre but not the serial —
  // the seller types it on the dealer paperwork). When that field
  // ships, this method returns it; today it falls back to null and
  // Claude skips the cross-check.
  private async findExpectedSerial(transactionId: string): Promise<string | null> {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      select: { listing: { select: { serialNumber: true } } },
    });
    return tx?.listing?.serialNumber?.trim() || null;
  }
}
