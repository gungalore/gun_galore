// Load Lab — shared TypeScript types for the PRO-gated internal/external
// ballistics surface on the Ask GG page. Mirrors the backend
// LoadLabResult contract from POST {API_URL}/load-lab/compute exactly.
//
// The panel calls /compute directly and renders <LoadLabResultCard> with
// the result. These types are the single source of truth shared by the
// hook, the card, and every chart/table sub-component.

/** Hunter = simple "is this load good + supersonic to where" surface.
 *  Competition = full internal-ballistics + DOPE + charge-ladder surface. */
export type LoadLabMode = 'hunter' | 'competition';

// ─── /load-lab/search result rows ───────────────────────────────────

export interface LoadLabCartridgeHit {
  id: number;
  name: string;
  boreAreaMm2: number;
  caseVolGrH2O: number;
  pMaxBar: number;
  grooveMm: number;
}

export interface LoadLabBulletHit {
  id: number;
  maker: string;
  name: string;
  caliber: string;
  diameterMm: number;
  weightGr: number;
  lengthMm: number;
  g1bc: number;
  g7bc: number;
}

export interface LoadLabPowderHit {
  id: number;
  maker: string;
  name: string;
  lot: string;
  qlty: number;
}

/** Discriminated by `kind` at the call site — the search endpoint returns
 *  one of these arrays depending on the requested kind. */
export type LoadLabSearchHit =
  | LoadLabCartridgeHit
  | LoadLabBulletHit
  | LoadLabPowderHit;

export type LoadLabComponentKind = 'cartridge' | 'bullet' | 'powder';

// ─── /load-lab/compute request ──────────────────────────────────────

export interface LoadLabComputeInput {
  /** The cartridge `name` (NOT id) — the backend keys compute on name. */
  cartridge: string;
  bulletId: number;
  powderName: string;
  powderMaker?: string;
  chargeGr: number;
  barrelLengthIn: number;
  coalMm?: number;
  caseVolGrH2O?: number;
  zeroM?: number;
  sightHeightCm?: number;
  tempC?: number;
  pressureHpa?: number;
  altitudeM?: number;
  windSpeedMps?: number;
  windDirectionDeg?: number;
  ladder?: { steps: number; stepGr: number };
}

// ─── /load-lab/compute response ─────────────────────────────────────

/** Returned when a non-PRO user hits /compute. The panel swaps the
 *  result card for an upgrade nudge instead. */
export interface LoadLabUpgradeRequired {
  upgradeRequired: true;
  reason: string;
}

export interface LoadLabResult {
  inputs: {
    cartridge: string;
    bullet: string;
    powder: string;
    chargeGr: number;
    barrelLengthIn: number;
  };
  geometry: {
    initialGasVolumeCm3: number;
    boreAreaMm2: number;
    travelMm: number;
    caseVolGrH2O: number;
    bcG1: number;
  };
  internal: {
    pMaxBar: number;
    vMuzzleFps: number;
    vMuzzleMps: number;
    pMuzzleBar: number;
    barrelTimeMs: number;
    percentBurnt: number;
    efficiencyPct: number;
    muzzleEnergyJ: number;
    curve: { tMs: number; pressureBar: number; velocityFps: number }[];
  };
  external: {
    rows: {
      rangeM: number;
      dropCm: number;
      dropMoa: number;
      dropMil: number;
      velocityFps: number;
      energyJoules: number;
      timeOfFlightS: number;
      windageCm: number;
      windageMoa: number;
      windageMil: number;
    }[];
    supersonicRangeM: number;
    transonicRangeM: number;
  } | null;
  ladder: {
    chargeGr: number;
    vMuzzleFps: number;
    pMaxBar: number;
    pctOfMax: number;
  }[];
  safety: {
    advisoryOnly: true;
    pressureCeilingBar: number;
    pctOfCeiling: number;
    overPressure: boolean;
    nearMax: boolean;
  };
  warnings: string[];
}

/** The discriminated union the compute call resolves to. Narrow on the
 *  `upgradeRequired` key before touching result fields. */
export type LoadLabComputeResponse = LoadLabResult | LoadLabUpgradeRequired;

export function isUpgradeRequired(
  r: LoadLabComputeResponse,
): r is LoadLabUpgradeRequired {
  return (r as LoadLabUpgradeRequired).upgradeRequired === true;
}

/** Convenience row aliases the charts/tables consume. */
export type LoadLabExternalRow = NonNullable<
  LoadLabResult['external']
>['rows'][number];
export type LoadLabCurvePoint = LoadLabResult['internal']['curve'][number];
export type LoadLabLadderRung = LoadLabResult['ladder'][number];
