import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { NotificationCategory } from '@prisma/client';
import { SmsService } from '../sms/sms.service';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';

// Compile-time list of the entity types we can link a Notification
// row to. Used by resolveByEntity() callers so typos don't sit silently
// in the codebase. Keep in sync with the linkedType column the migration
// produces.
export type NotificationLinkedType =
  | 'offer'
  | 'transaction'
  | 'bid'
  | 'listing'
  | 'raffle';

interface PersistOpts {
  userId: string;
  category: NotificationCategory;
  type: string;
  title: string;
  body: string;
  url?: string;
  iconKey?: string;
  linkedType?: NotificationLinkedType;
  linkedId?: string;
  /**
   * True = user can swipe-dismiss the row from the inbox.
   * False = row can ONLY be cleared by acting on the linked entity
   *         (server-side resolveByEntity stamp). Action-required
   *         notifications must set this to false.
   * Defaults to false (safer).
   */
  dismissible?: boolean;
}

// Fails open — emails are fire-and-forget; never block the main flow.

const FROM = 'Gun Galore <noreply@gungalore.co.za>';

// ─── Brand tokens (matched to the site theme) ─────────────────────────
const TOKEN = {
  bgPage: '#0f0f0f',
  bgCard: '#1a1a1a',
  bgInset: '#262626',
  border: '#2a2a2a',
  textPrimary: '#f5f5f5',
  textSecondary: '#b8b8b8',
  textTertiary: '#888888',
  red: '#C8102E',
  successText: '#2f9e6b',
  successBg: 'rgba(47,158,107,0.12)',
  pendingText: '#f59e0b',
  pendingBg: 'rgba(245,158,11,0.12)',
  errorText: '#ef4444',
  errorBg: 'rgba(239,68,68,0.12)',
};

// ─── Master email template ────────────────────────────────────────────
//
// EVERY transactional email goes through this one helper. The old
// approach (60+ per-event template files on disk + a Handlebars-ish
// renderer + inline `layout()` fallbacks) drifted out of sync, had
// double-R bugs, stuck `[n]` placeholders, broke when Nest CLI didn't
// copy .html assets, and rendered as a white card on iOS Mail because
// dark-theme HTML email is fragile.
//
// This replaces all of that with one HTML structure in code. Site
// theme tokens (TOKEN above) are pasted inline. Dark-mode lockdown
// uses every known technique stacked: color-scheme meta, !important
// on every colour, prefers-color-scheme:light overridden to dark,
// [data-ogsc] Outlook hooks, and the Gmail-specific u + body marker.
//
// One source of truth. One place to fix.

interface EmailRow {
  label: string;
  value: string;
}

interface EmailCta {
  label: string;
  url: string;
}

interface EmailContent {
  /** Short headline, big sans-serif. No HTML. */
  headline: string;
  /** Body — `<strong>` and inline links are OK; no block elements. */
  body: string;
  /** Optional pill above the headline. */
  status?: { tone: 'success' | 'pending' | 'error'; label: string };
  /** Optional labelled rows shown below the body (Reference, Amount, etc). */
  rows?: EmailRow[];
  /** Single primary action button. Optional — info-only emails skip it. */
  cta?: EmailCta;
  /** Quiet line below the CTA (e.g. "Or reply to this email"). */
  footnote?: string;
  /** Preheader shown in the inbox preview; never rendered visible. */
  preheader?: string;
}

function renderEmail(c: EmailContent, logoUrl: string): string {
  const statusBlock = c.status ? statusPill(c.status.tone, c.status.label) : '';
  const rowsBlock = c.rows && c.rows.length > 0 ? rowsTable(c.rows) : '';
  const ctaBlock = c.cta ? ctaButton(c.cta) : '';
  const footnoteBlock = c.footnote
    ? `<p style="margin:18px 0 0;font-size:12px;color:${TOKEN.textTertiary} !important;line-height:1.5;">${c.footnote}</p>`
    : '';
  const preheader = c.preheader
    ? `<div style="display:none !important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;max-height:0;max-width:0;overflow:hidden;mso-hide:all;">${c.preheader}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="dark only">
  <meta name="supported-color-schemes" content="dark only">
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <title>Gun Galore</title>
  <style type="text/css">
    /* Aggressive dark-mode lockdown. Even with all of this, Gmail
       may strip the style block on some configs — inline styles
       carry !important too, which is the actual safety net. */
    :root {
      color-scheme: dark only !important;
      supported-color-schemes: dark only !important;
    }
    body, table, td, div, p, a, span { -webkit-font-smoothing: antialiased; }
    body {
      background-color: ${TOKEN.bgPage} !important;
      color: ${TOKEN.textPrimary} !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    @media (prefers-color-scheme: dark) {
      body { background-color: ${TOKEN.bgPage} !important; color: ${TOKEN.textPrimary} !important; }
      .gg-card { background-color: ${TOKEN.bgCard} !important; }
    }
    /* Force dark even when client picked light — iOS Mail respects
       this when color-scheme=dark is also declared. */
    @media (prefers-color-scheme: light) {
      body { background-color: ${TOKEN.bgPage} !important; color: ${TOKEN.textPrimary} !important; }
      .gg-card { background-color: ${TOKEN.bgCard} !important; }
    }
    /* Outlook.com webmail / Outlook for Mac */
    [data-ogsc] body { background-color: ${TOKEN.bgPage} !important; color: ${TOKEN.textPrimary} !important; }
    [data-ogsc] .gg-card { background-color: ${TOKEN.bgCard} !important; }
    [data-ogsb] body { background-color: ${TOKEN.bgPage} !important; }
    [data-ogsb] .gg-card { background-color: ${TOKEN.bgCard} !important; }
    /* Gmail dark-mode hook */
    u + .gg-body, .gg-body {
      background-color: ${TOKEN.bgPage} !important;
      color: ${TOKEN.textPrimary} !important;
    }
  </style>
</head>
<body class="gg-body" style="margin:0 !important;padding:0 !important;background-color:${TOKEN.bgPage} !important;color:${TOKEN.textPrimary} !important;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,'Helvetica Neue',Arial,sans-serif;">
  ${preheader}
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:${TOKEN.bgPage} !important;border-collapse:collapse;">
    <tr><td align="center" style="padding:0;">
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;border-collapse:collapse;">

        <!-- Logo header. Image + MSO-only text fallback. Alt text
             shows when the recipient's client blocks remote images. -->
        <tr>
          <td align="center" style="background-color:${TOKEN.bgPage} !important;padding:28px 32px;border-bottom:1px solid ${TOKEN.border};">
            <!--[if mso]>
            <span style="font-family:Arial,sans-serif;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:0.12em;">GUN GALORE</span>
            <![endif]-->
            <!--[if !mso]><!-->
            <img src="${logoUrl}" alt="Gun Galore" width="180" height="36"
                 style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;height:36px;width:180px;" />
            <!--<![endif]-->
          </td>
        </tr>

        <tr><td style="height:24px;background-color:${TOKEN.bgPage} !important;font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- Content card -->
        <tr>
          <td style="padding:0 24px;">
            <table role="presentation" class="gg-card" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:${TOKEN.bgCard} !important;border:1px solid ${TOKEN.border};border-radius:8px;border-collapse:separate;">
              <tr><td style="padding:32px;">
                ${statusBlock}
                <h1 style="margin:0 0 16px;font-size:22px;font-weight:500;color:${TOKEN.textPrimary} !important;letter-spacing:-0.01em;line-height:1.3;">${escapeHtml(c.headline)}</h1>
                <div style="font-size:15px;color:${TOKEN.textPrimary} !important;line-height:1.6;">${c.body}</div>
                ${rowsBlock}
                ${ctaBlock}
                ${footnoteBlock}
              </td></tr>
            </table>
          </td>
        </tr>

        <tr><td style="height:24px;background-color:${TOKEN.bgPage} !important;font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- Footer -->
        <tr>
          <td style="padding:0 24px 40px;background-color:${TOKEN.bgPage} !important;">
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border-top:1px solid ${TOKEN.border};">
              <tr><td style="height:24px;font-size:0;line-height:0;">&nbsp;</td></tr>
              <tr><td align="center"><p style="margin:0;font-size:12px;color:${TOKEN.textTertiary} !important;line-height:1.5;">Gun Galore (Pty) Ltd &middot; South Africa</p></td></tr>
              <tr><td align="center" style="padding-top:6px;"><a href="mailto:support@gungalore.co.za" style="font-size:12px;color:${TOKEN.red} !important;text-decoration:none;">support@gungalore.co.za</a></td></tr>
              <tr><td align="center" style="padding-top:10px;"><p style="margin:0;font-size:11px;color:${TOKEN.textTertiary} !important;line-height:1.6;">Transactional email related to your Gun Galore account.</p></td></tr>
              <tr><td align="center" style="padding-top:4px;"><p style="margin:0;font-size:11px;color:${TOKEN.textTertiary} !important;line-height:1.6;">&copy; ${new Date().getFullYear()} Gun Galore. All rights reserved.</p></td></tr>
            </table>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function statusPill(
  tone: 'success' | 'pending' | 'error',
  label: string,
): string {
  const [text, bg] =
    tone === 'success'
      ? [TOKEN.successText, TOKEN.successBg]
      : tone === 'pending'
        ? [TOKEN.pendingText, TOKEN.pendingBg]
        : [TOKEN.errorText, TOKEN.errorBg];
  const icon =
    tone === 'success'
      ? '&#10003;'
      : tone === 'pending'
        ? '&#9203;'
        : '&#10005;';
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 20px 0;">
    <tr><td style="background-color:${bg} !important;border:1px solid ${text};border-radius:20px;padding:5px 14px;">
      <span style="font-size:12px;color:${text} !important;font-weight:500;letter-spacing:0.02em;">${icon}&nbsp; ${escapeHtml(label)}</span>
    </td></tr>
  </table>`;
}

