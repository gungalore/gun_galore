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
        note: this.matchNote(match.status),
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
    } else {
      res.unmatched += 1;
    }
    return true;
  }

  // Human-readable note for the admin investigation queue, by match kind.
  private matchNote(status: MatchStatus): string | null {
    if (status === 'AMBIGUOUS') {
      return 'Reference matched an order but the amount differs — investigate.';
    }
    if (status === 'EXPIRED') {
      return 'Buyer paid AFTER the 1-hour window expired and the item was released. Refund the buyer, or re-fulfil manually if the item is still available.';
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
        note: this.matchNote(match.status),
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
    } else if (match.status === 'AMBIGUOUS' || match.status === 'EXPIRED') {
      // EXPIRED = paid after the 1-hour window; needs admin refund/re-fulfil
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
      },
      orderBy: { releasedAt: 'asc' },
      select: {
        id: true,
        orderReference: true,
        sellerPayout: true,
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
          },
        },
      },
    });
    // Refunds are only owed by EFT in MANUAL mode. Every REFUNDED path first
    // calls stitch.refundPayment() — a no-op mock in manual mode (so the FNB
    // EFT is the real refund), but a genuine card reversal under a live
    // gateway. So when PAYMENT_MODE=paygate the buyer has ALREADY been
    // refunded on their card; including those rows here would pay them a
    // SECOND time. Hard-gate on manual mode so a mode flip can never
    // double-refund.
    const refunds = PAYMENT_MODE !== 'manual' ? [] : await this.prisma.transaction.findMany({
      where: {
        paymentStatus: 'REFUNDED',
        buyerTotal: { gt: 0 },
        paidOutAt: null,
        payoutBatchId: null,
      },
      orderBy: { updatedAt: 'asc' },
      select: {
        id: true,
        orderReference: true,
        buyerTotal: true,
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
  private async collectDue() {
    const { payouts, refunds } = await this.getPayoutsDue();
    const recipients: FnbRecipient[] = [];
    const payoutIds: string[] = [];
    const refundIds: string[] = [];
    let payoutTotalCents = 0;
    let refundTotalCents = 0;
    const skippedRefs: string[] = [];

    const hasBank = (b: {
      bankAccountHolder: string | null;
      bankAccountNumber: string | null;
      bankBranchCode: string | null;
    }) => !!(b.bankAccountHolder && b.bankAccountNumber && b.bankBranchCode);

    for (const p of payouts) {
      if (!hasBank(p.seller)) {
        skippedRefs.push(`PAYOUT ${p.orderReference ?? p.id}`);
        continue;
      }
      recipients.push({
        name: p.seller.bankAccountHolder!,
        account: p.seller.bankAccountNumber!,
        accountType: p.seller.bankAccountType,
        branchCode: p.seller.bankBranchCode!,
        amountCents: p.sellerPayout,
        ownReference: p.orderReference ?? p.id,
        recipientReference: `Gun Galore ${p.orderReference ?? ''}`.trim(),
        email: p.seller.email,
        phone: p.seller.phone,
      });
      payoutIds.push(p.id);
      payoutTotalCents += p.sellerPayout;
    }

    for (const r of refunds) {
      if (!hasBank(r.buyer)) {
        skippedRefs.push(`REFUND ${r.orderReference ?? r.id}`);
        continue;
      }
      recipients.push({
        name: r.buyer.bankAccountHolder!,
        account: r.buyer.bankAccountNumber!,
        accountType: r.buyer.bankAccountType,
        branchCode: r.buyer.bankBranchCode!,
        amountCents: r.buyerTotal,
        ownReference: `Refund ${r.orderReference ?? r.id}`,
        recipientReference: `Gun Galore refund`,
        email: r.buyer.email,
        phone: r.buyer.phone,
      });
      refundIds.push(r.id);
      refundTotalCents += r.buyerTotal;
    }

    if (skippedRefs.length) {
      this.logger.warn(
        `Payout batch: ${skippedRefs.length} row(s) skipped for missing bank details — ${skippedRefs.join('; ')}`,
      );
    }
    return {
      recipients,
      payoutIds,
      refundIds,
      payoutTotalCents,
      refundTotalCents,
      skippedRefs,
    };
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
    if (d.recipients.length === 0) {
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
      // Link only rows STILL un-batched + un-paid. If a concurrent freeze
      // grabbed any, the count won't match → abort (rolls back) so the CSV
      // always matches the linked set; the operator simply retries.
      const linked = await txc.transaction.updateMany({
        where: { id: { in: allIds }, payoutBatchId: null, paidOutAt: null },
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
