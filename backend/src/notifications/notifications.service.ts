import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

// Fails open — emails are fire-and-forget; never block the main flow.

const FROM = 'Gun Galore <noreply@gungalore.co.za>';
const BRAND_RED = '#c0392b';
const BG = '#0f0f0f';
const CARD = '#1a1a1a';
const TEXT = '#e5e5e5';
const MUTED = '#888';

function layout(body: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gun Galore</title>
</head>
<body style="margin:0;padding:0;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
        <!-- Header -->
        <tr>
          <td style="padding:0 0 24px 0;">
            <span style="font-size:18px;font-weight:600;color:${TEXT};letter-spacing:-0.01em;">
              Gun<span style="color:${BRAND_RED}">·</span>Galore
            </span>
          </td>
        </tr>
        <!-- Card -->
        <tr>
          <td style="background:${CARD};border-radius:10px;border:0.5px solid #2a2a2a;padding:32px;">
            ${body}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:24px 0 0 0;text-align:center;font-size:11px;color:${MUTED};">
            Gun Galore SA · Firearms Marketplace · <a href="https://gungalore.co.za" style="color:${MUTED};">gungalore.co.za</a>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function h1(text: string) {
  return `<h1 style="margin:0 0 16px;font-size:22px;font-weight:600;color:${TEXT};letter-spacing:-0.02em;">${text}</h1>`;
}

function p(text: string) {
  return `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:${MUTED};">${text}</p>`;
}

function strong(text: string) {
  return `<span style="color:${TEXT};font-weight:500;">${text}</span>`;
}

function divider() {
  return `<div style="border-top:0.5px solid #2a2a2a;margin:20px 0;"></div>`;
}

function button(label: string, url: string) {
  return `<a href="${url}" style="display:inline-block;margin-top:8px;padding:10px 20px;background:${BRAND_RED};color:#fff;border-radius:6px;font-size:13px;font-weight:500;text-decoration:none;">${label}</a>`;
}

function amountRow(label: string, value: string) {
  return `<tr>
    <td style="padding:4px 0;font-size:13px;color:${MUTED};">${label}</td>
    <td style="padding:4px 0;font-size:13px;color:${TEXT};text-align:right;">${value}</td>
  </tr>`;
}

function formatRand(cents: number) {
  return `R${(cents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export interface SaleDetails {
  listingTitle: string;
  listingId: string;
  transactionId: string;
  buyerEmail: string;
  buyerName: string;
  sellerEmail: string;
  sellerName: string;
  listingPrice: number;
  commissionZar: number;
  processingFee: number;
  buyerTotal: number;
  sellerPayout: number;
  passFeeToBuyer: boolean;
  shippingMethod: string | null;
}

export interface DispatchDetails {
  listingTitle: string;
  transactionId: string;
  buyerEmail: string;
  buyerName: string;
  trackingReference: string | null;
  shippingMethod: string | null;
}

export interface ListingDecisionDetails {
  listingTitle: string;
  listingId: string;
  sellerEmail: string;
  sellerName: string;
  reason?: string | null;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly resend: Resend | null;
  private readonly appUrl: string;

  constructor() {
    const key = process.env.RESEND_API_KEY;
    this.resend = key ? new Resend(key) : null;
    this.appUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    if (!key) this.logger.warn('RESEND_API_KEY not set — emails disabled');
  }

  // ---------------------------------------------------------------
  // Buyer: order confirmed (payment HELD)
  // ---------------------------------------------------------------
  async orderConfirmedBuyer(d: SaleDetails) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    const html = layout(
      h1('Order confirmed') +
      p(`Hi ${strong(d.buyerName)}, your purchase of ${strong(d.listingTitle)} has been confirmed. The seller has been notified and will dispatch your item soon.`) +
      divider() +
      `<table width="100%" cellpadding="0" cellspacing="0">
        ${amountRow('Listing price', formatRand(d.listingPrice))}
        ${!d.passFeeToBuyer ? '' : amountRow('Processing fee', formatRand(d.processingFee))}
        ${amountRow('Total paid', formatRand(d.buyerTotal))}
      </table>` +
      divider() +
      p(`Shipping method: ${strong(d.shippingMethod?.replace(/_/g, ' ') ?? 'TBD')}`) +
      button('View order', txUrl),
    );
    await this.send(d.buyerEmail, 'Order confirmed — ' + d.listingTitle, html);
  }

  // ---------------------------------------------------------------
  // Seller: new sale received (payment HELD)
  // ---------------------------------------------------------------
  async newSaleSeller(d: SaleDetails) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    const html = layout(
      h1('You have a new sale!') +
      p(`Hi ${strong(d.sellerName)}, someone has bought your listing ${strong(d.listingTitle)}. Payment is held in escrow — pack and dispatch as soon as possible.`) +
      divider() +
      `<table width="100%" cellpadding="0" cellspacing="0">
        ${amountRow('Sale price', formatRand(d.listingPrice))}
        ${amountRow('Commission', '-' + formatRand(d.commissionZar))}
        ${amountRow('Your payout', formatRand(d.sellerPayout))}
      </table>` +
      divider() +
      p(`Shipping method: ${strong(d.shippingMethod?.replace(/_/g, ' ') ?? 'TBD')}`) +
      p('Once the buyer confirms delivery, payment will be released to you automatically.') +
      button('View sale', txUrl),
    );
    await this.send(d.sellerEmail, 'New sale: ' + d.listingTitle, html);
  }

  // ---------------------------------------------------------------
  // Buyer: item dispatched
  // ---------------------------------------------------------------
  async itemDispatched(d: DispatchDetails) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    const html = layout(
      h1('Your item is on its way') +
      p(`Hi ${strong(d.buyerName)}, your purchase of ${strong(d.listingTitle)} has been dispatched by the seller.`) +
      (d.trackingReference
        ? p(`Tracking reference: ${strong(d.trackingReference)}`)
        : '') +
      p(`Shipping method: ${strong(d.shippingMethod?.replace(/_/g, ' ') ?? 'TBD')}`) +
      divider() +
      p('Once you receive your item, please confirm delivery so that payment can be released to the seller.') +
      button('View order & confirm delivery', txUrl),
    );
    await this.send(d.buyerEmail, 'Dispatched: ' + d.listingTitle, html);
  }

  // ---------------------------------------------------------------
  // Seller: payment released
  // ---------------------------------------------------------------
  async paymentReleasedSeller(d: { sellerEmail: string; sellerName: string; listingTitle: string; sellerPayout: number; transactionId: string }) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    const html = layout(
      h1('Your payout is on the way') +
      p(`Hi ${strong(d.sellerName)}, the buyer has confirmed delivery of ${strong(d.listingTitle)}. Your payout of ${strong(formatRand(d.sellerPayout))} will be processed within 2–3 business days.`) +
      divider() +
      button('View sale', txUrl),
    );
    await this.send(d.sellerEmail, 'Payout confirmed — ' + d.listingTitle, html);
  }

  // ---------------------------------------------------------------
  // Buyer: refund issued
  // ---------------------------------------------------------------
  async refundIssuedBuyer(d: { buyerEmail: string; buyerName: string; listingTitle: string; buyerTotal: number; transactionId: string; note?: string | null }) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    const html = layout(
      h1('Your refund has been issued') +
      p(`Hi ${strong(d.buyerName)}, a refund of ${strong(formatRand(d.buyerTotal))} for ${strong(d.listingTitle)} has been issued. Please allow 5–10 business days for it to appear on your statement.`) +
      (d.note ? divider() + p(`Note from admin: ${strong(d.note)}`) : '') +
      divider() +
      button('View order', txUrl),
    );
    await this.send(d.buyerEmail, 'Refund issued — ' + d.listingTitle, html);
  }

  // ---------------------------------------------------------------
  // Seller: listing approved
  // ---------------------------------------------------------------
  async listingApproved(d: ListingDecisionDetails) {
    const listingUrl = `${this.appUrl}/listings/${d.listingId}`;
    const html = layout(
      h1('Listing approved') +
      p(`Hi ${strong(d.sellerName)}, your listing ${strong(d.listingTitle)} has been reviewed and approved. It is now live on the marketplace.`) +
      divider() +
      button('View listing', listingUrl),
    );
    await this.send(d.sellerEmail, 'Listing approved: ' + d.listingTitle, html);
  }

  // ---------------------------------------------------------------
  // Seller: listing rejected
  // ---------------------------------------------------------------
  async listingRejected(d: ListingDecisionDetails) {
    const html = layout(
      h1('Listing not approved') +
      p(`Hi ${strong(d.sellerName)}, your listing ${strong(d.listingTitle)} was not approved for the following reason:`) +
      (d.reason
        ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:${TEXT};background:#2a2a2a;padding:12px;border-radius:6px;border-left:3px solid ${BRAND_RED};">${d.reason}</p>`
        : p('No reason provided.')) +
      divider() +
      p('You may edit your listing and resubmit for review, or contact support if you believe this is an error.') +
      button('My listings', `${this.appUrl}/my/listings`),
    );
    await this.send(d.sellerEmail, 'Listing not approved: ' + d.listingTitle, html);
  }

  // ---------------------------------------------------------------
  // Internal send — always fails open
  // ---------------------------------------------------------------
  private async send(to: string, subject: string, html: string) {
    if (!this.resend) return;
    try {
      await this.resend.emails.send({ from: FROM, to, subject, html });
      this.logger.debug(`Email sent → ${to} "${subject}"`);
    } catch (err) {
      this.logger.error(`Email failed → ${to} "${subject}": ${(err as Error).message}`);
    }
  }
}
