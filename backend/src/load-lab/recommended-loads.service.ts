import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ComponentDataService } from './component-data.service';

/**
 * Recommended Loads — serves PUBLISHED manual loads for the Load Lab right-hand
 * panel. Given a cartridge + bullet weight (±tolerance, default 5gr), returns
 * one recommended load per powder, quoted from the pre-extracted ManualLoad
 * table (authoritative; never the engine), each with a manual + page citation
 * and an auto work-up ladder (grain increment + number of steps).
 */

/**
 * Canonical cartridge key — used identically by the importer (seed side) and
 * the query (picker side) so the Load Lab cartridge name (GRT, e.g.
 * ".308 Win. (7.62x51)") matches the manual's (".308 Winchester").
 * Strips parentheticals, expands common abbreviations, drops punctuation.
 */
const CART_ALIASES: Record<string, string> = {
  win: 'winchester',
  rem: 'remington',
  mag: 'magnum',
  spr: 'springfield',
  sprg: 'springfield',
  spring: 'springfield',
  spfld: 'springfield',
  sprfld: 'springfield',
  wby: 'weatherby',
  creed: 'creedmoor',
  nato: '',
  rcbs: '',
};
export function cartridgeKey(name: string): string {
  let s = (name || '').toLowerCase();
  s = s.replace(/\([^)]*\)/g, ' '); // drop parenthetical aliases/specs
  s = s.replace(/(\d)\s*mm\b/g, '$1'); // "6.5mm"→"6.5", "9.3x62mm"→"9.3x62" (Somchem site uses mm)
  s = s.replace(/[a-z]+/g, (w) => CART_ALIASES[w] ?? w); // expand abbreviations
  return s.replace(/[^a-z0-9]/g, '');
}

/**
 * Suggested work-up ladder from a published start→max spread: increment ≈
 * (max−start)/5 snapped to a practical grain step, ~5–6 charges. Always
 * start-low / work-up.
 */
export function workUpLadder(startGr: number, maxGr: number): {
  incrementGr: number;
  steps: number;
} {
  const spread = Math.max(0, maxGr - startGr);
  if (spread <= 0) return { incrementGr: 0, steps: 1 };
  const raw = spread / 5;
  // Snap to a practical reloader step.
  const inc =
    raw <= 0.25 ? 0.2 : raw <= 0.4 ? 0.3 : raw <= 0.75 ? 0.5 : raw <= 1.5 ? 1.0 : Math.round(raw * 2) / 2;
  const steps = Math.min(12, Math.max(2, Math.round(spread / inc) + 1));
  return { incrementGr: inc, steps };
}

export interface RecommendedLoadRow {
  powderMaker: string;
  powderName: string;
  bulletWeightGr: number;
  bulletMaker: string | null;
  bulletName: string | null;
  startGr: number;
  maxGr: number;
  startVelFps: number | null;
  maxVelFps: number | null;
  incrementGr: number;
  steps: number;
  /**
   * True when the manual publishes a MAXIMUM charge only (ADI / Hodgdon / IMR
   * style). startGr is then a derived ladder start at −10% per the manuals'
   * own "start 10% below max and work up" instruction — not a published start.
   */
  singleCharge: boolean;
  coalMm: number | null;
  primer: string | null;
  manual: string; // "Vihtavuori — Reloading Guide (2023)"
  pageNumber: number;
  /**
   * Popularity proxy: how many DISTINCT manuals publish this powder for this
   * cartridge + bullet weight (±tol). A powder multiple independent manuals
   * chose to list is more widely-used/standard. Drives the default sort.
   */
  manualCount: number;
  /** Locally-made/available powder (Somchem) — pinned to the top of the list. */
  isSomchem: boolean;
  /**
   * Case fill (load density) % at the MAX charge — how full the case is. From
   * the manual where it prints one ('manual'), otherwise estimated from GRT
   * powder density + case capacity ('estimate'). null if neither is available.
   */
  fillPct: number | null;
  fillSource: 'manual' | 'estimate' | null;
  /** Fill ≥ 100% — the charge is compressed. */
  compressed: boolean;
}

