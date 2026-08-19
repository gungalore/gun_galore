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
import { MotivationLicenceType, MotivationUploadKind } from '@prisma/client';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { MotivationQuotaService } from './motivation-quota.service';
import { MotivationsService } from './motivations.service';
import {
  FIELD_REGISTRY_VERSION,
  LICENCE_TYPE_LABELS,
  fieldsFor,
} from './motivation-fields';
import {
  AcceptDeclarationDto,
  AnswerFollowUpDto,
  CreateMotivationDto,
  SaveAnswersDto,
} from './dto/motivation.dto';

/**
 * Upload limits, in one place.
 *
 * The interceptor's ceiling is deliberately a little ABOVE the pipe's. Multer
 * aborts an oversized request itself with a bare 413 that never reaches Nest;
 * leaving it slightly higher lets the ParseFilePipe answer first with something
 * an applicant can actually act on.
 *
 * ⚠️ NO HEIC. It was accepted platform-wide and reverted (6b8418b) after
 * full-resolution iPhone HEICs produced 413s. kyc.controller.ts and two others
 * still list heic/heif — that revert was incomplete, and copying them here
 * would bring the regression back.
 */
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_INTERCEPTOR_MAX = UPLOAD_MAX_BYTES + 512 * 1024;
const UPLOAD_MIME = /^(image\/(jpeg|png|webp)|application\/pdf)$/;

/**
 * Firearm-licence motivation writer — the member-facing surface.
 *
 * BEHIND THE LOGIN, ENTIRELY (operator decision #4). Nothing here is public and
 * nothing should be: the auth wall exists so alloutdoor.co.za carries no
 * firearm signal for signed-out visitors or crawlers. This needs NO entry in
 * the frontend's isPublicRoute — that matcher is an allow-list and the default
 * is deny, so a new route is authenticated by doing nothing.
 *
 * Gating lives in the SERVICE, not here, so the cron and admin paths get the
 * same check. With the flag off, everything below 404s — except /status, which
 * answers `{ enabled: false }` so the UI knows not to render an entry point.
 */
@Controller('motivations')
@UseGuards(ClerkGuard)
export class MotivationsController {
  constructor(
    private readonly quota: MotivationQuotaService,
    private readonly motivations: MotivationsService,
  ) {}

  /**
   * Whether the module is open, and what it costs. The ONLY way the frontend
   * learns the flag state — there is no generic public-config endpoint in this
   * codebase, so each module exposes its own.
   */
  @Get('status')
  status() {
    return this.quota.status();
  }

  /**
   * The question set for one licence type.
   *
   * Served rather than duplicated. The registry is 170 fields with conditional
   * visibility, per-field caps and choice lists; a second copy in the frontend
   * would drift on the first change, and the two halves disagreeing about what
   * is required is the kind of bug nobody notices until an application will not
   * generate.
   *
   * DEFINITIONS ONLY — keys, labels, help text, choices. No answers, no PII.
   *
   * ⚠️ Declared BEFORE @Get(':id'), because Nest matches in declaration order
   * and ':id' would otherwise swallow "fields".
   */
  @Get('fields/:licenceType')
  fields(@Param('licenceType') licenceType: string) {
    if (
      !Object.values(MotivationLicenceType).includes(
        licenceType as MotivationLicenceType,
      )
    ) {
      throw new BadRequestException('Unknown licence type.');
    }
    const type = licenceType as MotivationLicenceType;
    return {
      licenceType: type,
      label: LICENCE_TYPE_LABELS[type],
      version: FIELD_REGISTRY_VERSION,
      fields: fieldsFor(type),
    };
  }

  @Get()
  list(@CurrentUser() clerkId: string) {
    return this.motivations.listMine(clerkId);
  }

  // Starting one is cheap but allocates a document number, so it is rate
  // limited well below the global 60/min.
  @Post()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  create(@CurrentUser() clerkId: string, @Body() dto: CreateMotivationDto) {
    return this.motivations.create(
      clerkId,
      dto.licenceType,
      dto.applicationRef ?? '',
    );
  }

  @Get(':id')
  findOne(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.motivations.findOne(clerkId, id);
  }

  /**
   * Autosaved from the wizard, so it is called often and deliberately not
   * throttled below the global default.
   */
  @Patch(':id/answers')
  saveAnswers(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body() dto: SaveAnswersDto,
  ) {
    return this.motivations.saveAnswers(clerkId, id, dto.answers ?? {});
  }

  /**
   * The applicant confirms the facts are true and that they submit the
   * document as their own. Nothing renders without this.
   */
  @Post(':id/declaration')
  acceptDeclaration(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body() dto: AcceptDeclarationDto,
  ) {
    return this.motivations.acceptDeclaration(
      clerkId,
      id,
      dto.testimonialConsent ?? false,
    );
  }

