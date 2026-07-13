import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { workUpLadder, CART_ALIASES } from './recommended-loads.service';

/**
 * Manual-load browser — powers the Load Lab "Load data" surface: a calibre
 * hierarchy of every cartridge we hold published manual data for, and, for a
 * chosen cartridge, ALL of its manual loads grouped by bullet weight → powder,
 * each with a source-manual + page citation. Reads the pre-extracted
 * `ManualLoad` table only (authoritative; no engine, no prediction).
 *
 * The browsable unit is the canonical `cartridgeKey` (~447 cartridges), which
 * collapses the ~900 messy printed spellings the extractor produced ("308
 * Winchester" / ".308 Winchester" / "308 WINCHESTER", "6.5 Creedmoor" /
 * "6,5 Creedmoor"). For each key we show the cleanest most-published printed
 * name. Where a key merges several distinct printed labels (e.g. a "(Trapdoor)"
 * vs "(Modern)" 45-70 tier), every load carries its own `variant` label and the
 * response lists all `variants`, so pressure-tier distinctions stay visible.
 *
 * Calibre families are DERIVED from the cartridge name (caliberFamily) because
 * `ManualLoad` rows carry no diameter/type column — this scales to all 447 +
 * any future imports. Family mis-buckets are cosmetic (grouping only; the load
 * data shown is always that exact cartridge's own).
 */

const FAMILY_LABELS: Record<string, string> = {
  c17: '.17 cal',
  c20: '.20 cal',
  c22: '.22 cal (5.56 mm)',
  c6mm: '6 mm (.243)',
  c25: '.25 cal (6.35 mm)',
  c65mm: '6.5 mm (.264)',
  c270: '.270 / 6.8 mm',
  c7mm: '7 mm (.284)',
  c30: '.30 cal (7.62 mm)',
  c32: '.32 / 8 mm',
  c33: '.338 cal (8.6 mm)',
  c35: '.35 / .357 / .38',
  c375: '.375 / 9.3 mm',
  c40: '.40 cal (10 mm)',
  c44: '.44 cal',
  c45: '.45 cal',
  cbig: 'Big bore (.416 & up)',
  other: 'Other calibres',
};
const FAMILY_ORDER = [
  'c17', 'c20', 'c22', 'c6mm', 'c25', 'c65mm', 'c270', 'c7mm', 'c30',
  'c32', 'c33', 'c35', 'c375', 'c40', 'c44', 'c45', 'cbig', 'other',
];
const FAMILY_RANK: Record<string, number> = Object.fromEntries(
  FAMILY_ORDER.map((id, i) => [id, i]),
);

// Leading metric (mm) designators — unambiguous by their decimal.
const MM: Record<string, string> = {
  '4.5': 'c17', '4.6': 'c22',
  '5': 'c20', '5.45': 'c22', '5.5': 'c22', '5.56': 'c22', '5.6': 'c22', '5.7': 'c22',
  '6': 'c6mm', '6.5': 'c65mm', '6.8': 'c270',
  '7': 'c7mm', '7.5': 'c30', '7.6': 'c30', '7.62': 'c30', '7.63': 'c30', '7.65': 'c30', '7.7': 'c30',
  '7.9': 'c32', '7.92': 'c32', '8': 'c32', '8.6': 'c33',
  '9': 'c9mm', '9.3': 'c375', '9.5': 'c375',
  '10': 'c40', '11': 'c45', '11.5': 'c45', '12.7': 'cbig',
};
// Two-digit calibre designators (.22, .30, .45…). Note c9mm here maps the
// 9-mm/.35 zone loosely — cosmetic only.
const TWO: Record<number, string> = {
  17: 'c17', 20: 'c20', 22: 'c22', 25: 'c25', 26: 'c65mm', 27: 'c270', 28: 'c7mm',
  30: 'c30', 32: 'c32', 33: 'c33', 34: 'c35', 35: 'c35', 36: 'c375', 37: 'c375',
  40: 'c40', 41: 'c40', 44: 'c44', 45: 'c45', 50: 'cbig',
};

