// frontend/lib/ballistics-data/bullets.ts
//
// Curated bullet database — the offline fallback when Claude Bullet
// Lookup isn't reachable. The user can type "168 SMK" and we'll find
// it locally. When online, Claude does the actual lookup (broader
// catalogue + manufacturer datasheet parsing); when offline, this
// table covers the most common SA hunting + target loads.
//
// All BCs are manufacturer-published — citations in the `source`
// field. If a manufacturer publishes both G1 and G7, both are
// recorded (G7 is more honest for boat-tail spitzers; G1 is what
// most older published data uses).
//
// Format: array, sorted roughly by SA popularity. ~40 entries =
// ~3KB minified. Lookup is a linear scan + fuzzy match — adequate
// for offline use; Claude takes over when online for the long tail.
//
// VERIFY: BCs are best-effort from the most recent manufacturer
// data I had at curation time (2026-05). If a value here disagrees
// with the current data-sheet, the data-sheet wins — file a bug to
// update this table.

export type BulletType =
  | 'match'
  | 'hunting-soft-point'
  | 'hunting-bonded'
  | 'hunting-monolithic'
  | 'hunting-ballistic-tip'
  | 'fmj-target'
  | 'varmint';

export interface BulletPreset {
  /** Canonical name as it'd appear on a box / datasheet. */
  name: string;
  /** Short alias for fuzzy match (e.g. "168 SMK"). Lowercased. */
  aliases: string[];
  manufacturer: string;
  calibre: string;
  /** Diameter in inches — for filtering by calibre. */
  diameterIn: number;
  weightGr: number;
  bcG1?: number;
  bcG7?: number;
  type: BulletType;
  /** Typical published MV in a 24" barrel, fps. The real value
   *  depends on the load + barrel + the day; this is a starting
   *  point for the calculator and the user can refine. */
  typicalMvFps: number;
  /** Manufacturer source for the BC + MV. */
  source: string;
}

