// frontend/lib/ballistics-calc.ts
//
// Client-side G1/G7 drag-model ballistic solver — direct TypeScript
// port of the backend's `BallisticsService.calculate()` (see
// backend/src/ballistics/ballistics.service.ts).
//
// Why a duplicate implementation? The calculator app must be
// offline-functional. Every tap on the range stepper triggers a
// re-solve; round-tripping that to the server would mean the calc
// is dead outside cell coverage — and shooters are EXACTLY where
// there's no signal. So we run the math locally.
//
// Single source of truth: same constants, same Cd table, same
// numerical integrator. A parity test (frontend/lib/__tests__/
// ballistics-calc.test.ts + backend/src/ballistics/ballistics.
// service.spec.ts) asserts both implementations agree within
// ±0.01 mil for 3 fixture loads × 6 ranges. If either drifts, CI
// catches it.
//
// What's NEW vs the backend port:
//   - `solveSingleRange()` — single-range fast path for the BIG
//     readout. Skips the full default 11-range iteration so the
//     range stepper feels instant (<1ms vs ~10ms).
//   - `haversineForward()` / `haversineInverse()` — for the Spot
//     Tracker: project target lat/lon from shooter lat/lon + bearing
//     + range, OR compute bearing+distance between two coords.
//
// Drag-model picker: pass dragModel: 'G1' | 'G7' to use the
// corresponding Cd table. G7 is more accurate for boat-tail
// long-range bullets; G1 is the historical default and what most
// published BCs are measured against.

// ─── Types ─────────────────────────────────────────────────────────

export type DragModel = 'G1' | 'G7';

export interface BallisticsInput {
  /** Bullet mass in grains (e.g. 168). */
  bulletWeightGr: number;
  /** Ballistic coefficient. Interpreted against the dragModel below. */
  bc: number;
  /** 'G1' (default, historical) or 'G7' (boat-tail long-range). */
  dragModel?: DragModel;
  /** Muzzle velocity in feet-per-second (e.g. 2650). */
  muzzleVelocityFps: number;
  /** Zero distance in metres (e.g. 100). */
  zeroM: number;
  /** Ranges (m) to report drop at. Defaults to a sensible rifle set. */
  ranges?: number[];
  /** Sight height above bore in cm. Default 4 (AR/bolt-action). */
  sightHeightCm?: number;
  /** Air temperature in °C. Standard 15. */
  tempC?: number;
  /** Barometric pressure in hPa. Standard 1013.25. */
  pressureHpa?: number;
  /** Altitude in metres above sea level. Standard 0. */
  altitudeM?: number;
  /** Wind speed in m/s (0 = none). Default 0. */
  windSpeedMps?: number;
  /** Wind direction in degrees relative to firing line. Default 90
   *  (full-value crosswind from the left). */
  windDirectionDeg?: number;
}

export interface BallisticsRangeRow {
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
}

export interface BallisticsResult {
  inputs: BallisticsInput;
  standardAtmosphere: boolean;
  airDensityKgM3: number;
  launchAngleMoa: number;
  rows: BallisticsRangeRow[];
}

// ─── Constants ─────────────────────────────────────────────────────

const GR_TO_KG = 0.00006479891;
const FPS_TO_MPS = 0.3048;
const MPS_TO_FPS = 1 / FPS_TO_MPS;
const STANDARD_AIR_DENSITY = 1.225; // kg/m³ (15 °C, 1013.25 hPa, dry, sea level)
const G_MPS2 = 9.80665;
const SPEED_OF_SOUND_STANDARD_MPS = 340.3;

/**
 * G1 drag function (Mach → Cd). 18-point abbreviation of Sierra's
 * McCoy Table 2-2; <1% error within Mach 0.5–3.0 (typical rifle/
 * handgun supersonic-to-subsonic regime). MUST match the backend's
 * G1_TABLE exactly — the parity test enforces this.
 */
const G1_TABLE: ReadonlyArray<readonly [number, number]> = [
  [0.0, 0.226],
  [0.5, 0.230],
  [0.7, 0.247],
  [0.85, 0.298],
  [0.9, 0.355],
  [0.95, 0.460],
  [1.0, 0.585],
  [1.05, 0.640],
  [1.1, 0.660],
  [1.2, 0.660],
  [1.4, 0.620],
  [1.6, 0.575],
  [1.8, 0.535],
  [2.0, 0.500],
  [2.25, 0.465],
  [2.5, 0.435],
  [2.75, 0.415],
  [3.0, 0.395],
];