/**
 * Best-effort calibre-family for a printed cartridge name. Extracts the leading
 * calibre designator and maps it to a family; unrecognised → 'other'. Validated
 * against the live 447-cartridge dataset (4 land in 'other': a shotgun + two
 * non-numeric names + one rare Carcano). Mis-buckets are cosmetic.
 */
export function caliberFamily(name: string): string {
  let s = String(name || '').toLowerCase();
  s = s.replace(/(\d),(\d)/g, '$1.$2'); // 6,5 -> 6.5
  s = s.replace(/^[\s.]+/, ''); // drop leading dot/space: ".308" -> "308"
  const m = s.match(/^(\d+(?:\.\d+)?)/);
  if (!m) return 'other';
  const lead = m[1];
  const n = parseFloat(lead);
  const hasDot = lead.includes('.');

  if (MM[lead]) return MM[lead];

  if (!hasDot && n >= 17 && n <= 50) {
    if (n === 38) return 'c35'; // .38 Special (the 3-digit .380 is 9 mm, below)
    if (TWO[n] !== undefined) return TWO[n];
  }

  if (!hasDot) {
    if (n >= 200 && n <= 210) return 'c20';
    if (n >= 211 && n <= 228) return 'c22';
    if (n >= 236 && n <= 246) return 'c6mm';
    if (n >= 250 && n <= 258) return 'c25';
    if (n >= 259 && n <= 269) return 'c65mm';
    if (n >= 270 && n <= 279) return 'c270';
    if (n >= 280 && n <= 289) return 'c7mm';
    if (n >= 300 && n <= 311) return 'c30';
    if (n >= 312 && n <= 329) return 'c32';
    if (n >= 330 && n <= 347) return 'c33';
    if (n >= 348 && n <= 369) return 'c35';
    if (n === 380) return 'c9mm';
    if (n >= 370 && n <= 379) return 'c375';
    if (n >= 400 && n <= 411) return 'c40';
    if (n === 416) return 'cbig';
    if (n >= 440 && n <= 449) return 'c44';
    if (n >= 450 && n <= 465) return 'c45';
    if (n >= 466 && n <= 700) return 'cbig';
  }
  return 'other';
}

// The .35/.38/9 mm zone shares family ids; caliberFamily returns 'c9mm' for a
// few (9mm/.380) which we render under the '.35 / .357 / .38' bucket to keep the
// tree tidy. Map c9mm → c35 for display grouping.
function familyOf(name: string): string {
  const f = caliberFamily(name);
  return f === 'c9mm' ? 'c35' : f;
}

// A label's "variant key" — the same normalisation as cartridgeKey (expand
// Mag→Magnum, Rem→Remington, Win→Winchester… + strip case/spacing/punctuation)
// but WITHOUT dropping parentheticals. So mere spelling/abbreviation dupes
// ("300 Winchester Mag" / "…Magnum", "10mm Auto" / "10 MM AUTO") collapse, while
// a genuine parenthetical qualifier — "(+P)", "(Ruger only)", "(Rifle)", "(T/C)"
// — stays a distinct variant. Mirrors recommended-loads' cartridgeKey minus the
// parenthetical-drop step.
function variantKey(s: string): string {
  let x = (s || '').toLowerCase();
  x = x.replace(/(\d)\s*mm\b/g, '$1'); // "6.5mm" -> "6.5"
  x = x.replace(/[a-z]+/g, (w) => CART_ALIASES[w] ?? w); // expand abbreviations
  return x.replace(/[^a-z0-9]/g, '');
}

export interface CaliberFamily {
  id: string;
  label: string;
  cartridgeCount: number;
  loadCount: number;
  cartridges: { cartridgeKey: string; name: string; loadCount: number }[];
}

@Injectable()
export class ManualBrowseService {
  constructor(private readonly prisma: PrismaService) {}

  /** Score a printed spelling: publish count dominates, mixed-case breaks ties
   *  (so we prefer "6.5 Creedmoor" over "6,5 CREEDMOOR" at equal counts). */
  private nameScore(name: string, count: number): number {
    const hasLower = /[a-z]/.test(name) ? 1 : 0;
    return count * 2 + hasLower;
  }