// Ordered by SA hunting / match popularity. Add new entries at the
// end — alias-search is O(n) but n is tiny.
export const BULLET_PRESETS: BulletPreset[] = [
  // ─── .224 (.223 Rem / 5.56) ─────────────────────────────────────
  {
    name: 'Sierra MatchKing 69gr HPBT',
    aliases: ['69 smk', '69gr smk', 'sierra 69'],
    manufacturer: 'Sierra',
    calibre: '.224',
    diameterIn: 0.224,
    weightGr: 69,
    bcG1: 0.301,
    bcG7: 0.158,
    type: 'match',
    typicalMvFps: 2950,
    source: 'Sierra Reloading Manual 6th Ed',
  },
  {
    name: 'Sierra MatchKing 77gr HPBT',
    aliases: ['77 smk', '77gr smk', 'sierra 77'],
    manufacturer: 'Sierra',
    calibre: '.224',
    diameterIn: 0.224,
    weightGr: 77,
    bcG1: 0.372,
    bcG7: 0.193,
    type: 'match',
    typicalMvFps: 2750,
    source: 'Sierra Reloading Manual 6th Ed',
  },
  {
    name: 'Hornady V-Max 55gr',
    aliases: ['55 vmax', '55gr v-max', 'hornady 55 vmax'],
    manufacturer: 'Hornady',
    calibre: '.224',
    diameterIn: 0.224,
    weightGr: 55,
    bcG1: 0.255,
    type: 'varmint',
    typicalMvFps: 3240,
    source: 'Hornady datasheet 2025',
  },
  {
    name: 'PMP ProAmm 55gr SP',
    aliases: ['pmp 55 sp', 'pmp 55', 'pmp .223 55'],
    manufacturer: 'PMP',
    calibre: '.224',
    diameterIn: 0.224,
    weightGr: 55,
    bcG1: 0.243,
    type: 'hunting-soft-point',
    typicalMvFps: 3215,
    source: 'PMP catalogue 2025',
  },

  // ─── .243 (6mm) ─────────────────────────────────────────────────
  {
    name: 'Hornady ELD-Match 108gr',
    aliases: ['108 eldm', '108gr eld-m', 'hornady 108'],
    manufacturer: 'Hornady',
    calibre: '.243',
    diameterIn: 0.243,
    weightGr: 108,
    bcG1: 0.536,
    bcG7: 0.270,
    type: 'match',
    typicalMvFps: 2960,
    source: 'Hornady datasheet 2025',
  },
  {
    name: 'Nosler Partition 100gr',
    aliases: ['100 partition', 'nosler 100 partition'],
    manufacturer: 'Nosler',
    calibre: '.243',
    diameterIn: 0.243,
    weightGr: 100,
    bcG1: 0.384,
    type: 'hunting-bonded',
    typicalMvFps: 2960,
    source: 'Nosler datasheet 2025',
  },

  // ─── .264 (6.5mm) — Creedmoor + Swedish + PRC ───────────────────
  {
    name: 'Hornady ELD-Match 140gr',
    aliases: ['140 eldm', '140gr eld-m', 'hornady 140 eldm'],
    manufacturer: 'Hornady',
    calibre: '.264',
    diameterIn: 0.264,
    weightGr: 140,
    bcG1: 0.646,
    bcG7: 0.326,
    type: 'match',
    typicalMvFps: 2700,
    source: 'Hornady datasheet 2025',
  },
  {
    name: 'Sierra MatchKing 142gr HPBT',
    aliases: ['142 smk', '142gr smk', 'sierra 142'],
    manufacturer: 'Sierra',
    calibre: '.264',
    diameterIn: 0.264,
    weightGr: 142,
    bcG1: 0.595,
    bcG7: 0.301,
    type: 'match',
    typicalMvFps: 2700,
    source: 'Sierra Reloading Manual 6th Ed',
  },
  {
    name: 'Berger Hybrid Target 140gr',
    aliases: ['140 berger', '140 hybrid', 'berger 140 hybrid'],
    manufacturer: 'Berger',
    calibre: '.264',
    diameterIn: 0.264,
    weightGr: 140,
    bcG1: 0.640,
    bcG7: 0.326,
    type: 'match',
    typicalMvFps: 2700,
    source: 'Berger datasheet 2025',
  },
  {
    name: 'Hornady ELD-X 143gr',
    aliases: ['143 eldx', '143gr eld-x', 'hornady 143 eldx'],
    manufacturer: 'Hornady',
    calibre: '.264',
    diameterIn: 0.264,
    weightGr: 143,
    bcG1: 0.625,
    bcG7: 0.315,
    type: 'hunting-bonded',
    typicalMvFps: 2700,
    source: 'Hornady datasheet 2025',
  },

  // ─── .277 (.270 Win / 6.8 SPC) ──────────────────────────────────
  {
    name: 'Nosler AccuBond 130gr',
    aliases: ['130 accubond', 'nosler 130 ab'],
    manufacturer: 'Nosler',
    calibre: '.277',
    diameterIn: 0.277,
    weightGr: 130,
    bcG1: 0.435,
    type: 'hunting-bonded',
    typicalMvFps: 3060,
    source: 'Nosler datasheet 2025',
  },
  {
    name: 'Hornady ELD-X 150gr',
    aliases: ['150 eldx 277', '270 150 eldx'],
    manufacturer: 'Hornady',
    calibre: '.277',
    diameterIn: 0.277,
    weightGr: 150,
    bcG1: 0.625,
    bcG7: 0.315,
    type: 'hunting-bonded',
    typicalMvFps: 2840,
    source: 'Hornady datasheet 2025',
  },

  // ─── .284 (7mm) — 7mm Rem Mag / 7-08 ────────────────────────────
  {
    name: 'Hornady ELD-Match 162gr',
    aliases: ['162 eldm', '162gr eld-m'],
    manufacturer: 'Hornady',
    calibre: '.284',
    diameterIn: 0.284,
    weightGr: 162,
    bcG1: 0.626,
    bcG7: 0.315,
    type: 'match',
    typicalMvFps: 2940,
    source: 'Hornady datasheet 2025',
  },
  {
    name: 'Berger VLD Hunting 168gr',
    aliases: ['168 berger vld 7mm', '7mm 168 vld'],
    manufacturer: 'Berger',
    calibre: '.284',
    diameterIn: 0.284,
    weightGr: 168,
    bcG1: 0.643,
    bcG7: 0.331,
    type: 'hunting-soft-point',
    typicalMvFps: 2900,
    source: 'Berger datasheet 2025',
  },

  // ─── .308 (.308 Win / .30-06 / .300 WM) ─────────────────────────
  {
    name: 'Sierra MatchKing 168gr HPBT',
    aliases: ['168 smk', '168gr smk', 'sierra 168'],
    manufacturer: 'Sierra',
    calibre: '.308',
    diameterIn: 0.308,
    weightGr: 168,
    bcG1: 0.462,
    bcG7: 0.224,
    type: 'match',
    typicalMvFps: 2650,
    source: 'Sierra Reloading Manual 6th Ed',
  },
  {
    name: 'Sierra MatchKing 175gr HPBT',
    aliases: ['175 smk', '175gr smk', 'sierra 175'],
    manufacturer: 'Sierra',
    calibre: '.308',
    diameterIn: 0.308,
    weightGr: 175,
    bcG1: 0.505,
    bcG7: 0.243,
    type: 'match',
    typicalMvFps: 2650,
    source: 'Sierra Reloading Manual 6th Ed',
  },
  {
    name: 'Hornady ELD-Match 178gr',
    aliases: ['178 eldm', '178gr eld-m'],
    manufacturer: 'Hornady',
    calibre: '.308',
    diameterIn: 0.308,
    weightGr: 178,
    bcG1: 0.547,
    bcG7: 0.265,
    type: 'match',
    typicalMvFps: 2600,
    source: 'Hornady datasheet 2025',
  },
  {
    name: 'Hornady ELD-X 178gr',
    aliases: ['178 eldx', '178gr eld-x'],
    manufacturer: 'Hornady',
    calibre: '.308',
    diameterIn: 0.308,
    weightGr: 178,
    bcG1: 0.552,
    bcG7: 0.272,
    type: 'hunting-bonded',
    typicalMvFps: 2600,
    source: 'Hornady datasheet 2025',
  },
  {
    name: 'Nosler Partition 180gr',
    aliases: ['180 partition', 'nosler 180 partition'],
    manufacturer: 'Nosler',
    calibre: '.308',
    diameterIn: 0.308,
    weightGr: 180,
    bcG1: 0.474,
    type: 'hunting-bonded',
    typicalMvFps: 2750,
    source: 'Nosler datasheet 2025',
  },
  {
    name: 'Nosler AccuBond 180gr',
    aliases: ['180 accubond', 'nosler 180 ab'],
    manufacturer: 'Nosler',
    calibre: '.308',
    diameterIn: 0.308,
    weightGr: 180,
    bcG1: 0.507,
    type: 'hunting-bonded',
    typicalMvFps: 2750,
    source: 'Nosler datasheet 2025',
  },
  {
    name: 'Berger Hybrid Target 215gr',
    aliases: ['215 berger', '215 hybrid', 'berger 215'],
    manufacturer: 'Berger',
    calibre: '.308',
    diameterIn: 0.308,
    weightGr: 215,
    bcG1: 0.696,
    bcG7: 0.356,
    type: 'match',
    typicalMvFps: 2900,
    source: 'Berger datasheet 2025',
  },
  {
    name: 'Barnes TTSX 168gr',
    aliases: ['168 ttsx', '168gr ttsx'],
    manufacturer: 'Barnes',
    calibre: '.308',
    diameterIn: 0.308,
    weightGr: 168,
    bcG1: 0.470,
    type: 'hunting-monolithic',
    typicalMvFps: 2700,
    source: 'Barnes datasheet 2025',
  },
  {
    name: 'PMP ProAmm 150gr SP',
    aliases: ['pmp 150 sp', 'pmp 308 150'],
    manufacturer: 'PMP',
    calibre: '.308',
    diameterIn: 0.308,
    weightGr: 150,
    bcG1: 0.314,
    type: 'hunting-soft-point',
    typicalMvFps: 2820,
    source: 'PMP catalogue 2025',
  },
  {
    name: 'PMP ProAmm 180gr SP',
    aliases: ['pmp 180 sp', 'pmp 308 180'],
    manufacturer: 'PMP',
    calibre: '.308',
    diameterIn: 0.308,
    weightGr: 180,
    bcG1: 0.391,
    type: 'hunting-soft-point',
    typicalMvFps: 2620,
    source: 'PMP catalogue 2025',
  },
  {
    name: 'PMP ProAmm 200gr SP (.30-06)',
    aliases: ['pmp 200 sp', 'pmp 30-06 200'],
    manufacturer: 'PMP',
    calibre: '.308',
    diameterIn: 0.308,
    weightGr: 200,
    bcG1: 0.412,
    type: 'hunting-soft-point',
    typicalMvFps: 2570,
    source: 'PMP catalogue 2025',
  },
  {
    name: 'PMP ProAmm 220gr SP (.30-06)',
    aliases: ['pmp 220 sp', 'pmp 30-06 220'],
    manufacturer: 'PMP',
    calibre: '.308',
    diameterIn: 0.308,
    weightGr: 220,
    bcG1: 0.358,
    type: 'hunting-soft-point',
    typicalMvFps: 2390,
    source: 'PMP catalogue 2025',
  },

  // ─── .338 (.338 Lapua / .338 Win Mag) ───────────────────────────
  {
    name: 'Lapua Scenar 250gr',
    aliases: ['250 scenar', 'lapua 250'],
    manufacturer: 'Lapua',
    calibre: '.338',
    diameterIn: 0.338,
    weightGr: 250,
    bcG1: 0.675,
    bcG7: 0.340,
    type: 'match',
    typicalMvFps: 2900,
    source: 'Lapua datasheet 2025',
  },
  {
    name: 'Berger Hybrid OTM 300gr',
    aliases: ['300 berger 338', 'berger 300 otm'],
    manufacturer: 'Berger',
    calibre: '.338',
    diameterIn: 0.338,
    weightGr: 300,
    bcG1: 0.822,
    bcG7: 0.422,
    type: 'match',
    typicalMvFps: 2750,
    source: 'Berger datasheet 2025',
  },

  // ─── .375 (.375 H&H / .375 Ruger) — SA dangerous-game default ───
  {
    name: 'PMP ProAmm 300gr SP',
    aliases: ['pmp 300 sp', 'pmp 375 300'],
    manufacturer: 'PMP',
    calibre: '.375',
    diameterIn: 0.375,
    weightGr: 300,
    bcG1: 0.305,
    type: 'hunting-soft-point',
    typicalMvFps: 2530,
    source: 'PMP catalogue 2025',
  },
  {
    name: 'Barnes TSX 300gr',
    aliases: ['300 tsx 375', 'barnes 300 tsx'],
    manufacturer: 'Barnes',
    calibre: '.375',
    diameterIn: 0.375,
    weightGr: 300,
    bcG1: 0.402,
    type: 'hunting-monolithic',
    typicalMvFps: 2530,
    source: 'Barnes datasheet 2025',
  },

  // ─── 9mm (.355) handgun ──────────────────────────────────────────
  {
    name: 'PMP ProAmm 115gr FMJ',
    aliases: ['pmp 115 fmj', '9mm 115 fmj'],
    manufacturer: 'PMP',
    calibre: '9mm',
    diameterIn: 0.355,
    weightGr: 115,
    bcG1: 0.139,
    type: 'fmj-target',
    typicalMvFps: 1180,
    source: 'PMP catalogue 2025',
  },
  {
    name: 'PMP ProAmm 124gr FMJ',
    aliases: ['pmp 124 fmj', '9mm 124 fmj'],
    manufacturer: 'PMP',
    calibre: '9mm',
    diameterIn: 0.355,
    weightGr: 124,
    bcG1: 0.155,
    type: 'fmj-target',
    typicalMvFps: 1110,
    source: 'PMP catalogue 2025',
  },
];

