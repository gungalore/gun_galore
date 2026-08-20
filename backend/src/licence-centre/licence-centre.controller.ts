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
  ) {}

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
  ) {
    // The kind is optional, but if one is sent it must be real — it decides
    // whether this document is ever offered a renewal.
    const wanted = (kind ?? '').trim();
    if (wanted && !Object.values(CredentialKind).includes(wanted as CredentialKind)) {
      throw new BadRequestException('Unknown document type.');
    }
    return this.svc.confirmExpiry(
      clerkId,
      id,
      expiresOn,
      issuedOn,
      wanted ? (wanted as CredentialKind) : undefined,
      title,
    );
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