/**
 * Powder identity key for corroboration counting — merges formatting variants
 * of the SAME powder across manuals (e.g. "Hodgdon H4350" vs "H4350", "RL-17"
 * vs "RL 17") WITHOUT merging genuinely different powders. We strip only maker
 * words that are redundant with the product code (Hodgdon codes are H###/named,
 * Vihtavuori N###, etc.) and deliberately KEEP "IMR"/"Accurate" because their
 * codes are bare numbers (IMR 4350 ≠ Accurate 4350 ≠ H4350).
 */
const POWDER_REDUNDANT_MAKER =
  /^(hodgdon|vihtavuori|vv|viht|alliant|winchester|norma|somchem|ramshot|nobelsport|nobel sport|lovex)\s+/;
export function powderKey(name: string): string {
  let s = (name || '').toLowerCase().trim();
  s = s.replace(POWDER_REDUNDANT_MAKER, '');
  s = s.replace(/^reloder\s*/, 'rl'); // "Reloder 17" → "rl17" (= "RL-17")
  return s.replace(/[^a-z0-9]/g, '');
}

/* Somchem is the locally-made/available powder in South Africa, so its loads
 * are surfaced FIRST regardless of corroboration — matched by label substring
 * (covers both the manual PDF and the somchemreload.com site source). */

export interface RecommendedLoadsResult {
  cartridge: string;
  bulletWeightGr: number;
  toleranceGr: number;
  /** True when nothing has been extracted for this cartridge yet. */
  notIndexed: boolean;
  powders: RecommendedLoadRow[];
  /** Distinct manuals the rows came from, for the panel footer. */
  sources: string[];
}

/**
 * Result of cross-checking a Load Lab charge against the PUBLISHED manual max.
 *   OVER_MAX        — charge exceeds the published maximum (danger; block).
 *   WITHIN          — charge is at/under the published maximum (still work up).
 *   NO_POWDER_MATCH — cartridge is indexed but this powder isn't → can't verify.
 *   NOT_INDEXED     — no published loads for this cartridge yet → can't verify.
 */
export interface MaxChargeCheck {
  status: 'OVER_MAX' | 'WITHIN' | 'NO_POWDER_MATCH' | 'NOT_INDEXED';
  chargeGr: number;
  publishedMaxGr: number | null;
  overByGr: number | null;
  overByPct: number | null;
  bulletWeightGr: number;
  toleranceGr: number;
  matchedPowder: string | null;
  manual: string | null;
  pageNumber: number | null;
  manualCount: number;
  message: string;
}

