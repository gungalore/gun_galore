import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { StitchService } from '../payments/stitch.service';
import { ZohoBooksService } from '../zoho/zoho-books.service';
import { CreateRaffleDto } from './dto/create-raffle.dto';
import { BuyTicketsDto } from './dto/buy-tickets.dto';
import { PostalEntryDto } from './dto/postal-entry.dto';
import { ReferenceNumberService } from '../common/reference-number.service';

// ---------- Tier helpers ---------------------------------------------------
// Claim window per the CLAUDE.md spec — fixed 7 days for all tiers but
// the tier itself is still surfaced on the admin dashboard for context.

function tierForValue(valueCents: number): 'LOW' | 'MID' | 'HIGH' {
  if (valueCents <= 1_000_000) return 'LOW'; // <=R10,000
  if (valueCents <= 5_000_000) return 'MID'; // R10k–R50k
  return 'HIGH';
}

function claimWindowDays(_tier: 'LOW' | 'MID' | 'HIGH') {
  return 7; // 7d for all tiers per spec
}

// Cooling window between sell-out and drawAt — 24h.
const COOLING_WINDOW_MS = 24 * 60 * 60 * 1000;

// 8-char alphanumeric reference (uppercase, no easily-confused chars).
// Used for per-ticket referenceCode + postal-entry referenceCode.
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateRef(): string {
  let s = '';
  for (let i = 0; i < 8; i += 1) {
    s += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)];
  }
  return s;
}

// The correct answer is ALWAYS option C — operator decision so we don't
// have to track per-raffle correctness in admin UX.
const CORRECT_ANSWER: 'A' | 'B' | 'C' | 'D' = 'C';

// Phase E3 — payload shape for the /raffles/me/subscriber endpoint.
// Used by the /ask-gg widget to show the user's free entry status +
// draw countdown + win state.
export interface SubscriberRaffleView {
  id: string;
  referenceNumber: string | null;
  title: string;
  description: string;
  status: string;
  subscriberDrawAt: Date | null;
  drawnAt: Date | null;
  coverImageUrl: string | null;
  isEntered: boolean;
  myTicket: {
    id: string;
    ticketNumber: number;
    referenceCode: string;
  } | null;
  didIWin: boolean;
}

@Injectable()
export class RafflesService {
  private readonly logger = new Logger(RafflesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly cloudinary: CloudinaryService,
    private readonly stitch: StitchService,
    private readonly referenceNumbers: ReferenceNumberService,
    // @Global — used by confirmTickets() to post a Sales Receipt
    // to Books for each confirmed ticket batch. Feature-flagged so
    // it's a no-op until ZOHO_BOOKS_ENABLED=true.
    private readonly zohoBooks: ZohoBooksService,
  ) {}

  // -------------------------------------------------------------------
  // Public reads
  // -------------------------------------------------------------------

  async listActive() {
    return this.prisma.raffle.findMany({
      where: { status: { in: ['ACTIVE', 'CLOSED_AWAITING_DRAW', 'DRAWN'] } },
      orderBy: { createdAt: 'desc' },
      select: this.publicSelect(),
    });
  }

  async getPublic(id: string) {
    const raffle = await this.prisma.raffle.findUnique({
      where: { id },
      select: this.publicSelect(),
    });
    if (!raffle) throw new NotFoundException('Raffle not found');
    return raffle;
  }

  // Fields safe to expose publicly. Question + options ARE public — the
  // buyer needs them to enter. The correct answer is NOT a field (it's
  // hardcoded as 'C' in CORRECT_ANSWER) so it can never leak via the API.
  private publicSelect() {
    return {
      id: true,
      referenceNumber: true,
      title: true,
      description: true,
      imageUrl: true,
      itemValueCents: true,
      itemCostCents: true,
      targetTicketCount: true,
      ticketPriceCents: true,
      ticketsSoldPaid: true,
      ticketsSoldPostal: true,
      question: true,
      optionA: true,
      optionB: true,
      optionC: true,
      optionD: true,
      startTime: true,
      drawAt: true,
      drawnAt: true,
      status: true,
      images: {
        select: { id: true, url: true, order: true, isPrimary: true },
        orderBy: { order: 'asc' as const },
      },
    };
  }

  // -------------------------------------------------------------------
  // Admin: create a raffle
  // -------------------------------------------------------------------

