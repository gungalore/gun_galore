import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Valuation } from '@prisma/client';
import { randomBytes } from 'crypto';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from './cache.service';
import { CategoryConfigs } from './config/category-configs';
import { CompService, isEphemeralUrl } from './comp.service';
import { ExifService } from './exif.service';
import { ValuationEvents } from './events.service';
import { IdentifyService } from './identify.service';
import { ImageSelectService } from './image-select.service';
import { QuestionService, ServedQuestion } from './question.service';
import { ResearchService } from './research.service';
import { SoldCompsService } from './sold-comps.service';
import { ExternalSourceService } from './sources/external-source.service';
import { RawComp, ResultOutput } from './schemas';
import {
  IDENTIFY_PROMPT_VERSION,
  MEMBER_INPUT_HEADER,
  RESEARCH_PROMPT_VERSION,
} from './prompts';
import {
  PhotoChecklistItem,
  ValuationPhotoResult,
  ValuationState,
} from './valuation.types';

const MAX_PHOTOS = Number(process.env.VALUATION_MAX_PHOTOS ?? 8);
const CAPTURE_TTL_MINUTES = Number(process.env.VALUATION_CAPTURE_TTL_MINUTES ?? 15);
const MAX_INVALID_TOKEN_ATTEMPTS = 5;

export interface SavedAnswer {
  questionId: string;
  selected: string[];
  custom?: string | null;
  unsure: boolean;
}

/**
 * Valuation state machine and orchestration. Phase 1 plumbing plus the
 * identify, question, research and outcome stages. All pricing maths is done
 * by CompService; this service only sequences and persists.
 */
@Injectable()
export class ValuationService {
  private readonly logger = new Logger(ValuationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly exif: ExifService,
    private readonly configs: CategoryConfigs,
    private readonly imageSelect: ImageSelectService,
    private readonly identifyService: IdentifyService,
    private readonly questions: QuestionService,
    private readonly researchService: ResearchService,
    private readonly comps: CompService,
    private readonly cache: CacheService,
    private readonly events: ValuationEvents,
    private readonly soldComps: SoldCompsService,
    private readonly external: ExternalSourceService,
  ) {}

  // ── Lifecycle ──────────────────────────────────────────────────────

  async create(userId: string, description?: string, itemName?: string) {
    const valuation = await this.prisma.valuation.create({
      data: {
        userId,
        description: description ?? null,
        itemName: itemName?.trim() || null,
      },
    });
    return {
      id: valuation.id,
      status: valuation.status,
      maxPhotos: MAX_PHOTOS,
      photoChecklist: this.configs.genericChecklist(),
    };
  }

  async getState(id: string, userId: string): Promise<ValuationState> {
    const valuation = await this.assertOwner(id, userId);
    const images = await this.prisma.valuationImage.findMany({
      where: { valuationId: id },
      orderBy: { createdAt: 'asc' },
    });
    return {
      id: valuation.id,
      status: valuation.status,
      itemName: valuation.itemName,
      description: valuation.description,
      categorySlug: valuation.categorySlug,
      photoChecklist: this.checklistFor(valuation.categorySlug),
      images: images.map((img) => ({
        id: img.id,
        url: img.url,
        viewTag: img.viewTag,
        source: img.source,
      })),
      identify: valuation.identifyJson ?? null,
      questions: valuation.questionsJson ?? null,
      answers: valuation.answersJson ?? null,
      researchSteps: [],
      result: valuation.resultJson ?? null,
      legalFlags: this.configs.forCategory(valuation.categorySlug).legalFlags,
    };
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.assertOwner(id, userId);
    await this.prisma.valuation.delete({ where: { id } });
  }

  // ── Photos ─────────────────────────────────────────────────────────

  async addPhoto(
    id: string,
    userId: string,
    file: Express.Multer.File,
    opts: { viewTag?: string; source?: string },
  ): Promise<ValuationPhotoResult> {
    const valuation = await this.assertOwner(id, userId);
    return this.storePhoto(valuation, file, opts);
  }

  private async storePhoto(
    valuation: Valuation,
    file: Express.Multer.File,
    opts: { viewTag?: string; source?: string },
  ): Promise<ValuationPhotoResult> {
    if (valuation.status === 'RESEARCHING' || valuation.status === 'COMPLETED') {
      throw new BadRequestException('Photos are locked once research has started');
    }
    const photoCount = await this.prisma.valuationImage.count({
      where: { valuationId: valuation.id },
    });
    if (photoCount >= MAX_PHOTOS) {
      throw new BadRequestException({ message: 'Photo limit reached', photoCount });
    }
    const { buffer, width, height } = await this.exif.strip(file.buffer);
    const { url, publicId } = await this.cloudinary.uploadImage(buffer, 'valuation-photos');
    const checklist = this.checklistFor(valuation.categorySlug);
    const viewTag =
      opts.viewTag && checklist.some((c) => c.tag === opts.viewTag) ? opts.viewTag : null;

    const image = await this.prisma.valuationImage.create({
      data: {
        valuationId: valuation.id,
        publicId,
        url,
        viewTag,
        source: opts.source ?? 'DESKTOP',
        width,
        height,
        bytes: buffer.length,
        exifStrippedAt: new Date(),
      },
    });

    const nextCount = photoCount + 1;
    return {
      image: {
        id: image.id,
        url: image.url,
        viewTag: image.viewTag,
        source: image.source,
        width: image.width,
        height: image.height,
      },
      photoCount: nextCount,
      slotsRemaining: MAX_PHOTOS - nextCount,
      photoChecklist: checklist,
    };
  }