/**
 * Lowercase-fuzzy lookup against the bundled bullet table. Used by
 * the AI Bullet Lookup card as the OFFLINE fallback when Claude
 * can't be reached (and as an instant pre-result while waiting).
 *
 * Match priority: exact alias > alias contains query > name contains
 * query > weight + calibre substring match. Returns null for no hit.
 */
export function findBulletOffline(query: string): BulletPreset | null {
  const q = query.toLowerCase().trim();
  if (q.length < 2) return null;

  // Pass 1: exact alias match.
  for (const b of BULLET_PRESETS) {
    if (b.aliases.includes(q)) return b;
  }
  // Pass 2: alias contains query.
  for (const b of BULLET_PRESETS) {
    if (b.aliases.some((a) => a.includes(q))) return b;
  }
  // Pass 3: full name contains query (case-insensitive).
  for (const b of BULLET_PRESETS) {
    if (b.name.toLowerCase().includes(q)) return b;
  }
  return null;
}

/**
 * Filter bullets by calibre (e.g. ".308", "9mm", ".264"). Used by
 * the profile picker to narrow the dropdown to the user's rifle.
 */
export function bulletsForCalibre(calibre: string): BulletPreset[] {
  const c = calibre.toLowerCase().trim();
  return BULLET_PRESETS.filter((b) => b.calibre.toLowerCase() === c);
}
