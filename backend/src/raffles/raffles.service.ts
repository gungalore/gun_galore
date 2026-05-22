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
import { PeachService } from '../payments/peach.service';
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

@Injectable()
export class RafflesService {
  private readonly logger = new Logger(RafflesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly cloudinary: CloudinaryService,
    private readonly peach: PeachService,
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
    if (dto.ticketPriceCents > dto.itemValueCents) {
      throw new BadRequestException(
        'Ticket price cannot be higher than the item price',
      );
    }

    const tier = tierForValue(dto.itemValueCents);

    // Auto-derive how many tickets need to sell for revenue to cover
    // the prize selling price. Operator no longer chooses this number;
    // the form just shows the math live.
    const targetTicketCount = Math.ceil(dto.itemValueCents / dto.ticketPriceCents);

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
      },
      undefined,
      adminId,
    );

    return { raffle };
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
      data: { status: 'ACTIVE' },
    });
    await this.recordEvent(raffleId, 'OPENED', null, undefined, adminId);
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
          const user = await this.prisma.user.findUnique({ where: { id: next.userId } });
          if (user?.email) {
            void this.notifications.raffleBackupPromoted(
              user.email,
              w.raffleId,
              next.claimDeadline,
            );
          }
          await this.recordEvent(w.raffleId, 'BACKUP_PROMOTED', {
            from: w.position,
            to: next.position,
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
        const r = await this.peach.refundPayment(t.peachPaymentId, t.amountCents);
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
    return this.prisma.raffle.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { tickets: true, winners: true } },
        images: {
          select: { id: true, url: true, order: true, isPrimary: true },
          orderBy: { order: 'asc' },
        },
      },
    });
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
