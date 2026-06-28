import { Injectable, Logger } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../payments/transactions.service';
import {
  parseInContact,
  parseStatementCsv,
  type ParsedStatementRow,
} from './manual-payment.parser';

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
    if (!order) return { status: 'UNMATCHED', transactionId: null, orderId: null };
    if (order.paidAt)
      return { status: 'ALREADY', transactionId: null, orderId: order.id };
    if (order.manualCancelledAt)
      return { status: 'EXPIRED', transactionId: null, orderId: order.id };
    if (order.buyerTotal !== amountCents)
      return { status: 'AMBIGUOUS', transactionId: null, orderId: order.id };
    return { status: 'MATCHED', transactionId: null, orderId: order.id };
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
  // NOTE: this is read-only today. The "mark batch paid" settle + Zoho
  // payout trigger is intentionally NOT wired yet — it lands with the
  // real FNB bulk-payment template (operator delivering Monday) so the
  // CSV columns + the settle step ship together against a confirmed
  // format rather than a guessed one. See buildPayoutCsv() TODO.
  async getPayoutsDue() {
    const payouts = await this.prisma.transaction.findMany({
      where: { paymentStatus: 'RELEASED', sellerPayout: { gt: 0 } },
      orderBy: { releasedAt: 'asc' },
      select: {
        id: true,
        orderReference: true,
        sellerPayout: true,
        releasedAt: true,
        seller: {
          select: {
            username: true,
            bankAccountHolder: true,
            bankName: true,
            bankAccountNumber: true,
            bankBranchCode: true,
            bankAccountType: true,
          },
        },
      },
    });
    const refunds = await this.prisma.transaction.findMany({
      where: { paymentStatus: 'REFUNDED', buyerTotal: { gt: 0 } },
      orderBy: { updatedAt: 'asc' },
      select: {
        id: true,
        orderReference: true,
        buyerTotal: true,
        updatedAt: true,
        buyer: {
          select: {
            username: true,
            bankAccountHolder: true,
            bankName: true,
            bankAccountNumber: true,
            bankBranchCode: true,
          },
        },
      },
    });
    return { payouts, refunds };
  }

  // Placeholder FNB bulk-payment CSV. The COLUMN LAYOUT here is a
  // best-guess and MUST be swapped for FNB's real "Pay Multiple
  // Recipients" template (operator delivering Monday) before any real
  // bulk payment is made — FNB imports are strict. Until then this is a
  // human-readable export the operator can eyeball.
  async buildPayoutCsv(): Promise<string> {
    const { payouts, refunds } = await this.getPayoutsDue();
    const header = [
      'Type',
      'Recipient',
      'AccountHolder',
      'Bank',
      'AccountNumber',
      'BranchCode',
      'AccountType',
      'AmountZAR',
      'Reference',
      'TransactionId',
    ].join(',');
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows: string[] = [];
    for (const p of payouts) {
      rows.push(
        [
          esc('PAYOUT'),
          esc(p.seller.username),
          esc(p.seller.bankAccountHolder),
          esc(p.seller.bankName),
          esc(p.seller.bankAccountNumber),
          esc(p.seller.bankBranchCode),
          esc(p.seller.bankAccountType),
          (p.sellerPayout / 100).toFixed(2),
          esc(p.orderReference),
          esc(p.id),
        ].join(','),
      );
    }
    for (const r of refunds) {
      rows.push(
        [
          esc('REFUND'),
          esc(r.buyer.username),
          esc(r.buyer.bankAccountHolder),
          esc(r.buyer.bankName),
          esc(r.buyer.bankAccountNumber),
          esc(r.buyer.bankBranchCode),
          esc(''),
          (r.buyerTotal / 100).toFixed(2),
          esc(r.orderReference),
          esc(r.id),
        ].join(','),
      );
    }
    return [header, ...rows].join('\r\n');
  }
}