  /**
   * The full calibre hierarchy: every canonical cartridge (by cartridgeKey) we
   * hold manual data for, grouped into derived calibre families (ordered by
   * diameter), each cartridge shown with its cleanest printed name + load count.
   */
  async listCartridges(): Promise<{ families: CaliberFamily[]; totalCartridges: number; totalLoads: number }> {
    const rows = await this.prisma.manualLoad.groupBy({
      by: ['cartridgeKey', 'cartridge'],
      _count: { _all: true },
    });

    // Collapse to one entry per cartridgeKey (keep the cleanest most-published
    // spelling; sum the loads).
    const perKey = new Map<
      string,
      { key: string; name: string; score: number; loadCount: number }
    >();
    for (const r of rows) {
      const n = r._count._all;
      const score = this.nameScore(r.cartridge, n);
      const cur = perKey.get(r.cartridgeKey);
      if (!cur) {
        perKey.set(r.cartridgeKey, { key: r.cartridgeKey, name: r.cartridge, score, loadCount: n });
      } else {
        cur.loadCount += n;
        if (score > cur.score) {
          cur.name = r.cartridge;
          cur.score = score;
        }
      }
    }

    const famMap = new Map<string, CaliberFamily>();
    const ensure = (id: string) => {
      let f = famMap.get(id);
      if (!f) {
        f = { id, label: FAMILY_LABELS[id] ?? id, cartridgeCount: 0, loadCount: 0, cartridges: [] };
        famMap.set(id, f);
      }
      return f;
    };

    let totalLoads = 0;
    for (const c of perKey.values()) {
      totalLoads += c.loadCount;
      const f = ensure(familyOf(c.name));
      f.cartridges.push({ cartridgeKey: c.key, name: c.name, loadCount: c.loadCount });
      f.loadCount += c.loadCount;
    }

    const families = [...famMap.values()]
      .sort((a, b) => (FAMILY_RANK[a.id] ?? 99) - (FAMILY_RANK[b.id] ?? 99))
      .map((f) => ({
        ...f,
        cartridgeCount: f.cartridges.length,
        cartridges: f.cartridges.sort((a, b) => a.name.localeCompare(b.name)),
      }));

    return { families, totalCartridges: perKey.size, totalLoads };
  }