/**
 * G7 drag function (Mach → Cd). Sampled from Litz "Applied
 * Ballistics" + McCoy. G7 form factor models a long boat-tail
 * spitzer — modern match bullets (Sierra MatchKing, Berger Hybrid,
 * Hornady ELD-Match, Lapua Scenar) publish G7 BCs that are far
 * more stable across the supersonic-to-transonic transition than
 * their G1 BCs are.
 */
const G7_TABLE: ReadonlyArray<readonly [number, number]> = [
  [0.0, 0.119],
  [0.5, 0.119],
  [0.7, 0.119],
  [0.85, 0.131],
  [0.9, 0.144],
  [0.95, 0.165],
  [1.0, 0.281],
  [1.05, 0.395],
  [1.1, 0.439],
  [1.2, 0.443],
  [1.4, 0.412],
  [1.6, 0.378],
  [1.8, 0.349],
  [2.0, 0.323],
  [2.25, 0.296],
  [2.5, 0.275],
  [2.75, 0.258],
  [3.0, 0.245],
];

/** Linear interpolation across the drag-model table. Clamps at ends. */
function cdAtMach(mach: number, model: DragModel): number {
  const table = model === 'G7' ? G7_TABLE : G1_TABLE;
  if (mach <= table[0][0]) return table[0][1];
  if (mach >= table[table.length - 1][0]) {
    return table[table.length - 1][1];
  }
  for (let i = 0; i < table.length - 1; i += 1) {
    const [m1, c1] = table[i];
    const [m2, c2] = table[i + 1];
    if (mach >= m1 && mach <= m2) {
      const f = (mach - m1) / (m2 - m1);
      return c1 + f * (c2 - c1);
    }
  }
  return table[table.length - 1][1];
}

/**
 * Air density from temp/pressure/altitude. Ideal-gas law, dry-air
 * approximation (humidity error <1% within typical hunting ranges).
 * Matches backend implementation byte-for-byte.
 */
function airDensity(
  tempC: number,
  pressureHpa: number,
  altitudeM: number,
): number {
  const adjustedPressurePa =
    pressureHpa * 100 * Math.exp(-altitudeM / 8400);
  const tempK = tempC + 273.15;
  return adjustedPressurePa / (287.058 * tempK);
}

// ─── Solver ────────────────────────────────────────────────────────

/**
 * Run a full ballistic solve. Returns drop / windage / velocity /
 * energy / TOF for each range in `input.ranges`.
 *
 * Same algorithm as the backend: binary-search the launch angle so
 * the trajectory crosses LOS at zeroM, then step at 1ms intervals
 * sampling state at each requested range.
 */
export function calculateBallistics(input: BallisticsInput): BallisticsResult {
  const sightHeightCm = input.sightHeightCm ?? 4;
  const tempC = input.tempC ?? 15;
  const pressureHpa = input.pressureHpa ?? 1013.25;
  const altitudeM = input.altitudeM ?? 0;
  const windSpeedMps = input.windSpeedMps ?? 0;
  const windDirectionDeg = input.windDirectionDeg ?? 90;
  const dragModel: DragModel = input.dragModel ?? 'G1';
  const ranges =
    input.ranges && input.ranges.length > 0
      ? [...input.ranges].sort((a, b) => a - b)
      : [25, 50, 100, 150, 200, 300, 400, 500, 600, 800, 1000];
  const standardAtmosphere =
    input.tempC === undefined &&
    input.pressureHpa === undefined &&
    input.altitudeM === undefined;

  const bulletMassKg = input.bulletWeightGr * GR_TO_KG;
  const muzzleVelocityMps = input.muzzleVelocityFps * FPS_TO_MPS;
  const sightHeightM = sightHeightCm / 100;
  const zeroM = input.zeroM;
  const rho = airDensity(tempC, pressureHpa, altitudeM);
  const rhoRatio = rho / STANDARD_AIR_DENSITY;

  const crosswindMps =
    windSpeedMps * Math.sin((windDirectionDeg * Math.PI) / 180);

  const launchAngleRad = findLaunchAngle({
    v0: muzzleVelocityMps,
    bc: input.bc,
    dragModel,
    rhoRatio,
    sightHeightM,
    zeroM,
  });

  const rows = solveTrajectory({
    v0: muzzleVelocityMps,
    angleRad: launchAngleRad,
    bc: input.bc,
    dragModel,
    rhoRatio,
    massKg: bulletMassKg,
    sightHeightM,
    crosswindMps,
    ranges,
  });

  return {
    inputs: input,
    standardAtmosphere,
    airDensityKgM3: rho,
    launchAngleMoa: ((launchAngleRad * 180) / Math.PI) * 60,
    rows,
  };
}

