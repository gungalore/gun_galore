import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { SearchService, INDEXES } from '../search/search.service';
import { cartridgeKey, powderKey } from './recommended-loads.service';

/**
 * Powder Burn-Rate Chart — serves the cross-manufacturer burn-rate ranking
 * (extracted from the Vihtavuori chart + researched Somchem placements) and
 * joins each powder to our published ManualLoad data:
 *   - which cartridges use a powder (top N, with the bullet-weight range), and
 *   - which powders are published for a given cartridge (for highlighting).
 *
 * The chart itself is a bundled JSON asset (reference data, trivial scale). The
 * powder↔cartridge index is aggregated once from ManualLoad and cached in
 * memory (rebuilt on a TTL; published data only changes on a re-import, which
 * restarts the process anyway).
 */

interface ChartPowder {
  id: string;
  maker: string;
  name: string;
  // One powder can appear under several powderKeys across manuals (e.g.
  // "2700" / "A-2700" / "Accurate 2700"); we carry them all so the hover unions
  // every load and the highlight matches any of them.
  keys: string[];
  yNorm: number;
  loadCount?: number;
  approx?: boolean;
}
interface BurnChart {
  source: string;
  note: string;
  makers: string[];
  powders: ChartPowder[];
}

interface CartridgeAgg {
  cartridge: string; // display name (most common spelling wins)
  count: number;
  minW: number;
  maxW: number;
}
/** powderKey -> cartridgeKey -> aggregate */
type PowderIndex = Map<string, Map<string, CartridgeAgg>>;

export interface PowderCartridge {
  cartridge: string;
  minWeightGr: number;
  maxWeightGr: number;
  loadCount: number;
}

