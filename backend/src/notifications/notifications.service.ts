import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { FeeModel, NotificationCategory } from '@prisma/client';
import { SmsService } from '../sms/sms.service';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { Saps534Service, Saps534Data } from '../payments/saps534.service';
import { buyerBreakdown, sellerBreakdown } from '../payments/fee-presentation';
import { EMAIL_FROM, SUPPORT_EMAIL } from '../common/brand';

// Compile-time list of the entity types we can link a Notification
// row to. Used by resolveByEntity() callers so typos don't sit silently
// in the codebase. Keep in sync with the linkedType column the migration
// produces.
export type NotificationLinkedType =
  | 'offer'
  | 'transaction'
  | 'bid'
  | 'listing'
  // Bank-account verification rows — linkedId is the USER id. Resolved
  // when the user re-saves bank details or a later verification passes.
  | 'bank'
  // Complaint status/outcome rows — linkedId is the CO-case number (the
  // reference the user actually sees), not the cuid.
  | 'complaint'
  // Licence Centre documents — linkedId is the Credential id. Resolved when
  // the member confirms a renewed date or mutes reminders on that document.
  | 'credential'
  // Licence motivations — linkedId is the Motivation id. Nothing resolves
  // these (the rows are dismissible); the link is carried for the push TAG,
  // so a later outcome on the same document replaces the earlier one.
  | 'motivation';

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
  /** Push even though the row is dismissible — for rare informational
   *  events that still deserve the phone buzz (e.g. prize-draw winner). */
  forcePush?: boolean;
}

// Fails open — emails are fire-and-forget; never block the main flow.

// Single source — see backend/src/common/brand.ts. The 80-odd SMS templates
// below still inline "All Outdoor:" rather than importing SMS_PREFIX: they are
// literal message copy, and threading a constant through every one would add
// churn without making the next rename any safer (the rename is a sweep either
// way). The From header is different — it also carries the sending DOMAIN,
// which changes at the domain migration.
const FROM = EMAIL_FROM;

