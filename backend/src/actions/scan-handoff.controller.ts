import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CredentialKind, MotivationUploadKind } from '@prisma/client';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { NO_VISION_KINDS } from '../licence-centre/credential-kinds';
import { ActionTokensService } from './action-tokens.service';

// ────────────────────────────────────────────────────────────────────
// HANDING THE JOB TO THE PHONE IN YOUR POCKET.
//
// A laptop webcam points at your face, focuses at half a metre, and cannot
// resolve the serial on a licence card. Opening it when somebody presses
// "photograph this document" spends a permission prompt to produce a
// photograph nobody can read. So on a desktop we do not open it at all — we
// mint a short-lived token, draw it as a QR code, and the phone already in
// their hand does the work.
//
// ⚠️ THE POLLING KEY IS THE TOKEN'S ID, NEVER THE TOKEN. The desktop polls
// this endpoint every couple of seconds; putting the credential in that URL
// would spray it through nginx access logs, browser history and any proxy in
// between, for the whole life of the session.
//
// ONE CONTROLLER FOR BOTH CENTRES rather than a pair of endpoints on each.
// The alternative meant declaring a literal route above every existing
// `@Get(':id')` in two controllers and trusting nobody ever reorders them —
// a routing bug that surfaces only as a mysterious 404.
// ────────────────────────────────────────────────────────────────────

/** Where a handed-off scan is going. */
type Dest = 'licence-centre' | 'motivation';

/**
 * ⚠️ FIFTEEN MINUTES. Short because this token is a write credential to the
 * member's own vault and, unlike every other action token, it is not consumed
 * on first use — a scanning session is several files. Anyone who photographs
 * the QR over their shoulder can upload until it expires, so the window has
 * to be short enough that they would have to be standing there to do it.
 */
const TTL_MS = 15 * 60 * 1000;

/** Per-member, per-hour. The throttler is keyed on IP, which is not the same. */
const MAX_PER_HOUR = 10;

/**
 * The same no-vision kinds, as the motivation wizard names them.
 *
 * Derived rather than typed out again: the schema guarantees the names match
 * ("⚠️ NAMED IDENTICALLY TO THEIR MotivationUploadKind COUNTERPARTS"), so a
 * fifth photograph kind added to NO_VISION_KINDS is picked up here for free
 * instead of quietly missing from one of the two branches below.
 */
const NO_VISION_UPLOAD_KINDS = NO_VISION_KINDS.filter(
  (k): k is CredentialKind & MotivationUploadKind => k in MotivationUploadKind,
);
// ⚠️ THE SAFE PHOTOGRAPHS ONLY, NOT EVERY UNREADABLE MOTIVATION UPLOAD. The
// wizard skips its vision read on anything absent from motivation-extract's
// EXTRACTABLE map — a character reference and a shooting activity log among
// them — and each of those still waits out the 45 seconds below. The authority
// on that is MotivationExtractService.canExtract, which lives in motivations/;
// deciding it from here would be this file's second, disagreeing copy of it.

