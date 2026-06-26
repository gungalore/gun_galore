/**
 * Internal-ballistics engine — lumped-parameter interior-ballistics solver.
 *
 * State vector y = [z, l, v]:
 *   z = fraction of propellant burnt (0..1) — also the mass fraction ψ
 *   l = projectile travel from rest (m)
 *   v = projectile velocity (m/s)
 *
 * Pressure P is ALGEBRAIC (computed each step from the energy equation),
 * not a state — the standard lumped-parameter formulation, which keeps the
 * integrator stable.
 *
 * Burn rate — GRT's REAL law: the L01..L09 values are burn-rate coefficients
 * in 1/(bar·s) sampled at z = 0.1..0.9 (confirmed from GRT's ValueUnits
 * config). So:
 *     dz/dt = kBurn · L(z) · P[bar]
 * The tabulated L-curve already encodes how the burning surface evolves, so
 * no separate form function is needed and no large scale fudge: kBurn ≈ 1.
 *
 * Free gas volume:               V = V0 + A·l − C·(1−ψ)/ρ_p − C·ψ·η
 * Pressure (Resal / Noble-Abel): P = (k−1)·[ψ·C·Qex_eff − ½·m_eff·v²] / V
 * Projectile EOM:                m_eff·dv/dt = A·P   (after shot-start)
 *
 * Integrated with RK4 at a fixed step (default 1 µs). Uncertain modelling
 * choices live in IbCalib so the GRT benchmark tunes GLOBAL knobs only.
 */
import {
  BAR_TO_PA,
  CM3_TO_M3,
  CM3G_TO_M3KG,
  DEFAULT_CALIB,
  GR_TO_KG,
  IbCalib,
  IbCurvePoint,
  IbLoad,
  IbPowder,
  IbResult,
  KJKG_TO_JKG,
  MM_TO_M,
  MM2_TO_M2,
  MPS_TO_FPS,
  PA_TO_BAR,
} from './ib-types';

/** SI snapshot of a load + powder, precomputed once per solve. */
interface SiModel {
  V0: number; // initial gas volume (m³)
  A: number; // bore area (m²)
  L: number; // travel (m)
  m: number; // projectile mass (kg)
  C: number; // charge mass (kg)
  ps: number; // shot-start / ignition pressure (Pa)
  mEff: number; // m + lagrange·C
  QexEff: number; // specific energy after Sebert heat loss (J/kg)
  QexFull: number; // full chemical specific energy (J/kg) — for efficiency
  k: number;
  eta: number; // covolume (m³/kg)
  rhoP: number; // solid powder density (kg/m³)
  Lcurve: number[]; // burn-rate coeffs 1/(bar·s) at z = 0.1..0.9
}

/**
 * Burn-rate coefficient L (1/(bar·s)) at fractional burn z, interpolating
 * GRT's 9-point curve (sampled at z = 0.1..0.9). Clamps to the end samples
 * outside that range.
 */
function lOf(z: number, L: number[]): number {
  if (z <= 0.1) return L[0];
  if (z >= 0.9) return L[8];
  const idx = z * 10 - 1; // z=0.1 → 0, z=0.9 → 8
  const i = Math.floor(idx);
  const f = idx - i;
  return L[i] + f * (L[i + 1] - L[i]);
}

function toSi(load: IbLoad, powder: IbPowder, calib: IbCalib): SiModel {
  const m = load.projectileMassGr * GR_TO_KG;
  const C = load.chargeMassGr * GR_TO_KG;
  const sebert = load.sebert ?? 0.5;
  // Loading density (g/cm³) = charge mass / initial gas volume. Drives the
  // loading-density heat-loss correction: a packed case (high LD) loses less
  // heat per unit energy → higher pressure; a light fill loses more.
  const loadDensityGCm3 =
    load.initialGasVolumeCm3 > 0
      ? load.chargeMassGr * 0.06479891 / load.initialGasVolumeCm3
      : calib.ldRefGCm3;
  const ldFactor = 1 + calib.ldSlope * (calib.ldRefGCm3 - loadDensityGCm3);
  // Effective heat-loss fraction, clamped to a sane range.
  let heatFrac = calib.sebertScale * sebert * ldFactor;
  if (heatFrac < 0) heatFrac = 0;
  if (heatFrac > 0.6) heatFrac = 0.6;
  return {
    V0: load.initialGasVolumeCm3 * CM3_TO_M3,
    A: load.boreAreaMm2 * MM2_TO_M2,
    L: load.travelMm * MM_TO_M,
    m,
    C,
    ps: (load.shotStartBar ?? 250) * BAR_TO_PA,
    mEff: m + calib.lagrange * C,
    QexEff: powder.Qex * KJKG_TO_JKG * (1 - heatFrac),
    QexFull: powder.Qex * KJKG_TO_JKG,
    k: powder.k,
    eta: powder.eta * CM3G_TO_M3KG,
    rhoP: powder.pc,
    Lcurve: powder.L,
  };
}