  /**
   * Draft the document. The expensive one — every call is a flagship
   * generation plus a grading pass, so it is throttled hard. The service
   * additionally compare-and-swaps the row, so two clicks that arrive inside
   * the throttle window still cannot both spend money.
   */
  @Post(':id/generate')
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  generate(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.motivations.generate(clerkId, id);
  }

  /**
   * Download the PDF. Rebuilt from the encrypted text on every request —
   * nothing is stored, so there is no file to leak and none to chase at
   * erasure.
   *
   * `Cache-Control: private, no-store` because this is somebody's ID number,
   * home address and security circumstances; it must not sit in a shared
   * proxy or a browser cache.
   */
  @Get(':id/pdf')
  async pdf(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { pdf, filename } = await this.motivations.renderPdf(clerkId, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': String(pdf.length),
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(Buffer.from(pdf));
  }

  /**
   * The live submission checklist. Drives the progress list on the platform and
   * in the PWA — what we have, what is still outstanding, and what the applicant
   * must take to the station themselves.
   */
  @Get(':id/checklist')
  checklist(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.motivations.checklist(clerkId, id);
  }

  // ── the profile, with permission ──────────────────────────────────

  /**
   * What we WOULD fill from their All Outdoor profile, and where each value
   * comes from. Read-only: showing the list before asking is the point.
   */
  @Get(':id/profile-offer')
  profileOffer(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.motivations.profilePrefillOffer(clerkId, id);
  }

  /** They agree, and we copy. Consent is stamped on this application. */
  @Post(':id/use-profile')
  useProfile(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.motivations.useProfile(clerkId, id);
  }

  // ── uploads ───────────────────────────────────────────────────────

  /**
   * Add a supporting document.
   *
   * Bytes go to our own encrypted store, NOT to Cloudinary, so there is no
   * public URL to leak. Throttled: each upload writes a file and will later
   * trigger an extraction, so it costs more than an ordinary request.
   */
  @Post(':id/uploads')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: UPLOAD_INTERCEPTOR_MAX },
    }),
  )
  addUpload(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body('kind') kind: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: UPLOAD_MAX_BYTES }),
          new FileTypeValidator({ fileType: UPLOAD_MIME }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    // Validated HERE, by hand. The global ValidationPipe has no
    // forbidNonWhitelisted and a bare @Body('kind') is not a DTO, so an
    // arbitrary string would sail through and surface as a Prisma 500.
    if (!Object.values(MotivationUploadKind).includes(kind as MotivationUploadKind)) {
      throw new BadRequestException('Unknown document type.');
    }
    return this.motivations.addUpload(
      clerkId,
      id,
      kind as MotivationUploadKind,
      file,
    );
  }

  /**
   * Write the suggestions the applicant confirmed.
   *
   * A separate call from the upload, deliberately: reading a document proposes
   * values, the applicant accepts them, and only then are they written. A
   * misread digit that became an answer silently would be a false statement on
   * a form they sign.
   */
  @Post(':id/uploads/apply')
  applyExtraction(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body() dto: SaveAnswersDto,
  ) {
    return this.motivations.applyExtraction(clerkId, id, dto.answers ?? {});
  }

  /** The annexure list — metadata only, never bytes. */
  @Get(':id/uploads')
  listUploads(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.motivations.listUploads(clerkId, id);
  }

  /**
   * Read one document back.
   *
   * Same posture as the PDF endpoint: `private, no-store`, because this is
   * somebody's identity document and it must not sit in a shared proxy or a
   * browser cache. The service decrypts BEFORE any header is set — a tampered
   * file fails its auth tag, and headers-then-throw emits a 200 that dies
   * halfway through the body.
   */
  @Get(':id/uploads/:uploadId')
  async readUpload(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Param('uploadId') uploadId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { bytes, mimeType, filename } = await this.motivations.readUpload(
      clerkId,
      id,
      uploadId,
    );
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(bytes);
  }

  @Delete(':id/uploads/:uploadId')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  removeUpload(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Param('uploadId') uploadId: string,
  ) {
    return this.motivations.removeUpload(clerkId, id, uploadId);
  }

  // ── the follow-up interview ───────────────────────────────────────

  /** The conversation so far, decrypted for the person it belongs to. */
  @Get(':id/messages')
  listMessages(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.motivations.listMessages(clerkId, id);
  }

  /**
   * Answer one follow-up.
   *
   * Lands in two places on purpose: the conversation, so they can see what they
   * said, and the encrypted answer blob under the field the question was about,
   * because that blob is what the document is built from.
   */
  @Post(':id/messages/:messageId')
  answerFollowUp(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body() dto: AnswerFollowUpDto,
  ) {
    return this.motivations.answerFollowUp(clerkId, id, messageId, dto.answer);
  }

  @Post(':id/abandon')
  abandon(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.motivations.abandon(clerkId, id);
  }

  /**
   * POPIA erasure — deletes the record AND the encrypted ID/licence scans off
   * our disk. Irreversible, so it is throttled hard.
   */
  @Delete(':id')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  erase(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.motivations.erase(clerkId, id);
  }
}
