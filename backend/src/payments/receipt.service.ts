import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PrismaService } from '../prisma/prisma.service';

// ────────────────────────────────────────────────────────────────────
// Buyer purchase receipt (Phase 2). Gun Galore-issued proof of purchase —
// NOT an accounting/tax document (sellers get the Zoho commission invoice;
// the platform isn't VAT-registered). Generated on demand from the
// Transaction snapshot, so there's no stored file or extra schema field.
//
// PRIVACY: the receipt deliberately shows the seller's @username only (a
// public identifier) and Gun Galore's own contact — never the seller's
// real name / email / phone. Mirrors the POPIA strip in
// TransactionsService.findById.
// ────────────────────────────────────────────────────────────────────

const NAVY = rgb(0.06, 0.16, 0.29);
const GREY = rgb(0.4, 0.43, 0.52);
const BLACK = rgb(0.1, 0.1, 0.12);

function money(cents: number): string {
  return (
    'R' +
    (cents / 100).toLocaleString('en-ZA', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

@Injectable()
export class ReceiptService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build the buyer's receipt PDF. Authorises the requester as the BUYER on
   * the transaction and requires the order to have been paid. Returns the
   * PDF bytes; the controller streams them.
   */
  async generateReceiptPdf(
    transactionId: string,
    clerkId: string,
  ): Promise<{ pdf: Uint8Array; filename: string }> {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new NotFoundException('User not found');

    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        listing: { select: { title: true } },
        seller: { select: { username: true } },
        // Cart-child transactions carry NO per-tx orderReference — the single
        // GG-ORD-… EFT memo the buyer actually paid under lives on the parent
        // Order. Pull it so the receipt prints the real bank reference instead
        // of the raw transaction cuid.
        order: { select: { orderReference: true } },
      },
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    // Receipt is the BUYER's proof of purchase. Sellers have their Zoho
    // invoice + (Phase 6) payout statement.
    if (tx.buyerId !== user.id) {
      throw new ForbiddenException('Only the buyer can download this receipt');
    }
    if (!tx.paidAt) {
      throw new ForbiddenException('Receipt available once payment is made');
    }

    const ref = tx.orderReference ?? tx.order?.orderReference ?? tx.id;
    const paid = tx.paidAt;
    const dateStr = `${paid.getUTCFullYear()}-${String(paid.getUTCMonth() + 1).padStart(2, '0')}-${String(paid.getUTCDate()).padStart(2, '0')}`;

    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]); // A4 portrait, points
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const { width } = page.getSize();
    const M = 56; // left margin
    let y = 786;

    const text = (
      s: string,
      opts: { x?: number; size?: number; b?: boolean; color?: typeof BLACK } = {},
    ) => {
      page.drawText(s, {
        x: opts.x ?? M,
        y,
        size: opts.size ?? 10,
        font: opts.b ? bold : font,
        color: opts.color ?? BLACK,
      });
    };
    const right = (s: string, size = 10, b = false, color = BLACK) => {
      const f = b ? bold : font;
      const w = f.widthOfTextAtSize(s, size);
      page.drawText(s, { x: width - M - w, y, size, font: f, color });
    };

    // Header
    text('GUN GALORE', { size: 22, b: true, color: NAVY });
    y -= 18;
    text('Purchase receipt', { size: 12, color: GREY });
    y -= 30;

    text('Order reference', { b: true, color: GREY });
    right(ref, 10, true);
    y -= 16;
    text('Date paid', { b: true, color: GREY });
    right(dateStr);
    y -= 16;
    text('Payment status', { b: true, color: GREY });
    right(tx.paymentStatus);
    y -= 16;
    if (tx.shippingMethod) {
      text('Delivery method', { b: true, color: GREY });
      right(tx.shippingMethod.replace(/_/g, ' '));
      y -= 16;
    }
    text('Seller', { b: true, color: GREY });
    right(tx.seller.username ? `@${tx.seller.username}` : 'Gun Galore seller');
    y -= 28;

    // Divider
    page.drawLine({
      start: { x: M, y: y + 8 },
      end: { x: width - M, y: y + 8 },
      thickness: 0.5,
      color: rgb(0.8, 0.82, 0.86),
    });
    y -= 6;

    // Item
    text('Item', { b: true });
    y -= 16;
    const title = tx.listing?.title ?? 'Item';
    text(title.length > 70 ? title.slice(0, 67) + '…' : title);
    y -= 26;

    // Breakdown
    const line = (label: string, cents: number, b = false) => {
      text(label, { b, color: b ? BLACK : GREY });
      right(money(cents), 10, b);
      y -= 16;
    };
    line('Item price', tx.listingPrice);
    if (tx.shippingCost > 0) line('Shipping', tx.shippingCost);
    // P6.4 — the R15/waybill handling margin is part of buyerTotal but stored
    // apart from the (remitted) carrier rate, so it needs its own line or the
    // breakdown won't sum to "Total paid". Guarded on > 0 so firearm /
    // collection / consolidated-sibling receipts (handling 0) are unchanged.
    if (tx.shippingHandlingCents > 0)
      line('Handling', tx.shippingHandlingCents);
    if (tx.passFeeToBuyer && tx.processingFee > 0)
      line('Processing fee', tx.processingFee);
    y -= 4;
    page.drawLine({
      start: { x: M, y: y + 10 },
      end: { x: width - M, y: y + 10 },
      thickness: 0.5,
      color: rgb(0.8, 0.82, 0.86),
    });
    y -= 6;
    line('Total paid', tx.buyerTotal, true);
    y -= 26;

    // Footer notes
    const note = (s: string) => {
      text(s, { size: 8.5, color: GREY });
      y -= 12;
    };
    // FLOW-F4 (M27) — method-aware. A PRIVATE_ARRANGE order releases funds to
    // the seller immediately at payment (the buyer waived protection at
    // checkout), so the generic "held until delivery is confirmed" line is
    // false on a PA receipt (which even prints "Payment status: RELEASED").
    if (
      tx.shippingMethod === 'PRIVATE_ARRANGE' &&
      tx.privateArrangeAcceptedAt
    ) {
      const w = tx.privateArrangeAcceptedAt;
      const waiverDate = `${w.getUTCFullYear()}-${String(w.getUTCMonth() + 1).padStart(2, '0')}-${String(w.getUTCDate()).padStart(2, '0')}`;
      note(
        `Payment was released to the seller immediately at your request — payment protection was waived at checkout on ${waiverDate}.`,
      );
    } else if (tx.shippingMethod === 'DEALER_TRANSFER') {
      // A firearm DEALER_TRANSFER release is gated on SAPS-534 dealer
      // verification, not a buyer delivery confirmation.
      note(
        'Your payment is held by Gun Galore and released to the seller once the SAPS 534 dealer transfer is verified.',
      );
    } else {
      note(
        'Your payment is held by Gun Galore and released to the seller once delivery is confirmed.',
      );
    }
    note(
      'This is a proof-of-purchase receipt, not a tax invoice. Questions: support@gungalore.co.za',
    );
    note('Gun Galore — gungalore.co.za');

    const pdf = await doc.save();
    return { pdf, filename: `gun-galore-receipt-${ref}.pdf` };
  }
}
