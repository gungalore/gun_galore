/**
 * Internal-ballistics engine — types + unit conversions.
 *
 * The engine is a lumped-parameter (vivacity / Sebert / Resal-energy)
 * interior-ballistics model. It is PURE math — no Nest, DB, or HTTP deps —
 * so it can be unit-tested, benchmarked against GRT offline, and later
 * ported byte-for-byte to the frontend (the BC-3 pattern).
 *
 * All physics runs in SI; callers pass practical reloader units (grains,
 * mm, bar, cm³, kJ/kg, cm³/kg) and the helpers below convert at the
 * boundary — exactly how ballistics.service.ts handles fps/grains.
 *
 * NOTE ON COEFFICIENTS: the powder burn coefficients come straight from
 * Gordon's Reloading Tool's data (Ba, Bp, Qex, k, eta, a0/a1, z1/z2,
 * pc, the 9-point L01..L09 form curve). GRT's exact burn-rate
 * normalisation is under-documented; the engine isolates every uncertain
 * choice into `IbCalib` so the GRT benchmark can tune a handful of GLOBAL
 * knobs (never per-powder fudge factors) to match GRT's outputs.
 */

// ─── Unit conversions ───────────────────────────────────────────────
export const GR_TO_KG = 0.00006479891;
export const KG_TO_GR = 1 / GR_TO_KG;
export const MM_TO_M = 0.001;
export const MM2_TO_M2 = 1e-6;
export const CM3_TO_M3 = 1e-6;
export const BAR_TO_PA = 1e5;
export const PA_TO_BAR = 1 / BAR_TO_PA;
export const KJKG_TO_JKG = 1000;
/** GRT stores covolume eta in cm³/g (NOT cm³/kg — confirmed from GRT's
 *  ValueUnits config). 1 cm³/g = 1e-3 m³/kg. */
export const CM3G_TO_M3KG = 1e-3;
export const MPS_TO_FPS = 1 / 0.3048;
/** grains of water → cm³ (1 gr H₂O = 0.06479891 g ≈ 0.06486 cm³ at 4 °C). */
export const GRH2O_TO_CM3 = 0.0647989;

// ─── Powder model (raw GRT coefficients the engine consumes) ─────────
export interface IbPowder {
  /** Display name, e.g. "N540". */
  name: string;
  /** Vivacity / combustion coefficient (master burn-rate gain). */
  Ba: number;
  /** Burn-rate pressure exponent. */
  Bp: number;
  /** Specific explosive heat (kJ/kg). */
  Qex: number;
  /** Ratio of specific heats of the gas. */
  k: number;
  /** Covolume of the powder gas (cm³/kg). */
  eta: number;
  /** Solid (material) density of the powder (kg/m³). */
  pc: number;
  /** Form-function progressivity coefficients. */
  a0: number;
  a1: number;
  /** Burn-up transition limits. */
  z1: number;
  z2: number;
  /** 9-point empirical form/burning-surface curve at z = 0.1..0.9. */
  L: number[]; // length 9
}

// ─── Load (the shot being simulated) ────────────────────────────────
/** Practical-unit load description; converted to SI inside the engine. */
export interface IbLoad {
  /** Gas space behind the seated bullet at rest (cm³) = effective case
   *  volume. If not known, derive from case capacity − bullet intrusion. */
  initialGasVolumeCm3: number;
  /** Effective bore area (mm²) — GRT cartridge `c_Q`. */
  boreAreaMm2: number;
  /** Projectile travel to the muzzle (mm) — GRT "projectile path". */
  travelMm: number;
  /** Projectile mass (grains). */
  projectileMassGr: number;
  /** Charge mass (grains). */
  chargeMassGr: number;
  /** Shot-start pressure (bar) — GRT `gpressure`, default 250. */
  shotStartBar?: number;
  /** Sebert heat-loss factor for the cartridge (GRT `sebert`, ~0.5). */
  sebert?: number;
}

// ─── Calibration knobs (GLOBAL only — tuned against the GRT oracle) ──
export interface IbCalib {
  /** Global burn-rate multiplier (sets burn timing / %burnt). */
  kBurn: number;
  /** Reference pressure for the burn-rate exponent base (Pa). */
  pRef: number;
  /** Lagrange gas-inertia factor: m_eff = m + lagrange·C. */
  lagrange: number;
  /** Fraction of chemical energy lost to the barrel (Sebert), scaled by
   *  the cartridge sebert factor: heatLoss = sebertScale·sebert. */
  sebertScale: number;
  /** Vieille burn-rate pressure exponent. GRT's L-curve is pressure-linear
   *  (n=1); real burn is sub-linear (n≈0.85), which suppresses fast-powder
   *  peaks and lifts slow-powder peaks. Applied relative to pNormBar so n=1
   *  reproduces the pure L·P law exactly. */
  burnExp: number;
  /** Reference pressure (bar) the exponent is anchored to (≈ typical peak). */
  pNormBar: number;
  /** Integration time step (s). */
  dt: number;
  /** Hard cap on simulated time (s) — squib / runaway guard. */
  maxTimeS: number;
}

export const DEFAULT_CALIB: IbCalib = {
  // Burn law is dz/dt = kBurn · L(z) · P[bar], where the L01..L09 curve is
  // already in 1/(bar·s) (GRT's real burn-rate coefficients). So kBurn is a
  // fine-tuning multiplier around 1.0 — the L-curve sets the physical scale.
  // Global fit from the full GRT benchmark (56 realistic loads, calibrate/
  // holdout) with the Vieille exponent: velocity median ~1.0%, core rifle
  // powders (Ba 0.4-0.6) Pmax within ~1%. One global set across cartridges.
  kBurn: 1.025,
  pRef: 1e8, // unused by the L-curve burn law; kept for experiments
  lagrange: 1 / 3,
  sebertScale: 0.225,
  burnExp: 0.86, // Vieille pressure exponent (sub-linear burn)
  pNormBar: 3000,
  dt: 1e-6,
  maxTimeS: 0.02,
};

// ─── Result ─────────────────────────────────────────────────────────
export interface IbCurvePoint {
  tMs: number;
  pressureBar: number;
  velocityFps: number;
  travelMm: number;
}

export interface IbResult {
  pMaxBar: number;
  vMuzzleMps: number;
  vMuzzleFps: number;
  pMuzzleBar: number;
  barrelTimeMs: number;
  /** Fraction of propellant burnt at muzzle exit (0..1). */
  fractionBurnt: number;
  muzzleEnergyJ: number;
  /** Effective efficiency = projectile KE / total chemical energy. */
  efficiency: number;
  curve: IbCurvePoint[];
  warnings: string[];
}