function rowsTable(rows: EmailRow[]): string {
  const trs = rows
    .map(
      (r) => `<tr>
        <td style="padding:8px 0;width:170px;vertical-align:top;">
          <span style="font-size:11px;color:${TOKEN.textTertiary} !important;text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(r.label)}</span>
        </td>
        <td style="padding:8px 0;vertical-align:top;">
          <span style="font-size:14px;color:${TOKEN.textPrimary} !important;font-weight:500;">${escapeHtml(r.value)}</span>
        </td>
      </tr>`,
    )
    .join('');
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin-top:24px;padding-top:16px;border-top:1px solid ${TOKEN.border};">
    ${trs}
  </table>`;
}

function ctaButton(cta: EmailCta): string {
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:28px 0 0 0;">
    <tr><td style="background-color:${TOKEN.red} !important;border-radius:6px;">
      <a href="${cta.url}" target="_blank" style="display:inline-block;color:#ffffff !important;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,Arial,sans-serif;font-size:15px;font-weight:500;text-decoration:none;padding:14px 32px;border-radius:6px;min-width:220px;text-align:center;letter-spacing:-0.01em;">${escapeHtml(cta.label)}</a>
    </td></tr>
  </table>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Inline-emphasis helper kept simple — call sites pass user-supplied
// strings, and the body field is rendered as raw HTML so we can
// inject `<strong>` highlights for prices and item titles. We do
// NOT escape inside `body` — callers must escape user input before
// wrapping in `<strong>` (use `escapeHtml()` for that).
function b(text: string): string {
  return `<strong style="color:${TOKEN.textPrimary} !important;font-weight:600;">${escapeHtml(text)}</strong>`;
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
  buyerPhone?: string | null;
  sellerEmail: string;
  sellerName: string;
  sellerPhone?: string | null;
  listingPrice: number;
  commissionZar: number;
  processingFee: number;
  buyerTotal: number;
  sellerPayout: number;
  passFeeToBuyer: boolean;
  shippingMethod: string | null;
  /**
   * Optional TRANSACTION_ACCEPT token URL (`/a/<token>`). When set, the
   * seller's new-sale SMS + email CTA both deep-link to the one-tap
   * Accept page so the seller can accept the sale within 48h WITHOUT
   * needing to sign in. Generated by TransactionsService.sendSaleNotifications
   * from an ActionToken mint. Falls back to the existing dashboard URL
   * for backwards-compat with any caller that doesn't pass it.
   */
  acceptActionUrl?: string;
}

export interface DispatchDetails {
  listingTitle: string;
  transactionId: string;
  buyerEmail: string;
  buyerName: string;
  buyerPhone?: string | null;
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

  constructor(
    private readonly sms: SmsService,
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {
    const key = process.env.RESEND_API_KEY;
    this.resend = key ? new Resend(key) : null;
    this.appUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    if (!key) this.logger.warn('RESEND_API_KEY not set — emails disabled');
  }

  // ─── In-app inbox: persist + resolve ──────────────────────────────
  //
  // Every transactional event method below calls `persist()` in addition
  // to its existing email/SMS dispatch — that's what populates the
  // bell badge + the /notifications inbox.
  //
  // Action handlers across the codebase (OffersService.acceptOffer,
  // TransactionsService.markDispatched, etc.) call `resolveByEntity()`
  // to clear the relevant notifications when the user actually takes
  // action. Opening the inbox does NOT resolve anything — that was
  // the explicit user-spec'd behaviour.
  //
  // Both methods fail open: errors are logged but don't throw, so a
  // DB blip never blocks the email/SMS dispatch the user is waiting on.

  /**
   * Convenience wrapper — most existing transactional methods take an
   * email rather than a userId (their primary purpose was firing
   * email/SMS). This looks up the user by email and persists. No-op
   * (with a debug log) when no user matches — emails sent to addresses
   * that aren't in our User table won't get an inbox row, which is
   * the right behaviour (anonymous recipient = no inbox).
   */
  async persistByEmail(
    email: string,
    opts: Omit<PersistOpts, 'userId'>,
  ): Promise<void> {
    try {
      const u = await this.prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (!u) {
        this.logger.debug(`persistByEmail: no user for ${email} (${opts.type})`);
        return;
      }
      await this.persist({ ...opts, userId: u.id });
    } catch (err) {
      this.logger.error(
        `persistByEmail(${opts.type}) failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async persist(opts: PersistOpts): Promise<void> {
    try {
      await this.prisma.notification.create({
        data: {
          userId: opts.userId,
          category: opts.category,
          type: opts.type,
          title: opts.title,
          body: opts.body,
          url: opts.url ?? null,
          iconKey: opts.iconKey ?? null,
          linkedType: opts.linkedType ?? null,
          linkedId: opts.linkedId ?? null,
          dismissible: opts.dismissible ?? false,
        },
      });
    } catch (err) {
      // Don't let an in-app inbox failure break the email/SMS flow.
      this.logger.error(
        `persist(${opts.type}) for user ${opts.userId} failed: ${err instanceof Error ? err.message : err}`,
      );
    }

    // Push notification fanout — fire ONLY for action-required events
    // (the inbox rows where dismissible === false). Dismissible rows
    // (counter accepted, refund issued, raffle entry confirmed) are
    // informational; pushing those would feel spammy. Email and the
    // in-app inbox still cover them.
    //
    // Fire-and-forget: a push failure (VAPID not configured, dead
    // subscription, etc.) must NOT block whatever upstream caller is
    // waiting on persist(). PushService.sendToUser handles its own
    // errors internally — we just don't await the result on the
    // critical path.
    if (!opts.dismissible) {
      void this.push
        .sendToUser(opts.userId, opts.category, {
          title: opts.title,
          body: opts.body,
          url: opts.url,
          // Tag: use the linked entity so a second push for the same
          // entity replaces the first instead of stacking. Falls back
          // to type for events without a linked entity (e.g. broadcasts).
          tag: opts.linkedType && opts.linkedId
            ? `${opts.linkedType}:${opts.linkedId}`
            : opts.type,
        })
        .catch((err) => {
          this.logger.debug(
            `push for ${opts.type}/${opts.userId} failed silently: ${err instanceof Error ? err.message : err}`,
          );
        });
    }
  }

  /**
   * Stamp `resolvedAt` on every unresolved notification linked to the
   * given entity. Called from action handlers (offer accept/reject,
   * transaction dispatch, bid placed) when the user takes the action
   * that an action-required notification was waiting for.
   *
   * Pass `userId` to scope to one user's rows (e.g. only the previous
   * top-bidder's outbid notification on this auction). Omit it to
   * resolve across all recipients (e.g. an auction closes — every
   * losing bidder's outbid notification on that auction is now stale).
   */
  async resolveByEntity(
    linkedType: NotificationLinkedType,
    linkedId: string,
    opts: { userId?: string; resolvedBy?: 'user_action' | 'auto_expired' } = {},
  ): Promise<number> {
    try {
      const r = await this.prisma.notification.updateMany({
        where: {
          linkedType,
          linkedId,
          resolvedAt: null,
          ...(opts.userId ? { userId: opts.userId } : {}),
        },
        data: {
          resolvedAt: new Date(),
          resolvedBy: opts.resolvedBy ?? 'user_action',
        },
      });
      return r.count;
    } catch (err) {
      this.logger.error(
        `resolveByEntity(${linkedType}:${linkedId}) failed: ${err instanceof Error ? err.message : err}`,
      );
      return 0;
    }
  }

  // Wrap the pure renderEmail() helper with the logo URL injection so
  // every method call site is a clean `this.email({...})` rather than
  // having to remember to pass logoUrl. Defaults to the PUBLIC prod
  // URL because dev recipients (iOS Mail on a phone, Gmail in a
  // browser) can't reach localhost:3000. Override via EMAIL_LOGO_URL
  // when you want to point at a Cloudinary copy.
  private email(content: EmailContent): string {
    const logoUrl =
      process.env.EMAIL_LOGO_URL ?? 'https://gungalore.co.za/email-logo.png';
    return renderEmail(content, logoUrl);
  }

  // ---------------------------------------------------------------
  // Buyer: order confirmed (payment HELD)
  // ---------------------------------------------------------------
  async orderConfirmedBuyer(d: SaleDetails) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    const rows: { label: string; value: string }[] = [
      { label: 'Reference', value: d.transactionId.slice(-8).toUpperCase() },
      { label: 'Listing price', value: formatRand(d.listingPrice) },
    ];
    if (d.passFeeToBuyer) {
      rows.push({
        label: 'Processing fee',
        value: formatRand(d.processingFee),
      });
    }
    rows.push({ label: 'Total paid', value: formatRand(d.buyerTotal) });
    rows.push({
      label: 'Shipping method',
      value: prettyShippingMethod(d.shippingMethod),
    });
    const html = this.email({
      status: { tone: 'success', label: 'Order confirmed' },
      headline: 'Order confirmed',
      body: `Hi ${b(d.buyerName)}, your purchase of ${b(d.listingTitle)} has been confirmed. The seller has been notified and will dispatch your item soon.`,
      rows,
      cta: { label: 'View order', url: txUrl },
      preheader: `Order confirmed — ${d.listingTitle}`,
    });
    await this.send(d.buyerEmail, 'Order confirmed — ' + d.listingTitle, html);
    await this.sendSms(
      d.buyerPhone,
      `Gun Galore: Order confirmed for ${truncate(d.listingTitle, 40)}. Total paid ${formatRand(d.buyerTotal)}. We'll SMS again when it's dispatched.`,
      `order-confirmed-${d.transactionId}`,
    );
  }

  // ---------------------------------------------------------------
  // Seller: new sale received (payment HELD)
  // ---------------------------------------------------------------
  async newSaleSeller(d: SaleDetails) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    // When TransactionsService minted a TRANSACTION_ACCEPT token we
    // prefer the /a/<token> link in BOTH email CTA + SMS — that lets
    // the seller hit Accept with one tap, no Clerk sign-in required.
    // Fall back to the regular txUrl when absent (backward-compat with
    // any caller that hasn't been updated to mint a token yet, e.g. an
    // older code path or a manual admin-fire).
    const acceptUrl = d.acceptActionUrl ?? txUrl;
    const hasAcceptToken = Boolean(d.acceptActionUrl);
    // In-app inbox: action-required. With the new state machine the
    // seller's FIRST job is to ACCEPT (48h SLA); dispatch (5d SLA) only
    // starts after Accept. The inbox row deep-links to the same accept
    // URL so a tap from /notifications lands on the Accept page.
    // Cleared when TransactionsService.acceptTransaction OR
    // .markDispatched fires resolveByEntity('transaction', txId).
    await this.persistByEmail(d.sellerEmail, {
      category: 'SELLER',
      type: 'new_sale',
      title: 'Your listing sold',
      body: hasAcceptToken
        ? `${d.listingTitle} sold for ${formatRand(d.listingPrice)} — accept within 48h`
        : `${d.listingTitle} sold for ${formatRand(d.listingPrice)} — dispatch within 48h`,
      // When we have a token URL, point the inbox row at it directly so
      // tapping the row → /a/<token> → Accept page works without sign-in.
      // Otherwise fall back to the transaction page.
      url: d.acceptActionUrl ?? `/transactions/${d.transactionId}`,
      iconKey: 'sold',
      linkedType: 'transaction',
      linkedId: d.transactionId,
      dismissible: false,
    });
    // Firearm DEALER_TRANSFER triggers the SAPS 534 + stock register
    // + firearm-serial photo flow — we tell the seller about it up
    // front so they can prepare and the dealer can fill the form in
    // block letters at the counter (most-common cause of delay).
    const isDealerTransfer = d.shippingMethod === 'DEALER_TRANSFER';
    // The accept-first framing is added to the lede when we have a
    // token. The dealer-transfer SAPS-534 paragraph still appears
    // below so the seller can prepare while the firearm is still in
    // their safe (the accept step doesn't gate it — they can ready
    // the paperwork in parallel).
    const acceptLede = hasAcceptToken
      ? `<p style="margin: 0 0 14px;"><b>First — confirm you can fulfil this sale within 48 hours.</b> Tap the Accept button below to lock the sale in. After accepting you have 5 days to dispatch.</p>`
      : '';
    const bodyText = isDealerTransfer
      ? `${acceptLede}Hi ${b(d.sellerName)}, someone has bought your listing ${b(d.listingTitle)}. Payment is being held safely by Gun Galore. Once you transfer the firearm to the chosen dealer, you'll need to upload 3 photos so we can verify the stock-in before releasing your payout:
<ol style="margin: 12px 0; padding-left: 22px; line-height: 1.7;">
  <li>The completed <b>SAPS 534</b> form (<b>BLOCK LETTERS ONLY</b> — our verification bot can't read cursive)</li>
  <li>The <b>last line</b> of the dealer's stock register (only your entry — no other customers' details)</li>
  <li>The <b>firearm with its serial number visible</b>, next to a slip of paper showing the order reference</li>
</ol>
<p style="margin: 8px 0; font-size: 13px; color: #666;">Ask the dealer to print in BLOCK LETTERS — that lets our automated check pass instantly. Cursive or unclear writing means a 48-hour human review before payout.</p>`
      : `${acceptLede}Hi ${b(d.sellerName)}, someone has bought your listing ${b(d.listingTitle)}. Payment is being held safely by Gun Galore — pack and dispatch as soon as possible. Once the buyer confirms delivery, payment will be released to you automatically.`;

    const html = this.email({
      status: { tone: 'success', label: 'New sale' },
      headline: hasAcceptToken ? 'New sale — accept within 48h' : 'You have a new sale',
      body: bodyText,
      rows: [
        { label: 'Reference', value: d.transactionId.slice(-8).toUpperCase() },
        { label: 'Sale price', value: formatRand(d.listingPrice) },
        { label: 'Commission', value: '-' + formatRand(d.commissionZar) },
        { label: 'Your payout', value: formatRand(d.sellerPayout) },
        {
          label: 'Shipping method',
          value: prettyShippingMethod(d.shippingMethod),
        },
      ],
      cta: hasAcceptToken
        ? { label: 'Accept this sale', url: acceptUrl }
        : { label: 'View sale', url: txUrl },
      footnote: hasAcceptToken
        ? 'One-tap accept — no sign-in needed. Link expires in 48 hours.'
        : undefined,
      preheader: `New sale — ${d.listingTitle}`,
    });
    await this.send(d.sellerEmail, 'New sale: ' + d.listingTitle, html);
    // SMS — when we have a token URL we replace the body with the
    // accept-first copy AND include the /a/<token> URL so the seller
    // can act with one tap. Character budget tight: title truncated
    // hard so the URL fits in a single 160-char segment. When we have
    // no token, fall back to the legacy "see email" copy.
    const smsBody = hasAcceptToken
      ? isDealerTransfer
        ? `Gun Galore: New sale ${truncate(d.listingTitle, 24)} - R${(d.sellerPayout / 100).toFixed(0)}. Accept within 48h (then 5d to dispatch): ${acceptUrl}`
        : `Gun Galore: New sale ${truncate(d.listingTitle, 28)} - R${(d.sellerPayout / 100).toFixed(0)}. Accept within 48h: ${acceptUrl}`
      : isDealerTransfer
        ? `Gun Galore: New sale ${truncate(d.listingTitle, 30)} - R${(d.sellerPayout / 100).toFixed(0)}. After dealer transfer, upload 3 photos (SAPS 534 BLOCK LETTERS) to release payout. See email.`
        : `Gun Galore: New sale! ${truncate(d.listingTitle, 40)} - R${(d.sellerPayout / 100).toFixed(0)} payout pending dispatch. Check email for details.`;
    await this.sendSms(
      d.sellerPhone,
      smsBody,
      `new-sale-${d.transactionId}`,
    );
  }

  // ---------------------------------------------------------------
  // Seller: dealer-verification approved (payout will release)
  // ---------------------------------------------------------------
  async dealerVerificationApproved(d: {
    sellerEmail: string;
    sellerName: string;
    sellerPhone: string | null;
    listingTitle: string;
    transactionId: string;
    sellerPayout: number;
  }) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    const html = this.email({
      status: { tone: 'success', label: 'Verified' },
      headline: 'Dealer stock-in verified',
      body: `Hi ${b(d.sellerName)}, our verification check passed for the dealer stock-in on ${b(d.listingTitle)}. Your payout of ${b(formatRand(d.sellerPayout))} is now being released to your verified bank account — allow 2–3 business days to reflect. We've sent the buyer the dealer's contact details so they can arrange their inter-dealer transfer with you directly.`,
      rows: [
        { label: 'Reference', value: d.transactionId.slice(-8).toUpperCase() },
        { label: 'Your payout', value: formatRand(d.sellerPayout) },
      ],
      cta: { label: 'View transaction', url: txUrl },
      preheader: 'Dealer verification approved — payout released',
    });
    await this.send(
      d.sellerEmail,
      'Dealer verification approved: ' + d.listingTitle,
      html,
    );
    await this.sendSms(
      d.sellerPhone,
      `Gun Galore: Dealer stock-in approved for ${truncate(d.listingTitle, 30)}. Payout R${(d.sellerPayout / 100).toFixed(0)} on the way (2-3 days).`,
      `dv-approved-${d.transactionId}`,
    );
  }

  // ---------------------------------------------------------------
  // Buyer: firearm stocked at dealer — Gun Galore's job is done.
  // Sent the moment dealer verification approves. Includes the
  // dealer's name + address + phone so the buyer knows where their
  // firearm is and can arrange the inter-dealer transfer (or
  // collection) directly with the seller.
  // ---------------------------------------------------------------
  async firearmStockedAtDealerBuyer(d: {
    buyerEmail: string;
    buyerName: string;
    buyerPhone: string | null;
    listingTitle: string;
    transactionId: string;
    dealerName: string;
    dealerAddress: string;
    dealerPhone: string;
    sellerName: string;
  }) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    const html = this.email({
      status: { tone: 'success', label: 'Dealer-stocked' },
      headline: 'Your firearm has been booked into stock',
      body: `Hi ${b(d.buyerName)}, the seller (${b(d.sellerName)}) has dropped ${b(d.listingTitle)} with their SAPS-licensed dealer and we've verified the SAPS 534 + stock-register paperwork. The firearm is now legally in the dealer's stock register at the address below. We've released the funds to the seller — Gun Galore's part of this transaction is done. From here, please liaise with the seller directly to arrange the inter-dealer transfer to your own dealer (or your preferred collection method).`,
      rows: [
        { label: 'Reference', value: d.transactionId.slice(-8).toUpperCase() },
        { label: 'Dealer name', value: d.dealerName },
        { label: 'Dealer address', value: d.dealerAddress },
        { label: 'Dealer phone', value: d.dealerPhone },
      ],
      cta: { label: 'View transaction', url: txUrl },
      preheader: `Your firearm is at ${truncate(d.dealerName, 60)}`,
    });
    await this.send(
      d.buyerEmail,
      'Firearm stocked at dealer: ' + d.listingTitle,
      html,
    );
    await this.sendSms(
      d.buyerPhone,
      `Gun Galore: Your ${truncate(d.listingTitle, 25)} is booked into stock at ${truncate(d.dealerName, 30)} (${d.dealerPhone}). Contact the seller to arrange your transfer.`,
      `stocked-${d.transactionId}`,
    );
  }

  // ---------------------------------------------------------------
  // Seller: dealer-verification rejected — must reshoot
  // ---------------------------------------------------------------
  async dealerVerificationRejected(d: {
    sellerEmail: string;
    sellerName: string;
    sellerPhone: string | null;
    listingTitle: string;
    transactionId: string;
    reason?: string;
  }) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}/dealer-verification`;
    // In-app inbox: action-required — seller must reshoot photos.
    // Cleared when DealerVerificationService transitions the verification
    // to APPROVED → resolveByEntity('transaction', txId).
    await this.persistByEmail(d.sellerEmail, {
      category: 'SELLER',
      type: 'dealer_verification_rejected',
      title: 'Dealer photos need reshoot',
      body: `${d.listingTitle}${d.reason ? ` — ${d.reason}` : ''}`,
      url: `/transactions/${d.transactionId}/dealer-verification`,
      iconKey: 'dispatch',
      linkedType: 'transaction',
      linkedId: d.transactionId,
      dismissible: false,
    });
    const reasonLine = d.reason
      ? `<p style="margin: 8px 0;"><b>Admin note:</b> ${d.reason}</p>`
      : '';
    const html = this.email({
      status: { tone: 'pending', label: 'Reshoot needed' },
      headline: 'Dealer verification — please reshoot',
      body: `Hi ${b(d.sellerName)}, our verification check couldn't approve the photos for ${b(d.listingTitle)}. Please retake the photos and upload again. ${reasonLine}<p style="margin-top: 10px;"><b>Most common cause:</b> the SAPS 534 form was not filled in BLOCK LETTERS. Ask the dealer to redo the form in capital letters — our automated check cannot reliably read cursive or mixed-case handwriting and that means up to 48 hours of human review before your payout.</p>`,
      cta: { label: 'Upload photos again', url: txUrl },
      preheader: 'Reshoot dealer photos',
    });
    await this.send(
      d.sellerEmail,
      'Dealer verification needs reshoot: ' + d.listingTitle,
      html,
    );
    await this.sendSms(
      d.sellerPhone,
      `Gun Galore: Dealer photos rejected for ${truncate(d.listingTitle, 28)}. Most common cause: SAPS 534 not in BLOCK LETTERS. Reshoot needed.`,
      `dv-rejected-${d.transactionId}`,
    );
  }

  // ---------------------------------------------------------------
  // Buyer: item dispatched
  // ---------------------------------------------------------------
  async itemDispatched(d: DispatchDetails) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    // In-app inbox: BUYER gets the "your order is on the way" alert.
    // Action-required (must confirm delivery to release payout) —
    // cleared when TransactionsService.confirmDelivery fires
    // resolveByEntity('transaction', txId, buyerUserId).
    await this.persistByEmail(d.buyerEmail, {
      category: 'BUYER',
      type: 'order_dispatched',
      title: 'Your order is on the way',
      body: `${d.listingTitle} — ${prettyCourier(d.shippingMethod)} ${d.trackingReference ?? ''}`.trim(),
      url: `/transactions/${d.transactionId}`,
      iconKey: 'dispatch',
      linkedType: 'transaction',
      linkedId: d.transactionId,
      dismissible: false,
    });
    const rows: { label: string; value: string }[] = [
      { label: 'Courier', value: prettyCourier(d.shippingMethod) },
    ];
    if (d.trackingReference) {
      rows.push({ label: 'Tracking', value: d.trackingReference });
    }
    const html = this.email({
      status: { tone: 'success', label: 'Dispatched' },
      headline: 'Your order is on its way',
      body: `Hi ${b(d.buyerName)}, your purchase of ${b(d.listingTitle)} has been dispatched by the seller. Follow the parcel's progress on your order page — carrier scans land on the live tracking timeline as they happen. Once you receive your item, please confirm delivery so payment can be released to the seller.`,
      rows,
      cta: { label: 'Track & confirm delivery', url: txUrl },
      preheader: `Dispatched — ${d.listingTitle}`,
    });
    await this.send(d.buyerEmail, 'Dispatched: ' + d.listingTitle, html);
    // SMS body deep-links to the transaction page where the tracking
    // timeline lives. The title is truncated hard so the URL fits in
    // a single 160-char segment even with a long tracking reference.
    await this.sendSms(
      d.buyerPhone,
      `Gun Galore: ${truncate(d.listingTitle, 30)} dispatched.${d.trackingReference ? ' Ref: ' + d.trackingReference + '.' : ''} Track: ${txUrl}`,
      `dispatched-${d.transactionId}`,
    );
  }

  // ---------------------------------------------------------------
  // Seller: payment released
  // ---------------------------------------------------------------
  async paymentReleasedSeller(d: {
    sellerEmail: string;
    sellerName: string;
    sellerPhone?: string | null;
    listingTitle: string;
    sellerPayout: number;
    transactionId: string;
  }) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    // In-app inbox: informational — dismissible.
    await this.persistByEmail(d.sellerEmail, {
      category: 'SELLER',
      type: 'payment_released',
      title: 'Funds released',
      body: `${formatRand(d.sellerPayout)} on its way to your bank (${d.listingTitle})`,
      url: `/transactions/${d.transactionId}`,
      iconKey: 'transaction',
      linkedType: 'transaction',
      linkedId: d.transactionId,
      dismissible: true,
    });
    const html = this.email({
      status: { tone: 'success', label: 'Payment released' },
      headline: 'Payment released',
      body: `Hi ${b(d.sellerName)}, the buyer has confirmed delivery of ${b(d.listingTitle)}. Your payout of ${b(formatRand(d.sellerPayout))} will be processed within 2–3 business days.`,
      rows: [
        { label: 'Reference', value: d.transactionId.slice(-8).toUpperCase() },
        { label: 'Your payout', value: formatRand(d.sellerPayout) },
        { label: 'Date', value: formatDateShort(new Date()) },
      ],
      cta: { label: 'View sale', url: `${this.appUrl}/dashboard` },
      preheader: `Payout of ${formatRand(d.sellerPayout)} on the way`,
    });
    await this.send(
      d.sellerEmail,
      'Payout confirmed — ' + d.listingTitle,
      html,
    );
    await this.sendSms(
      d.sellerPhone,
      `Gun Galore: Payout of R${(d.sellerPayout / 100).toFixed(0)} for ${truncate(d.listingTitle, 40)} is on the way. Allow 2-3 business days.`,
      `payout-${d.transactionId}`,
    );
  }

  // ---------------------------------------------------------------
  // Buyer: refund issued
  // ---------------------------------------------------------------
  async refundIssuedBuyer(d: {
    buyerEmail: string;
    buyerName: string;
    buyerPhone?: string | null;
    listingTitle: string;
    buyerTotal: number;
    transactionId: string;
    note?: string | null;
  }) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    // In-app inbox: informational — the refund is already issued, the
    // buyer just needs to know. Dismissible.
    await this.persistByEmail(d.buyerEmail, {
      category: 'BUYER',
      type: 'refund_issued',
      title: 'Refund issued',
      body: `${formatRand(d.buyerTotal)} refunded for ${d.listingTitle}. Allow 5–10 business days.`,
      url: `/transactions/${d.transactionId}`,
      iconKey: 'transaction',
      linkedType: 'transaction',
      linkedId: d.transactionId,
      dismissible: true,
    });
    const body =
      `Hi ${b(d.buyerName)}, a refund of ${b(formatRand(d.buyerTotal))} for ${b(d.listingTitle)} has been issued. Please allow 5–10 business days for it to appear on your statement.` +
      (d.note ? `<br><br>Note from admin: ${b(d.note)}` : '');
    const html = this.email({
      status: { tone: 'success', label: 'Refunded' },
      headline: 'Refund issued',
      body,
      rows: [
        { label: 'Reference', value: d.transactionId.slice(-8).toUpperCase() },
        { label: 'Amount', value: formatRand(d.buyerTotal) },
        { label: 'Refund destination', value: 'Original payment card' },
      ],
      cta: { label: 'View order', url: txUrl },
      preheader: `Refund of ${formatRand(d.buyerTotal)} issued`,
    });
    await this.send(d.buyerEmail, 'Refund issued — ' + d.listingTitle, html);
    // Refunds are financial events — per CLAUDE.md every notifiable
    // event fires BOTH SMS + email. Skips silently if buyerPhone is
    // null (legacy buyer rows from before the phone-capture flow).
    if (d.buyerPhone) {
      await this.sendSms(
        d.buyerPhone,
        `Gun Galore: Refund of R${(d.buyerTotal / 100).toFixed(0)} for ${truncate(d.listingTitle, 40)} issued. Allow 5-10 business days.`,
        `refund-${d.transactionId}`,
      );
    }
  }

  // ---------------------------------------------------------------
  // Seller: listing approved
  // ---------------------------------------------------------------
  async listingApproved(d: ListingDecisionDetails) {
    const listingUrl = `${this.appUrl}/listings/${d.listingId}`;
    // In-app inbox: informational — dismissible.
    await this.persistByEmail(d.sellerEmail, {
      category: 'SELLER',
      type: 'listing_approved',
      title: 'Listing approved',
      body: `${d.listingTitle} is now live on the marketplace.`,
      url: `/listings/${d.listingId}`,
      iconKey: 'sold',
      linkedType: 'listing',
      linkedId: d.listingId,
      dismissible: true,
    });
    const html = this.email({
      status: { tone: 'success', label: 'Approved' },
      headline: 'Listing approved',
      body: `Hi ${b(d.sellerName)}, your listing ${b(d.listingTitle)} has been reviewed and approved. It is now live on the marketplace.`,
      cta: { label: 'View listing', url: listingUrl },
      preheader: `${d.listingTitle} is live`,
    });
    await this.send(d.sellerEmail, 'Listing approved: ' + d.listingTitle, html);
  }

  // ---------------------------------------------------------------
  // Seller: listing rejected
  // ---------------------------------------------------------------
  async listingRejected(d: ListingDecisionDetails) {
    const editUrl = `${this.appUrl}/listings/${d.listingId}/edit`;
    const reason = d.reason ?? 'No reason provided.';
    // In-app inbox: action-required (seller should edit + resubmit)
    // but ALSO dismissible (they may decide to abandon the listing).
    await this.persistByEmail(d.sellerEmail, {
      category: 'SELLER',
      type: 'listing_rejected',
      title: 'Listing needs changes',
      body: `${d.listingTitle} — ${reason}`,
      url: `/listings/${d.listingId}/edit`,
      iconKey: 'sold',
      linkedType: 'listing',
      linkedId: d.listingId,
      dismissible: true,
    });
    const html = this.email({
      status: { tone: 'error', label: 'Not approved' },
      headline: 'Listing not approved',
      body: `Hi ${b(d.sellerName)}, your listing ${b(d.listingTitle)} was not approved. Reason: ${b(reason)}<br><br>You may edit your listing and resubmit for review, or contact support if you believe this is an error.`,
      cta: { label: 'Edit listing', url: editUrl },
      preheader: `${d.listingTitle} was not approved`,
    });
    await this.send(
      d.sellerEmail,
      'Listing not approved: ' + d.listingTitle,
      html,
    );
  }

  // Admin took down a listing AFTER it was already live (different
  // from listingRejected, which fires during initial moderation).
  // The wording emphasises that the listing is gone + invites appeal
  // via support. Reason is mandatory at the service layer so the
  // template can always assume it's there.
  async listingRemovedByAdmin(d: {
    sellerEmail: string;
    sellerName: string;
    listingTitle: string;
    listingId: string;
    reason: string;
  }) {
    const myListingsUrl = `${this.appUrl}/my/listings`;
    const html = this.email({
      status: { tone: 'error', label: 'Removed' },
      headline: 'Listing removed',
      body: `Hi ${b(d.sellerName)}, an admin has removed your listing ${b(d.listingTitle)} from the marketplace. Reason: ${b(d.reason)}<br><br>If you believe this was a mistake, reply to this email or contact support@gungalore.co.za and an admin will review the takedown. The listing will not return automatically.`,
      cta: { label: 'Open my listings', url: myListingsUrl },
      preheader: `${d.listingTitle} was removed by an admin`,
    });
    await this.send(d.sellerEmail, 'Listing removed: ' + d.listingTitle, html);
  }

  // ---------------------------------------------------------------
  // Offer notifications
  // ---------------------------------------------------------------
  async offerReceived(d: {
    sellerEmail: string;
    sellerName: string;
    sellerPhone?: string | null;
    buyerName: string;
    listingTitle: string;
    listingId: string;
    offerAmount: number;
    offerId: string;
    /**
     * When set, used as both the email CTA target AND the SMS link.
     * Generated by OffersService from an OFFER_DECISION ActionToken
     * so the seller can accept/reject/counter from the SMS without
     * needing a Clerk sign-in. Falls back to the dashboard URL when
     * absent.
     */
    actionUrl?: string;
  }) {
    const url = d.actionUrl ?? `${this.appUrl}/offers/received`;
    // In-app inbox row. Action-required (not dismissible) — the seller
    // must accept / reject / counter on /offers/received to clear it.
    // OffersService.{accept,reject,counter}Offer call resolveByEntity
    // for these.
    await this.persistByEmail(d.sellerEmail, {
      category: 'SELLER',
      type: 'offer_received',
      title: 'New offer received',
      body: `${d.buyerName} offered ${formatRand(d.offerAmount)} on ${d.listingTitle}`,
      url: '/offers/received',
      iconKey: 'offer',
      linkedType: 'offer',
      linkedId: d.offerId,
      dismissible: false,
    });
    const html = this.email({
      status: { tone: 'pending', label: 'New offer' },
      headline: 'New offer',
      body: `Hi ${b(d.sellerName)}, ${b(d.buyerName)} has made an offer on your listing ${b(d.listingTitle)}. You can accept, reject, or make a single counter-offer. The offer expires in 48 hours.`,
      rows: [
        { label: 'Item', value: d.listingTitle },
        { label: 'Offer amount', value: formatRand(d.offerAmount) },
      ],
      cta: { label: 'Review offer', url },
      preheader: `${d.buyerName} offered ${formatRand(d.offerAmount)}`,
    });
    await this.send(d.sellerEmail, 'New offer on: ' + d.listingTitle, html);
    // SMS — only when we have a token URL (otherwise the SMS would
    // bounce the seller to /sign-in which isn't actionable from a
    // phone with no Clerk session). The character budget is tight —
    // truncate the title so the URL fits.
    if (d.actionUrl) {
      await this.sendSms(
        d.sellerPhone,
        `Gun Galore: ${truncate(d.buyerName, 20)} offered R${Math.round(d.offerAmount / 100)} on ${truncate(d.listingTitle, 28)}. Decide: ${d.actionUrl}`,
        `offer-${d.offerId}`,
      );
    }
  }

  async offerAccepted(d: {
    buyerEmail: string;
    buyerName: string;
    buyerPhone?: string | null;
    listingTitle: string;
    listingId: string;
    acceptedAmount: number;
    offerId: string;
    /**
     * Optional CHECKOUT token URL. When set, the email CTA + SMS
     * link both deep-link the buyer straight into the checkout page
     * without needing to sign in. Falls back to the existing
     * /checkout/offer/[id] URL (which requires Clerk auth).
     */
    actionUrl?: string;
  }) {
    const url = d.actionUrl ?? `${this.appUrl}/checkout/offer/${d.offerId}`;
    // In-app inbox: buyer must pay, but the Transaction model has no
    // offerId foreign key so we can't auto-resolve from the payment
    // flow. Marked dismissible — the buyer can tap → goes to checkout
    // → pays → returns and dismisses the row themselves.
    await this.persistByEmail(d.buyerEmail, {
      category: 'BUYER',
      type: 'offer_accepted',
      title: 'Offer accepted — pay within 24h',
      body: `${d.listingTitle} — ${formatRand(d.acceptedAmount)}`,
      url: `/checkout/offer/${d.offerId}`,
      iconKey: 'offer',
      linkedType: 'offer',
      linkedId: d.offerId,
      dismissible: true,
    });
    const html = this.email({
      status: { tone: 'success', label: 'Accepted' },
      headline: 'Your offer was accepted',
      body: `Hi ${b(d.buyerName)}, your offer of ${b(formatRand(d.acceptedAmount))} on ${b(d.listingTitle)} has been accepted. Complete your checkout within 24 hours to secure the item.`,
      cta: { label: 'Pay now', url },
      preheader: `Your ${formatRand(d.acceptedAmount)} offer was accepted`,
    });
    await this.send(d.buyerEmail, 'Offer accepted — ' + d.listingTitle, html);
    if (d.actionUrl) {
      await this.sendSms(
        d.buyerPhone,
        `Gun Galore: Your offer R${Math.round(d.acceptedAmount / 100)} on ${truncate(d.listingTitle, 30)} was accepted. Pay within 24h: ${d.actionUrl}`,
        `offer-acc-${d.offerId}`,
      );
    }
  }

  async offerRejected(d: {
    buyerEmail: string;
    buyerName: string;
    listingTitle: string;
    listingId: string;
    offerId: string;
  }) {
    const url = `${this.appUrl}/listings/${d.listingId}`;
    // In-app inbox: final state — dismissible (no action to take).
    await this.persistByEmail(d.buyerEmail, {
      category: 'BUYER',
      type: 'offer_rejected',
      title: 'Offer declined',
      body: `Your offer on ${d.listingTitle} was declined.`,
      url: `/listings/${d.listingId}`,
      iconKey: 'offer',
      linkedType: 'offer',
      linkedId: d.offerId,
      dismissible: true,
    });
    const html = this.email({
      status: { tone: 'error', label: 'Declined' },
      headline: 'Offer declined',
      body: `Hi ${b(d.buyerName)}, the seller has declined your offer on ${b(d.listingTitle)}.`,
      cta: { label: 'View listing', url },
      preheader: `Offer declined — ${d.listingTitle}`,
    });
    await this.send(d.buyerEmail, 'Offer declined — ' + d.listingTitle, html);
  }

  async offerCountered(d: {
    buyerEmail: string;
    buyerName: string;
    buyerPhone?: string | null;
    listingTitle: string;
    listingId: string;
    originalAmount: number;
    counterAmount: number;
    sellerNote?: string;
    offerId: string;
    /**
     * Optional COUNTER_DECISION token URL. When set, the SMS link
     * drops the buyer on /a/<token> where they can accept/reject
     * the counter or counter back, without signing in.
     */
    actionUrl?: string;
  }) {
    const url = d.actionUrl ?? `${this.appUrl}/my/offers`;
    const rows: { label: string; value: string }[] = [
      { label: 'Item', value: d.listingTitle },
      { label: 'Your offer', value: formatRand(d.originalAmount) },
      { label: 'Seller counter', value: formatRand(d.counterAmount) },
    ];
    if (d.sellerNote) {
      rows.push({ label: 'Seller note', value: d.sellerNote });
    }
    const html = this.email({
      status: { tone: 'pending', label: 'Counter-offer' },
      headline: 'Counter-offer received',
      body: `Hi ${b(d.buyerName)}, the seller has countered your offer on ${b(d.listingTitle)}. You can accept or reject the counter. This is the final offer and it expires in 24 hours.`,
      rows,
      cta: { label: 'Respond to counter', url },
      preheader: `Seller countered at ${formatRand(d.counterAmount)}`,
    });
    await this.send(d.buyerEmail, 'Counter-offer on: ' + d.listingTitle, html);
    // In-app inbox: buyer must respond to the counter → action-required.
    // Cleared when buyer accepts / rejects / counter-counters via
    // OffersService — same resolveByEntity('offer', offerId) call site
    // resolves both the seller's offer_received AND the buyer's
    // offer_countered notifications on the same offer.
    await this.persistByEmail(d.buyerEmail, {
      category: 'BUYER',
      type: 'offer_countered',
      title: 'Seller countered your offer',
      body: `${d.listingTitle} — ${formatRand(d.originalAmount)} → ${formatRand(d.counterAmount)}`,
      url: '/my/offers',
      iconKey: 'offer',
      linkedType: 'offer',
      linkedId: d.offerId,
      dismissible: false,
    });
    if (d.actionUrl) {
      await this.sendSms(
        d.buyerPhone,
        `Gun Galore: Seller countered at R${Math.round(d.counterAmount / 100)} on ${truncate(d.listingTitle, 28)}. 24h to respond: ${d.actionUrl}`,
        `counter-${d.offerId}`,
      );
    }
  }

  async counterAccepted(d: {
    sellerEmail: string;
    sellerName: string;
    buyerName: string;
    listingTitle: string;
    listingId: string;
    counterAmount: number;
    offerId: string;
  }) {
    // In-app inbox: informational — seller just needs to know the
    // buyer's accepted the counter. Buyer has 24h to pay. Dismissible
    // because the next action belongs to the buyer.
    await this.persistByEmail(d.sellerEmail, {
      category: 'SELLER',
      type: 'counter_accepted',
      title: 'Counter accepted',
      body: `${d.buyerName} accepted your ${formatRand(d.counterAmount)} counter on ${d.listingTitle}.`,
      url: `/offers/received`,
      iconKey: 'offer',
      linkedType: 'offer',
      linkedId: d.offerId,
      dismissible: true,
    });
    const html = this.email({
      status: { tone: 'success', label: 'Counter accepted' },
      headline: 'Counter accepted',
      body: `Hi ${b(d.sellerName)}, ${b(d.buyerName)} has accepted your counter-offer of ${b(formatRand(d.counterAmount))} on ${b(d.listingTitle)}. They will complete checkout within 24 hours.`,
      cta: {
        label: 'View received offers',
        url: `${this.appUrl}/offers/received`,
      },
      preheader: `${d.buyerName} accepted your counter`,
    });
    await this.send(
      d.sellerEmail,
      'Counter accepted — ' + d.listingTitle,
      html,
    );
  }

  async counterRejected(d: {
    sellerEmail: string;
    sellerName: string;
    buyerName: string;
    listingTitle: string;
    listingId: string;
    offerId: string;
  }) {
    // In-app inbox: informational, final state. Dismissible.
    await this.persistByEmail(d.sellerEmail, {
      category: 'SELLER',
      type: 'counter_rejected',
      title: 'Counter declined',
      body: `${d.buyerName} declined your counter on ${d.listingTitle}. Listing stays active.`,
      url: `/listings/${d.listingId}`,
      iconKey: 'offer',
      linkedType: 'offer',
      linkedId: d.offerId,
      dismissible: true,
    });
    const html = this.email({
      status: { tone: 'error', label: 'Counter declined' },
      headline: 'Counter declined',
      body: `Hi ${b(d.sellerName)}, ${b(d.buyerName)} has declined your counter-offer on ${b(d.listingTitle)}. The listing remains active.`,
      cta: {
        label: 'View listing',
        url: `${this.appUrl}/listings/${d.listingId}`,
      },
      preheader: `${d.buyerName} declined your counter`,
    });
    await this.send(
      d.sellerEmail,
      'Counter declined — ' + d.listingTitle,
      html,
    );
  }

  // ---------------------------------------------------------------
  // Auction notifications
  // ---------------------------------------------------------------

  async bidPlaced(
    sellerEmail: string,
    listingTitle: string,
    amount: number,
    sellerPhone?: string | null,
    listingId?: string,
  ) {
    const url = `${this.appUrl}`;
    const html = this.email({
      status: { tone: 'pending', label: 'New bid' },
      headline: 'New bid on your auction',
      body: `A new bid of ${b(formatRand(amount))} has been placed on ${b(listingTitle)}. You will receive another email when the auction ends.`,
      cta: { label: 'View listing', url },
      preheader: `${formatRand(amount)} bid on ${listingTitle}`,
    });
    await this.send(sellerEmail, 'New bid: ' + listingTitle, html);
    if (sellerPhone) {
      await this.sendSms(
        sellerPhone,
        `Gun Galore: New bid R${(amount / 100).toFixed(0)} on ${truncate(listingTitle, 40)}.`,
        `bid-${listingId ?? 'x'}-${amount}`,
      );
    }
  }

  async bidOutbid(
    buyerEmail: string,
    listingTitle: string,
    newAmount: number,
    buyerPhone?: string | null,
    listingId?: string,
    /**
     * AUCTION_BID token URL. When provided, drops the outbid buyer
     * on /a/<token> where they can pick "raise auto-bid" or "single
     * bid" without signing in. Falls back to the listing URL when
     * absent (still functional, just one extra tap to sign in).
     */
    actionUrl?: string,
  ) {
    const url =
      actionUrl ??
      (listingId ? `${this.appUrl}/listings/${listingId}` : this.appUrl);
    // In-app inbox: action-required. Buyer must place a higher bid (or
    // accept the loss when auction closes). Linked on listingId so when
    // the same user bids again on this auction, their previous outbid
    // notifications auto-resolve via BidsService.placeBid →
    // resolveByEntity('listing', listingId, bidderId). When the auction
    // closes, the cron resolves remaining outbid rows as 'auto_expired'.
    await this.persistByEmail(buyerEmail, {
      category: 'BUYER',
      type: 'bid_outbid',
      title: "You've been outbid",
      body: `${listingTitle} — current bid ${formatRand(newAmount)}`,
      url: listingId ? `/listings/${listingId}` : '/',
      iconKey: 'bid',
      linkedType: 'listing',
      linkedId: listingId,
      dismissible: false,
    });
    const html = this.email({
      status: { tone: 'error', label: 'Outbid' },
      headline: "You've been outbid",
      body: `Another bidder has overtaken you on ${b(listingTitle)}. The current high bid is now ${b(formatRand(newAmount))}. You can raise your maximum bid to take the lead — the system will only bid up to that amount on your behalf.`,
      cta: { label: 'Raise your bid', url },
      preheader: `Outbid — high bid is now ${formatRand(newAmount)}`,
    });
    await this.send(buyerEmail, 'Outbid on: ' + listingTitle, html);
    if (buyerPhone) {
      const smsBody = actionUrl
        ? `Gun Galore: Outbid on ${truncate(listingTitle, 26)} — high R${(newAmount / 100).toFixed(0)}. Raise: ${actionUrl}`
        : `Gun Galore: Outbid on ${truncate(listingTitle, 30)} — current bid R${(newAmount / 100).toFixed(0)}.`;
      await this.sendSms(
        buyerPhone,
        smsBody,
        `outbid-${listingId ?? 'x'}-${newAmount}`,
      );
    }
  }

  async auctionWon(
    winnerEmail: string,
    listingTitle: string,
    amount: number,
    winnerPhone?: string | null,
    listingId?: string,
    /**
     * CHECKOUT token URL. Buyer taps and lands directly on the
     * checkout page for this auction — no sign-in friction. Falls
     * back to /my/bids (the existing dashboard URL, sign-in
     * required) when absent.
     */
    actionUrl?: string,
  ) {
    const url = actionUrl ?? `${this.appUrl}/my/bids`;
    // In-app inbox: action-required (must pay within 24h). Linked on
    // the listingId since the auction won doesn't yet have a tx id
    // until the buyer pays — TransactionsService.payAuction will fire
    // resolveByEntity('listing', listingId, winnerId) at pay-time.
    await this.persistByEmail(winnerEmail, {
      category: 'BUYER',
      type: 'auction_won',
      title: 'You won — pay within 24h',
      body: `${listingTitle} for ${formatRand(amount)}`,
      url: listingId ? `/checkout/${listingId}` : '/my/bids',
      iconKey: 'trophy',
      linkedType: 'listing',
      linkedId: listingId,
      dismissible: false,
    });
    const html = this.email({
      status: { tone: 'success', label: 'Auction won' },
      headline: 'You won.',
      body: `Congratulations — you won ${b(listingTitle)} with a high bid of ${b(formatRand(amount))}. You have 24 hours to complete checkout. After that, the auction may be offered to the next highest bidder and a strike may be applied to your account.`,
      cta: { label: 'Pay now', url },
      preheader: `You won ${listingTitle} for ${formatRand(amount)}`,
    });
    await this.send(winnerEmail, 'You won — ' + listingTitle, html);
    if (winnerPhone) {
      await this.sendSms(
        winnerPhone,
        `Gun Galore: You WON ${truncate(listingTitle, 26)} for R${(amount / 100).toFixed(0)}. 24h to pay: ${url}`,
        `auction-won-${listingId ?? 'x'}`,
      );
    }
  }

  // The three auction-ended outcomes route to three different
  // templates so the seller's email matches the outcome exactly
  // (sold / reserve not met / no bids). NO_RESERVE and NO_BIDS
  // each have a dedicated template; WON falls back to the inline
  // layout (no dedicated seller-side won template — sale-confirmed
  // is the buyer-side one).
  async auctionEndedForSeller(
    sellerEmail: string,
    listingTitle: string,
    outcome: 'WON' | 'NO_RESERVE' | 'NO_BIDS',
    amount: number,
    // Optional listingId so we can deep-link the inbox row to the
    // listing and resolveByEntity('listing', listingId) when the next
    // step lands (e.g. seller relists / buyer pays). Callers that
    // don't have it yet can still call this method — the row just
    // won't auto-resolve.
    listingId?: string,
  ) {
    const ctaUrl = `${this.appUrl}/dashboard`;
    // In-app inbox: WON is action-required (seller needs to track the
    // buyer's payment), NO_RESERVE/NO_BIDS are dismissible final
    // states.
    await this.persistByEmail(sellerEmail, {
      category: 'SELLER',
      type: `auction_ended_${outcome.toLowerCase()}`,
      title:
        outcome === 'WON'
          ? 'Auction sold'
          : outcome === 'NO_RESERVE'
            ? 'Reserve not met'
            : 'Auction ended — no bids',
      body:
        outcome === 'WON'
          ? `${listingTitle} sold for ${formatRand(amount)}. Buyer has 24h to pay.`
          : outcome === 'NO_RESERVE'
            ? `Highest bid ${formatRand(amount)} on ${listingTitle} didn't meet your reserve.`
            : `${listingTitle} ended with no bids. Relist to try again.`,
      url: listingId ? `/listings/${listingId}` : '/dashboard',
      iconKey: 'sold',
      linkedType: listingId ? 'listing' : undefined,
      linkedId: listingId,
      dismissible: outcome !== 'WON',
    });
    let html: string;
    let subject: string;
    switch (outcome) {
      case 'WON':
        subject = 'Auction sold — ' + listingTitle;
        html = this.email({
          status: { tone: 'success', label: 'Auction sold' },
          headline: 'Auction sold',
          body: `Your auction ${b(listingTitle)} sold for ${b(formatRand(amount))}. The buyer has 24 hours to complete payment.`,
          cta: { label: 'View dashboard', url: ctaUrl },
          preheader: `Sold for ${formatRand(amount)}`,
        });
        break;
      case 'NO_RESERVE':
        subject = 'Reserve not met — ' + listingTitle;
        html = this.email({
          status: { tone: 'pending', label: 'Reserve not met' },
          headline: 'Reserve not met',
          body: `Bidding closed on ${b(listingTitle)} at ${b(formatRand(amount))}, which did not meet your reserve. You can accept the high bid, counter, or relist.`,
          cta: { label: 'View dashboard', url: ctaUrl },
          preheader: `Highest bid ${formatRand(amount)} — below reserve`,
        });
        break;
      case 'NO_BIDS':
        subject = 'No bids — ' + listingTitle;
        html = this.email({
          status: { tone: 'error', label: 'No bids' },
          headline: 'No bids — relist?',
          body: `${b(listingTitle)} ended with no bids. You can relist with a lower starting price.`,
          cta: { label: 'View dashboard', url: ctaUrl },
          preheader: `${listingTitle} closed with no bids`,
        });
        break;
    }
    await this.send(sellerEmail, subject, html);
  }

  // ---------------------------------------------------------------
  // Shipping status notifications (called by webhook handlers)
  // ---------------------------------------------------------------

  async shippingDispatched(
    buyerEmail: string,
    buyerName: string,
    listingTitle: string,
    transactionId: string,
  ) {
    // In-app inbox: action-required (buyer must confirm delivery to
    // release payout). Cleared when TransactionsService.confirmDelivery
    // fires resolveByEntity('transaction', txId, buyerUserId).
    await this.persistByEmail(buyerEmail, {
      category: 'BUYER',
      type: 'shipping_dispatched',
      title: 'Dispatched',
      body: `${listingTitle} is on its way.`,
      url: `/transactions/${transactionId}`,
      iconKey: 'dispatch',
      linkedType: 'transaction',
      linkedId: transactionId,
      dismissible: false,
    });
    const html = this.email({
      status: { tone: 'success', label: 'Dispatched' },
      headline: 'Dispatched',
      body: `Hi ${b(buyerName)}, ${b(listingTitle)} is on its way. We'll email you again when it's out for delivery.`,
      cta: {
        label: 'Track order',
        url: `${this.appUrl}/transactions/${transactionId}`,
      },
      preheader: `${listingTitle} is on its way`,
    });
    await this.send(buyerEmail, 'Dispatched — ' + listingTitle, html);
  }

  async shippingOutForDelivery(
    buyerEmail: string,
    buyerName: string,
    listingTitle: string,
    transactionId: string,
  ) {
    const html = this.email({
      status: { tone: 'pending', label: 'Out for delivery' },
      headline: 'Out for delivery today',
      body: `Hi ${b(buyerName)}, ${b(listingTitle)} is out for delivery. Please be available to receive it.`,
      cta: {
        label: 'Track order',
        url: `${this.appUrl}/transactions/${transactionId}`,
      },
      preheader: `${listingTitle} is out for delivery today`,
    });
    await this.send(buyerEmail, 'Out for delivery — ' + listingTitle, html);
  }

  async shippingDelivered(
    buyerEmail: string,
    buyerName: string,
    listingTitle: string,
    transactionId: string,
  ) {
    const url = `${this.appUrl}/transactions/${transactionId}`;
    // In-app inbox: action-required (buyer should confirm receipt
    // within 7 days or payment auto-releases anyway). Cleared by
    // resolveByEntity('transaction', txId, buyerUserId) on confirm.
    await this.persistByEmail(buyerEmail, {
      category: 'BUYER',
      type: 'shipping_delivered',
      title: 'Delivered — confirm receipt',
      body: `${listingTitle} was delivered. Tap to confirm so the seller can be paid.`,
      url: `/transactions/${transactionId}`,
      iconKey: 'transaction',
      linkedType: 'transaction',
      linkedId: transactionId,
      dismissible: false,
    });
    const html = this.email({
      status: { tone: 'success', label: 'Delivered' },
      headline: 'Delivered',
      body: `Hi ${b(buyerName)}, your ${b(listingTitle)} has been delivered. Please confirm receipt in your dashboard so the seller can be paid. You have 7 days to confirm — after that, the payment will auto-release.`,
      cta: { label: 'Confirm receipt', url },
      preheader: `${listingTitle} was delivered`,
    });
    await this.send(buyerEmail, 'Delivered — ' + listingTitle, html);
  }

  async shippingFailed(
    buyerEmail: string,
    buyerName: string,
    listingTitle: string,
    transactionId: string,
  ) {
    const html = this.email({
      status: { tone: 'error', label: 'Delivery failed' },
      headline: 'Delivery failed',
      body: `Hi ${b(buyerName)}, we couldn't deliver ${b(listingTitle)}. The courier will retry. If you need to update your address or have questions, contact support.`,
      cta: {
        label: 'View order',
        url: `${this.appUrl}/transactions/${transactionId}`,
      },
      preheader: `Delivery of ${listingTitle} failed`,
    });
    await this.send(buyerEmail, 'Delivery failed — ' + listingTitle, html);
  }

  // ---------------------------------------------------------------
  // Raffle notifications
  // ---------------------------------------------------------------

  async raffleEntryConfirmed(
    buyerEmail: string,
    raffleTitle: string,
    ticketCount: number,
    refCodes: string[],
    // Optional raffleId so we can deep-link the inbox row. Caller can
    // pass it from RafflesService.confirmEntry — if missing the row
    // still appears and just deep-links to /my/tickets.
    raffleId?: string,
  ) {
    const url = `${this.appUrl}/my/tickets`;
    // In-app inbox: confirmation receipt — dismissible. The user will
    // get a separate "you won" / "you lost" notification at draw time.
    await this.persistByEmail(buyerEmail, {
      category: 'BUYER',
      type: 'raffle_entry_confirmed',
      title: 'Raffle entry confirmed',
      body: `${ticketCount} ticket${ticketCount === 1 ? '' : 's'} for ${raffleTitle}.`,
      url: '/my/tickets',
      iconKey: 'transaction',
      linkedType: raffleId ? 'raffle' : undefined,
      linkedId: raffleId,
      dismissible: true,
    });
    const shownRefs = refCodes.slice(0, 25);
    const refsList = shownRefs.join(', ');
    const refsLine =
      shownRefs.length > 0 ? `<br><br>Reference codes: ${b(refsList)}` : '';
    const html = this.email({
      status: { tone: 'success', label: 'Tickets confirmed' },
      headline: 'Tickets confirmed',
      body: `You're in. ${b(String(ticketCount))} ticket${ticketCount === 1 ? '' : 's'} for ${b(raffleTitle)} ${ticketCount === 1 ? 'is' : 'are'} confirmed.${refsLine}`,
      rows: [
        { label: 'Tickets', value: String(ticketCount) },
        { label: 'Date', value: formatDateShort(new Date()) },
      ],
      cta: { label: 'My tickets', url },
      preheader: `${ticketCount} ticket${ticketCount === 1 ? '' : 's'} for ${raffleTitle}`,
    });
    await this.send(buyerEmail, 'Entry confirmed — ' + raffleTitle, html);
  }

  async raffleWinnerPicked(
    winnerEmail: string,
    raffleTitle: string,
    position: number,
    claimDeadline: Date,
    raffleId?: string,
  ) {
    const place = position === 1 ? 'WINNER' : `Backup #${position - 1}`;
    const url = `${this.appUrl}/dashboard/raffle-wins`;
    const isWinner = position === 1;
    const deadlineStr = claimDeadline.toLocaleString('en-ZA');
    // In-app inbox: action-required (winner must claim before
    // deadline; clears when admin marks prize dispatched).
    await this.persistByEmail(winnerEmail, {
      category: 'BUYER',
      type: isWinner ? 'raffle_won' : 'raffle_backup',
      title: isWinner ? '🎉 You won!' : `You're a backup pick`,
      body: `${raffleTitle} — claim by ${deadlineStr}`,
      url: '/dashboard/raffle-wins',
      iconKey: 'raffle',
      linkedType: 'raffle',
      linkedId: raffleId,
      // Dismissible — the dispatch flow happens out-of-band (admin
      // contacts winner manually), so we don't reliably get a
      // resolveByEntity hook to auto-clear. Winner clears manually
      // once they've claimed the prize.
      dismissible: true,
    });
    const html = this.email({
      status: isWinner
        ? { tone: 'success', label: 'Winner' }
        : { tone: 'pending', label: 'Backup pick' },
      headline: isWinner ? 'You won!' : `You're a ${place}`,
      body: `You've been drawn as ${b(place)} on ${b(raffleTitle)}. Confirm your claim before the deadline below. If you do not claim within the window, the next backup is promoted automatically.`,
      rows: [
        { label: 'Raffle', value: raffleTitle },
        { label: 'Claim deadline', value: deadlineStr },
      ],
      cta: { label: 'Claim prize', url },
      preheader: isWinner
        ? `You won ${raffleTitle}`
        : `Backup pick for ${raffleTitle}`,
    });
    await this.send(
      winnerEmail,
      (isWinner ? 'You won — ' : 'Backup pick — ') + raffleTitle,
      html,
    );
  }

  async raffleBackupPromoted(
    winnerEmail: string,
    raffleId: string,
    claimDeadline: Date,
  ) {
    const url = `${this.appUrl}/dashboard/raffle-wins`;
    const deadlineStr = claimDeadline.toLocaleString('en-ZA');
    const html = this.email({
      status: { tone: 'success', label: 'Promoted' },
      headline: 'Promoted to winner',
      body: `The primary winner did not claim their prize. You're up — confirm your claim before the deadline below.`,
      rows: [{ label: 'Claim deadline', value: deadlineStr }],
      cta: { label: 'Claim prize', url },
      preheader: 'Backup promoted — claim your prize',
    });
    await this.send(winnerEmail, 'Backup promoted to winner', html);
  }

  // ---------------------------------------------------------------
  // Raffle prize dispatched — winner notification
  // ---------------------------------------------------------------
  //
  // Sent the moment an admin clicks "Mark as dispatched" in the
  // per-raffle dossier. Two channels (SMS + email) because raffle wins
  // are high-stakes events the user has been refreshing /dashboard for
  // — they should not need to ask the admin for tracking info.
  //
  // The carrier link below is a best-effort deep-link to the courier's
  // own tracker. We only render the link for carriers we recognise so
  // a typo'd carrier label can't ship a broken URL. Unknown carriers
  // fall through to a plain "Tracking: REF" line — still useful.
  async raffleWinnerPrizeDispatched(opts: {
    winnerEmail: string;
    winnerPhone?: string | null;
    raffleTitle: string;
    trackingRef: string;
    carrierLabel?: string | null;
    raffleId?: string;
  }) {
    const { winnerEmail, winnerPhone, raffleTitle, trackingRef } = opts;
    // In-app inbox: informational — the prize is on the way and the
    // tracking ref is the only action they'd take. Dismissible.
    await this.persistByEmail(winnerEmail, {
      category: 'BUYER',
      type: 'raffle_prize_dispatched',
      title: 'Your prize is on the way',
      body: `${raffleTitle} dispatched. Tracking: ${trackingRef}`,
      url: '/dashboard/raffle-wins',
      iconKey: 'dispatch',
      linkedType: opts.raffleId ? 'raffle' : undefined,
      linkedId: opts.raffleId,
      dismissible: true,
    });
    const carrier = opts.carrierLabel?.trim() || 'Courier';
    const trackingUrl = carrierTrackingUrl(opts.carrierLabel, trackingRef);

    const rows: { label: string; value: string }[] = [
      { label: 'Tracking ref', value: trackingRef },
      { label: 'Carrier', value: carrier },
    ];
    const cta = trackingUrl
      ? { label: 'Track parcel', url: trackingUrl }
      : undefined;

    const html = this.email({
      status: { tone: 'success', label: 'Dispatched' },
      headline: 'Your raffle prize is on the way',
      body: `Great news — your prize from ${b(raffleTitle)} has been dispatched. Use the tracking reference below to follow it via ${b(carrier)}.`,
      rows,
      cta,
      preheader: `Prize dispatched — tracking ${trackingRef}`,
    });
    await this.send(
      winnerEmail,
      'Your prize has been dispatched — ' + raffleTitle,
      html,
    );

    // SMS — single segment if at all possible. Truncate the raffle
    // title aggressively so the tracking ref is never cut off.
    await this.sendSms(
      winnerPhone,
      `Gun Galore: Your prize for "${truncate(raffleTitle, 30)}" is on the way! Tracking: ${trackingRef} (${carrier})`,
      `raffle-dispatched-${trackingRef}`,
    );
  }

  async raffleMinNotMet(
    buyerEmail: string,
    raffleTitle: string,
    buyerPhone?: string | null,
    raffleId?: string,
  ) {
    const html = this.email({
      status: { tone: 'error', label: 'Cancelled' },
      headline: 'Raffle cancelled',
      body: `Sadly, ${b(raffleTitle)} did not sell enough tickets to draw. Your payment will be refunded in full within 5–7 working days. Sorry about that — we will run another shot at it soon.`,
      preheader: `${raffleTitle} cancelled — full refund coming`,
    });
    await this.send(buyerEmail, 'Refund — ' + raffleTitle, html);
    if (buyerPhone) {
      await this.sendSms(
        buyerPhone,
        `Gun Galore: ${truncate(raffleTitle, 40)} cancelled (not enough tickets). Full refund in 5-7 days.`,
        `raffle-min-${raffleId ?? 'x'}`,
      );
    }
  }

  // ---------------------------------------------------------------
  // Admin: VerifyNow credit balance dropped below threshold
  // ---------------------------------------------------------------
  // Outbound nudge so the operator can top up credits before sellers
  // get blocked. Sent to every active admin's User.email — the same
  // function returns the body so we can also push it through SMS.
  async adminLowVerifyNowCredits(
    adminEmail: string,
    adminName: string,
    available: number,
    threshold: number,
  ) {
    const url = `${this.appUrl}/admin/kyc`;
    const html = this.email({
      status: { tone: 'pending', label: 'Action needed' },
      headline: 'VerifyNow credits low',
      body: `Hi ${b(adminName)}, your VerifyNow account has ${b(String(available))} credits remaining — below the ${b(String(threshold))}-credit alert threshold. New KYC verifications will start failing once you hit zero. Top up via the VerifyNow dashboard before that happens.`,
      rows: [
        { label: 'Available', value: String(available) },
        { label: 'Threshold', value: String(threshold) },
      ],
      cta: { label: 'View KYC credits panel', url },
      preheader: `${available} VerifyNow credits remaining`,
    });
    await this.send(
      adminEmail,
      `VerifyNow credits low — ${available} remaining`,
      html,
    );
  }

  // ---------------------------------------------------------------
  // Admin: generic credit-low alert (any monitored service).
  // ---------------------------------------------------------------
  // Driven by the /admin/credits monitoring system (CreditThreshold
  // table). The 15-min poll cron calls this when an external service
  // (SMSPortal / VerifyNow / Cloudinary / Anthropic / Pudo) crosses
  // the operator-configured warn or alarm line.
  //
  // severity:
  //   - 'warn'  — email only (amber). One per service per 6h.
  //   - 'alarm' — email + SMS (red).   One per service per 6h.
  //
  // SMS is sent via the caller (it already has the operator's phone
  // from the AdminUser join); this method only renders the email and
  // returns the SMS body string for the caller to feed into sendSms.
  // That way we don't re-fetch admin contact rows here.
  async creditAlert(d: {
    adminEmail: string;
    adminName: string;
    service: string;
    balance: number;
    unit: string;
    severity: 'warn' | 'alarm';
    threshold: number;
  }): Promise<string> {
    const url = `${this.appUrl}/admin/credits`;
    const isAlarm = d.severity === 'alarm';
    const friendlyService = prettyServiceName(d.service);
    const dot = isAlarm ? '🔴' : '🟡';
    const headline = isAlarm
      ? `${friendlyService} credits CRITICAL`
      : `${friendlyService} credits low`;

    const html = this.email({
      status: {
        tone: isAlarm ? 'error' : 'pending',
        label: isAlarm ? 'Critical' : 'Action needed',
      },
      headline,
      body: `Hi ${b(d.adminName)}, the ${b(friendlyService)} service is at ${b(`${d.balance} ${d.unit}`)} — ${isAlarm ? 'BELOW the alarm threshold' : 'below the warn threshold'} of ${b(`${d.threshold} ${d.unit}`)}. Top up before live testing or production traffic hits this service.`,
      rows: [
        { label: 'Service', value: friendlyService },
        { label: 'Current balance', value: `${d.balance} ${d.unit}` },
        { label: 'Threshold', value: `${d.threshold} ${d.unit}` },
        { label: 'Severity', value: isAlarm ? 'ALARM' : 'WARN' },
      ],
      cta: { label: 'Open credits dashboard', url },
      preheader: `${friendlyService} at ${d.balance} ${d.unit} — ${d.severity}`,
    });

    await this.send(
      d.adminEmail,
      `${dot} ${friendlyService} credits at ${d.balance} ${d.unit}`,
      html,
    );

    // SMS body — kept under 160 chars for single-segment delivery so
    // the alarm reaches the operator's lock screen without truncation.
    return `Gun Galore: ${friendlyService} credits at ${d.balance} ${d.unit}. Top up: ${url}`;
  }

  // ---------------------------------------------------------------
  // ---------------------------------------------------------------
  // Dispatch SLA — 48h since payment, seller hasn't dispatched yet.
  // One-shot nudge with the auto-refund deadline spelled out so the
  // seller knows what happens if they ignore it.
  // ---------------------------------------------------------------
  async dispatchNudgeSeller(d: {
    sellerEmail: string;
    sellerName: string;
    sellerPhone?: string | null;
    listingTitle: string;
    transactionId: string;
    hoursElapsed: number;
    autoRefundDays: number;
  }) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    // In-app inbox: action-required (seller must dispatch to avoid
    // auto-refund + strike). Cleared by resolveByEntity('transaction')
    // when TransactionsService.markDispatched fires.
    await this.persistByEmail(d.sellerEmail, {
      category: 'SELLER',
      type: 'dispatch_nudge',
      title: 'Dispatch needed — soon',
      body: `${d.listingTitle} — ${d.hoursElapsed}h since payment. Auto-refund in ${d.autoRefundDays} day${d.autoRefundDays === 1 ? '' : 's'}.`,
      url: `/transactions/${d.transactionId}`,
      iconKey: 'dispatch',
      linkedType: 'transaction',
      linkedId: d.transactionId,
      dismissible: false,
    });
    const html = this.email({
      status: { tone: 'pending', label: 'Action needed' },
      headline: 'Please dispatch your sold item',
      body: `Hi ${b(d.sellerName)}, it's been ${b(d.hoursElapsed + 'h')} since the buyer paid for ${b(d.listingTitle)} and the parcel hasn't been dispatched yet. Dispatch within the next ${b(d.autoRefundDays + ' days')} or the order will be automatically refunded to the buyer and a strike added to your account. If you can't ship for any reason, message support so we can refund the buyer cleanly.`,
      rows: [
        { label: 'Reference', value: d.transactionId.slice(-8).toUpperCase() },
        { label: 'Time elapsed', value: `${d.hoursElapsed}h` },
        { label: 'Auto-refund in', value: `${d.autoRefundDays} days` },
      ],
      cta: { label: 'Mark as dispatched', url: txUrl },
      preheader: `Dispatch ${d.listingTitle} or it'll be auto-refunded`,
    });
    await this.send(
      d.sellerEmail,
      'Action needed: dispatch ' + d.listingTitle,
      html,
    );
    await this.sendSms(
      d.sellerPhone,
      `Gun Galore: ${truncate(d.listingTitle, 30)} still not dispatched (${d.hoursElapsed}h). Auto-refund in ${d.autoRefundDays}d. Ship now: ${txUrl}`,
      `dispatch-nudge-${d.transactionId}`,
    );
  }

  // ---------------------------------------------------------------
  // Dispatch SLA — auto-refund fired. Two emails (buyer gets the
  // "good news, your money is back" message; seller gets the strike
  // warning).
  // ---------------------------------------------------------------
  async orderAutoRefunded(d: {
    listingTitle: string;
    transactionId: string;
    buyerTotal: number;
    buyer: { email: string; firstName: string | null; phone: string | null };
    seller: { email: string; firstName: string | null; phone: string | null };
  }) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    const buyerName = d.buyer.firstName ?? 'Buyer';
    const sellerName = d.seller.firstName ?? 'Seller';

    const buyerHtml = this.email({
      status: { tone: 'success', label: 'Refunded' },
      headline: 'Order refunded',
      body: `Hi ${b(buyerName)}, the seller of ${b(d.listingTitle)} didn't dispatch within our 7-day window. We've refunded ${b(formatRand(d.buyerTotal))} back to your card. The funds should reflect in 3–7 working days. Sorry for the trouble — the listing is back on the marketplace if you want to browse alternatives.`,
      rows: [
        { label: 'Reference', value: d.transactionId.slice(-8).toUpperCase() },
        { label: 'Amount', value: formatRand(d.buyerTotal) },
      ],
      cta: { label: 'Browse listings', url: `${this.appUrl}/` },
      preheader: `Refunded ${formatRand(d.buyerTotal)} for ${d.listingTitle}`,
    });
    await this.send(d.buyer.email, 'Refunded: ' + d.listingTitle, buyerHtml);
    await this.sendSms(
      d.buyer.phone,
      `Gun Galore: ${truncate(d.listingTitle, 30)} not dispatched. Refunded ${formatRand(d.buyerTotal)} to your card.`,
      `auto-refund-buyer-${d.transactionId}`,
    );

    const sellerHtml = this.email({
      status: { tone: 'error', label: 'Strike added' },
      headline: 'Auto-refund issued — strike added',
      body: `Hi ${b(sellerName)}, you didn't dispatch ${b(d.listingTitle)} within the 7-day window. The buyer has been refunded and a dispatch strike has been added to your account. Three strikes triggers a manual review and possible suspension. If something genuinely went wrong, contact support before it happens again.`,
      rows: [
        { label: 'Reference', value: d.transactionId.slice(-8).toUpperCase() },
      ],
      cta: { label: 'Open order', url: txUrl },
      preheader: `${d.listingTitle} auto-refunded — strike added`,
    });
    await this.send(
      d.seller.email,
      'Auto-refund: ' + d.listingTitle,
      sellerHtml,
    );
    await this.sendSms(
      d.seller.phone,
      `Gun Galore: ${truncate(d.listingTitle, 30)} auto-refunded (no dispatch). Strike added.`,
      `auto-refund-seller-${d.transactionId}`,
    );
  }

  // ---------------------------------------------------------------
  // PRIVATE_ARRANGE — buyer waived payment protection + opted into a peer
  // arrangement. Two emails go out (one to each party) with the
  // OTHER party's contact details so they can coordinate the SAPS
  // dealer meet. Buyer also gets an SMS with the seller's name +
  // phone since that's the bit they'll act on first.
  // ---------------------------------------------------------------
  async privateArrangeContactReveal(d: {
    listingTitle: string;
    transactionId: string;
    buyer: {
      email: string;
      firstName: string | null;
      lastName: string | null;
      phone: string | null;
    };
    seller: {
      email: string;
      firstName: string | null;
      lastName: string | null;
      phone: string | null;
    };
    sellerPayout: number;
  }) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    const buyerName =
      [d.buyer.firstName, d.buyer.lastName].filter(Boolean).join(' ') ||
      'Buyer';
    const sellerName =
      [d.seller.firstName, d.seller.lastName].filter(Boolean).join(' ') ||
      'Seller';

    // Email to the BUYER — reveals SELLER details.
    const buyerRows: { label: string; value: string }[] = [
      { label: 'Seller name', value: sellerName },
    ];
    if (d.seller.phone) {
      buyerRows.push({ label: 'Seller phone', value: d.seller.phone });
    }
    buyerRows.push({ label: 'Seller email', value: d.seller.email });
    const buyerHtml = this.email({
      status: { tone: 'success', label: 'Contact revealed' },
      headline: 'Contact details revealed',
      body: `Hi ${b(buyerName)}, your purchase of ${b(d.listingTitle)} is confirmed and the seller has been paid. To complete the legal transfer, contact the seller and arrange a date + SAPS-licensed dealer between you both. Remember: the dealer paperwork is what transfers ownership legally — don't hand over cash or take possession outside a licensed dealer's premises.`,
      rows: buyerRows,
      cta: { label: 'View order', url: txUrl },
      preheader: `Seller contact details for ${d.listingTitle}`,
    });
    await this.send(
      d.buyer.email,
      'Contact details for your purchase — ' + d.listingTitle,
      buyerHtml,
    );
    await this.sendSms(
      d.buyer.phone,
      `Gun Galore: Contact ${sellerName}${d.seller.phone ? ' on ' + d.seller.phone : ''} to arrange the dealer meet for ${truncate(d.listingTitle, 30)}.`,
      `pa-buyer-${d.transactionId}`,
    );

    // Email to the SELLER — reveals BUYER details + payout note.
    const sellerRows: { label: string; value: string }[] = [
      { label: 'Buyer name', value: buyerName },
    ];
    if (d.buyer.phone) {
      sellerRows.push({ label: 'Buyer phone', value: d.buyer.phone });
    }
    sellerRows.push({ label: 'Buyer email', value: d.buyer.email });
    sellerRows.push({ label: 'Payout', value: formatRand(d.sellerPayout) });
    const sellerHtml = this.email({
      status: { tone: 'success', label: 'Contact revealed' },
      headline: 'Contact details revealed',
      body: `Hi ${b(sellerName)}, ${b(buyerName)} has bought your listing ${b(d.listingTitle)} as a Private Arrangement. Payment of ${b(formatRand(d.sellerPayout))} has been released to your account immediately (no payment-protection hold). Coordinate a SAPS-licensed dealer between you and complete the legal transfer paperwork — don't hand the item over outside a licensed dealer's premises.`,
      rows: sellerRows,
      cta: { label: 'View sale', url: txUrl },
      preheader: `${buyerName} bought ${d.listingTitle} — payment released`,
    });
    await this.send(
      d.seller.email,
      'New sale (Private Arrangement) — ' + d.listingTitle,
      sellerHtml,
    );
    await this.sendSms(
      d.seller.phone,
      `Gun Galore: ${truncate(d.listingTitle, 30)} sold to ${buyerName}${d.buyer.phone ? ' (' + d.buyer.phone + ')' : ''}. Payment released. Arrange the dealer meet.`,
      `pa-seller-${d.transactionId}`,
    );
  }

  // ---------------------------------------------------------------
  // Q&A — buyer asked a product question that needs a seller reply
  // (i.e. neither moderation nor the auto-answer dedup resolved it).
  // Fire-and-forget; never blocks the buyer's submit. SMS keeps the
  // body short so the seller can answer from their phone via the
  // dashboard link.
  // ---------------------------------------------------------------
  async listingQuestionForSeller(d: {
    sellerEmail: string;
    sellerName: string;
    sellerPhone?: string | null;
    listingTitle: string;
    listingId: string;
    question: string;
  }) {
    const url = `${this.appUrl}/dashboard?tab=questions`;
    const html = this.email({
      status: { tone: 'pending', label: 'New question' },
      headline: 'Buyer has a question',
      body: `Hi ${b(d.sellerName)}, someone is asking about your listing ${b(d.listingTitle)}: ${b(d.question)}<br><br>Answer it from your dashboard. Quick replies keep the listing fresh — future buyers will see your answer too.`,
      cta: { label: 'Answer in dashboard', url },
      preheader: `New question on ${d.listingTitle}`,
    });
    await this.send(
      d.sellerEmail,
      'Question on your listing — ' + d.listingTitle,
      html,
    );
    await this.sendSms(
      d.sellerPhone,
      `Gun Galore: New question on ${truncate(d.listingTitle, 30)}. Reply: ${url}`,
      `listing-question-${d.listingId}`,
    );
  }

  // KYC (VerifyNow) — required / approved / rejected
  // ---------------------------------------------------------------
  // Seller's first buyer just kicked off a purchase. Until they verify
  // via VerifyNow, their payout is held. We do NOT block the buyer's
  // checkout — only the seller's payout side is gated.
  async sellerKycRequired(sellerEmail: string, sellerName: string) {
    const url = `${this.appUrl}/kyc/verify`;
    const html = this.email({
      status: { tone: 'pending', label: 'Action needed' },
      headline: 'Verify your identity to release your payout',
      body: `Hi ${b(sellerName)}, congratulations — your first sale is on its way. Before we can release the funds, we need to verify your identity. This is a quick two-step process: first, confirm your SA ID number (we cross-check it against Home Affairs); second, take a quick selfie so we can match it to your ID photo. The whole thing takes about a minute. Your buyer's payment is safely held until you're done.`,
      cta: { label: 'Verify identity now', url },
      preheader: 'Verify your identity to release your payout',
    });
    await this.send(sellerEmail, 'Action needed: verify your identity', html);
  }

  // Verification succeeded — pending payout can now move forward.
  async sellerKycApproved(sellerEmail: string, sellerName: string) {
    const html = this.email({
      status: { tone: 'success', label: 'Verified' },
      headline: 'Identity verified',
      body: `Hi ${b(sellerName)}, your identity has been verified. Your pending sale can now proceed — pack and dispatch as soon as you're ready.`,
      cta: { label: 'Go to dashboard', url: `${this.appUrl}/dashboard` },
      preheader: 'Your identity has been verified',
    });
    await this.send(sellerEmail, 'Identity verified — Gun Galore', html);
  }

  // Face-match failed — link them back so they can retry with better
  // lighting. After 3 fails an admin alert is raised separately.
  async sellerKycRejected(
    sellerEmail: string,
    sellerName: string,
    reason: string,
    attempt: number = 1,
  ) {
    const url = `${this.appUrl}/kyc/verify`;
    const html = this.email({
      status: { tone: 'error', label: 'Not approved' },
      headline: "Identity verification didn't pass",
      body: `Hi ${b(sellerName)}, ${b(reason)}<br><br>Try again from your account — better lighting and a clear, full-face selfie usually does the trick.`,
      cta: { label: 'Try again', url },
      preheader: "Identity verification didn't pass — try again",
    });
    await this.send(sellerEmail, 'Identity verification — try again', html);
  }

  // ---------------------------------------------------------------
  // Public broadcast hooks — the admin broadcast page uses these to
  // send a one-off email or SMS to an arbitrary address. Same
  // fail-open semantics as the private helpers, but exposed so other
  // services (admin comms) can use them without re-implementing the
  // Resend / SMSPortal client wiring.
  // ---------------------------------------------------------------
  async sendBroadcastEmail(to: string, subject: string, html: string) {
    return this.send(to, subject, html);
  }

  async sendBroadcastSms(to: string, message: string, reference: string) {
    return this.sendSms(to, message, reference);
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
      this.logger.error(
        `Email failed → ${to} "${subject}": ${(err as Error).message}`,
      );
    }
  }

  // Wrap SmsService so each shipping-notification call site doesn't
  // have to repeat the null-check + try/catch. Always fails open —
  // SMS hiccups must never block the rest of the order flow. Skips
  // entirely when `to` is missing (user without a phone) so we don't
  // burn SMSPortal credits on no-ops.
  private async sendSms(
    to: string | null | undefined,
    message: string,
    reference: string,
  ) {
    if (!to || to.trim().length === 0) return;
    try {
      await this.sms.sendSms({ to: to.trim(), message, reference });
    } catch (err) {
      this.logger.warn(
        `SMS failed → ${to} (${reference}): ${(err as Error).message}`,
      );
    }
  }
}

