import { BadRequestException, Injectable } from '@nestjs/common';
import {
  BallisticsService,
  BallisticsRangeRow,
} from '../ballistics/ballistics.service';
import { ComponentDataService } from './component-data.service';
import { solveInternalBallistics } from './internal-ballistics/ib-engine';

/**
 * Load Lab — the chained pipeline: load inputs → internal-ballistics engine
 * (muzzle velocity + peak pressure + P/v curve) → chain muzzle velocity +
 * the bullet's BC into the EXISTING external solver (BallisticsService) for
 * downrange drop / velocity / energy / transonic distance.
 *
 * The internal engine is GRT-calibrated (velocity ~1%, pressure ~1-3% for
 * rifle powders in their normal cartridge envelope). Output is ADVISORY: the
 * `safety` block carries the over-pressure flag + ceiling so every surface can
 * render the start-low / work-up / verify-against-a-manual overlay.
 */

const SPEED_OF_SOUND_FPS = 1116.4; // 340.3 m/s standard
const DOWNRANGE_M = [
  0, 50, 100, 150, 200, 250, 300, 350, 400, 500, 600, 700, 800, 900, 1000,
  1100, 1200, 1300, 1400, 1500,
];

export interface LoadLabInput {
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
  ladder?: { steps?: number; stepGr?: number };
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
    /** Bullet base seating depth below the case mouth (mm) — drives the
     *  intrusion volume subtracted from case capacity. */
    seatingDepthMm: number;
    bcG1: number;
  };
  load: {
    /** Case water capacity (grains H₂O). */
    caseWaterGrH2O: number;
    /** Load ratio = powder bulk volume / effective case volume (%).
     *  >100% = a compressed charge. */
    caseFillPct: number;
    /** Charge mass per effective case volume (g/cm³). */
    loadingDensityGCm3: number;
    /** True when the charge volume exceeds the available case volume. */
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
    rows: BallisticsRangeRow[];
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
    /** Raw engine peak pressure as a % of the cartridge ceiling. This is an
     *  ESTIMATE that can read LOW — never use it alone for a safety call. */
    pctOfCeiling: number;
    /** Engine peak pressure inflated by the known under-call margin — the
     *  conservative figure every safety verdict is computed against. */
    pMaxConservativeBar: number;
    /** Conservative peak pressure as a % of the cartridge ceiling. */
    pctOfCeilingConservative: number;
    /** How far the raw estimate is padded upward for the safety verdict (%). */
    estimateUncertaintyPct: number;
    overPressure: boolean;
    nearMax: boolean;
  };
  warnings: string[];
}

@Injectable()
export class LoadLabService {
  constructor(
    private readonly components: ComponentDataService,
    private readonly ballistics: BallisticsService,
  ) {}

