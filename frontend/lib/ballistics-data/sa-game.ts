// frontend/lib/ballistics-data/sa-game.ts
//
// South African game-ethics reference data. Used by the HUNT-mode
// energy / ethical-range overlay so the user can see "you'll have
// 2,800J at 350m — that's above the minimum for kudu but below the
// PHASA recommendation for eland".
//
// Source mix:
//   - PHASA (Professional Hunters' Association of SA) recommended
//     minimum impact energies
//   - SAHGCA (SA Hunters & Game Conservation Assoc) guidance
//   - Operator/community consensus for SA hunting practice
//
// VERIFY: these are starting points for the operator to refine with
// a PHASA member. Numbers are intentionally conservative — better
// to under-shoot at long range than mis-classify an ethical shot.
//
// Energy units: Joules (the ballistics solver outputs Joules; the
// SA hunting press uses ft-lb interchangeably — the unit toggle is
// purely for display).

export type GameClass =
  | 'small-plains'      // duiker, steenbok
  | 'medium-plains'     // springbok, impala, blesbok
  | 'large-plains'      // kudu, gemsbok, blue wildebeest, hartebeest
  | 'very-large'        // eland, sable, roan
  | 'large-dangerous'   // buffalo, hippo
  | 'big-five'          // elephant, rhino (where legal)
  | 'predator-medium'   // jackal, caracal, leopard (where licensed)
  | 'small-vermin';     // baboon, bushpig

export interface GameClassDef {
  key: GameClass;
  label: string;
  examples: string;
  /** Minimum recommended impact energy at the target (Joules). */
  minEnergyJ: number;
  /** PHASA-aligned ideal energy band for clean kills. */
  idealEnergyJ: number;
  /** Common SA hunting calibres for this class (informational). */
  typicalCalibres: string;
  /** Operator-editable note shown on the energy chip. */
  notes?: string;
}

export const GAME_CLASSES: GameClassDef[] = [
  {
    key: 'small-plains',
    label: 'Small plains game',
    examples: 'duiker, steenbok, klipspringer',
    minEnergyJ: 800,
    idealEnergyJ: 1200,
    typicalCalibres: '.222 Rem, .223 Rem, .22-250',
  },
  {
    key: 'medium-plains',
    label: 'Medium plains game',
    examples: 'springbok, impala, blesbok, mountain reedbuck',
    minEnergyJ: 1500,
    idealEnergyJ: 2000,
    typicalCalibres: '.243 Win, 6.5 CM, .270 Win',
  },
  {
    key: 'large-plains',
    label: 'Large plains game',
    examples: 'kudu, gemsbok, blue wildebeest, hartebeest, waterbuck',
    minEnergyJ: 2700,
    idealEnergyJ: 3500,
    typicalCalibres: '.308 Win, .30-06, .300 WM, 7mm Rem Mag',
  },
  {
    key: 'very-large',
    label: 'Very large plains game',
    examples: 'eland, sable, roan, black wildebeest',
    minEnergyJ: 3500,
    idealEnergyJ: 4500,
    typicalCalibres: '.300 WM, .338 Win Mag, .375 H&H',
    notes: 'PHASA advises calibre legal-minimum varies by province.',
  },
  {
    key: 'large-dangerous',
    label: 'Large dangerous game',
    examples: 'buffalo, hippo (where applicable)',
    minEnergyJ: 5400,
    idealEnergyJ: 6800,
    typicalCalibres: '.375 H&H (legal minimum), .416 Rem, .458 Lott',
    notes: 'Legally requires ≥ .375 H&H per Firearms Control Act regs.',
  },
  {
    key: 'big-five',
    label: 'Big Five (elephant / rhino)',
    examples: 'elephant, rhino (regulated hunts only)',
    minEnergyJ: 6800,
    idealEnergyJ: 9000,
    typicalCalibres: '.416 Rem, .458 Lott, .500 NE',
    notes:
      'Strict regulation. Always defer to PH on calibre/load selection.',
  },
  {
    key: 'predator-medium',
    label: 'Medium predators',
    examples: 'jackal, caracal, leopard (licensed)',
    minEnergyJ: 1200,
    idealEnergyJ: 2000,
    typicalCalibres: '.223 Rem (jackal), .243 / 6.5 CM (cat)',
    notes: 'Leopard requires province-specific permit + PH.',
  },
  {
    key: 'small-vermin',
    label: 'Vermin / problem animals',
    examples: 'baboon, bushpig',
    minEnergyJ: 1500,
    idealEnergyJ: 2500,
    typicalCalibres: '.243 Win, .308 Win',
  },
];

/** Classify a given impact energy against the SA game-ethics bands. */
export type EnergyVerdict =
  | 'under-minimum'
  | 'marginal'
  | 'ethical'
  | 'over-spec';

export function classifyEnergyForGame(
  energyJ: number,
  game: GameClass,
): EnergyVerdict {
  const def = GAME_CLASSES.find((g) => g.key === game);
  if (!def) return 'marginal';
  if (energyJ < def.minEnergyJ * 0.9) return 'under-minimum';
  if (energyJ < def.minEnergyJ) return 'marginal';
  if (energyJ < def.idealEnergyJ * 2.5) return 'ethical';
  return 'over-spec';
}

/**
 * Reverse lookup — given a current load, what's the max range you
 * still have enough energy for a given game class? Used by the
 * HUNT-mode "max ethical range" chip.
 *
 * Caller passes a sorted ranges→energy table (the calculator already
 * computes this). We walk it to find the longest range where the
 * energy still meets the minimum threshold.
 */
export function maxEthicalRangeM(
  rangeEnergyTable: Array<{ rangeM: number; energyJ: number }>,
  game: GameClass,
): number | null {
  const def = GAME_CLASSES.find((g) => g.key === game);
  if (!def) return null;
  let max = 0;
  for (const row of rangeEnergyTable) {
    if (row.energyJ >= def.minEnergyJ && row.rangeM > max) {
      max = row.rangeM;
    }
  }
  return max > 0 ? max : null;
}
