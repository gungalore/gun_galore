import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  FileTypeValidator,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Patch,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CredentialKind } from '@prisma/client';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { LicenceCentreService } from './licence-centre.service';
import { LicenceCentreQuotaService } from './licence-centre-quota.service';
import { VaultConsentService } from '../users/vault-consent.service';
import { KycIdAdoptionService } from './kyc-id-adoption.service';
import { VaultAdoptionService } from '../motivations/vault-adoption.service';

// Behind the login, like everything in this area. middleware.ts's isPublicRoute
// is an allow-list with default deny, so the frontend route is authenticated by
// having no entry there — nothing to add and nothing to forget to add.

const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_INTERCEPTOR_MAX = UPLOAD_MAX_BYTES + 512 * 1024;
// ⚠️ NO HEIC. It was accepted platform-wide and reverted after full-resolution
// iPhone HEICs produced 413s at the proxy.
const UPLOAD_MIME = /^(image\/(jpeg|png|webp)|application\/pdf)$/;

@Controller('licence-centre')
@UseGuards(ClerkGuard)
export class LicenceCentreController {
  constructor(
    private readonly svc: LicenceCentreService,
    private readonly quota: LicenceCentreQuotaService,
    // From the @Global UsersModule rather than this one — see the header of
    // vault-consent.service.ts for why the graph forces that.
    private readonly consent: VaultConsentService,
    private readonly kycId: KycIdAdoptionService,
    // From MotivationsModule, which this module already imports. It cannot
    // live here: the edge is one-way and a spec asserts it.
    private readonly adoption: VaultAdoptionService,
  ) {}

  // ── THE ID THEY HAVE ALREADY GIVEN US ──────────────────────────────
  //
  // Offered once, at the end of being verified. ⚠️ Not flag-gated for the
  // same reason as `consent` below: the KYC success screen asks whether there
  // is an offer to render, and a 404 there would put an error on the page
  // somebody sees at the moment they are told they passed.

  @Get('kyc-id')
  kycIdOffer(@CurrentUser() clerkId: string) {
    return this.kycId.offer(clerkId);
  }

  /**
   * Yes, keep it.
   *
   * ⚠️ THE POST IS THE CONSENT, and it covers this document only. The KYC
   * copy was collected to verify an identity; reusing it in licence
   * applications is a different purpose and takes its own yes. It does NOT
   * touch the blanket keep-my-documents record — somebody may want this one
   * document kept and nothing else.
   */
  @Post('kyc-id')
  adoptKycId(@CurrentUser() clerkId: string) {
    return this.kycId.adopt(clerkId);
  }

  // ── MAY WE KEEP YOUR DOCUMENTS? ────────────────────────────────────
  //
  // ⚠️ NONE OF THESE THREE ARE FLAG-GATED, and that is deliberate. Every
  // other route here begins with quota.assertEnabled() and 404s when the
  // Document Centre is switched off — but the Motivation Centre has to know
  // the consent state whether or not the Centre is open. A page that cannot
  // ask the question renders as though nobody has ever consented, and would
  // put the window in front of somebody who already said yes. The `status`
  // route above is not gated for the same reason.

  @Get('consent')
  consentState(@CurrentUser() clerkId: string) {
    return this.consent.get(clerkId);
  }

  /**
   * Record either answer.
   *
   * ⚠️ A DECLINE IS A RECORD, NOT AN ABSENCE. The version is stamped on both
   * answers, because a no that stamps nothing is indistinguishable from never
   * having been asked — and the window would come back on every visit, which
   * is how a consent prompt becomes something people click through.
   */
  @Post('consent')
  answerConsent(
    @CurrentUser() clerkId: string,
    @Body('agreed') agreed: unknown,
  ) {
    // Validated by hand: a bare @Body() is not a DTO and the global
    // ValidationPipe has no forbidNonWhitelisted, so anything at all arrives
    // here as `unknown`. An ambiguous value must never be read as a yes.
    if (typeof agreed !== 'boolean') {
      throw new BadRequestException('Answer must be yes or no.');
    }
    return this.consent.answer(clerkId, agreed);
  }

  /** Turn it off. ⚠️ Deletes nothing — see VaultConsentService.withdraw. */
  @Delete('consent')
  withdrawConsent(@CurrentUser() clerkId: string) {
    return this.consent.withdraw(clerkId);
  }