  async removePhoto(id: string, userId: string, photoId: string) {
    await this.assertOwner(id, userId);
    const image = await this.prisma.valuationImage.findFirst({
      where: { id: photoId, valuationId: id },
    });
    if (!image) throw new NotFoundException('Photo not found');
    await this.prisma.valuationImage.delete({ where: { id: image.id } });
    try {
      await this.cloudinary.deleteImage(image.publicId);
    } catch (err) {
      this.logger.warn(
        `failed to delete Cloudinary asset ${image.publicId}: ${(err as Error).message}`,
      );
    }
  }

  // ── QR capture sessions ────────────────────────────────────────────

  async startCaptureSession(id: string, userId: string) {
    await this.assertOwner(id, userId);
    await this.prisma.valuationCaptureSession.updateMany({
      where: { valuationId: id, status: 'OPEN' },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    const token = randomBytes(16).toString('base64url');
    const expiresAt = new Date(Date.now() + CAPTURE_TTL_MINUTES * 60 * 1000);
    await this.prisma.valuationCaptureSession.create({
      data: { token, valuationId: id, userId, expiresAt },
    });
    return { token, url: `/v/${token}`, expiresAt };
  }

  async closeCaptureSession(id: string, userId: string) {
    await this.assertOwner(id, userId);
    await this.prisma.valuationCaptureSession.updateMany({
      where: { valuationId: id, status: 'OPEN' },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    this.events.emitCapture(id, { type: 'session_closed' });
    return { status: 'CLOSED' };
  }

  private async resolveToken(token: string) {
    const session = await this.prisma.valuationCaptureSession.findUnique({
      where: { token },
    });
    if (!session || session.invalidAttempts >= MAX_INVALID_TOKEN_ATTEMPTS) return null;
    if (session.status !== 'OPEN') return null;
    if (session.expiresAt.getTime() < Date.now()) {
      await this.prisma.valuationCaptureSession.update({
        where: { id: session.id },
        data: { status: 'EXPIRED' },
      });
      this.events.emitCapture(session.valuationId, { type: 'session_expired' });
      return null;
    }
    return session;
  }

  async getCaptureState(token: string) {
    const session = await this.resolveToken(token);
    if (!session) throw new NotFoundException('Invalid link');
    if (!session.firstUsedAt) {
      await this.prisma.valuationCaptureSession.update({
        where: { id: session.id },
        data: { firstUsedAt: new Date() },
      });
    }
    const valuation = await this.prisma.valuation.findUnique({
      where: { id: session.valuationId },
    });
    if (!valuation) throw new NotFoundException('Invalid link');
    const images = await this.prisma.valuationImage.findMany({
      where: { valuationId: valuation.id },
      orderBy: { createdAt: 'asc' },
    });
    return {
      status: 'OPEN',
      expiresAt: session.expiresAt,
      photoCount: images.length,
      slotsRemaining: MAX_PHOTOS - images.length,
      photoChecklist: this.checklistFor(valuation.categorySlug),
      images: images.map((img) => ({ id: img.id, url: img.url, viewTag: img.viewTag })),
    };
  }

  private async bumpInvalidAttempts(token: string) {
    const session = await this.prisma.valuationCaptureSession.findUnique({
      where: { token },
    });
    if (!session) return;
    await this.prisma.valuationCaptureSession.update({
      where: { id: session.id },
      data: { invalidAttempts: { increment: 1 } },
    });
  }

  async addCapturePhoto(token: string, file: Express.Multer.File) {
    const session = await this.resolveToken(token);
    if (!session) {
      await this.bumpInvalidAttempts(token);
      throw new NotFoundException('Invalid link');
    }
    const valuation = await this.prisma.valuation.findUnique({
      where: { id: session.valuationId },
    });
    if (!valuation) throw new NotFoundException('Invalid link');
    const result = await this.storePhoto(valuation, file, { source: 'PHONE' });
    this.events.emitCapture(valuation.id, {
      type: 'photo_added',
      image: {
        id: result.image.id,
        url: result.image.url,
        viewTag: result.image.viewTag,
        source: result.image.source,
      },
      photoCount: result.photoCount,
    });
    return result;
  }

  async removeCapturePhoto(token: string, photoId: string) {
    const session = await this.resolveToken(token);
    if (!session) throw new NotFoundException('Invalid link');
    const image = await this.prisma.valuationImage.findFirst({
      where: { id: photoId, valuationId: session.valuationId },
    });
    if (!image) throw new NotFoundException('Photo not found');
    await this.prisma.valuationImage.delete({ where: { id: image.id } });
    try {
      await this.cloudinary.deleteImage(image.publicId);
    } catch {
      /* logged elsewhere; row already gone */
    }
    const photoCount = await this.prisma.valuationImage.count({
      where: { valuationId: session.valuationId },
    });
    this.events.emitCapture(session.valuationId, {
      type: 'photo_deleted',
      photoId: image.id,
      photoCount,
    });
  }

  // ── Identify and questions ─────────────────────────────────────────

  async identify(
    id: string,
    userId: string,
    description?: string,
    itemName?: string,
  ) {
    const valuation = await this.assertOwner(id, userId);
    // The valuation is created on the first photo upload, so a description
    // typed afterwards was being lost. Persist it here before anything reads
    // it, so what the member wrote ("2013 BushLapa Boskriek ...") is used.
    const patch: { description?: string | null; itemName?: string | null } = {};
    if (description !== undefined) {
      const next = description.trim() || null;
      if (next !== (valuation.description ?? null)) {
        patch.description = next;
        valuation.description = next;
      }
    }
    if (itemName !== undefined) {
      const next = itemName.trim() || null;
      if (next !== (valuation.itemName ?? null)) {
        patch.itemName = next;
        valuation.itemName = next;
      }
    }
    if (Object.keys(patch).length > 0) {
      await this.prisma.valuation.update({ where: { id }, data: patch });
    }
    // The item name is what tells the model which object in the photos is for
    // sale, so no model call is spent without one.
    if (!valuation.itemName) {
      throw new BadRequestException({
        errorCode: 'ITEM_NAME_REQUIRED',
        message: 'Enter the name of the item before valuing it',
      });
    }
    const images = await this.prisma.valuationImage.findMany({
      where: { valuationId: id },
      orderBy: { createdAt: 'asc' },
    });
    if (images.length === 0) {
      throw new BadRequestException({ errorCode: 'NO_PHOTOS', message: 'Add at least one photo' });
    }

    // Banned-item check in code, before any model call.
    const banned = this.configs.bannedItemPatterns(valuation.categorySlug).map(
      (p) => new RegExp(p, 'i'),
    );
    const haystack = [valuation.description ?? '', ...images.map((i) => i.viewTag ?? '')].join(' ');
    if (banned.some((re) => re.test(haystack))) {
      await this.prisma.valuation.update({
        where: { id },
        data: { status: 'FAILED', errorCode: 'BANNED_ITEM' },
      });
      throw new BadRequestException({
        errorCode: 'BANNED_ITEM',
        message:
          'Live ammunition, primers and propellant cannot be listed or valued on All Outdoor',
      });
    }

    const checklist = this.configs.genericChecklist();
    const selected = this.imageSelect.select(
      images.map((i) => ({
        id: i.id,
        url: i.url,
        viewTag: i.viewTag,
        width: i.width,
        height: i.height,
        bytes: i.bytes,
        createdAt: i.createdAt,
      })),
      checklist,
    );

    const config = this.configs.forCategory(valuation.categorySlug);
    let identify;
    try {
      identify = await this.identifyService.identify({
        imageUrls: selected.map((i) => i.url),
        description: valuation.description,
        itemName: valuation.itemName,
        config,
      });
    } catch (err) {
      await this.prisma.valuation.update({
        where: { id },
        data: {
          status: 'FAILED',
          errorCode: (err as Error).message.startsWith('SCHEMA_VALIDATION_FAILED')
            ? 'SCHEMA_VALIDATION_FAILED'
            : 'MODEL_ERROR',
          errorMessage: (err as Error).message.slice(0, 500),
        },
      });
      throw new BadRequestException({ errorCode: 'MODEL_ERROR', message: (err as Error).message });
    }

    if (!identify.inScope) {
      await this.prisma.valuation.update({
        where: { id },
        data: {
          status: 'FAILED',
          errorCode: 'OUT_OF_SCOPE',
          errorMessage: identify.outOfScopeReason ?? 'Outside All Outdoor categories',
          identifyJson: identify as unknown as Prisma.InputJsonValue,
        },
      });
      throw new BadRequestException({
        errorCode: 'OUT_OF_SCOPE',
        message: identify.outOfScopeReason ?? 'This item is outside All Outdoor categories',
      });
    }

    const categorySlug = this.normaliseCategory(identify.identification.categorySlug);
    const activeConfig = this.configs.forCategory(categorySlug);
    const questions: ServedQuestion[] = this.questions.sanitise(identify, activeConfig, valuation.itemName);

    await this.prisma.valuation.update({
      where: { id },
      data: {
        status: 'IDENTIFIED',
        categorySlug,
        strategy: activeConfig.strategy,
        identifyJson: identify as unknown as Prisma.InputJsonValue,
        questionsJson: questions as unknown as Prisma.InputJsonValue,
        identifyPromptVersion: IDENTIFY_PROMPT_VERSION,
      },
    });

    return {
      identify,
      questions,
      photoChecklist: activeConfig.photoChecklist,
    };
  }

  async saveAnswers(id: string, userId: string, answers: SavedAnswer[]) {
    const valuation = await this.assertOwner(id, userId);
    const served = (valuation.questionsJson as unknown as ServedQuestion[]) ?? [];
    const validIds = new Set(served.map((q) => q.id));
    const filtered = answers.filter((a) => validIds.has(a.questionId)).map((a) => ({
      questionId: a.questionId,
      selected: Array.isArray(a.selected) ? a.selected.slice(0, 12) : [],
      custom: typeof a.custom === 'string' ? a.custom.slice(0, 300) : null,
      unsure: Boolean(a.unsure),
    }));

    const required = served.filter((q) => q.required).map((q) => q.id);
    const answered = new Set(filtered.map((a) => a.questionId));
    const readyForResearch = required.every((qid) => answered.has(qid));

    await this.prisma.valuation.update({
      where: { id },
      data: {
        answersJson: filtered as unknown as Prisma.InputJsonValue,
        status: valuation.status === 'IDENTIFIED' ? 'ANSWERING' : valuation.status,
      },
    });

    return { saved: filtered.length, total: served.length, readyForResearch };
  }

  // ── Research ───────────────────────────────────────────────────────

  async startResearch(id: string, userId: string) {
    const valuation = await this.assertOwner(id, userId);
    if (valuation.status === 'RESEARCHING') {
      throw new BadRequestException('Research is already running');
    }
    if (!valuation.questionsJson) {
      throw new BadRequestException('Identify the item first');
    }
    const served = valuation.questionsJson as unknown as ServedQuestion[];
    const answers = (valuation.answersJson as unknown as SavedAnswer[]) ?? [];
    const answered = new Set(answers.map((a) => a.questionId));
    const ready = served.filter((q) => q.required).every((q) => answered.has(q.id));
    if (!ready) {
      throw new BadRequestException('Answer the required questions first');
    }

    await this.prisma.valuation.update({
      where: { id },
      data: { status: 'RESEARCHING', errorCode: null, errorMessage: null },
    });

    // Fire and forget; progress streams over SSE.
    void this.runResearch(id).catch((err) =>
      this.logger.error(`research ${id} crashed: ${(err as Error).message}`),
    );

    return { status: 'RESEARCHING' };
  }

  private async runResearch(id: string): Promise<void> {
    const valuation = await this.prisma.valuation.findUnique({
      where: { id },
      include: { images: { orderBy: { createdAt: 'asc' } } },
    });
    if (!valuation) return;
    const categorySlug = valuation.categorySlug ?? 'camping-outdoor';
    const config = this.configs.forCategory(categorySlug);
    const answers = (valuation.answersJson as unknown as SavedAnswer[]) ?? [];
    const answersText = this.answersText(valuation.questionsJson as unknown as ServedQuestion[], answers);

    // The member's typed answers override every photo reading. Read ALL
    // questions (not just q1): the maker and model are often answered in their
    // own questions, and a typed maker is what lets the search pull true comps.
    const confirmed = await this.deriveConfirmedSpec(id);
    const confirmedMake = confirmed.make;
    const confirmedModel = confirmed.model;
    const confirmedKeySpec = confirmed.keySpec;
    const conditionBand = (await this.deriveConditionBand(id)) || 'GOOD';

    const checklist = config.photoChecklist;
    const selected = this.imageSelect.select(
      valuation.images.map((i) => ({
        id: i.id,
        url: i.url,
        viewTag: i.viewTag,
        width: i.width,
        height: i.height,
        bytes: i.bytes,
        createdAt: i.createdAt,
      })),
      checklist,
    );

    try {
      const result = await this.researchService.research({
        valuationId: id,
        imageUrls: selected.map((i) => i.url),
        categorySlug,
        make: confirmedMake,
        model: confirmedModel,
        keySpec: confirmedKeySpec,
        conditionBand,
        answersText,
        description: valuation.description,
        config,
      });
      await this.finalise(id, categorySlug, result, config.minComps);
      this.events.emitResearch(id, { type: 'done', valuationId: id });
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(`research ${id} failed: ${message}`);
      await this.prisma.valuation.update({
        where: { id },
        data: {
          status: 'FAILED',
          errorCode: message.startsWith('SCHEMA_VALIDATION_FAILED')
            ? 'SCHEMA_VALIDATION_FAILED'
            : 'MODEL_ERROR',
          errorMessage: message.slice(0, 500),
        },
      });
      this.events.emitResearch(id, {
        type: 'failed',
        errorCode: message.startsWith('SCHEMA_VALIDATION_FAILED')
          ? 'SCHEMA_VALIDATION_FAILED'
          : 'MODEL_ERROR',
        message,
      });
    }
  }

  private async finalise(
    id: string,
    categorySlug: string,
    result: ResultOutput,
    minComps: number,
  ): Promise<void> {
    const config = this.configs.forCategory(categorySlug);
    const confirmed = await this.deriveConfirmedSpec(id);
    const selfUrls = await this.selfListingUrls(id);
    // Own/dealer SOLD prices (highest-accuracy) are prepended as comps.
    const soldComps = await this.soldComps.find(categorySlug, confirmed.make, confirmed.model);
    // External retail/used comps (Woo/Shopify/GunAfrica) are add-only. In mode
    // 'live' they join the pricing pool; in mode 'shadow' the delta is logged
    // and the member's result is left untouched; 'off' does nothing.
    const externalMode = this.external.mode();
    const externalComps: RawComp[] =
      externalMode === 'off'
        ? []
        : await this.external
            .collect(
              categorySlug,
              { make: confirmed.make, model: confirmed.model, keySpec: confirmed.keySpec },
              result.itemSummary.conditionBand || 'GOOD',
            )
            .catch(() => [] as RawComp[]);
    const pooledComps =
      externalMode === 'live'
        ? [...soldComps, ...externalComps, ...result.comps]
        : [...soldComps, ...result.comps];
    // Comp window: the last 5 years. Older information is not excluded up to
    // five years back, but it lowers confidence (see recencyDowngrades).
    const minYear =
      Number(process.env.VALUATION_COMP_MIN_YEAR ?? 0) || new Date().getFullYear() - 4;
    const { kept, excluded } = this.comps.filterComps(pooledComps, {
      selfUrls,
      minYear,
      matchDimensions: config.matchDimensions,
    });

    const ageBand = await this.deriveAgeBand(id);
    const conditionBand =
      (await this.deriveConditionBand(id)) || result.itemSummary.conditionBand || 'GOOD';
    const anchorFromComps =
      kept.find((c) => c.kind === 'RETAIL_ANCHOR')?.priceCents ?? null;

    const pricing = this.comps.resolvePricing(kept, {
      matchDimensions: config.matchDimensions,
      weights: config.matchWeights,
      confidenceCap: config.matchConfidenceCap,
      minComps,
      anchorCents: anchorFromComps,
      depreciation: config.depreciation,
      brand: confirmed.make,
      conditionBand,
      ageBand,
    });

    if (externalMode === 'shadow' && externalComps.length > 0) {
      const prices = externalComps.map((c) => c.priceZar * 100).sort((a, b) => a - b);
      const extMedian = prices[Math.floor(prices.length / 2)];
      this.logger.log(
        `valuation ${id} shadow: liveMid=${pricing.mid ?? 'none'} externalMedian=${extMedian} externalComps=${externalComps.length}`,
      );
    }

    const unsureCount = await this.countUnsure(id);
    const recency = this.comps.recencyDowngrades(kept, new Date());
    const unverifiedUsed = this.comps.unverifiedUsed(kept);
    const downgrades =
      this.countDowngrades(result, unsureCount, pricing.mid, pricing.formulaCents, categorySlug) +
      recency.downgrades +
      (unverifiedUsed > 0 && pricing.basis !== 'NONE' ? 1 : 0);

    // Confidence: a depreciated anchor maxes at MEDIUM (handled below); a
    // comp-led result starts from the count and is then capped by the looser
    // tiers actually used.
    let level =
      pricing.basis === 'DEPRECIATED_ANCHOR'
        ? this.comps.confidence(6, minComps, downgrades)
        : this.comps.confidence(pricing.compCount, minComps, downgrades);
    level = this.comps.capConfidence(level, pricing.tiersUsed, config.matchConfidenceCap);

    // ⚠️ PRODUCE A PRICE WHENEVER THERE IS ANY USABLE DATA. Previously the
    // engine returned nothing below the comp minimum, so one or two real
    // listings gave no price at all. Now a sparse result is priced at LOW with
    // a caveat instead of a refusal.
    const belowMin = pricing.compCount > 0 && pricing.compCount < minComps;
    const priced = pricing.mid != null;
    if (!priced || belowMin) level = 'LOW';

    // Caveats surfaced when the basis is not a pool of exact-model comps.
    const extraUnverified: string[] = [];
    if (pricing.basis === 'DEPRECIATED_ANCHOR') {
      extraUnverified.push(
        'No used comparables were found. This estimate is the current South African new price less depreciation for its age and condition.',
      );
    }
    if (pricing.basis === 'BLEND') {
      extraUnverified.push(
        'Estimate blends the few comparables found with the depreciated new-price anchor.',
      );
    }
    for (const c of kept.filter((k) => k.kind === 'USED_COMP' && k.diffs.length > 0).slice(0, 4)) {
      const d = c.diffs[0];
      extraUnverified.push(
        `A comparable differed on ${d.dimension}${d.compValue ? ` (${d.compValue})` : ''}${
          d.itemValue ? `, yours is ${d.itemValue}` : ''
        }.`,
      );
    }
    if (recency.medianAgeYears > 1 && pricing.basis !== 'NONE') {
      extraUnverified.push(
        `Comparable listings were on average about ${recency.medianAgeYears.toFixed(1)} years old (oldest about ${Math.round(recency.oldestYears)} years). The more recent they are, the firmer the figure.`,
      );
    }
    if (unverifiedUsed > 0 && pricing.basis !== 'NONE') {
      extraUnverified.push(
        `${unverifiedUsed} of the comparables could not be opened to verify the price (the seller site blocked our request); those price points are indicative only.`,
      );
    }
    if (belowMin && priced) {
      extraUnverified.push(
        `Based on only ${pricing.compCount} comparable listing(s); treat this as a rough guide rather than a firm price.`,
      );
    }

    // Included accessories are added on top of the base-item comps: the seller
    // is selling a package. Without this the mag/holster/scope value was lost.
    const accessorySum = (result.itemSummary.accessories ?? []).reduce(
      (s, a) => s + (a.valueCents ?? 0),
      0,
    );
    if (accessorySum > 0 && priced) {
      extraUnverified.push(
        `Includes about R${Math.round(accessorySum / 100).toLocaleString('en-ZA')} of accessories, valued separately and added to the base-item estimate.`,
      );
    }
    const pkgMid = addUplift(pricing.mid, accessorySum);

    const finalPricing = priced
      ? {
          lowZar: centsToZar(addUplift(pricing.low, accessorySum)),
          midZar: centsToZar(pkgMid),
          highZar: centsToZar(addUplift(pricing.high, accessorySum)),
          askingZar: pkgMid != null ? centsToZar(roundTo100c(pkgMid * 1.05)) : null,
          expectedSaleZar: pkgMid != null ? centsToZar(roundTo100c(pkgMid * 0.97)) : null,
          retailAnchorZar: centsToZar(pricing.retailAnchor),
          missingData: null,
        }
      : {
          lowZar: null,
          midZar: null,
          highZar: null,
          askingZar: null,
          expectedSaleZar: null,
          retailAnchorZar: centsToZar(pricing.retailAnchor),
          missingData:
            result.pricing.missingData ??
            `Not enough South African comparables were found for a firm price.`,
        };

    // The backend owns the pricing maths; overwrite the model's proposal.
    const finalResult: ResultOutput = {
      ...result,
      pricing: finalPricing,
      confidence: { level, reason: result.confidence.reason },
      unverified: dedupe([...(result.unverified ?? []), ...extraUnverified]).slice(0, 10),
      ad: this.sanitiseAd(result.ad),
    };

    // The member must never see WHERE any comparable came from, new or
    // secondhand: this is an estimate to list HERE, not a pointer to a shop.
    // stripSources() below removes every URL and known site name from the
    // client-facing text, and no source object is sent to the client at all.
    //
    // Three listing tiers by urgency. Only when we actually have a price.
    const priceScale =
      priced && pkgMid != null
        ? [
            {
              key: 'fast',
              label: 'Sell fast',
              priceZar: centsToZar(roundTo100c(pkgMid * 0.97)),
              note: 'Priced to move quickly',
            },
            {
              key: 'balanced',
              label: 'Recommended',
              priceZar: centsToZar(roundTo100c(pkgMid * 1.05)),
              note: 'Balanced price for a normal sale',
            },
            {
              key: 'patient',
              label: 'Hold out',
              priceZar: centsToZar(addUplift(pricing.high, accessorySum)),
              note: 'If you can wait for the right buyer',
            },
          ]
        : [];

    const clientResult = {
      itemSummary: {
        ...finalResult.itemSummary,
        oneLiner: stripSources(finalResult.itemSummary.oneLiner),
        specSheet: finalResult.itemSummary.specSheet.map((row) => ({
          label: stripSources(row.label),
          value: stripSources(row.value),
        })),
        attributes: Object.fromEntries(
          Object.entries(finalResult.itemSummary.attributes ?? {}).map(([k, v]) => [
            k,
            stripSources(String(v)),
          ]),
        ),
        accessories: sanitiseAccessories(finalResult.itemSummary.accessories),
      },
      pricing: {
        ...finalResult.pricing,
        missingData: finalResult.pricing.missingData
          ? stripSources(finalResult.pricing.missingData)
          : null,
      },
      confidence: { level, reason: stripSources(result.confidence.reason) },
      demandNote: stripSources(finalResult.demandNote),
      ad: {
        ...finalResult.ad,
        title: stripSources(finalResult.ad.title),
        bullets: finalResult.ad.bullets.map(stripSources),
        description: finalResult.ad.description ? stripSources(finalResult.ad.description) : null,
      },
      unverified: finalResult.unverified.map(stripSources),
      priceScale,
      // comps and every source (retail or secondhand) stay internal.
    };

    const meta = {
      fromCache: false,
      compsKept: kept.length,
      compsExcluded: excluded.length,
      excludedReasons: excluded.reduce<Record<string, number>>((acc, e) => {
        acc[e.reason] = (acc[e.reason] ?? 0) + 1;
        return acc;
      }, {}),
      basis: pricing.basis,
      tiersUsed: pricing.tiersUsed,
      anchorCents: pricing.retailAnchor,
      formulaCents: pricing.formulaCents,
      medianCompAgeYears: recency.medianAgeYears,
      oldestCompYears: recency.oldestYears,
      unverifiedComps: unverifiedUsed,
      confidenceDowngrades: downgrades,
      identifyPromptVersion: IDENTIFY_PROMPT_VERSION,
      researchPromptVersion: RESEARCH_PROMPT_VERSION,
      externalMode,
      externalComps: externalComps.length,
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.valuationComp.deleteMany({ where: { valuationId: id } });
      if (kept.length || excluded.length) {
        await tx.valuationComp.createMany({
          data: [
            ...kept
              // Facebook/Gumtree comps are research-only and never persisted.
              .filter((c) => !isEphemeralUrl(c.url))
              .map((c) => ({
                valuationId: id,
                kind: c.kind,
                sourceSite: c.sourceSite,
                url: c.url,
                model: c.model,
                condition: c.condition,
                priceCents: c.priceCents,
                listedDate: c.listedDate,
                pageOpened: c.pageOpened,
                excluded: false,
                matchTier: c.matchTier,
                specDiffs: c.diffs as unknown as Prisma.InputJsonValue,
              })),
            ...excluded.map((e) => ({
              valuationId: id,
              kind: 'USED_COMP',
              sourceSite: 'unknown',
              url: e.url || 'unknown',
              priceCents: 0,
              pageOpened: false,
              excluded: true,
              excludeReason: e.reason,
            })),
          ],
        });
      }
      await tx.valuation.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          resultJson: { ...clientResult, meta } as unknown as Prisma.InputJsonValue,
          confidence: level,
          lowPriceCents: priced ? pricing.low : null,
          midPriceCents: priced ? pricing.mid : null,
          highPriceCents: priced ? pricing.high : null,
          askingPriceCents: priced ? pricing.asking : null,
          expectedSalePriceCents: priced ? pricing.expectedSale : null,
          retailAnchorCents: pricing.retailAnchor,
          completedAt: new Date(),
        },
      });
    });

    if (priced) {
      const cacheKey = this.cache.key({
        categorySlug,
        make: confirmed.make,
        model: confirmed.model,
        keySpec: confirmed.keySpec,
        conditionBand: finalResult.itemSummary.conditionBand,
      });
      if (cacheKey) {
        try {
          await this.cache.write(
            cacheKey,
            {
              categorySlug,
              make: confirmed.make,
              model: confirmed.model,
              keySpec: confirmed.keySpec,
              conditionBand: finalResult.itemSummary.conditionBand,
            },
            { ...clientResult, meta },
            pricing.mid,
            pricing.compCount,
            level,
          );
          await this.prisma.valuation.update({ where: { id }, data: { cacheKey } });
        } catch (err) {
          this.logger.warn(`cache write failed: ${(err as Error).message}`);
        }
      }
    }
  }

