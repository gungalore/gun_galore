import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  HttpCode,
  Res,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { RafflesService } from './raffles.service';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { CurrentAdmin } from '../admin/decorators/current-admin.decorator';
import { CreateRaffleDto } from './dto/create-raffle.dto';
import { BuyTicketsDto } from './dto/buy-tickets.dto';
import { PostalEntryDto } from './dto/postal-entry.dto';
import { PrismaService } from '../prisma/prisma.service';
import { buildPostalEntryPdf } from './postal-entry-pdf';

// ---------- Public read-only ------------------------------------------------
// SkipThrottle on these reads: SSR (homepage, raffle detail) calls them
// from localhost, and the shared 60 req/min bucket would trip → 404.
@Controller('raffles')
export class RafflesPublicController {
  constructor(
    private readonly raffles: RafflesService,
    private readonly prisma: PrismaService,
  ) {}

  // M17 — SkipThrottle moved off the controller. The class-level skip
  // applied to the PDF generator too, turning it into a cheap DoS
  // lever (unauthenticated, on-the-fly PDF render — easy to script).
  // Plain reads still skip the global throttle; the PDF route gets its
  // own modest per-IP cap.

  @Get()
  @SkipThrottle()
  list() {
    return this.raffles.listActive();
  }

  @Get(':id')
  @SkipThrottle()
  get(@Param('id') id: string) {
    return this.raffles.getPublic(id);
  }

  // Public verifiability — exposes seed + hash after the draw
  @Get(':id/proof')
  @SkipThrottle()
  proof(@Param('id') id: string) {
    return this.raffles.getDrawProof(id);
  }

