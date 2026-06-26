import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
  coalMm: number | null;
  primer: string | null;
  manual: string; // "Vihtavuori — Reloading Guide (2023)"
  pageNumber: number;
}

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

@Injectable()
export class RecommendedLoadsService {
  constructor(private readonly prisma: PrismaService) {}

  async recommend(
    cartridge: string,
    bulletWeightGr: number,
    toleranceGr = 5,
  ): Promise<RecommendedLoadsResult> {
    const key = cartridgeKey(cartridge);
    const tol = Math.min(20, Math.max(0, toleranceGr || 5));
    const w = bulletWeightGr;

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

    // One recommended row per powder (maker+name). When a powder has several
    // rows (different manuals / nearby bullet weights), pick the one whose
    // bullet weight is CLOSEST to the requested weight; tie-break on the wider
    // start→max spread (more work-up room).
    const byPowder = new Map<string, typeof rows[number]>();
    for (const r of rows) {
      const pk = `${r.powderMaker}|${r.powderName}`.toLowerCase();
      const cur = byPowder.get(pk);
      if (!cur) {
        byPowder.set(pk, r);
        continue;
      }
      const dNew = Math.abs(r.bulletWeightGr - w);
      const dCur = Math.abs(cur.bulletWeightGr - w);
      if (
        dNew < dCur ||
        (dNew === dCur && r.maxGr - r.startGr > cur.maxGr - cur.startGr)
      ) {
        byPowder.set(pk, r);
      }
    }

    const sources = new Set<string>();
    const powders: RecommendedLoadRow[] = [...byPowder.values()]
      .map((r) => {
        const { incrementGr, steps } = workUpLadder(r.startGr, r.maxGr);
        const manual = r.manualLabel;
        sources.add(manual);
        return {
          powderMaker: r.powderMaker,
          powderName: r.powderName,
          bulletWeightGr: r.bulletWeightGr,
          bulletMaker: r.bulletMaker,
          bulletName: r.bulletName,
          startGr: round2(r.startGr),
          maxGr: round2(r.maxGr),
          startVelFps: r.startVelFps,
          maxVelFps: r.maxVelFps,
          incrementGr,
          steps,
          coalMm: r.coalMm,
          primer: r.primer,
          manual,
          pageNumber: r.pageNumber,
        };
      })
      // Fastest (highest max velocity) first, then alphabetical.
      .sort(
        (a, b) =>
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
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
