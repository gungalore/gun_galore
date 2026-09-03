import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReferenceNumberService } from '../common/reference-number.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { NotificationsService } from '../notifications/notifications.service';

// The complaint categories the intake form offers. Kept as plain strings
// (stored on Complaint.category) so adding one is a one-line change with no
// migration. The three PAYOUT_AFFECTING ones, when a BUYER lodges them
// against a still-HELD order, flip that order to DISPUTED to block payout.
export const COMPLAINT_CATEGORIES = [
  'ITEM_NOT_AS_DESCRIBED',
  'DAMAGED',
  'NOT_ARRIVED',
  'PAYOUT',
  'DELIVERY',
  'ACCOUNT',
  'LISTING',
  // "I can't get to the item / it's further than I thought."
  //
  // DELIBERATELY absent from PAYOUT_AFFECTING and URGENT_CATEGORIES below. The
  // policy says location is not a refund ground; if lodging it froze the
  // seller's money, the term would be defeated on day one by the very
  // complaint it refuses. It exists so a buyer in that position has somewhere
  // real to go — otherwise they pick NOT_ARRIVED, which IS payout-affecting
  // and CAS-flips the order to DISPUTED. This category is the pressure valve
  // that keeps that from happening.
  'LOCATION_OR_ACCESS',
  'OTHER',
] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

const PAYOUT_AFFECTING = new Set<string>([
  'ITEM_NOT_AS_DESCRIBED',
  'DAMAGED',
  'NOT_ARRIVED',
]);

// Categories serious enough to flag the operator alert as urgent.
const URGENT_CATEGORIES = new Set<string>([
  'ITEM_NOT_AS_DESCRIBED',
  'DAMAGED',
  'NOT_ARRIVED',
  'PAYOUT',
]);

const MAX_PHOTOS = 6;

