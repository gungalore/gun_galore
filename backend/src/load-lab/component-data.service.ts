import { Injectable } from '@nestjs/common';
import {
  loadGrtData,
  RawCartridge,
  RawProjectile,
  RawPropellant,
} from './internal-ballistics/powder-coefficients';
import { IbPowder } from './internal-ballistics/ib-types';

/**
 * In-memory accessor over the vendored GRT reference data (578 cartridges /
 * 5,648 bullets / 693 powders). The data is static reference material at a
 * trivial scale, so it lives in a bundled JSON rather than Postgres — no
 * migration to run, deploy-safe, and searches are sub-millisecond in memory.
 *
 * Provides: typeahead search for the pickers, lookups by id/name, and the
 * GEOMETRY computation (effective case volume, bore area, projectile path)
 * that the internal-ballistics engine needs — derived from the cartridge +
 * bullet + barrel + seating, with formulas validated against GRT's own
 * computed geometry on the reference loads (projectile path matches exactly;
 * effective case volume within ~1%).
 */

const GRH2O_TO_CM3 = 0.0647989;
const IN_TO_MM = 25.4;

export interface CartridgePick {
  id: number;
  name: string; // cipname
  boreAreaMm2: number;
  caseVolGrH2O: number;
  pMaxBar: number;
  grooveMm: number;
}
export interface BulletPick {
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
export interface PowderPick {
  id: number;
  maker: string;
  name: string;
  lot: string;
  qlty: number;
}

export interface Geometry {
  initialGasVolumeCm3: number;
  boreAreaMm2: number;
  travelMm: number;
  seatingDepthMm: number;
  caseVolGrH2O: number;
}

@Injectable()
export class ComponentDataService {
  private readonly data = loadGrtData();

  // ─── Search (typeahead for the pickers) ───────────────────────────
  searchCartridges(q: string, limit = 12): CartridgePick[] {
    const n = q.trim().toLowerCase();
    return this.data.caliber
      .filter((c) => c.cipname && (!n || c.cipname.toLowerCase().includes(n)))
      .filter((c) => c.c_Q > 0 && c.V > 0)
      .slice(0, limit)
      .map((c) => this.cartridgePick(c));
  }

  searchPowders(q: string, limit = 12): PowderPick[] {
    const n = q.trim().toLowerCase();
    return this.data.propellant
      .filter((p) => (p as RawPropellant & { geloescht?: number }).geloescht !== 1)
      .filter(
        (p) =>
          !n ||
          `${p.mname} ${p.pname}`.toLowerCase().includes(n),
      )
      .slice(0, limit)
      .map((p) => ({
        id: p.id,
        maker: p.mname,
        name: p.pname,
        lot: p.lotid ?? '',
        qlty: p.Qlty ?? 0,
      }));
  }

  searchBullets(q: string, limit = 15, grooveMm?: number): BulletPick[] {
    const n = q.trim().toLowerCase();
    return this.data.projectile
      .filter((p) => p.gmass > 0)
      .filter((p) =>
        grooveMm ? Math.abs(p.gdia - grooveMm) <= 0.05 : true,
      )
      .filter(
        (p) =>
          !n ||
          `${p.mname} ${p.pname} ${p.caliber}`.toLowerCase().includes(n),
      )
      .slice(0, limit)
      .map((p) => this.bulletPick(p));
  }

  // ─── Lookups ──────────────────────────────────────────────────────
  getCartridge(name: string): RawCartridge | undefined {
    const n = name.trim().toLowerCase();
    return this.data.caliber.find((c) => c.cipname.toLowerCase() === n);
  }
  getBullet(id: number): RawProjectile | undefined {
    return this.data.projectile.find((p) => p.id === id);
  }
  getPowder(name: string, maker?: string): IbPowder | undefined {
    const n = name.trim().toLowerCase();
    const m = maker?.trim().toLowerCase();
    const hit = this.data.propellant.find(
      (p) =>
        p.pname.toLowerCase() === n &&
        (m ? p.mname.toLowerCase() === m : true),
    );
    return hit ? this.toIbPowder(hit) : undefined;
  }
  getRawPowder(name: string, maker?: string): RawPropellant | undefined {
    const n = name.trim().toLowerCase();
    const m = maker?.trim().toLowerCase();
    return this.data.propellant.find(
      (p) =>
        p.pname.toLowerCase() === n && (m ? p.mname.toLowerCase() === m : true),
    );
  }

