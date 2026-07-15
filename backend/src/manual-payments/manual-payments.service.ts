import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../payments/transactions.service';
import {
  parseInContact,
  parseStatementCsv,
  type ParsedStatementRow,
} from './manual-payment.parser';
import {
  buildFnbBulkFile,
  sastActionDate,
  type FnbRecipient,
} from './fnb-bulk';
import { GG_BANK_DETAILS, PAYMENT_MODE } from '../payments/transactions.service';
import { ZohoBooksService } from '../zoho/zoho-books.service';
import { SwapFundingService } from '../swaps/swap-funding.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { FeaturedService } from '../featured/featured.service';

// Manual-EFT reconciliation. Two feeds match payments to orders:
//   1. scanInbox()  — FNB inContact email alerts (fast, PROVISIONAL):
//      sets Transaction.manualDetectedAt + stops the freeze timer, but
//      does NOT notify the seller (operator rule: the statement is the
//      authoritative gate).
//   2. reconcileStatement() — uploaded FNB statement CSV (AUTHORITATIVE):
//      confirms the payment → TransactionsService.confirmManualPayment
//      (markPaid → SOLD → seller notified → Zoho).
// Everything is matched on Transaction.orderReference + exact amount.
// Unmatched rows form the admin investigation queue.

export interface ScanResult {
  scanned: number;
  detected: number;
  unmatched: number;
  skipped: number; // duplicates / non-credit / already-processed
}

export interface ReconcileResult {
  uploadId: string;
  rows: number;
  creditRows: number;
  verified: number;
  unmatched: number;
  ambiguous: number;
  alreadyDone: number;
}

// FLOW-F2 — a due payout/refund row the FNB batch builder would SKIP,
// with a structured reason, so the admin payouts-due preview can show
// blocked money BEFORE batch time (previously the skips only surfaced
// in the batch-build response + a logger.warn).
export interface SkippedDueRow {
  kind: 'PAYOUT' | 'REFUND';
  ref: string;
  reason: string;
}

type MatchStatus =
  | 'MATCHED'
  | 'UNMATCHED'
  | 'AMBIGUOUS'
  | 'ALREADY'
  | 'EXPIRED'; // reference matched a soft-cancelled order — paid after the
//             // 1-hour window lapsed; needs admin refund / re-fulfil.

@Injectable()
export class ManualPaymentsService {
  private readonly logger = new Logger(ManualPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
    private readonly zohoBooks: ZohoBooksService,
    private readonly swaps: SwapFundingService,
    // P1 — the reconciler now also settles subscription charges (P1.1)
    // and featured-slot fees (P1.2). Both providers' modules MUST be in
    // ManualPaymentsModule.imports (none of them are @Global — the
    // SwapsModule boot-crash lesson).
    private readonly subscriptions: SubscriptionsService,
    private readonly featured: FeaturedService,
  ) {}

  private get imapConfigured(): boolean {
    return Boolean(process.env.IMAP_USER && process.env.IMAP_PASSWORD);
  }

  // ── Shared matcher ──────────────────────────────────────────────────
  // Resolve an incoming payment (reference + amount) to an awaiting
  // manual order. orderReference is @unique so there is at most one
  // candidate; the amount must match exactly.
  private async matchOrder(
    reference: string | null,
    orderRef: string | null,
    amountCents: number,
  ): Promise<{
    status: MatchStatus;
    transactionId: string | null;
    orderId: string | null;
    swapId?: string | null;
    swapSide?: 'INITIATOR' | 'OWNER' | null;
    subscriptionChargeId?: string | null;
    featuredBidId?: string | null;
  }> {
    const ref = orderRef ?? reference;
    if (!ref) return { status: 'UNMATCHED', transactionId: null, orderId: null };

    // INVARIANT (why tx-first precedence is unambiguous): single-item tx refs
    // and multi-item order refs are drawn from the SAME per-prefix atomic
    // ReferenceCounter, so a given reference string is globally unique across
    // BOTH the Transaction and Order tables — it can never match a tx AND an
    // order. If that ever changes, add an explicit both-match → AMBIGUOUS guard.
    // 1) Single-item checkout — reference lives on Transaction.orderReference.
    const tx = await this.prisma.transaction.findUnique({
      where: { orderReference: ref },
      select: {
        id: true,
        buyerTotal: true,
        manualVerifiedAt: true,
        manualCancelledAt: true,
      },
    });
    if (tx) {
      if (tx.manualVerifiedAt)
        return { status: 'ALREADY', transactionId: tx.id, orderId: null };
      // Order was soft-cancelled when its window lapsed (inContact never
      // fired) but the buyer evidently DID pay — the statement carries its
      // reference. Don't auto-confirm (the item may have been re-sold);
      // surface for admin refund / re-fulfil.
      if (tx.manualCancelledAt)
        return { status: 'EXPIRED', transactionId: tx.id, orderId: null };
      if (tx.buyerTotal !== amountCents)
        return { status: 'AMBIGUOUS', transactionId: tx.id, orderId: null };
      return { status: 'MATCHED', transactionId: tx.id, orderId: null };
    }

    // 2) Multi-item cart (Phase 8b) — reference lives on Order.orderReference.
    // The lump EFT must equal the ORDER total (sum of child buyerTotals); the
    // confirm then fans out to every child transaction.
    const order = await this.prisma.order.findUnique({
      where: { orderReference: ref },
      select: { id: true, buyerTotal: true, paidAt: true, manualCancelledAt: true },
    });
    if (order) {
      if (order.paidAt)
        return { status: 'ALREADY', transactionId: null, orderId: order.id };
      if (order.manualCancelledAt)
        return { status: 'EXPIRED', transactionId: null, orderId: order.id };
      if (order.buyerTotal !== amountCents)
        return { status: 'AMBIGUOUS', transactionId: null, orderId: order.id };
      return { status: 'MATCHED', transactionId: null, orderId: order.id };
    }

    // 3) SWOP two-sided funding — the ref lives on Swap.initiatorFundingRef OR
    // Swap.ownerFundingRef (each party funds independently, same SW prefix
    // pool so still globally unique). Match the side + its expected amount.
    const swap = await this.prisma.swap.findFirst({
      where: { OR: [{ initiatorFundingRef: ref }, { ownerFundingRef: ref }] },
      select: {
        id: true,
        status: true,
        initiatorFundingRef: true,
        initiatorFundingAmount: true,
        initiatorVerifiedAt: true,
        ownerFundingAmount: true,
        ownerVerifiedAt: true,
      },
    });
    if (swap) {
      const side: 'INITIATOR' | 'OWNER' =
        swap.initiatorFundingRef === ref ? 'INITIATOR' : 'OWNER';
      const amount =
        side === 'INITIATOR' ? swap.initiatorFundingAmount : swap.ownerFundingAmount;
      const verified =
        side === 'INITIATOR' ? swap.initiatorVerifiedAt : swap.ownerVerifiedAt;
      const base = { transactionId: null, orderId: null, swapId: swap.id, swapSide: side };
      if (verified) return { status: 'ALREADY', ...base };
      // Locked (both funded) / cancelled (funding lapsed) — paid too late.
      if (swap.status !== 'AWAITING_FUNDING') return { status: 'EXPIRED', ...base };
      if (amount !== amountCents) return { status: 'AMBIGUOUS', ...base };
      return { status: 'MATCHED', ...base };
    }

    // 4) Subscription purchase (P1.1) — SB ref lives on a PENDING
    // SubscriptionCharge. SUCCEEDED = already activated; FAILED = the
    // sweep lapsed the charge before the money arrived (paid too late —
    // surface for admin refund/re-activate, never auto-confirm).
    const charge = await this.prisma.subscriptionCharge.findUnique({
      where: { orderReference: ref },
      select: { id: true, status: true, amountCents: true },
    });
    if (charge) {
      const base = {
        transactionId: null,
        orderId: null,
        subscriptionChargeId: charge.id,
      };
      if (charge.status === 'SUCCEEDED') return { status: 'ALREADY', ...base };
      if (charge.status !== 'PENDING') return { status: 'EXPIRED', ...base };
      if (charge.amountCents !== amountCents)
        return { status: 'AMBIGUOUS', ...base };
      return { status: 'MATCHED', ...base };
    }

    // 5) Featured-slot fee (P1.2) — FS ref lives on the WON bid awaiting
    // its EFT. paidAt = already bound; a bid that is no longer WON was
    // forfeited/cascaded before the money arrived (paid too late).
    const bid = await this.prisma.featuredSlotBid.findUnique({
      where: { orderReference: ref },
      select: { id: true, status: true, paidAt: true, chargedAmountCents: true },
    });
    if (bid) {
      const base = { transactionId: null, orderId: null, featuredBidId: bid.id };
      if (bid.paidAt) return { status: 'ALREADY', ...base };
      if (bid.status !== 'WON') return { status: 'EXPIRED', ...base };
      if (bid.chargedAmountCents !== amountCents)
        return { status: 'AMBIGUOUS', ...base };
      return { status: 'MATCHED', ...base };
    }

    return { status: 'UNMATCHED', transactionId: null, orderId: null };
  }

