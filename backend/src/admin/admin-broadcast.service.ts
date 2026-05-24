import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AdminAuditService } from './admin-audit.service';

/**
 * Admin broadcast comms — send a one-off email or SMS to an audience.
 *
 * Three audience scopes:
 *   - 'individual'     — single user (by userId)
 *   - 'segment'        — predefined segment (all-sellers, kyc-pending, etc.)
 *   - 'all-users'      — every non-banned account; gated behind a typed
 *                        confirmation in the UI because it costs real
 *                        money + spams real humans.
 *
 * Two channels:
 *   - 'email'  — uses the platform's transactional Resend channel.
 *   - 'sms'    — uses SMSPortal; skips users without a verified phone.
 *
 * Every broadcast records an AdminAuditEvent with the audience,
 * channel, recipient count, and a summary of the body. Failures
 * (individual send errors) are logged but don't fail the call — the
 * recipient count returned is the number SENT, not attempted.
 */

export type BroadcastChannel = 'email' | 'sms';
export type BroadcastAudience =
  | { kind: 'individual'; userId: string }
  | { kind: 'segment'; segment: BroadcastSegment }
  | { kind: 'all-users' };

export type BroadcastSegment =
  | 'all-sellers'        // users with ≥1 listing in any status
  | 'all-active-sellers' // sellers with ≥1 ACTIVE listing
  | 'kyc-pending'        // kycRequiredAt set, not VERIFIED, not banned
  | 'kyc-stalled'        // kyc-pending + kycRequiredAt > 24h ago
  | 'all-buyers';        // users with ≥1 transaction as buyer

export interface BroadcastDto {
  channel: BroadcastChannel;
  audience: BroadcastAudience;
  subject?: string;  // email only — required when channel=email
  body: string;      // plain text for SMS; will be wrapped in basic HTML for email
}

@Injectable()
export class AdminBroadcastService {
  private readonly logger = new Logger(AdminBroadcastService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AdminAuditService,
  ) {}

  // Preview the recipient count for a given audience without sending
  // anything. The UI calls this when the admin selects an audience so
  // they see "this will go to N users" before committing.
  async preview(audience: BroadcastAudience, channel: BroadcastChannel): Promise<{ count: number }> {
    const users = await this.resolveRecipients(audience, channel);
    return { count: users.length };
  }

  async send(adminId: string, dto: BroadcastDto) {
    if (!dto.body || dto.body.trim().length < 5) {
      throw new BadRequestException('Body must be at least 5 characters.');
    }
    if (dto.channel === 'email' && (!dto.subject || dto.subject.trim().length < 3)) {
      throw new BadRequestException('Email subject is required (≥3 chars).');
    }

    const recipients = await this.resolveRecipients(dto.audience, dto.channel);
    if (recipients.length === 0) {
      throw new BadRequestException(
        'Audience resolved to 0 recipients — re-check segment / individual selection.',
      );
    }

    // Hard ceiling — admin can't accidentally fan out to >5000 users
    // in one call. If the legit audience is larger we'd want a
    // batched/queued sender, which is out of scope for now.
    if (recipients.length > 5000) {
      throw new BadRequestException(
        `Audience too large (${recipients.length} recipients). Cap is 5,000 per broadcast.`,
      );
    }

    let sent = 0;
    let skipped = 0;
    const body = dto.body.trim();
    const subject = (dto.subject ?? '').trim();
    const html = wrapAsHtml(body);
    const reference = `broadcast-${Date.now()}`;

    for (const u of recipients) {
      if (dto.channel === 'email') {
        if (!u.email) {
          skipped += 1;
          continue;
        }
        await this.notifications.sendBroadcastEmail(u.email, subject, html);
        sent += 1;
      } else {
        if (!u.phone) {
          skipped += 1;
          continue;
        }
        await this.notifications.sendBroadcastSms(u.phone, body, reference);
        sent += 1;
      }
      // Inbox: write a row per recipient regardless of channel so the
      // broadcast also appears in their Notifications page Account tab.
      // Dismissible — informational, no action to take.
      // Fire-and-forget; persist() catches errors internally so a
      // single user's inbox-row failure won't break the broadcast.
      const inboxTitle =
        subject || (dto.channel === 'email' ? 'Announcement' : 'Message');
      const inboxBody = body.length > 240 ? body.slice(0, 237) + '…' : body;
      await this.notifications.persist({
        userId: u.id,
        category: 'ACCOUNT',
        type: 'broadcast',
        title: inboxTitle,
        body: inboxBody,
        iconKey: 'broadcast',
        dismissible: true,
      });
    }

    // Audit row — captures who fanned out what to whom + the body
    // summary (truncated to keep the log readable).
    await this.audit.record({
      adminUserId: adminId,
      action: 'BROADCAST_SENT',
      resourceType: 'Broadcast',
      resourceId: reference,
      newValue: {
        channel: dto.channel,
        audience: dto.audience,
        recipientCount: recipients.length,
        sent,
        skipped,
        subject: subject || null,
        bodyPreview: body.slice(0, 200),
      },
      reason: `Broadcast ${dto.channel} → ${this.describeAudience(dto.audience)} (${sent} sent)`,
    });

    this.logger.log(
      `Broadcast ${dto.channel} → ${this.describeAudience(dto.audience)}: ${sent} sent, ${skipped} skipped`,
    );
    return { sent, skipped, total: recipients.length };
  }