/**
 * Fast path: solve for ONE range only. Used by the BIG readout on
 * the HUNT-mode page where the user is tapping the stepper rapidly
 * and we don't want to iterate the default 11-range set 30× per
 * second. ~1ms vs ~10ms per call.
 *
 * Reuses `calculateBallistics` internally with `ranges: [rangeM]`
 * so we never drift from the canonical math.
 */
export function solveSingleRange(
  input: Omit<BallisticsInput, 'ranges'>,
  rangeM: number,
): BallisticsRangeRow {
  const result = calculateBallistics({ ...input, ranges: [rangeM] });
  return result.rows[0];
}

// ─── Internal trajectory integration ───────────────────────────────

function findLaunchAngle(opts: {
  v0: number;
  bc: number;
  dragModel: DragModel;
  rhoRatio: number;
  sightHeightM: number;
  zeroM: number;
}): number {
  const { v0, bc, dragModel, rhoRatio, sightHeightM, zeroM } = opts;
  let low = -0.001; // slightly below horizontal
  let high = 0.1; // ~5.7° upward — covers any reasonable rifle setup
  for (let iter = 0; iter < 30; iter += 1) {
    const mid = (low + high) / 2;
    const yAtZero = dropAtRange({
      v0,
      angleRad: mid,
      bc,
      dragModel,
      rhoRatio,
      sightHeightM,
      targetX: zeroM,
    });
    if (yAtZero > 0) high = mid;
    else low = mid;
    if (high - low < 1e-6) break;
  }
  return (low + high) / 2;
}

function dropAtRange(opts: {
  v0: number;
  angleRad: number;
  bc: number;
  dragModel: DragModel;
  rhoRatio: number;
  sightHeightM: number;
  targetX: number;
}): number {
  const {
    v0,
    angleRad,
    bc,
    dragModel,
    rhoRatio,
    sightHeightM,
    targetX,
  } = opts;
  let vx = v0 * Math.cos(angleRad);
  let vy = v0 * Math.sin(angleRad);
  let x = 0;
  let y = -sightHeightM;
  const dt = 0.001;
  while (x < targetX) {
    const v = Math.sqrt(vx * vx + vy * vy);
    const mach = v / SPEED_OF_SOUND_STANDARD_MPS;
    const cd = cdAtMach(mach, dragModel) / bc;
    const drag = (cd * rhoRatio * v * v) / 2;
    const ax = (-drag * vx) / v;
    const ay = (-drag * vy) / v - G_MPS2;
    vx += ax * dt;
    vy += ay * dt;
    x += vx * dt;
    y += vy * dt;
    if (vx <= 0) break;
  }
  return y;
}

