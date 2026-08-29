import {
  BadRequestException,
  NotFoundException,
  Body,
  Controller,
  Delete,
  FileTypeValidator,
  Get,
  HttpCode,
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
import { COVER_MAX_BYTES } from './motivation-cover-photo';
import { memoryStorage } from 'multer';
import { MotivationLicenceType, MotivationUploadKind } from '@prisma/client';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { MotivationQuotaService } from './motivation-quota.service';
import { MotivationsService } from './motivations.service';
import { RETIRED } from './motivation-documents';
import {
  FIELD_REGISTRY_VERSION,
  LICENCE_TYPE_LABELS,
  fieldsFor,
} from './motivation-fields';
import { expandFields } from './motivation-field-options';
import {
  AcceptDeclarationDto,
  AnswerFollowUpDto,
  CreateMotivationDto,
  RenameMotivationDto,
  SaveAnswersDto,
  SetTemplateDto,
} from './dto/motivation.dto';
import { templateCatalogue } from './motivation-templates';

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
      // expandFields attaches the discipline list and its prefill text. The
      // registry stays a registry; the data stays data.
      fields: expandFields(fieldsFor(type)),
    };
  }

  /**
   * The fifteen templates the picker offers.
   *
   * ⚠️ DECLARED BEFORE @Get(':id') for the same reason as `fields` above —
   * Nest matches in declaration order, and ':id' would otherwise swallow
   * "templates" and hand it to findOne as a motivation id.
   *
   * No id and no applicant data: colour names and section lists, from a pure
   * function, so it costs nothing and can be cached hard.
   */
  @Get('templates')
  templates() {
    return templateCatalogue();
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
   * Which template the applicant picked.
   *
   * Separate from saveAnswers because it is NOT an answer: it changes nothing
   * about what the document argues, only how it is set. It stays editable
   * after the document is written, so somebody who dislikes the colour can
   * change it and download again without regenerating — the body is stored
   * text and the PDF is re-rendered on every download anyway.
   */
  @Patch(':id/template')
  setTemplate(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body() dto: SetTemplateDto,
  ) {
    return this.motivations.setTemplate(clerkId, id, dto);
  }

  /**
   * The member's own name for this application on their list.
   *
   * Operator, board review 2026-08-27: "User must be able to rename the
   * motivation." Purely organisational — see motivations.service.ts#rename
   * for why it never reaches the document.
   */
  @Patch(':id/label')
  rename(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body() dto: RenameMotivationDto,
  ) {
    return this.motivations.rename(clerkId, id, dto.label);
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
   * Draft the document. The expensive one — a real call is a flagship
   * generation plus a grading pass, so it stays throttled, and the service
   * additionally compare-and-swaps the row so two clicks that arrive inside
   * the window still cannot both spend money.
   *
   * ⚠️ NOT EVERY CALL IS THE EXPENSIVE ONE, which is what the old limit of
   * three got wrong. generate() refuses ahead of the compare-and-swap for a
   * missing declaration and for missing required answers, and neither refusal
   * calls a model. The throttler charges in the guard, before the handler
   * runs, and @nestjs/throttler has no way to refund a hit — so three
   * rejected clicks bought an hour of ThrottlerException with nothing drafted
   * and nothing spent. That happened to a live applicant.
   *
   * Ten leaves room for an honest retry after a validation refusal while
   * still capping flagship spend per IP per hour. The real cost ceilings are
   * elsewhere and unchanged: one in-flight generation per motivation (the
   * CAS) and the beta seat cap.
   */
  @Post(':id/generate')
  @HttpCode(202)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  generate(@CurrentUser() clerkId: string, @Param('id') id: string) {
    // ⚠️ 202, AND IT RETURNS BEFORE THE DOCUMENT EXISTS. Holding the request
    // open for the ~90 seconds a real generation takes does not work: nginx
    // gives an upstream 60 seconds and Cloudflare cuts the origin at 100
    // regardless, so the applicant saw a 504 for work that had completed and
    // been paid for. The wizard polls the row's status instead.
    //
    // Everything the applicant can act on is still refused synchronously —
    // startGeneration does the whole preflight and the claim before it
    // returns — so a 202 means "running", never "we will find out later
    // whether this was even valid".
    return this.motivations.startGeneration(clerkId, id);
  }

  /**
   * Read the draft, passed or not. The PDF is what you file; this is what you
   * read, so a document held back for more detail can be looked at rather
   * than only scored.
   */
  @Get(':id/draft')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  draft(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.motivations.draftText(clerkId, id);
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

  // ── The cover photograph ────────────────────────────────────────
  //
  // Operator, 2026-08-21: "if the system cant find one, the user has the
  // option to upload one... We can prescreen the image that we found to the
  // user and ask if they want to keep or replace it with their own."
  //
  // Which is the honest answer to a search that can only accept a photograph
  // it can prove is the right make and model: the applicants most likely to
  // get a blank cover are the ones who own the less-photographed firearms, and
  // they are also the ones holding the firearm.

  /** What we hold, what they chose, and where a stock photograph came from. */
  @Get(':id/cover-photo')
  coverPhoto(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.motivations.coverPhoto(clerkId, id);
  }

  /**
   * The image itself, for the on-screen prescreen.
   *
   * ⚠️ `private, no-store`, like the PDF. Whichever branch answers, this is
   * either a photograph the applicant took of their own firearm or a picture
   * naming the model they are applying for — neither belongs in a shared proxy
   * cache, and the second is as good as telling anyone downstream what the
   * application is for.
   */
  @Get(':id/cover-photo/image')
  async coverPhotoImage(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const found = await this.motivations.coverPhotoBytes(clerkId, id);
    if (!found) throw new NotFoundException('No cover photograph');
    res.set({
      'Content-Type': found.mimeType,
      'Content-Length': String(found.bytes.length),
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(found.bytes);
  }

  /** Keep the stock photograph, use their own, or print none. */
  @Post(':id/cover-photo/choice')
  setCoverChoice(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body('choice') choice: string,
  ) {
    return this.motivations.setCoverPhotoChoice(clerkId, id, choice ?? '');
  }

  /**
   * Upload their own.
   *
   * ⚠️ A TIGHTER CEILING THAN THE DOCUMENT UPLOADS, and a narrower mime set.
   * A supporting document may be a 10 MB scan or a PDF because it is reprinted
   * whole; this is decoration for a 62 mm frame, pdfkit embeds JPEG bytes
   * VERBATIM rather than re-encoding them, and the client has already cropped
   * and resized before sending. Anything near this ceiling is a client that
   * did not run — accepted, but not encouraged.
   */
  @Post(':id/cover-photo')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: COVER_MAX_BYTES + 256 * 1024 },
    }),
  )
  uploadCoverPhoto(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: COVER_MAX_BYTES }),
          new FileTypeValidator({ fileType: /^image\/(jpeg|png)$/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.motivations.uploadCoverPhoto(clerkId, id, file);
  }

  /** Discard their own and fall back to whatever we found. */
  @Delete(':id/cover-photo')
  removeCoverPhoto(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.motivations.removeCoverPhoto(clerkId, id);
  }

  /**
   * The pre-filled SAPS 271. Only exists for applicants who opted in — the
   * dealer usually completes this form, so by default we never produce it.
   *
   * Same posture as the motivation PDF: rebuilt on demand, nothing stored,
   * `private, no-store` because it carries an ID number and a home address.
   */
  @Get(':id/saps271')
  async saps271(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { pdf, filename } = await this.motivations.renderSaps271(clerkId, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': String(pdf.length),
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(pdf);
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

  /**
   * The whole left column of the application screen, in one call: the
   * checklist, where every prefilled answer came from, and how much we filled
   * before the applicant typed anything.
   *
   * Replaces the several calls the screen used to make. Read-only, and
   * ownership is enforced in the service's WHERE clause like every other
   * ':id/...' route here.
   */
  @Get(':id/pack')
  pack(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.motivations.pack(clerkId, id);
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

  // ── the Licence Centre ────────────────────────────────────────────

  /**
   * What their own vault could fill in here, and which document each value
   * comes from. Read-only: showing the list before asking is the point, and
   * it is the same shape as the profile offer above.
   */
  @Get(':id/licence-centre-offer')
  licenceCentreOffer(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.motivations.licenceCentreOffer(clerkId, id);
  }

  /** They agree, and we copy. Never overwrites an answer they typed. */
  @Post(':id/use-licence-centre')
  useLicenceCentre(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.motivations.useLicenceCentre(clerkId, id);
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
  // A pack is a dozen files sent back to back, so the ceiling has to clear a
  // legitimate batch with room to spare — 20 was a limit an honest applicant
  // could hit halfway through uploading their own documents.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
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
    // NO KIND MEANS "SORT IT FOR ME" — the batch path, where a member picks a
    // whole pack at once and cannot label files that do not exist yet. The
    // service names the document from its contents.
    const wanted = (kind ?? '').trim();
    if (!wanted) {
      return this.motivations.addUpload(clerkId, id, null, file);
    }

    // Validated HERE, by hand. The global ValidationPipe has no
    // forbidNonWhitelisted and a bare @Body('kind') is not a DTO, so an
    // arbitrary string would sail through and surface as a Prisma 500.
    if (
      !Object.values(MotivationUploadKind).includes(
        wanted as MotivationUploadKind,
      )
    ) {
      throw new BadRequestException('Unknown document type.');
    }
    // A RETIRED kind is a valid enum value that nothing may write any more.
    // Postgres cannot drop an enum value, so the ban has to live here — and it
    // has to live here rather than only in the picker, or "no new row can
    // carry it" is an intention rather than a fact.
    //
    // The realistic sender is a PWA running a bundle from before 2026-08-23,
    // whose menu still offers the four separate safe entries. Accepting one
    // would file the photograph as extra evidence and go on showing the safe
    // row short, which reads as the upload having failed silently.
    //
    // ⚠️ THE MESSAGE HAS TO TRACK THE DIRECTION OF THE LAST CHANGE. It told
    // members their type "has been replaced by three separate safe
    // photographs" — true on 2026-08-19 and the exact opposite of what happened
    // on 2026-08-23, so somebody on the old bundle was being sent to look for
    // three menu entries that no longer exist.
    if (RETIRED.includes(wanted as MotivationUploadKind)) {
      throw new BadRequestException(
        'The safe photographs are now one line that takes several pictures. Please refresh the page and add them all there.',
      );
    }
    return this.motivations.addUpload(
      clerkId,
      id,
      wanted as MotivationUploadKind,
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
  /**
   * Refile a document under a different type.
   *
   * The required-documents list counts the TYPE, so this is the difference
   * between a pack that looks complete and one that is.
   */
  @Patch(':id/uploads/:uploadId')
  refileUpload(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Param('uploadId') uploadId: string,
    @Body('kind') kind: string,
  ) {
    if (
      !Object.values(MotivationUploadKind).includes(
        kind as MotivationUploadKind,
      )
    ) {
      throw new BadRequestException('Unknown document type.');
    }
    if (RETIRED.includes(kind as MotivationUploadKind)) {
      throw new BadRequestException(
        'That document type has been replaced. Please refresh and choose from the updated list.',
      );
    }
    return this.motivations.changeUploadKind(
      clerkId,
      id,
      uploadId,
      kind as MotivationUploadKind,
    );
  }

  /**
   * Everything this member could reuse instead of photographing it again.
   *
   * ⚠️ DECLARED ABOVE `@Get(':id/uploads')`? No — a literal segment and a
   * param segment at the same depth do not collide in Nest, but `library` and
   * `uploads` are both literals so order is irrelevant here. Kept next to the
   * uploads routes because that is what it is about.
   */
  @Get(':id/library')
  library(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.motivations.library(clerkId, id);
  }

  /**
   * Attach everything this application needs that the member already holds.
   *
   * Operator, 2026-08-24: "why can't the server add the relevant documents in
   * place and mark them green for me?"
   *
   * ⚠️ A POST, DELIBERATELY, THOUGH IT READS LIKE A GET. Attaching is a WRITE
   * to somebody's licence application. Doing it as a side effect of loading
   * the page would mean a refresh, a second tab or the documents step's own
   * 20-second poll silently changing what a DFO will see — every twenty
   * seconds. The wizard calls this once, on purpose, and it is idempotent.
   */
  @Post(':id/autolink')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  autolink(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.motivations.autolink(clerkId, id);
  }

  /** Attach one of them, without asking for the file again. */
  @Post(':id/uploads/from-library')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  addFromLibrary(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body('source') source: string,
    @Body('sourceId') sourceId: string,
    // "These are the safe at the address on this application." Required for
    // every photograph of the safe — asksPlace() is the authority, and it
    // covers the retired kinds an older application still carries. See
    // addFromLibrary.
    // ⚠️ Coerced, not trusted: a bare @Body() is not a DTO and the global
    // ValidationPipe has no forbidNonWhitelisted, so the string "false" would
    // otherwise arrive here and read as a confirmation.
    @Body('placeConfirmed') placeConfirmed?: unknown,
  ) {
    if (source !== 'credential' && source !== 'upload') {
      throw new BadRequestException('Unknown document source.');
    }
    if (!sourceId?.trim()) {
      throw new BadRequestException('Which document?');
    }
    return this.motivations.addFromLibrary(
      clerkId,
      id,
      source,
      sourceId.trim(),
      placeConfirmed === true,
    );
  }

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

  /**
   * Read an attached document again after a failed read.
   *
   * Throttled per handler: each call is a vision request on bytes we already
   * hold, so a stuck button must not be able to spend them in a loop.
   */
  @Post(':id/uploads/:uploadId/reread')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  rereadUpload(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Param('uploadId') uploadId: string,
  ) {
    return this.motivations.rereadUpload(clerkId, id, uploadId);
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
