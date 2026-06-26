/**
 * Typed accessor over the vendored GRT reference data.
 *
 * Loads grt_reloading_data.json once and exposes lookups by powder name,
 * cartridge (cipname), and projectile. Returns the engine-shaped IbPowder
 * for the solver. Used by the offline benchmark + hand-check scripts; the
 * runtime backend will read these from Postgres (Phase 3) instead.
 */
import * as fs from 'fs';
import * as path from 'path';
import { IbPowder } from './ib-types';

interface RawPropellant {
  id: number;
  mname: string;
  pname: string;
  lotid?: string;
  Ba: number;
  Bp: number;
  Br: number;
  Brp: number;
  Qex: number;
  k: number;
  eta: number;
  a0: number;
  a1: number;
  z1: number;
  z2: number;
  pc: number;
  pcd: number;
  L01: number;
  L02: number;
  L03: number;
  L04: number;
  L05: number;
  L06: number;
  L07: number;
  L08: number;
  L09: number;
  Qlty: number;
}

interface RawCartridge {
  id: number;
  cipname: string;
  V: number; // case capacity (gr H₂O)
  Pmax: number; // bar
  sebert: number;
  c_Q: number; // effective bore area (mm²)
  c_Z: number; // groove caliber (mm)
  L3: number; // ≈ case length (mm)
  L6: number; // ≈ max cartridge overall length (mm)
}

interface RawProjectile {
  id: number;
  mname: string;
  pname: string;
  caliber: string;
  gdia: number;
  glen: number;
  gmass: number; // grains
  gpressure: number; // shot-start (bar)
  g1bc: number;
  g7bc: number;
}

interface RawData {
  caliber: RawCartridge[];
  projectile: RawProjectile[];
  propellant: RawPropellant[];
}

let cache: RawData | null = null;

const REL = 'load-lab/internal-ballistics/grt-data/grt_reloading_data.json';

export function loadGrtData(): RawData {
  if (cache) return cache;
  // Robust across dev (ts-node, file sits next to source), prod (compiled to
  // dist; the repo's src/ is also present on the VPS deploy), and the nest
  // asset copy. First existing path wins.
  const candidates = [
    path.join(__dirname, 'grt-data', 'grt_reloading_data.json'),
    path.join(process.cwd(), 'src', REL),
    path.join(process.cwd(), 'dist', 'src', REL),
  ];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file)
    throw new Error(
      `GRT reference data not found. Looked in:\n${candidates.join('\n')}`,
    );
  cache = JSON.parse(fs.readFileSync(file, 'utf8')) as RawData;
  return cache;
}

function toIbPowder(p: RawPropellant): IbPowder {
  return {
    name: p.pname,
    Ba: p.Ba,
    Bp: p.Bp,
    Qex: p.Qex,
    k: p.k,
    eta: p.eta,
    pc: p.pc,
    a0: p.a0,
    a1: p.a1,
    z1: p.z1,
    z2: p.z2,
    L: [p.L01, p.L02, p.L03, p.L04, p.L05, p.L06, p.L07, p.L08, p.L09],
  };
}

export function findPowder(
  name: string,
  maker?: string,
): IbPowder | undefined {
  const data = loadGrtData();
  const norm = (s: string) => s.trim().toLowerCase();
  const hit = data.propellant.find(
    (p) =>
      norm(p.pname) === norm(name) &&
      (maker ? norm(p.mname) === norm(maker) : true),
  );
  return hit ? toIbPowder(hit) : undefined;
}

export function findCartridge(cipname: string): RawCartridge | undefined {
  const data = loadGrtData();
  const norm = (s: string) => s.trim().toLowerCase();
  return data.caliber.find((c) => norm(c.cipname) === norm(cipname));
}

export function findProjectile(
  predicate: (p: RawProjectile) => boolean,
): RawProjectile | undefined {
  return loadGrtData().projectile.find(predicate);
}

export type { RawPropellant, RawCartridge, RawProjectile, RawData };