// Card-refund settlement window, quoted to buyers. ONE constant because the
// same promise was being made in three different ways — emails said "5–10
// business days", SMS said "5-10", parts of the site said "3–7 working days",
// and the published /refund-policy page says 3–7 business days. The policy
// page is the one the buyer can hold us to, so everything matches it.
// (frontend/lib/status-labels.ts carries the UI-side twin, REFUND_ETA_COPY.)
const REFUND_ETA = '3–7 business days';
const REFUND_ETA_SMS = '3-7 business days'; // plain hyphen — GSM-7 safe

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
  <title>All Outdoor</title>
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
            <span style="font-family:Arial,sans-serif;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:0.12em;">ALL OUTDOOR</span>
            <![endif]-->
            <!--[if !mso]><!-->
            <img src="${logoUrl}" alt="All Outdoor" width="180" height="36"
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
              <tr><td align="center"><p style="margin:0;font-size:12px;color:${TOKEN.textTertiary} !important;line-height:1.5;">All Outdoor (Pty) Ltd &middot; South Africa</p></td></tr>
              <tr><td align="center" style="padding-top:6px;"><a href="mailto:${SUPPORT_EMAIL}" style="font-size:12px;color:${TOKEN.red} !important;text-decoration:none;">${SUPPORT_EMAIL}</a></td></tr>
              <tr><td align="center" style="padding-top:10px;"><p style="margin:0;font-size:11px;color:${TOKEN.textTertiary} !important;line-height:1.6;">Transactional email related to your All Outdoor account.</p></td></tr>
              <tr><td align="center" style="padding-top:4px;"><p style="margin:0;font-size:11px;color:${TOKEN.textTertiary} !important;line-height:1.6;">&copy; ${new Date().getFullYear()} All Outdoor. All rights reserved.</p></td></tr>
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
  /**
   * ⚠️ The EFFECTIVE flag — whether the BUYER was charged the gateway fee as
   * a separate line. Meaningless under BUYNOW_MARKUP, where the fee is inside
   * listingPrice; read feeModel first. See payments/fee-presentation.ts.
   */
  passFeeToBuyer: boolean;
  /**
   * Which fee model priced this sale. Without it these columns cannot be
   * described truthfully: the buyer's confirmation double-counted the fee on
   * every marked-up BUY NOW, and the seller's "Sale price − Commission =
   * Your payout" line did not subtract to the payout it printed.
   */
  feeModel: FeeModel;
  /** Carrier rate and our delivery margin — shown to the buyer as ONE figure. */
  shippingCost: number;
  shippingHandlingCents: number;
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
    private readonly saps534: Saps534Service,
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
    // (counter accepted, refund issued) are informational; pushing those
    // would feel spammy. Email and the in-app inbox still cover them.
    //
    // Fire-and-forget: a push failure (VAPID not configured, dead
    // subscription, etc.) must NOT block whatever upstream caller is
    // waiting on persist(). PushService.sendToUser handles its own
    // errors internally — we just don't await the result on the
    // critical path.
    if (!opts.dismissible || opts.forcePush) {
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
    opts: {
      userId?: string;
      resolvedBy?: 'user_action' | 'auto_expired';
      // Restrict the resolve to specific notification `type` values.
      // REQUIRED for the auction-end sweep: an unscoped resolve in the
      // WON case would race with and wrongly clear the winner's freshly
      // persisted `auction_won` row (same linkedType/linkedId).
      types?: string[];
      // Skip a user (e.g. the winner) when resolving loser rows.
      excludeUserId?: string;
    } = {},
  ): Promise<number> {
    try {
      const r = await this.prisma.notification.updateMany({
        where: {
          linkedType,
          linkedId,
          resolvedAt: null,
          ...(opts.userId ? { userId: opts.userId } : {}),
          ...(opts.excludeUserId
            ? { userId: { not: opts.excludeUserId } }
            : {}),
          ...(opts.types ? { type: { in: opts.types } } : {}),
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
    // ?v= is a CACHE BUSTER, not decoration. Cloudflare fronts /public with a
    // 30-day max-age, so replacing email-logo.png in place left the edge — and
    // every mail client that had already cached it — serving the old artwork.
    // Bump this whenever the file is replaced. Mirrors frontend/lib/asset-version.ts.
    const logoUrl =
      process.env.EMAIL_LOGO_URL ??
      // ⚠️ alloutdoor.co.za, NOT gungalore.co.za. This still pointed at the
      // pre-rebrand domain, so every transactional email was fetching its
      // header logo from the retired host — which is a redirect at best and a
      // broken image the day that host stops answering.
      'https://alloutdoor.co.za/email-logo.png?v=20260821';
    return renderEmail(content, logoUrl);
  }

  // ---------------------------------------------------------------
  // Buyer: order confirmed (payment HELD)
  // ---------------------------------------------------------------
  async orderConfirmedBuyer(d: SaleDetails) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    // COLLECTION is an in-person pickup with no dispatch step — it completes
    // when the buyer taps "Confirm collection" (which releases the seller's
    // payment), not via courier delivery. Swap the courier copy out so we
    // don't tell a trailer/caravan buyer to wait for a dispatch SMS that
    // never comes.
    const isCollection = d.shippingMethod === 'COLLECTION';
    // ⚠️ ONE SHARED BUILDER, AND THE ROWS FOOT.
    //
    // This used to print "Listing price", then a "Processing fee" gated on
    // d.passFeeToBuyer, then "Total paid" — with no delivery row at all. On a
    // marked-up BUY NOW the fee is ALREADY inside the listing price, so the
    // email showed the buyer a charge that had not been added, and the rows
    // did not reconcile to the total in either direction.
    const shown = buyerBreakdown(d);
    if (!shown.balances) {
      // Cannot happen for a row the current checkout wrote, and the spec
      // covers the matrix. But an email is the one artefact we cannot recall,
      // so a row that does not foot leaves a trace rather than going out
      // silently. Same guard the receipt carries.
      this.logger.error(
        `orderConfirmedBuyer ${d.transactionId}: rows do not sum to buyerTotal (${shown.total}) — fee model ${d.feeModel}`,
      );
    }
    const rows: { label: string; value: string }[] = [
      { label: 'Reference', value: d.transactionId.slice(-8).toUpperCase() },
      ...shown.lines.map((l) => ({
        label: l.label,
        value: formatRand(l.cents),
      })),
      { label: shown.totalLabel, value: formatRand(shown.total) },
      {
        label: 'Shipping method',
        value: prettyShippingMethod(d.shippingMethod),
      },
    ];
    const html = this.email({
      status: { tone: 'success', label: 'Order confirmed' },
      headline: 'Order confirmed',
      body: isCollection
        ? `Hi ${b(d.buyerName)}, your purchase of ${b(d.listingTitle)} has been confirmed. This is a <b>collection</b> item — the seller's contact details are on your order page. Arrange a pickup, and once you have the item tap <b>Confirm collection</b> (that's what releases the seller's payment).`
        : `Hi ${b(d.buyerName)}, your purchase of ${b(d.listingTitle)} has been confirmed. The seller has been notified and will dispatch your item soon.`,
      rows,
      cta: { label: 'View order', url: txUrl },
      preheader: `Order confirmed — ${d.listingTitle}`,
    });
    await this.send(d.buyerEmail, 'Order confirmed — ' + d.listingTitle, html);
    await this.sendSms(
      d.buyerPhone,
      isCollection
        ? `All Outdoor: Order confirmed for ${truncate(d.listingTitle, 40)}. Total paid ${formatRand(d.buyerTotal)}. Collection item — seller contact is on your order page; tap Confirm collection when you have it.`
        : `All Outdoor: Order confirmed for ${truncate(d.listingTitle, 40)}. Total paid ${formatRand(d.buyerTotal)}. We'll SMS again when it's dispatched.`,
      `order-confirmed-${d.transactionId}`,
    );
  }

  // ---------------------------------------------------------------
  // Buyer: ONE consolidated confirmation for a multi-item cart Order
  // (Phase 8b). The per-line "order confirmed" email/SMS is suppressed for
  // order children, so this fires exactly once for the whole basket.
  // ---------------------------------------------------------------
  async orderConfirmedBuyerMulti(d: {
    buyerEmail: string | null;
    buyerName: string;
    buyerPhone: string | null;
    orderId: string;
    orderReference: string;
    itemCount: number;
    buyerTotal: number;
  }) {
    const orderUrl = `${this.appUrl}/orders/${d.orderId}`;
    const items = `${d.itemCount} item${d.itemCount === 1 ? '' : 's'}`;
    const html = this.email({
      status: { tone: 'success', label: 'Order confirmed' },
      headline: 'Order confirmed',
      body: `Hi ${b(d.buyerName)}, your order of ${b(items)} has been confirmed and the seller has been notified. You can track each item from your order page; we'll SMS you as items are dispatched.`,
      rows: [
        { label: 'Order reference', value: d.orderReference },
        { label: 'Items', value: items },
        { label: 'Total paid', value: formatRand(d.buyerTotal) },
      ],
      cta: { label: 'View order', url: orderUrl },
      preheader: `Order confirmed — ${items}`,
    });
    if (d.buyerEmail) {
      await this.send(d.buyerEmail, 'Order confirmed — ' + items, html);
    }
    await this.sendSms(
      d.buyerPhone,
      `All Outdoor: Order confirmed (${items}). Total paid ${formatRand(d.buyerTotal)}. We'll SMS again as items are dispatched.`,
      `order-confirmed-multi-${d.orderId}`,
    );
  }

  // ---------------------------------------------------------------
  // Seller: new sale received (payment HELD)
  // ---------------------------------------------------------------
  // Mid-window "clock is running" reminder to the seller on an unaccepted
  // paid sale (and the deadline-passed notice at escalation, hoursLeft=0).
  // The ORIGINAL new_sale inbox row is still the unresolved action-required
  // one, so this row is dismissible but force-pushed — the phone buzzes
  // without duplicating the actionable entry.
  async saleAcceptReminderSeller(d: {
    sellerEmail: string;
    sellerName: string;
    sellerPhone?: string | null;
    listingTitle: string;
    transactionId: string;
    /** Whole hours until the accept deadline; 0 = deadline has passed. */
    hoursLeft: number;
    /** One-tap accept/reject link (TRANSACTION_ACCEPT token) when minted. */
    actionUrl?: string;
  }) {
    const overdue = d.hoursLeft <= 0;
    const url = d.actionUrl ?? `${this.appUrl}/transactions/${d.transactionId}`;
    await this.persistByEmail(d.sellerEmail, {
      category: 'SELLER',
      type: overdue ? 'sale_accept_overdue' : 'sale_accept_reminder',
      title: overdue
        ? 'Sale response overdue'
        : `~${d.hoursLeft}h left to accept your sale`,
      body: overdue
        ? `You didn't respond to the sale of ${d.listingTitle} in time — our team is reviewing it. Accept or decline NOW to keep the sale.`
        : `The buyer of ${d.listingTitle} has paid and is waiting. Accept or decline before the deadline or the sale escalates to support.`,
      url: `/transactions/${d.transactionId}`,
      iconKey: 'sold',
      linkedType: 'transaction',
      linkedId: d.transactionId,
      dismissible: true,
      forcePush: true,
    });
    const html = this.email({
      status: { tone: overdue ? 'error' : 'pending', label: overdue ? 'Overdue' : 'Reminder' },
      headline: overdue
        ? 'Your sale needs a response — now'
        : 'Your sale is waiting for you',
      body: overdue
        ? `Hi ${b(d.sellerName)}, the response window for ${b(d.listingTitle)} has passed and the sale has been flagged to our team. Accept or decline immediately — unresponded sales are refunded to the buyer and count against your seller standing.`
        : `Hi ${b(d.sellerName)}, the buyer of ${b(d.listingTitle)} has PAID and is waiting for you to accept. About ${b(String(d.hoursLeft))} hours remain — if the window lapses, the sale escalates to support and may be refunded.`,
      cta: { label: overdue ? 'Respond now' : 'Accept or decline', url },
      preheader: overdue
        ? `Overdue: respond to the sale of ${d.listingTitle}`
        : `~${d.hoursLeft}h left to accept ${d.listingTitle}`,
    });
    await this.send(
      d.sellerEmail,
      overdue
        ? `Overdue: respond to your sale — ${d.listingTitle}`
        : `Reminder: ~${d.hoursLeft}h left to accept — ${d.listingTitle}`,
      html,
    );
    await this.sendSms(
      d.sellerPhone,
      overdue
        ? `All Outdoor: your sale of ${truncate(d.listingTitle, 24)} is OVERDUE for a response. Act now: ${url}`
        : `All Outdoor: ~${d.hoursLeft}h left to accept your sale of ${truncate(d.listingTitle, 24)}. One tap: ${url}`,
      `accept-reminder-${d.transactionId}${overdue ? '-overdue' : ''}`,
    );
  }

  // ---------------------------------------------------------------
  // Offer-expiry reminder to the SELLER (~12h before a PENDING offer
  // lapses). Reuses the OFFER_DECISION action token so the SMS stays
  // one-tap. Dismissible + force-pushed: the original offer_received row
  // is the unresolved action; this just buzzes the phone once.
  // ---------------------------------------------------------------
  async offerExpiryReminderSeller(d: {
    sellerEmail: string;
    sellerName: string;
    sellerPhone?: string | null;
    buyerName: string;
    listingTitle: string;
    listingId: string;
    offerId: string;
    offerAmount: number;
    hoursLeft: number;
    actionUrl?: string;
  }) {
    const url = d.actionUrl ?? `${this.appUrl}/offers/received`;
    await this.persistByEmail(d.sellerEmail, {
      category: 'SELLER',
      type: 'offer_expiry_reminder',
      title: `~${d.hoursLeft}h left to answer an offer`,
      body: `${d.buyerName}'s ${formatRand(d.offerAmount)} offer on ${d.listingTitle} expires soon — accept, counter or decline before it lapses.`,
      url: '/offers/received',
      iconKey: 'offer',
      linkedType: 'offer',
      linkedId: d.offerId,
      dismissible: true,
      forcePush: true,
    });
    const html = this.email({
      status: { tone: 'pending', label: 'Offer expiring' },
      headline: 'An offer is about to expire',
      body: `Hi ${b(d.sellerName)}, ${b(d.buyerName)}'s offer of ${b(formatRand(d.offerAmount))} on ${b(d.listingTitle)} expires in about ${b(String(d.hoursLeft))} hours. Accept, counter, or decline it before then — once it lapses the buyer is told you didn't respond and the sale is lost. A lapse records no strike, but responding keeps the sale.`,
      rows: [
        { label: 'Item', value: d.listingTitle },
        { label: 'Offer amount', value: formatRand(d.offerAmount) },
      ],
      cta: { label: 'Review offer', url },
      preheader: `~${d.hoursLeft}h left to answer ${d.buyerName}'s offer`,
    });
    await this.send(
      d.sellerEmail,
      `Reminder: an offer on ${d.listingTitle} is expiring`,
      html,
    );
    if (d.actionUrl) {
      await this.sendSms(
        d.sellerPhone,
        `All Outdoor: ~${d.hoursLeft}h left to answer R${Math.round(d.offerAmount / 100)} offer on ${truncate(d.listingTitle, 22)}. Decide: ${d.actionUrl}`,
        `offer-reminder-${d.offerId}`,
      );
    }
  }

  // ---------------------------------------------------------------
  // A PENDING offer lapsed unanswered — tell the SELLER they missed a
  // real sale (the buyer already gets offerExpiredBuyer). Informational,
  // dismissible; no strike is recorded for a lapse.
  // ---------------------------------------------------------------
  async offerExpiredSeller(d: {
    sellerEmail: string;
    sellerName: string;
    buyerName?: string;
    listingTitle: string;
    listingId: string;
    offerId: string;
    offerAmount: number;
  }) {
    await this.persistByEmail(d.sellerEmail, {
      category: 'SELLER',
      type: 'offer_expired_seller',
      title: 'You missed an offer',
      body: `${d.buyerName ?? 'A buyer'}'s ${formatRand(d.offerAmount)} offer on ${d.listingTitle} expired before you responded.`,
      url: `/listings/${d.listingId}`,
      iconKey: 'offer',
      linkedType: 'offer',
      linkedId: d.offerId,
      dismissible: true,
    });
    const html = this.email({
      status: { tone: 'pending', label: 'Offer expired' },
      headline: 'An offer expired unanswered',
      body: `Hi ${b(d.sellerName)}, an offer of ${b(formatRand(d.offerAmount))} on ${b(d.listingTitle)} expired because it wasn't answered in time. Your listing is still active — responding faster next time keeps buyers from walking. No strike is recorded for a lapse.`,
      rows: [{ label: 'Item', value: d.listingTitle }],
      cta: {
        label: 'View listing',
        url: `${this.appUrl}/listings/${d.listingId}`,
      },
      preheader: `An offer on ${d.listingTitle} expired`,
    });
    await this.send(d.sellerEmail, `An offer on ${d.listingTitle} expired`, html);
  }

  // ---------------------------------------------------------------
  // Pay-window reminder to the BUYER on an ACCEPTED offer (~6h before the
  // 24h pay window lapses + strikes them). Reuses the CHECKOUT token so the
  // SMS deep-links straight to checkout. Dismissible + force-pushed.
  // ---------------------------------------------------------------
  async offerPayReminderBuyer(d: {
    buyerEmail: string;
    buyerName: string;
    buyerPhone?: string | null;
    listingTitle: string;
    listingId: string;
    offerId: string;
    amount: number;
    hoursLeft: number;
    actionUrl?: string;
  }) {
    const url = d.actionUrl ?? `${this.appUrl}/listings/${d.listingId}`;
    await this.persistByEmail(d.buyerEmail, {
      category: 'BUYER',
      type: 'offer_pay_reminder',
      title: `~${d.hoursLeft}h left to pay`,
      body: `Your offer on ${d.listingTitle} was accepted — pay within about ${d.hoursLeft}h to keep it.`,
      url: `/listings/${d.listingId}`,
      iconKey: 'cart',
      linkedType: 'offer',
      linkedId: d.offerId,
      dismissible: true,
      forcePush: true,
    });
    const html = this.email({
      status: { tone: 'pending', label: 'Payment due' },
      headline: 'Pay for your accepted offer',
      body: `Hi ${b(d.buyerName)}, the seller accepted your offer of ${b(formatRand(d.amount))} on ${b(d.listingTitle)}. About ${b(String(d.hoursLeft))} hours remain to pay — if the window lapses the sale is cancelled and it counts against your buyer standing.`,
      rows: [
        { label: 'Item', value: d.listingTitle },
        { label: 'Agreed price', value: formatRand(d.amount) },
      ],
      cta: { label: 'Pay now', url },
      preheader: `~${d.hoursLeft}h left to pay for ${d.listingTitle}`,
    });
    await this.send(
      d.buyerEmail,
      `Reminder: pay for ${d.listingTitle} before it lapses`,
      html,
    );
    await this.sendSms(
      d.buyerPhone,
      `All Outdoor: ~${d.hoursLeft}h left to pay for ${truncate(d.listingTitle, 26)} (your offer was accepted). Pay: ${url}`,
      `offer-pay-reminder-${d.offerId}`,
    );
  }

  // ---------------------------------------------------------------
  // Pay-window reminder to an AUCTION WINNER (~6h before the 24h pay
  // window lapses → EXPIRED + strike). Reuses a fresh CHECKOUT token so
  // the SMS deep-links to checkout. Dismissible + force-pushed.
  // ---------------------------------------------------------------
  async auctionPayReminderWinner(d: {
    buyerEmail: string;
    buyerName: string;
    buyerPhone?: string | null;
    listingTitle: string;
    listingId: string;
    amount: number;
    hoursLeft: number;
    actionUrl?: string;
  }) {
    const url = d.actionUrl ?? `${this.appUrl}/listings/${d.listingId}`;
    await this.persistByEmail(d.buyerEmail, {
      category: 'BUYER',
      type: 'auction_pay_reminder',
      title: `~${d.hoursLeft}h left to pay for your win`,
      body: `You won ${d.listingTitle} — pay within about ${d.hoursLeft}h to keep it.`,
      url: `/listings/${d.listingId}`,
      iconKey: 'cart',
      linkedType: 'listing',
      linkedId: d.listingId,
      dismissible: true,
      forcePush: true,
    });
    const html = this.email({
      status: { tone: 'pending', label: 'Payment due' },
      headline: 'Pay for your winning bid',
      body: `Hi ${b(d.buyerName)}, you won ${b(d.listingTitle)} with a bid of ${b(formatRand(d.amount))}. About ${b(String(d.hoursLeft))} hours remain to pay — if the window lapses you lose the item and it counts against your bidding standing (three strikes suspends bidding).`,
      rows: [
        { label: 'Item', value: d.listingTitle },
        { label: 'Winning bid', value: formatRand(d.amount) },
      ],
      cta: { label: 'Pay now', url },
      preheader: `~${d.hoursLeft}h left to pay for ${d.listingTitle}`,
    });
    await this.send(
      d.buyerEmail,
      `Reminder: pay for your winning bid — ${d.listingTitle}`,
      html,
    );
    await this.sendSms(
      d.buyerPhone,
      `All Outdoor: ~${d.hoursLeft}h left to pay for ${truncate(d.listingTitle, 26)} (you won it). Pay: ${url}`,
      `auction-pay-reminder-${d.listingId}`,
    );
  }

  async newSaleSeller(d: SaleDetails) {
    // ⚠️ ONE SET OF NUMBERS ACROSS EMAIL, INBOX AND SMS. Hoisted to the top of
    // the method because the inbox row is built long before the email body,
    // and it used to quote d.listingPrice — the BUYER's marked-up price — so
    // a seller's phone said "sold for R511.97" while the email beside it said
    // "Your price R450.00". Same sale, two numbers.
    const sellerRows = sellerBreakdown(d);
    if (!sellerRows.balances) {
      this.logger.error(
        `newSaleSeller ${d.transactionId}: gross − deductions ≠ payout (${sellerRows.net}) — fee model ${d.feeModel}`,
      );
    }
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
        ? `${d.listingTitle} sold — ${formatRand(sellerRows.net)} to you, accept within 48h`
        : `${d.listingTitle} sold — ${formatRand(sellerRows.net)} to you, dispatch within 48h`,
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
    // COLLECTION seller hands the item over in person — no dispatch, no
    // courier. Payment releases when the buyer confirms collection.
    const isCollection = d.shippingMethod === 'COLLECTION';
    // The accept-first framing is added to the lede when we have a
    // token. The dealer-transfer SAPS-534 paragraph still appears
    // below so the seller can prepare while the firearm is still in
    // their safe (the accept step doesn't gate it — they can ready
    // the paperwork in parallel).
    const acceptLede = hasAcceptToken
      ? isCollection
        ? `<p style="margin: 0 0 14px;"><b>First — confirm you can fulfil this sale within 48 hours.</b> Tap the Accept button below to lock the sale in. This item is collected in person — the buyer's contact details are on the sale page, so arrange the handover once you've accepted.</p>`
        : `<p style="margin: 0 0 14px;"><b>First — confirm you can fulfil this sale within 48 hours.</b> Tap the Accept button below to lock the sale in. After accepting you have 5 days to dispatch.</p>`
      : '';
    const bodyText = isDealerTransfer
      ? `${acceptLede}Hi ${b(d.sellerName)}, someone has bought your listing ${b(d.listingTitle)}. Payment is being held safely by All Outdoor. Once you transfer the firearm to the chosen dealer, you'll need to upload 3 photos so we can verify the stock-in before releasing your payout:
<ol style="margin: 12px 0; padding-left: 22px; line-height: 1.7;">
  <li>The completed <b>SAPS 534</b> form (<b>BLOCK LETTERS ONLY</b> — our verification bot can't read cursive)</li>
  <li>The <b>last line</b> of the dealer's stock register (only your entry — no other customers' details)</li>
  <li>The <b>firearm with its serial number visible</b>, next to a slip of paper showing the order reference</li>
</ol>
<p style="margin: 8px 0; font-size: 13px; color: #666;">Ask the dealer to print in BLOCK LETTERS — that lets our automated check pass instantly. Cursive or unclear writing means a 48-hour human review before payout.</p>`
      : isCollection
        ? `${acceptLede}Hi ${b(d.sellerName)}, someone has bought your listing ${b(d.listingTitle)}. Payment is being held safely by All Outdoor. This is a <b>collection</b> sale — the buyer collects in person. Their contact details are on the sale page, so arrange the handover with them. Your payment is released as soon as the buyer confirms collection.`
        : `${acceptLede}Hi ${b(d.sellerName)}, someone has bought your listing ${b(d.listingTitle)}. Payment is being held safely by All Outdoor — pack and dispatch as soon as possible. Once the buyer confirms delivery, payment will be released to you automatically.`;

    const html = this.email({
      status: { tone: 'success', label: 'New sale' },
      headline: hasAcceptToken ? 'New sale — accept within 48h' : 'You have a new sale',
      body: bodyText,
      // ⚠️ THE SUBTRACTION HAS TO BE TRUE.
      //
      // This was hardcoded as "Sale price − Commission = Your payout", which
      // on a marked-up BUY NOW reads R511.97 − R40.50 = R450.00 and simply
      // does not subtract. Under that model nothing is deducted from the
      // seller at all: they asked R450 and they receive R450, because our cut
      // was added to the buyer's price. sellerBreakdown() emits the rows that
      // are actually true for the model this sale ran under.
      rows: [
        { label: 'Reference', value: d.transactionId.slice(-8).toUpperCase() },
        { label: sellerRows.grossLabel, value: formatRand(sellerRows.gross) },
        ...sellerRows.deductions.map((l) => ({
          label: l.label,
          value: '-' + formatRand(l.cents),
        })),
        { label: sellerRows.netLabel, value: formatRand(sellerRows.net) },
        {
          label: 'Shipping method',
          value: prettyShippingMethod(d.shippingMethod),
        },
      ],
      cta: hasAcceptToken
        ? { label: 'Accept this sale', url: acceptUrl }
        : { label: 'View sale', url: txUrl },
      // The model note always rides along: under the markup model a seller
      // seeing no commission row needs to know why, and under the deduct
      // model it says plainly who carried the gateway fee.
      footnote: hasAcceptToken
        ? `One-tap accept — no sign-in needed. Link expires in 48 hours. ${sellerRows.note}`
        : sellerRows.note,
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
        ? `All Outdoor: New sale ${truncate(d.listingTitle, 24)} - R${(d.sellerPayout / 100).toFixed(0)}. Accept within 48h (then 5d to dispatch): ${acceptUrl}`
        : isCollection
          ? `All Outdoor: New sale ${truncate(d.listingTitle, 24)} - R${(d.sellerPayout / 100).toFixed(0)}. Accept within 48h (collection - arrange pickup): ${acceptUrl}`
          : `All Outdoor: New sale ${truncate(d.listingTitle, 28)} - R${(d.sellerPayout / 100).toFixed(0)}. Accept within 48h: ${acceptUrl}`
      : isDealerTransfer
        ? `All Outdoor: New sale ${truncate(d.listingTitle, 30)} - R${(d.sellerPayout / 100).toFixed(0)}. After dealer transfer, upload 3 photos (SAPS 534 BLOCK LETTERS) to release payout. See email.`
        : isCollection
          ? `All Outdoor: New sale! ${truncate(d.listingTitle, 36)} - R${(d.sellerPayout / 100).toFixed(0)}. Collection sale - arrange pickup with the buyer. See email.`
          : `All Outdoor: New sale! ${truncate(d.listingTitle, 40)} - R${(d.sellerPayout / 100).toFixed(0)} payout pending dispatch. Check email for details.`;
    await this.sendSms(
      d.sellerPhone,
      smsBody,
      `new-sale-${d.transactionId}`,
    );
  }

  // ---------------------------------------------------------------
  // Seller: SAP 534 prefilled form for a firearm DEALER_TRANSFER sale
  // (Phase 3). Builds the "Transfer of Firearm Ownership" PDF prefilled
  // with the particulars we already hold (Section C = seller, Section D
  // = firearm), emails it to the seller WITH THE PDF ATTACHED, and drops
  // an action-required inbox row telling them to complete it, get it
  // dealer-stamped, and upload it back.
  //
  // FIRE-AND-FORGET + FULLY NON-THROWING. This sits on the payment path
  // (TransactionsService.markPaid → sendSaleNotifications). A PDF build
  // failure, a Resend hiccup, or a DB blip must NEVER bubble up and
  // break the payment finalisation. Everything is wrapped; the worst
  // case is the seller doesn't get the prefilled PDF and completes a
  // blank one (the dealer-transfer email from newSaleSeller already
  // tells them what's required).
  // ---------------------------------------------------------------
  async sap534ForSeller(d: {
    sellerEmail: string;
    sellerName: string;
    sellerPhone?: string | null;
    listingTitle: string;
    transactionId: string;
    orderReference: string;
    form: Saps534Data;
  }) {
    try {
      const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
      const ref = d.orderReference || d.transactionId.slice(-8).toUpperCase();

      // 1) Build the prefilled PDF. Isolated try/catch so an email still
      //    goes out (sans attachment) if the PDF build fails.
      let pdfBuffer: Buffer | null = null;
      try {
        pdfBuffer = await this.saps534.build(d.form);
      } catch (err) {
        this.logger.error(
          `sap534ForSeller: PDF build failed for tx ${d.transactionId}: ${
            err instanceof Error ? err.message : err
          } — sending email without attachment`,
        );
      }

      // 2) Email — with the PDF attached when we have one. We call
      //    Resend directly here (not the private send() helper) because
      //    send() doesn't support attachments.
      const html = this.email({
        status: { tone: 'pending', label: 'Action needed' },
        headline: 'Complete your SAPS 534 transfer form',
        body: `Hi ${b(d.sellerName)}, your firearm ${b(d.listingTitle)} has sold via licensed-dealer transfer. ${
          pdfBuffer
            ? `We've attached a <strong>SAPS 534 "Transfer of Firearm Ownership"</strong> form, pre-filled with the details we already hold (your particulars and the firearm details).`
            : `Your pre-filled <strong>SAPS 534 "Transfer of Firearm Ownership"</strong> form is ready to download from your order page (tap "View sale & upload" below, then "Download pre-filled SAPS 534").`
        }<br><br>What to do next:
<ol style="margin: 12px 0; padding-left: 22px; line-height: 1.7;">
  <li><b>Check</b> the pre-filled details and complete anything that's blank (in <b>BLOCK LETTERS</b>).</li>
  <li><b>Sign</b> the form and take it to your SAPS-licensed dealer to be completed and stamped when you hand over the firearm.</li>
  <li><b>Upload</b> a clear photo of the completed, stamped form back to All Outdoor so we can verify the stock-in and release your payment.</li>
</ol>
<p style="margin: 8px 0; font-size: 13px; color: #666;">Pre-filled fields are a convenience only — please double-check every value against your licence before signing. Sections for the police and the dealer have been left blank on purpose.</p>`,
        rows: [
          { label: 'Reference', value: ref },
          { label: 'Item', value: d.listingTitle },
        ],
        cta: { label: 'View sale & upload', url: txUrl },
        preheader: `Complete your SAPS 534 form for ${d.listingTitle}`,
      });

      if (this.resend) {
        try {
          const filename = `SAP534-${ref}.pdf`;
          await this.resend.emails.send({
            from: FROM,
            to: d.sellerEmail,
            subject: 'Action needed: complete your SAPS 534 form — ' + d.listingTitle,
            html,
            ...(pdfBuffer
              ? {
                  attachments: [
                    {
                      filename,
                      content: pdfBuffer.toString('base64'),
                    },
                  ],
                }
              : {}),
          });
          this.logger.debug(
            `SAPS 534 email sent → ${d.sellerEmail} (tx ${d.transactionId}, attachment=${Boolean(pdfBuffer)})`,
          );
        } catch (err) {
          this.logger.error(
            `sap534ForSeller: Resend send failed for tx ${d.transactionId}: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      }

      // 3) In-app inbox: action-required, NOT dismissible — the seller
      //    must upload the completed form. Linked to the transaction so
      //    the dealer-verification approval clears it via resolveByEntity.
      await this.persistByEmail(d.sellerEmail, {
        category: 'SELLER',
        type: 'sap534_required',
        title: 'Complete your SAPS 534 form',
        body: `${d.listingTitle} — we've emailed a pre-filled SAPS 534. Complete it, get it dealer-stamped, and upload it back to release your payment.`,
        url: `/transactions/${d.transactionId}`,
        iconKey: 'dispatch',
        linkedType: 'transaction',
        linkedId: d.transactionId,
        dismissible: false,
      });
    } catch (err) {
      // Outermost guard — nothing in this method may ever throw into
      // the caller (markPaid is on the money path).
      this.logger.error(
        `sap534ForSeller failed for tx ${d.transactionId}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  // ---------------------------------------------------------------
  // Buyer: seller accepted the sale (TOK-7 Phase 2)
  // ---------------------------------------------------------------
  // Closes the "Awaiting seller accept" loop on the buyer side. The
  // seller has now committed; dispatch SLA is now ticking. Buyer
  // inbox row is informational (dismissible) — the next action-required
  // event for them is "order dispatched, please confirm delivery".
  async saleAcceptedBuyer(d: {
    buyerEmail: string;
    buyerName: string;
    buyerPhone?: string | null;
    listingTitle: string;
    transactionId: string;
    dispatchDeadlineAt: Date;
    // COLLECTION accepts have no dispatch/tracking step — the buyer arranges
    // an in-person pickup and confirms collection to release the payment.
    isCollection?: boolean;
    // DD-F (deal JIT fulfilment): a house-deal sale has no 5-day seller
    // dispatch promise — GG ships JIT from the supplier — so the buyer
    // hears the deal's own ships-in window (X–Y days) instead of "dispatch
    // within 5 days". Present together only for deal sales; non-deal callers
    // omit both and keep the exact original copy across every channel.
    shipsInDaysMin?: number;
    shipsInDaysMax?: number;
  }) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    // Non-null only for deal sales (both forwarded together). Drives the
    // "ships in X–Y days" copy branch below.
    const shipsWindow =
      d.shipsInDaysMin != null && d.shipsInDaysMax != null
        ? `${d.shipsInDaysMin}–${d.shipsInDaysMax}`
        : null;
    await this.persistByEmail(d.buyerEmail, {
      category: 'BUYER',
      type: 'sale_accepted',
      title: 'Seller accepted your order',
      body: d.isCollection
        ? `${d.listingTitle} — arrange collection with the seller`
        : shipsWindow
          ? `${d.listingTitle} — ships in ${shipsWindow} days`
          : `${d.listingTitle} — dispatch within 5 days`,
      url: `/transactions/${d.transactionId}`,
      iconKey: 'transaction',
      linkedType: 'transaction',
      linkedId: d.transactionId,
      dismissible: true,
    });
    const deadline = d.dispatchDeadlineAt.toLocaleDateString('en-ZA', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    const html = this.email({
      status: { tone: 'success', label: 'Accepted' },
      headline: 'Seller accepted your order',
      body: d.isCollection
        ? `Hi ${b(d.buyerName)}, the seller has accepted your order for ${b(d.listingTitle)}. This is a <strong>collection</strong> item — the seller's contact details are on your order page. Arrange a pickup, and tap <strong>Confirm collection</strong> once you have the item (that releases the seller's payment).`
        : shipsWindow
          ? `Hi ${b(d.buyerName)}, your order for ${b(d.listingTitle)} is confirmed. It ships in <strong>${shipsWindow} days</strong> — we'll SMS you the tracking reference as soon as it's on its way.`
          : `Hi ${b(d.buyerName)}, the seller has accepted your order for ${b(d.listingTitle)} and has up to <strong>5 days</strong> to dispatch (by ${b(deadline)}). We'll SMS you the tracking reference as soon as it's on its way.`,
      cta: { label: 'View order', url: txUrl },
      preheader: `Seller accepted — ${d.listingTitle}`,
    });
    await this.send(d.buyerEmail, 'Order accepted: ' + d.listingTitle, html);
    await this.sendSms(
      d.buyerPhone,
      d.isCollection
        ? `All Outdoor: Seller accepted ${truncate(d.listingTitle, 40)}. Collection item — arrange pickup (seller contact is on your order page) and tap Confirm collection.`
        : shipsWindow
          ? `All Outdoor: Order confirmed ${truncate(d.listingTitle, 40)}. Ships in ${shipsWindow} days — we'll SMS the tracking ref when it's on its way.`
          : `All Outdoor: Seller accepted ${truncate(d.listingTitle, 40)}. Dispatch within 5 days — we'll SMS the tracking ref when it ships.`,
      `sale-accepted-${d.transactionId}`,
    );
  }

  // ---------------------------------------------------------------
  // Buyer: seller REJECTED the sale, refund issued (TOK-7 Phase 2)
  // ---------------------------------------------------------------
  // The seller declined to fulfil — refund has already been fired via
  // Peach by TransactionsService.rejectTransaction before this method
  // runs, so we just need to inform the buyer. Reason is surfaced so
  // they understand WHY (sold elsewhere, can't ship, etc.).
  async saleRejectedBuyer(d: {
    buyerEmail: string;
    buyerName: string;
    buyerPhone?: string | null;
    listingTitle: string;
    listingId: string;
    transactionId: string;
    buyerTotal: number;
    reason: string;
    // FLOW-F2 — rail-aware refund copy (P0.4 refundIssuedBuyer pattern). On
    // the live manual-EFT rail there is no card: the refund is paid by EFT
    // from the daily FNB batch, and it CANNOT be paid at all until the buyer
    // has bank details on file — in which case we must say so and link the
    // form, not promise a card reversal that will never happen.
    manualEft?: boolean;
    needsBankDetails?: boolean;
  }) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    await this.persistByEmail(d.buyerEmail, {
      category: 'BUYER',
      type: 'sale_rejected',
      title: d.needsBankDetails
        ? 'Sale cancelled — add your bank details for the refund'
        : 'Sale cancelled — refund issued',
      body: d.needsBankDetails
        ? `${d.listingTitle} — add your bank details so we can EFT your ${formatRand(d.buyerTotal)} refund`
        : `${d.listingTitle} — ${formatRand(d.buyerTotal)} refunded`,
      url: d.needsBankDetails ? '/profile/edit' : `/transactions/${d.transactionId}`,
      iconKey: 'transaction',
      linkedType: 'transaction',
      linkedId: d.transactionId,
      dismissible: !d.needsBankDetails,
    });
    const refundBody = d.needsBankDetails
      ? `A full refund of ${b(formatRand(d.buyerTotal))} has been approved — but we don't have your bank details yet, so we can't pay it out. Add your bank account under Profile → Banking details and the refund goes into the next daily payment run.`
      : d.manualEft
        ? `A full refund of ${b(formatRand(d.buyerTotal))} will be paid by EFT to your bank account in the next daily payment run — allow 1–3 business days.`
        : `A full refund of ${b(formatRand(d.buyerTotal))} has been issued back to your card — allow ${REFUND_ETA} for it to reflect.`;
    const html = this.email({
      status: { tone: 'error', label: 'Cancelled' },
      headline: d.needsBankDetails
        ? 'Sale cancelled — we need your bank details to refund you'
        : 'Sale cancelled — refund issued',
      body: `Hi ${b(d.buyerName)}, the seller couldn't fulfil your order for ${b(d.listingTitle)}. ${refundBody}<br><br>Seller's reason: ${b(d.reason)}<br><br>The listing has been re-activated so other buyers can grab it, but you may want to look for an alternative.`,
      rows: [
        { label: 'Reference', value: d.transactionId.slice(-8).toUpperCase() },
        { label: 'Refund amount', value: formatRand(d.buyerTotal) },
        {
          label: 'Refund destination',
          value: d.manualEft ? 'Your bank account (EFT)' : 'Original payment card',
        },
      ],
      cta: d.needsBankDetails
        ? { label: 'Add bank details', url: `${this.appUrl}/profile/edit` }
        : { label: 'View order', url: txUrl },
      preheader: d.needsBankDetails
        ? 'Action needed — add bank details for your refund'
        : `Refund of ${formatRand(d.buyerTotal)} issued`,
    });
    await this.send(
      d.buyerEmail,
      (d.needsBankDetails ? 'Action needed — refund for: ' : 'Sale cancelled & refunded: ') +
        d.listingTitle,
      html,
    );
    await this.sendSms(
      d.buyerPhone,
      d.needsBankDetails
        ? `All Outdoor: Seller cancelled ${truncate(d.listingTitle, 30)}. Add your bank details at gungalore.co.za/profile/edit so we can EFT your R${(d.buyerTotal / 100).toFixed(0)} refund.`
        : `All Outdoor: Seller cancelled ${truncate(d.listingTitle, 30)}. R${(d.buyerTotal / 100).toFixed(0)} refund on the way (${d.manualEft ? '1-3 business days' : REFUND_ETA_SMS}).`,
      `sale-rejected-${d.transactionId}`,
    );
  }

  // ---------------------------------------------------------------
  // Admin: a sale has stalled past the 48h accept window (TOK-7 Phase 2)
  // ---------------------------------------------------------------
  // Fires from TransactionsService.escalateStaleAccepts cron sweep when
  // a sale's acceptDeadlineAt has passed without seller action. Goes to
  // every admin user via the broadcast pattern.
  //
  // Inbox row only — we don't email/SMS the admins for each stalled sale
  // (would be too noisy). The stalled-queue page on /admin/command-center
  // is the canonical surface; this notification just brings it to their
  // attention next time they open the inbox.
  async saleAcceptEscalatedAdmin(d: {
    transactionId: string;
    listingTitle: string;
    sellerName: string;
  }) {
    try {
      // AdminUser is a separate model from User — admins have a clerkId
      // that we need to map back to a User row for the inbox to find
      // them. The persistByEmail wrapper already does this lookup.
      const admins = await this.prisma.adminUser.findMany({
        where: { isActive: true },
        select: { email: true },
      });
      for (const admin of admins) {
        await this.persistByEmail(admin.email, {
          // ACCOUNT is the "admin messages" category per schema.prisma
          // — closest match for an internal-ops escalation row.
          category: 'ACCOUNT',
          type: 'sale_accept_escalated',
          title: 'Sale stalled — seller hasn’t accepted',
          body: `${d.sellerName} — "${d.listingTitle}" (48h elapsed)`,
          url: `/admin/transactions/${d.transactionId}`,
          iconKey: 'transaction',
          linkedType: 'transaction',
          linkedId: d.transactionId,
          dismissible: false,
        });
      }
    } catch (err) {
      this.logger.error(
        `saleAcceptEscalatedAdmin failed for tx ${d.transactionId}: ${err instanceof Error ? err.message : err}`,
      );
    }
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
      `All Outdoor: Dealer stock-in approved for ${truncate(d.listingTitle, 30)}. Payout R${(d.sellerPayout / 100).toFixed(0)} on the way (2-3 days).`,
      `dv-approved-${d.transactionId}`,
    );
  }

  // ---------------------------------------------------------------
  // Buyer: firearm stocked at dealer — All Outdoor's job is done.
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
      body: `Hi ${b(d.buyerName)}, the seller (${b(d.sellerName)}) has dropped ${b(d.listingTitle)} with their SAPS-licensed dealer and we've verified the SAPS 534 + stock-register paperwork. The firearm is now legally in the dealer's stock register at the address below. We've released the funds to the seller — All Outdoor's part of this transaction is done. From here, please liaise with the seller directly to arrange the inter-dealer transfer to your own dealer (or your preferred collection method).`,
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
      `All Outdoor: Your ${truncate(d.listingTitle, 25)} is booked into stock at ${truncate(d.dealerName, 30)} (${d.dealerPhone}). Contact the seller to arrange your transfer.`,
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
      `All Outdoor: Dealer photos rejected for ${truncate(d.listingTitle, 28)}. Most common cause: SAPS 534 not in BLOCK LETTERS. Reshoot needed.`,
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
      `All Outdoor: ${truncate(d.listingTitle, 30)} dispatched.${d.trackingReference ? ' Ref: ' + d.trackingReference + '.' : ''} Track: ${txUrl}`,
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
      `All Outdoor: Payout of R${(d.sellerPayout / 100).toFixed(0)} for ${truncate(d.listingTitle, 40)} is on the way. Allow 2-3 business days.`,
      `payout-${d.transactionId}`,
    );
  }

  // ---------------------------------------------------------------
  // Seller: shipment booked by the platform (P5.2)
  // ---------------------------------------------------------------
  // Fires when the seller accepts a courier sale and we've booked the
  // carrier. Carries everything the seller needs to hand the parcel over:
  // the waybill, the Pudo drop-off PIN (lockers only), a link to print the
  // label, and the explicit "can't print? write the waybill on the parcel"
  // fallback. SMS + email + action-required inbox row.
  async shipmentBooked(d: {
    sellerEmail: string;
    sellerName: string;
    sellerPhone?: string | null;
    listingTitle: string;
    transactionId: string;
    carrier: 'PUDO' | 'TCG';
    /**
     * WHICH carrier actually holds the parcel.
     *
     * `carrier` above is only the SLOT (PUDO = pickup-point, TCG = door) and
     * on the Bob Go rail it no longer names the company or, more importantly,
     * describes what the SELLER has to do. Absent on legacy rows, which is
     * read as "derive from the slot" exactly as before.
     */
    provider?: 'PUDO' | 'TCG' | 'BOBGO' | null;
    trackingReference: string;
    dropoffPin?: string | null;
    // DD-F (deal JIT fulfilment): present only for house-deal sales. When
    // set, the shipment is a courier COLLECTION from the supplier (TCG
    // door-to-door), not a seller drop-off, so the seller-facing copy is
    // switched to collection-voiced wording. The recipient is unchanged —
    // the house-seller phone/email resolves to the operator at deploy.
    // Non-deal callers omit it and keep the exact original copy.
    dealSupplierName?: string;
  }) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    // THE SELLER'S JOB IS DECIDED BY THE PROVIDER, NOT THE SLOT.
    //
    // On the legacy rail the slot WAS the seller's job: PUDO meant they walked
    // a parcel to a locker, TCG meant a courier came to them. Bob Go collects
    // from an address either way — verified against a real shipment, which
    // carried collection_location_type "door" and an 08:00-17:00 collection
    // window even for a booking delivering to a Bob Box, and exposes no
    // collection-side pickup-point field at all.
    //
    // So under Bob Go a "PUDO" sale must NOT tell the seller to drop at a
    // locker. They would make a wasted trip and then miss the courier who is
    // actually coming to their door.
    const isBobGo = d.provider === 'BOBGO';
    const isPudo = !isBobGo && d.carrier === 'PUDO';
    // Truthy only for deal sales; also narrows to `string` inside each
    // `supplier ? … : …` branch below (no non-null assertions needed).
    const supplier = d.dealSupplierName;
    const courier = isBobGo
      ? 'Bob Go'
      : isPudo
        ? 'Pudo (locker-to-locker)'
        : 'The Courier Guy (door-to-door)';
    const handover = isBobGo
      ? 'A courier will collect the parcel from your pickup address between 08:00 and 17:00 — have it packed and ready.'
      : isPudo
        ? 'Drop your parcel at any Pudo locker using the drop-off PIN below.'
        : 'The Courier Guy will collect the parcel from your pickup address.';

    await this.persistByEmail(d.sellerEmail, {
      category: 'SELLER',
      type: 'shipment_booked',
      title: supplier ? 'Deal collection booked' : 'Ship your sale',
      body: supplier
        ? `Collection booked from ${supplier} — ${courier} will collect. Waybill ${d.trackingReference}.`
        : `${d.listingTitle} — waybill ${d.trackingReference}${d.dropoffPin ? `, PIN ${d.dropoffPin}` : ''}`,
      url: `/transactions/${d.transactionId}`,
      iconKey: 'dispatch',
      linkedType: 'transaction',
      linkedId: d.transactionId,
      dismissible: false,
    });

    const rows: { label: string; value: string }[] = [
      { label: 'Courier', value: courier },
      { label: 'Waybill / tracking', value: d.trackingReference },
    ];
    if (d.dropoffPin) {
      // Only Pudo's PIN is a DROP-OFF PIN. Whether Bob Go issues one at all is
      // still unproven, so the label stays neutral rather than instructing a
      // seller to use it at a locker screen they are not going to.
      rows.push({
        label: isPudo ? 'Pudo drop-off PIN' : 'Collection PIN',
        value: d.dropoffPin,
      });
    }

    const html = this.email({
      status: { tone: 'success', label: supplier ? 'Collection booked' : 'Ready to ship' },
      headline: supplier ? 'Deal collection booked' : 'Your sale is booked — ship it now',
      body: supplier
        ? `Hi ${b(d.sellerName)}, a courier collection has been booked from ${b(supplier)} for ${b(d.listingTitle)}. ${courier} will collect the parcel — there's nothing to drop off on your side.` +
          `<br><br>Waybill number ${b(d.trackingReference)}. Open the sale to print the label if the collection needs it.`
        : `Hi ${b(d.sellerName)}, great news — ${b(d.listingTitle)} is paid and we've booked the courier for you. ${handover}` +
          `<br><br>Open your sale to <b>print the waybill</b> and tape it to the parcel. ` +
          `<b>If you can't print it, write the waybill number ${b(d.trackingReference)} clearly on the package</b> so the courier can match it.` +
          (d.dropoffPin
            ? isPudo
              ? `<br><br>Your locker drop-off PIN is ${b(d.dropoffPin)} — you'll need it at the locker screen.`
              : `<br><br>Your collection PIN is ${b(d.dropoffPin)} — give it to the courier.`
            : ''),
      rows,
      cta: { label: 'Print waybill & view details', url: txUrl },
      preheader: `${d.listingTitle} is booked — waybill ${d.trackingReference}`,
    });
    await this.send(
      d.sellerEmail,
      (supplier ? 'Collection booked — ' : 'Ready to ship — ') + d.listingTitle,
      html,
    );

    const smsHandover = isBobGo
      ? `Courier collects from your address 08:00-17:00${d.dropoffPin ? `, PIN ${d.dropoffPin}` : ''}.`
      : isPudo
        ? `Drop at any Pudo locker${d.dropoffPin ? `, PIN ${d.dropoffPin}` : ''}.`
        : 'Courier Guy will collect.';
    await this.sendSms(
      d.sellerPhone,
      supplier
        ? `All Outdoor: Collection booked from ${supplier} — ${courier} will collect. Waybill ${d.trackingReference}.`
        : `All Outdoor: ${truncate(d.listingTitle, 26)} sold! ${smsHandover} Waybill ${d.trackingReference}. Print label or write it on the parcel: ${txUrl}`,
      `booked-${d.transactionId}`,
      // Waybill + Pudo PIN are delivery-essential — without them the
      // parcel physically can't be handed over. Bypasses the SMS mute.
      { critical: true },
    );
  }

  // ---------------------------------------------------------------
  // Seller: parcel collected by the courier (P5.2)
  // ---------------------------------------------------------------
  async sellerParcelCollected(d: {
    sellerEmail: string;
    sellerName: string;
    sellerPhone?: string | null;
    listingTitle: string;
    transactionId: string;
  }) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    await this.persistByEmail(d.sellerEmail, {
      category: 'SELLER',
      type: 'shipment_collected',
      title: 'Parcel collected',
      body: `The courier has collected ${d.listingTitle}.`,
      url: `/transactions/${d.transactionId}`,
      iconKey: 'dispatch',
      linkedType: 'transaction',
      linkedId: d.transactionId,
      dismissible: true,
    });
    const html = this.email({
      status: { tone: 'success', label: 'Collected' },
      headline: 'Your parcel was collected',
      body: `Hi ${b(d.sellerName)}, the courier has collected ${b(d.listingTitle)}. We'll let you know the moment it's delivered to the buyer.`,
      cta: { label: 'View sale', url: txUrl },
      preheader: `${d.listingTitle} was collected by the courier`,
    });
    await this.send(d.sellerEmail, 'Collected — ' + d.listingTitle, html);
    await this.sendSms(
      d.sellerPhone,
      `All Outdoor: ${truncate(d.listingTitle, 40)} was collected by the courier. We'll notify you on delivery.`,
      `seller-collected-${d.transactionId}`,
    );
  }

  // ---------------------------------------------------------------
  // Seller: parcel delivered to the buyer (P5.2)
  // ---------------------------------------------------------------
  async sellerParcelDelivered(d: {
    sellerEmail: string;
    sellerName: string;
    sellerPhone?: string | null;
    listingTitle: string;
    transactionId: string;
  }) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    await this.persistByEmail(d.sellerEmail, {
      category: 'SELLER',
      type: 'shipment_delivered_seller',
      title: 'Delivered to buyer',
      body: `${d.listingTitle} was delivered. Payout follows once the buyer confirms.`,
      url: `/transactions/${d.transactionId}`,
      iconKey: 'transaction',
      linkedType: 'transaction',
      linkedId: d.transactionId,
      dismissible: true,
    });
    const html = this.email({
      status: { tone: 'success', label: 'Delivered' },
      headline: 'Delivered to the buyer',
      // NO auto-release exists (operator policy) — the real backstop is the
      // stuck-held-funds admin follow-up. Never promise a 7-day release.
      body: `Hi ${b(d.sellerName)}, ${b(d.listingTitle)} was delivered to the buyer. Your payment will be released once the buyer confirms receipt — if they don't confirm within a few days, our team follows up.`,
      cta: { label: 'View sale', url: txUrl },
      preheader: `${d.listingTitle} was delivered to the buyer`,
    });
    await this.send(d.sellerEmail, 'Delivered — ' + d.listingTitle, html);
    await this.sendSms(
      d.sellerPhone,
      `All Outdoor: ${truncate(d.listingTitle, 38)} was delivered to the buyer. Payout follows once confirmed.`,
      `seller-delivered-${d.transactionId}`,
    );
  }

  // ---------------------------------------------------------------
  // Seller: automatic shipment booking failed (P5.2)
  // ---------------------------------------------------------------
  // Sent when the platform couldn't auto-book the courier (carrier down,
  // bad address, etc). The seller can still ship — they just arrange it
  // manually and enter the tracking number on the order page.
  async shipmentBookingFailed(d: {
    sellerEmail: string;
    sellerName: string;
    sellerPhone?: string | null;
    listingTitle: string;
    transactionId: string;
  }) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    await this.persistByEmail(d.sellerEmail, {
      category: 'SELLER',
      type: 'shipment_booking_failed',
      title: 'Action needed: arrange dispatch',
      body: `We couldn't auto-book the courier for ${d.listingTitle}. Book it yourself and enter the tracking number.`,
      url: `/transactions/${d.transactionId}`,
      iconKey: 'dispatch',
      linkedType: 'transaction',
      linkedId: d.transactionId,
      dismissible: false,
    });
    const html = this.email({
      status: { tone: 'pending', label: 'Action needed' },
      headline: 'Please arrange dispatch yourself',
      body: `Hi ${b(d.sellerName)}, we couldn't automatically book the courier for ${b(d.listingTitle)} this time. Please book the shipment with your courier as usual, then open your sale and enter the tracking number so the buyer can follow it.`,
      cta: { label: 'Open sale & add tracking', url: txUrl },
      preheader: `Arrange dispatch for ${d.listingTitle}`,
    });
    await this.send(d.sellerEmail, 'Action needed — arrange dispatch for ' + d.listingTitle, html);
    await this.sendSms(
      d.sellerPhone,
      `All Outdoor: We couldn't auto-book the courier for ${truncate(d.listingTitle, 30)}. Please arrange dispatch + add the tracking number: ${txUrl}`,
      `booking-failed-${d.transactionId}`,
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
    // P0.4 — manual rail: the refund is paid by EFT in the next payout
    // run, and if the buyer has never given banking details we must ASK
    // for them or the batch silently skips the row forever.
    manualEft?: boolean;
    needsBankDetails?: boolean;
  }) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    const bankUrl = `${this.appUrl}/profile/edit`;
    // In-app inbox. When bank details are missing this is ACTION-REQUIRED,
    // not informational — the refund cannot be paid until they add them.
    await this.persistByEmail(d.buyerEmail, {
      category: 'BUYER',
      type: 'refund_issued',
      title: d.needsBankDetails ? 'Refund approved — add your bank details' : 'Refund issued',
      body: d.needsBankDetails
        ? `${formatRand(d.buyerTotal)} refund approved for ${d.listingTitle}. Add your banking details so we can pay it by EFT.`
        : `${formatRand(d.buyerTotal)} refunded for ${d.listingTitle}. Allow ${d.manualEft ? '1–3 business days' : REFUND_ETA}.`,
      url: d.needsBankDetails ? '/profile/edit' : `/transactions/${d.transactionId}`,
      iconKey: 'transaction',
      linkedType: 'transaction',
      linkedId: d.transactionId,
      dismissible: !d.needsBankDetails,
    });
    const body = d.needsBankDetails
      ? `Hi ${b(d.buyerName)}, a refund of ${b(formatRand(d.buyerTotal))} for ${b(d.listingTitle)} has been approved. We pay refunds by EFT into your bank account, and we don't have your banking details yet — please add them under Profile → Edit so the refund can be paid in the next payout run.` +
        (d.note ? `<br><br>Note from admin: ${b(d.note)}` : '')
      : `Hi ${b(d.buyerName)}, a refund of ${b(formatRand(d.buyerTotal))} for ${b(d.listingTitle)} has been issued. Please allow ${d.manualEft ? '1–3 business days' : REFUND_ETA} for it to appear on your statement.` +
        (d.note ? `<br><br>Note from admin: ${b(d.note)}` : '');
    const html = this.email({
      status: d.needsBankDetails
        ? { tone: 'pending', label: 'Action needed' }
        : { tone: 'success', label: 'Refunded' },
      headline: d.needsBankDetails ? 'Refund approved — we need your bank details' : 'Refund issued',
      body,
      rows: [
        { label: 'Reference', value: d.transactionId.slice(-8).toUpperCase() },
        { label: 'Amount', value: formatRand(d.buyerTotal) },
        {
          label: 'Refund destination',
          value: d.manualEft ? 'Your bank account (EFT)' : 'Original payment card',
        },
      ],
      cta: d.needsBankDetails
        ? { label: 'Add banking details', url: bankUrl }
        : { label: 'View order', url: txUrl },
      preheader: d.needsBankDetails
        ? `Add bank details to receive your ${formatRand(d.buyerTotal)} refund`
        : `Refund of ${formatRand(d.buyerTotal)} issued`,
    });
    await this.send(
      d.buyerEmail,
      (d.needsBankDetails ? 'Action needed: refund — ' : 'Refund issued — ') + d.listingTitle,
      html,
    );
    // Refunds are financial events — per CLAUDE.md every notifiable
    // event fires BOTH SMS + email. Skips silently if buyerPhone is
    // null (legacy buyer rows from before the phone-capture flow).
    if (d.buyerPhone) {
      await this.sendSms(
        d.buyerPhone,
        d.needsBankDetails
          ? `All Outdoor: R${(d.buyerTotal / 100).toFixed(0)} refund approved for ${truncate(d.listingTitle, 30)}. Add your bank details on your profile so we can pay it: ${this.appUrl}/profile/edit`
          : `All Outdoor: Refund of R${(d.buyerTotal / 100).toFixed(0)} for ${truncate(d.listingTitle, 40)} issued. Allow ${d.manualEft ? '1-3 business days' : REFUND_ETA_SMS}.`,
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
      body: `Hi ${b(d.sellerName)}, an admin has removed your listing ${b(d.listingTitle)} from the marketplace. Reason: ${b(d.reason)}<br><br>If you believe this was a mistake, reply to this email or contact ${SUPPORT_EMAIL} and an admin will review the takedown. The listing will not return automatically.`,
      cta: { label: 'Open my listings', url: myListingsUrl },
      preheader: `${d.listingTitle} was removed by an admin`,
    });
    await this.send(d.sellerEmail, 'Listing removed: ' + d.listingTitle, html);
  }

  // Firearm licence expiry — seller-facing. kind 'warn' fires once when a
  // licence enters the 31–90-day window; kind 'delisted' fires when the
  // licence reaches ≤30 days and the daily cron auto-removes the listing.
  async firearmLicenceExpiry(d: {
    sellerEmail: string;
    sellerName: string;
    listingTitle: string;
    listingId: string;
    kind: 'warn' | 'delisted';
    daysLeft?: number;
  }) {
    const myListingsUrl = `${this.appUrl}/my/listings`;
    const listingUrl = `${this.appUrl}/listings/${d.listingId}`;
    if (d.kind === 'warn') {
      await this.persistByEmail(d.sellerEmail, {
        category: 'SELLER',
        type: 'firearm_licence_expiring',
        title: 'Firearm licence expiring soon',
        body: `${d.listingTitle} — your licence expires in ${d.daysLeft} days. Renew before it is within 30 days of expiry or the listing will be delisted.`,
        url: `/listings/${d.listingId}`,
        iconKey: 'sold',
        linkedType: 'listing',
        linkedId: d.listingId,
        dismissible: true,
      });
      const html = this.email({
        status: { tone: 'pending', label: 'Action needed' },
        headline: 'Your firearm licence is expiring',
        body: `Hi ${b(d.sellerName)}, the licence for your listing ${b(d.listingTitle)} expires in ${b(String(d.daysLeft))} days. The listing is still live, but once the licence is within 30 days of expiry we will automatically delist it. Renew your licence to keep it listed.`,
        cta: { label: 'View listing', url: listingUrl },
        preheader: `${d.listingTitle}: firearm licence expiring soon`,
      });
      await this.send(
        d.sellerEmail,
        'Firearm licence expiring soon: ' + d.listingTitle,
        html,
      );
      return;
    }
    await this.persistByEmail(d.sellerEmail, {
      category: 'SELLER',
      type: 'firearm_listing_delisted',
      title: 'Firearm listing delisted',
      body: `${d.listingTitle} was delisted because its licence is within 30 days of expiry. Renew the licence, then relist.`,
      url: '/my/listings',
      iconKey: 'sold',
      linkedType: 'listing',
      linkedId: d.listingId,
      dismissible: false,
    });
    const html = this.email({
      status: { tone: 'error', label: 'Delisted' },
      headline: 'Firearm listing delisted',
      body: `Hi ${b(d.sellerName)}, your listing ${b(d.listingTitle)} has been delisted because its firearm licence is now within 30 days of expiry. Renew your licence, then relist the firearm.`,
      cta: { label: 'Open my listings', url: myListingsUrl },
      preheader: `${d.listingTitle} was delisted (licence expiry)`,
    });
    await this.send(
      d.sellerEmail,
      'Firearm listing delisted: ' + d.listingTitle,
      html,
    );
  }

  // ---------------------------------------------------------------
  // Stale-listing lifecycle (non-firearm listings, which have no licence
  // expiry to delist them). Two kinds:
  //   'nudge'   — 75 days old: "is this still for sale?" one-shot.
  //   'expired' — 90 days old: flipped to EXPIRED, one-tap relist.
  // Dead inventory made buyers waste offers on items sold elsewhere months
  // ago — and under the reject-strike policy the seller then ate a strike
  // for declining. Email + inbox only (no SMS — not time-critical, and
  // SMS-ing every ageing listing would be costly noise).
  // ---------------------------------------------------------------
  async listingStale(d: {
    sellerEmail: string;
    sellerName: string;
    listingTitle: string;
    listingId: string;
    kind: 'nudge' | 'expired';
    daysOld: number;
  }) {
    const myListingsUrl = `${this.appUrl}/my/listings`;
    if (d.kind === 'nudge') {
      await this.persistByEmail(d.sellerEmail, {
        category: 'SELLER',
        type: 'listing_stale_nudge',
        title: 'Still for sale?',
        body: `${d.listingTitle} has been listed ${d.daysOld} days. Tap "Still for sale" to keep it live, or remove it — listings expire at 90 days.`,
        url: '/my/listings',
        iconKey: 'sold',
        linkedType: 'listing',
        linkedId: d.listingId,
        dismissible: true,
      });
      const html = this.email({
        status: { tone: 'pending', label: 'Still available?' },
        headline: 'Is this still for sale?',
        body: `Hi ${b(d.sellerName)}, your listing ${b(d.listingTitle)} has been up for ${b(String(d.daysOld) + ' days')}. If it's still available, tap <b>Still for sale</b> on your listings page and the clock resets. If you've sold it elsewhere, please remove it so buyers don't make offers you'd have to decline. Listings that reach 90 days without being renewed are expired automatically.`,
        cta: { label: 'Confirm it’s still for sale', url: myListingsUrl },
        preheader: `${d.listingTitle}: still for sale?`,
      });
      await this.send(d.sellerEmail, `Still for sale? ${d.listingTitle}`, html);
      return;
    }
    await this.persistByEmail(d.sellerEmail, {
      category: 'SELLER',
      type: 'listing_expired_stale',
      title: 'Listing expired',
      body: `${d.listingTitle} reached ${d.daysOld} days and was expired. Relist it in one tap if it's still available.`,
      url: '/my/listings',
      iconKey: 'sold',
      linkedType: 'listing',
      linkedId: d.listingId,
      dismissible: true,
    });
    const html = this.email({
      status: { tone: 'pending', label: 'Expired' },
      headline: 'Your listing expired',
      body: `Hi ${b(d.sellerName)}, ${b(d.listingTitle)} was listed for ${b(String(d.daysOld) + ' days')} without selling, so it has been expired and removed from search. Nothing is lost — if it's still available, relist it from your listings page and it goes straight back up.`,
      cta: { label: 'Relist it', url: myListingsUrl },
      preheader: `${d.listingTitle} expired — relist in one tap`,
    });
    await this.send(d.sellerEmail, `Listing expired: ${d.listingTitle}`, html);
  }

  // ---------------------------------------------------------------
  // A published listing ended up with ZERO photos (the seller's browser or
  // PWA died mid-upload after moderation had already set it ACTIVE, so the
  // client-side rollback never fired). The sweep moves it back to DRAFT
  // rather than leaving an unsellable blank listing in search; tell the
  // seller how to finish it.
  // ---------------------------------------------------------------
  async listingPhotosMissing(d: {
    sellerEmail: string;
    sellerName: string;
    listingTitle: string;
    listingId: string;
  }) {
    await this.persistByEmail(d.sellerEmail, {
      category: 'SELLER',
      type: 'listing_photos_missing',
      title: 'Your listing needs photos',
      body: `${d.listingTitle} was published without photos and has been moved back to drafts — add photos and publish again.`,
      url: '/my/listings',
      iconKey: 'sold',
      linkedType: 'listing',
      linkedId: d.listingId,
      dismissible: false,
    });
    const html = this.email({
      status: { tone: 'pending', label: 'Action needed' },
      headline: 'Your listing is missing its photos',
      body: `Hi ${b(d.sellerName)}, ${b(d.listingTitle)} was published but none of its photos finished uploading — usually a dropped connection or a closed tab mid-upload. We've moved it back to your drafts so buyers never see a blank listing. Open it, add the photos, and publish again.`,
      cta: { label: 'Finish my listing', url: `${this.appUrl}/my/listings` },
      preheader: `${d.listingTitle} needs photos before it can go live`,
    });
    await this.send(
      d.sellerEmail,
      `Action needed: ${d.listingTitle} is missing photos`,
      html,
    );
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
    /** Offer is at/above the seller's auto-accept threshold — louder copy,
     *  force-push, and a heads-up that declining it has consequences. */
    meetsAutoAccept?: boolean;
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
    // meetsAutoAccept — the offer is at/above the seller's own auto-accept
    // price. It still needs their confirmation (no instant acceptance),
    // but the copy is louder and the inbox row force-pushes.
    const qualifies = !!d.meetsAutoAccept;
    // In-app inbox row. Action-required (not dismissible) — the seller
    // must accept / reject / counter on /offers/received to clear it.
    // OffersService.{accept,reject,counter}Offer call resolveByEntity
    // for these.
    await this.persistByEmail(d.sellerEmail, {
      category: 'SELLER',
      type: 'offer_received',
      title: qualifies ? 'Offer at your asking price!' : 'New offer received',
      body: qualifies
        ? `${d.buyerName} offered ${formatRand(d.offerAmount)} on ${d.listingTitle} — meets your auto-accept price. Confirm to sell.`
        : `${d.buyerName} offered ${formatRand(d.offerAmount)} on ${d.listingTitle}`,
      url: '/offers/received',
      iconKey: 'offer',
      linkedType: 'offer',
      linkedId: d.offerId,
      dismissible: false,
      forcePush: qualifies,
    });
    const html = this.email({
      status: { tone: 'pending', label: qualifies ? 'Offer at your price' : 'New offer' },
      headline: qualifies ? 'Offer meets your asking price' : 'New offer',
      body: qualifies
        ? `Hi ${b(d.sellerName)}, ${b(d.buyerName)} offered ${b(formatRand(d.offerAmount))} on ${b(d.listingTitle)} — at or above the auto-accept price you set. Please confirm (accept) or decline it. Note: declining any offer records a strike against your seller standing (except genuine buyer concerns, which go to review). Three strikes suspends selling on your account.`
        : `Hi ${b(d.sellerName)}, ${b(d.buyerName)} has made an offer on your listing ${b(d.listingTitle)}. You can accept, reject, or make a single counter-offer. The offer expires in 48 hours.`,
      rows: [
        { label: 'Item', value: d.listingTitle },
        { label: 'Offer amount', value: formatRand(d.offerAmount) },
      ],
      cta: { label: 'Review offer', url },
      preheader: `${d.buyerName} offered ${formatRand(d.offerAmount)}`,
    });
    await this.send(
      d.sellerEmail,
      (qualifies ? 'Offer at your price — ' : 'New offer on: ') + d.listingTitle,
      html,
    );
    // SMS — only when we have a token URL (otherwise the SMS would
    // bounce the seller to /sign-in which isn't actionable from a
    // phone with no Clerk session). The character budget is tight —
    // truncate the title so the URL fits.
    if (d.actionUrl) {
      await this.sendSms(
        d.sellerPhone,
        qualifies
          ? `All Outdoor: R${Math.round(d.offerAmount / 100)} offer on ${truncate(d.listingTitle, 24)} MEETS your asking price. Confirm: ${d.actionUrl}`
          : `All Outdoor: ${truncate(d.buyerName, 20)} offered R${Math.round(d.offerAmount / 100)} on ${truncate(d.listingTitle, 28)}. Decide: ${d.actionUrl}`,
        `offer-${d.offerId}`,
      );
    }
  }

  // ─── Bank-account verification (Peach BANV) ─────────────────────────
  // Fired from the BANV result webhook when a seller's bank account could
  // NOT be verified. Money-critical (their payouts are on hold), so it goes
  // out on every channel: non-dismissible inbox row (force-push), email with
  // a fix-it CTA, and SMS. The row is linked ('bank', userId) and resolves
  // when the user re-saves banking details or a later verification passes.
  async bankVerificationFailed(d: {
    email: string;
    name: string;
    phone?: string | null;
    userId: string;
    /** 'mismatch' = account/ownership didn't match; 'failed' = the check
     *  itself errored (usually wrong account number / branch code). */
    kind: 'mismatch' | 'failed';
  }) {
    const fixUrl = `${this.appUrl}/profile/edit`;
    const summary =
      d.kind === 'mismatch'
        ? 'We couldn’t confirm that this bank account belongs to you.'
        : 'We couldn’t verify your bank account details.';
    const detail =
      d.kind === 'mismatch'
        ? 'The account must be in your own name — the same name and ID number you verified with. A spouse’s, business partner’s or company account won’t pass. Please check the account number, branch code and account type, and make sure the account is open and in your name.'
        : 'The account number or branch code may be mistyped, or the account type may be wrong. Please re-check your details and save them again — verification re-runs automatically.';

    await this.persistByEmail(d.email, {
      category: 'SELLER',
      type: 'bank_verify_failed',
      title: 'Bank account needs attention',
      body: `${summary} Payouts are on hold until your banking details are corrected.`,
      url: '/profile/edit',
      iconKey: 'transaction',
      linkedType: 'bank',
      linkedId: d.userId,
      dismissible: false,
      forcePush: true,
    });
    const html = this.email({
      status: { tone: 'error', label: 'Action needed' },
      headline: 'Your bank account could not be verified',
      body: `Hi ${b(d.name)}, ${summary} Any money owed to you stays safely held — nothing is lost — but payouts are on hold until this is fixed. ${detail}`,
      cta: { label: 'Fix banking details', url: fixUrl },
      preheader: 'Payouts on hold — banking details need attention',
    });
    await this.send(d.email, 'Action needed: bank account could not be verified', html);
    await this.sendSms(
      d.phone,
      `All Outdoor: we couldn't verify your bank account — payouts are on hold. Fix your details: ${fixUrl}`,
      `banv-${d.userId}`,
    );
  }

  // Quiet confirmation when verification passes — inbox-only (dismissible),
  // no email/SMS noise for the happy path.
  async bankVerificationPassed(d: { email: string; userId: string }) {
    await this.persistByEmail(d.email, {
      category: 'SELLER',
      type: 'bank_verify_passed',
      title: 'Bank account verified',
      body: 'Your bank account has been verified — payouts can be paid to you.',
      url: '/profile/edit',
      iconKey: 'transaction',
      linkedType: 'bank',
      linkedId: d.userId,
      dismissible: true,
    });
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
        `All Outdoor: Your offer R${Math.round(d.acceptedAmount / 100)} on ${truncate(d.listingTitle, 30)} was accepted. Pay within 24h: ${d.actionUrl}`,
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
    /** Human label of the seller's ticklist reason (e.g. "Item is no
     *  longer available"). Absent on auto-declines (lowball filter). */
    reasonLabel?: string;
  }) {
    const url = `${this.appUrl}/listings/${d.listingId}`;
    const reasonSuffix = d.reasonLabel ? ` Reason: ${d.reasonLabel}.` : '';
    // In-app inbox: final state — dismissible (no action to take).
    await this.persistByEmail(d.buyerEmail, {
      category: 'BUYER',
      type: 'offer_rejected',
      title: 'Offer declined',
      body: `Your offer on ${d.listingTitle} was declined.${reasonSuffix}`,
      url: `/listings/${d.listingId}`,
      iconKey: 'offer',
      linkedType: 'offer',
      linkedId: d.offerId,
      dismissible: true,
    });
    const html = this.email({
      status: { tone: 'error', label: 'Declined' },
      headline: 'Offer declined',
      body: `Hi ${b(d.buyerName)}, the seller has declined your offer on ${b(d.listingTitle)}.${reasonSuffix}`,
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
        `All Outdoor: Seller countered at R${Math.round(d.counterAmount / 100)} on ${truncate(d.listingTitle, 28)}. 24h to respond: ${d.actionUrl}`,
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

  // Seller notice — their auto-accept threshold just sold the item.
  // (Buyer gets the standard offerAccepted pay-now flow separately.)
  async offerAutoAccepted(d: {
    sellerEmail: string;
    sellerName: string;
    sellerPhone?: string | null;
    buyerName: string;
    listingTitle: string;
    listingId: string;
    amount: number;
    offerId: string;
  }) {
    await this.persistByEmail(d.sellerEmail, {
      category: 'SELLER',
      type: 'offer_auto_accepted',
      title: 'Sold at your auto-accept price',
      body: `${d.buyerName} offered ${formatRand(d.amount)} on ${d.listingTitle} — auto-accepted. They have 24h to pay.`,
      url: `/listings/${d.listingId}`,
      iconKey: 'offer',
      linkedType: 'offer',
      linkedId: d.offerId,
      dismissible: true,
    });
    const html = this.email({
      status: { tone: 'success', label: 'Auto-accepted' },
      headline: 'Sold at your auto-accept price',
      body: `Hi ${b(d.sellerName)}, ${b(d.buyerName)} offered ${b(formatRand(d.amount))} on ${b(d.listingTitle)} — at or above your auto-accept threshold, so it was accepted instantly. The buyer has 24 hours to pay; we'll let you know the moment payment lands.`,
      cta: {
        label: 'View listing',
        url: `${this.appUrl}/listings/${d.listingId}`,
      },
      preheader: `Auto-accepted at ${formatRand(d.amount)} — ${d.listingTitle}`,
    });
    await this.send(d.sellerEmail, 'Sold at your auto-accept price — ' + d.listingTitle, html);
    await this.sendSms(
      d.sellerPhone,
      `All Outdoor: ${truncate(d.listingTitle, 30)} auto-accepted at R${Math.round(d.amount / 100)}. Buyer has 24h to pay.`,
      `offer-auto-acc-${d.offerId}`,
    );
  }

  // Seller notice — the buyer withdrew their pending offer.
  async offerWithdrawn(d: {
    sellerEmail: string;
    sellerName: string;
    buyerName: string;
    listingTitle: string;
    listingId: string;
    offerId: string;
  }) {
    await this.persistByEmail(d.sellerEmail, {
      category: 'SELLER',
      type: 'offer_withdrawn',
      title: 'Offer withdrawn',
      body: `${d.buyerName} withdrew their offer on ${d.listingTitle}. Listing stays active.`,
      url: `/listings/${d.listingId}`,
      iconKey: 'offer',
      linkedType: 'offer',
      linkedId: d.offerId,
      dismissible: true,
    });
    const html = this.email({
      status: { tone: 'error', label: 'Withdrawn' },
      headline: 'Offer withdrawn',
      body: `Hi ${b(d.sellerName)}, ${b(d.buyerName)} has withdrawn their offer on ${b(d.listingTitle)}. The listing remains active.`,
      cta: {
        label: 'View listing',
        url: `${this.appUrl}/listings/${d.listingId}`,
      },
      preheader: `${d.buyerName} withdrew their offer`,
    });
    await this.send(d.sellerEmail, 'Offer withdrawn — ' + d.listingTitle, html);
  }

  // Buyer notice — their offer lapsed with no seller response (48h).
  async offerExpiredBuyer(d: {
    buyerEmail: string;
    buyerName: string;
    listingTitle: string;
    listingId: string;
    offerId: string;
  }) {
    await this.persistByEmail(d.buyerEmail, {
      category: 'BUYER',
      type: 'offer_expired',
      title: 'Offer expired',
      body: `The seller didn't respond to your offer on ${d.listingTitle} in time. You can make a new offer while the listing is live.`,
      url: `/listings/${d.listingId}`,
      iconKey: 'offer',
      linkedType: 'offer',
      linkedId: d.offerId,
      dismissible: true,
    });
    const html = this.email({
      status: { tone: 'error', label: 'Expired' },
      headline: 'Your offer expired',
      body: `Hi ${b(d.buyerName)}, the seller didn't respond to your offer on ${b(d.listingTitle)} within 48 hours, so it has expired. The listing is still live — you're welcome to make a new offer.`,
      cta: {
        label: 'View listing',
        url: `${this.appUrl}/listings/${d.listingId}`,
      },
      preheader: `Your offer on ${d.listingTitle} expired`,
    });
    await this.send(d.buyerEmail, 'Your offer expired — ' + d.listingTitle, html);
  }

  // Seller notice — their counter lapsed unanswered (24h).
  async counterExpiredSeller(d: {
    sellerEmail: string;
    sellerName: string;
    buyerName: string;
    listingTitle: string;
    listingId: string;
    offerId: string;
  }) {
    await this.persistByEmail(d.sellerEmail, {
      category: 'SELLER',
      type: 'counter_expired',
      title: 'Counter expired',
      body: `${d.buyerName} didn't respond to your counter on ${d.listingTitle} in time. Listing stays active.`,
      url: `/listings/${d.listingId}`,
      iconKey: 'offer',
      linkedType: 'offer',
      linkedId: d.offerId,
      dismissible: true,
    });
    const html = this.email({
      status: { tone: 'error', label: 'Expired' },
      headline: 'Your counter-offer expired',
      body: `Hi ${b(d.sellerName)}, ${b(d.buyerName)} didn't respond to your counter-offer on ${b(d.listingTitle)} within 24 hours, so it has expired. The listing remains active.`,
      cta: {
        label: 'View listing',
        url: `${this.appUrl}/listings/${d.listingId}`,
      },
      preheader: `Your counter on ${d.listingTitle} expired`,
    });
    await this.send(d.sellerEmail, 'Counter expired — ' + d.listingTitle, html);
  }

  // Both-party notice — an ACCEPTED offer's 24h pay window lapsed.
  // Seller learns their sale evaporated; buyer learns the sale was
  // cancelled (and takes a non-payment strike, handled by OffersService).
  async acceptedOfferLapsed(d: {
    sellerEmail: string;
    sellerName: string;
    sellerPhone?: string | null;
    buyerEmail: string;
    buyerName: string;
    buyerPhone?: string | null;
    listingTitle: string;
    listingId: string;
    amount: number;
    offerId: string;
  }) {
    // Seller side
    await this.persistByEmail(d.sellerEmail, {
      category: 'SELLER',
      type: 'offer_payment_lapsed',
      title: 'Buyer never paid',
      body: `The accepted ${formatRand(d.amount)} offer on ${d.listingTitle} wasn't paid within 24h. The listing is active again — other buyers can offer.`,
      url: `/listings/${d.listingId}`,
      iconKey: 'offer',
      linkedType: 'offer',
      linkedId: d.offerId,
      dismissible: true,
    });
    const sellerHtml = this.email({
      status: { tone: 'error', label: 'Payment lapsed' },
      headline: 'The buyer never paid',
      body: `Hi ${b(d.sellerName)}, the accepted offer of ${b(formatRand(d.amount))} on ${b(d.listingTitle)} was not paid within the 24-hour window, so the sale has been cancelled. Your listing is active again and open to new offers.`,
      cta: {
        label: 'View listing',
        url: `${this.appUrl}/listings/${d.listingId}`,
      },
      preheader: `Accepted offer on ${d.listingTitle} — buyer never paid`,
    });
    await this.send(d.sellerEmail, 'Buyer never paid — ' + d.listingTitle, sellerHtml);
    await this.sendSms(
      d.sellerPhone,
      `All Outdoor: The accepted offer on ${truncate(d.listingTitle, 30)} wasn't paid in 24h. Your listing is active again.`,
      `offer-lapse-s-${d.offerId}`,
    );
    // Buyer side
    await this.persistByEmail(d.buyerEmail, {
      category: 'BUYER',
      type: 'offer_payment_lapsed',
      title: 'Payment window missed — sale cancelled',
      body: `You didn't complete payment for ${d.listingTitle} within 24h, so the sale was cancelled.`,
      url: `/listings/${d.listingId}`,
      iconKey: 'offer',
      linkedType: 'offer',
      linkedId: d.offerId,
      dismissible: true,
    });
    const buyerHtml = this.email({
      status: { tone: 'error', label: 'Sale cancelled' },
      headline: 'Payment window missed',
      body: `Hi ${b(d.buyerName)}, your accepted offer of ${b(formatRand(d.amount))} on ${b(d.listingTitle)} was cancelled because payment wasn't completed within 24 hours. Repeated unpaid commitments lead to a bidding and offer suspension.`,
      cta: {
        label: 'View listing',
        url: `${this.appUrl}/listings/${d.listingId}`,
      },
      preheader: `Sale cancelled — payment window missed`,
    });
    await this.send(d.buyerEmail, 'Sale cancelled — payment window missed', buyerHtml);
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
        `All Outdoor: New bid R${(amount / 100).toFixed(0)} on ${truncate(listingTitle, 40)}.`,
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
        ? `All Outdoor: Outbid on ${truncate(listingTitle, 26)} — high R${(newAmount / 100).toFixed(0)}. Raise: ${actionUrl}`
        : `All Outdoor: Outbid on ${truncate(listingTitle, 30)} — current bid R${(newAmount / 100).toFixed(0)}.`;
      await this.sendSms(
        buyerPhone,
        smsBody,
        `outbid-${listingId ?? 'x'}-${newAmount}`,
      );
    }
  }

  // M30 — one-shot 'auction ended, you did not win' notice for a losing
  // bidder. Dismissible (final state, no action). Linked on the listing so
  // it can auto-resolve if ever needed. No SMS spam beyond the single row +
  // email — losers already got per-bid outbid SMS during the auction.
  async auctionEndedLoser(
    loserEmail: string,
    listingTitle: string,
    finalBid: number,
    listingId: string,
  ) {
    await this.persistByEmail(loserEmail, {
      category: 'BUYER',
      type: 'auction_lost',
      title: 'Auction ended — you didn’t win',
      body: `${listingTitle} closed at ${formatRand(finalBid)}.`,
      url: `/listings/${listingId}`,
      iconKey: 'bid',
      linkedType: 'listing',
      linkedId: listingId,
      dismissible: true,
    });
    const html = this.email({
      status: { tone: 'error', label: 'Auction ended' },
      headline: 'Auction ended',
      body: `Bidding has closed on ${b(listingTitle)} at ${b(formatRand(finalBid))}. You weren’t the winning bidder this time — browse similar listings to keep hunting.`,
      cta: { label: 'View listing', url: `${this.appUrl}/listings/${listingId}` },
      preheader: `Auction ended — you didn’t win ${listingTitle}`,
    });
    await this.send(loserEmail, 'Auction ended — ' + listingTitle, html);
  }

  // M31 — one-shot notice to a winner whose 24h pay window lapsed and whose
  // sale was cancelled. Dismissible final state. Sent from AuctionsService's
  // unpaid-winner terminals after their auction_won inbox row is resolved.
  async auctionWinnerLapsed(
    winnerEmail: string,
    listingTitle: string,
    finalBid: number,
    winnerPhone: string | null | undefined,
    listingId: string,
  ) {
    await this.persistByEmail(winnerEmail, {
      category: 'BUYER',
      type: 'auction_win_lapsed',
      title: 'Payment window missed',
      body: `Your win on ${listingTitle} was cancelled — the 24h payment window passed.`,
      url: `/listings/${listingId}`,
      iconKey: 'bid',
      linkedType: 'listing',
      linkedId: listingId,
      dismissible: true,
    });
    const html = this.email({
      status: { tone: 'error', label: 'Payment window missed' },
      headline: 'Your auction win was cancelled',
      body: `The 24-hour payment window for ${b(listingTitle)} (${b(formatRand(finalBid))}) has passed, so this sale has been cancelled. Repeated missed payments can lead to your bidding being suspended.`,
      cta: { label: 'View listing', url: `${this.appUrl}/listings/${listingId}` },
      preheader: `Payment window missed — ${listingTitle}`,
    });
    await this.send(winnerEmail, 'Payment window missed — ' + listingTitle, html);
    if (winnerPhone) {
      await this.sendSms(
        winnerPhone,
        `All Outdoor: Your win on ${truncate(listingTitle, 26)} was cancelled — the 24h payment window passed.`,
        `auction-lapsed-${listingId}`,
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
        `All Outdoor: You WON ${truncate(listingTitle, 26)} for R${(amount / 100).toFixed(0)}. 24h to pay: ${url}`,
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
    outcome: 'WON' | 'NO_RESERVE' | 'NO_BIDS' | 'WINNER_UNPAID',
    amount: number,
    // Optional listingId so we can deep-link the inbox row to the
    // listing and resolveByEntity('listing', listingId) when the next
    // step lands (e.g. seller relists / buyer pays). Callers that
    // don't have it yet can still call this method — the row just
    // won't auto-resolve.
    listingId?: string,
    // Seller phone — every auction-lifecycle event SMSes (per-bid,
    // won, dispatch all do); the seller-side end notice was the only
    // one that didn't. Optional so existing callers still compile.
    sellerPhone?: string | null,
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
            : outcome === 'WINNER_UNPAID'
              ? 'Winner didn’t pay'
              : 'Auction ended — no bids',
      body:
        outcome === 'WON'
          ? `${listingTitle} sold for ${formatRand(amount)}. Buyer has 24h to pay.`
          : outcome === 'NO_RESERVE'
            ? `Highest bid ${formatRand(amount)} on ${listingTitle} didn't meet your reserve.`
            : outcome === 'WINNER_UNPAID'
              ? `The winning bidder didn't pay for ${listingTitle} within 24 hours. You can relist it.`
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
          // FLOW-F5 (M29) — finalizeAuction's NO_RESERVE case just expires the
          // listing; there is no accept-high-bid or counter action, only
          // relist. The old copy promised all three.
          body: `Bidding closed on ${b(listingTitle)} at ${b(formatRand(amount))}, which did not meet your reserve. You can relist it — at the same reserve or a lower one — from your dashboard.`,
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
      case 'WINNER_UNPAID':
        subject = 'Winner didn’t pay — ' + listingTitle;
        html = this.email({
          status: { tone: 'error', label: 'Winner didn’t pay' },
          headline: 'The winning bidder didn’t pay',
          body: `The winner of ${b(listingTitle)} (winning bid ${b(formatRand(amount))}) did not complete payment within 24 hours, so the sale was cancelled. You can relist the item from your dashboard.`,
          cta: { label: 'View dashboard', url: ctaUrl },
          preheader: `Winning bidder missed the 24h payment window`,
        });
        break;
    }
    await this.send(sellerEmail, subject, html);
    if (sellerPhone) {
      const smsBody =
        outcome === 'WON'
          ? `All Outdoor: Your auction ${truncate(listingTitle, 24)} SOLD for R${(amount / 100).toFixed(0)}. Buyer has 24h to pay.`
          : outcome === 'WINNER_UNPAID'
            ? `All Outdoor: The winner of ${truncate(listingTitle, 22)} didn't pay in time. You can relist it: ${ctaUrl}`
            : outcome === 'NO_RESERVE'
              ? `All Outdoor: ${truncate(listingTitle, 22)} closed at R${(amount / 100).toFixed(0)} — below your reserve. Relist: ${ctaUrl}`
              : `All Outdoor: ${truncate(listingTitle, 24)} ended with no bids. Relist: ${ctaUrl}`;
      await this.sendSms(sellerPhone, smsBody, `auction-ended-${outcome.toLowerCase()}-${listingId ?? 'x'}`);
    }
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
    buyerPhone?: string | null,
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
    // High-value SMS — the buyer wants to be home for it.
    await this.sendSms(
      buyerPhone,
      `All Outdoor: ${truncate(listingTitle, 34)} is out for delivery today.`,
      `buyer-out-for-delivery-${transactionId}`,
    );
  }

  async shippingDelivered(
    buyerEmail: string,
    buyerName: string,
    listingTitle: string,
    transactionId: string,
    buyerPhone?: string | null,
  ) {
    const url = `${this.appUrl}/transactions/${transactionId}`;
    // In-app inbox: action-required — the buyer must confirm receipt to
    // release the seller's payout (there is NO auto-release for physical
    // goods; funds stay held until the buyer confirms or an admin reviews).
    // Cleared by resolveByEntity('transaction', txId, buyerUserId) on confirm.
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
      body: `Hi ${b(buyerName)}, your ${b(listingTitle)} has been delivered. Please confirm receipt in your dashboard so the seller can be paid. If anything is wrong with the item, don't confirm — raise it from the order page and we'll hold the payment while we look into it.`,
      cta: { label: 'Confirm receipt', url },
      preheader: `${listingTitle} was delivered`,
    });
    await this.send(buyerEmail, 'Delivered — ' + listingTitle, html);
    // High-value SMS — nudges the buyer to confirm, which releases the payout.
    await this.sendSms(
      buyerPhone,
      `All Outdoor: ${truncate(listingTitle, 30)} was delivered. Confirm receipt so the seller can be paid: ${url}`,
      `buyer-delivered-${transactionId}`,
    );
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
    return `All Outdoor: ${friendlyService} credits at ${d.balance} ${d.unit}. Top up: ${url}`;
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
      `All Outdoor: ${truncate(d.listingTitle, 30)} still not dispatched (${d.hoursElapsed}h). Auto-refund in ${d.autoRefundDays}d. Ship now: ${txUrl}`,
      `dispatch-nudge-${d.transactionId}`,
    );
  }

  // ---------------------------------------------------------------
  // FLOW-F4 (H15) — DEALER_TRANSFER stall nudge. A firearm sale routes
  // through a licensed dealer, not a courier, so the standard dispatch
  // nudge above (parcel / auto-refund / strike) is wrong for it. This
  // reminds the seller to complete the dealer hand-off so the transfer
  // can be verified and the buyer's held payment can be released. There
  // is NO auto-refund on this path (dealer logistics run long + firearm-
  // specific judgment), so the copy never threatens one.
  // ---------------------------------------------------------------
  async dealerTransferStallNudgeSeller(d: {
    sellerEmail: string;
    sellerName: string;
    sellerPhone?: string | null;
    listingTitle: string;
    transactionId: string;
    daysElapsed: number;
  }) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    await this.persistByEmail(d.sellerEmail, {
      category: 'SELLER',
      type: 'dealer_transfer_stall_nudge',
      title: 'Complete the dealer transfer',
      body: `${d.listingTitle} — the buyer paid ${d.daysElapsed} day${d.daysElapsed === 1 ? '' : 's'} ago. Hand the firearm to the dealer so the transfer can be verified and your payment released.`,
      url: `/transactions/${d.transactionId}`,
      iconKey: 'dispatch',
      linkedType: 'transaction',
      linkedId: d.transactionId,
      dismissible: false,
    });
    const html = this.email({
      status: { tone: 'pending', label: 'Action needed' },
      headline: 'Complete the dealer transfer',
      body: `Hi ${b(d.sellerName)}, the buyer paid for ${b(d.listingTitle)} ${b(d.daysElapsed + ' days')} ago and their payment is being held until the licensed-dealer transfer is completed. Please arrange to hand the firearm to the dealer and have the SAPS 534 processed so the transfer can be verified — your payment is released once verification passes. If you can't complete the transfer for any reason, contact support so we can resolve it with the buyer.`,
      rows: [
        { label: 'Reference', value: d.transactionId.slice(-8).toUpperCase() },
        { label: 'Buyer paid', value: `${d.daysElapsed} days ago` },
      ],
      cta: { label: 'View order', url: txUrl },
      preheader: `Complete the dealer transfer for ${d.listingTitle}`,
    });
    await this.send(
      d.sellerEmail,
      'Action needed: complete the dealer transfer for ' + d.listingTitle,
      html,
    );
    await this.sendSms(
      d.sellerPhone,
      `All Outdoor: ${truncate(d.listingTitle, 30)} — buyer paid ${d.daysElapsed}d ago. Complete the dealer transfer to release your payment: ${txUrl}`,
      `dt-stall-nudge-${d.transactionId}`,
    );
  }

  // ---------------------------------------------------------------
  // Buyer: collection-confirm reminder (FLOW-F6 / H6). A COLLECTION order
  // the seller accepted but the buyer never confirmed collection on — funds
  // sit HELD. One-shot, idempotent via collectionConfirmNudgedAt on the cron
  // side. Reminds the buyer to arrange the pickup (seller contact is on the
  // order page) and tap Confirm collection, which releases the seller's
  // payment. NO auto-refund on this path.
  // ---------------------------------------------------------------
  async collectionConfirmNudgeBuyer(d: {
    buyerEmail: string;
    buyerName: string;
    buyerPhone?: string | null;
    listingTitle: string;
    transactionId: string;
    daysElapsed: number;
  }) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    await this.persistByEmail(d.buyerEmail, {
      category: 'BUYER',
      type: 'collection_confirm_nudge',
      title: 'Confirm your collection',
      body: `${d.listingTitle} — arrange the pickup and tap Confirm collection to release the seller's payment.`,
      url: `/transactions/${d.transactionId}`,
      iconKey: 'transaction',
      linkedType: 'transaction',
      linkedId: d.transactionId,
      dismissible: false,
    });
    const html = this.email({
      status: { tone: 'pending', label: 'Action needed' },
      headline: 'Confirm your collection',
      body: `Hi ${b(d.buyerName)}, you paid for ${b(d.listingTitle)} ${b(d.daysElapsed + ' days')} ago and it's waiting to be collected. This is an in-person collection — the seller's contact details are on your order page. Please arrange the pickup, and once you have the item tap <b>Confirm collection</b> so the seller's payment can be released. If you've had trouble reaching the seller or the item wasn't as described at the handover, you can raise a dispute from the same page.`,
      rows: [
        { label: 'Reference', value: d.transactionId.slice(-8).toUpperCase() },
        { label: 'Paid', value: `${d.daysElapsed} days ago` },
      ],
      cta: { label: 'View order', url: txUrl },
      preheader: `Confirm your collection for ${d.listingTitle}`,
    });
    await this.send(
      d.buyerEmail,
      'Action needed: confirm your collection for ' + d.listingTitle,
      html,
    );
    await this.sendSms(
      d.buyerPhone,
      `All Outdoor: ${truncate(d.listingTitle, 30)} is waiting for collection. Arrange pickup (seller contact on your order page) and tap Confirm collection: ${txUrl}`,
      `collection-confirm-nudge-${d.transactionId}`,
    );
  }

  // ---------------------------------------------------------------
  // An auction winner blew the 24h pay window — offer the SELLER the chance
  // to hand it to the runner-up at that bidder's own highest bid, one tap,
  // no sign-in. Previously the seller was just told to relist and start a
  // fresh 7-day auction to reach a buyer the platform already had.
  // Action-required (not dismissible): there is a real decision to make and
  // a short window to make it in.
  // ---------------------------------------------------------------
  async auctionRunnerUpAvailable(d: {
    sellerEmail: string;
    sellerName: string;
    sellerPhone?: string | null;
    listingTitle: string;
    listingId: string;
    amount: number;
    /** The runner-up's USERNAME — never their real name. */
    bidderName: string;
    hoursToDecide: number;
    actionUrl?: string;
  }) {
    const url = d.actionUrl ?? `${this.appUrl}/my/listings`;
    await this.persistByEmail(d.sellerEmail, {
      category: 'SELLER',
      type: 'auction_runner_up_available',
      title: 'Offer it to the next bidder?',
      body: `The winner of ${d.listingTitle} didn't pay. ${d.bidderName} bid ${formatRand(d.amount)} — offer it to them instead of relisting.`,
      url: d.actionUrl ?? '/my/listings',
      iconKey: 'auction',
      linkedType: 'listing',
      linkedId: d.listingId,
      dismissible: false,
      forcePush: true,
    });
    const html = this.email({
      status: { tone: 'pending', label: 'Decision needed' },
      headline: 'Your auction has a second buyer waiting',
      body: `Hi ${b(d.sellerName)}, the winning bidder on ${b(d.listingTitle)} didn't pay within the 24-hour window, so the sale lapsed and a strike was recorded against them. You don't have to start over: ${b(d.bidderName)} bid ${b(formatRand(d.amount))} on the same item. Offer it to them at that price and they get the usual 24 hours to pay — if they don't, nothing is lost and you can still relist. You have about ${b(String(d.hoursToDecide) + ' hours')} to decide.`,
      rows: [
        { label: 'Item', value: d.listingTitle },
        { label: 'Next-highest bid', value: formatRand(d.amount) },
        { label: 'Bidder', value: d.bidderName },
      ],
      cta: { label: 'Review and decide', url },
      preheader: `${d.bidderName} bid ${formatRand(d.amount)} on ${d.listingTitle}`,
    });
    await this.send(
      d.sellerEmail,
      `Second buyer for ${d.listingTitle} — offer it to them?`,
      html,
    );
    if (d.actionUrl) {
      await this.sendSms(
        d.sellerPhone,
        `All Outdoor: winner didn't pay for ${truncate(d.listingTitle, 22)}. Next bidder offered R${Math.round(d.amount / 100)}. Sell to them? ${d.actionUrl}`,
        `runner-up-${d.listingId}`,
      );
    }
  }

  // ---------------------------------------------------------------
  // Complaint status/outcome changed — tell the person who lodged it.
  // adminUpdate used to record the verdict and resolve the admin alert but
  // never contact the user, so a buyer whose payout-affecting complaint froze
  // an order only learned the result if they happened to revisit /complaints.
  // On a marketplace where the complaint held someone's money, silence reads
  // as being ignored and comes back as a second ticket.
  // ---------------------------------------------------------------
  async complaintStatusChanged(d: {
    email: string;
    name: string;
    /** Only passed for payout-affecting cases — those get an SMS too. */
    phone?: string | null;
    referenceNumber: string;
    subject: string;
    status: string;
    outcome?: string | null;
    heldPayout: boolean;
  }) {
    const resolved = d.status === 'RESOLVED' || d.status === 'CLOSED';
    const needsUser = d.status === 'AWAITING_USER';
    const url = `${this.appUrl}/complaints`;
    const pretty = d.status.replace(/_/g, ' ').toLowerCase();

    await this.persistByEmail(d.email, {
      category: 'ACCOUNT',
      type: 'complaint_status_changed',
      title: needsUser
        ? `We need more info on ${d.referenceNumber}`
        : `Complaint ${d.referenceNumber} ${resolved ? 'resolved' : 'updated'}`,
      body: needsUser
        ? `We've replied to your complaint about ${d.subject} and need something from you to continue.`
        : `Your complaint about ${d.subject} is now ${pretty}.`,
      url: '/complaints',
      iconKey: 'transaction',
      linkedType: 'complaint',
      linkedId: d.referenceNumber,
      // Awaiting-user is a real to-do; a verdict is informational.
      dismissible: !needsUser,
      forcePush: needsUser || d.heldPayout,
    });

    const html = this.email({
      status: {
        tone: needsUser ? 'pending' : resolved ? 'success' : 'pending',
        label: needsUser ? 'Action needed' : resolved ? 'Resolved' : 'Updated',
      },
      headline: needsUser
        ? 'We need a bit more from you'
        : `Your complaint is ${pretty}`,
      body: needsUser
        ? `Hi ${b(d.name)}, we're working on ${b(d.referenceNumber)} (${b(d.subject)}) and need more information from you before we can finish. Open your complaints page to see what we've asked for and reply there.`
        : `Hi ${b(d.name)}, your complaint ${b(d.referenceNumber)} about ${b(d.subject)} is now ${b(pretty)}.` +
          (d.outcome ? ` Outcome: ${b(d.outcome)}` : '') +
          (d.heldPayout
            ? ` This case was holding the payment on the related order; that hold is reviewed as part of the outcome.`
            : '') +
          ` If you don't think this is right, reply to this email and we'll take another look.`,
      rows: [
        { label: 'Case', value: d.referenceNumber },
        { label: 'Status', value: pretty },
      ],
      cta: { label: 'View my complaints', url },
      preheader: needsUser
        ? `${d.referenceNumber} needs more information`
        : `${d.referenceNumber} is now ${pretty}`,
    });
    await this.send(
      d.email,
      needsUser
        ? `Action needed on complaint ${d.referenceNumber}`
        : `Complaint ${d.referenceNumber} — ${pretty}`,
      html,
    );

    // SMS reserved for cases that froze money (or need the user to act) —
    // a status change on an ordinary account complaint doesn't warrant one.
    if (d.phone && (d.heldPayout || needsUser)) {
      await this.sendSms(
        d.phone,
        needsUser
          ? `All Outdoor: we need more info on complaint ${d.referenceNumber}. Reply here: ${url}`
          : `All Outdoor: complaint ${d.referenceNumber} is now ${pretty}. Details: ${url}`,
        `complaint-status-${d.referenceNumber}`,
      );
    }
  }

  // ---------------------------------------------------------------
  // Courier confirm-receipt nudge (48h after DELIVERED, buyer never
  // confirmed, funds still HELD). Sits UNDER the 72h stuck-funds admin
  // alert — a gentle self-heal reminder so a forgetful buyer releases the
  // seller's money without a human chasing them. Mentions the raise-an-
  // issue alternative for the "delivered but wrong/damaged" case.
  // ---------------------------------------------------------------
  async confirmReceiptNudgeBuyer(d: {
    buyerEmail: string;
    buyerName: string;
    buyerPhone?: string | null;
    listingTitle: string;
    transactionId: string;
    hoursElapsed: number;
  }) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    await this.persistByEmail(d.buyerEmail, {
      category: 'BUYER',
      type: 'confirm_receipt_nudge',
      title: 'Confirm your delivery',
      body: `${d.listingTitle} was delivered — tap Confirm receipt to release the seller's payment, or raise an issue if something's wrong.`,
      url: `/transactions/${d.transactionId}`,
      iconKey: 'transaction',
      linkedType: 'transaction',
      linkedId: d.transactionId,
      dismissible: false,
      forcePush: true,
    });
    const html = this.email({
      status: { tone: 'pending', label: 'Action needed' },
      headline: 'Confirm you received your order',
      body: `Hi ${b(d.buyerName)}, ${b(d.listingTitle)} was marked delivered and is waiting for you to confirm. Please tap <b>Confirm receipt</b> so the seller's payment can be released. If the item never arrived, or wasn't as described, <b>raise an issue</b> from the same page instead — don't confirm.`,
      rows: [
        { label: 'Reference', value: d.transactionId.slice(-8).toUpperCase() },
      ],
      cta: { label: 'Confirm receipt', url: txUrl },
      preheader: `Confirm you received ${d.listingTitle}`,
    });
    await this.send(
      d.buyerEmail,
      'Action needed: confirm you received ' + d.listingTitle,
      html,
    );
    await this.sendSms(
      d.buyerPhone,
      `All Outdoor: ${truncate(d.listingTitle, 28)} was delivered. Tap Confirm receipt to release payment (or raise an issue if there's a problem): ${txUrl}`,
      `confirm-receipt-nudge-${d.transactionId}`,
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
    // FLOW-F2 — rail-aware refund copy (see saleRejectedBuyer).
    manualEft?: boolean;
    needsBankDetails?: boolean;
  }) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    const buyerName = d.buyer.firstName ?? 'Buyer';
    const sellerName = d.seller.firstName ?? 'Seller';

    // FLOW-F2 — rail-aware refund copy (see saleRejectedBuyer).
    const refundLine = d.needsBankDetails
      ? `A refund of ${b(formatRand(d.buyerTotal))} has been approved — but we don't have your bank details yet, so we can't pay it out. Add your bank account under Profile → Banking details and the refund goes into the next daily payment run.`
      : d.manualEft
        ? `We've refunded ${b(formatRand(d.buyerTotal))} — it will be paid by EFT to your bank account in the next daily payment run (1–3 business days).`
        : `We've refunded ${b(formatRand(d.buyerTotal))} back to your card. The funds should reflect in ${REFUND_ETA}.`;
    if (d.needsBankDetails) {
      await this.persistByEmail(d.buyer.email, {
        category: 'BUYER',
        type: 'refund_needs_bank_details',
        title: 'Refund approved — add your bank details',
        body: `${d.listingTitle} — add your bank details so we can EFT your ${formatRand(d.buyerTotal)} refund`,
        url: '/profile/edit',
        iconKey: 'transaction',
        linkedType: 'transaction',
        linkedId: d.transactionId,
        dismissible: false,
      });
    }
    const buyerHtml = this.email({
      status: d.needsBankDetails
        ? { tone: 'pending', label: 'Action needed' }
        : { tone: 'success', label: 'Refunded' },
      headline: d.needsBankDetails
        ? 'Refund approved — we need your bank details'
        : 'Order refunded',
      body: `Hi ${b(buyerName)}, the seller of ${b(d.listingTitle)} didn't dispatch within our 7-day window. ${refundLine} Sorry for the trouble — the listing is back on the marketplace if you want to browse alternatives.`,
      rows: [
        { label: 'Reference', value: d.transactionId.slice(-8).toUpperCase() },
        { label: 'Amount', value: formatRand(d.buyerTotal) },
        {
          label: 'Refund destination',
          value: d.manualEft ? 'Your bank account (EFT)' : 'Original payment card',
        },
      ],
      cta: d.needsBankDetails
        ? { label: 'Add bank details', url: `${this.appUrl}/profile/edit` }
        : { label: 'Browse listings', url: `${this.appUrl}/` },
      preheader: d.needsBankDetails
        ? 'Action needed — add bank details for your refund'
        : `Refunded ${formatRand(d.buyerTotal)} for ${d.listingTitle}`,
    });
    await this.send(d.buyer.email, 'Refunded: ' + d.listingTitle, buyerHtml);
    await this.sendSms(
      d.buyer.phone,
      d.needsBankDetails
        ? `All Outdoor: ${truncate(d.listingTitle, 30)} not dispatched — refund approved. Add your bank details at gungalore.co.za/profile/edit so we can pay it.`
        : `All Outdoor: ${truncate(d.listingTitle, 30)} not dispatched. Refunded ${formatRand(d.buyerTotal)}${d.manualEft ? ' by EFT (1-3 business days)' : ' to your card'}.`,
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
      `All Outdoor: ${truncate(d.listingTitle, 30)} auto-refunded (no dispatch). Strike added.`,
      `auto-refund-seller-${d.transactionId}`,
    );
  }

  // ---------------------------------------------------------------
  // Buyer cancelled a paid-but-undispatched order (Phase 4 P4.2).
  // Confirms the refund to the buyer and tells the seller the order is
  // off + the item is back on the marketplace. NO strike — a buyer
  // changing their mind is not the seller's fault.
  // ---------------------------------------------------------------
  async orderCancelledByBuyer(d: {
    listingTitle: string;
    transactionId: string;
    buyerTotal: number;
    reason: string;
    buyer: { email: string; firstName: string | null; phone: string | null };
    seller: { email: string; firstName: string | null; phone: string | null };
    // FLOW-F2 — rail-aware refund copy (see saleRejectedBuyer).
    manualEft?: boolean;
    needsBankDetails?: boolean;
  }) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    const buyerName = d.buyer.firstName ?? 'there';
    const sellerName = d.seller.firstName ?? 'Seller';

    const refundLine = d.needsBankDetails
      ? `Your refund of ${b(formatRand(d.buyerTotal))} is approved — but we don't have your bank details yet, so we can't pay it out. Add your bank account under Profile → Banking details and it goes into the next daily payment run.`
      : d.manualEft
        ? `We've refunded ${b(formatRand(d.buyerTotal))} — it will be paid by EFT to your bank account in the next daily payment run (1–3 business days).`
        : `We've refunded ${b(formatRand(d.buyerTotal))} to your card. Allow ${REFUND_ETA} for it to reflect.`;
    if (d.needsBankDetails) {
      await this.persistByEmail(d.buyer.email, {
        category: 'BUYER',
        type: 'refund_needs_bank_details',
        title: 'Refund approved — add your bank details',
        body: `${d.listingTitle} — add your bank details so we can EFT your ${formatRand(d.buyerTotal)} refund`,
        url: '/profile/edit',
        iconKey: 'transaction',
        linkedType: 'transaction',
        linkedId: d.transactionId,
        dismissible: false,
      });
    }
    const buyerHtml = this.email({
      status: d.needsBankDetails
        ? { tone: 'pending', label: 'Action needed' }
        : { tone: 'success', label: 'Cancelled & refunded' },
      headline: d.needsBankDetails
        ? 'Order cancelled — we need your bank details to refund you'
        : 'Order cancelled',
      body: `Hi ${b(buyerName)}, we've cancelled your order for ${b(d.listingTitle)}. ${refundLine}`,
      rows: [
        { label: 'Reference', value: d.transactionId.slice(-8).toUpperCase() },
        { label: 'Refund', value: formatRand(d.buyerTotal) },
        {
          label: 'Refund destination',
          value: d.manualEft ? 'Your bank account (EFT)' : 'Original payment card',
        },
      ],
      cta: d.needsBankDetails
        ? { label: 'Add bank details', url: `${this.appUrl}/profile/edit` }
        : { label: 'Browse listings', url: `${this.appUrl}/` },
      preheader: d.needsBankDetails
        ? 'Action needed — add bank details for your refund'
        : `Cancelled & refunded ${formatRand(d.buyerTotal)} for ${d.listingTitle}`,
    });
    await this.send(d.buyer.email, 'Order cancelled: ' + d.listingTitle, buyerHtml);
    await this.sendSms(
      d.buyer.phone,
      d.needsBankDetails
        ? `All Outdoor: order for ${truncate(d.listingTitle, 30)} cancelled. Add your bank details at gungalore.co.za/profile/edit so we can EFT your ${formatRand(d.buyerTotal)} refund.`
        : `All Outdoor: order for ${truncate(d.listingTitle, 30)} cancelled. ${formatRand(d.buyerTotal)} refunded${d.manualEft ? ' by EFT (1-3 business days)' : ' to your card'}.`,
      `buyer-cancel-buyer-${d.transactionId}`,
    );

    const sellerHtml = this.email({
      status: { tone: 'pending', label: 'Order cancelled' },
      headline: 'Buyer cancelled — item relisted',
      body: `Hi ${b(sellerName)}, the buyer cancelled their order for ${b(d.listingTitle)} before you dispatched it. The funds held have been returned to them and your listing is back on the marketplace — no action needed and no strike to your account.`,
      rows: [
        { label: 'Reference', value: d.transactionId.slice(-8).toUpperCase() },
        { label: 'Buyer reason', value: truncate(d.reason, 120) },
      ],
      cta: { label: 'Open order', url: txUrl },
      preheader: `${d.listingTitle} cancelled by buyer — relisted`,
    });
    await this.send(d.seller.email, 'Buyer cancelled: ' + d.listingTitle, sellerHtml);
    await this.sendSms(
      d.seller.phone,
      `All Outdoor: buyer cancelled ${truncate(d.listingTitle, 30)} before dispatch. It's back on the marketplace. No strike.`,
      `buyer-cancel-seller-${d.transactionId}`,
    );
  }

  // ---------------------------------------------------------------
  // M3 — admin issued a FULL refund on a held order. The seller did
  // nothing wrong (admin decision), so this is a neutral 'refunded +
  // relisted, no strike' note — mirrors the buyer-cancel seller email.
  // Fire-and-forget from admin.refundTransaction on the fully-refunded
  // branch only (a partial leaves the sale live).
  // ---------------------------------------------------------------
  async refundIssuedSeller(d: {
    sellerEmail: string;
    sellerName: string;
    sellerPhone: string | null;
    listingTitle: string;
    transactionId: string;
  }) {
    const txUrl = `${this.appUrl}/transactions/${d.transactionId}`;
    const html = this.email({
      status: { tone: 'pending', label: 'Order refunded' },
      headline: 'Order refunded — item relisted',
      body: `Hi ${b(d.sellerName)}, the order for ${b(d.listingTitle)} was refunded to the buyer by our support team. The funds held were returned to them and your listing is back on the marketplace — no action needed and no strike to your account.`,
      rows: [
        { label: 'Reference', value: d.transactionId.slice(-8).toUpperCase() },
        { label: 'Item', value: truncate(d.listingTitle, 60) },
      ],
      cta: { label: 'Open order', url: txUrl },
      preheader: `${d.listingTitle} refunded — relisted, no strike`,
    });
    await this.send(d.sellerEmail, 'Order refunded: ' + d.listingTitle, html);
    await this.sendSms(
      d.sellerPhone,
      `All Outdoor: the order for ${truncate(d.listingTitle, 30)} was refunded by support. It's back on the marketplace. No strike.`,
      `admin-refund-seller-${d.transactionId}`,
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
      `All Outdoor: Contact ${sellerName}${d.seller.phone ? ' on ' + d.seller.phone : ''} to arrange the dealer meet for ${truncate(d.listingTitle, 30)}.`,
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
      `All Outdoor: ${truncate(d.listingTitle, 30)} sold to ${buyerName}${d.buyer.phone ? ' (' + d.buyer.phone + ')' : ''}. Payment released. Arrange the dealer meet.`,
      `pa-seller-${d.transactionId}`,
    );

    // FLOW-F4 (M24) — a PRIVATE_ARRANGE sale has no accept/dispatch step, so
    // it must NOT create the courier 'new_sale — accept within 48h'
    // (dismissible:false) inbox row. Instead drop a truthful, DISMISSIBLE
    // seller row so the inbox isn't silent and nothing becomes a permanent
    // nag (nothing resolves rows on a healthy PA — funds are already out).
    await this.persistByEmail(d.seller.email, {
      category: 'SELLER',
      type: 'new_sale',
      title: 'Your listing sold',
      body: `${d.listingTitle} sold — payment released. Arrange the SAPS dealer meet with the buyer.`,
      url: `/transactions/${d.transactionId}`,
      iconKey: 'sold',
      linkedType: 'transaction',
      linkedId: d.transactionId,
      dismissible: true,
    });
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
      `All Outdoor: New question on ${truncate(d.listingTitle, 30)}. Reply: ${url}`,
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
    // ⚠️ THIS DOES NOT ASK ABOUT KEEPING THEIR ID, AND IT DID FOR ABOUT AN
    // HOUR. Operator, 2026-08-23: "Remove this from all other forms of
    // communication and just prompt the user straight after KYC submission."
    //
    // The reasoning is better than what it replaced. Approval can land days
    // after the upload, by which time the question is about a document they
    // have stopped thinking about — and it never lands at all for somebody
    // whose verification fails, even though we are holding their ID either
    // way. The ask belongs at the moment they hand it over, on screen, once.
    // See the consent window on the KYC page.
    const html = this.email({
      status: { tone: 'success', label: 'Verified' },
      headline: 'Identity verified',
      body: `Hi ${b(sellerName)}, your identity has been verified. Your pending sale can now proceed — pack and dispatch as soon as you're ready.`,
      cta: { label: 'Go to dashboard', url: `${this.appUrl}/dashboard` },
      preheader: 'Your identity has been verified',
    });
    await this.send(sellerEmail, 'Identity verified — All Outdoor', html);
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

  // Seller: a buyer rated one of their sales. 1–2★ gets the phone buzz
  // (forcePush) so the seller can reply quickly; 3–5★ stays inbox/email.
  async ratingReceived(d: {
    email: string;
    name: string;
    buyerUsername: string;
    stars: number;
    comment: string | null;
    sellerUserId: string;
  }) {
    const starsLabel = `${d.stars}★`;
    await this.persist({
      userId: d.sellerUserId,
      category: 'SELLER',
      type: 'rating_received',
      title: `New ${starsLabel} review`,
      body: `${d.buyerUsername} rated a purchase ${starsLabel}${d.comment ? ` — “${truncate(d.comment, 80)}”` : ''}`,
      url: '/dashboard',
      iconKey: 'offer',
      dismissible: true,
      forcePush: d.stars <= 2,
    });
    const html = this.email({
      status: {
        tone: d.stars >= 4 ? 'success' : 'pending',
        label: `${starsLabel} review`,
      },
      headline: `You received a ${starsLabel} review`,
      body: `Hi ${b(d.name)}, ${b(d.buyerUsername)} rated a recent purchase ${b(starsLabel)}.${d.comment ? ` They wrote: “${b(truncate(d.comment, 200))}”` : ''} You can post one public reply from your dashboard — a composed response to any review builds more trust than a perfect score.`,
      cta: { label: 'View & reply', url: `${this.appUrl}/dashboard` },
      preheader: `${d.buyerUsername} left a ${starsLabel} review`,
    });
    await this.send(d.email, `New ${starsLabel} review from ${d.buyerUsername}`, html);
  }

  // ---------------------------------------------------------------
  // Internal send — always fails open
  // ---------------------------------------------------------------
  private async send(to: string, subject: string, html: string) {
    if (!this.resend) return;
    if (await this.emailMuted(to)) {
      this.logger.debug(`Email muted by preference → ${to} "${subject}"`);
      return;
    }
    try {
      await this.resend.emails.send({ from: FROM, to, subject, html });
      this.logger.debug(`Email sent → ${to} "${subject}"`);
    } catch (err) {
      // Don't lose the email — park it in the outbox; the 10-min retry
      // cron re-attempts with backoff (max 5 tries, then admin alert).
      this.logger.error(
        `Email failed → ${to} "${subject}": ${(err as Error).message} — queued for retry`,
      );
      await this.prisma.emailOutbox
        .create({
          data: {
            toAddress: to,
            subject,
            html,
            attempts: 1,
            nextAttemptAt: new Date(Date.now() + 10 * 60_000),
            lastError: (err as Error).message.slice(0, 500),
          },
        })
        .catch((e) =>
          this.logger.error(
            `emailOutbox enqueue ALSO failed (email lost): ${(e as Error).message}`,
          ),
        );
    }
  }

  /**
   * Cron sweep — re-attempt parked emails. Success deletes the row;
   * failure backs off (attempts × 15 min); the 5th failure drops the row
   * with an AdminAlert so a hard-bouncing address can't retry forever.
   * Normally a no-op (the table should be empty).
   */
  async retryOutboxEmails(limit = 25): Promise<void> {
    if (!this.resend) return;
    const due = await this.prisma.emailOutbox.findMany({
      where: { nextAttemptAt: { lt: new Date() } },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
    });
    for (const row of due) {
      try {
        await this.resend.emails.send({
          from: FROM,
          to: row.toAddress,
          subject: row.subject,
          html: row.html,
        });
        await this.prisma.emailOutbox.delete({ where: { id: row.id } });
        this.logger.log(
          `Outbox email delivered on retry ${row.attempts + 1} → ${row.toAddress} "${row.subject}"`,
        );
      } catch (err) {
        const message = (err as Error).message.slice(0, 500);
        if (row.attempts >= 4) {
          await this.prisma.emailOutbox
            .delete({ where: { id: row.id } })
            .catch(() => undefined);
          await this.prisma.adminAlert
            .create({
              data: {
                type: 'email-delivery-failed',
                referenceId: row.toAddress,
                context: `Email "${row.subject}" to ${row.toAddress} failed ${row.attempts + 1} times and was dropped. Last error: ${message}`,
              },
            })
            .catch(() => undefined);
          this.logger.error(
            `Outbox email DROPPED after ${row.attempts + 1} attempts → ${row.toAddress} "${row.subject}"`,
          );
        } else {
          await this.prisma.emailOutbox
            .update({
              where: { id: row.id },
              data: {
                attempts: { increment: 1 },
                nextAttemptAt: new Date(
                  Date.now() + (row.attempts + 1) * 15 * 60_000,
                ),
                lastError: message,
              },
            })
            .catch(() => undefined);
        }
      }
    }
  }

  /**
   * A licence motivation has finished generating — either it passed the
   * quality gate and is ready to read, or the gate held it back for more
   * detail.
   *
   * ⚠️ BOTH OUTCOMES NOTIFY, and that is most of the reason this exists.
   * Generation runs detached from the request (a measured run took five
   * minutes; nginx cuts an upstream at sixty seconds), so the applicant is
   * told it is being written and then hears nothing. A document the gate held
   * back is every bit as FINISHED from where they are standing; silence on
   * that branch is the worse failure, not the kinder one.
   *
   * ⚠️ NOTHING HERE NAMES THE FIREARM, THE CALIBRE OR THE LICENCE SECTION.
   * Same rule as credentialExpiring below, and it binds every channel rather
   * than just the SMS: persist() fans out to a web push whose title and body
   * ARE the inbox row's, so an in-app row reading "your section 16 9mm
   * motivation" reaches the lock screen just as surely. The MO reference
   * identifies the document to the applicant and to support, and tells a
   * stranger standing nearby nothing at all about what is in somebody's house.
   *
   * ⚖️ "READY" MEANS WRITTEN, NEVER APPROVED. No channel may imply an outcome
   * at SAPS. The applicant checks the facts and submits it as their own — see
   * DISCLAIMER_TEXT in motivations.service.ts, which is what they signed.
   */
  async motivationFinished(d: {
    userId: string;
    email: string;
    phone: string | null;
    name: string;
    motivationId: string;
    referenceNumber: string;
    /**
     * 'ready' = passed the gate. 'held' = NEEDS_MORE_INFO after the gate.
     *
     * ⚠️ 'failed' = IT DID NOT WRITE AT ALL, and it exists because of a live
     * silence. 2026-08-22: the operator pressed Prepare, the button greyed
     * out, came back — and nothing else ever happened. Only the two SUCCESS
     * paths called this; every failure branch returned quietly, so the one
     * outcome where somebody is definitely still waiting was the one outcome
     * nobody was told about. A detached run has no other way to reach them.
     */
    outcome: 'ready' | 'held' | 'failed';
  }) {
    // ⚠️ THE REBUILT WIZARD, NOT THE OLD PAGE — AND IT IS SAFE IN BOTH STATES.
    //
    // This notification is sent after every generation, so its link is the one
    // that outlives the cutover: every SMS and email already delivered carries
    // whatever path was hardcoded when it was sent, and none of them can be
    // recalled. Pointing it at the page we are retiring would mean every
    // member who generates from the new wizard is sent back to the old one.
    //
    // It does NOT need the build flag. /licence-services/[id] redirects to
    // /motivations/[id] whenever the flag is off, so this path resolves
    // correctly in both directions — which is exactly the property a link
    // sitting in somebody's inbox for a year needs.
    const path = `/licence-services/${d.motivationId}`;
    const url = `${this.appUrl}${path}`;
    const ready = d.outcome === 'ready';
    const failed = d.outcome === 'failed';

    const headline = failed
      ? 'We could not finish your document'
      : ready
        ? 'Your document is ready'
        : 'Your document needs a bit more detail';

    await this.persist({
      userId: d.userId,
      category: 'ACCOUNT',
      type: failed
        ? 'motivation_failed'
        : ready
          ? 'motivation_ready'
          : 'motivation_needs_more_info',
      title: headline,
      body: failed
        ? // ⚖️ OURS, NOT THEIRS. A failure here is our machinery, and telling
          // somebody their own answers were at fault would be both untrue and
          // the thing that stops them trying again. Nothing was charged and
          // nothing was lost — say so, because that is the first thing anyone
          // wonders.
          `Something went wrong on our side while writing ${d.referenceNumber}. Nothing you entered is lost and nothing has been charged. Open it and prepare it again.`
        : ready
          ? `${d.referenceNumber} is written. Open it to read it through and download the pack.`
          : `${d.referenceNumber} is written, but we held it back — it needs more detail before it is ready to file. Open it to add what is missing.`,
      url: path,
      // The frontend icon set has no document glyph; 'account' is the
      // supported alias for the neutral account mark (notification-item.tsx).
      iconKey: 'account',
      // linkedType + linkedId give the push a stable tag, so the "ready"
      // message REPLACES the earlier "needs more detail" one on the same
      // document instead of stacking two contradictory rows on a lock screen.
      linkedType: 'motivation',
      linkedId: d.motivationId,
      // Dismissible because NOTHING calls resolveByEntity for a motivation —
      // a non-dismissible row here could never be cleared and would sit in the
      // inbox forever. forcePush buys the buzz back: this is the one event the
      // applicant is actively sitting and waiting for.
      dismissible: true,
      forcePush: true,
    });

    // ⚠️ ASCII ONLY — an em dash or a curly apostrophe drops the message out
    // of GSM-7 into UCS-2 and halves the segment to 70 characters. Both of
    // these clear 160 with a 25-character cuid in the URL.
    await this.sendSms(
      d.phone,
      failed
        ? `All Outdoor: we could not finish document ${d.referenceNumber}. Nothing is lost and nothing was charged. Open it and try again: ${url}`
        : ready
          ? `All Outdoor: your document ${d.referenceNumber} is ready. Read it and download the pack: ${url}`
          : `All Outdoor: your document ${d.referenceNumber} needs more detail before it is ready. Open it: ${url}`,
      // The outcome is in the reference so a regenerate is a distinct send
      // rather than something that looks like a duplicate of the first.
      `motivation-${d.outcome}-${d.motivationId}`,
    );

    const html = this.email({
      status: failed
        ? { tone: 'error', label: 'Not finished' }
        : ready
          ? { tone: 'success', label: 'Ready' }
          : { tone: 'pending', label: 'More detail needed' },
      headline,
      body: failed
        ? `Hi ${b(d.name)}, we could not finish writing ${b(d.referenceNumber)}. This is a fault on our side, not anything you did, and it is being looked at. Everything you entered is saved exactly as you left it and nothing has been charged for this attempt — open the document and press prepare again. If it happens twice, write to ${SUPPORT_EMAIL} with the reference number and a person will pick it up.`
        : ready
        ? `Hi ${b(d.name)}, ${b(d.referenceNumber)} is written and waiting for you. Read it through against your own papers before you sign it — you submit it as your own, so every fact in it has to be one you can stand behind. The pack is rebuilt each time you download it, so come back for another copy whenever you need one.`
        : // ⚠️ IT DOES NOT PROMISE QUESTIONS. A held-back document only queues a
          // follow-up when a field is actually EMPTY, and by then none can be
          // (prepareGeneration refuses to start with a required answer
          // missing) — so an applicant told "answer the questions" can arrive
          // to a page with none on it. Hence the last sentence: there is
          // always a way forward, even when nothing is being asked.
          `Hi ${b(d.name)}, ${b(d.referenceNumber)} is written, but our own quality check held it back rather than hand you something thin to file. Nothing is lost — open it, read the draft as it stands, and add detail wherever we have asked for it, then prepare it again. If there is nothing there to answer, reply to this email or write to ${SUPPORT_EMAIL} and a person will look at it.`,
      cta: {
        label: failed
          ? 'Open your document'
          : ready
            ? 'Read your document'
            : 'Open your document',
        url,
      },
      preheader: failed
        ? `${d.referenceNumber} did not finish — nothing lost, nothing charged`
        : ready
          ? `${d.referenceNumber} is ready to read and download`
          : `${d.referenceNumber} needs a bit more detail`,
    });
    await this.send(d.email, `${headline} — ${d.referenceNumber}`, html);
  }

  // Wrap SmsService so each shipping-notification call site doesn't
  // have to repeat the null-check + try/catch. Always fails open —
  // SMS hiccups must never block the rest of the order flow. Skips
  // entirely when `to` is missing (user without a phone) so we don't
  // burn SMSPortal credits on no-ops.
  /**
   * A document in the member's Licence Centre is coming up for renewal.
   *
   * ⚖️ WE REMIND; WE NEVER ENSURE. No "we'll make sure you never miss a
   * renewal" — that is an outcome promise, and the responsibility to renew is
   * the member's in law. Every channel says the document as printed governs.
   *
   * ⚠️ THE SMS NEVER SAYS "FIREARM". An SMS preview lands on a lock screen in
   * front of whoever is standing nearby; "a document in your Document Centre"
   * carries the same urgency and tells a stranger nothing about what is in
   * somebody's house.
   *
   * PRICING MODEL C: the in-app notification is free for everyone — it is
   * where the upgrade lands, at the moment the deadline is actually felt. SMS
   * and email are AO Pro.
   */
  async credentialExpiring(d: {
    userId: string;
    phone: string | null;
    name: string;
    email: string;
    credentialId: string;
    title: string;
    expiresOn: Date;
    daysLeft: number;
    stage: 'T180' | 'T120' | 'T100' | 'T30' | 'D0';
    smsEnabled: boolean;
    emailEnabled: boolean;
  }) {
    // ⚠️ THE MEMBER-FACING PATH, WHICH IS NOW /documents. The backend
    // prefix is unchanged; only what a person clicks moved.
    const url = `${this.appUrl}/documents`;
    const on = d.expiresOn.toISOString().slice(0, 10);
    const gone = d.stage === 'D0';
    // The last two stages and the expiry itself are the ones worth a push and
    // a badge that does not clear itself.
    const actionable = d.stage === 'T100' || d.stage === 'T30' || gone;

    const headline = gone
      ? 'A document in your Document Centre has expired'
      : 'A document in your Document Centre is expiring';

    await this.persist({
      userId: d.userId,
      category: 'ACCOUNT',
      type: gone ? 'licence_centre_expired' : `licence_centre_expiry_${d.stage.replace(/^T/, '')}`,
      title: headline,
      body: gone
        ? `${d.title} expired on ${on}. The document as printed always governs.`
        : `${d.title} expires on ${on} — ${d.daysLeft} days away. Start the renewal well before then.`,
      url: '/documents',
      iconKey: 'kyc',
      // linkedType + linkedId give the push a stable tag, so a later stage
      // REPLACES the earlier notification instead of stacking on it.
      linkedType: 'credential',
      linkedId: d.credentialId,
      dismissible: !actionable,
    });

    if (d.smsEnabled) {
      await this.sendSms(
        d.phone,
        gone
          ? `All Outdoor: a document in your Document Centre has expired. Check it: ${url}`
          : `All Outdoor: a document in your Document Centre expires in ${d.daysLeft} days. Check it: ${url}`,
        `lc-expiry-${d.credentialId}-${d.stage}`,
      );
    }

    if (d.emailEnabled) {
      // ⚠️ b() escapes. d.title is member-typed and body is raw HTML.
      const html = this.email({
        status: {
          tone: gone ? 'error' : 'pending',
          label: gone ? 'Expired' : 'Renewal due',
        },
        headline,
        body: `Hi ${b(d.name)}, ${b(d.title)} ${gone ? 'expired on' : 'expires on'} ${b(on)}. We remind you; we cannot renew it for you, and the document as printed always governs. If this date is wrong, correct it in your Document Centre.`,
        cta: { label: 'Open Document Centre', url },
        preheader: `${d.title}: ${gone ? 'expired' : 'expiring soon'}`,
      });
      await this.send(d.email, headline, html);
    }
  }

  private async sendSms(
    to: string | null | undefined,
    message: string,
    reference: string,
    opts?: {
      /** Delivery-essential service message (courier PIN / waybill):
       *  bypasses the SMS-mute preference. Muting is for notification
       *  chatter — a muted seller still needs the PIN to hand over the
       *  parcel. Use sparingly; everything else respects the mute. */
      critical?: boolean;
    },
  ) {
    if (!to || to.trim().length === 0) return;
    if (!opts?.critical && (await this.smsMuted(to))) {
      this.logger.debug(`SMS muted by preference → ${to} (${reference})`);
      return;
    }
    try {
      await this.sms.sendSms({ to: to.trim(), message, reference });
    } catch (err) {
      this.logger.warn(
        `SMS failed → ${to} (${reference}): ${(err as Error).message}`,
      );
    }
  }

  // ─────────────────── Notification preference gate ──────────────────
  // A registered user can mute email or SMS entirely. NotificationsService
  // is the single chokepoint for both channels, so the check lives here.
  // Resolves the recipient by address and fails OPEN — a lookup error must
  // never silently swallow a notification. Anonymous recipients (no
  // matching user, e.g. a checkout email before sign-up) are always sent.
  // ---------------------------------------------------------------
  // THE SELLER'S CONSENT LINK, BY EMAIL.
  //
  // Operator, 2026-08-28: "Email so we can send him an email with the link to
  // open a form he can fill out with an upload and Scan QR method to get any
  // documents to us."
  //
  // ⚠️ HE IS NOT OUR USER AND NEVER WILL BE. So this cannot go through
  // persistByEmail — that resolves an address to a User row and silently does
  // nothing when there is not one, which is every seller. It sends directly,
  // the same way sap534ForSeller already emails a seller who has no account.
  //
  // ⚠️ AND IT NAMES THE FIREARM AND THE BUYER IN THE SUBJECT. A stranger
  // receiving a link about a firearm transfer needs to know, before opening
  // anything, who it is from and what it concerns. Anything vaguer reads as
  // phishing, and a seller who deletes it as phishing is a stalled
  // application nobody can explain.
  // ---------------------------------------------------------------
  async sellerConsentInvite(d: {
    email: string;
    sellerName: string;
    applicantName: string;
    firearmLine: string;
    url: string;
    /** Hours the link stays live, so the mail can say it rather than imply it. */
    expiresInHours: number;
  }) {
    const html = this.email({
      status: { tone: 'pending', label: 'Consent needed' },
      headline: 'Confirm a firearm you are selling',
      body:
        `Hi ${b(d.sellerName)}, ${b(d.applicantName)} is applying to the SAPS for a licence ` +
        `over a firearm they are buying from you — ${b(d.firearmLine)}.<br><br>` +
        'Before that application can be lodged, the current owner has to confirm the ' +
        'firearm is lawfully theirs and sign one section of the form. That is you, and ' +
        'it takes about two minutes on your phone.<br><br>' +
        'You will be asked to photograph or upload your licence card and your ID, and to ' +
        'sign a short declaration. <b>Each document is saved the moment you send it</b>, ' +
        'so you can stop and come back, and you can remove anything you sent by mistake.',
      rows: [
        { label: 'Firearm', value: d.firearmLine },
        { label: 'Applicant', value: d.applicantName },
        { label: 'Link valid for', value: `${d.expiresInHours} hours` },
      ],
      cta: { label: 'Open the form', url: d.url },
      preheader: `${d.applicantName} needs your consent for ${d.firearmLine}`,
    });
    await this.send(
      d.email,
      `${d.applicantName} needs your consent — ${d.firearmLine}`,
      html,
    );
  }

  private async emailMuted(to: string): Promise<boolean> {
    try {
      const u = await this.prisma.user.findUnique({
        where: { email: to.trim() },
        select: { notifyEmailEnabled: true },
      });
      return u ? u.notifyEmailEnabled === false : false;
    } catch {
      return false;
    }
  }

  private async smsMuted(to: string): Promise<boolean> {
    try {
      const u = await this.prisma.user.findFirst({
        where: { phone: to.trim() },
        select: { notifySmsEnabled: true },
      });
      return u ? u.notifySmsEnabled === false : false;
    } catch {
      return false;
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
    // These describe the SHAPE of the delivery, not the company carrying it.
    // The enum stopped naming a carrier when Bob Go moved in behind both slots,
    // and a buyer told "Pudo Locker" about a Bob Box parcel would go looking
    // for the wrong thing. The shape is true on either rail, and where a
    // specific point matters the copy already names that point.
    case 'PUDO':
      return 'Collection point';
    case 'TCG':
      return 'Door delivery';
    // Firearms: exactly two hand-overs, both through a licensed dealer.
    // Never "private collection".
    case 'DEALER_TRANSFER':
      return 'Dealer stock transfer';
    case 'PRIVATE_ARRANGE':
      return 'Arrange privately at a dealer';
    default:
      return method.replace(/_/g, ' ').toLowerCase();
  }
}

// Same idea but specifically for the "courier" slot on the
// sale-shipped template — PUDO / TCG are the only realistic values
// once we're at the dispatched stage. Anything else collapses to a
// generic label.
function prettyCourier(method: string | null | undefined): string {
  // Same reasoning as prettyShippingMethod: the slot is not a carrier name any
  // more. This one feeds a "courier" row, so it says how the parcel travels
  // rather than inventing a company that may not be carrying it.
  if (method === 'PUDO') return 'Collection point delivery';
  if (method === 'TCG') return 'Door delivery';
  return 'Courier';
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