@Injectable()
export class BurnChartService {
  private readonly logger = new Logger(BurnChartService.name);
  private chart: BurnChart | null = null;
  private index: PowderIndex | null = null;
  private cartridgeNames = new Map<string, string>(); // cartridgeKey -> display
  private builtAt = 0;
  private building: Promise<void> | null = null;
  private readonly TTL_MS = 30 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchService,
  ) {}

  private loadChart(): BurnChart {
    if (this.chart) return this.chart;
    const REL = 'load-lab/data/powder-burn-rate.json';
    const candidates = [
      path.join(__dirname, 'data', 'powder-burn-rate.json'),
      path.join(process.cwd(), 'src', REL),
      path.join(process.cwd(), 'dist', 'src', REL),
    ];
    const file = candidates.find((p) => fs.existsSync(p));
    if (!file) {
      throw new Error(`Burn-rate chart data not found. Looked in:\n${candidates.join('\n')}`);
    }
    this.chart = JSON.parse(fs.readFileSync(file, 'utf8')) as BurnChart;
    return this.chart;
  }

  private async ensureIndex(): Promise<void> {
    if (this.index && Date.now() - this.builtAt < this.TTL_MS) return;
    if (this.building) return this.building;
    this.building = this.buildIndex().finally(() => (this.building = null));
    return this.building;
  }

  private async buildIndex(): Promise<void> {
    const rows = await this.prisma.manualLoad.findMany({
      select: { cartridge: true, cartridgeKey: true, powderName: true, bulletWeightGr: true },
    });
    const index: PowderIndex = new Map();
    const names = new Map<string, string>();
    const nameFreq = new Map<string, Map<string, number>>(); // cartridgeKey -> display -> freq
    for (const r of rows) {
      const pk = powderKey(r.powderName);
      if (!pk) continue;
      const ck = r.cartridgeKey || cartridgeKey(r.cartridge);
      if (!ck) continue;
      // track most common display spelling per cartridgeKey
      let freq = nameFreq.get(ck);
      if (!freq) nameFreq.set(ck, (freq = new Map()));
      freq.set(r.cartridge, (freq.get(r.cartridge) ?? 0) + 1);

      let byCart = index.get(pk);
      if (!byCart) index.set(pk, (byCart = new Map()));
      const agg = byCart.get(ck);
      const w = r.bulletWeightGr;
      if (!agg) {
        byCart.set(ck, { cartridge: r.cartridge, count: 1, minW: w, maxW: w });
      } else {
        agg.count += 1;
        if (w < agg.minW) agg.minW = w;
        if (w > agg.maxW) agg.maxW = w;
      }
    }
    // resolve display name (most frequent spelling) per cartridgeKey
    for (const [ck, freq] of nameFreq) {
      let best = '', bc = -1;
      for (const [name, c] of freq) if (c > bc) { bc = c; best = name; }
      names.set(ck, best);
    }
    // rewrite each agg's display to the canonical spelling
    for (const byCart of index.values()) {
      for (const [ck, agg] of byCart) agg.cartridge = names.get(ck) ?? agg.cartridge;
    }
    this.index = index;
    this.cartridgeNames = names;
    this.builtAt = Date.now();
    this.logger.log(`Burn-chart index built: ${index.size} powders, ${names.size} cartridges from ${rows.length} loads`);
    // keep the Meilisearch cartridge index fresh (fire-and-forget)
    this.syncCartridgeSearch().catch((e) =>
      this.logger.warn(`cartridge search sync failed: ${(e as Error).message}`),
    );
  }

  /** Push the distinct cartridge list into Meilisearch for the typeahead. */
  private async syncCartridgeSearch(): Promise<void> {
    if (!this.search.isConnected) return;
    const docs = [...this.cartridgeNames.entries()].map(([key, name]) => ({ id: key, name }));
    if (docs.length) await this.search.addDocuments(INDEXES.CARTRIDGES, docs);
  }

  /** The full chart, each powder tagged with whether we hold published loads. */
  async getChart() {
    const chart = this.loadChart();
    await this.ensureIndex();
    const idx = this.index!;
    const powders = chart.powders.map((p) => {
      const distinctCarts = new Set<string>();
      for (const k of p.keys) {
        const byCart = idx.get(k);
        if (byCart) for (const ck of byCart.keys()) distinctCarts.add(ck);
      }
      return { ...p, hasLoads: distinctCarts.size > 0, cartridgeCount: distinctCarts.size };
    });
    return { source: chart.source, note: chart.note, makers: chart.makers, powders };
  }

  /**
   * Top N cartridges that use a powder, with the published bullet-weight range.
   * Accepts one or more powderKeys (a chart cell can carry several manual name
   * variants) and unions their loads per cartridge.
   */
  async getPowderCartridges(keys: string[], limit = 15): Promise<PowderCartridge[]> {
    await this.ensureIndex();
    const merged = new Map<string, CartridgeAgg>();
    for (const key of keys) {
      const byCart = this.index!.get(powderKey(key));
      if (!byCart) continue;
      for (const [ck, a] of byCart) {
        const m = merged.get(ck);
        if (!m) merged.set(ck, { ...a });
        else { m.count += a.count; m.minW = Math.min(m.minW, a.minW); m.maxW = Math.max(m.maxW, a.maxW); }
      }
    }
    return [...merged.values()]
      .sort((a, b) => b.count - a.count || a.cartridge.localeCompare(b.cartridge))
      .slice(0, limit)
      .map((a) => ({
        cartridge: a.cartridge,
        minWeightGr: Math.round(a.minW),
        maxWeightGr: Math.round(a.maxW),
        loadCount: a.count,
      }));
  }

  /** The powderKeys we hold published loads for, for a given cartridge. */
  async getCartridgePowders(cartridge: string): Promise<{ cartridgeKey: string; cartridge: string; powderKeys: string[] }> {
    await this.ensureIndex();
    const ck = cartridgeKey(cartridge);
    const keys: string[] = [];
    for (const [pk, byCart] of this.index!) if (byCart.has(ck)) keys.push(pk);
    return { cartridgeKey: ck, cartridge: this.cartridgeNames.get(ck) ?? cartridge, powderKeys: keys };
  }

  /** Cartridge typeahead — Meilisearch when connected, else an in-memory contains-match. */
  async searchCartridges(q: string, limit = 8): Promise<{ cartridgeKey: string; name: string }[]> {
    await this.ensureIndex();
    const query = (q ?? '').trim();
    if (!query) return [];
    if (this.search.isConnected) {
      const res = await this.search.search<{ id: string; name: string }>(INDEXES.CARTRIDGES, query, { limit });
      if (res.hits.length) return res.hits.map((h) => ({ cartridgeKey: h.id, name: h.name }));
    }
    // fallback: substring match on the in-memory name list
    const lc = query.toLowerCase();
    return [...this.cartridgeNames.entries()]
      .filter(([, name]) => name.toLowerCase().includes(lc))
      .slice(0, limit)
      .map(([key, name]) => ({ cartridgeKey: key, name }));
  }

  /**
   * Everything the Ask GG chat needs about a single powder from the burn-rate
   * chart: where it sits fast→slow, its cross-maker EQUIVALENTS (similar burn
   * rate — NOT interchangeable loads), its faster/slower neighbours, and the
   * cartridges it's published for. Same data the Load Lab powder chart shows.
   */
  async powderInfo(powderName: string) {
    const chart = this.loadChart();
    const sorted = [...chart.powders].sort((a, b) => a.yNorm - b.yNorm);
    const q = powderKey(powderName);
    const nrm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const lc = nrm(powderName);
    let cell =
      sorted.find((p) => p.keys.includes(q)) ??
      sorted.find((p) => nrm(`${p.maker} ${p.name}`).includes(lc) || nrm(p.name) === lc) ??
      (lc.length >= 3 ? sorted.find((p) => nrm(p.name).includes(lc)) : undefined);
    if (!cell) {
      return { found: false, query: powderName, note: 'Not found in our powder library / burn-rate chart.' };
    }
    const idx = sorted.indexOf(cell);
    const y = cell.yNorm;
    const dist = (p: ChartPowder) => Math.abs(p.yNorm - y);
    const equivalents = sorted
      .filter((p) => p !== cell && dist(p) <= 0.035)
      .sort((a, b) => dist(a) - dist(b))
      .slice(0, 10)
      .map((p) => ({ maker: p.maker, name: p.name }));
    const faster = sorted.slice(Math.max(0, idx - 4), idx).reverse().map((p) => ({ maker: p.maker, name: p.name }));
    const slower = sorted.slice(idx + 1, idx + 5).map((p) => ({ maker: p.maker, name: p.name }));
    const cartridges = await this.getPowderCartridges(cell.keys, 12);
    return {
      found: true,
      maker: cell.maker,
      name: cell.name,
      rankFromFastest: idx + 1,
      totalPowders: sorted.length,
      burnClass: burnBand(y),
      approximatePlacement: !!cell.approx,
      equivalents,
      faster,
      slower,
      cartridges,
      note:
        'Burn-rate position + cross-maker equivalents from the All Outdoor powder chart (GRT burn-rate data). Equivalents share a similar burn rate but are NOT interchangeable loads — always use published data for the specific powder and start low / work up.',
    };
  }
}

/** Coarse burn-rate band label from the normalised position (0 fast → 1 slow). */
function burnBand(y: number): string {
  if (y < 0.1) return 'very fast (pistol / shotshell)';
  if (y < 0.22) return 'fast (pistol / small rifle)';
  if (y < 0.38) return 'fast rifle';
  if (y < 0.55) return 'medium-fast rifle';
  if (y < 0.68) return 'medium rifle (Varget / H4350 zone)';
  if (y < 0.82) return 'medium-slow rifle';
  if (y < 0.92) return 'slow rifle (magnum)';
  return 'very slow (overbore magnum)';
}
