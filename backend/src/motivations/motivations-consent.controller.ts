import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  MotivationSellerConsentService,
  type FirearmSnapshot,
} from './motivation-seller-consent.service';
import { LicenceCardOcrService } from './licence-card-ocr.service';
import { cardRowsFor } from './motivation-seller-consent.service';

// ────────────────────────────────────────────────────────────────────
// THE SELLER-CONSENT ROUTES.
//
// Two controllers, and the split is the whole security model. The first is
// the APPLICANT's — guarded, they must be signed in, and it is how the link
// gets sent. The second is the SELLER's — deliberately unguarded, because the
// person opening it is a stranger who received an SMS and has no account.
//
// ⚠️ NOTHING ON THE PUBLIC HALF TRUSTS THE TOKEN AS AN IDENTITY. Every route
// resolves it to ONE consent row and can touch nothing else — not the
// motivation, not the applicant, not another consent. The same rule the
// witness routes state at length, for the same reason: a token that
// authenticated its holder AS the applicant would hand somebody else's
// identity number and application to whoever received a forwarded message.
// ────────────────────────────────────────────────────────────────────

@Controller('motivations')
@UseGuards(ClerkGuard)
export class MotivationsConsentController {
  constructor(
    private readonly consent: MotivationSellerConsentService,
  ) {}

  /** Where the applicant sends the link from. */
  @Post(':id/seller-consent')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  async invite(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Req() req: Request,
    @Body()
    body: {
      name?: string;
      phone?: string;
      firearm?: FirearmSnapshot;
      applicantName?: string;
    },
  ) {
    if (!body?.firearm) {
      throw new BadRequestException('The firearm details are missing.');
    }
    // The link has to be absolute — it is going into an SMS.
    const origin =
      (req.headers['origin'] as string) ||
      process.env.PUBLIC_WEB_URL ||
      'https://alloutdoor.co.za';
    return this.consent.invite({
      motivationId: id,
      applicantClerkId: clerkId,
      applicantName: (body.applicantName ?? '').trim() || 'A buyer',
      name: body.name ?? '',
      phone: body.phone ?? '',
      firearm: body.firearm,
      baseUrl: origin,
    });
  }

  /**
   * Where the buyer checks on the invite, and — once signed — collects the
   * firearm the card records, to adopt into their own application.
   *
   * ⚠️ THIS IS HOW "SEND" STOPS BEING THE END OF THE STORY. The panel could
   * only ever say "sent" because nothing read the result back. Now it can show
   * signed/declined, and offer the government card's firearm details for the
   * buyer to confirm into their application. Owner-gated in the service.
   */
  @Get(':id/seller-consent')
  async status(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.consent.statusFor(clerkId, id);
  }
}

@Controller('seller-consent')
export class SellerConsentPublicController {
  constructor(
    private readonly consent: MotivationSellerConsentService,
    private readonly ocr: LicenceCardOcrService,
  ) {}

  /**
   * What the seller sees when they open the link.
   *
   * ⚠️ THE FIREARM AND A MASKED NUMBER, AND NOTHING ELSE ABOUT THE BUYER OR
   * THE APPLICATION. A person cannot consent to a transfer they have not been
   * told the particulars of, so the firearm crosses; the motivation itself,
   * the buyer's address and everything else stays where it is.
   */
  @Get(':token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async open(@Param('token') token: string) {
    const row = await this.consent.resolve(token);
    // Fire and forget: an applicant chasing a seller wants to know whether the
    // link has been looked at, and failing to record that must never fail the
    // page it is recording.
    void this.consent.markOpened(row.id);
    const firearm = this.consent.firearmFor(row);
    return {
      status: row.status,
      invitedName: row.invitedName,
      phoneHint: maskPhone(row.invitedPhone),
      declined: !!row.declinedAt,
      applicantName: firearm?.applicantName ?? null,
      // Pre-filled by the buyer, shown so the seller can see WHAT they are
      // being asked to consent to before they photograph anything.
      firearm: firearm ? cardRowsFor(firearm) : [],
    };
  }

  @Post(':token/decline')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async decline(@Param('token') token: string) {
    const row = await this.consent.resolve(token);
    return this.consent.decline(row.id);
  }

  /**
   * Read the FRONT of the licence and propose what it says.
   *
   * ⚠️ THE FRONT ONLY, AND THAT IS A COST DECISION AS MUCH AS A CORRECTNESS
   * ONE. Operator, 2026-08-23: "Trying to keep cost down, so if we can send
   * just the front for OCR to vison and back directly to our server that would
   * be great." It is also simply true that the back has nothing to read — a
   * barcode, a card number, a signature and a fingerprint, but no printed
   * field the consent needs.
   *
   * ⚠️ PROPOSES ONLY. The response is suggestions for a form the seller
   * confirms; nothing here is stored, and nothing here reaches the signed
   * document without a human having looked at it.
   *
   * ⚠️ AND IT NEVER FAILS THE FLOW. A dead key, a 403 from the IP allowlist,
   * a timeout — all come back `ok: false` with no fields, and the seller types
   * what the card says. A consent that only works when Google answers is a
   * consent that strands somebody in bad light.
   */
  @Post(':token/read-front')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async readFront(
    @Param('token') token: string,
    @Body() body: { image?: string },
  ) {
    // Resolving proves the caller holds a live link before we spend a call.
    await this.consent.resolve(token);
    const bytes = decodePhoto(body?.image ?? '');
    const reading = await this.ocr.read(bytes, 'image/jpeg');
    return {
      ok: reading.ok,
      fields: reading.fields,
      holderIdNumber: reading.holderIdNumber ?? null,
      holderNameOnCard: reading.holderNameOnCard ?? null,
    };
  }

  @Post(':token/submit')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async submit(
    @Param('token') token: string,
    @Req() req: Request,
    @Body()
    body: {
      fullName?: string;
      idNumber?: string;
      // The seller's confirmed reading of their own card — becomes the firearm
      // of record on the signed consent. See MotivationSellerConsentService.
      firearm?: Record<string, unknown>;
      signature?: string;
      front?: string;
      back?: string;
      place?: string;
    },
  ) {
    const row = await this.consent.resolve(token);
    return this.consent.submit({
      consentId: row.id,
      answers: {
        fullName: body?.fullName ?? '',
        idNumber: body?.idNumber ?? '',
      },
      firearm: body?.firearm,
      signature: decodeSignature(body?.signature ?? ''),
      signatureMime: 'image/png',
      licenceFront: decodePhoto(body?.front ?? ''),
      licenceBack: decodePhoto(body?.back ?? ''),
      licenceMime: 'image/jpeg',
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
 * ⚠️ THE PREFIX IS CHECKED, NOT STRIPPED BLINDLY — same reasoning as the
 * witness route: accepting any data URL would let a caller store an arbitrary
 * file type under a name the renderer later hands to pdfkit as an image.
 */
function decodeSignature(dataUrl: string): Buffer {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(
    (dataUrl ?? '').trim(),
  );
  if (!m) throw new BadRequestException('Please sign before you submit.');
  return Buffer.from(m[1], 'base64');
}

/**
 * A photograph from the scanner.
 *
 * ⚠️ JPEG AND PNG ONLY, AND THE SAME REASON APPLIES TWICE OVER: pdfkit embeds
 * nothing else, so anything that got past this would be stored, listed, and
 * then silently missing from the printed pack.
 */
function decodePhoto(dataUrl: string): Buffer {
  const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(
    (dataUrl ?? '').trim(),
  );
  if (!m) throw new BadRequestException('That photograph did not come through.');
  return Buffer.from(m[2], 'base64');
}