  // -------------------------------------------------------------------
  // Internal — resolve audience → list of {email, phone}
  // -------------------------------------------------------------------
  private async resolveRecipients(
    audience: BroadcastAudience,
    channel: BroadcastChannel,
  ): Promise<{ email: string; phone: string | null; id: string }[]> {
    // We always exclude banned users — sending to them is wasteful +
    // gives a banned account a comms surface they shouldn't have.
    const baseWhere = { isBanned: false };

    if (audience.kind === 'individual') {
      const u = await this.prisma.user.findUnique({
        where: { id: audience.userId },
        select: { id: true, email: true, phone: true, isBanned: true },
      });
      if (!u || u.isBanned) return [];
      return [{ id: u.id, email: u.email, phone: u.phone }];
    }

    if (audience.kind === 'all-users') {
      return this.prisma.user.findMany({
        where: {
          ...baseWhere,
          ...(channel === 'sms' ? { phone: { not: null }, phoneVerified: true } : {}),
        },
        select: { id: true, email: true, phone: true },
      });
    }

    // Segment.
    const day = 24 * 3600 * 1000;
    switch (audience.segment) {
      case 'all-sellers':
        return this.prisma.user.findMany({
          where: { ...baseWhere, listings: { some: {} } },
          select: { id: true, email: true, phone: true },
        });
      case 'all-active-sellers':
        return this.prisma.user.findMany({
          where: {
            ...baseWhere,
            listings: { some: { status: 'ACTIVE' } },
          },
          select: { id: true, email: true, phone: true },
        });
      case 'kyc-pending':
        return this.prisma.user.findMany({
          where: {
            ...baseWhere,
            kycRequiredAt: { not: null },
            kycStatus: { not: 'VERIFIED' },
          },
          select: { id: true, email: true, phone: true },
        });
      case 'kyc-stalled':
        return this.prisma.user.findMany({
          where: {
            ...baseWhere,
            kycRequiredAt: { not: null, lt: new Date(Date.now() - day) },
            kycStatus: { not: 'VERIFIED' },
          },
          select: { id: true, email: true, phone: true },
        });
      case 'all-buyers':
        return this.prisma.user.findMany({
          where: { ...baseWhere, buyerTransactions: { some: {} } },
          select: { id: true, email: true, phone: true },
        });
      default:
        return [];
    }
  }

  private describeAudience(audience: BroadcastAudience): string {
    if (audience.kind === 'individual') return `user:${audience.userId}`;
    if (audience.kind === 'all-users') return 'all-users';
    return `segment:${audience.segment}`;
  }
}

// Wrap plain text in a minimal HTML envelope so Resend renders it
// readably. We deliberately keep this VERY basic — admins typing
// broadcasts shouldn't need to think about HTML, and Resend handles
// the wrapper styles itself.
function wrapAsHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
  return `<div style="font-family:sans-serif;line-height:1.5;color:#222;max-width:560px">${escaped}<hr style="margin-top:24px;border:none;border-top:1px solid #ddd"><p style="font-size:12px;color:#888">Sent by Gun Galore. Reply to this email if you have any questions.</p></div>`;
}