  // ─── Bulk accessors (for case-fill estimation) ────────────────────
  /** Every powder with a positive bulk density (pcd, g/cm³). */
  listPowderDensities(): { name: string; maker: string; pcd: number }[] {
    return this.data.propellant
      .filter(
        (p) =>
          (p as RawPropellant & { geloescht?: number }).geloescht !== 1 &&
          p.pcd > 0,
      )
      .map((p) => ({ name: p.pname, maker: p.mname, pcd: p.pcd }));
  }
  /** Every cartridge with its case water capacity (grains). */
  listCaseCapacities(): { cipname: string; vGrH2O: number }[] {
    return this.data.caliber
      .filter((c) => c.cipname && c.V > 0)
      .map((c) => ({ cipname: c.cipname, vGrH2O: c.V }));
  }

  // ─── Geometry (cartridge + bullet + barrel → engine inputs) ────────
  computeGeometry(
    cart: RawCartridge,
    bullet: RawProjectile,
    barrelLengthIn: number,
    opts?: { coalMm?: number; caseVolGrH2O?: number },
  ): Geometry {
    const boreAreaMm2 = cart.c_Q;
    const caseLenMm = cart.L3 || 0;
    const bulletLenMm = bullet.glen || 0;
    // Default COAL ≈ cartridge max OAL (L6); fall back to case + bullet.
    const coalMm = opts?.coalMm ?? cart.L6 ?? caseLenMm + bulletLenMm;
    // Seating depth = how deep the bullet base sits below the case mouth.
    let seatingDepthMm = caseLenMm + bulletLenMm - coalMm;
    seatingDepthMm = Math.max(0, Math.min(seatingDepthMm, caseLenMm));

    const caseVolGrH2O = opts?.caseVolGrH2O ?? cart.V;
    const caseVolCm3 = caseVolGrH2O * GRH2O_TO_CM3;
    // Bullet base intrusion displaces case volume.
    const intrusionCm3 = (seatingDepthMm * boreAreaMm2) / 1000;
    const initialGasVolumeCm3 = Math.max(0.1, caseVolCm3 - intrusionCm3);
    // Projectile path = barrel − distance from boltface to bullet base.
    // (Validated: 24" 6.5CM → 570.25 mm, matches GRT exactly.)
    const travelMm = Math.max(
      50,
      barrelLengthIn * IN_TO_MM - (caseLenMm - seatingDepthMm),
    );
    return {
      initialGasVolumeCm3,
      boreAreaMm2,
      travelMm,
      seatingDepthMm,
      caseVolGrH2O,
    };
  }

  // ─── Mappers ──────────────────────────────────────────────────────
  private cartridgePick(c: RawCartridge): CartridgePick {
    return {
      id: c.id,
      name: c.cipname,
      boreAreaMm2: c.c_Q,
      caseVolGrH2O: c.V,
      pMaxBar: c.Pmax,
      grooveMm: c.c_Z,
    };
  }
  private bulletPick(p: RawProjectile): BulletPick {
    return {
      id: p.id,
      maker: p.mname,
      name: p.pname,
      caliber: p.caliber,
      diameterMm: p.gdia,
      weightGr: p.gmass,
      lengthMm: p.glen,
      g1bc: p.g1bc,
      g7bc: p.g7bc,
    };
  }
  private toIbPowder(p: RawPropellant): IbPowder {
    return {
      name: p.pname,
      Ba: p.Ba,
      Bp: p.Bp,
      Qex: p.Qex,
      k: p.k,
      eta: p.eta,
      pc: p.pc,
      pcd: p.pcd,
      a0: p.a0,
      a1: p.a1,
      z1: p.z1,
      z2: p.z2,
      L: [p.L01, p.L02, p.L03, p.L04, p.L05, p.L06, p.L07, p.L08, p.L09],
    };
  }
}
