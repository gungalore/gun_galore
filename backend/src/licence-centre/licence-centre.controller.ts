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
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CredentialKind } from '@prisma/client';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  LicenceCentreService,
  MAX_IDENTIFY_FILES,
} from './licence-centre.service';
import { LicenceCentreQuotaService } from './licence-centre-quota.service';
import { VaultConsentService } from '../users/vault-consent.service';
import { KycIdAdoptionService } from './kyc-id-adoption.service';
import { VaultAdoptionService } from '../motivations/vault-adoption.service';
import {
  CONTAINER_VERSION,
  EVIDENCE_CONTAINERS,
  EVIDENCE_GROUP_LABELS,
  EVIDENCE_GROUP_ORDER,
} from '../motivations/evidence-taxonomy';
// ⚠️ SHARED, NOT DECLARED HERE. Both doors into the Centre must accept
// exactly the same files — see upload-limits.ts for why a second copy of these
// was a silent divergence waiting to happen.
import {
  UPLOAD_INTERCEPTOR_MAX,
  UPLOAD_MAX_BYTES,
  UPLOAD_MIME,
} from './upload-limits';

// Behind the login, like everything in this area. middleware.ts's isPublicRoute
// is an allow-list with default deny, so the frontend route is authenticated by
// having no entry there — nothing to add and nothing to forget to add.

/**
 * ⚠️ SHARED, NOT DECLARED TWICE, for the reason upload-limits.ts gives about
 * the limits themselves: every door into the Centre must accept exactly the
 * same files. Two copies of these messages is a divergence that shows up as
 * one door accepting a PDF the other refuses.
 */
const FILE_PIPE = new ParseFilePipe({
  // ⚠️ errorMessage on BOTH, or the member is shown the validator's own text —
  // a JavaScript regular expression under a red heading.
  validators: [
    new MaxFileSizeValidator({
      maxSize: UPLOAD_MAX_BYTES,
      errorMessage:
        'That file is larger than 10 MB. A photo taken at a lower resolution will be well under it.',
    }),
    new FileTypeValidator({
      fileType: UPLOAD_MIME,
      errorMessage:
        'We can read a JPG, PNG, WebP or PDF. On an iPhone, choose the photo from your library rather than from Files.',
    }),
  ],
});