@Injectable()
export class RecommendedLoadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly componentData: ComponentDataService,
  ) {}

  async recommend(
    cartridge: string,
    bulletWeightGr: number,
    toleranceGr = 5,
  ): Promise<RecommendedLoadsResult> {
    const key = cartridgeKey(cartridge);
    const tol = Math.min(20, Math.max(0, toleranceGr || 5));
    const w = bulletWeightGr;

    // For estimating case fill where a manual doesn't print it: GRT powder bulk
    // densities (pcd, in kg/m³ ≈ 860–1046) + this cartridge's case water
    // capacity (grains). Powder bulk g/cm³ = pcd/1000, so
    //   fill% = 100 · (charge_g / (pcd/1000)) / (caseGrH2O · g_per_grain)
    //         = 100000 · charge(gr) / (pcd · caseGrH2O)   (grain↔cm³ cancels).
    // Reads slightly low vs published (uses full case volume, not under-bullet).
    const pcdByKey = new Map<string, number>();
    for (const p of this.componentData.listPowderDensities()) {
      const pk = powderKey(p.name);
      if (p.pcd > 0 && !pcdByKey.has(pk)) pcdByKey.set(pk, p.pcd);
    }
    let caseVolGrH2O: number | undefined;
    for (const c of this.componentData.listCaseCapacities()) {
      if (cartridgeKey(c.cipname) === key) {
        caseVolGrH2O = c.vGrH2O;
        break;
      }
    }
    const estimateFill = (powderName: string, chargeGr: number): number | null => {
      const pcd = pcdByKey.get(powderKey(powderName));
      if (!pcd || !caseVolGrH2O) return null;
      return (100000 * chargeGr) / (pcd * caseVolGrH2O);
    };

    const rows = await this.prisma.manualLoad.findMany({
      where: {
        cartridgeKey: key,
        bulletWeightGr: { gte: w - tol, lte: w + tol },
      },
      select: {
        powderMaker: true,
        powderName: true,
        bulletMaker: true,
        bulletName: true,
        bulletWeightGr: true,
        startGr: true,
        maxGr: true,
        startVelFps: true,
        maxVelFps: true,
        coalMm: true,
        primer: true,
        pageNumber: true,
        manualLabel: true,
        fillPctStart: true,
        fillPctMax: true,
      },
    });

    if (rows.length === 0) {
      return {
        cartridge,
        bulletWeightGr: w,
        toleranceGr: tol,
        notIndexed: true,
        powders: [],
        sources: [],
      };
    }

    // Group every band row by powder identity (formatting-normalised, maker-
    // aware). Per powder: keep a representative row (bullet weight CLOSEST to the
    // request, tie-break wider work-up spread) for the quoted charge, count the
    // DISTINCT manuals that publish it (popularity), and prefer a maker-qualified
    // name for display.
    type Row = (typeof rows)[number];
    const groups = new Map<
      string,
      { rep: Row; manuals: Set<string>; displayMaker: string }
    >();
    for (const r of rows) {
      const pk = powderKey(r.powderName);
      const g = groups.get(pk);
      if (!g) {
        groups.set(pk, {
          rep: r,
          manuals: new Set([r.manualLabel]),
          displayMaker: r.powderMaker || '',
        });
        continue;
      }
      g.manuals.add(r.manualLabel);
      if (!g.displayMaker && r.powderMaker) g.displayMaker = r.powderMaker;
      const dNew = Math.abs(r.bulletWeightGr - w);
      const dCur = Math.abs(g.rep.bulletWeightGr - w);
      if (
        dNew < dCur ||
        (dNew === dCur && r.maxGr - r.startGr > g.rep.maxGr - g.rep.startGr)
      ) {
        g.rep = r;
      }
    }

    const sources = new Set<string>();
    const powders: RecommendedLoadRow[] = [...groups.values()]
      .map(({ rep: r, manuals, displayMaker }) => {
        const singleCharge = r.startGr >= r.maxGr;
        // Max-only manuals (ADI / Hodgdon / IMR) instruct "start 10% below the
        // maximum and work up". When only a max is published, derive a −10%
        // ladder start so the work-up stays useful AND conservative.
        const maxGr = round2(r.maxGr);
        const startGr = singleCharge ? round2(r.maxGr * 0.9) : round2(r.startGr);
        const { incrementGr, steps } = workUpLadder(startGr, maxGr);
        manuals.forEach((m) => sources.add(m));
        // Case fill at the max charge: published if the manual prints it, else
        // estimated from GRT powder density + case capacity.
        let fillPct: number | null = null;
        let fillSource: 'manual' | 'estimate' | null = null;
        if (r.fillPctMax != null) {
          fillPct = round1(r.fillPctMax);
          fillSource = 'manual';
        } else {
          const est = estimateFill(r.powderName, r.maxGr);
          if (est != null) {
            fillPct = round1(est);
            fillSource = 'estimate';
          }
        }
        return {
          powderMaker: displayMaker,
          powderName: r.powderName,
          bulletWeightGr: r.bulletWeightGr,
          bulletMaker: r.bulletMaker,
          bulletName: r.bulletName,
          startGr,
          maxGr,
          // For a max-only row the published velocity belongs to the max charge;
          // we don't know the velocity at the derived start, so leave it null.
          startVelFps: singleCharge ? null : r.startVelFps,
          maxVelFps: r.maxVelFps ?? r.startVelFps,
          incrementGr,
          steps,
          singleCharge,
          coalMm: r.coalMm,
          primer: r.primer,
          manual: r.manualLabel,
          pageNumber: r.pageNumber,
          manualCount: manuals.size,
          isSomchem: [...manuals].some((m) => /somchem/i.test(m)),
          fillPct,
          fillSource,
          compressed: fillPct != null && fillPct >= 100,
        };
      })
      // Locally-available Somchem powders FIRST, then most-published (popularity),
      // then fastest, then alphabetical.
      .sort(
        (a, b) =>
          Number(b.isSomchem) - Number(a.isSomchem) ||
          b.manualCount - a.manualCount ||
          (b.maxVelFps ?? 0) - (a.maxVelFps ?? 0) ||
          a.powderName.localeCompare(b.powderName),
      );

    return {
      cartridge,
      bulletWeightGr: w,
      toleranceGr: tol,
      notIndexed: false,
      powders,
      sources: [...sources].sort(),
    };
  }

  /**
   * SAFETY cross-check — does a Load Lab charge exceed the PUBLISHED maximum for
   * this cartridge + powder + bullet weight? Reuses recommend()'s authoritative
   * ManualLoad matching (never the engine's estimate). Because matching is
   * name-based, a miss returns NO_POWDER_MATCH / NOT_INDEXED ("can't verify")
   * rather than a false all-clear — we never imply a load is safe on absence of
   * a reference.
   */
  async maxChargeCheck(
    cartridge: string,
    bulletWeightGr: number,
    powderName: string,
    chargeGr: number,
    toleranceGr = 5,
  ): Promise<MaxChargeCheck> {
    const rec = await this.recommend(cartridge, bulletWeightGr, toleranceGr);
    const base = {
      chargeGr: round2(chargeGr),
      bulletWeightGr,
      toleranceGr: rec.toleranceGr,
      publishedMaxGr: null as number | null,
      overByGr: null as number | null,
      overByPct: null as number | null,
      matchedPowder: null as string | null,
      manual: null as string | null,
      pageNumber: null as number | null,
      manualCount: 0,
    };

    if (rec.notIndexed) {
      return {
        ...base,
        status: 'NOT_INDEXED',
        message: `No published reference loads for ${cartridge} in our manual library yet — this charge can't be cross-checked. Verify against a printed reloading manual before loading.`,
      };
    }

    const pk = powderKey(powderName);
    const match = rec.powders.find((p) => powderKey(p.powderName) === pk);
    if (!match) {
      return {
        ...base,
        status: 'NO_POWDER_MATCH',
        message: `No published data for ${powderName} in ${cartridge} at ~${bulletWeightGr}gr in our library — this charge can't be cross-checked against a manual. Verify against published data for this exact powder before loading.`,
      };
    }

    const publishedMaxGr = match.maxGr;
    const matchedPowder = `${match.powderMaker || ''} ${match.powderName}`.trim();
    if (chargeGr > publishedMaxGr) {
      const overByGr = round2(chargeGr - publishedMaxGr);
      const overByPct = round1(((chargeGr - publishedMaxGr) / publishedMaxGr) * 100);
      return {
        ...base,
        status: 'OVER_MAX',
        publishedMaxGr,
        overByGr,
        overByPct,
        matchedPowder,
        manual: match.manual,
        pageNumber: match.pageNumber,
        manualCount: match.manualCount,
        message: `${round2(chargeGr)}gr EXCEEDS the published maximum of ${publishedMaxGr}gr for ${matchedPowder} (${match.manual}) by ${overByGr}gr (+${overByPct}%). Do NOT load this charge — it may be dangerously over-pressure. Follow published data and work up.`,
      };
    }

    return {
      ...base,
      status: 'WITHIN',
      publishedMaxGr,
      matchedPowder,
      manual: match.manual,
      pageNumber: match.pageNumber,
      manualCount: match.manualCount,
      message: `Within the published maximum of ${publishedMaxGr}gr for ${matchedPowder} (${match.manual}). Always start low and work up.`,
    };
  }
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