// SMS segments are 160 chars (or 70 for GSM-extended). Long listing
// titles eat budget fast — trim with an ellipsis so messages stay in
// one segment per send.
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

// Friendly shipping-method label for emails. The template literal
// rendering elsewhere shows "PUDO_LOCKER" / "DEALER_TRANSFER" which
// looks raw; this turns them into something a buyer recognises.
function prettyShippingMethod(method: string | null | undefined): string {
  if (!method) return 'TBD';
  switch (method) {
    case 'PUDO':
      return 'Pudo Locker';
    case 'TCG':
      return 'Door delivery (The Courier Guy)';
    case 'DEALER_TRANSFER':
      return 'Licensed dealer transfer';
    case 'PRIVATE_ARRANGE':
      return 'Private dealer arrangement';
    default:
      return method.replace(/_/g, ' ').toLowerCase();
  }
}

// Same idea but specifically for the "courier" slot on the
// sale-shipped template — PUDO / TCG are the only realistic values
// once we're at the dispatched stage. Anything else collapses to a
// generic label.
function prettyCourier(method: string | null | undefined): string {
  if (method === 'PUDO') return 'Pudo';
  if (method === 'TCG') return 'The Courier Guy';
  return 'Courier';
}

// Best-effort deep-link into the carrier's own tracking page for a
// dispatched raffle prize. Admin keys in the carrier label freeform,
// so we match a few common synonyms. Returns null when we don't know
// the carrier — caller renders a tracking-ref-only email in that case.
function carrierTrackingUrl(
  label: string | null | undefined,
  ref: string,
): string | null {
  if (!label) return null;
  const normalised = label.trim().toLowerCase();
  const encoded = encodeURIComponent(ref);
  if (normalised.includes('pudo')) {
    return `https://www.pudo.co.za/tracking?waybill=${encoded}`;
  }
  if (
    normalised.includes('courier guy') ||
    normalised === 'tcg' ||
    normalised === 'the courier guy'
  ) {
    return `https://www.thecourierguy.co.za/tracking?ref=${encoded}`;
  }
  if (normalised.includes('aramex')) {
    return `https://www.aramex.co.za/tools/track?l=${encoded}`;
  }
  return null;
}

// Pretty service name for credit-alert emails/SMS. We store the
// service key as a lowercase slug ('smsportal', 'verifynow', etc.) in
// CreditSnapshot.service for stable joins, but the operator should
// see the brand name in their inbox / SMS.
function prettyServiceName(slug: string): string {
  switch (slug) {
    case 'smsportal':
      return 'SMSPortal';
    case 'verifynow':
      return 'VerifyNow';
    case 'cloudinary':
      return 'Cloudinary';
    case 'anthropic':
      return 'Anthropic';
    case 'pudo':
      return 'Pudo';
    default:
      return slug;
  }
}

// Human-readable short date used by templates' "Date" / "Listed on"
// rows. Kept SA-locale so it matches the rest of the UI.
function formatDateShort(d: Date): string {
  return d.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
