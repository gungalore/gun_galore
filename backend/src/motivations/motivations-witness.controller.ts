import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { MotivationsService } from './motivations.service';
import { MotivationWitnessService } from './motivation-witness.service';
import {
  witnessNotices,
  WITNESS_ABOUT_FIELDS,
  WITNESS_ANSWERS,
  WITNESS_DECLARATIONS,
  WITNESS_FORM_VERSION,
} from './motivation-witness-form';

// ────────────────────────────────────────────────────────────────────
// TWO CONTROLLERS IN ONE FILE, AND THE SPLIT IS THE POINT.
//
// The first is behind Clerk and belongs to the applicant: invite a witness,
// see how they are getting on, read a finished statement, delete it.
//
// The second has NO GUARD AT ALL, because the person using it is a member of
// the public holding a link. Everything it can reach is reached through the
// token, which resolves to exactly one MotivationWitness row.
//
// ⚠️ NOTHING IN THE PUBLIC HALF TAKES AN ID FROM THE CALLER. Not a motivation
// id, not a witness id, not a user id — only the token in the path. That is
// what makes it impossible to walk from one statement to another, or from a
// statement to the applicant's documents. Adding a convenience parameter to
// one of these routes later would quietly undo it.
//
// ⚠️ AND THE PUBLIC ROUTES MUST BE IN isPublicRoute ON THE FRONTEND. This repo
// has been caught by that before: a new public page that middleware still
// guards answers a 307 to a signed-out visitor, which for a witness looks like
// a broken link from a stranger.
// ────────────────────────────────────────────────────────────────────

@Controller('motivations')
@UseGuards(ClerkGuard)
export class MotivationsWitnessController {
  constructor(
    private readonly motivations: MotivationsService,
    private readonly witnesses: MotivationWitnessService,
  ) {}

  /** Both slots and what is in them. */
  @Get(':id/witnesses')
  list(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.motivations.listWitnesses(clerkId, id);
  }

  /**
   * Invite somebody, and send the link.
   *
   * ⚠️ THROTTLED HARDER THAN AN ORDINARY WRITE. Each call spends a real SMS,
   * and a rate limiter is the only thing between a mistyped number and a bill.
   */
  @Post(':id/witnesses')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  invite(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body() body: { slot?: number; name?: string; phone?: string },
  ) {
    return this.motivations.inviteWitness(clerkId, id, {
      slot: Number(body?.slot),
      name: String(body?.name ?? ''),
      phone: String(body?.phone ?? ''),
    });
  }

  /** Discard a witness — completed or not — and free the slot. */
  @Delete(':id/witnesses/:witnessId')
  remove(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Param('witnessId') witnessId: string,
  ) {
    return this.motivations.removeWitness(clerkId, id, witnessId);
  }

  /** The signature, so the applicant can see what they are about to file. */
  @Get(':id/witnesses/:witnessId/signature')
  async signature(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Param('witnessId') witnessId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const bytes = await this.motivations.witnessSignature(
      clerkId,
      id,
      witnessId,
    );
    if (!bytes) throw new NotFoundException('No signature');
    res.set({
      'Content-Type': 'image/png',
      'Content-Length': String(bytes.length),
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(bytes);
  }
}

// ────────────────────────────────────────────────────────────────────

@Controller('witness')
export class WitnessPublicController {
  constructor(private readonly witnesses: MotivationWitnessService) {}

  /**
   * What the witness sees when they open the link.
   *
   * ⚠️ THE APPLICANT'S NAME AND THE LICENCE TYPE, AND NOTHING ELSE. Not their
   * identity number, not their address, not a word of the motivation, not a
   * list of their documents. A witness needs to know who they are vouching for
   * and what for; everything beyond that would be handing a stranger somebody
   * else's application because they received an SMS.
   */
  @Get(':token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async open(@Param('token') token: string) {
    const row = await this.witnesses.resolve(token);
    const applicantName = await this.witnesses.applicantNameFor(row);

    return {
      status: row.status,
      invitedName: row.invitedName,
      // Masked: enough for them to recognise their own number, not enough to
      // be worth harvesting.
      phoneHint: maskPhone(row.invitedPhone),
      applicantName,
      licenceTypeLabel: await this.witnesses.licenceLabelFor(row),
      notices: witnessNotices(applicantName),
      fields: WITNESS_ABOUT_FIELDS,
      declarations: WITNESS_DECLARATIONS,
      answerOptions: WITNESS_ANSWERS,
      version: WITNESS_FORM_VERSION,
    };
  }

  /**
   * Decline, without verifying anything.
   *
   * See the service: demanding a code from somebody whose answer is "I do not
   * want to be involved" is asking them to do work in order to refuse.
   */
  @Post(':token/decline')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async decline(@Param('token') token: string, @Req() req: Request) {
    const row = await this.witnesses.resolve(token);
    return this.witnesses.decline(
      token,
      row.id,
      (req.headers['cf-connecting-ip'] as string) ??
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
        req.ip,
      req.headers['user-agent'],
    );
  }

  /** Send the code to the number the applicant nominated. */
  @Post(':token/code')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async sendCode(@Param('token') token: string) {
    const row = await this.witnesses.resolve(token);
    return this.witnesses.sendCode(row.id);
  }

  /** Check the code. */
  @Post(':token/verify')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  async verify(
    @Param('token') token: string,
    @Body('code') code: string,
  ) {
    const row = await this.witnesses.resolve(token);
    return this.witnesses.verifyCode(row.id, String(code ?? ''));
  }

  /**
   * Sign and submit.
   *
   * The signature arrives as a data URL from the canvas rather than as
   * multipart — it is a few kilobytes of PNG produced by our own page, and a
   * file upload for it would mean a second request that can fail on its own
   * and leave a statement stored without the signature that makes it one.
   */
  @Post(':token/submit')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async submit(
    @Param('token') token: string,
    @Req() req: Request,
    @Body()
    body: {
      answers?: Record<string, string>;
      signature?: string;
      place?: string;
    },
  ) {
    const row = await this.witnesses.resolve(token);
    const signature = decodeSignature(body?.signature ?? '');
    return this.witnesses.submit({
      witnessId: row.id,
      answers: body?.answers ?? {},
      signature,
      signatureMime: 'image/png',
      place: body?.place,
      // Behind Cloudflare and nginx, so the forwarded header is the real one.
      ip:
        (req.headers['cf-connecting-ip'] as string) ??
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
        req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}

/** "0743039999" -> "•••• 9999". */
function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : '••••';
}

/**
 * A canvas data URL to PNG bytes.
 *
 * ⚠️ THE PREFIX IS CHECKED, NOT STRIPPED BLINDLY. `data:image/png;base64,` is
 * the only thing our own canvas produces; accepting any data URL would let a
 * caller store an arbitrary file type under a name the renderer will later
 * hand to pdfkit as an image.
 */
function decodeSignature(dataUrl: string): Buffer {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(
    (dataUrl ?? '').trim(),
  );
  if (!m) {
    throw new BadRequestException('Please sign before you submit.');
  }
  return Buffer.from(m[1], 'base64');
}