  // ── 1. inContact email scan (provisional detection) ─────────────────
  async scanInbox(): Promise<ScanResult> {
    const res: ScanResult = { scanned: 0, detected: 0, unmatched: 0, skipped: 0 };
    if (!this.imapConfigured) {
      this.logger.warn('IMAP not configured — skipping inContact scan');
      return res;
    }

    const accountSuffix = process.env.FNB_ACCOUNT_SUFFIX ?? '989191';
    const client = new ImapFlow({
      host: process.env.IMAP_HOST ?? 'mail.gungalore.co.za',
      port: Number(process.env.IMAP_PORT ?? 993),
      secure: true,
      auth: {
        user: process.env.IMAP_USER as string,
        pass: process.env.IMAP_PASSWORD as string,
      },
      logger: false,
    });

    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        // Only unseen messages — we mark each seen after processing so a
        // re-run never reprocesses. externalId (Message-ID) is the
        // belt-and-braces dedupe.
        for await (const msg of client.fetch(
          { seen: false },
          { uid: true, envelope: true, source: true },
        )) {
          res.scanned += 1;
          try {
            const handled = await this.ingestInContactMessage(
              msg.source ? Buffer.from(msg.source) : null,
              msg.envelope?.messageId ?? `uid-${msg.uid}`,
              accountSuffix,
              res,
            );
            // Mark seen regardless so we don't loop on an unparseable mail.
            await client.messageFlagsAdd({ uid: msg.uid }, ['\\Seen'], {
              uid: true,
            });
            if (!handled) res.skipped += 1;
          } catch (err) {
            this.logger.error(
              `inContact ingest failed (uid ${msg.uid}): ${(err as Error).message}`,
            );
          }
        }
      } finally {
        lock.release();
      }
      await client.logout();
    } catch (err) {
      this.logger.error(`IMAP scan failed: ${(err as Error).message}`);
    }
    this.logger.log(
      `inContact scan: ${res.scanned} scanned, ${res.detected} detected, ${res.unmatched} unmatched, ${res.skipped} skipped`,
    );
    return res;
  }

  // Returns true if a ManualPayment row was created (i.e. it was a real,
  // new credit alert), false if skipped (dup / not a credit / not ours).
  private async ingestInContactMessage(
    source: Buffer | null,
    messageId: string,
    accountSuffix: string,
    res: ScanResult,
  ): Promise<boolean> {
    if (!source) return false;
    const externalId = `incontact:${messageId}`;
    const dup = await this.prisma.manualPayment.findUnique({
      where: { externalId },
      select: { id: true },
    });
    if (dup) return false;

    const mail = await simpleParser(source);
    const text = `${mail.subject ?? ''}\n${mail.text ?? ''}`.trim();
    const parsed = parseInContact(text);
    if (!parsed || !parsed.isCredit || parsed.amountCents == null) {
      return false; // outgoing alert, or unparseable — ignore
    }
    // Sanity: only alerts for OUR account.
    if (parsed.accountSuffix && !parsed.accountSuffix.endsWith(accountSuffix)) {
      return false;
    }

    const match = await this.matchOrder(
      parsed.reference,
      parsed.orderRef,
      parsed.amountCents,
    );

    const needsAdmin =
      match.status === 'AMBIGUOUS' || match.status === 'EXPIRED';
    await this.prisma.manualPayment.create({
      data: {
        source: 'INCONTACT',
        externalId,
        rawText: text.slice(0, 4000),
        amountCents: parsed.amountCents,
        reference: parsed.orderRef ?? parsed.reference,
        status:
          match.status === 'MATCHED'
            ? 'MATCHED'
            : needsAdmin
              ? 'AMBIGUOUS'
              : 'UNMATCHED',
        matchedTransactionId: match.transactionId,
        matchedOrderId: match.orderId,
        note: this.matchNote(match),
      },
    });

    if (match.status === 'MATCHED' && match.transactionId) {
      // Single-item: provisional only — stop the freeze timer, no confirm.
      await this.prisma.transaction.updateMany({
        where: { id: match.transactionId, manualDetectedAt: null },
        data: { manualDetectedAt: new Date() },
      });
      res.detected += 1;
    } else if (match.status === 'MATCHED' && match.orderId) {
      // Multi-item order (Phase 8b): stamp detect on the ORDER. Child txs
      // carry no manualPayByAt, so only the order-level freeze sweep watches
      // them — setting Order.manualDetectedAt stops that sweep for all lines.
      await this.prisma.order.updateMany({
        where: { id: match.orderId, manualDetectedAt: null },
        data: { manualDetectedAt: new Date() },
      });
      res.detected += 1;
    } else if (match.status === 'MATCHED' && match.swapId && match.swapSide) {
      // SWOP funding: provisional — stop the funding sweep for this side.
      await this.swaps.markFundingDetected(match.swapId, match.swapSide);
      res.detected += 1;
    } else if (match.status === 'MATCHED' && match.subscriptionChargeId) {
      // P1.1 — subscriptions activate on inContact DETECTION (not just the
      // statement): zero-COGS digital perk, so the fraud exposure of a
      // spoofed alert is negligible versus making the member wait a day
      // for the CSV upload. confirmPayment is an atomic PENDING→SUCCEEDED
      // claim, so the later statement pass lands on ALREADY.
      await this.prisma.subscriptionCharge.updateMany({
        where: { id: match.subscriptionChargeId, detectedAt: null },
        data: { detectedAt: new Date() },
      });
      await this.subscriptions.confirmPayment(match.subscriptionChargeId);
      res.detected += 1;
    } else if (match.status === 'MATCHED' && match.featuredBidId) {
      // P1.2 — same zero-COGS rationale: bind the featured slot on
      // detection so the seller's boost starts immediately.
      await this.prisma.featuredSlotBid.updateMany({
        where: { id: match.featuredBidId, paymentDetectedAt: null },
        data: { paymentDetectedAt: new Date() },
      });
      await this.featured.confirmSlotPayment(match.featuredBidId);
      res.detected += 1;
    } else {
      res.unmatched += 1;
    }
    return true;
  }

  // Human-readable note for the admin investigation queue, by match kind.
  // Review fix: subscription/featured payments are NOT goods — a late one
  // should be RE-ACTIVATED, not "refunded / re-fulfilled". Derive the entity
  // kind from the match so the note tells the operator the right action.
  private matchNote(match: {
    status: MatchStatus;
    subscriptionChargeId?: string | null;
    featuredBidId?: string | null;
  }): string | null {
    const kind = match.subscriptionChargeId
      ? 'subscription'
      : match.featuredBidId
        ? 'featured'
        : 'order';
    if (match.status === 'AMBIGUOUS') {
      if (kind === 'subscription')
        return 'Reference matched a subscription charge but the amount differs (price may have changed) — investigate before activating.';
      if (kind === 'featured')
        return 'Reference matched a featured-slot bid but the amount differs — investigate before binding.';
      return 'Reference matched an order but the amount differs — investigate.';
    }
    if (match.status === 'EXPIRED') {
      if (kind === 'subscription')
        return 'Subscription EFT arrived after its pay-by window lapsed (the charge was failed). Activate the tier manually or refund the member.';
      if (kind === 'featured')
        return 'Featured-slot EFT arrived after the bid was forfeited/cascaded. Re-award the slot or refund the bidder by manual EFT.';
      return 'Buyer paid AFTER the 24-hour window expired and the item was released. Refund the buyer, or re-fulfil manually if the item is still available.';
    }
    return null;
  }

  // ── 2. Statement CSV reconciliation (authoritative) ─────────────────
  async reconcileStatement(
    content: string,
    filename: string,
    uploadedById: string | null,
  ): Promise<ReconcileResult> {
    const rows = parseStatementCsv(content);
    const creditRows = rows.filter((r) => r.amountCents > 0);

    const upload = await this.prisma.statementUpload.create({
      data: {
        filename: filename.slice(0, 200),
        uploadedById,
        rowCount: rows.length,
        creditRowCount: creditRows.length,
      },
    });

    const out: ReconcileResult = {
      uploadId: upload.id,
      rows: rows.length,
      creditRows: creditRows.length,
      verified: 0,
      unmatched: 0,
      ambiguous: 0,
      alreadyDone: 0,
    };

    for (const row of creditRows) {
      try {
        const status = await this.ingestStatementRow(upload.id, row, out);
        if (status === 'ALREADY') out.alreadyDone += 1;
      } catch (err) {
        this.logger.error(
          `Statement row ${row.index} reconcile failed: ${(err as Error).message}`,
        );
      }
    }

    await this.prisma.statementUpload.update({
      where: { id: upload.id },
      data: { matchedCount: out.verified, unmatchedCount: out.unmatched },
    });

    this.logger.log(
      `Statement ${filename}: ${out.creditRows} credits → ${out.verified} verified, ${out.unmatched} unmatched, ${out.ambiguous} ambiguous`,
    );
    return out;
  }

  private async ingestStatementRow(
    uploadId: string,
    row: ParsedStatementRow,
    out: ReconcileResult,
  ): Promise<MatchStatus> {
    const externalId = `statement:${uploadId}:${row.index}`;
    const match = await this.matchOrder(row.reference, row.orderRef, row.amountCents);

    await this.prisma.manualPayment.create({
      data: {
        source: 'STATEMENT',
        externalId,
        rawText: row.rawLine.slice(0, 4000),
        amountCents: row.amountCents,
        reference: row.orderRef ?? row.reference,
        paidAt: row.effectiveDate ? this.safeDate(row.effectiveDate) : null,
        status:
          match.status === 'MATCHED' || match.status === 'ALREADY'
            ? 'MATCHED'
            : match.status === 'AMBIGUOUS' || match.status === 'EXPIRED'
              ? 'AMBIGUOUS'
              : 'UNMATCHED',
        matchedTransactionId: match.transactionId,
        matchedOrderId: match.orderId,
        note: this.matchNote(match),
      },
    });

    if (match.status === 'MATCHED' && match.transactionId) {
      // Single-item AUTHORITATIVE confirm — full paid transition.
      await this.transactions.confirmManualPayment(match.transactionId);
      out.verified += 1;
    } else if (match.status === 'MATCHED' && match.orderId) {
      // Multi-item order (Phase 8b): fan out the confirm to every child tx
      // (each re-binds its own amount + id; idempotent), roll the order up to
      // PAID, and send ONE consolidated buyer confirmation.
      await this.transactions.confirmManualOrder(match.orderId);
      out.verified += 1;
    } else if (match.status === 'MATCHED' && match.swapId && match.swapSide) {
      // SWOP funding AUTHORITATIVE: this side is funded; both → LOCKED.
      await this.swaps.confirmSwapFunding(match.swapId, match.swapSide);
      out.verified += 1;
    } else if (match.status === 'MATCHED' && match.subscriptionChargeId) {
      // P1.1 — subscription activation (idempotent atomic claim; if the
      // inContact scan already activated it, matchOrder returned ALREADY
      // and we never reach here).
      await this.subscriptions.confirmPayment(match.subscriptionChargeId);
      out.verified += 1;
    } else if (match.status === 'MATCHED' && match.featuredBidId) {
      // P1.2 — featured-slot bind on authoritative statement match.
      await this.featured.confirmSlotPayment(match.featuredBidId);
      out.verified += 1;
    } else if (match.status === 'AMBIGUOUS' || match.status === 'EXPIRED') {
      // EXPIRED = paid after the 24-hour window; needs admin refund/re-fulfil
      // (never auto-confirmed — the item may already be re-sold).
      out.ambiguous += 1;
    } else if (match.status === 'UNMATCHED') {
      out.unmatched += 1;
    }
    return match.status;
  }

  private safeDate(s: string): Date | null {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // ── Admin queue ─────────────────────────────────────────────────────
  async listUnmatched(limit = 100) {
    return this.prisma.manualPayment.findMany({
      where: { status: { in: ['UNMATCHED', 'AMBIGUOUS'] } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async listRecentUploads(limit = 30) {
    return this.prisma.statementUpload.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  // ── P1.3 — Books failed-sync aggregate (read-only) ──────────────────
  // One place listing every entity whose latest Zoho sync FAILED, so the
  // operator doesn't have to trawl individual dossiers. Retry stays on
  // the per-transaction admin surface (ZB-10); this is the radar.
  async getZohoFailedSyncs() {
    const [transactions, featuredBids, subscriptionCharges, swaps] =
      await Promise.all([
        this.prisma.transaction.findMany({
          where: { zohoSyncStatus: 'FAILED' },
          orderBy: { zohoSyncLastAttemptAt: 'desc' },
          take: 50,
          select: {
            id: true,
            orderReference: true,
            zohoSyncError: true,
            zohoSyncLastAttemptAt: true,
          },
        }),
        this.prisma.featuredSlotBid.findMany({
          where: { zohoSyncStatus: 'FAILED' },
          orderBy: { zohoSyncLastAttemptAt: 'desc' },
          take: 50,
          select: {
            id: true,
            orderReference: true,
            zohoSyncError: true,
            zohoSyncLastAttemptAt: true,
          },
        }),
        // SubscriptionCharge has no zohoSync* columns — a receipt failure
        // is recorded in errorMessage on a SUCCEEDED charge whose
        // zohoReceiptId never got set.
        this.prisma.subscriptionCharge.findMany({
          where: {
            status: 'SUCCEEDED',
            zohoReceiptId: null,
            errorMessage: { startsWith: 'Zoho' },
          },
          orderBy: { chargedAt: 'desc' },
          take: 50,
          select: {
            id: true,
            orderReference: true,
            errorMessage: true,
            chargedAt: true,
          },
        }),
        // P1.3 — COMPLETED swaps that still owe a leg-fee Sales Receipt (the
        // Zoho POST failed at completion). Swap has no zohoSync* columns, so
        // the signal is a fee>0 side with a null receipt id. These are
        // re-fired by the hourly retryMissingSwapFeeReceipts cron.
        this.prisma.swap.findMany({
          where: {
            status: 'COMPLETED',
            OR: [
              { swapFeeInitiator: { gt: 0 }, zohoInitiatorFeeReceiptId: null },
              { swapFeeOwner: { gt: 0 }, zohoOwnerFeeReceiptId: null },
            ],
          },
          orderBy: { completedAt: 'desc' },
          take: 50,
          select: {
            id: true,
            initiatorFundingRef: true,
            swapFeeInitiator: true,
            zohoInitiatorFeeReceiptId: true,
            swapFeeOwner: true,
            zohoOwnerFeeReceiptId: true,
            completedAt: true,
          },
        }),
      ]);
    return {
      transactions,
      featuredBids,
      subscriptionCharges,
      swaps,
      totalFailed:
        transactions.length +
        featuredBids.length +
        subscriptionCharges.length +
        swaps.length,
    };
  }

  // ── P1.4 — Held-funds reconciliation (CFP position, read-only) ──────
  // "How much of the FNB balance is CLIENT money, not GG's?" — the number
  // the operator checks the bank balance against. Four components:
  //   1. Buyer money held pending delivery/release (HELD / admin-verify /
  //      DISPUTED, payment actually verified on the manual rail).
  //   2. Seller payouts owed (RELEASED, not yet paid out — batched or not),
  //      net of refund children exactly like the payout queue.
  //   3. Buyer refunds owed (REFUNDED rows not yet paid; children carry
  //      their slice, parents their residual — mirrors collectDue).
  //   4. Swap money held: locked-swap cash top-ups awaiting release +
  //      one-sided funding captured before lock.
  async getHeldFundsReport() {
    const childrenSum = (c?: { buyerTotal: number }[] | null) =>
      (c ?? []).reduce((s, x) => s + x.buyerTotal, 0);

    // (1) Held from buyers. Review fixes:
    //  - swapId:null — swap-leg transactions carry zero money (cash lives on
    //    the Swap, counted in buckets 4a/4b); counting them inflated the
    //    item count by 2 per swap forever.
    //  - manualCancelledAt:null — a soft-cancelled (never-paid) cart child
    //    stays HELD forever, so it must be excluded explicitly.
    //  - the "money has arrived" test is manualVerifiedAt on the MANUAL rail.
    //    The old `manualPayByAt: null` arm was meant for card-gateway rows,
    //    but multi-item cart CHILDREN also have manualPayByAt null (the window
    //    lives on the parent Order) — so that arm counted unpaid + cancelled
    //    cart children as client money. Under PAYMENT_MODE=manual, require
    //    manualVerifiedAt; only fall back to the payByAt-null arm off the
    //    manual rail (a real card gateway captures at creation).
    //  - net out refund children (a partial refund on a still-HELD parent is
    //    also counted in bucket 3, so the parent must shed that slice here).
    const arrivedGuard =
      PAYMENT_MODE === 'manual'
        ? { manualVerifiedAt: { not: null } }
        : { OR: [{ manualVerifiedAt: { not: null } }, { manualPayByAt: null }] };
    const heldRows = await this.prisma.transaction.findMany({
      where: {
        paymentStatus: {
          in: ['HELD', 'PENDING_ADMIN_VERIFICATION', 'DISPUTED'],
        },
        refundOfId: null,
        swapId: null,
        manualCancelledAt: null,
        ...arrivedGuard,
      },
      select: {
        buyerTotal: true,
        refundChildren: { select: { buyerTotal: true } },
      },
    });
    const heldAwaitingRelease = {
      count: heldRows.length,
      cents: heldRows.reduce(
        (s, r) => s + Math.max(0, r.buyerTotal - childrenSum(r.refundChildren)),
        0,
      ),
    };

    // (2) Owed to sellers — RELEASED and not yet settled, including rows
    // already frozen into a pending batch (still owed until mark-paid).
    const payoutRows = await this.prisma.transaction.findMany({
      where: {
        paymentStatus: 'RELEASED',
        sellerPayout: { gt: 0 },
        paidOutAt: null,
        refundOfId: null,
      },
      select: {
        sellerPayout: true,
        refundChildren: { select: { buyerTotal: true } },
      },
    });
    const owedToSellers = {
      count: payoutRows.length,
      cents: payoutRows.reduce(
        (s, r) => s + Math.max(0, r.sellerPayout - childrenSum(r.refundChildren)),
        0,
      ),
    };

    // (3) Owed to buyers — refunds not yet paid (manual mode only; a card
    // gateway reverses on the card so nothing is owed from the account).
    const refundRows =
      PAYMENT_MODE !== 'manual'
        ? []
        : await this.prisma.transaction.findMany({
            where: {
              paymentStatus: 'REFUNDED',
              buyerTotal: { gt: 0 },
              paidOutAt: null,
            },
            select: {
              refundOfId: true,
              buyerTotal: true,
              refundChildren: { select: { buyerTotal: true } },
            },
          });
    const owedToBuyerRefunds = {
      count: refundRows.length,
      cents: refundRows.reduce(
        (s, r) =>
          s +
          (r.refundOfId
            ? r.buyerTotal // child = its slice
            : Math.max(0, r.buyerTotal - childrenSum(r.refundChildren))), // parent = residual
        0,
      ),
    };

    // (4a) Swap cash top-ups held between LOCK and release.
    const lockedSwaps = await this.prisma.swap.findMany({
      where: {
        status: { in: ['LOCKED', 'IN_TRANSIT', 'AWAITING_VERIFICATION', 'DISPUTED'] },
        cashReleasedAt: null,
        cashAmount: { gt: 0 },
      },
      select: { cashAmount: true },
    });
    const swapCashHeld = {
      count: lockedSwaps.length,
      cents: lockedSwaps.reduce((s, r) => s + r.cashAmount, 0),
    };

    // (4b) One-sided funding captured pre-lock: a party has paid their
    // funding EFT but the swap hasn't locked — if the other side lapses
    // this money is reimbursed, so it's a liability while it sits here.
    const fundingSwaps = await this.prisma.swap.findMany({
      where: {
        status: 'AWAITING_FUNDING',
        OR: [
          { initiatorVerifiedAt: { not: null }, initiatorRefundedAt: null },
          { ownerVerifiedAt: { not: null }, ownerRefundedAt: null },
        ],
      },
      select: {
        initiatorVerifiedAt: true,
        initiatorRefundedAt: true,
        initiatorFundingAmount: true,
        ownerVerifiedAt: true,
        ownerRefundedAt: true,
        ownerFundingAmount: true,
      },
    });
    let fundingCents = 0;
    for (const s of fundingSwaps) {
      if (s.initiatorVerifiedAt && !s.initiatorRefundedAt)
        fundingCents += s.initiatorFundingAmount;
      if (s.ownerVerifiedAt && !s.ownerRefundedAt)
        fundingCents += s.ownerFundingAmount;
    }
    const swapFundingInFlight = { count: fundingSwaps.length, cents: fundingCents };

    return {
      asOf: new Date().toISOString(),
      paymentMode: PAYMENT_MODE,
      heldAwaitingRelease,
      owedToSellers,
      owedToBuyerRefunds,
      swapCashHeld,
      swapFundingInFlight,
      totalClientFundsCents:
        heldAwaitingRelease.cents +
        owedToSellers.cents +
        owedToBuyerRefunds.cents +
        swapCashHeld.cents +
        swapFundingInFlight.cents,
    };
  }

  // ── Payouts due (read-only) ─────────────────────────────────────────
  // Seller payouts: transactions whose funds have been RELEASED (buyer
  // confirmed delivery / dealer-verify approved / PRIVATE_ARRANGE) and
  // are owed to the seller. Buyer refunds: transactions marked REFUNDED
  // that still need the money sent back. The admin downloads these as a
  // CSV, makes ONE FNB bulk payment, then marks the batch paid.
  //
  // "Due" = owed but not yet batched or paid out: payoutBatchId null (not
  // already frozen into a pending batch) AND paidOutAt null (not already
  // settled). This is what the preview shows + what a new batch freezes.
  async getPayoutsDue() {
    const payouts = await this.prisma.transaction.findMany({
      where: {
        paymentStatus: 'RELEASED',
        sellerPayout: { gt: 0 },
        paidOutAt: null,
        payoutBatchId: null,
        // P0.3 — synthetic refund children are never seller payouts.
        refundOfId: null,
        // M26 — a held row is withheld from the sweep until an admin clears
        // the hold (post-release fraud lever). Never enters an FNB batch.
        payoutHeldAt: null,
      },
      orderBy: { releasedAt: 'asc' },
      select: {
        id: true,
        orderReference: true,
        sellerPayout: true,
        refundedAmount: true,
        // P0.3 review fix — the seller is docked only for refund slices the
        // buyer is ACTUALLY being paid (i.e. minted children), never for
        // legacy pre-deploy refundedAmount that no money ever moved for.
        refundChildren: { select: { buyerTotal: true } },
        releasedAt: true,
        seller: {
          select: {
            username: true,
            email: true,
            phone: true,
            bankAccountHolder: true,
            bankName: true,
            bankAccountNumber: true,
            bankBranchCode: true,
            bankAccountType: true,
            // FLOW-F1 — the documented payout HARD GATE (profile complete +
            // KYC VERIFIED) must hold on THIS path too, not only on the admin
            // manual-release path. collectDue skips sellers failing it.
            kycStatus: true,
            profileCompletedAt: true,
          },
        },
      },
    });
    // Refunds are only owed by EFT in MANUAL mode. Under a live card
    // gateway the reversal happens on the card, so paying these rows would
    // refund a SECOND time — hard-gate on manual mode.
    //
    // P0.3 (redesigned after adversarial review) — two row shapes are due:
    //  (a) synthetic refund CHILDREN (refundOfId set) — one per admin
    //      refund operation, buyerTotal = that slice.
    //  (b) REFUNDED PARENTS, paid their RESIDUAL: buyerTotal − Σ(children).
    //      This covers every path that flips a parent to REFUNDED without
    //      minting a child (seller reject, buyer cancel, dispatch-SLA cron,
    //      legacy pre-deploy rows): whatever the children don't carry, the
    //      parent row does — total paid is always exactly buyerTotal.
    //      A parent fully covered by children nets to ≤0 and is dropped in
    //      collectDue. Exactly-once per row via payoutBatchId/paidOutAt.
    const refunds = PAYMENT_MODE !== 'manual' ? [] : await this.prisma.transaction.findMany({
      where: {
        paymentStatus: 'REFUNDED',
        buyerTotal: { gt: 0 },
        paidOutAt: null,
        payoutBatchId: null,
        // M26 — held refund rows are withheld from the sweep too.
        payoutHeldAt: null,
      },
      orderBy: { updatedAt: 'asc' },
      select: {
        id: true,
        refundOfId: true,
        orderReference: true,
        buyerTotal: true,
        refundChildren: { select: { buyerTotal: true } },
        updatedAt: true,
        buyer: {
          select: {
            username: true,
            email: true,
            phone: true,
            bankAccountHolder: true,
            bankName: true,
            bankAccountNumber: true,
            bankBranchCode: true,
            bankAccountType: true,
          },
        },
      },
    });
    return { payouts, refunds };
  }

  // FNB "BInSol - U" bulk-payment file (real format, per operator's
  // template). FNB ignores rows 1–4 on import and reads row 4's column order
  // for the data rows. Includes BOTH seller payouts (RELEASED funds owed) and
  // buyer refunds (REFUNDED) as recipient rows — every row is an outbound
  // payment from GG's account. Rows missing essential bank details (account
  // number / holder / branch) are SKIPPED so the file never carries an
  // invalid line; the skipped count is logged + returned via buildPayoutFile.
  // The operator reviews + authorises in FNB before any money moves.
  // Map the currently-due payouts + refunds to FNB recipient rows. Rows
  // missing essential bank details (holder/account/branch) are SKIPPED so the
  // file never carries an invalid line. Returns the included tx ids (split by
  // payout vs refund) + totals so a batch can freeze exactly this set.
  //
  // FLOW-F2 — `pre` lets getPayoutsDuePreview reuse a due set it already
  // fetched (avoids a double query); omitted on the batch path, so batching
  // semantics are unchanged. Alongside the legacy skippedRefs strings we now
  // also build `skipped` (structured {kind, ref, reason}) for the preview.
  private async collectDue(
    pre?: Awaited<ReturnType<ManualPaymentsService['getPayoutsDue']>>,
  ) {
    const { payouts, refunds } = pre ?? (await this.getPayoutsDue());
    const recipients: FnbRecipient[] = [];
    const payoutIds: string[] = [];
    const refundIds: string[] = [];
    // Rows that net to R0 (fully consumed by refund slices) — they owe no
    // EFT but MUST be settled (stamped) by the batch or they zombie in the
    // due queue forever (adversarial-review finding).
    const zeroNetIds: string[] = [];
    let payoutTotalCents = 0;
    let refundTotalCents = 0;
    const skippedRefs: string[] = [];
    const skipped: SkippedDueRow[] = [];

    const hasBank = (b: {
      bankAccountHolder: string | null;
      bankAccountNumber: string | null;
      bankBranchCode: string | null;
    }) => !!(b.bankAccountHolder && b.bankAccountNumber && b.bankBranchCode);

    const childrenSum = (c?: { buyerTotal: number }[] | null) =>
      (c ?? []).reduce((s, x) => s + x.buyerTotal, 0);

    for (const p of payouts) {
      // P0.3 (review fix) — dock the seller ONLY for refund slices that are
      // actually being paid to the buyer (minted children). Legacy
      // pre-deploy refundedAmount without children never moved money, so
      // docking it would short the seller while the buyer still gets
      // nothing (GG silently retaining the difference).
      const covered = childrenSum(p.refundChildren);
      const payoutAmount = Math.max(0, p.sellerPayout - covered);
      if (payoutAmount <= 0) {
        // Fully consumed by refunds — settle with zero EFT via the batch
        // (createPayoutBatch stamps these paidOutAt) so the row leaves the
        // due queue and its Zoho invoice can be marked paid.
        zeroNetIds.push(p.id);
        skippedRefs.push(
          `PAYOUT ${p.orderReference ?? p.id} (R0 — fully consumed by ${covered}c in refunds; settled without EFT)`,
        );
        skipped.push({
          kind: 'PAYOUT',
          ref: p.orderReference ?? p.id,
          reason:
            'Nets to R0 — fully consumed by refund slices; will be settled without EFT on the next batch (no action needed)',
        });
        continue;
      }
      if (!hasBank(p.seller)) {
        skippedRefs.push(`PAYOUT ${p.orderReference ?? p.id}`);
        skipped.push({
          kind: 'PAYOUT',
          ref: p.orderReference ?? p.id,
          reason: `Seller ${p.seller.username ?? '(no username)'} has no bank details on file — payout waits until they add banking details on their profile`,
        });
        continue;
      }
      // FLOW-F1 — payout KYC hard gate. A seller is paid ONLY once their
      // profile is complete AND KYC is VERIFIED (the platform's documented
      // payout gate, previously enforced only on the admin manual-release
      // path). The row stays in the due queue and clears automatically the
      // day the seller verifies; the skip reason names the blocker so the
      // 09:00 payouts-due reminder isn't a mystery. Buyer REFUND rows below
      // are deliberately NOT gated — returning a buyer's own money must
      // never wait on seller-style verification.
      if (p.seller.kycStatus !== 'VERIFIED' || !p.seller.profileCompletedAt) {
        skippedRefs.push(
          `PAYOUT ${p.orderReference ?? p.id} (seller ${p.seller.username}: ${
            p.seller.kycStatus !== 'VERIFIED' ? 'KYC not verified' : 'profile incomplete'
          } — payout held until verified)`,
        );
        skipped.push({
          kind: 'PAYOUT',
          ref: p.orderReference ?? p.id,
          reason: `Seller ${p.seller.username ?? '(no username)'}: ${
            p.seller.kycStatus !== 'VERIFIED' ? 'KYC not verified' : 'profile incomplete'
          } — payout held until verified`,
        });
        continue;
      }
      recipients.push({
        name: p.seller.bankAccountHolder!,
        account: p.seller.bankAccountNumber!,
        accountType: p.seller.bankAccountType,
        branchCode: p.seller.bankBranchCode!,
        amountCents: payoutAmount,
        ownReference: p.orderReference ?? p.id,
        recipientReference: `Gun Galore ${p.orderReference ?? ''}`.trim(),
        email: p.seller.email,
        phone: p.seller.phone,
      });
      payoutIds.push(p.id);
      payoutTotalCents += payoutAmount;
    }

    for (const r of refunds) {
      // P0.3 (review fix) — children pay their own slice; a REFUNDED
      // parent pays the RESIDUAL its children don't carry. Total across
      // parent + children is always exactly buyerTotal, whichever path
      // flipped the parent (admin, seller reject, buyer cancel, SLA cron,
      // legacy rows). A parent fully covered by children owes nothing —
      // settle it with zero EFT so it leaves the queue.
      const amount = r.refundOfId
        ? r.buyerTotal // child — its own slice
        : Math.max(0, r.buyerTotal - childrenSum(r.refundChildren));
      if (amount <= 0) {
        zeroNetIds.push(r.id);
        continue;
      }
      if (!hasBank(r.buyer)) {
        skippedRefs.push(`REFUND ${r.orderReference ?? r.id}`);
        skipped.push({
          kind: 'REFUND',
          ref: r.orderReference ?? r.id,
          reason: `Buyer ${r.buyer.username ?? '(no username)'} has no bank details on file — refund waits until they add banking details on their profile (refund notifications link them there)`,
        });
        continue;
      }
      recipients.push({
        name: r.buyer.bankAccountHolder!,
        account: r.buyer.bankAccountNumber!,
        accountType: r.buyer.bankAccountType,
        branchCode: r.buyer.bankBranchCode!,
        amountCents: amount,
        ownReference: `Refund ${r.orderReference ?? r.id}`,
        recipientReference: `Gun Galore refund`,
        email: r.buyer.email,
        phone: r.buyer.phone,
      });
      refundIds.push(r.id);
      refundTotalCents += amount;
    }

    // Only warn-log on the BATCH path (`pre` unset). The preview path
    // (getPayoutsDuePreview) shows the skips in the admin UI on every
    // page load — logging "Payout batch: skipped" there would be both
    // noisy and misleading.
    if (skippedRefs.length && !pre) {
      this.logger.warn(
        `Payout batch: ${skippedRefs.length} row(s) skipped — ${skippedRefs.join('; ')}`,
      );
    }
    return {
      recipients,
      payoutIds,
      refundIds,
      zeroNetIds,
      payoutTotalCents,
      refundTotalCents,
      skippedRefs,
      skipped,
    };
  }

  // FLOW-F2 — admin preview: everything due now PLUS the rows the batch
  // builder would skip, each with a structured reason (missing bank
  // details / KYC gate / zero-net), so the operator sees blocked money
  // on the payouts-due panel BEFORE freezing a batch. Read-only: the due
  // rows are fetched once and passed into collectDue, which performs no
  // writes on this path — batching semantics untouched.
  async getPayoutsDuePreview() {
    const due = await this.getPayoutsDue();
    const { skipped } = await this.collectDue(due);
    return { ...due, skipped };
  }

  private buildCsv(recipients: FnbRecipient[]): string {
    return buildFnbBulkFile(recipients, {
      sourceAccount: GG_BANK_DETAILS.accountNumber,
      actionDate: sastActionDate(new Date()),
      notify: true, // operator chose to notify sellers (EMAIL 1 + SMS 1)
    });
  }

  // Ad-hoc CSV of everything currently due (NOT frozen into a batch). Kept for
  // a quick eyeball; the real flow is createPayoutBatch (freeze) → markPaid.
  async buildPayoutCsv(): Promise<string> {
    const d = await this.collectDue();
    return this.buildCsv(d.recipients);
  }

  // ── Payout batches (P7.1 — freeze-on-download) ──────────────────────
  // Freeze EXACTLY the payouts/refunds due now: snapshot the FNB CSV, link
  // those transactions to a PENDING batch (so they leave the due queue and
  // can't be double-batched), and return the file to download. The operator
  // pays in FNB, then marks THIS batch paid.
  async createPayoutBatch(adminClerkId: string | null) {
    const d = await this.collectDue();

    // Settle zero-net rows (fully consumed by refund slices) OUTSIDE the
    // batch: they owe no EFT, but must be stamped paidOutAt or they sit in
    // the due queue forever. Their Zoho commission invoice (if any) is
    // marked paid via the normal drain — the commission WAS retained.
    if (d.zeroNetIds.length) {
      await this.prisma.transaction.updateMany({
        // M26 — respect a payout hold placed during the freeze window. A held
        // row must not be silently settled here either (mirrors the freeze
        // guard below); an excluded row simply stays in the due queue.
        where: {
          id: { in: d.zeroNetIds },
          payoutBatchId: null,
          paidOutAt: null,
          payoutHeldAt: null,
        },
        data: { paidOutAt: new Date() },
      });
      this.logger.log(
        `Settled ${d.zeroNetIds.length} zero-net row(s) without EFT: ${d.zeroNetIds.join(', ')}`,
      );
      for (const id of d.zeroNetIds) {
        void this.zohoBooks.markCommissionInvoicePaid(id);
      }
    }

    if (d.recipients.length === 0) {
      if (d.zeroNetIds.length) {
        // Nothing to pay by EFT, but we did settle rows — report that
        // instead of an error so the queue visibly drains.
        return {
          batchId: null,
          csv: null,
          included: 0,
          skipped: d.skippedRefs.length,
          skippedRefs: d.skippedRefs,
          grandTotal: 0,
          settledWithoutEft: d.zeroNetIds.length,
        };
      }
      throw new BadRequestException(
        'No payouts or refunds are due right now (or all due rows are missing bank details).',
      );
    }
    const csv = this.buildCsv(d.recipients);
    const allIds = [...d.payoutIds, ...d.refundIds];

    const batch = await this.prisma.$transaction(async (txc) => {
      const b = await txc.payoutBatch.create({
        data: {
          status: 'PENDING',
          payoutTotal: d.payoutTotalCents,
          refundTotal: d.refundTotalCents,
          grandTotal: d.payoutTotalCents + d.refundTotalCents,
          itemCount: allIds.length,
          csv,
          createdById: adminClerkId,
        },
      });
      // Link only rows STILL un-batched + un-paid + un-held. If a concurrent
      // freeze grabbed any — or a payout hold (M26) landed during this freeze
      // window — the count won't match → abort (rolls back) so the CSV always
      // matches the linked set; the operator simply retries with the held row
      // excluded. getPayoutsDue's read-time filter alone missed this race.
      const linked = await txc.transaction.updateMany({
        where: {
          id: { in: allIds },
          payoutBatchId: null,
          paidOutAt: null,
          payoutHeldAt: null,
        },
        data: { payoutBatchId: b.id },
      });
      if (linked.count !== allIds.length) {
        throw new BadRequestException(
          'The payout set changed while preparing the batch — please try again.',
        );
      }
      return b;
    });

    this.logger.log(
      `Payout batch ${batch.id} frozen — ${allIds.length} lines, R${(batch.grandTotal / 100).toFixed(2)} (by ${adminClerkId ?? 'unknown'})`,
    );
    return {
      batchId: batch.id,
      csv,
      included: allIds.length,
      skipped: d.skippedRefs.length,
      skippedRefs: d.skippedRefs,
      grandTotal: batch.grandTotal,
      settledWithoutEft: d.zeroNetIds.length,
    };
  }

  async getPayoutBatch(id: string) {
    return this.prisma.payoutBatch.findUnique({
      where: { id },
      include: {
        transactions: {
          select: {
            id: true,
            orderReference: true,
            paymentStatus: true,
            sellerPayout: true,
            buyerTotal: true,
            seller: { select: { username: true, bankAccountHolder: true } },
            buyer: { select: { username: true, bankAccountHolder: true } },
          },
        },
      },
    });
  }

  async listPayoutBatches(limit = 30) {
    return this.prisma.payoutBatch.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        status: true,
        payoutTotal: true,
        refundTotal: true,
        grandTotal: true,
        itemCount: true,
        createdAt: true,
        paidAt: true,
        cancelledAt: true,
      },
    });
  }

  // Re-download a frozen batch's exact CSV (the snapshot stored at freeze).
  async getPayoutBatchCsv(id: string): Promise<string> {
    const b = await this.prisma.payoutBatch.findUnique({
      where: { id },
      select: { csv: true },
    });
    if (!b) throw new NotFoundException('Payout batch not found');
    return b.csv;
  }

  // Settle a batch after the operator has made the FNB bulk payment. Atomic
  // PENDING→PAID claim (idempotent), stamp paidOutAt on every line, and fire
  // the Zoho book entry per seller payout (best-effort — Books being down
  // must never block settlement).
  async markPayoutBatchPaid(batchId: string, adminClerkId: string | null) {
    // ATOMIC: the PENDING→PAID claim AND the per-line paidOutAt stamp commit
    // together (or not at all). Without this, a crash between the two writes
    // would leave a PAID batch whose lines are unstamped — and the claim guard
    // makes that state unrecoverable through the UI. The findMany of which
    // lines are payouts (for the Zoho loop) happens inside too; the Zoho calls
    // themselves stay OUTSIDE the transaction (best-effort, after commit).
    const now = new Date();
    const payoutTxs = await this.prisma.$transaction(async (txc) => {
      const claim = await txc.payoutBatch.updateMany({
        where: { id: batchId, status: 'PENDING' },
        data: { status: 'PAID', paidAt: now, paidById: adminClerkId },
      });
      if (claim.count === 0) {
        throw new BadRequestException(
          'This batch is not pending — it may already be paid or cancelled.',
        );
      }
      await txc.transaction.updateMany({
        where: { payoutBatchId: batchId, paidOutAt: null },
        data: { paidOutAt: now },
      });
      // Which lines are seller payouts (refunds carry no commission invoice).
      return txc.transaction.findMany({
        where: { payoutBatchId: batchId, paymentStatus: 'RELEASED' },
        select: { id: true },
      });
    });
    for (const t of payoutTxs) {
      await this.zohoBooks
        .markCommissionInvoicePaid(t.id)
        .catch((e) =>
          this.logger.warn(
            `Payout batch ${batchId}: Zoho markCommissionInvoicePaid failed for ${t.id}: ${(e as Error).message}`,
          ),
        );
    }
    this.logger.log(
      `Payout batch ${batchId} marked PAID by ${adminClerkId ?? 'unknown'} — ${payoutTxs.length} payouts settled`,
    );
    return { batchId, settledPayouts: payoutTxs.length };
  }

  // Abandon a pending batch (operator didn't pay / made a mistake). Returns
  // its lines to the due queue so they appear in the next batch.
  async cancelPayoutBatch(batchId: string) {
    const claim = await this.prisma.payoutBatch.updateMany({
      where: { id: batchId, status: 'PENDING' },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    if (claim.count === 0) {
      throw new BadRequestException('Only a pending batch can be cancelled.');
    }
    await this.prisma.transaction.updateMany({
      where: { payoutBatchId: batchId, paidOutAt: null },
      data: { payoutBatchId: null },
    });
    this.logger.log(`Payout batch ${batchId} cancelled — lines returned to queue`);
    return { batchId, cancelled: true };
  }
}
