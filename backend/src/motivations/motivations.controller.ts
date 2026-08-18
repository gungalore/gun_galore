import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { MotivationQuotaService } from './motivation-quota.service';
import { MotivationsService } from './motivations.service';
import {
  AcceptDeclarationDto,
  CreateMotivationDto,
  SaveAnswersDto,
} from './dto/motivation.dto';

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
