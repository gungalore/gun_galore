import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { ReloadingService } from './reloading.service';

/**
 * Load-data extraction — reads the ingested reloading-manual pages and pulls
 * STRUCTURED published load rows into the ManualLoad table, so the Load Lab
 * "Recommended loads" panel can serve authoritative start→max charges per
 * powder by cartridge + bullet weight instantly (no per-request PDF reading).
 *
 * Per cartridge: ReloadingService.searchPages() finds the load-table pages
 * across all manuals, then Claude transcribes each page into structured rows.
 * STRICT rule: transcribe only what is printed — never invent or interpolate
 * charges. Every row keeps its manual + page so the UI cites it. Idempotent
 * upsert on (manual, page, powder, bullet weight, start charge).
 *
 * Admin-triggered (POST /admin/reloading/extract-loads) — runs on prod where
 * the manuals + DB live. One Claude call per candidate page (~40 pages/cartridge,
 * a few cents). Manuals remain AUTHORITATIVE; the internal engine never feeds
 * this table.
 */
const EXTRACT_MODEL =
  process.env.ANTHROPIC_MODEL_LOADDATA ?? 'claude-sonnet-4-6';
const MAX_PAGES_PER_CARTRIDGE = 40;

interface ExtractedRow {
  powderMaker: string | null;
  powderName: string | null;
  bulletMaker: string | null;
  bulletName: string | null;
  bulletWeightGr: number | null;
  startGr: number | null;
  maxGr: number | null;
  startVelFps: number | null;
  maxVelFps: number | null;
  coalMm: number | null;
  primer: string | null;
}