@Controller('scan-handoff')
@UseGuards(ClerkGuard)
export class ScanHandoffController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: ActionTokensService,
  ) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async mint(
    @CurrentUser() clerkId: string,
    @Body('dest') dest: string,
    @Body('motivationId') motivationId?: string,
    @Body('kind') kind?: string,
    @Body('title') title?: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');

    if (dest !== 'licence-centre' && dest !== 'motivation') {
      throw new BadRequestException('Unknown destination.');
    }
    if (dest === 'motivation') {
      if (!motivationId) throw new BadRequestException('Which motivation?');
      // ⚠️ CHECKED AT MINT, not only at upload. The upload path is safe on its
      // own — addUpload scopes by userId — but a token naming somebody else's
      // motivation would fail silently on the phone, after the member had
      // already walked across the room with it.
      const owned = await this.prisma.motivation.findFirst({
        where: { id: motivationId, userId: user.id },
        select: { id: true },
      });
      if (!owned) throw new NotFoundException('Motivation not found');
    }

    const recent = await this.prisma.actionToken.count({
      where: {
        purpose: 'SCAN_HANDOFF',
        authorisedUserId: user.id,
        createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });
    if (recent >= MAX_PER_HOUR) {
      throw new BadRequestException(
        'Too many phone links requested — use the most recent one, or try again in an hour.',
      );
    }

    const expiresAt = new Date(Date.now() + TTL_MS);
    const token = await this.tokens.mint({
      purpose: 'SCAN_HANDOFF',
      targetType: 'user',
      targetId: user.id,
      authorisedUserId: user.id,
      expiresAt,
      metadata: {
        dest: dest as Dest,
        ...(motivationId ? { motivationId } : {}),
        ...(kind ? { kind } : {}),
        ...(title ? { title } : {}),
      },
    });

    const row = await this.prisma.actionToken.findUnique({
      where: { token },
      select: { id: true },
    });
    const appUrl = process.env.FRONTEND_URL ?? 'https://alloutdoor.co.za';
    return {
      handoffId: row!.id,
      url: `${appUrl}/a/${token}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  @Get(':handoffId')
  async status(
    @CurrentUser() clerkId: string,
    @Param('handoffId') handoffId: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const row = await this.prisma.actionToken.findFirst({
      where: {
        id: handoffId,
        purpose: 'SCAN_HANDOFF',
        // Scoped to the asker, so one member cannot watch another's session.
        authorisedUserId: user.id,
      },
      select: {
        createdAt: true,
        expiresAt: true,
        usedAt: true,
        metadataJson: true,
      },
    });
    if (!row) throw new NotFoundException('Not found');

    let meta: Record<string, unknown> = {};
    if (row.metadataJson) {
      try {
        meta = JSON.parse(row.metadataJson) as Record<string, unknown>;
      } catch {
        // Unreadable metadata reads as "not opened yet", which is the safe way
        // to be wrong: the dialog stays up instead of closing on nothing.
      }
    }

    // How many documents have landed SINCE the link was made. Counting rows
    // created after the token is what makes this work without threading a
    // session id all the way through the upload path.
    //
    // ⚠️ "LANDED" MEANS READ, NOT INSERTED. The upload service inserts the
    // row first and runs the vision read after — deliberately, so a vision
    // outage costs a convenience and not the upload. Counting on insert made
    // this poll fire mid-read: the desktop closed its dialog, snapshotted the
    // list, and showed the operator a competency certificate with no issue
    // date, five seconds before the date landed in a row his screen had
    // already copied. The firearm licence "read fine" purely because its
    // timing fell the other side of the same race.
    //
    // So a row counts once its extraction has settled — or once it is old
    // enough that it clearly finished another way, because extractionOk stays
    // false FOREVER for a legitimately unreadable photograph and a document
    // must never be invisible to its owner over that.
    //
    // ⚠️ AND SOME KINDS NEVER GET A VISION CALL AT ALL, which turned that
    // 45-second backstop into the ordinary path. There is nothing printed on a
    // photograph of a gun safe, so the upload service skips the read outright
    // and extractionOk stays false from the moment the row is written — the
    // desktop dialog then sat on "waiting" for the full three-quarters of a
    // minute after a photograph that had, in fact, already arrived. Nothing is
    // pending on these, so they are settled the instant they exist.
    const settledBefore = new Date(Date.now() - 45_000);
    const aged = { createdAt: { lte: settledBefore } };
    const added =
      meta.dest === 'motivation' && typeof meta.motivationId === 'string'
        ? await this.prisma.motivationUpload.count({
            where: {
              motivationId: meta.motivationId,
              createdAt: { gte: row.createdAt },
              OR: [
                { extractionOk: true },
                { kind: { in: [...NO_VISION_UPLOAD_KINDS] } },
                aged,
              ],
            },
          })
        : await this.prisma.credential.count({
            where: {
              userId: user.id,
              createdAt: { gte: row.createdAt },
              OR: [
                { extractionOk: true },
                { kind: { in: [...NO_VISION_KINDS] } },
                aged,
              ],
            },
          });

    const expired = row.expiresAt <= new Date();
    const connected = typeof meta.openedAt === 'string';
    const state = expired
      ? 'expired'
      : added > 0
        ? 'uploaded'
        : connected
          ? 'connected'
          : 'waiting';

    return { state, added, connected, expiresAt: row.expiresAt.toISOString() };
  }
}