  /**
   * Copy ONE batch of what they attached before they agreed.
   *
   * ⚠️ CLIENT-DRIVEN AND BOUNDED, not a cron and not one long request. Each
   * adoption is a decrypt, a re-encrypt and a disk write; a member with three
   * applications can hold forty documents, and nginx caps a request at 60s
   * while Cloudflare caps it at 100s. This project has already lost a paid-for
   * motivation to a 504 that hid work which had completed.
   *
   * A cron was the obvious alternative and is the wrong one: it would walk the
   * whole table every night and re-copy documents the member had since
   * deleted, because the row it copied from is still sitting in the
   * application. The cursor inside backfillStep is what makes deletion mean
   * deletion.
   */
  @Post('consent/backfill-step')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async backfillStep(@CurrentUser() clerkId: string) {
    const step = await this.adoption.backfillStep(clerkId);
    return { ...step, remaining: await this.adoption.backfillRemaining(clerkId) };
  }

  /**
   * Deliberately NOT gated on the flag: with the module off every other
   * endpoint 404s, and the page needs one call it can trust to render the
   * "not open yet" state instead of storming the rest.
   */
  @Get('status')
  status() {
    return this.quota.status();
  }

  @Get()
  list(@CurrentUser() clerkId: string) {
    return this.svc.list(clerkId);
  }

  @Post()
  // A folder of documents goes up back to back; 20 was a ceiling a member
  // could hit halfway through adding their own paperwork.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: UPLOAD_INTERCEPTOR_MAX },
    }),
  )
  create(
    @CurrentUser() clerkId: string,
    @Body('kind') kind: string,
    @Body('title') title: string,
    @UploadedFile(
      new ParseFilePipe({
        // ⚠️ errorMessage on BOTH, or the member is shown the validator's
        // own text — a JavaScript regular expression under a red heading.
        validators: [
          new MaxFileSizeValidator({
            maxSize: UPLOAD_MAX_BYTES,
            errorMessage: 'That file is larger than 10 MB. A photo taken at a lower resolution will be well under it.',
          }),
          new FileTypeValidator({
            fileType: UPLOAD_MIME,
            errorMessage:
              'We can read a JPG, PNG, WebP or PDF. On an iPhone, choose the photo from your library rather than from Files.',
          }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    // NO KIND MEANS "SORT IT FOR ME" — the batch path, where a member adds a
    // whole folder at once and names nothing up front.
    const wanted = (kind ?? '').trim();
    if (!wanted) return this.svc.create(clerkId, null, title, file);

    // Validated HERE, by hand. The global ValidationPipe has no
    // forbidNonWhitelisted and a bare @Body('kind') is not a DTO, so an
    // arbitrary string would sail through and surface as a Prisma 500.
    if (!Object.values(CredentialKind).includes(wanted as CredentialKind)) {
      throw new BadRequestException('Unknown document type.');
    }
    return this.svc.create(clerkId, wanted as CredentialKind, title, file);
  }

  @Post(':id/confirm')
  confirm(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body('expiresOn') expiresOn: string,
    @Body('issuedOn') issuedOn?: string,
    @Body('kind') kind?: string,
    @Body('title') title?: string,
    // The two ticks. ⚠️ Coerced rather than trusted: a bare @Body() is not a
    // DTO and the global ValidationPipe has no forbidNonWhitelisted, so the
    // string "false" would otherwise arrive here and read as true.
    @Body('neverExpires') neverExpires?: unknown,
    @Body('issuedOnUnknown') issuedOnUnknown?: unknown,
  ) {
    // The kind is optional, but if one is sent it must be real — it decides
    // whether this document is ever offered a renewal.
    const wanted = (kind ?? '').trim();
    if (wanted && !Object.values(CredentialKind).includes(wanted as CredentialKind)) {
      throw new BadRequestException('Unknown document type.');
    }
    return this.svc.confirmExpiry(clerkId, id, {
      expiresOn,
      issuedOn,
      kind: wanted ? (wanted as CredentialKind) : undefined,
      title,
      neverExpires: neverExpires === undefined ? undefined : neverExpires === true,
      issuedOnUnknown:
        issuedOnUnknown === undefined ? undefined : issuedOnUnknown === true,
    });
  }

  @Patch(':id/title')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  rename(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body('title') title: string,
  ) {
    return this.svc.rename(clerkId, id, title ?? '');
  }

  @Patch(':id/mute')
  mute(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body('muted') muted: boolean,
  ) {
    return this.svc.mute(clerkId, id, muted === true);
  }

  /**
   * Start a section 24 renewal from this document.
   *
   * Throttled: each call allocates an MO reference number and may attach a
   * copy of the document, so a stuck button must not be able to spend either
   * in a loop.
   */
  @Post(':id/renew')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  renew(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.svc.startRenewal(clerkId, id);
  }

  @Get(':id/file')
  async readFile(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { bytes, mimeType, filename } = await this.svc.readFile(clerkId, id);
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': String(bytes.length),
      // Somebody's licence must not sit in a shared cache.
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(bytes);
  }

  /** POPIA erasure — the row AND the encrypted file. Throttled hard. */
  @Delete(':id')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  remove(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.svc.remove(clerkId, id);
  }
}
