import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { FeeModel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BRAND_NAME, SUPPORT_EMAIL } from '../common/brand';
import { sellerBreakdown } from './fee-presentation';

// ────────────────────────────────────────────────────────────────────
// Seller remittance advice (payment voucher).
//
// The document a seller shows SARS against the credit on their bank
// statement: it names the payer, the gross sale, any platform fee, and the
// exact net that was disbursed. It is NOT a tax invoice — the auction
// seller's Platform Fee invoice already exists in Books; this is the proof
// of payment for the payout itself.
//
// Issued once the money has actually left (Transaction.paidOutAt set), so
// the amount on the page is the amount that reached the bank.
// ────────────────────────────────────────────────────────────────────

const NAVY = rgb(0.06, 0.16, 0.29);
const GREY = rgb(0.4, 0.43, 0.52);
const BLACK = rgb(0.1, 0.1, 0.12);
const RULE = rgb(0.8, 0.82, 0.86);

/** The row fields the document needs. Structural, so the smoke can build one. */
export interface RemittanceTx {
  id: string;
  listingPrice: number;
  shippingCost: number;
  shippingHandlingCents: number;
  processingFee: number;
  buyerTotal: number;
  passFeeToBuyer: boolean;
  commissionZar: number;
  sellerPayout: number;
  feeModel: FeeModel;
  paidOutAt: Date | null;
  orderReference: string | null;
  order: { orderReference: string | null } | null;
  listing: { title: string };
  seller: { username: string | null };
}

function money(cents: number): string {
  return (
    'R' +
    (cents / 100).toLocaleString('en-ZA', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

@Injectable()
export class RemittanceService {
  private readonly logger = new Logger(RemittanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async generateForTransaction(
    transactionId: string,
    userId: string,
  ): Promise<{ pdf: Uint8Array; filename: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        listing: { select: { title: true } },
        seller: { select: { id: true, username: true } },
        order: { select: { orderReference: true } },
      },
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.sellerId !== user.id) {
      throw new ForbiddenException(
        'Only the seller can download this remittance advice',
      );
    }
    if (!tx.paidOutAt) {
      throw new ForbiddenException(
        'Remittance advice is available once the payout has been paid',
      );
    }

    return this.buildPdf(tx);
  }

  /**
   * Renders the document from a row. No database access, so the smoke test
   * can prove the layout without a live payout.
   */
  async buildPdf(
    tx: RemittanceTx,
  ): Promise<{ pdf: Uint8Array; filename: string }> {
    const ref = tx.orderReference ?? tx.order?.orderReference ?? tx.id;
    const paid = tx.paidOutAt;
    if (!paid) {
      throw new Error('Remittance advice requires a paid-out transaction');
    }
    const shown = sellerBreakdown(tx);
    if (!shown.balances) {
      // Never print a document that disagrees with itself. The row should be
      // impossible for a sale written by current checkout, and
      // fee-presentation.spec covers the matrix; log rather than misstate.
      this.logger.error(
        `Remittance ${tx.id}: gross less deductions does not equal payout (${shown.net})`,
      );
    }

    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]); // A4 portrait, points
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const { width } = page.getSize();
    const M = 56;
    let y = 786;

    const text = (
      s: string,
      opts: {
        x?: number;
        size?: number;
        b?: boolean;
        color?: typeof BLACK;
      } = {},
    ) => {
      page.drawText(s, {
        x: opts.x ?? M,
        y,
        size: opts.size ?? 10,
        font: opts.b ? bold : font,
        color: opts.color ?? BLACK,
      });
    };
    const right = (s: string, size = 10, b = false) => {
      const f = b ? bold : font;
      const w = f.widthOfTextAtSize(s, size);
      page.drawText(s, { x: width - M - w, y, size, font: f, color: BLACK });
    };
    const rule = () => {
      page.drawLine({
        start: { x: M, y: y + 8 },
        end: { x: width - M, y: y + 8 },
        thickness: 0.5,
        color: RULE,
      });
      y -= 8;
    };

    // Header
    text(BRAND_NAME.toUpperCase(), { size: 22, b: true, color: NAVY });
    y -= 18;
    text('Remittance advice', { size: 12, color: GREY });
    y -= 30;

    // Meta
    const meta = (label: string, value: string) => {
      text(label, { b: true, color: GREY });
      right(value);
      y -= 16;
    };
    meta('Payout date', ymd(paid));
    meta('Order reference', ref);
    meta('Sale type', tx.feeModel === FeeModel.SELLER_DEDUCT ? 'Auction' : 'Buy Now');
    meta(
      'Paid to',
      tx.seller.username ? `@${tx.seller.username}` : 'ALL Outdoor seller',
    );
    meta('Paid from', 'ALL Outdoor (ABSA business account)');
    y -= 10;
    rule();

    // Item
    text('Item sold', { b: true });
    y -= 16;
    const title = tx.listing?.title ?? 'Item';
    text(title.length > 70 ? title.slice(0, 67) + '...' : title);
    y -= 26;

    // Money: gross, deductions, net — from the shared seller breakdown so the
    // auction fee (if any) and the payout always agree with the ledger.
    const line = (label: string, cents: number, b = false) => {
      text(label, { b, color: b ? BLACK : GREY });
      right(
        b ? money(cents) : cents < 0 ? `(${money(-cents)})` : money(cents),
        10,
        b,
      );
      y -= 16;
    };
    line(shown.grossLabel, shown.gross);
    for (const d of shown.deductions) line(d.label, d.cents);
    y -= 4;
    rule();
    line(shown.netLabel, shown.net, true);
    y -= 20;

    // Footer
    const note = (s: string) => {
      text(s, { size: 8.5, color: GREY });
      y -= 12;
    };
    note(
      'ALL Outdoor acted as disclosed agent for the seller. Amounts collected',
    );
    note(
      'from the buyer are held in Client Funds Payable until released to you.',
    );
    note(
      `This is a remittance advice, not a tax invoice. Questions: ${SUPPORT_EMAIL}`,
    );

    const pdf = await doc.save();
    return {
      pdf,
      filename: `remittance-${ref.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`,
    };
  }
}
