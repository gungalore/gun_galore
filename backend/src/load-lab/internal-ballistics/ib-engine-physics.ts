/**
 * FIRST-PRINCIPLES interior-ballistics engine — VALIDATED CROSS-CHECK, NOT the
 * production engine. The live Load Lab uses the empirical ib-engine.ts (better
 * match to GRT's own empirical model). This module is the physically-derived
 * alternative kept for cross-checking and future work.
 *
 * It replaces every global heat-loss fudge with the real convective heat-loss
 * term from the US Army IBHVG2 code (Nordheim/Soodak Reynolds analogy, eqs.
 * D.17–D.20):
 *     dQ/dt = φ_h · h · S(t) · (T_gas − T_wall)
 *     h     = f_fric · c_p · ρ_m · v_m + h0          (D.19)
 *     f_fric= 1 / (13.2 + 4·log10(Re))²              (D.20, Re = ρ_m·v_m·D_b/μ)
 *     S(t)  = A_chamber + π·D_b·l                     (D.18, wetted area grows)
 * Heat loss EMERGES from gas density × velocity × growing surface — no per-
 * cartridge tuning. Gas temperature is tracked from the real energy balance.
 * The ONLY calibration knob is φ_h (the heat-transfer multiplier real IB codes
 * keep); kBurn and lagrange are physical.
 *
 * Result on the deep cross-cartridge oracle (.223/6.5CM/.30-06, fitted
 * kBurn≈1.025, φ_h≈2.9): velocity ~3.3% median, Pmax ~10% median. It is more
 * principled (one physical knob) and generalises to any cartridge, but is ~2-3
 * points LESS accurate against GRT than the empirical fit — because GRT is
 * itself an empirically-fitted model. φ_h≈2.9 (not ~1.3) because the lumped
 * Nordheim form was derived for cannon bores; small-arms bores lose more heat.
 *
 * State y = [z, l, v, Q] (Q = cumulative wall heat loss, J). Pressure is
 * algebraic each step. RK4 fixed step.
 */
