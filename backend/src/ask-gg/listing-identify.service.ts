import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService, FLAGS } from '../settings/settings.service';
import { LlmService } from '../common/llm/llm.service';
import { LlmError, type LlmPart } from '../common/llm/llm.types';
import { boundedImageBytes } from '../common/image-bytes';
import { IMAGE_EDGE } from '../common/image-url';
import { SubscriptionTier } from '@prisma/client';

/**
 * "Help me describe this" — one-shot photo identification for
 * /listings/new. Photos in, a structured proposal out; the seller taps
 * "Apply to form" and the listing pre-fills. No conversation, no
 * history, no tools, ONE model call.
 *
 * ⚠️ THIS IS ALL THAT SURVIVES OF ASK GG (retired 2026-09-07). The chat
 * assistant was removed from the site on 2026-08-26 but its backend kept
 * serving: a nine-turn tool loop, 24k characters of replayed history, a
 * grounded-sources pass and a streaming route — every one of them a paid
 * model call reachable by API for a feature nobody could open. Only this
 * route was ever called by the live site, so only this route remains. The
 * `/ask-gg` prefix is kept because the Sell page posts to it; the
 * conversation/message tables are kept because dropping them is a
 * migration, not a cleanup.
 */

// Per-request photo cap (how many photos in ONE identification).
// Operator call 2026-05-26: PRO 10, everyone else 5 — the realistic use
// case is multi-angle shots of ONE item, not bulk intake.
export function maxPhotosPerRequest(tier: SubscriptionTier): number {
  return tier === SubscriptionTier.PRO ? 10 : 5;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** The shape the listing form pre-fills from. */
export interface IdentifyProposal {
  title: string;
  description: string;
  manufacturer: string | null;
  model: string | null;
  calibre: string | null;
  condition: 'NEW' | 'LIKE_NEW' | 'GOOD' | 'FAIR' | 'POOR' | null;
  suggestedCategorySlug: string | null;
  notes: string | null;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Build the hierarchical category list the model picks a slug from.
 * Top-level flush-left, children indented two spaces, so the model can
 * prefer the most SPECIFIC slug ("rifles-bolt-action" over "rifles").
 */
export function buildCategoryTree(
  categories: Array<{
    id: string;
    name: string;
    slug: string;
    parentId: string | null;
  }>,
): string {
  const lines: string[] = [];
  for (const top of categories.filter((c) => c.parentId === null)) {
    lines.push(`${top.slug} — ${top.name}`);
    const kids = categories
      .filter((c) => c.parentId === top.id)
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const k of kids) lines.push(`  ${k.slug} — ${k.name}`);
  }
  return lines.join('\n');
}

/**
 * The identify prompt. JSON-only, no preamble.
 *
 * ⚠️ The PROMPT does the enforcing, not LlmRequest.json. Kept that way
 * deliberately through the provider switch: the regex extraction +
 * field-by-field coercion in parseIdentifyProposal already tolerates a
 * fence or a preamble, and it is the behaviour this feature was tested
 * against.
 */
export function buildIdentifySystemPrompt(
  opts: { categoryHint?: string; categoryTree?: string } = {},
): string {
  const categoryGuidance = opts.categoryTree
    ? `\n\nAVAILABLE CATEGORIES (top-level → sub-categories — indentation shows hierarchy):\n${opts.categoryTree}\n\nPick the most SPECIFIC slug that fits the item. Prefer a sub-category slug over its parent when the photos give you enough confidence. If unsure between sub-categories, return the parent slug. Return null only if no category fits at all.`
    : '\n\nReturn one of these top-level slugs in suggestedCategorySlug, or null: "firearms", "ammunition", "optics", "reloading", "knives", "shooting-accessories", "camping-outdoor", "overlanding", "fishing", "hunting", "hiking", "outdoor-clothing", "archery".';

  return `You are an SA outdoor-gear identification assistant for All Outdoor (South Africa's outdoor & firearms marketplace). Look at the photos and return a STRICT JSON object describing the item, to pre-fill a marketplace listing form. The item could be ANYTHING All Outdoor sells — a firearm, optic, ammunition/reloading gear, a camping fridge or tent, a rooftop tent, dual-battery/solar kit, recovery/4x4 gear, a fishing rod/reel/kayak, a hiking pack or boots, outdoor clothing, a knife/multitool, a bow, etc.

Output ONLY the JSON object, no markdown fence, no preamble, no explanation.

Schema:
{
  "title": string,                        // Concise listing title: brand + model + the ONE key spec. Firearm: "Beretta 92FS — 9mm Parabellum". Gear: "Engel MT45 — 40L Fridge/Freezer", "Shimano Stradic 4000 Spinning Reel", "Howling Moon 1.4m Rooftop Tent".
  "description": string,                  // 2-4 sentences: what it is, brand/model, key specs, finish, visible condition, any accessories/included items.
  "manufacturer": string | null,          // Brand, e.g. "Engel", "Shimano", "Beretta". null if you can't tell.
  "model": string | null,                 // Model / variant, e.g. "MT45", "Stradic 4000", "92FS". null if you can't tell.
  "calibre": string | null,               // FIREARMS / AMMUNITION ONLY — e.g. "9mm Parabellum". ALWAYS null for anything else.
  "condition": "NEW" | "LIKE_NEW" | "GOOD" | "FAIR" | "POOR" | null,
  "suggestedCategorySlug": string | null, // see CATEGORY guidance below
  "notes": string | null,                 // Anything the listing should mention: defects, missing parts, included extras.
  "confidence": "high" | "medium" | "low" // How sure you are about the brand/model ID.
}

Rules:
- If the photos show NO sellable outdoor / gear item at all (a person, a pet, a random room, food, a screenshot), return: {"title":"","description":"","manufacturer":null,"model":null,"calibre":null,"condition":null,"suggestedCategorySlug":null,"notes":"Photos don't appear to show an item for sale.","confidence":"low"}
- Never guess a brand / model / calibre you can't actually see. Better to leave a field null than misidentify — wrong details kill buyer trust.
- calibre is ONLY for firearms and ammunition — return null for fishing, camping, optics, apparel, knives and every other category.
- For condition: rely on visible wear, finish, scratches, packaging. If you can't tell, return null.${categoryGuidance}${
    opts.categoryHint
      ? `\n\nOperator hint: user has pre-selected category "${opts.categoryHint}". Bias toward that category (or one of its sub-categories) but override if photos clearly show something else.`
      : ''
  }`;
}

/**
 * Pull the proposal out of the model's answer. Defends against a
 * ``` fence or a preamble, and coerces every field — a model that
 * returns garbage costs the seller a retry, never a broken form.
 */
export function parseIdentifyProposal(rawText: string): IdentifyProposal | null {
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  return {
    title: String(parsed.title ?? '').slice(0, 200),
    description: String(parsed.description ?? '').slice(0, 2000),
    manufacturer: parsed.manufacturer
      ? String(parsed.manufacturer).slice(0, 100)
      : null,
    model: parsed.model ? String(parsed.model).slice(0, 100) : null,
    calibre: parsed.calibre ? String(parsed.calibre).slice(0, 50) : null,
    condition: (['NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR'].includes(
      String(parsed.condition),
    )
      ? parsed.condition
      : null) as IdentifyProposal['condition'],
    suggestedCategorySlug: parsed.suggestedCategorySlug
      ? String(parsed.suggestedCategorySlug).slice(0, 60)
      : null,
    notes: parsed.notes ? String(parsed.notes).slice(0, 500) : null,
    confidence: (['high', 'medium', 'low'].includes(String(parsed.confidence))
      ? parsed.confidence
      : 'low') as IdentifyProposal['confidence'],
  };
}

// ─── Cost estimator ─────────────────────────────────────────────────
// Approximations from the provider's published per-MTok rates, feeding
// the per-user spend rollup (AskGgUsage.costUsdCents).
//
// ⚠️ KEYED ON THE MODEL ID THE CALL ACTUALLY USED, which is whatever
// LlmService.model resolves (LLM_MODEL) — so pointing that env var at a
// model missing from this map silently prices every identification at
// null. The one-shot warning below is what catches that; do not remove it.
const PRICES_PER_MTOK_USD: Record<string, { input: number; output: number }> = {
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-pro': { input: 1.25, output: 10 },
};

const unpricedModelsWarned = new Set<string>();

export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number | null {
  if (promptTokens === 0 && completionTokens === 0) return null;
  const prices = PRICES_PER_MTOK_USD[model];
  if (!prices) {
    if (!unpricedModelsWarned.has(model)) {
      unpricedModelsWarned.add(model);
      new Logger('ListingIdentifyCost').warn(
        `No price entry for model "${model}" — costUsd will be null; add it to PRICES_PER_MTOK_USD`,
      );
    }
    return null;
  }
  const inputCost = (promptTokens / 1_000_000) * prices.input;
  const outputCost = (completionTokens / 1_000_000) * prices.output;
  return Number((inputCost + outputCost).toFixed(6));
}

@Injectable()
export class ListingIdentifyService {
  private readonly logger = new Logger(ListingIdentifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly llm: LlmService,
  ) {}

  /**
   * Identify the item in 1-N photos and return a listing-form proposal.
   * Nothing is persisted but the spend rollup.
   */
  async identifyForListing(
    clerkId: string,
    photos: Array<{
      base64: string;
      mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
    }>,
    opts: { categoryHint?: string } = {},
  ): Promise<{ proposal: IdentifyProposal | null; costUsd: number | null }> {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true, subscriptionTier: true },
    });
    if (!user) throw new NotFoundException('User not found');

    if (photos.length === 0) {
      throw new BadRequestException('At least one photo required.');
    }
    const photoCap = maxPhotosPerRequest(user.subscriptionTier);
    if (photos.length > photoCap) {
      throw new BadRequestException(
        `Up to ${photoCap} photos per identification on your tier.`,
      );
    }
    await this.assertWithinQuota(user.id, user.subscriptionTier);

    const categories = await this.prisma.category.findMany({
      orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, slug: true, parentId: true },
    });

    const result = await this.runModel(photos, {
      categoryHint: opts.categoryHint,
      categoryTree: buildCategoryTree(categories),
    });

    // Bump the daily usage rollup. One identification = 1 message +
    // 1 photo-ID; the photo-ID column is also the quota meter above.
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    await this.prisma.askGgUsage.upsert({
      where: { userId_day: { userId: user.id, day: todayUtc } },
      create: {
        userId: user.id,
        day: todayUtc,
        messageCount: 1,
        photoIdCount: 1,
        costUsdCents: Math.round((result.costUsd ?? 0) * 100),
      },
      update: {
        messageCount: { increment: 1 },
        photoIdCount: { increment: 1 },
        costUsdCents: { increment: Math.round((result.costUsd ?? 0) * 100) },
      },
    });

    return { proposal: result.proposal, costUsd: result.costUsd };
  }

  /**
   * FREE-tier fair use: N identifications per rolling 30 days.
   * MEMBER + PRO are uncapped per user; the controller's 10/min throttle
   * is what bounds them.
   *
   * ⚠️ THE METER COUNTS `AskGgUsage.photoIdCount`, NOT `AskGgMessage`.
   * It used to count photo-bearing chat messages — and with the chat
   * retired NOTHING writes an AskGgMessage row ever again, so that meter
   * would read zero forever and this paid model call would be free for
   * everyone. AskGgUsage is the row this very method writes, so the gate
   * now counts the thing it is gating. The 403 body is unchanged: the
   * Sell page branches on `code: 'free-photo-quota-exhausted'`.
   *
   * ⚠️ AskGgUsage.day is a UTC-midnight bucket, so the window is
   * whole-day granular — it can allow at most one extra day's worth of
   * identifications versus a to-the-second window. That is the cost of
   * metering off a daily rollup and it is deliberate; the alternative is
   * a table nothing else needs.
   */
  private async assertWithinQuota(
    userId: string,
    tier: SubscriptionTier,
  ): Promise<void> {
    if (tier !== SubscriptionTier.FREE) return;
    const cap = await this.settings.get(FLAGS.askGgFreePhotoCapPer30d);
    const since = new Date(Date.now() - THIRTY_DAYS_MS);
    since.setUTCHours(0, 0, 0, 0);
    const agg = await this.prisma.askGgUsage.aggregate({
      _sum: { photoIdCount: true },
      where: { userId, day: { gte: since } },
    });
    const used = agg._sum.photoIdCount ?? 0;
    if (used < cap) return;
    throw new ForbiddenException({
      message: `You've used your ${cap} free photo identifications this month. Upgrade to Member or Pro for unlimited.`,
      code: 'free-photo-quota-exhausted',
      cap,
      used,
      minTier: 'PRO',
    });
  }

  /**
   * The single model call. Photos arrive as BYTES from the multipart
   * upload — raw camera output, because the Sell page does not shrink
   * them — so they are bounded HERE with boundedImageBytes (1280 on the
   * long edge, JPEG), the bytes-side twin of boundedImageUrl. Worst case
   * the model returns garbage and the seller keeps typing.
   */
  private async runModel(
    photos: Array<{
      base64: string;
      mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
    }>,
    opts: { categoryHint?: string; categoryTree?: string },
  ): Promise<{ proposal: IdentifyProposal | null; costUsd: number | null }> {
    const model = this.llm.model;
    if (!this.llm.isConfigured()) return { proposal: null, costUsd: null };

    // ⚠️ BOUNDED BEFORE THEY ARE COUNTED. A product photograph reads the
    // same to the model at 1280 as at 4000 and costs a fraction of the
    // tokens; the resize never fails the call (see image-bytes.ts).
    const bounded = await Promise.all(
      photos.map((p) =>
        boundedImageBytes({ base64: p.base64, mimeType: p.mediaType }, IMAGE_EDGE.photo),
      ),
    );
    const imageParts: LlmPart[] = bounded.map((p) => ({
      type: 'image',
      mimeType: p.mimeType,
      data: p.base64,
    }));

    try {
      const r = await this.llm.complete({
        system: buildIdentifySystemPrompt(opts),
        maxTokens: 1024,
        purpose: 'askgg.identify-photos',
        messages: [
          {
            role: 'user',
            content: [
              ...imageParts,
              {
                type: 'text',
                text: 'Identify the item(s) in these photos for a marketplace listing. Return JSON per the schema in your instructions.',
              },
            ],
          },
        ],
      });

      const rawText = r.text.trim();
      const proposal = parseIdentifyProposal(rawText);
      if (!proposal) {
        this.logger.warn(
          `identify-listing returned no parsable JSON (raw length ${rawText.length})`,
        );
      }
      return {
        proposal,
        costUsd: estimateCostUsd(
          model,
          r.usage.inputTokens ?? 0,
          r.usage.outputTokens ?? 0,
        ),
      };
    } catch (err) {
      this.logger.error(
        `identify-listing failed${
          err instanceof LlmError ? ` [${err.code}]` : ''
        } (model ${model}): ${err instanceof Error ? err.message : err}`,
      );
      return { proposal: null, costUsd: null };
    }
  }
}