/** Pressure (Pa) at a given state — the algebraic energy equation. */
function pressureOf(z: number, l: number, v: number, s: SiModel): number {
  const psi = z <= 0 ? 0 : z >= 1 ? 1 : z; // mass fraction = burn fraction
  // Free gas volume: chamber + swept bore − unburnt solid − gas covolume.
  const vFree =
    s.V0 + s.A * l - (s.C * (1 - psi)) / s.rhoP - s.C * psi * s.eta;
  if (vFree <= 1e-9) return 0;
  const chem = psi * s.C * s.QexEff;
  const ke = 0.5 * s.mEff * v * v;
  const p = ((s.k - 1) * (chem - ke)) / vFree;
  return p > 0 ? p : 0;
}

/** Derivatives [dz, dl, dv] at a state. */
function derivs(
  z: number,
  l: number,
  v: number,
  s: SiModel,
  calib: IbCalib,
): [number, number, number] {
  const p = pressureOf(z, l, v, s);
  // Burn rate (GRT's L-curve law, pressure-linear). Ignition bootstrap: the
  // primer pressurises the case to the initial pressure (GRT `gpressure`/`ps`),
  // which lights the powder (without a floor, ψ=0 → P=0 → dz=0 forever).
  const pBurnBar = (p + s.ps) * PA_TO_BAR;
  // GRT's L-curve law is pressure-linear (L·P). The Vieille exponent applies a
  // sub-linear correction anchored at pNormBar so burnExp=1 ⇒ exactly L·P.
  const expFactor =
    calib.burnExp === 1
      ? 1
      : Math.pow(pBurnBar / calib.pNormBar, calib.burnExp - 1);
  const dz = z < 1 ? calib.kBurn * lOf(z, s.Lcurve) * pBurnBar * expFactor : 0;
  // Projectile motion: held until pressure overcomes shot-start, then the gas
  // accelerates it. (Engraving/friction folded into shot-start for the PoC.)
  const moving = v > 0 || p >= s.ps;
  if (!moving) return [dz, 0, 0];
  const dv = (s.A * p) / s.mEff;
  return [dz, v, dv];
}

export function solveInternalBallistics(
  load: IbLoad,
  powder: IbPowder,
  calibOverride?: Partial<IbCalib>,
): IbResult {
  const calib: IbCalib = { ...DEFAULT_CALIB, ...calibOverride };
  const s = toSi(load, powder, calib);
  const warnings: string[] = [];

  let z = 0;
  let l = 0;
  let v = 0;
  let t = 0;
  let pMax = 0;
  const dt = calib.dt;
  const curve: IbCurvePoint[] = [];
  const maxSteps = Math.ceil(calib.maxTimeS / dt);
  const sampleEvery = Math.max(1, Math.round(maxSteps / 400)); // ≤~400 pts
  let step = 0;

  while (l < s.L && step < maxSteps) {
    const p = pressureOf(z, l, v, s);
    if (p > pMax) pMax = p;
    if (step % sampleEvery === 0) {
      curve.push({
        tMs: t * 1000,
        pressureBar: p * PA_TO_BAR,
        velocityFps: v * MPS_TO_FPS,
        travelMm: l / MM_TO_M,
      });
    }

    // RK4 on [z, l, v].
    const k1 = derivs(z, l, v, s, calib);
    const k2 = derivs(
      z + (k1[0] * dt) / 2,
      l + (k1[1] * dt) / 2,
      v + (k1[2] * dt) / 2,
      s,
      calib,
    );
    const k3 = derivs(
      z + (k2[0] * dt) / 2,
      l + (k2[1] * dt) / 2,
      v + (k2[2] * dt) / 2,
      s,
      calib,
    );
    const k4 = derivs(z + k3[0] * dt, l + k3[1] * dt, v + k3[2] * dt, s, calib);
    z += ((k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) * dt) / 6;
    l += ((k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) * dt) / 6;
    v += ((k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]) * dt) / 6;
    if (z > 1) z = 1;
    t += dt;
    step += 1;
  }

  const psiExit = z <= 0 ? 0 : z >= 1 ? 1 : z;
  const pMuzzle = pressureOf(z, Math.min(l, s.L), v, s);
  const muzzleEnergyJ = 0.5 * s.m * v * v;
  const efficiency = muzzleEnergyJ / (s.C * s.QexFull || 1);

  if (step >= maxSteps && l < s.L) {
    warnings.push(
      'Projectile did not reach the muzzle within the time cap — possible squib / non-ignition.',
    );
  }
  if (psiExit < 0.95) {
    warnings.push(
      `Incomplete burn: ${(psiExit * 100).toFixed(0)}% of powder consumed at muzzle.`,
    );
  }

  return {
    pMaxBar: pMax * PA_TO_BAR,
    vMuzzleMps: v,
    vMuzzleFps: v * MPS_TO_FPS,
    pMuzzleBar: pMuzzle * PA_TO_BAR,
    barrelTimeMs: t * 1000,
    fractionBurnt: psiExit,
    muzzleEnergyJ,
    efficiency,
    curve,
    warnings,
  };
}