  async create(adminId: string, dto: CreateRaffleDto) {
    const startTime = new Date(dto.startTime);
    if (Number.isNaN(startTime.getTime())) {
      throw new BadRequestException('Invalid startTime');
    }

    // Phase E3 — subscriber raffles have completely different
    // economics. Branch early so we don't apply public-raffle
    // validation (ticket price > 0 etc.) to a free subscriber
    // entry raffle.
    const isSubscriberRaffle = !!dto.subscriberTierRestriction;

    if (!isSubscriberRaffle) {
      if (dto.itemValueCents < 1000) {
        throw new BadRequestException('Public raffles require itemValueCents >= R10');
      }
      if (dto.ticketPriceCents < 100) {
        throw new BadRequestException('Public raffles require ticketPriceCents >= R1');
      }
      if (dto.ticketPriceCents > dto.itemValueCents) {
        throw new BadRequestException(
          'Ticket price cannot be higher than the item price',
        );
      }
    }

    // tierForValue assumes a non-zero value — fall back to the
    // smallest tier band for subscriber raffles (their value is
    // hidden anyway).
    const tier = isSubscriberRaffle
      ? tierForValue(1000)
      : tierForValue(dto.itemValueCents);

    // Public raffles derive targetTicketCount from value/price.
    // Subscriber raffles have no sell-out trigger (cron drives the
    // draw via subscriberDrawAt), so 0 is the correct sentinel.
    const targetTicketCount = isSubscriberRaffle
      ? 0
      : Math.ceil(dto.itemValueCents / dto.ticketPriceCents);

    // 48h auto-draw timer for subscriber raffles. Operator publishes
    // → cron drives the draw two days later automatically.
    const subscriberDrawAt = isSubscriberRaffle
      ? new Date(Date.now() + 48 * 60 * 60 * 1000)
      : null;

    // Allocate the RAxxxxxx reference before insert.
    const referenceNumber = await this.referenceNumbers.allocateForRaffle();

    const raffle = await this.prisma.raffle.create({
      data: {
        referenceNumber,
        title: dto.title,
        description: dto.description,
        imageUrl: dto.imageUrl ?? null,
        itemValueCents: dto.itemValueCents,
        itemCostCents: dto.itemCostCents,
        targetTicketCount,
        ticketPriceCents: dto.ticketPriceCents,
        question: dto.question,
        optionA: dto.optionA,
        optionB: dto.optionB,
        optionC: dto.optionC,
        optionD: dto.optionD,
        startTime,
        status: startTime <= new Date() ? 'ACTIVE' : 'DRAFT',
        createdByAdminId: adminId,
        // Phase E3 — subscriber-raffle fields.
        subscriberTierRestriction: dto.subscriberTierRestriction ?? null,
        autoEnterSubscribers: isSubscriberRaffle,
        subscriberDrawAt,
        // Operator can toggle hidePrizeValue independently for
        // public raffles, but subscriber raffles force it on so
        // we never accidentally reveal an off-platform-sized prize.
        hidePrizeValue:
          dto.hidePrizeValue !== undefined
            ? dto.hidePrizeValue
            : isSubscriberRaffle,
      },
    });

    await this.recordEvent(
      raffle.id,
      'CREATED',
      {
        tier,
        ticketPriceCents: dto.ticketPriceCents,
        targetTicketCount,
        itemCostCents: dto.itemCostCents,
        itemValueCents: dto.itemValueCents,
        subscriberTierRestriction: dto.subscriberTierRestriction ?? null,
      },
      undefined,
      adminId,
    );

    // Phase E3 — auto-enter every active subscriber the moment the
    // raffle is ACTIVE. If it's still in DRAFT (future startTime),
    // the open() admin call will trigger this instead. Snapshot
    // semantics: only users subscribed AT THIS MOMENT are entered.
    if (isSubscriberRaffle && raffle.status === 'ACTIVE') {
      await this.autoEnterSubscribers(raffle.id);
    }

    return { raffle };
  }

  /**
   * Phase E3 — issue a free CONFIRMED ticket to every active
   * subscriber of the matching tier.
   *
   *   MEMBER raffle → Members + Pros (Pros get TWO entries per week
   *                                    because Pro raffle also runs)
   *   PRO raffle    → Pros only
   *
   * Skips users who already have a CONFIRMED ticket for this raffle
   * (idempotent — safe to re-run on open()).
   */
  private async autoEnterSubscribers(raffleId: string): Promise<number> {
    const raffle = await this.prisma.raffle.findUnique({
      where: { id: raffleId },
      select: {
        id: true,
        title: true,
        subscriberTierRestriction: true,
        ticketsSoldPaid: true,
      },
    });
    if (!raffle) return 0;
    const restriction = raffle.subscriberTierRestriction;
    if (!restriction) return 0;

    // Build the eligible-tier set. PRO raffle = Pros only; MEMBER
    // raffle = Members + Pros (Pros get value from both).
    const eligibleTiers =
      restriction === 'PRO' ? ['PRO'] : ['MEMBER', 'PRO'];

    const subscribers = await this.prisma.user.findMany({
      where: {
        subscriptionTier: { in: eligibleTiers as ('MEMBER' | 'PRO')[] },
        isBanned: false,
      },
      select: { id: true, email: true },
    });

    if (subscribers.length === 0) {
      this.logger.warn(
        `Subscriber raffle ${raffleId} created with zero eligible subscribers (${restriction}).`,
      );
      return 0;
    }

    // Already-issued check (idempotent re-run).
    const existing = await this.prisma.ticket.findMany({
      where: { raffleId, buyerId: { in: subscribers.map((s) => s.id) } },
      select: { buyerId: true },
    });
    const existingIds = new Set(existing.map((t) => t.buyerId));
    const toIssue = subscribers.filter((s) => !existingIds.has(s.id));

    let issued = 0;
    await this.prisma.$transaction(async (tx) => {
      // Sequential ticketNumber per raffle. Pull current max once,
      // increment locally for each insert.
      const last = await tx.ticket.findFirst({
        where: { raffleId },
        orderBy: { ticketNumber: 'desc' },
        select: { ticketNumber: true },
      });
      let n = last?.ticketNumber ?? 0;
      for (const s of toIssue) {
        n += 1;
        await tx.ticket.create({
          data: {
            raffleId,
            buyerId: s.id,
            ticketNumber: n,
            referenceCode: generateRef(),
            status: 'CONFIRMED',
            amountCents: 0,
          },
        });
        issued += 1;
      }
      // Bump ticketsSoldPaid for the eligible-ticket count used by
      // the draw selection logic. Even though they're free, they
      // are CONFIRMED tickets that go into the eligibility pool.
      if (issued > 0) {
        await tx.raffle.update({
          where: { id: raffleId },
          data: { ticketsSoldPaid: { increment: issued } },
        });
      }
    });

    await this.recordEvent(raffleId, 'SUBSCRIBERS_AUTO_ENTERED', {
      restriction,
      issued,
      totalSubscribers: subscribers.length,
    });

    this.logger.log(
      `Auto-entered ${issued} subscriber tickets for raffle ${raffleId} (${restriction}).`,
    );
    return issued;
  }