import {
  BAR_TO_PA,
  CM3_TO_M3,
  CM3G_TO_M3KG,
  GR_TO_KG,
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

// ─── Physical constants (from the IB literature, NOT fitted to GRT) ──
const R_GAS = 346; // J/(kg·K) specific gas constant (M̄≈24 g/mol)
const T_WALL = 293; // K bore wall (≈const over the ~1 ms shot, IBHVG2 TWAL)
const T_REF = 293.15; // K initial propellant temp
const H0 = 0.8406; // W/(m²·K) natural-convection floor (IBHVG2 HO → SI)
const MU_REF = 9.0e-5; // Pa·s gas viscosity at the reference temperature
const T_MU_REF = 3000; // K
const MU_N = 0.65; // viscosity temperature exponent: μ ∝ T^MU_N

/** Calibration for the physics engine — kBurn + lagrange are physical, φ_h is
 *  the single heat-transfer multiplier. */
export interface PhysicsCalib {
  kBurn: number;
  lagrange: number;
  phiH: number;
  dt: number;
  maxTimeS: number;
}

export const DEFAULT_PHYSICS_CALIB: PhysicsCalib = {
  kBurn: 1.025,
  lagrange: 1 / 3,
  phiH: 2.9, // fitted to the deep oracle; high because Nordheim ~ cannon bores
  dt: 1e-6,
  maxTimeS: 0.02,
};

interface SiModel {
  V0: number;
  A: number;
  L: number;
  m: number;
  C: number;
  ps: number;
  mEff: number;
  Qex: number;
  k: number;
  eta: number;
  rhoP: number;
  Lcurve: number[];
  cv: number;
  cp: number;
  Tflame: number;
  Db: number;
  Achamber: number;
}

function lOf(z: number, L: number[]): number {
  if (z <= 0.1) return L[0];
  if (z >= 0.9) return L[8];
  const idx = z * 10 - 1;
  const i = Math.floor(idx);
  const f = idx - i;
  return L[i] + f * (L[i + 1] - L[i]);
}

function toSi(load: IbLoad, powder: IbPowder, calib: PhysicsCalib): SiModel {
  const m = load.projectileMassGr * GR_TO_KG;
  const C = load.chargeMassGr * GR_TO_KG;
  const A = load.boreAreaMm2 * MM2_TO_M2;
  const V0 = load.initialGasVolumeCm3 * CM3_TO_M3;
  const Qex = powder.Qex * KJKG_TO_JKG;
  const k = powder.k;
  const cv = R_GAS / (k - 1);
  const cp = k * cv;
  const Tflame = T_REF + Qex / cv;
  const Db = Math.sqrt((4 * A) / Math.PI);
  const Achamber = Math.PI * Db * (V0 / A) + A;
  return {
    V0,
    A,
    L: load.travelMm * MM_TO_M,
    m,
    C,
    ps: (load.shotStartBar ?? 250) * BAR_TO_PA,
    mEff: m + calib.lagrange * C,
    Qex,
    k,
    eta: powder.eta * CM3G_TO_M3KG,
    rhoP: powder.pc,
    Lcurve: powder.L,
    cv,
    cp,
    Tflame,
    Db,
    Achamber,
  };
}

function gasVolOf(l: number, psi: number, s: SiModel): number {
  return s.V0 + s.A * l - (s.C * (1 - psi)) / s.rhoP;
}
function freeVolOf(l: number, psi: number, s: SiModel): number {
  return gasVolOf(l, psi, s) - s.C * psi * s.eta;
}
function pressureOf(z: number, l: number, v: number, Q: number, s: SiModel): number {
  const psi = z <= 0 ? 0 : z >= 1 ? 1 : z;
  const vFree = freeVolOf(l, psi, s);
  if (vFree <= 1e-9) return 0;
  const p = ((s.k - 1) * (psi * s.C * s.Qex - 0.5 * s.mEff * v * v - Q)) / vFree;
  return p > 0 ? p : 0;
}
function gasTempOf(z: number, v: number, Q: number, s: SiModel): number {
  const psi = z <= 0 ? 0 : z >= 1 ? 1 : z;
  const mg = psi * s.C;
  if (mg < 1e-9) return s.Tflame;
  let T = T_REF + (psi * s.C * s.Qex - 0.5 * s.mEff * v * v - Q) / (mg * s.cv);
  if (T > s.Tflame) T = s.Tflame;
  if (T < T_WALL) T = T_WALL;
  return T;
}
function heatLossRate(
  z: number,
  l: number,
  v: number,
  Q: number,
  s: SiModel,
  calib: PhysicsCalib,
): number {
  const psi = z <= 0 ? 0 : z >= 1 ? 1 : z;
  const mg = psi * s.C;
  if (mg < 1e-9) return 0;
  const vGas = gasVolOf(l, psi, s);
  if (vGas <= 1e-9) return 0;
  const Tgas = gasTempOf(z, v, Q, s);
  const dT = Tgas - T_WALL;
  if (dT <= 0) return 0;
  const rhoM = mg / vGas;
  const vM = (v > 0 ? v : 0) / 2;
  const mu = MU_REF * Math.pow(Tgas / T_MU_REF, MU_N);
  const Re = Math.max((rhoM * vM * s.Db) / mu, 10);
  const fFric = 1 / Math.pow(13.2 + 4 * Math.log10(Re), 2);
  const h = calib.phiH * (fFric * s.cp * rhoM * vM) + H0;
  const S = s.Achamber + Math.PI * s.Db * l;
  const dQ = h * S * dT;
  return dQ > 0 ? dQ : 0;
}
function derivs(
  z: number,
  l: number,
  v: number,
  Q: number,
  s: SiModel,
  calib: PhysicsCalib,
): [number, number, number, number] {
  const p = pressureOf(z, l, v, Q, s);
  const pBurnBar = (p + s.ps) * PA_TO_BAR;
  const dz = z < 1 ? calib.kBurn * lOf(z, s.Lcurve) * pBurnBar : 0;
  const dQ = heatLossRate(z, l, v, Q, s, calib);
  const moving = v > 0 || p >= s.ps;
  if (!moving) return [dz, 0, 0, dQ];
  const dv = (s.A * p) / s.mEff;
  return [dz, v, dv, dQ];
}

export function solveInternalBallisticsPhysics(
  load: IbLoad,
  powder: IbPowder,
  calibOverride?: Partial<PhysicsCalib>,
): IbResult {
  const calib: PhysicsCalib = { ...DEFAULT_PHYSICS_CALIB, ...calibOverride };
  const s = toSi(load, powder, calib);
  const warnings: string[] = [];

  let z = 0;
  let l = 0;
  let v = 0;
  let Q = 0;
  let t = 0;
  let pMax = 0;
  const dt = calib.dt;
  const curve: IbCurvePoint[] = [];
  const maxSteps = Math.ceil(calib.maxTimeS / dt);
  const sampleEvery = Math.max(1, Math.round(maxSteps / 400));
  let step = 0;

  while (l < s.L && step < maxSteps) {
    const p = pressureOf(z, l, v, Q, s);
    if (p > pMax) pMax = p;
    if (step % sampleEvery === 0) {
      curve.push({
        tMs: t * 1000,
        pressureBar: p * PA_TO_BAR,
        velocityFps: v * MPS_TO_FPS,
        travelMm: l / MM_TO_M,
      });
    }
    const k1 = derivs(z, l, v, Q, s, calib);
    const k2 = derivs(z + (k1[0] * dt) / 2, l + (k1[1] * dt) / 2, v + (k1[2] * dt) / 2, Q + (k1[3] * dt) / 2, s, calib);
    const k3 = derivs(z + (k2[0] * dt) / 2, l + (k2[1] * dt) / 2, v + (k2[2] * dt) / 2, Q + (k2[3] * dt) / 2, s, calib);
    const k4 = derivs(z + k3[0] * dt, l + k3[1] * dt, v + k3[2] * dt, Q + k3[3] * dt, s, calib);
    z += ((k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) * dt) / 6;
    l += ((k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) * dt) / 6;
    v += ((k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]) * dt) / 6;
    Q += ((k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]) * dt) / 6;
    if (z > 1) z = 1;
    if (Q < 0) Q = 0;
    t += dt;
    step += 1;
  }

  const psiExit = z <= 0 ? 0 : z >= 1 ? 1 : z;
  const pMuzzle = pressureOf(z, Math.min(l, s.L), v, Q, s);
  const muzzleEnergyJ = 0.5 * s.m * v * v;
  const chemTotal = s.C * s.Qex;
  const efficiency = muzzleEnergyJ / (chemTotal || 1);

  if (step >= maxSteps && l < s.L)
    warnings.push('Projectile did not reach the muzzle within the time cap — possible squib / non-ignition.');
  if (psiExit < 0.95)
    warnings.push(`Incomplete burn: ${(psiExit * 100).toFixed(0)}% of powder consumed at muzzle.`);
  if (chemTotal > 0 && Q / chemTotal > 0.5)
    warnings.push(`Heat-loss fraction ${((Q / chemTotal) * 100).toFixed(0)}% is non-physically high — phiH likely too large.`);

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