function solveTrajectory(opts: {
  v0: number;
  angleRad: number;
  bc: number;
  dragModel: DragModel;
  rhoRatio: number;
  massKg: number;
  sightHeightM: number;
  crosswindMps: number;
  ranges: number[];
}): BallisticsRangeRow[] {
  const {
    v0,
    angleRad,
    bc,
    dragModel,
    rhoRatio,
    massKg,
    sightHeightM,
    crosswindMps,
    ranges,
  } = opts;
  const rows: BallisticsRangeRow[] = [];
  let vx = v0 * Math.cos(angleRad);
  let vy = v0 * Math.sin(angleRad);
  let x = 0;
  let y = -sightHeightM;
  let t = 0;
  const dt = 0.001;
  let rangeIdx = 0;
  const maxRange = ranges[ranges.length - 1];

  while (x < maxRange + 5 && rangeIdx < ranges.length) {
    const v = Math.sqrt(vx * vx + vy * vy);
    const mach = v / SPEED_OF_SOUND_STANDARD_MPS;
    const cd = cdAtMach(mach, dragModel) / bc;
    const drag = (cd * rhoRatio * v * v) / 2;
    const ax = (-drag * vx) / v;
    const ay = (-drag * vy) / v - G_MPS2;
    vx += ax * dt;
    vy += ay * dt;
    x += vx * dt;
    y += vy * dt;
    t += dt;

    while (rangeIdx < ranges.length && x >= ranges[rangeIdx]) {
      const r = ranges[rangeIdx];
      const dropM = -y;
      const dropCm = dropM * 100;
      const dropMoa = dropM / (r * 0.0002908);
      const dropMil = dropM / (r * 0.001);
      const velocityFps = v * MPS_TO_FPS;
      const energyJoules = 0.5 * massKg * v * v;
      const windageM = crosswindMps * (t - r / v0);
      const windageCm = windageM * 100;
      const windageMoa = windageM / (r * 0.0002908);
      const windageMil = windageM / (r * 0.001);

      rows.push({
        rangeM: r,
        dropCm: Math.round(dropCm * 10) / 10,
        dropMoa: Math.round(dropMoa * 10) / 10,
        dropMil: Math.round(dropMil * 100) / 100,
        velocityFps: Math.round(velocityFps),
        energyJoules: Math.round(energyJoules),
        timeOfFlightS: Math.round(t * 1000) / 1000,
        windageCm: Math.round(windageCm * 10) / 10,
        windageMoa: Math.round(windageMoa * 10) / 10,
        windageMil: Math.round(windageMil * 100) / 100,
      });
      rangeIdx += 1;
    }

    if (vx <= 0) break;
  }
  return rows;
}

// ─── Unit helpers (the calculator UI uses these constantly) ────────

export const fpsToMps = (fps: number): number => fps * FPS_TO_MPS;
export const mpsToFps = (mps: number): number => mps * MPS_TO_FPS;
export const mToYd = (m: number): number => m / 0.9144;
export const ydToM = (yd: number): number => yd * 0.9144;
export const cmToMoa = (cm: number, rangeM: number): number =>
  cm / 100 / (rangeM * 0.0002908);
export const cmToMil = (cm: number, rangeM: number): number =>
  cm / 100 / (rangeM * 0.001);
export const milToMoa = (mil: number): number => mil * 3.4377;
export const moaToMil = (moa: number): number => moa / 3.4377;
/** Convert mil to scope clicks at 0.1 mil/click (most common). */
export const milToClicks = (mil: number, mradPerClick = 0.1): number =>
  Math.round(mil / mradPerClick);

// ─── Haversine (Spot Tracker — Phase 9) ────────────────────────────

const EARTH_RADIUS_M = 6371008.8;

/**
 * Project a target coordinate forward from a starting point given
 * a bearing (degrees true north, 0=N, 90=E) and distance (metres).
 *
 * Used by the Spot Tracker when the hunter MARKS a shot — we have
 * their GPS + compass heading + range, and need the target's GPS.
 * The receiver phone uses this same coordinate to navigate back.
 */
export function haversineForward(opts: {
  lat: number;
  lon: number;
  bearingDeg: number;
  distanceM: number;
}): { lat: number; lon: number } {
  const { lat, lon, bearingDeg, distanceM } = opts;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const brng = (bearingDeg * Math.PI) / 180;
  const d = distanceM / EARTH_RADIUS_M;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) +
      Math.cos(lat1) * Math.sin(d) * Math.cos(brng),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return {
    lat: (lat2 * 180) / Math.PI,
    lon: (((lon2 * 180) / Math.PI + 540) % 360) - 180,
  };
}

/**
 * Compute great-circle bearing + distance from current position to
 * a target coordinate. Used by the recovery view — the arrow on
 * screen always points at the marked target, distance ticks down
 * as the hunter walks. Recomputed on every GPS or compass update.
 */
export function haversineInverse(opts: {
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
}): { bearingDeg: number; distanceM: number } {
  const { fromLat, fromLon, toLat, toLon } = opts;
  const lat1 = (fromLat * Math.PI) / 180;
  const lat2 = (toLat * Math.PI) / 180;
  const dLat = ((toLat - fromLat) * Math.PI) / 180;
  const dLon = ((toLon - fromLon) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceM = EARTH_RADIUS_M * c;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearingDeg = (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
  return { bearingDeg, distanceM };
}