  compute(input: LoadLabInput): LoadLabResult {
    const cart = this.components.getCartridge(input.cartridge);
    if (!cart) throw new BadRequestException(`Unknown cartridge: ${input.cartridge}`);
    const bullet = this.components.getBullet(input.bulletId);
    if (!bullet) throw new BadRequestException(`Unknown bullet id: ${input.bulletId}`);
    const powder = this.components.getPowder(input.powderName, input.powderMaker);
    if (!powder) throw new BadRequestException(`Unknown powder: ${input.powderName}`);
    if (!(input.chargeGr > 0)) throw new BadRequestException('chargeGr must be > 0');
    if (!(input.barrelLengthIn > 0))
      throw new BadRequestException('barrelLengthIn must be > 0');

    const geom = this.components.computeGeometry(
      cart,
      bullet,
      input.barrelLengthIn,
      { coalMm: input.coalMm, caseVolGrH2O: input.caseVolGrH2O },
    );

    const ib = solveInternalBallistics(
      {
        initialGasVolumeCm3: geom.initialGasVolumeCm3,
        boreAreaMm2: geom.boreAreaMm2,
        travelMm: geom.travelMm,
        projectileMassGr: bullet.gmass,
        chargeMassGr: input.chargeGr,
        shotStartBar: bullet.gpressure || 250,
        sebert: cart.sebert || 0.5,
      },
      powder,
    );

    // Downrange — chain MV + the bullet's BC into the existing external solver.
    const bc = bullet.g1bc > 0 ? bullet.g1bc : 0;
    let external: LoadLabResult['external'] = null;
    // Only chain downrange for a real shot — a squib / non-ignition MV would
    // make the external launch-angle search crawl, and a trajectory off a
    // sub-300 fps "load" is meaningless anyway.
    if (bc > 0 && Number.isFinite(ib.vMuzzleFps) && ib.vMuzzleFps > 300) {
      const res = this.ballistics.calculate({
        bulletWeightGr: bullet.gmass,
        bcG1: bc,
        muzzleVelocityFps: ib.vMuzzleFps,
        zeroM: input.zeroM ?? 100,
        ranges: DOWNRANGE_M,
        sightHeightCm: input.sightHeightCm,
        tempC: input.tempC,
        pressureHpa: input.pressureHpa,
        altitudeM: input.altitudeM,
        windSpeedMps: input.windSpeedMps,
        windDirectionDeg: input.windDirectionDeg,
      });
      let supersonicRangeM = 0;
      let transonicRangeM = 0;
      for (const r of res.rows) {
        if (r.velocityFps >= SPEED_OF_SOUND_FPS * 1.2) supersonicRangeM = r.rangeM;
        if (r.velocityFps >= SPEED_OF_SOUND_FPS) transonicRangeM = r.rangeM;
      }
      external = { rows: res.rows, supersonicRangeM, transonicRangeM };
    }

    // Charge ladder (optional) — quick engine re-runs around the charge.
    const ladder: LoadLabResult['ladder'] = [];
    if (input.ladder && (input.ladder.steps ?? 0) >= 2) {
      const steps = Math.min(input.ladder.steps ?? 5, 12);
      const stepGr = input.ladder.stepGr ?? 0.5;
      const start = input.chargeGr - Math.floor(steps / 2) * stepGr;
      for (let i = 0; i < steps; i += 1) {
        const c = Math.round((start + i * stepGr) * 100) / 100;
        if (c <= 0) continue;
        const r = solveInternalBallistics(
          {
            initialGasVolumeCm3: geom.initialGasVolumeCm3,
            boreAreaMm2: geom.boreAreaMm2,
            travelMm: geom.travelMm,
            projectileMassGr: bullet.gmass,
            chargeMassGr: c,
            shotStartBar: bullet.gpressure || 250,
            sebert: cart.sebert || 0.5,
          },
          powder,
        );
        ladder.push({
          chargeGr: c,
          vMuzzleFps: Math.round(r.vMuzzleFps),
          pMaxBar: Math.round(r.pMaxBar),
          pctOfMax: cart.Pmax > 0 ? Math.round((r.pMaxBar / cart.Pmax) * 100) : 0,
        });
      }
    }

    const ceiling = cart.Pmax || 0;
    const pctOfCeiling = ceiling > 0 ? (ib.pMaxBar / ceiling) * 100 : 0;

    // SAFETY GATE (interim, until the per-powder rebuild lands). The engine is
    // a single-global GRT approximation that can under-predict GRT peak pressure
    // — validated worst ~-27% on fast/medium powders outside the calibration
    // envelope. Reporting that raw number as a safety verdict would give false
    // headroom, which is the one error that hurts people. So every over/near-max
    // verdict is computed against a CONSERVATIVELY inflated pressure, and the UI
    // never shows a green "safe". This pad is removed once the rebuilt engine
    // passes a hard never-under-predict gate against a broadened GRT oracle.
    const PRESSURE_UNDERCALL_PAD = 0.3; // ≥ worst observed under-call (~27%)
    const pMaxConservativeBar = Math.round(ib.pMaxBar * (1 + PRESSURE_UNDERCALL_PAD));
    const pctOfCeilingConservative =
      ceiling > 0 ? (pMaxConservativeBar / ceiling) * 100 : 0;
    const overPressure = pctOfCeilingConservative >= 100;
    const nearMax = pctOfCeilingConservative >= 90;
    if (overPressure) {
      ib.warnings.unshift(
        `Conservative peak pressure (${pMaxConservativeBar} bar, est. +${Math.round(PRESSURE_UNDERCALL_PAD * 100)}% margin) meets or exceeds the cartridge ceiling (${ceiling} bar). Do NOT use this charge — follow published load data.`,
      );
    } else if (nearMax) {
      ib.warnings.unshift(
        `Conservative peak pressure (${pMaxConservativeBar} bar) is within 10% of the cartridge ceiling (${ceiling} bar). Treat as a maximum load; verify against a published manual.`,
      );
    }
    ib.warnings.push(
      'Peak pressure is an ESTIMATE and can read LOW for some powders — treat published max-charge data as authoritative; start low and work up.',
    );

    // Case-fill / load-ratio metrics (GRT-style) — how full the case is with
    // powder by volume. Bulk density pcd (kg/m³) → g/cm³; charge grains → g.
    const chargeG = input.chargeGr * 0.06479891;
    const bulkGCm3 = powder.pcd > 0 ? powder.pcd / 1000 : 0;
    const powderBulkVolCm3 = bulkGCm3 > 0 ? chargeG / bulkGCm3 : 0;
    const caseFillPct =
      geom.initialGasVolumeCm3 > 0
        ? (powderBulkVolCm3 / geom.initialGasVolumeCm3) * 100
        : 0;
    const loadingDensityGCm3 =
      geom.initialGasVolumeCm3 > 0 ? chargeG / geom.initialGasVolumeCm3 : 0;

    return {
      inputs: {
        cartridge: cart.cipname,
        bullet: `${bullet.mname} ${bullet.pname} ${bullet.gmass}gr`,
        powder: `${input.powderMaker ?? ''} ${powder.name}`.trim(),
        chargeGr: input.chargeGr,
        barrelLengthIn: input.barrelLengthIn,
      },
      geometry: {
        initialGasVolumeCm3: round(geom.initialGasVolumeCm3, 3),
        boreAreaMm2: geom.boreAreaMm2,
        travelMm: round(geom.travelMm, 1),
        caseVolGrH2O: round(geom.caseVolGrH2O, 1),
        seatingDepthMm: round(geom.seatingDepthMm, 2),
        bcG1: bc,
      },
      load: {
        caseWaterGrH2O: round(geom.caseVolGrH2O, 1),
        caseFillPct: Math.round(caseFillPct),
        loadingDensityGCm3: round(loadingDensityGCm3, 3),
        compressed: caseFillPct > 100,
      },
      internal: {
        pMaxBar: Math.round(ib.pMaxBar),
        vMuzzleFps: Math.round(ib.vMuzzleFps),
        vMuzzleMps: Math.round(ib.vMuzzleMps),
        pMuzzleBar: Math.round(ib.pMuzzleBar),
        barrelTimeMs: round(ib.barrelTimeMs, 3),
        percentBurnt: round(ib.fractionBurnt * 100, 1),
        efficiencyPct: round(ib.efficiency * 100, 1),
        muzzleEnergyJ: Math.round(ib.muzzleEnergyJ),
        curve: ib.curve.map((p) => ({
          tMs: round(p.tMs, 3),
          pressureBar: Math.round(p.pressureBar),
          velocityFps: Math.round(p.velocityFps),
        })),
      },
      external,
      ladder,
      safety: {
        advisoryOnly: true,
        pressureCeilingBar: ceiling,
        pctOfCeiling: Math.round(pctOfCeiling),
        pMaxConservativeBar,
        pctOfCeilingConservative: Math.round(pctOfCeilingConservative),
        estimateUncertaintyPct: Math.round(PRESSURE_UNDERCALL_PAD * 100),
        overPressure,
        nearMax,
      },
      warnings: ib.warnings,
    };
  }
}

function round(x: number, dp: number) {
  const f = Math.pow(10, dp);
  return Math.round(x * f) / f;
}
