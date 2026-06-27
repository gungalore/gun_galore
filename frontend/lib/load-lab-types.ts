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
    seatingDepthMm: number;
    bcG1: number;
  };
  load: {
    caseWaterGrH2O: number;
    caseFillPct: number;
    loadingDensityGCm3: number;
    compressed: boolean;
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
    /** Raw engine peak pressure as a % of ceiling — an ESTIMATE that can read
     *  low; never the basis for a safety call on its own. */
    pctOfCeiling: number;
    /** Engine peak inflated by the known under-call margin — what the verdict
     *  is computed against. */
    pMaxConservativeBar: number;
    pctOfCeilingConservative: number;
    /** Upward pad applied to the estimate for the safety verdict (%). */
    estimateUncertaintyPct: number;
    overPressure: boolean;
    nearMax: boolean;
  };
  warnings: string[];
}

/** The discriminated union the compute call resolves to. Narrow on the
 *  `upgradeRequired` key before touching result fields. */
export type LoadLabComputeResponse = LoadLabResult | LoadLabUpgradeRequired;

// ─── Recommended loads (published manual data) ──────────────────────

/** One published load quoted from a manual, for the right-hand panel. */
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
  /** Suggested work-up increment (gr) + number of charges start→max. */
  incrementGr: number;
  steps: number;
  /**
   * True when the manual publishes a MAXIMUM charge only (ADI/Hodgdon/IMR).
   * startGr is then a derived −10% ladder start, not a published start.
   */
  singleCharge: boolean;
  coalMm: number | null;
  primer: string | null;
  /** "Vihtavuori — Reloading Guide (2023)" */
  manual: string;
  pageNumber: number;
  /** How many distinct manuals publish this powder for this load — popularity. */
  manualCount: number;
}

export interface RecommendedLoadsResult {
  cartridge: string;
  bulletWeightGr: number;
  toleranceGr: number;
  /** True when no manual data has been indexed for this cartridge yet. */
  notIndexed: boolean;
  powders: RecommendedLoadRow[];
  /** Distinct manuals the rows came from. */
  sources: string[];
}

export type RecommendedLoadsResponse =
  | RecommendedLoadsResult
  | LoadLabUpgradeRequired;

export function isUpgradeRequired(
  r: LoadLabComputeResponse | RecommendedLoadsResponse,
): r is LoadLabUpgradeRequired {
  return (r as LoadLabUpgradeRequired).upgradeRequired === true;
}

/** Convenience row aliases the charts/tables consume. */
export type LoadLabExternalRow = NonNullable<
  LoadLabResult['external']
>['rows'][number];
export type LoadLabCurvePoint = LoadLabResult['internal']['curve'][number];
export type LoadLabLadderRung = LoadLabResult['ladder'][number];