@Injectable()
export class ComplaintsService {
  private readonly logger = new Logger(ComplaintsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reference: ReferenceNumberService,
    private readonly cloudinary: CloudinaryService,
    // NotificationsModule is @Global — no module import needed. Used to tell
    // the complainant when their case moves; silence on a case that froze
    // someone's money reads as being ignored.
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------------
  // Lodge a complaint. Allocates a CO-case number, optionally links an
  // order (verified server-side that the complainant is a party to it),
  // and — for a buyer's payout-affecting complaint on a still-HELD order —
  // flips that order to DISPUTED so payout is blocked pending review.
  // ------------------------------------------------------------------
  async create(
    clerkId: string,
    dto: {
      category: string;
      subject: string;
      body: string;
      transactionId?: string | null;
    },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true, username: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const category = (dto.category ?? '').trim().toUpperCase();
    if (!COMPLAINT_CATEGORIES.includes(category as ComplaintCategory)) {
      throw new BadRequestException('Please choose a valid complaint category.');
    }
    const subject = (dto.subject ?? '').trim();
    const body = (dto.body ?? '').trim();
    if (subject.length < 3) {
      throw new BadRequestException('Please give the complaint a short subject.');
    }
    if (body.length < 15) {
      throw new BadRequestException(
        'Please describe the issue in at least 15 characters so we can investigate.',
      );
    }

    // Verify the linked order (if any) belongs to the complainant, and
    // work out which side of it they are on.
    let transactionId: string | null = null;
    let role: 'BUYER' | 'SELLER' = 'BUYER';
    let heldTx: {
      id: string;
      paymentStatus: string;
      paidAt: Date | null;
      swapId: string | null;
      adminNote: string | null;
      listingTitle: string;
    } | null = null;

    if (dto.transactionId) {
      const tx = await this.prisma.transaction.findUnique({
        where: { id: dto.transactionId },
        select: {
          id: true,
          buyerId: true,
          sellerId: true,
          paymentStatus: true,
          paidAt: true,
          swapId: true,
          adminNote: true,
          listing: { select: { title: true } },
        },
      });
      if (!tx) throw new NotFoundException('That order could not be found.');
      if (tx.buyerId !== user.id && tx.sellerId !== user.id) {
        throw new ForbiddenException('That order is not yours.');
      }
      transactionId = tx.id;
      role = tx.buyerId === user.id ? 'BUYER' : 'SELLER';
      heldTx = {
        id: tx.id,
        paymentStatus: tx.paymentStatus,
        paidAt: tx.paidAt,
        swapId: tx.swapId,
        adminNote: tx.adminNote,
        listingTitle: tx.listing?.title ?? 'item',
      };
    }

    const referenceNumber = await this.reference.allocate('CO');

    const complaint = await this.prisma.complaint.create({
      data: {
        referenceNumber,
        userId: user.id,
        role,
        category,
        subject,
        body,
        transactionId,
      },
      select: { id: true, referenceNumber: true },
    });

    // Payout hold — a buyer's payout-affecting complaint on a still-HELD,
    // non-swap, paid order moves that order to DISPUTED so it can't be
    // released while we investigate. CAS on paymentStatus='HELD' so we never
    // clobber a concurrent release/refund; if it already moved, we simply
    // don't hold (the money is no longer HELD anyway).
    let drovePayoutHold = false;
    if (
      heldTx &&
      role === 'BUYER' &&
      PAYOUT_AFFECTING.has(category) &&
      heldTx.paidAt &&
      heldTx.paymentStatus === 'HELD' &&
      !heldTx.swapId
    ) {
      const note = `[COMPLAINT ${referenceNumber}: ${category.replace(/_/g, ' ')}] ${body.slice(0, 400)}`;
      const held = await this.prisma.transaction.updateMany({
        where: { id: heldTx.id, paymentStatus: 'HELD' },
        data: {
          paymentStatus: 'DISPUTED',
          adminNote: heldTx.adminNote ? `${heldTx.adminNote}\n\n${note}` : note,
        },
      });
      if (held.count > 0) {
        drovePayoutHold = true;
        await this.prisma.complaint.update({
          where: { id: complaint.id },
          data: { drovePayoutHold: true },
        });
        // Best-effort timeline row so buyer + seller see the hold landed.
        await this.prisma.trackingEvent
          .create({
            data: {
              transactionId: heldTx.id,
              status: 'COMPLAINT_LODGED',
              source: 'INTERNAL',
              message: `Buyer lodged complaint ${referenceNumber} — payout held pending review`,
              occurredAt: new Date(),
            },
          })
          .catch(() => undefined);
      }
    }

    // Operator alert → surfaces in /admin/alerts (and the admin complaints
    // queue). Urgent for serious categories.
    await this.prisma.adminAlert
      .create({
        data: {
          type: 'COMPLAINT_LODGED',
          referenceId: complaint.id,
          urgent: URGENT_CATEGORIES.has(category),
          context: JSON.stringify({
            referenceNumber,
            category,
            role,
            transactionId,
            drovePayoutHold,
            complainant: user.username ?? undefined,
            subject: subject.slice(0, 120),
          }),
        },
      })
      .catch((err) =>
        this.logger.warn(
          `Complaint ${referenceNumber} alert insert failed: ${(err as Error).message}`,
        ),
      );

    this.logger.log(
      `Complaint ${referenceNumber} lodged (${category}) by ${user.username ?? user.id}` +
        (drovePayoutHold ? ` — order ${transactionId} held` : ''),
    );

    return { id: complaint.id, referenceNumber, drovePayoutHold };
  }

  // Attach an evidence photo. Owner-only; capped; NOT run through listing
  // moderation (evidence legitimately contains contact info). Streams to
  // Cloudinary server-side (same primitive as listing images).
  async addPhoto(
    clerkId: string,
    complaintId: string,
    file: { buffer: Buffer } | undefined,
  ) {
    if (!file?.buffer) throw new BadRequestException('No photo provided.');
    const complaint = await this.owned(clerkId, complaintId);
    const count = await this.prisma.complaintPhoto.count({
      where: { complaintId: complaint.id },
    });
    if (count >= MAX_PHOTOS) {
      throw new BadRequestException(`Up to ${MAX_PHOTOS} photos per complaint.`);
    }
    const { url, publicId } = await this.cloudinary.uploadImage(
      file.buffer,
      'complaints',
    );
    const photo = await this.prisma.complaintPhoto.create({
      data: { complaintId: complaint.id, url, publicId, order: count },
      select: { id: true, url: true },
    });
    return photo;
  }

  // The signed-in user's own complaints (newest first) with photos + a thin
  // linked-order summary.
  async listMine(clerkId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return this.prisma.complaint.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        referenceNumber: true,
        category: true,
        subject: true,
        status: true,
        outcome: true,
        drovePayoutHold: true,
        createdAt: true,
        resolvedAt: true,
        photos: { select: { id: true, url: true }, orderBy: { order: 'asc' } },
        transaction: {
          select: {
            id: true,
            listing: { select: { title: true, referenceNumber: true } },
          },
        },
      },
    });
  }

  private async owned(clerkId: string, complaintId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const complaint = await this.prisma.complaint.findUnique({
      where: { id: complaintId },
      select: { id: true, userId: true },
    });
    if (!complaint) throw new NotFoundException('Complaint not found');
    if (complaint.userId !== user.id) {
      throw new ForbiddenException('That complaint is not yours.');
    }
    return complaint;
  }

  // ─── Admin ────────────────────────────────────────────────────────
  /**
   * The admin complaints register.
   *
   * 🚨 THIS WAS UNBOUNDED — no `take` at all — so it returned every complaint
   * ever logged, with each row's full body and every photo, on one request.
   * That is survivable at today's volume and is a wall the moment the table
   * grows; a register that times out is a register nobody can work from.
   *
   * ⚠️ THE RESPONSE IS NOW AN ENVELOPE, {rows, total, page, limit}. The Desk
   * pile does NOT come through here — it reads Prisma directly in
   * desk.service.ts — so the only HTTP consumer is fetchCases, which reads
   * both shapes so a version skew cannot blank the register. (An earlier bug
   * on this rebuild did exactly that: a type claiming an envelope over a bare
   * array rendered an empty alerts inbox with alerts waiting.)
   */
  async adminList(status?: string, page = 1, limit = 50) {
    const take = Math.min(Math.max(limit, 1), 100);
    const skip = Math.max(page - 1, 0) * take;
    const where = status ? { status } : undefined;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.complaint.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      skip,
      take,
      select: {
        id: true,
        referenceNumber: true,
        role: true,
        category: true,
        subject: true,
        body: true,
        status: true,
        assignedAdminId: true,
        outcome: true,
        drovePayoutHold: true,
        createdAt: true,
        // The register sorts and shows "last touched"; without this the
        // column is blank on every complaint row while support has one.
        updatedAt: true,
        resolvedAt: true,
        user: { select: { username: true, email: true } },
        photos: { select: { id: true, url: true }, orderBy: { order: 'asc' } },
        transaction: {
          select: {
            id: true,
            paymentStatus: true,
            listing: { select: { title: true, referenceNumber: true } },
          },
        },
      },
      }),
      this.prisma.complaint.count({ where }),
    ]);
    return { rows, total, page: Math.max(page, 1), limit: take };
  }

  /**
   * One complaint, by id or by reference number.
   *
   * 🚨 THIS EXISTS BECAUSE THE FRONTEND WAS PULLING THE WHOLE REGISTER TO READ
   * ONE ROW. desk-case.ts's own comment recorded it as a known exposure:
   * adminList selects user.email on every row, so opening a SINGLE complaint
   * dragged every complainant's address into the operator's browser, where
   * nothing rendered it but a screen-share or a screenshot of the network tab
   * would. That comment named this endpoint as the fix.
   *
   * ⚠️ AND PAGING MADE IT A CORRECTNESS BUG, not just a privacy one. Once
   * adminList takes a limit, "fetch the register and find the row" silently
   * fails for any complaint past the first page — reported to the operator as
   * "no case in the register", which reads as deleted rather than unfetched.
   *
   * Accepts a reference number too, because that is what a member quotes.
   */
  async adminGet(idOrReference: string) {
    const complaint = await this.prisma.complaint.findFirst({
      where: {
        OR: [{ id: idOrReference }, { referenceNumber: idOrReference }],
      },
      select: {
        id: true,
        referenceNumber: true,
        role: true,
        category: true,
        subject: true,
        body: true,
        status: true,
        assignedAdminId: true,
        outcome: true,
        drovePayoutHold: true,
        createdAt: true,
        updatedAt: true,
        resolvedAt: true,
        user: { select: { username: true, email: true } },
        photos: { select: { id: true, url: true }, orderBy: { order: 'asc' } },
        transaction: {
          select: {
            id: true,
            paymentStatus: true,
            listing: { select: { title: true, referenceNumber: true } },
          },
        },
      },
    });
    if (!complaint) throw new NotFoundException('Complaint not found');
    return complaint;
  }

  async adminUpdate(
    adminId: string,
    complaintId: string,
    dto: { status?: string; assignedAdminId?: string; outcome?: string },
  ) {
    const complaint = await this.prisma.complaint.findUnique({
      where: { id: complaintId },
      select: {
        id: true,
        status: true,
        subject: true,
        drovePayoutHold: true,
        user: {
          select: { email: true, firstName: true, phone: true },
        },
      },
    });
    if (!complaint) throw new NotFoundException('Complaint not found');

    const status = dto.status?.trim().toUpperCase();
    const closing = status === 'RESOLVED' || status === 'CLOSED';

    const updated = await this.prisma.complaint.update({
      where: { id: complaintId },
      data: {
        status: status ?? undefined,
        assignedAdminId: dto.assignedAdminId ?? adminId,
        outcome: dto.outcome ?? undefined,
        resolvedAt: closing ? new Date() : undefined,
      },
      select: { id: true, referenceNumber: true, status: true, outcome: true },
    });

    // Tell the complainant their case moved. Only on the transitions that
    // mean something to them — resolved/closed (the verdict) and
    // awaiting-user (we need something from them, so silence stalls the
    // case). Skipped when the status didn't actually change, so re-saving
    // an assignee or editing the outcome note doesn't re-notify. SMS only
    // for cases that froze money — everything else is email + inbox.
    // Fire-and-forget: a notification failure must never fail the admin's
    // update or leave the case in a half-written state.
    const statusChanged = !!status && status !== complaint.status;
    if (statusChanged && (closing || status === 'AWAITING_USER')) {
      void this.notifications
        .complaintStatusChanged({
          email: complaint.user.email,
          name: complaint.user.firstName ?? 'there',
          phone: complaint.drovePayoutHold ? complaint.user.phone : null,
          referenceNumber: updated.referenceNumber,
          subject: complaint.subject,
          status: updated.status,
          outcome: updated.outcome,
          heldPayout: complaint.drovePayoutHold,
        })
        .catch((err) =>
          this.logger.warn(
            `complaint status notify failed for ${updated.referenceNumber}: ${(err as Error).message}`,
          ),
        );
    }

    // Resolve the alert when the case closes so the inbox count clears.
    if (closing) {
      await this.prisma.adminAlert
        .updateMany({
          where: { type: 'COMPLAINT_LODGED', referenceId: complaintId, resolved: false },
          data: { resolved: true, resolvedAt: new Date() },
        })
        .catch(() => undefined);
    }
    return updated;
  }
}
