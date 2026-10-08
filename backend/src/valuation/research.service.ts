import { Injectable, Logger } from '@nestjs/common';
import { LlmMessage, LlmPart } from '../common/llm/llm.types';
import { LlmService } from '../common/llm/llm.service';
import { CategoryConfig } from './valuation.types';
import { ValuationCostMeter } from './cost-meter';
import { ValuationEvents } from './events.service';
import { SerperClient, SerperResult } from './sources/serper.client';
import { buildAnchorQueries, buildQueries } from './sources/query-builder';
import { WebToolsService } from './web-tools.service';
import { researchSystemPrompt } from './prompts';
import { RawComp, RESULT_SCHEMA, parseResult, ResultOutput } from './schemas';

// The gateway intermittently returns a degenerate `[]` for a structured call;
// re-request. See identify.service for the same guard.
const MAX_VALIDATION_RETRIES = 5;

function isDegenerate(raw: string): boolean {
  const t = raw.trim();
  return t === '' || t === '[]' || t === '{}' || t === 'null';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Categories where extra spend buys the most accuracy.
const HIGH_VALUE_CATEGORIES = new Set([
  'firearms',
  'air-rifles',
  'optics',
  'overlanding',
  'hunting',
]);

function usedCount(r: ResultOutput): number {
  return (r.comps ?? []).filter((c) => c.kind === 'USED_COMP').length;
}

function medianUsed(r: ResultOutput): number | null {
  const prices = (r.comps ?? [])
    .filter((c) => c.kind === 'USED_COMP')
    .map((c) => Math.round(c.priceZar * 100))
    .sort((a, b) => a - b);
  if (prices.length === 0) return null;
  const n = prices.length;
  return n % 2 ? prices[(n - 1) / 2] : Math.round((prices[n / 2 - 1] + prices[n / 2]) / 2);
}

function moreComps(a: ResultOutput, b: ResultOutput): ResultOutput {
  return usedCount(a) >= usedCount(b) ? a : b;
}

export interface ResearchArgs {
  valuationId: string;
  imageUrls: string[];
  categorySlug: string;
  make: string | null;
  model: string | null;
  keySpec: string | null;
  conditionBand: string;
  answersText: string;
  description?: string | null;
  ownListingHint?: string;
  config: CategoryConfig;
}

interface Discovered {
  candidates: SerperResult[];
  anchors: SerperResult[];
  texts: Array<{ url: string; title: string; text: string }>;
}

/**
 * Steps 2/3: research live South African listings, then produce the structured
 * result.
 *
 * Discovery is Serper (SA-scoped queries built in code) plus new-price anchors
 * from Serper Shopping. The backend fetches each candidate page and hands the
 * page text to Qwen, which reads it with the photos and extracts the comps.
 * Qwen's own hosted web search runs only as a fallback when Serper is thin, so
 * search cannot be switched off but also is not paid for twice.
 */
@Injectable()
export class ResearchService {
  private readonly logger = new Logger(ResearchService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly events: ValuationEvents,
    private readonly tools: WebToolsService,
    private readonly serper: SerperClient,
  ) {}

  async research(args: ResearchArgs): Promise<ResultOutput> {
    const specBlock = this.buildSpecBlock(args);
    const meter = new ValuationCostMeter();

    this.events.emitResearch(args.valuationId, {
      type: 'step',
      step: 'identifying',
      detail: `Confirming spec: ${[args.make, args.model, args.keySpec].filter(Boolean).join(' ') || args.categorySlug}`,
    });

    const images: LlmPart[] = [];
    for (const url of args.imageUrls) {
      const blob = await fetchImageBase64(url);
      if (blob) images.push({ type: 'image', mimeType: blob.mimeType, data: blob.data });
    }

    this.events.emitResearch(args.valuationId, {
      type: 'step',
      step: 'searching',
      detail: `SA listings: ${[args.make, args.model, args.keySpec].filter(Boolean).join(' ') || args.categorySlug}`,
    });

    // ⚠️ DO NOT INJECT FETCHED PAGE TEXT OR SERPER CANDIDATES INTO THE PROMPT.
    // Injecting that evidence block measurably regressed results (the same
    // fishing rod fell from 5 comps to 1). Qwen's own agentic web search is
    // both the discovery and the reader, and it does it best on its own.
    const messages: LlmMessage[] = [
      {
        role: 'user',
        content: [
          ...images,
          {
            type: 'text',
            text:
              `${specBlock}\n\nSearch South African sources (classifieds, auction sites, dealer and retailer stores) for this item, open the listing pages, and collect priced comparables plus the current new SA retail price. ` +
              (args.ownListingHint ? `\n\n${args.ownListingHint}` : ''),
          },
        ],
      },
    ];

    // ⚠️ QWEN'S OWN AGENTIC WEB SEARCH IS THE PRIMARY DISCOVERY. It proved the
    // most thorough in testing; making Serper primary regressed quality. Serper
    // candidates and anchors above are EXTRA evidence. This always runs, so a
    // thin Serper result can never weaken the search.
    if (this.llm.isConfiguredFor('valuation.research')) {
      const searchTurn = await this.llm.complete({
        system: researchSystemPrompt({
          specBlock,
          strategyInstructions: args.config.strategyPrompt,
          minComps: args.config.minComps,
          sources: args.config.searchSources,
        }),
        messages,
        maxTokens: 8192,
        temperature: 0.2,
        grounding: { web: true },
        // Lower than before: the search turn was taking ~3 minutes, and the
        // extractor still runs at this budget. Trims the perceived "hang".
        thinking: { budgetTokens: 2048 },
        purpose: 'valuation.research',
        timeoutMs: 240_000,
      });
      meter.recordLlm(searchTurn.usage, searchTurn.model);
      messages.push(searchTurn.assistantMessage);
      if (searchTurn.groundingSources?.length) {
        messages.push({
          role: 'user',
          content:
            'Sources you opened (cite these exact URLs):\n' +
            searchTurn.groundingSources.map((s) => `- ${s.uri}`).join('\n'),
        });
      }
    }

    this.events.emitResearch(args.valuationId, {
      type: 'step',
      step: 'calculating',
      detail: 'Computing median and range',
    });

    const extraction: LlmMessage[] = [
      ...messages,
      {
        role: 'user',
        content:
          'Now return the final JSON result matching the schema. Report every comp you found and rejected. Do not do the arithmetic; the backend computes the final prices.',
      },
    ];

    const parsed = await this.extractOnce(extraction, meter, args);

    // Verify every cited comp: pageOpened is set by our own fetch, never by
    // the model's claim.
    parsed.comps = await this.verifyComps(parsed.comps);
    this.logger.log(
      `valuation ${args.valuationId} spend ${JSON.stringify(meter.summary())} comps=${parsed.comps.length}`,
    );
    return parsed;
  }

  /** One validated extraction pass (with degenerate/validation retries). */
  private async extractOnce(
    messages: LlmMessage[],
    meter: ValuationCostMeter,
    args: ResearchArgs,
    temperature = 0.2,
  ): Promise<ResultOutput> {
    const convo: LlmMessage[] = [...messages];
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < MAX_VALIDATION_RETRIES; attempt++) {
      let res;
      try {
        res = await this.llm.complete({
          system: researchSystemPrompt({
            specBlock: this.buildSpecBlock(args),
            strategyInstructions: args.config.strategyPrompt,
            minComps: args.config.minComps,
            sources: args.config.searchSources,
          }),
          messages: convo,
          maxTokens: 8192,
          temperature,
          json: { schema: RESULT_SCHEMA },
          thinking: { budgetTokens: 0 },
          purpose: 'valuation.research',
          timeoutMs: 180_000,
        });
      } catch (err) {
        // ⚠️ A THROWN PROVIDER ERROR MUST BE RETRIED, NOT FATAL. Qwen returns
        // "Model output became abnormal while generating a JSON response" as a
        // 400; the fix is a fresh attempt, not failing the whole valuation.
        lastError = err as Error;
        this.logger.warn(
          `extraction call failed (attempt ${attempt + 1}): ${lastError.message.slice(0, 160)}`,
        );
        await sleep(600 * (attempt + 1));
        continue;
      }
      meter.recordLlm(res.usage, res.model);
      const raw = res.text.trim();
      if (isDegenerate(raw)) {
        lastError = new Error('empty response');
        convo.push({
          role: 'user',
          content: 'Your previous reply was empty. Return ONE JSON object matching the schema.',
        });
        await sleep(300);
        continue;
      }
      try {
        return parseResult(raw);
      } catch (err) {
        lastError = err as Error;
        this.logger.warn(`research validation failed (attempt ${attempt + 1}): ${lastError.message}`);
        convo.push({ role: 'assistant', content: raw });
        convo.push({
          role: 'user',
          content: `Your previous output failed validation: ${lastError.message}. Return corrected JSON only.`,
        });
      }
    }
    throw new Error(`SCHEMA_VALIDATION_FAILED: ${lastError?.message ?? 'invalid result output'}`);
  }

  /** Qwen3.8 Max reconciles two disagreeing extractions on high-value items. */
  private async reconcile(
    messages: LlmMessage[],
    a: ResultOutput,
    b: ResultOutput,
    specBlock: string,
    args: ResearchArgs,
    meter: ValuationCostMeter,
  ): Promise<ResultOutput | null> {
    try {
      const res = await this.llm.complete({
        system: researchSystemPrompt({
          specBlock,
          strategyInstructions: args.config.strategyPrompt,
          minComps: args.config.minComps,
          sources: args.config.searchSources,
        }),
        messages: [
          ...messages,
          {
            role: 'user',
            content:
              'Two analyses disagree. Reconcile them into ONE final JSON matching the schema. Prefer the comps that are better evidenced and better matched; drop anything invented.\n\nAnalysis A:\n' +
              JSON.stringify(a) +
              '\n\nAnalysis B:\n' +
              JSON.stringify(b),
          },
        ],
        model: process.env.VALUATION_RECONCILE_MODEL ?? 'qwen3.8-max',
        maxTokens: 8192,
        temperature: 0.2,
        json: { schema: RESULT_SCHEMA },
        thinking: { budgetTokens: 0 },
        purpose: 'valuation.reconcile',
        timeoutMs: 180_000,
      });
      meter.recordLlm(res.usage, res.model);
      return parseResult(res.text);
    } catch (err) {
      this.logger.warn(`reconcile failed: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Serper discovery: SA-scoped listing queries plus shopping anchors, then
   * fetch the candidate pages so the model can read them. In-memory only; the
   * page text is never persisted.
   */
  private async discover(args: ResearchArgs, meter: ValuationCostMeter): Promise<Discovered> {
    if (!this.serper.isConfigured()) return { candidates: [], anchors: [], texts: [] };

    const maxPerWave = Number(process.env.SERPER_MAX_PER_WAVE ?? 6);
    const queries = buildQueries(
      { make: args.make, model: args.model, keySpec: args.keySpec, sources: args.config.searchSources },
      maxPerWave,
    );
    const anchorQueries = buildAnchorQueries(
      { make: args.make, model: args.model, keySpec: args.keySpec, sources: args.config.searchSources },
      1,
    );

    const candidates: SerperResult[] = [];
    const anchors: SerperResult[] = [];
    meter.recordSerper(queries.length + anchorQueries.length);
    const [searchResults, shoppingResults] = await Promise.all([
      Promise.all(queries.map((q) => this.serper.search(q, 8).catch(() => []))),
      Promise.all(anchorQueries.map((q) => this.serper.shopping(q, 8).catch(() => []))),
    ]);
    for (const list of searchResults) candidates.push(...list);
    for (const list of shoppingResults) anchors.push(...list);

    // Dedupe by URL, keep insertion order.
    const byUrl = new Map<string, SerperResult>();
    for (const c of candidates) if (!byUrl.has(c.url)) byUrl.set(c.url, c);
    const deduped = [...byUrl.values()].slice(0, 10);

    // Fetch page text for the candidates (small parallel batches).
    const texts: Discovered['texts'] = [];
    const CONCURRENCY = 4;
    for (let i = 0; i < deduped.length; i += CONCURRENCY) {
      const batch = deduped.slice(i, i + CONCURRENCY);
      const done = await Promise.all(
        batch.map(async (c) => {
          const page = await this.tools.openPage(c.url);
          const text = page?.text?.trim() ?? '';
          return text.length > 80 ? { url: c.url, title: c.title, text: text.slice(0, 3000) } : null;
        }),
      );
      for (const d of done) if (d) texts.push(d);
    }

    return { candidates: deduped, anchors, texts };
  }

  private buildEvidenceBlock(args: ResearchArgs, evidence: Discovered): string {
    const lines: string[] = [this.buildSpecBlock(args)];
    if (evidence.anchors.length) {
      lines.push(
        '\nNEW-PRICE ANCHOR SUGGESTIONS (South African retail):\n' +
          evidence.anchors
            .slice(0, 5)
            .map((a) => `- ${a.title} — R${a.priceZar ?? '?'} (${a.sourceSite ?? 'retailer'}) ${a.url}`)
            .join('\n'),
      );
    }
    if (evidence.texts.length) {
      lines.push('\nCANDIDATE SOUTH AFRICAN LISTING PAGES (fetched text):');
      for (const t of evidence.texts) {
        lines.push(`\n=== ${t.title} (${t.url}) ===\n${t.text}`);
      }
    } else {
      lines.push(
        '\nNo candidate pages were fetched. Search South African sources yourself for this item.',
      );
    }
    lines.push(
      '\nRead the fetched pages above AND search South African sources yourself for this item, open the listing pages, and report every priced comparable you find with its URL, plus the current new SA retail price. Set pageOpened true only for pages you actually read.',
    );
    if (args.ownListingHint) lines.push(`\n${args.ownListingHint}`);
    return lines.join('\n');
  }

  /**
   * Fetch every cited comp URL (capped) and set `pageOpened` from THAT fetch,
   * not from the model's self-report.
   */
  private async verifyComps(comps: RawComp[]): Promise<RawComp[]> {
    const limit = Math.min(comps.length, 12);
    const verified: RawComp[] = [];
    const CONCURRENCY = 4;
    for (let i = 0; i < limit; i += CONCURRENCY) {
      const batch = comps.slice(i, i + CONCURRENCY);
      const done = await Promise.all(
        batch.map(async (c) => {
          const page = await this.tools.openPage(c.url);
          const reachable = Boolean(page && (page.text?.length ?? 0) > 80);
          return { ...c, pageOpened: reachable };
        }),
      );
      verified.push(...done);
    }
    return [...verified, ...comps.slice(limit)];
  }

  private buildSpecBlock(args: ResearchArgs): string {
    const lines = [
      `category: ${args.categorySlug}`,
      `make: ${args.make ?? 'unknown'}`,
      `model: ${args.model ?? 'unknown'}`,
      `key specification: ${args.keySpec ?? 'unknown'}`,
      `condition: ${args.conditionBand}`,
    ];
    if (args.description) lines.push(`member notes: ${args.description}`);
    if (args.answersText) lines.push(`member answers:\n${args.answersText}`);

    if (args.config.matchDimensions.length) {
      lines.push(
        'match dimensions (report a diff for each that differs, in comps[].match.diffs): ' +
          args.config.matchDimensions.map((d) => `${d.key} (${d.label})`).join(', '),
      );
    }
    const domains = args.config.searchSources.filter((s) => s.includes('.'));
    const terms = [args.make, args.model, args.keySpec].filter(Boolean).join(' ');
    if (domains.length && terms) {
      lines.push(
        'suggested site-scoped queries: ' +
          domains.map((d) => `site:${d} ${terms} used`).join(' | '),
      );
    }
    if (!args.make || !args.model) {
      lines.push(
        'make and model are UNCONFIRMED. Do NOT guess a maker. Comp on the confirmed specification only: find used items of the same type, calibre and action across ANY make (for example "used .270 bolt-action rifle South Africa"). Give every such comp a match diff {"dimension":"make","itemValue":"unknown","compValue":"<the comp make>"} so the backend tiers it correctly. Report the full range and set confidence LOW, explaining in unverified that the exact make and model were not confirmed. Only return an empty comps array if genuinely no comparable South African listing exists.',
      );
    }
    return lines.join('\n');
  }
}

async function fetchImageBase64(
  url: string,
): Promise<{ mimeType: string; data: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const mimeType = res.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
    const buf = Buffer.from(await res.arrayBuffer());
    return { mimeType, data: buf.toString('base64') };
  } catch {
    return null;
  }
}