  /**
   * Every published manual load for one cartridge (by canonical key), grouped by
   * bullet weight then powder, each row carrying its source manual + page and a
   * suggested start-low/work-up ladder. Where the key merges several printed
   * labels, `variants` lists them and each load carries its own `variant` so
   * pressure-tier distinctions stay visible. Charges are quoted verbatim.
   */
  async loadsForCartridge(cartridgeKeyParam: string) {
    const key = (cartridgeKeyParam || '').trim();
    if (!key) {
      return { found: false, cartridge: '', totalLoads: 0, groups: [], manuals: [], variants: [] };
    }

    const rows = await this.prisma.manualLoad.findMany({
      where: { cartridgeKey: key },
      orderBy: [
        { bulletWeightGr: 'asc' },
        { powderMaker: 'asc' },
        { powderName: 'asc' },
        { maxGr: 'asc' },
      ],
      select: {
        cartridge: true,
        powderMaker: true,
        powderName: true,
        bulletWeightGr: true,
        bulletMaker: true,
        bulletName: true,
        startGr: true,
        maxGr: true,
        startVelFps: true,
        maxVelFps: true,
        fillPctStart: true,
        fillPctMax: true,
        coalMm: true,
        primer: true,
        barrelLenIn: true,
        notes: true,
        manualLabel: true,
        pageNumber: true,
      },
    });

    if (!rows.length) {
      return { found: false, cartridge: '', totalLoads: 0, groups: [], manuals: [], variants: [] };
    }

    // Header = cleanest most-published printed name.
    const nameScores = new Map<string, number>();
    for (const r of rows) {
      nameScores.set(r.cartridge, (nameScores.get(r.cartridge) ?? 0) + 1);
    }
    let cartridge = rows[0].cartridge;
    let bestScore = -1;
    for (const [name, count] of nameScores) {
      const sc = this.nameScore(name, count);
      if (sc > bestScore) {
        bestScore = sc;
        cartridge = name;
      }
    }

    // MEANINGFUL variants only — labels whose variantKey differs from the
    // header's (a real "(Trapdoor)" vs "(Modern)" tier), not mere casing/spacing
    // dupes. One cleanest display per distinct variant key.
    const headerVk = variantKey(cartridge);
    const otherVariantBest = new Map<string, { name: string; score: number }>();
    for (const [name, count] of nameScores) {
      const vk = variantKey(name);
      if (vk === headerVk) continue;
      const sc = this.nameScore(name, count);
      const cur = otherVariantBest.get(vk);
      if (!cur || sc > cur.score) otherVariantBest.set(vk, { name, score: sc });
    }
    const variants = [...otherVariantBest.values()].map((v) => v.name).sort();

    const groupMap = new Map<
      number,
      { bulletWeightGr: number; bullets: Set<string>; loads: ReturnType<typeof this.shapeLoad>[] }
    >();
    const manuals = new Set<string>();

    for (const r of rows) {
      manuals.add(r.manualLabel);
      let g = groupMap.get(r.bulletWeightGr);
      if (!g) {
        g = { bulletWeightGr: r.bulletWeightGr, bullets: new Set<string>(), loads: [] };
        groupMap.set(r.bulletWeightGr, g);
      }
      const bulletLabel = [r.bulletMaker, r.bulletName].filter(Boolean).join(' ').trim();
      if (bulletLabel) g.bullets.add(bulletLabel);
      // Surface this row's label only when it is a real variant of the header.
      g.loads.push(this.shapeLoad(r, variantKey(r.cartridge) !== headerVk));
    }

    const groups = [...groupMap.values()]
      .sort((a, b) => a.bulletWeightGr - b.bulletWeightGr)
      .map((g) => ({
        bulletWeightGr: g.bulletWeightGr,
        bullets: [...g.bullets].sort(),
        loadCount: g.loads.length,
        loads: g.loads,
      }));

    return {
      found: true,
      cartridge,
      totalLoads: rows.length,
      bulletWeights: groups.map((g) => g.bulletWeightGr),
      groups,
      manuals: [...manuals].sort(),
      variants,
    };
  }

  private shapeLoad(
    r: {
      cartridge: string;
      powderMaker: string;
      powderName: string;
      bulletMaker: string | null;
      bulletName: string | null;
      startGr: number;
      maxGr: number;
      startVelFps: number | null;
      maxVelFps: number | null;
      fillPctStart: number | null;
      fillPctMax: number | null;
      coalMm: number | null;
      primer: string | null;
      barrelLenIn: number | null;
      notes: string | null;
      manualLabel: string;
      pageNumber: number;
    },
    includeVariant: boolean,
  ) {
    const ladder = workUpLadder(r.startGr, r.maxGr);
    return {
      // Only surface the per-load variant label when the cartridge merges more
      // than one printed spelling (e.g. a pressure tier) — otherwise null.
      variant: includeVariant ? r.cartridge : null,
      powderMaker: r.powderMaker,
      powderName: r.powderName,
      bulletMaker: r.bulletMaker,
      bulletName: r.bulletName,
      startGr: r.startGr,
      maxGr: r.maxGr,
      startVelFps: r.startVelFps,
      maxVelFps: r.maxVelFps,
      fillPctStart: r.fillPctStart,
      fillPctMax: r.fillPctMax,
      compressed: (r.fillPctMax ?? 0) >= 100,
      coalMm: r.coalMm,
      primer: r.primer,
      barrelLenIn: r.barrelLenIn,
      notes: r.notes,
      manualLabel: r.manualLabel,
      pageNumber: r.pageNumber,
      incrementGr: ladder.incrementGr,
      ladderSteps: ladder.steps,
    };
  }
}