@Controller('licence-centre')
@UseGuards(AuthGuard)
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
  kycIdOffer(@CurrentUser() userId: string) {
    return this.kycId.offer(userId);
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
  adoptKycId(@CurrentUser() userId: string) {
    return this.kycId.adopt(userId);
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
  consentState(@CurrentUser() userId: string) {
    return this.consent.get(userId);
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
    @CurrentUser() userId: string,
    @Body('agreed') agreed: unknown,
  ) {
    // Validated by hand: a bare @Body() is not a DTO and the global
    // ValidationPipe has no forbidNonWhitelisted, so anything at all arrives
    // here as `unknown`. An ambiguous value must never be read as a yes.
    if (typeof agreed !== 'boolean') {
      throw new BadRequestException('Answer must be yes or no.');
    }
    return this.consent.answer(userId, agreed);
  }

  /** Turn it off. ⚠️ Deletes nothing — see VaultConsentService.withdraw. */
  @Delete('consent')
  withdrawConsent(@CurrentUser() userId: string) {
    return this.consent.withdraw(userId);
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
  async backfillStep(@CurrentUser() userId: string) {
    const step = await this.adoption.backfillStep(userId);
    return { ...step, remaining: await this.adoption.backfillRemaining(userId) };
  }

  /**
   * Deliberately NOT gated on the flag: with the module off every other
   * endpoint 404s, and the page needs one call it can trust to render the
   * "not open yet" state instead of storming the rest.
   */
  /**
   * Where each stored document already appears.
   *
   * ⚠️ DECLARED BEFORE ANY ':id' ROUTE. Nest matches in declaration order, so
   * a bare parameter route above this one would swallow /usage as an id.
   *
   * One request for the whole list rather than one per document: a member has
   * a few dozen documents and a handful of applications, and the panel would
   * otherwise fire a request on every click through the file list.
   */
  @Get('usage')
  usage(@CurrentUser() userId: string) {
    return this.svc.usage(userId);
  }

  @Get('status')
  status() {
    return this.quota.status();
  }

  @Get()
  list(@CurrentUser() userId: string) {
    return this.svc.list(userId);
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
    @CurrentUser() userId: string,
    @Body('kind') kind: string,
    @Body('title') title: string,
    @Body('identifyId') identifyId: string,
    @Body('description') description: string,
    @UploadedFile(FILE_PIPE) file: Express.Multer.File,
  ) {
    // ⚠️ THE IDENTIFY ID IS A SEPARATE FIELD FROM `kind`, DELIBERATELY. `kind`
    // is the member's own choice and still overrides everything below; the id
    // is a token naming a verdict the SERVER reached, and the service reads
    // the classification from its own record rather than from this request.
    // Two fields, so a member's explicit pick can never be confused with a
    // forged classifier answer — see create()'s opts note.
    const fromIdentify = (identifyId ?? '').trim();
    const opts = {
      identifyId: fromIdentify || undefined,
      description: (description ?? '').trim() || undefined,
    };

    // NO KIND MEANS "SORT IT FOR ME" — the batch path, where a member adds a
    // whole folder at once and names nothing up front.
    const wanted = (kind ?? '').trim();
    if (!wanted) return this.svc.create(userId, null, title, file, opts);

    // Validated HERE, by hand. The global ValidationPipe has no
    // forbidNonWhitelisted and a bare @Body('kind') is not a DTO, so an
    // arbitrary string would sail through and surface as a Prisma 500.
    if (!Object.values(CredentialKind).includes(wanted as CredentialKind)) {
      throw new BadRequestException('Unknown document type.');
    }
    return this.svc.create(userId, wanted as CredentialKind, title, file);
  }

  /**
   * THE IDENTIFY PASS — sort a batch BEFORE anything is polished or stored.
   *
   * Operator, 2026-09-26: "user selects what they want to upload. as soon as
   * they are done uploading the server gives them each a unique ID. Send them
   * all to deepseek, it basicly sorts them... Then only does the document
   * polish on them and saves it on the server who already has the OCR and
   * need to marry it by ID to the physical document."
   *
   * ⚠️ THIS STORES NOTHING. It reads each file, decides document-or-evidence
   * and the kind or container, remembers the verdict and the OCR text under an
   * id it mints itself, and hands the client that list. The client polishes
   * the DOCUMENTS only (a hunting photograph is not a page), uploads each with
   * its id, and `create()` files it from our own record.
   *
   * ⚠️ DECLARED BEFORE THE ':id' ROUTES, like `usage` and `status` — Nest
   * matches in declaration order and a bare parameter route would swallow
   * /identify as an id.
   *
   * ⚠️ THE DESCRIPTIONS ARRIVE AS A PARALLEL ARRAY, NOT PER-FILE FIELDS. A
   * multipart body has no room to hang an object off each part, and the client
   * sends the files in the same order it sends the descriptions. A missing or
   * short array simply means "no words yet" for the tail of the batch, which
   * is the normal first pass — the member types them on the card afterwards.
   */
  @Post('identify')
  // A whole folder identified in one gesture, then re-identified on a refresh;
  // 60 matches the create door above for the same reason.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseInterceptors(
    FilesInterceptor('files', MAX_IDENTIFY_FILES, {
      storage: memoryStorage(),
      limits: { fileSize: UPLOAD_INTERCEPTOR_MAX },
    }),
  )
  identify(
    @CurrentUser() userId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('descriptions') descriptions?: string | string[],
  ) {
    const words = Array.isArray(descriptions)
      ? descriptions
      : descriptions
        ? [descriptions]
        : [];
    return this.svc.identify(
      userId,
      (files ?? []).map((file, i) => ({
        buffer: file.buffer,
        mimetype: file.mimetype,
        description: words[i],
      })),
    );
  }

  /**
   * EVIDENCE, WHICH IS NOT A DOCUMENT.
   *
   * ⚠️ ITS OWN ROUTE, AND NOT `kind=EVIDENCE` ON THE ONE ABOVE. A document
   * arriving here with no kind is SORTED by the document classifier; an
   * evidence item is sorted by the evidence classifier into a container,
   * against the member's own description, and stored with the answer. Folding
   * them together would mean the batch-scan door could file a photograph of a
   * hunt as OTHER with no container and no way to correct it.
   *
   * ⚠️ DECLARED BEFORE THE ':id' ROUTES, like `usage` and `status` above —
   * Nest matches in declaration order, so a bare parameter route would
   * swallow /evidence as an id.
   */
  /**
   * Every container the classifier knows, and what each is, grouped.
   *
   * ⚠️ SERVED RATHER THAN DUPLICATED IN THE FRONTEND. The taxonomy lives in
   * evidence-taxonomy.ts and is expected to be revised; a copy on the client
   * would go stale the first time a container moved between groups or changed
   * placement, and the member would be offered the old list with no way to see
   * it disagree with the server. Also declares before the ':id' routes for the
   * same reason as the others.
   */
  @Get('evidence/containers')
  evidenceContainers() {
    return {
      version: CONTAINER_VERSION,
      groups: EVIDENCE_GROUP_ORDER.map((id) => ({
        id,
        label: EVIDENCE_GROUP_LABELS[id],
      })),
      // `hint` is deliberately NOT sent: it exists to discriminate for the
      // model, and it is written as an instruction to a reader that is not the
      // member — a container's placement tells the member everything they
      // need about where it will print.
      containers: EVIDENCE_CONTAINERS.map((c) => ({
        id: c.id,
        group: c.group,
        label: c.label,
        placement: c.placement,
      })),
    };
  }

  @Post('evidence')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: UPLOAD_INTERCEPTOR_MAX },
    }),
  )
  addEvidence(
    @CurrentUser() userId: string,
    @Body('description') description: string,
    @UploadedFile(FILE_PIPE) file: Express.Multer.File,
  ) {
    return this.svc.createEvidence(userId, description ?? '', file);
  }

  /**
   * The description loop — sort the same file again against better words.
   *
   * ⚠️ A PATCH, NOT A SECOND POST. The bytes have not changed; only what the
   * member says about them has, and a re-upload would collide with the
   * unique constraint on (userId, sha256) and tell them their own file is
   * already in their Document Centre.
   */
  @Patch(':id/evidence')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  redescribeEvidence(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body('description') description: string,
  ) {
    return this.svc.redescribeEvidence(userId, id, description ?? '');
  }

  @Post(':id/confirm')
  confirm(
    @CurrentUser() userId: string,
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
    return this.svc.confirmExpiry(userId, id, {
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
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body('title') title: string,
  ) {
    return this.svc.rename(userId, id, title ?? '');
  }

  @Patch(':id/mute')
  mute(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body('muted') muted: boolean,
  ) {
    return this.svc.mute(userId, id, muted === true);
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
  renew(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.svc.startRenewal(userId, id);
  }

  @Get(':id/file')
  async readFile(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { bytes, mimeType, filename } = await this.svc.readFile(userId, id);
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': String(bytes.length),
      // Somebody's licence must not sit in a shared cache.
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(bytes);
  }

  /**
   * POPIA erasure — the row AND the encrypted file.
   *
   * ⚠️ 60, NOT 10, AND THE OLD CEILING COST A REAL AFTERNOON. The operator
   * cleared their vault on 2026-09-09 and deleted ten documents in
   * thirty-six seconds; the eleventh onwards returned 429, the card renders
   * any failure as "We could not delete that just now", and they reported
   * that "safe pictures and proficiencies wont delete" — because those were
   * the kinds they happened to reach last. The vault event log shows exactly
   * ten deletes between 16:15:27 and 16:16:03 and none after.
   *
   * ⚠️ THE SAME LESSON THE UPLOAD ROUTE ALREADY LEARNED, in the other
   * direction: `POST /licence-centre` says "20 was a ceiling a member could
   * hit halfway through adding their own paperwork" and was raised to 60.
   * Somebody clearing a vault deletes as many documents as they added.
   *
   * Still throttled, because this destroys bytes: 60 a minute is a person
   * working through a folder, not a script.
   */
  @Delete(':id')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  remove(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.svc.remove(userId, id);
  }

  /**
   * Keep this version instead of the one it was flagged as a copy of.
   *
   * ⚠️ POST, NOT PATCH. It destroys the original — file and row — so it is an
   * act with a consequence, not an edit to this row's fields. Throttled with
   * the delete path it borrows, because it erases through it.
   */
  @Post(':id/replace')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  replace(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.svc.replaceWith(userId, id);
  }
}
