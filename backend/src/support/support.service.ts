import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

// Support ticketing (Phase 7 P7.2) — a user-initiated, non-dispute help
// channel. Disputes stay per-transaction; this is for everything else
// (payment questions, account help, "where's my order"). Threaded replies
// from the user or an admin; status drives the admin queue + the
// command-center attention count (via an AdminAlert).

const CATEGORIES = ['general', 'payment', 'shipping', 'account', 'listing', 'other'];

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private async userId(clerkId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    if (!u) throw new NotFoundException('User not found');
    return u.id;
  }

  // ─── User side ───────────────────────────────────────────────────
  async createTicket(
    clerkId: string,
    dto: { subject?: string; body?: string; category?: string; transactionId?: string },
  ) {
    const subject = (dto.subject ?? '').trim();
    const body = (dto.body ?? '').trim();
    if (subject.length < 3 || subject.length > 150) {
      throw new BadRequestException('Subject must be 3–150 characters');
    }
    if (body.length < 5 || body.length > 4000) {
      throw new BadRequestException('Message must be 5–4000 characters');
    }
    const category = CATEGORIES.includes(dto.category ?? '') ? dto.category! : 'general';
    const userId = await this.userId(clerkId);

    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId,
        subject,
        category,
        transactionId: dto.transactionId ?? null,
        status: 'OPEN',
        replies: {
          create: { body, fromAdmin: false, authorClerkId: clerkId },
        },
      },
      include: { replies: { orderBy: { createdAt: 'asc' } } },
    });

    // Surface in the admin attention queue.
    void this.prisma.adminAlert
      .create({
        data: {
          type: 'SUPPORT_TICKET_OPENED',
          referenceId: ticket.id,
          context: `New support ticket (${category}): ${subject.slice(0, 80)}`,
        },
      })
      .catch(() => undefined);

    return ticket;
  }

  async listMine(clerkId: string) {
    const userId = await this.userId(clerkId);
    return this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        replies: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { replies: true } },
      },
    });
  }

  async getMine(clerkId: string, id: string) {
    const userId = await this.userId(clerkId);
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: { replies: { orderBy: { createdAt: 'asc' } } },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.userId !== userId) throw new ForbiddenException('Not authorised');
    return ticket;
  }

  async replyAsUser(clerkId: string, id: string, body: string) {
    const trimmed = (body ?? '').trim();
    if (trimmed.length < 1 || trimmed.length > 4000) {
      throw new BadRequestException('Reply must be 1–4000 characters');
    }
    const userId = await this.userId(clerkId);
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      select: { id: true, userId: true, status: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.userId !== userId) throw new ForbiddenException('Not authorised');
    if (ticket.status === 'CLOSED') {
      throw new BadRequestException('This ticket is closed. Open a new one if you still need help.');
    }

    await this.prisma.supportTicketReply.create({
      data: { ticketId: id, body: trimmed, fromAdmin: false, authorClerkId: clerkId },
    });
    // User responded → back to OPEN (needs our attention) + re-open the alert.
    await this.prisma.supportTicket.update({
      where: { id },
      data: { status: 'OPEN' },
    });
    void this.prisma.adminAlert
      .updateMany({
        where: { type: 'SUPPORT_TICKET_OPENED', referenceId: id, resolved: true },
        data: { resolved: false, resolvedAt: null },
      })
      .catch(() => undefined);
    return this.getMine(clerkId, id);
  }

  async closeMine(clerkId: string, id: string) {
    const userId = await this.userId(clerkId);
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.userId !== userId) throw new ForbiddenException('Not authorised');
    await this.prisma.supportTicket.update({
      where: { id },
      data: { status: 'CLOSED' },
    });
    void this.resolveAlert(id);
    return { ok: true };
  }

  // ─── Admin side ──────────────────────────────────────────────────
  async listForAdmin(status?: string) {
    const where = status ? { status: status as never } : {};
    return this.prisma.supportTicket.findMany({
      where,
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      include: {
        user: { select: { id: true, username: true, email: true } },
        replies: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { replies: true } },
      },
      take: 200,
    });
  }

  async getForAdmin(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, username: true, email: true } },
        replies: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  async replyAsAdmin(adminId: string, id: string, body: string) {
    const trimmed = (body ?? '').trim();
    if (trimmed.length < 1 || trimmed.length > 4000) {
      throw new BadRequestException('Reply must be 1–4000 characters');
    }
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      select: { id: true, userId: true, subject: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    await this.prisma.supportTicketReply.create({
      data: { ticketId: id, body: trimmed, fromAdmin: true, adminId },
    });
    // Admin replied → waiting on the user; clear the attention alert.
    await this.prisma.supportTicket.update({
      where: { id },
      data: { status: 'AWAITING_USER' },
    });
    void this.resolveAlert(id);

    // Notify the user a reply is waiting (in-app inbox).
    void this.notifications
      .persist({
        userId: ticket.userId,
        category: 'BUYER',
        type: 'support_reply',
        title: 'Support replied to your ticket',
        body: `We've replied to "${ticket.subject.slice(0, 60)}". Tap to read + respond.`,
        url: `/support/${id}`,
        iconKey: 'transaction',
      })
      .catch(() => undefined);

    return this.getForAdmin(id);
  }

  async resolve(adminId: string, id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      select: { id: true, userId: true, subject: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    await this.prisma.supportTicket.update({
      where: { id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    void this.resolveAlert(id);
    void this.notifications
      .persist({
        userId: ticket.userId,
        category: 'BUYER',
        type: 'support_resolved',
        title: 'Support ticket resolved',
        body: `Your ticket "${ticket.subject.slice(0, 60)}" was marked resolved. Reply if you still need help.`,
        url: `/support/${id}`,
        iconKey: 'transaction',
      })
      .catch(() => undefined);
    return { ok: true };
  }

  private async resolveAlert(ticketId: string) {
    await this.prisma.adminAlert
      .updateMany({
        where: { type: 'SUPPORT_TICKET_OPENED', referenceId: ticketId, resolved: false },
        data: { resolved: true, resolvedAt: new Date() },
      })
      .catch(() => undefined);
  }
}