  /** Phase E3 — current user's subscriber-raffle status. Returns
   *  the latest ACTIVE / recently-DRAWN raffle for each tier the
   *  user is eligible for. Drives the /ask-gg widget that shows
   *  "Your free entry this week" + draw countdown.
   *
   *  Non-subscribers get { upsell: true } so the widget can render
   *  the "Subscribe to enter" CTA. */
  async getMySubscriberRaffles(clerkId: string): Promise<{
    upsell: boolean;
    tier: 'FREE' | 'MEMBER' | 'PRO';
    memberRaffle: SubscriberRaffleView | null;
    proRaffle: SubscriberRaffleView | null;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true, subscriptionTier: true },
    });
    if (!user) {
      return { upsell: true, tier: 'FREE', memberRaffle: null, proRaffle: null };
    }
    const tier = user.subscriptionTier as 'FREE' | 'MEMBER' | 'PRO';

    if (tier === 'FREE') {
      return { upsell: true, tier, memberRaffle: null, proRaffle: null };
    }

    // The user is eligible for the MEMBER raffle (always, since Pros
    // are entered into both). Pros are ALSO eligible for the PRO
    // raffle.
    const memberRaffle = await this.loadSubscriberRaffleForUser(
      'MEMBER',
      user.id,
    );
    const proRaffle =
      tier === 'PRO'
        ? await this.loadSubscriberRaffleForUser('PRO', user.id)
        : null;

    return { upsell: false, tier, memberRaffle, proRaffle };
  }

  /** Helper for getMySubscriberRaffles — finds the latest ACTIVE
   *  or recently-DRAWN raffle of a tier, plus the user's ticket
   *  (if any) and the prize photo. */
  private async loadSubscriberRaffleForUser(
    tierRestriction: 'MEMBER' | 'PRO',
    userId: string,
  ): Promise<SubscriberRaffleView | null> {
    const raffle = await this.prisma.raffle.findFirst({
      where: {
        subscriberTierRestriction: tierRestriction,
        status: { in: ['ACTIVE', 'CLOSED_AWAITING_DRAW', 'DRAWN'] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        subscriberDrawAt: true,
        drawnAt: true,
        winningTicketId: true,
        referenceNumber: true,
        images: {
          where: { isPrimary: true },
          take: 1,
          select: { url: true },
        },
        imageUrl: true,
      },
    });
    if (!raffle) return null;

    const myTicket = await this.prisma.ticket.findFirst({
      where: { raffleId: raffle.id, buyerId: userId, status: 'CONFIRMED' },
      select: { id: true, ticketNumber: true, referenceCode: true },
    });

    let didIWin = false;
    if (raffle.status === 'DRAWN' && raffle.winningTicketId && myTicket) {
      didIWin = raffle.winningTicketId === myTicket.id;
    }

    return {
      id: raffle.id,
      referenceNumber: raffle.referenceNumber,
      title: raffle.title,
      description: raffle.description,
      status: raffle.status,
      subscriberDrawAt: raffle.subscriberDrawAt,
      drawnAt: raffle.drawnAt,
      coverImageUrl:
        raffle.images[0]?.url ?? raffle.imageUrl ?? null,
      isEntered: !!myTicket,
      myTicket: myTicket
        ? {
            id: myTicket.id,
            ticketNumber: myTicket.ticketNumber,
            referenceCode: myTicket.referenceCode,
          }
        : null,
      didIWin,
    };
  }

  /** Phase E3 — drive the 48h auto-draw for subscriber raffles.
   *  Called by the daily cron in TasksService. Closes + draws any
   *  subscriber raffle whose subscriberDrawAt has passed. Re-uses
   *  the existing draw() pipeline so winners + DrawProof + audit
   *  flow are identical to public raffles. */
  async runSubscriberRaffleDraws(): Promise<{ drawn: number }> {
    const due = await this.prisma.raffle.findMany({
      where: {
        subscriberTierRestriction: { not: null },
        status: 'ACTIVE',
        subscriberDrawAt: { lte: new Date() },
      },
      select: { id: true, title: true, subscriberTierRestriction: true },
    });
    let drawn = 0;
    for (const r of due) {
      try {
        // Move to CLOSED_AWAITING_DRAW first (the existing draw()
        // expects this) then immediately call draw.
        await this.prisma.raffle.update({
          where: { id: r.id },
          data: { status: 'CLOSED_AWAITING_DRAW' },
        });
        await this.runDraw(r.id);
        drawn += 1;
        this.logger.log(`Subscriber raffle ${r.id} drew successfully.`);
      } catch (err) {
        this.logger.error(
          `Subscriber raffle ${r.id} draw failed: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
    return { drawn };
  }

  // -------------------------------------------------------------------
  // Admin: open a DRAFT raffle (move it ACTIVE)
  // -------------------------------------------------------------------

  async open(adminId: string, raffleId: string) {
    const raffle = await this.prisma.raffle.findUnique({ where: { id: raffleId } });
    if (!raffle) throw new NotFoundException('Raffle not found');
    if (raffle.status !== 'DRAFT') {
      throw new BadRequestException('Raffle is not in DRAFT');
    }
    const updated = await this.prisma.raffle.update({
      where: { id: raffleId },
      data: {
        status: 'ACTIVE',
        // Phase E3 — start the 48h auto-draw countdown from
        // OPEN time, not from create-time (operator might have
        // drafted the raffle days earlier).
        ...(raffle.subscriberTierRestriction
          ? {
              subscriberDrawAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
            }
          : {}),
      },
    });
    await this.recordEvent(raffleId, 'OPENED', null, undefined, adminId);

    // Phase E3 — snapshot subscribers at OPEN time.
    if (raffle.subscriberTierRestriction) {
      await this.autoEnterSubscribers(raffleId);
    }

    return updated;
  }

  // -------------------------------------------------------------------
  // Admin: multi-image upload (mirrors ListingsService.addImage)
  // -------------------------------------------------------------------

  async addImage(adminId: string, raffleId: string, file: Express.Multer.File) {
    const raffle = await this.prisma.raffle.findUnique({ where: { id: raffleId } });
    if (!raffle) throw new NotFoundException('Raffle not found');

    const imageCount = await this.prisma.raffleImage.count({
      where: { raffleId },
    });
    if (imageCount >= 10) {
      throw new BadRequestException('Maximum 10 images per raffle');
    }

    const { url, publicId } = await this.cloudinary.uploadImage(
      file.buffer,
      'raffles',
    );

    const created = await this.prisma.raffleImage.create({
      data: {
        raffleId,
        url,
        publicId,
        order: imageCount,
        isPrimary: imageCount === 0,
      },
    });

    // Keep the legacy single `imageUrl` field in sync with the first
    // uploaded image so older code that reads it still works.
    if (imageCount === 0) {
      await this.prisma.raffle.update({
        where: { id: raffleId },
        data: { imageUrl: url },
      });
    }

    await this.recordEvent(raffleId, 'IMAGE_ADDED', { imageId: created.id }, undefined, adminId);
    return created;
  }

  async removeImage(adminId: string, raffleId: string, imageId: string) {
    const image = await this.prisma.raffleImage.findFirst({
      where: { id: imageId, raffleId },
    });
    if (!image) throw new NotFoundException('Image not found');

    await this.cloudinary.deleteImage(image.publicId).catch((err) => {
      this.logger.warn(`Cloudinary delete failed for ${image.publicId}: ${(err as Error).message}`);
    });
    await this.prisma.raffleImage.delete({ where: { id: imageId } });

    if (image.isPrimary) {
      const next = await this.prisma.raffleImage.findFirst({
        where: { raffleId },
        orderBy: { order: 'asc' },
      });
      if (next) {
        await this.prisma.raffleImage.update({
          where: { id: next.id },
          data: { isPrimary: true },
        });
        await this.prisma.raffle.update({
          where: { id: raffleId },
          data: { imageUrl: next.url },
        });
      } else {
        await this.prisma.raffle.update({
          where: { id: raffleId },
          data: { imageUrl: null },
        });
      }
    }

    await this.recordEvent(raffleId, 'IMAGE_REMOVED', { imageId }, undefined, adminId);
  }

  // -------------------------------------------------------------------
  // Buy tickets (question-gated)
  // -------------------------------------------------------------------
  //
  // Returns the freshly-issued ticket IDs along with a single ZAR-cents
  // total. The caller (transactions service) takes those tickets to Peach
  // for a one-shot checkout. On payment success the controller calls
  // `confirmTickets`. On Peach failure the tickets stay PENDING_PAYMENT and
  // are swept by the cron after 30 minutes.
  //
  // Tickets are NON-REFUNDABLE per the operator's rules — the only
  // refund path is the admin "refund all buyers" button, which is for
  // when the operator chooses to cancel the raffle entirely.
  async createPendingTickets(clerkId: string, raffleId: string, dto: BuyTicketsDto) {
    const buyer = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!buyer) throw new ForbiddenException('User not synced');
    if (buyer.isBanned) throw new ForbiddenException('Account suspended');

    const raffle = await this.prisma.raffle.findUnique({ where: { id: raffleId } });
    if (!raffle) throw new NotFoundException('Raffle not found');
    if (raffle.status !== 'ACTIVE') {
      throw new BadRequestException('Raffle is not selling tickets');
    }
    if (new Date() < raffle.startTime) {
      throw new BadRequestException('Raffle has not started yet');
    }

    if (dto.answer !== CORRECT_ANSWER) {
      throw new BadRequestException('Incorrect answer to the question');
    }

    // Refuse oversells — if the requested quantity would push sold past
    // target, bail out before reserving anything.
    const totalSold = raffle.ticketsSoldPaid + raffle.ticketsSoldPostal;
    if (totalSold + dto.quantity > raffle.targetTicketCount) {
      const remaining = raffle.targetTicketCount - totalSold;
      throw new BadRequestException(
        remaining <= 0
          ? 'This raffle is sold out'
          : `Only ${remaining} ticket${remaining === 1 ? '' : 's'} remaining`,
      );
    }

    // Allocate ticket numbers atomically — we read the next number from the
    // raffle and bump it inside a transaction so two concurrent buyers can
    // never collide.
    return this.prisma.$transaction(async (tx) => {
      const counted = await tx.ticket.count({
        where: {
          raffleId,
          status: { in: ['CONFIRMED', 'POSTAL', 'PENDING_PAYMENT'] },
        },
      });

      const created: { id: string; ticketNumber: number; referenceCode: string }[] = [];
      for (let i = 0; i < dto.quantity; i += 1) {
        const t = await tx.ticket.create({
          data: {
            raffleId,
            buyerId: buyer.id,
            ticketNumber: counted + i + 1,
            referenceCode: generateRef(),
            status: 'PENDING_PAYMENT',
            amountCents: raffle.ticketPriceCents,
          },
        });
        created.push({
          id: t.id,
          ticketNumber: t.ticketNumber,
          referenceCode: t.referenceCode,
        });
      }

      return {
        ticketIds: created.map((t) => t.id),
        tickets: created,
        totalCents: raffle.ticketPriceCents * dto.quantity,
        raffle: { id: raffle.id, title: raffle.title },
      };
    });
  }

  // Called by the transactions/payment success handler. Marks the bundle
  // of tickets CONFIRMED and bumps the sold counter on the raffle. If
  // this purchase pushes the raffle to sold-out, immediately moves it
  // into CLOSED_AWAITING_DRAW with a 24h cooling window.
  async confirmTickets(ticketIds: string[], peachPaymentId: string) {
    if (ticketIds.length === 0) return;
    return this.prisma.$transaction(async (tx) => {
      const tickets = await tx.ticket.findMany({
        where: { id: { in: ticketIds }, status: 'PENDING_PAYMENT' },
      });
      if (tickets.length === 0) return;

      const raffleId = tickets[0].raffleId;
      for (const t of tickets) {
        if (t.raffleId !== raffleId) {
          throw new BadRequestException('Tickets span multiple raffles');
        }
      }

      await tx.ticket.updateMany({
        where: { id: { in: tickets.map((t) => t.id) } },
        data: {
          status: 'CONFIRMED',
          peachPaymentId,
          paidAt: new Date(),
        },
      });

      const updatedRaffle = await tx.raffle.update({
        where: { id: raffleId },
        data: { ticketsSoldPaid: { increment: tickets.length } },
      });

      await this.recordEvent(
        raffleId,
        'TICKETS_CONFIRMED',
        { ticketIds: tickets.map((t) => t.id), count: tickets.length },
      );

      // Sold-out trigger — drop into 24h cooling window.
      const totalSold = updatedRaffle.ticketsSoldPaid + updatedRaffle.ticketsSoldPostal;
      if (
        updatedRaffle.status === 'ACTIVE' &&
        totalSold >= updatedRaffle.targetTicketCount
      ) {
        const drawAt = new Date(Date.now() + COOLING_WINDOW_MS);
        await tx.raffle.update({
          where: { id: raffleId },
          data: { status: 'CLOSED_AWAITING_DRAW', drawAt },
        });
        await this.recordEvent(raffleId, 'SOLD_OUT', { drawAt: drawAt.toISOString() });
      }
    });

    // Zoho Books: create a Sales Receipt for the confirmed batch.
    // Outside the DB transaction — Books shouldn't block the ticket
    // confirmation. Fire-and-forget; failures stamp FAILED status on
    // the ticket rows so admin can retry.
    void this.zohoBooks.createRaffleTicketSalesReceipt(ticketIds);
  }

  // -------------------------------------------------------------------
  // Postal entries (admin)
  // -------------------------------------------------------------------
  //
  // CPA Section 36 free-entry route. Admin keys these from the posted-in
  // PDF forms.

  async createPostalEntry(adminId: string, dto: PostalEntryDto) {
    const raffle = await this.prisma.raffle.findUnique({ where: { id: dto.raffleId } });
    if (!raffle) throw new NotFoundException('Raffle not found');
    if (!['ACTIVE', 'CLOSED_AWAITING_DRAW'].includes(raffle.status)) {
      throw new BadRequestException('Raffle is not accepting postal entries');
    }

    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.postalEntry.create({
        data: {
          raffleId: dto.raffleId,
          referenceCode: dto.referenceCode.toUpperCase(),
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          email: dto.email,
          address: dto.address,
          enteredByAdminId: adminId,
        },
      });

      const counted = await tx.ticket.count({
        where: { raffleId: dto.raffleId, status: { in: ['CONFIRMED', 'POSTAL', 'PENDING_PAYMENT'] } },
      });

      const tickets = [];
      for (let i = 0; i < dto.ticketCount; i += 1) {
        const t = await tx.ticket.create({
          data: {
            raffleId: dto.raffleId,
            ticketNumber: counted + i + 1,
            referenceCode: generateRef(),
            status: 'POSTAL',
            postalEntryId: entry.id,
          },
        });
        tickets.push(t);
      }
      const updatedRaffle = await tx.raffle.update({
        where: { id: dto.raffleId },
        data: { ticketsSoldPostal: { increment: tickets.length } },
      });

      await this.recordEvent(
        dto.raffleId,
        'POSTAL_ENTRY_ADDED',
        { entryId: entry.id, ticketCount: tickets.length, referenceCode: entry.referenceCode },
        undefined,
        adminId,
      );

      // Postal tickets can also tip the raffle over the sold-out edge.
      const totalSold = updatedRaffle.ticketsSoldPaid + updatedRaffle.ticketsSoldPostal;
      if (
        updatedRaffle.status === 'ACTIVE' &&
        totalSold >= updatedRaffle.targetTicketCount
      ) {
        const drawAt = new Date(Date.now() + COOLING_WINDOW_MS);
        await tx.raffle.update({
          where: { id: dto.raffleId },
          data: { status: 'CLOSED_AWAITING_DRAW', drawAt },
        });
        await this.recordEvent(dto.raffleId, 'SOLD_OUT', { drawAt: drawAt.toISOString(), via: 'POSTAL' });
      }

      return { entry, tickets };
    });
  }

  // -------------------------------------------------------------------
  // Cron: run draws for closed raffles past their cooling window
  // -------------------------------------------------------------------

  async runReadyDraws() {
    const now = new Date();
    const candidates = await this.prisma.raffle.findMany({
      where: { status: 'CLOSED_AWAITING_DRAW', drawAt: { lte: now } },
      select: { id: true },
    });
    let processed = 0;
    for (const r of candidates) {
      try {
        await this.runDraw(r.id);
        processed += 1;
      } catch (err) {
        this.logger.error(`Draw failed for raffle ${r.id}: ${(err as Error).message}`);
      }
    }
    return { processed };
  }

  // Verifiable draw — process:
  //   1. crypto.randomBytes(32) → seed
  //   2. sha256(seed) → seedHash (published with the draw row)
  //   3. For each winner position i, sha256(seed || ":" || i) → 48-bit index
  //      with rejection sampling to avoid mod bias.
  //
  // Tickets are non-refundable (per spec), so we don't have a
  // min-ticket cancellation path — if a raffle sold zero tickets it
  // just runs against a zero pool and the admin has to refund-all.
  async runDraw(raffleId: string) {
    return this.prisma.$transaction(async (tx) => {
      const raffle = await tx.raffle.findUnique({ where: { id: raffleId } });
      if (!raffle) return;
      if (raffle.status !== 'CLOSED_AWAITING_DRAW') return;

      const eligible = await tx.ticket.findMany({
        where: { raffleId, status: { in: ['CONFIRMED', 'POSTAL'] } },
        select: { id: true, ticketNumber: true, buyerId: true, postalEntryId: true },
        orderBy: { ticketNumber: 'asc' },
      });
      if (eligible.length === 0) {
        // Nothing to draw against — admin will have to handle (refund-all).
        await tx.raffle.update({
          where: { id: raffleId },
          data: { status: 'CANCELLED_BY_ADMIN' },
        });
        await this.recordEvent(raffleId, 'NO_ELIGIBLE_TICKETS', null);
        return { outcome: 'NO_ELIGIBLE_TICKETS' };
      }

      // 1 winner + up to 2 backups, each from a distinct ticket.
      const seedBytes = randomBytes(32);
      const seedHex = seedBytes.toString('hex');
      const seedHash = createHash('sha256').update(seedBytes).digest('hex');

      const winners: { ticketId: string; position: number; userId: string | null }[] = [];
      const usedTicketIds = new Set<string>();

      for (let i = 0; i < 3 && winners.length < eligible.length && winners.length < 3; i += 1) {
        const subSeed = createHash('sha256')
          .update(seedBytes)
          .update(':')
          .update(String(i))
          .digest();

        const N = eligible.length;
        const idx = pickModBig(subSeed, N);
        const candidate = eligible[idx];
        if (!candidate || usedTicketIds.has(candidate.id)) {
          let probe = (idx + 1) % N;
          while (probe !== idx && usedTicketIds.has(eligible[probe].id)) {
            probe = (probe + 1) % N;
          }
          if (probe === idx) break;
          winners.push({
            ticketId: eligible[probe].id,
            position: winners.length + 1,
            userId: eligible[probe].buyerId,
          });
          usedTicketIds.add(eligible[probe].id);
        } else {
          winners.push({
            ticketId: candidate.id,
            position: winners.length + 1,
            userId: candidate.buyerId,
          });
          usedTicketIds.add(candidate.id);
        }
      }

      const tier = tierForValue(raffle.itemValueCents);
      const claimDeadline = new Date(
        Date.now() + claimWindowDays(tier) * 24 * 60 * 60 * 1000,
      );

      for (const w of winners) {
        await tx.raffleWinner.create({
          data: {
            raffleId,
            userId: w.userId,
            ticketId: w.ticketId,
            position: w.position,
            claimDeadline,
          },
        });
      }

      await tx.raffle.update({
        where: { id: raffleId },
        data: {
          status: 'DRAWN',
          drawnAt: new Date(),
          drawSeed: seedHex,
          drawSeedHash: seedHash,
          winningTicketId: winners[0]?.ticketId ?? null,
          claimDeadline,
        },
      });

      await this.recordEvent(raffleId, 'DRAW_RUN', {
        seedHash,
        winners: winners.map((w) => ({ position: w.position, ticketId: w.ticketId })),
      });

      // Notify winner #1 (best-effort)
      const w1 = winners[0];
      if (w1?.userId) {
        const user = await tx.user.findUnique({ where: { id: w1.userId } });
        if (user?.email) {
          void this.notifications.raffleWinnerPicked(
            user.email,
            raffle.title,
            w1.position,
            claimDeadline,
          );
        }
      }

      return { outcome: 'DRAWN', winners };
    });
  }

  // -------------------------------------------------------------------
  // Cron: roll claim windows
  // -------------------------------------------------------------------

  async expireClaims() {
    const now = new Date();
    const lapsed = await this.prisma.raffleWinner.findMany({
      where: { claimDeadline: { lte: now }, claimedAt: null, forfeitedAt: null },
      orderBy: [{ raffleId: 'asc' }, { position: 'asc' }],
    });
    let processed = 0;
    for (const w of lapsed) {
      try {
        await this.prisma.raffleWinner.update({
          where: { id: w.id },
          data: { forfeitedAt: now },
        });
        await this.recordEvent(w.raffleId, 'WINNER_FORFEIT', {
          position: w.position,
        });
        processed += 1;

        const next = await this.prisma.raffleWinner.findFirst({
          where: { raffleId: w.raffleId, position: w.position + 1 },
        });
        if (next?.userId) {
          // AUDIT H5 — RESET the promoted backup's claimDeadline.
          // At draw time every position shares position-1's deadline,
          // so a backup promoted after the primary forfeits is
          // already past deadline and gets force-forfeited on the
          // very next cron pass. Reset to a fresh tier-correct window
          // BEFORE notifying so the email shows the real deadline.
          const raffle = await this.prisma.raffle.findUnique({
            where: { id: w.raffleId },
            select: { itemValueCents: true },
          });
          const tier = tierForValue(raffle?.itemValueCents ?? 1000);
          const freshDeadline = new Date(
            Date.now() + claimWindowDays(tier) * 24 * 60 * 60 * 1000,
          );
          const updatedNext = await this.prisma.raffleWinner.update({
            where: { id: next.id },
            data: { claimDeadline: freshDeadline },
          });
          const user = await this.prisma.user.findUnique({ where: { id: next.userId } });
          if (user?.email) {
            void this.notifications.raffleBackupPromoted(
              user.email,
              w.raffleId,
              updatedNext.claimDeadline,
            );
          }
          await this.recordEvent(w.raffleId, 'BACKUP_PROMOTED', {
            from: w.position,
            to: next.position,
            newDeadline: updatedNext.claimDeadline.toISOString(),
          });
        } else {
          await this.prisma.raffle.update({
            where: { id: w.raffleId },
            data: { status: 'EXPIRED_UNCLAIMED' },
          });
        }
      } catch (err) {
        this.logger.error(
          `expireClaims failed for winner ${w.id}: ${(err as Error).message}`,
        );
      }
    }
    return { processed };
  }

  // -------------------------------------------------------------------
  // Winner claim
  // -------------------------------------------------------------------

  async claimPrize(clerkId: string, winnerId: string) {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new ForbiddenException('User not synced');

    const winner = await this.prisma.raffleWinner.findUnique({
      where: { id: winnerId },
      include: { raffle: true },
    });
    if (!winner) throw new NotFoundException('Winner record not found');
    if (winner.userId !== user.id) {
      throw new ForbiddenException('This claim is not yours');
    }
    if (winner.claimedAt) return { claimedAt: winner.claimedAt };
    if (winner.forfeitedAt) {
      throw new BadRequestException('Claim window has expired');
    }
    if (new Date() > winner.claimDeadline) {
      throw new BadRequestException('Claim window has expired');
    }

    const claimedAt = new Date();
    await this.prisma.raffleWinner.update({
      where: { id: winnerId },
      data: { claimedAt },
    });
    if (winner.position === 1) {
      await this.prisma.raffle.update({
        where: { id: winner.raffleId },
        data: { status: 'CLAIMED' },
      });
    }
    await this.recordEvent(winner.raffleId, 'WINNER_CLAIMED', {
      position: winner.position,
    });
    return { claimedAt };
  }

  // List of raffle wins the signed-in user has — used for the dashboard.
  async getMyWins(clerkId: string) {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new ForbiddenException('User not synced');
    return this.prisma.raffleWinner.findMany({
      where: { userId: user.id },
      include: {
        raffle: {
          select: {
            id: true,
            title: true,
            imageUrl: true,
            itemValueCents: true,
            status: true,
            drawnAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMyTickets(clerkId: string) {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new ForbiddenException('User not synced');
    return this.prisma.ticket.findMany({
      where: { buyerId: user.id, status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] } },
      include: {
        raffle: {
          select: { id: true, title: true, imageUrl: true, status: true, drawAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // -------------------------------------------------------------------
  // Admin: refund all buyers + cancel the raffle
  // -------------------------------------------------------------------
  //
  // Called by the "Refund all buyers" admin button. Confirmation flow:
  // the admin must type the raffle's referenceNumber (RAxxxxxx) in the
  // UI; the controller forwards it here and we double-check it before
  // touching anything. Iterates every CONFIRMED ticket and asks Peach
  // to refund. The raffle is moved to CANCELLED_BY_ADMIN regardless of
  // per-ticket refund outcome — the operator can manually retry any
  // failures from the audit log.
  async refundAllAndCancel(adminId: string, raffleId: string, typedReference: string) {
    const raffle = await this.prisma.raffle.findUnique({ where: { id: raffleId } });
    if (!raffle) throw new NotFoundException('Raffle not found');
    if (!raffle.referenceNumber) {
      throw new BadRequestException('Raffle has no reference number set');
    }
    if (typedReference.trim().toUpperCase() !== raffle.referenceNumber.toUpperCase()) {
      throw new BadRequestException(
        'Typed reference does not match the raffle reference number',
      );
    }
    if (['CANCELLED_BY_ADMIN', 'CANCELLED_MIN_NOT_MET'].includes(raffle.status)) {
      throw new BadRequestException('Raffle is already cancelled');
    }

    const tickets = await this.prisma.ticket.findMany({
      where: { raffleId, status: 'CONFIRMED' },
      select: {
        id: true,
        peachPaymentId: true,
        amountCents: true,
        buyerId: true,
      },
    });

    const results: { ticketId: string; success: boolean; message?: string }[] = [];
    for (const t of tickets) {
      if (!t.peachPaymentId) {
        results.push({ ticketId: t.id, success: false, message: 'No payment ID' });
        continue;
      }
      try {
        const r = await this.stitch.refundPayment(t.peachPaymentId, t.amountCents);
        if (r.success) {
          await this.prisma.ticket.update({
            where: { id: t.id },
            data: { status: 'REFUNDED', refundedAt: new Date() },
          });
          results.push({ ticketId: t.id, success: true });
        } else {
          results.push({ ticketId: t.id, success: false, message: r.message ?? r.resultCode });
        }
      } catch (err) {
        results.push({ ticketId: t.id, success: false, message: (err as Error).message });
      }
    }

    await this.prisma.raffle.update({
      where: { id: raffleId },
      data: { status: 'CANCELLED_BY_ADMIN' },
    });

    await this.recordEvent(
      raffleId,
      'CANCELLED_BY_ADMIN',
      {
        ticketsProcessed: results.length,
        ticketsRefunded: results.filter((r) => r.success).length,
        ticketsFailed: results
          .filter((r) => !r.success)
          .map((r) => ({ ticketId: r.ticketId, message: r.message })),
      },
      undefined,
      adminId,
    );

    return {
      ticketsProcessed: results.length,
      ticketsRefunded: results.filter((r) => r.success).length,
      ticketsFailed: results.filter((r) => !r.success),
    };
  }

  // -------------------------------------------------------------------
  // Audit + admin reads
  // -------------------------------------------------------------------

  async getAuditEvents(raffleId: string) {
    return this.prisma.raffleAuditEvent.findMany({
      where: { raffleId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listForAdmin() {
    // Pull a compact summary of every winner alongside each raffle so
    // the competitions index page can render Drawn / Needs-dispatch
    // tabs without a per-row second fetch. We deliberately only ship
    // username + a couple of timestamps here; the full dossier
    // (real-name + phone + address) lives behind the per-raffle
    // /admin/raffles/:id/winners endpoint.
    return this.prisma.raffle.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { tickets: true, winners: true } },
        images: {
          select: { id: true, url: true, order: true, isPrimary: true },
          orderBy: { order: 'asc' },
        },
        winners: {
          orderBy: { position: 'asc' },
          select: {
            id: true,
            position: true,
            claimedAt: true,
            forfeitedAt: true,
            prizeDispatchedAt: true,
            // Public-safe handle for the list view. Real names are
            // never shipped to the client on the list page.
            user: { select: { username: true } },
          },
        },
      },
    });
  }

  // -------------------------------------------------------------------
  // Admin: full winner dossier for one raffle
  // -------------------------------------------------------------------
  //
  // Powers the per-raffle dossier page (/admin/competitions/[id]).
  // Returns up to three winners (position 1 = primary, 2/3 = backups)
  // with EVERYTHING the operator needs to physically ship the prize:
  //   - real name + email + phone (admin-only fields)
  //   - shipping address (User.addr* columns, not the per-listing
  //     pickup address that lives on Listing)
  //   - claim/forfeit/dispatch state + timestamps + tracking info
  //   - the winning ticket id (so the audit log can be cross-referenced)
  //
  // This is a high-PII endpoint — admin guard is enforced on the
  // controller route. Never reuse this shape for buyer-facing surfaces.
  async getWinnersForAdmin(raffleId: string) {
    const raffle = await this.prisma.raffle.findUnique({
      where: { id: raffleId },
      select: { id: true, title: true, referenceNumber: true, status: true },
    });
    if (!raffle) throw new NotFoundException('Raffle not found');

    const winners = await this.prisma.raffleWinner.findMany({
      where: { raffleId },
      orderBy: { position: 'asc' },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            // Personal shipping address (per profile, not per listing).
            // Schema uses `addr*` prefix; the original spec referenced
            // addressLine1/suburb/etc. — we map to the actual columns.
            addrBuilding: true,
            addrStreet: true,
            addrAddress2: true,
            addrSuburb: true,
            addrCity: true,
            addrProvince: true,
            addrPostalCode: true,
          },
        },
      },
    });

    return { raffle, winners };
  }

  // -------------------------------------------------------------------
  // Admin: mark a winner's prize as dispatched
  // -------------------------------------------------------------------
  //
  // Called from the per-raffle dossier's "Mark as dispatched" modal.
  // Single source of truth for everything that flips when a prize ships:
  //   - stamps prizeDispatchedAt + tracking metadata
  //   - records who did it (audit + dossier reverse-lookup)
  //   - notifies the winner via SMS + email (best-effort, fail-open)
  //   - appends a PRIZE_DISPATCHED row to RaffleAuditEvent
  //
  // Idempotency: refuses if already dispatched (prevents double-SMS
  // and double-audit rows when the admin double-clicks the button).
  // Refuses if winner is forfeited (you can't ship to a forfeited
  // backup — promote the next one first).
  async markWinnerPrizeDispatched(
    winnerId: string,
    adminId: string,
    dto: { trackingRef: string; carrierLabel?: string; note?: string },
  ) {
    const trackingRef = (dto.trackingRef ?? '').trim();
    if (trackingRef.length === 0) {
      throw new BadRequestException('Tracking reference is required');
    }

    const winner = await this.prisma.raffleWinner.findUnique({
      where: { id: winnerId },
      include: {
        user: { select: { id: true, email: true, phone: true, username: true } },
        raffle: { select: { id: true, title: true } },
      },
    });
    if (!winner) throw new NotFoundException('Winner not found');
    if (winner.prizeDispatchedAt) {
      throw new BadRequestException('Prize already marked as dispatched');
    }
    if (winner.forfeitedAt) {
      throw new BadRequestException(
        'Winner has forfeited — promote the backup before dispatching',
      );
    }

    const dispatchedAt = new Date();
    await this.prisma.raffleWinner.update({
      where: { id: winnerId },
      data: {
        prizeDispatchedAt: dispatchedAt,
        prizeTrackingRef: trackingRef,
        prizeCarrierLabel: dto.carrierLabel?.trim() || null,
        prizeDispatchedByAdminId: adminId,
        prizeDispatchNote: dto.note?.trim() || null,
      },
    });

    // Audit trail — separate try/catch in recordEvent so an audit-log
    // failure can't undo the dispatch stamp above.
    await this.recordEvent(
      winner.raffleId,
      'PRIZE_DISPATCHED',
      {
        winnerId,
        position: winner.position,
        trackingRef,
        carrierLabel: dto.carrierLabel ?? null,
        note: dto.note ?? null,
      },
      undefined,
      adminId,
    );

    // Notify the winner — fail-open, never block the dispatch.
    if (winner.userId && winner.user) {
      void this.notifications.raffleWinnerPrizeDispatched({
        winnerEmail: winner.user.email,
        winnerPhone: winner.user.phone,
        raffleTitle: winner.raffle.title,
        trackingRef,
        carrierLabel: dto.carrierLabel ?? null,
      });
    }

    return {
      winnerId,
      prizeDispatchedAt: dispatchedAt,
      prizeTrackingRef: trackingRef,
      prizeCarrierLabel: dto.carrierLabel ?? null,
    };
  }

  async getDrawProof(raffleId: string) {
    const raffle = await this.prisma.raffle.findUnique({
      where: { id: raffleId },
      select: {
        id: true,
        title: true,
        referenceNumber: true,
        drawSeed: true,
        drawSeedHash: true,
        drawnAt: true,
        winningTicketId: true,
        ticketsSoldPaid: true,
        ticketsSoldPostal: true,
      },
    });
    if (!raffle) throw new NotFoundException('Raffle not found');
    return raffle;
  }

  // -------------------------------------------------------------------
  // Internal: append a row to the audit log
  // -------------------------------------------------------------------

  private async recordEvent(
    raffleId: string,
    eventType: string,
    payload: unknown,
    actorUserId?: string,
    actorAdminId?: string,
  ) {
    try {
      await this.prisma.raffleAuditEvent.create({
        data: {
          raffleId,
          eventType,
          payloadJson: payload === null || payload === undefined
            ? null
            : JSON.stringify(payload),
          actorUserId,
          actorAdminId,
        },
      });
    } catch (err) {
      this.logger.warn(`audit log failed: ${(err as Error).message}`);
    }
  }
}

// Pick an index in [0, N) from random bytes using rejection sampling — kept
// outside the class so it can be unit-tested in isolation if we ever want to.
function pickModBig(bytes: Buffer, N: number): number {
  const max48 = 2 ** 48;
  const acceptUpTo = Math.floor(max48 / N) * N;
  let value = 0;
  for (let i = 0; i < 6; i += 1) value = value * 256 + bytes[i];
  if (value < acceptUpTo) return value % N;
  const next = createHash('sha256').update(bytes).digest();
  let v2 = 0;
  for (let i = 0; i < 6; i += 1) v2 = v2 * 256 + next[i];
  return v2 % N;
}