/** Lowercase, strip punctuation/space — "6.5 Creedmoor" → "65creedmoor". */
export function cartridgeKey(name: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

@Injectable()
export class LoadDataExtractionService {
  private readonly logger = new Logger(LoadDataExtractionService.name);
  private readonly client = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reloading: ReloadingService,
  ) {}

  /**
   * Extract + persist all published loads for one cartridge across every
   * ACTIVE manual. Returns a summary for the admin UI. Re-running re-reads
   * the pages and upserts (no duplicates).
   */
  async extractForCartridge(cartridge: string): Promise<{
    cartridge: string;
    pagesProcessed: number;
    rowsUpserted: number;
    manuals: string[];
  }> {
    if (!this.client) {
      throw new Error('ANTHROPIC_API_KEY missing — cannot extract load data.');
    }
    const name = cartridge.trim();
    if (!name) throw new Error('cartridge is required.');
    const key = cartridgeKey(name);

    // Find the load-table pages for this cartridge across all manuals.
    const { results } = await this.reloading.searchPages(name, MAX_PAGES_PER_CARTRIDGE);
    const manuals = new Set<string>();
    let rowsUpserted = 0;
    let pagesProcessed = 0;

    for (const hit of results) {
      const page = await this.prisma.reloadingManualPage.findUnique({
        where: {
          manualId_pageNumber: {
            manualId: hit.manualId,
            pageNumber: hit.pageNumber,
          },
        },
        select: { extractedText: true },
      });
      if (!page?.extractedText || page.extractedText.length < 40) continue;
      pagesProcessed += 1;

      let rows: ExtractedRow[];
      try {
        rows = await this.extractRowsFromPage(name, page.extractedText);
      } catch (err) {
        this.logger.warn(
          `Extraction failed on ${hit.manufacturer} p.${hit.pageNumber}: ${
            err instanceof Error ? err.message : err
          }`,
        );
        continue;
      }

      for (const r of rows) {
        // Hard validity gate: a usable load needs a powder, a bullet weight,
        // and a start ≤ max charge in a sane grain range. Anything else is
        // skipped so we never persist a half-read or invented row.
        if (
          !r.powderName ||
          !(r.bulletWeightGr && r.bulletWeightGr > 0) ||
          !(r.startGr && r.startGr > 0) ||
          !(r.maxGr && r.maxGr > 0) ||
          r.startGr > r.maxGr ||
          r.maxGr > 200
        ) {
          continue;
        }
        try {
          await this.prisma.manualLoad.upsert({
            where: {
              manualId_pageNumber_powderName_bulletWeightGr_startGr: {
                manualId: hit.manualId,
                pageNumber: hit.pageNumber,
                powderName: r.powderName,
                bulletWeightGr: r.bulletWeightGr,
                startGr: r.startGr,
              },
            },
            create: {
              cartridge: name,
              cartridgeKey: key,
              powderMaker: r.powderMaker ?? '',
              powderName: r.powderName,
              bulletMaker: r.bulletMaker,
              bulletName: r.bulletName,
              bulletWeightGr: r.bulletWeightGr,
              startGr: r.startGr,
              maxGr: r.maxGr,
              startVelFps: r.startVelFps,
              maxVelFps: r.maxVelFps,
              coalMm: r.coalMm,
              primer: r.primer,
              manualId: hit.manualId,
              pageNumber: hit.pageNumber,
            },
            update: {
              maxGr: r.maxGr,
              startVelFps: r.startVelFps,
              maxVelFps: r.maxVelFps,
              coalMm: r.coalMm,
              primer: r.primer,
              powderMaker: r.powderMaker ?? '',
              bulletMaker: r.bulletMaker,
              bulletName: r.bulletName,
            },
          });
          rowsUpserted += 1;
          manuals.add(hit.manufacturer);
        } catch (err) {
          this.logger.warn(
            `Upsert failed for ${r.powderName} ${r.bulletWeightGr}gr: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      }
    }

    this.logger.log(
      `Extracted ${rowsUpserted} loads for "${name}" from ${pagesProcessed} pages across ${manuals.size} manuals.`,
    );
    return {
      cartridge: name,
      pagesProcessed,
      rowsUpserted,
      manuals: [...manuals],
    };
  }

  /**
   * Ask Claude to transcribe the printed load table on one manual page into
   * structured rows for the target cartridge ONLY. Returns [] on no data.
   */
  private async extractRowsFromPage(
    cartridge: string,
    pageText: string,
  ): Promise<ExtractedRow[]> {
    if (!this.client) return [];
    // Cap page text so a giant page can't blow the token budget.
    const text = pageText.slice(0, 12000);
    const system =
      `You transcribe PUBLISHED reloading load data from one manual page into JSON. ` +
      `STRICT RULES:\n` +
      `- Return ONLY loads for the cartridge "${cartridge}". Ignore every other cartridge on the page.\n` +
      `- TRANSCRIBE ONLY what is printed. NEVER invent, round, average or interpolate a charge or velocity.\n` +
      `- One row per (powder × bullet-weight) load line. Charges in GRAINS (gr). Velocity in fps.\n` +
      `- "startGr" = the minimum/start charge, "maxGr" = the maximum charge for that line. If only a single charge is listed, set both to that value.\n` +
      `- Use null for any field not printed. Convert COAL/OAL to mm if given in inches (×25.4).\n` +
      `- If the page has NO load table for "${cartridge}", return an empty array.\n` +
      `Respond with ONLY a JSON object: {"loads":[{"powderMaker","powderName","bulletMaker","bulletName","bulletWeightGr","startGr","maxGr","startVelFps","maxVelFps","coalMm","primer"}]}. No prose.`;

    const resp = await this.client.messages.create({
      model: EXTRACT_MODEL,
      max_tokens: 4000,
      system,
      messages: [
        {
          role: 'user',
          content: `MANUAL PAGE TEXT:\n\n${text}`,
        },
        // Prefill the assistant turn with "{" so it emits raw JSON.
        { role: 'assistant', content: '{' },
      ],
    });

    const raw =
      '{' +
      resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
    let parsed: { loads?: unknown };
    try {
      // Trim anything after the final closing brace (defensive).
      const end = raw.lastIndexOf('}');
      parsed = JSON.parse(end >= 0 ? raw.slice(0, end + 1) : raw);
    } catch {
      return [];
    }
    const loads = Array.isArray(parsed.loads) ? parsed.loads : [];
    return loads.map((l) => this.coerceRow(l));
  }

  private coerceRow(l: unknown): ExtractedRow {
    const o = (l ?? {}) as Record<string, unknown>;
    const num = (v: unknown): number | null => {
      const n = typeof v === 'string' ? parseFloat(v) : (v as number);
      return typeof n === 'number' && Number.isFinite(n) ? n : null;
    };
    const str = (v: unknown): string | null => {
      const s = typeof v === 'string' ? v.trim() : '';
      return s.length > 0 ? s : null;
    };
    return {
      powderMaker: str(o.powderMaker),
      powderName: str(o.powderName),
      bulletMaker: str(o.bulletMaker),
      bulletName: str(o.bulletName),
      bulletWeightGr: num(o.bulletWeightGr),
      startGr: num(o.startGr),
      maxGr: num(o.maxGr),
      startVelFps: num(o.startVelFps) === null ? null : Math.round(num(o.startVelFps)!),
      maxVelFps: num(o.maxVelFps) === null ? null : Math.round(num(o.maxVelFps)!),
      coalMm: num(o.coalMm),
      primer: str(o.primer),
    };
  }
}