  // Print-ready postal-entry PDF. Public so anyone can pick up the
  // free-entry route without an account. Filename includes the raffle
  // reference so the operator can match envelopes back to the raffle.
  // M17 — explicit per-IP cap: 6 generations / min is plenty for any
  // legitimate use (a buyer + a few retries) and stops scripted
  // PDF-storm DoS attempts.
  @Get(':id/postal-entry.pdf')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async postalEntryPdf(@Param('id') id: string, @Res() res: Response) {
    const raffle = await this.prisma.raffle.findUnique({
      where: { id },
      select: {
        id: true,
        referenceNumber: true,
        title: true,
        ticketPriceCents: true,
        targetTicketCount: true,
        ticketsSoldPaid: true,
        ticketsSoldPostal: true,
      },
    });
    if (!raffle) throw new NotFoundException('Raffle not found');

    const pdf = await buildPostalEntryPdf({
      raffleReference: raffle.referenceNumber ?? raffle.id,
      raffleTitle: raffle.title,
      ticketPriceCents: raffle.ticketPriceCents,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="postal-entry-${raffle.referenceNumber ?? raffle.id}.pdf"`,
    );
    res.send(pdf);
  }
}

// ---------- Buyer (Clerk-auth) ---------------------------------------------
@Controller('raffles')
@UseGuards(ClerkGuard)
export class RafflesBuyerController {
  constructor(private readonly raffles: RafflesService) {}

  /** Phase E3 — current user's subscriber-raffle status.
   *  Returns the two active subscriber raffles (Member + Pro) the
   *  user is eligible for, with isEntered + draw countdown. */
  @Get('me/subscriber')
  mySubscriberRaffles(@CurrentUser() clerkId: string) {
    return this.raffles.getMySubscriberRaffles(clerkId);
  }

  // Buyer initiates a ticket purchase. Returns pending tickets + total cents,
  // which the front-end then sends to /transactions to create a Peach checkout.
  @Post(':id/tickets')
  buy(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body() dto: BuyTicketsDto,
  ) {
    return this.raffles.createPendingTickets(clerkId, id, dto);
  }

  // Buyer's own confirmed tickets
  @Get('me/tickets')
  myTickets(@CurrentUser() clerkId: string) {
    return this.raffles.getMyTickets(clerkId);
  }

  // Buyer's own raffle wins
  @Get('me/wins')
  myWins(@CurrentUser() clerkId: string) {
    return this.raffles.getMyWins(clerkId);
  }

  // Claim a prize
  @Post('wins/:winnerId/claim')
  claim(
    @CurrentUser() clerkId: string,
    @Param('winnerId') winnerId: string,
  ) {
    return this.raffles.claimPrize(clerkId, winnerId);
  }

  // DEV ONLY — confirm tickets without going through Peach. Behind a flag.
  // In production this happens via the Peach payment webhook.
  @Post('tickets/dev-confirm')
  devConfirm(@Body() body: { ticketIds: string[] }) {
    if (process.env.NODE_ENV === 'production') {
      throw new BadRequestException('Dev confirm is disabled in production');
    }
    return this.raffles.confirmTickets(body.ticketIds, 'dev-bypass');
  }
}

// ---------- Admin -----------------------------------------------------------
@Controller('admin/raffles')
@UseGuards(AdminJwtGuard)
export class RafflesAdminController {
  constructor(private readonly raffles: RafflesService) {}

  @Get()
  list() {
    return this.raffles.listForAdmin();
  }

  @Post()
  create(
    @CurrentAdmin() admin: { sub: string },
    @Body() dto: CreateRaffleDto,
  ) {
    return this.raffles.create(admin.sub, dto);
  }

  @Post(':id/open')
  open(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
  ) {
    return this.raffles.open(admin.sub, id);
  }

  @Get(':id/audit')
  audit(@Param('id') id: string) {
    return this.raffles.getAuditEvents(id);
  }

  // Full winner dossier for the per-raffle admin page. Returns the
  // raffle metadata + every winner row with the high-PII fields admins
  // need to physically ship the prize (real name, phone, address).
  // Admin-guarded — never expose this shape to buyer-facing endpoints.
  @Get(':id/winners')
  winners(@Param('id') id: string) {
    return this.raffles.getWinnersForAdmin(id);
  }

  // Mark a winner's prize as dispatched. Triggered by the "Mark as
  // dispatched" button in the per-raffle dossier. Body is a small DTO
  // with the courier tracking reference (required) + an optional
  // carrier label + free-text note. Service-side enforces idempotency
  // and notifies the winner via SMS + email.
  @Post('winners/:winnerId/dispatch')
  dispatch(
    @CurrentAdmin() admin: { sub: string },
    @Param('winnerId') winnerId: string,
    @Body() body: { trackingRef: string; carrierLabel?: string; note?: string },
  ) {
    return this.raffles.markWinnerPrizeDispatched(winnerId, admin.sub, body);
  }

  // Force a draw — for testing in dev. In prod this is invoked by cron.
  @Post(':id/run-draw')
  runDraw(@Param('id') id: string) {
    return this.raffles.runDraw(id);
  }

  @Post('postal-entries')
  postalEntry(
    @CurrentAdmin() admin: { sub: string },
    @Body() dto: PostalEntryDto,
  ) {
    return this.raffles.createPostalEntry(admin.sub, dto);
  }

  // -------- Multi-image upload (mirrors POST /listings/:id/images) ---------

  @Post(':id/images')
  @UseInterceptors(FileInterceptor('image', { storage: memoryStorage() }))
  addImage(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 8 * 1024 * 1024 }), // 8 MB
          new FileTypeValidator({ fileType: /image\/(jpeg|png|webp)/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.raffles.addImage(admin.sub, id, file);
  }

  @Delete(':id/images/:imageId')
  @HttpCode(204)
  removeImage(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.raffles.removeImage(admin.sub, id, imageId);
  }

  // -------- Refund all buyers + cancel ------------------------------------
  //
  // Admin types the raffle's referenceNumber (RAxxxxxx) in the frontend
  // confirmation modal; the typed value is forwarded here and we
  // double-check it before issuing any refunds.
  @Post(':id/refund-all')
  refundAll(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Body() body: { typedReference: string },
  ) {
    return this.raffles.refundAllAndCancel(admin.sub, id, body.typedReference ?? '');
  }
}