  // ── Listing handoff and outcome ────────────────────────────────────

  async listingDraft(id: string, userId: string) {
    const valuation = await this.assertOwner(id, userId);
    const result = valuation.resultJson as unknown as ResultOutput | null;
    if (!result) throw new BadRequestException('No result yet');
    const categorySlug = valuation.categorySlug ?? result.itemSummary.categorySlug;
    const category = await this.prisma.category.findFirst({ where: { slug: categorySlug } });
    const config = this.configs.forCategory(categorySlug);
    const ad = result.ad;
    return {
      categoryId: category?.id ?? null,
      categorySlug,
      title: ad.title,
      description: ad.description ?? ad.bullets.join('\n'),
      price: ad.priceZar > 0 ? ad.priceZar : null,
      listingType: 'BUY_NOW',
      attributes: result.itemSummary.attributes ?? {},
      shippingMethods: config.listingConstraints.shippingMethods,
    };
  }

  async recordOutcome(
    id: string,
    userId: string,
    listingId: string,
    soldPriceCents?: number,
    soldAt?: string,
  ) {
    const valuation = await this.assertOwner(id, userId);
    const listing = await this.prisma.listing.findFirst({
      where: { id: listingId, sellerId: userId },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    const daysToList = Math.max(
      0,
      Math.round((Date.now() - valuation.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
    );
    const sold = typeof soldPriceCents === 'number' && soldPriceCents > 0 ? soldPriceCents : null;
    const soldDate = soldAt ? new Date(soldAt) : new Date();
    await this.prisma.valuationOutcome.upsert({
      where: { valuationId: id },
      create: {
        valuationId: id,
        listingId,
        askingPriceCents: listing.price ? Math.round(Number(listing.price) * 100) : null,
        soldPriceCents: sold,
        soldAt: sold ? soldDate : null,
        daysToList,
      },
      update: { listingId, daysToList, ...(sold ? { soldPriceCents: sold, soldAt: soldDate } : {}) },
    });
    // The moat: a real sold price becomes a high-weight comp for future
    // valuations of the same item.
    if (sold) {
      const confirmed = await this.deriveConfirmedSpec(id);
      const categorySlug = valuation.categorySlug ?? 'camping-outdoor';
      await this.soldComps.record({
        categorySlug,
        make: confirmed.make,
        model: confirmed.model,
        keySpec: confirmed.keySpec,
        soldPriceCents: sold,
        soldAt: soldDate,
        source: 'own',
      });
    }
    return { ok: true };
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private checklistFor(categorySlug: string | null): PhotoChecklistItem[] {
    if (!categorySlug) return this.configs.genericChecklist();
    return this.configs.forCategory(categorySlug).photoChecklist;
  }

  private normaliseCategory(slug: string | null): string {
    if (slug && this.configs.hasOverride(slug)) return slug;
    if (slug) return slug;
    return 'camping-outdoor';
  }

  private async assertOwner(id: string, userId: string): Promise<Valuation> {
    const valuation = await this.prisma.valuation.findUnique({ where: { id } });
    if (!valuation || valuation.userId !== userId) {
      throw new NotFoundException('Valuation not found');
    }
    return valuation;
  }

  private async selfListingUrls(valuationId: string): Promise<Set<string>> {
    const valuation = await this.prisma.valuation.findUnique({ where: { id: valuationId } });
    if (!valuation) return new Set();
    const listings = await this.prisma.listing.findMany({
      where: { sellerId: valuation.userId },
      select: { id: true },
    });
    return new Set(listings.map((l) => `/listings/${l.id}`));
  }

  private answersText(questions: ServedQuestion[], answers: SavedAnswer[]): string {
    const byId = new Map(answers.map((a) => [a.questionId, a]));
    return questions
      .map((q) => {
        const a = byId.get(q.id);
        if (!a) return `- ${q.text}: (unanswered)`;
        if (a.unsure) return `- ${q.text}: Not sure`;
        const parts = [...a.selected, a.custom].filter(Boolean);
        return `- ${q.text}: ${parts.join(', ') || '(no answer)'}`;
      })
      .join('\n');
  }

  private async countUnsure(id: string): Promise<number> {
    const valuation = await this.prisma.valuation.findUnique({ where: { id } });
    const answers = (valuation?.answersJson as unknown as SavedAnswer[]) ?? [];
    return answers.filter((a) => a.unsure).length;
  }

  private countDowngrades(
    result: ResultOutput,
    unsureCount: number,
    medianCents: number | null,
    formulaCents: number | null,
    categorySlug: string,
  ): number {
    let downgrades = 0;
    if (unsureCount > 0) downgrades += 1;
    if (unsureCount > 3) downgrades += 1;
    if (result.confidence.level === 'LOW') downgrades += 1;
    if (this.comps.anchorDisagreement(medianCents, formulaCents)) downgrades += 1;
    if (!this.configs.hasOverride(categorySlug)) downgrades += 1;
    return downgrades;
  }

  /** Best-effort condition band from the member's answers, for depreciation. */
  private async deriveConditionBand(id: string): Promise<string> {
    const valuation = await this.prisma.valuation.findUnique({ where: { id } });
    const questions = (valuation?.questionsJson as unknown as ServedQuestion[]) ?? [];
    const answers = (valuation?.answersJson as unknown as SavedAnswer[]) ?? [];
    const byId = new Map(answers.map((a) => [a.questionId, a]));
    for (const q of questions) {
      if (!/condition|wear|working|overall/i.test(q.text)) continue;
      const a = byId.get(q.id);
      if (!a || a.unsure) continue;
      const text = [...(a.selected ?? []), a.custom ?? ''].filter(Boolean).join(' ').toLowerCase();
      if (!text) continue;
      if (/new|unfired|sealed/.test(text)) return 'NEW';
      if (/excellent|as.?new|like.?new/.test(text)) return 'EXCELLENT';
      if (/fair|heavy wear/.test(text)) return 'FAIR';
      if (/poor|needs work|broken|repair/.test(text)) return 'POOR';
      if (/good|moderate/.test(text)) return 'GOOD';
    }
    return '';
  }

  /** Best-effort age band from the member's answers, for depreciation. */
  private async deriveAgeBand(id: string): Promise<string> {
    const valuation = await this.prisma.valuation.findUnique({ where: { id } });
    const questions = (valuation?.questionsJson as unknown as ServedQuestion[]) ?? [];
    const answers = (valuation?.answersJson as unknown as SavedAnswer[]) ?? [];
    const byId = new Map(answers.map((a) => [a.questionId, a]));
    for (const q of questions) {
      if (!/age|old|year/i.test(q.text)) continue;
      const a = byId.get(q.id);
      if (!a || a.unsure) continue;
      const text = [...(a.selected ?? []), a.custom ?? ''].filter(Boolean).join(' ').toLowerCase();
      if (!text) continue;
      if (/new|under 1|less than 1|<\s*1/.test(text)) return 'LT1';
      if (/1\s*[-–]?\s*3/.test(text)) return '1_3';
      if (/3\s*[-–]?\s*7/.test(text)) return '3_7';
      if (/over 7|7\+|7\s*years|vintage|antique/.test(text)) return '7_PLUS';
    }
    return '';
  }

  /**
   * The confirmed spec, category-neutral. Reads every question and answer and
   * maps the answer whose question asks for the maker/brand, the model, or the
   * specification. A member answer always overrides the photo reading. This is
   * what makes a typed "SAKO" actually drive the comparables search.
   */
  private async deriveConfirmedSpec(
    id: string,
  ): Promise<{ make: string | null; model: string | null; keySpec: string | null }> {
    const valuation = await this.prisma.valuation.findUnique({ where: { id } });
    const questions = (valuation?.questionsJson as unknown as ServedQuestion[]) ?? [];
    const answers = (valuation?.answersJson as unknown as SavedAnswer[]) ?? [];
    const identify = valuation?.identifyJson as unknown as
      | { identification?: { make?: string | null; model?: string | null; keySpec?: string | null } }
      | null;
    const byId = new Map(answers.map((a) => [a.questionId, a]));

    const pick = (re: RegExp, skipQ1 = false): string | null => {
      for (const q of questions) {
        if (skipQ1 && q.id === 'q1') continue;
        if (!re.test(q.text)) continue;
        const a = byId.get(q.id);
        if (!a || a.unsure) continue;
        const val = [a.custom, ...(a.selected ?? [])]
          .map((s) => (typeof s === 'string' ? s.trim() : ''))
          .find((s) => s && !/^(other|none|not sure|unsure|unknown|n\/a)$/i.test(s));
        if (val) return val;
      }
      return null;
    };

    const q1 = byId.get('q1');
    const q1Text = q1 && !q1.unsure && q1.custom?.trim() ? q1.custom.trim() : null;

    // The member's own typed name is authoritative: if nothing answered the
    // maker/brand question and the photos read no make, take the leading
    // word of their name (or their q1 answer) as the make. Without this a
    // member who types "sako .270" gets make=null because the maker stamp was
    // unreadable, and every comp runs brand-less.
    const nameMake = (s: string | null): string | null => {
      const first = (s ?? '').trim().split(/\s+/)[0] ?? '';
      return first.length > 1 && /[a-z]/i.test(first) && !/\d/.test(first) && !/^[.&]+$/.test(first)
        ? first
        : null;
    };

    return {
      make:
        pick(/maker|brand|manufactur/i) ??
        identify?.identification?.make ??
        nameMake(q1Text) ??
        nameMake(valuation?.itemName ?? null) ??
        null,
      model:
        pick(/^\s*what is the model|exact model|\bmodel\b/i) ??
        q1Text ??
        identify?.identification?.model ??
        null,
      keySpec:
        pick(/caliber|calibre|gauge|magnification|capacity|\bsize\b|blade|weight|specification/i) ??
        identify?.identification?.keySpec ??
        null,
    };
  }

  /** Redact serial-like and unique-identifier strings from the ad. */
  private sanitiseAd(ad: ResultOutput['ad']): ResultOutput['ad'] {
    return {
      ...ad,
      title: redact(ad.title),
      bullets: ad.bullets.map(redact),
      description: ad.description ? redact(ad.description) : ad.description ?? null,
    };
  }
}

function centsToZar(cents: number | null): number | null {
  return cents == null ? null : Math.round(cents / 100);
}

function addUplift(cents: number | null, uplift: number): number | null {
  return cents == null ? null : cents + uplift;
}

// Round a cent amount to the nearest R100 (10000 cents). ⚠️ The multiplier
// MUST be 10000, not 100: `* 100` returned R769 instead of R76 900 and the
// asking/expected/Sell-fast/Recommended figures came out ~100x too small.
export function roundTo100c(cents: number): number {
  return Math.round(cents / 10000) * 10000;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

// Secondhand marketplace names that must never reach the member's screen.
const SECONDHAND_SITES =
  /(bidorbuy|bid\s*or\s*buy|gumtree|gunafrica|gunsammo|carbonads|classic\s*arms|facebook\s*marketplace|marketplace\s*item|classifieds?)/gi;

/**
 * Sanitise the accessories list for the client. The model sometimes emits an
 * extra free-text key (e.g. "basis") beside `note`; spreading it would let a
 * source name bypass stripSources(), so we keep ONLY name/valueCents/note and
 * fold any extra text into the (sanitised) note.
 */
export function sanitiseAccessories(
  list: ResultOutput['itemSummary']['accessories'] | undefined,
): Array<{ name: string; valueCents: number | null; note: string | null }> {
  return (list ?? []).map((a) => {
    const rec = a as unknown as Record<string, unknown>;
    const extra = [a.note, rec.basis, rec.detail, rec.source, rec.note2].find(
      (v) => typeof v === 'string' && v.trim().length > 0,
    ) as string | undefined;
    return {
      name: stripSources(a.name),
      valueCents: a.valueCents ?? null,
      note: extra ? stripSources(extra) : null,
    };
  });
}

/**
 * Remove every secondhand source from client-facing text: URLs and known
 * secondhand site names. The operator's rule: a seller must not learn where we
 * found the comparables, or they will go list there instead.
 */
function stripSources(text: string): string {
  return text
    .replace(/https?:\/\/[^\s)]+/gi, '')
    // Bare domains (theglockshop.co.za) and emails, which are not full URLs.
    .replace(/\b(?:[a-z0-9-]+\.)+(?:co\.za|com|net|org|africa|online|shop|store|za)\b/gi, 'a listing site')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '')
    .replace(SECONDHAND_SITES, 'a listing site')
    // Collapse repeats the model produces when several site names were named
    // ("a listing site, a listing site, or ...").
    .replace(/(a listing site)(\s*,\s*a listing site)+/gi, 'a listing site')
    .replace(/\b(on|via|from)\s+a listing site\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}

const SERIAL_LIKE = /\b(?=[A-Z0-9-]{5,12}\b)(?=[A-Z0-9-]*\d)[A-Z0-9-]{5,12}\b/g;

function redact(value: string): string {
  return value
    .replace(/serial\s*(no\.?|number)?[:#]?\s*[A-Za-z0-9-]{4,}/gi, '[redacted]')
    .replace(SERIAL_LIKE, (m) => (/^[A-Z]{2,}\d{3,}|^\d{4,}[A-Z0-9]*$/i.test(m) ? '[redacted]' : m));
}
