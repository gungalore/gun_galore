# Load Lab — Port Guide (for the Ballistic Hunter app)

**Audience:** the Claude Code instance working in `C:\Users\gerha\hunt-ballistics`.
**Source of truth:** everything described here lives in **`C:\dev\gun-galore`** (the Gun Galore marketplace). Read files from there with absolute paths.
**Goal:** copy the "Load Lab" (interior-ballistics predictor + published-load lookup) into the Ballistic Hunter app.

---

## 0. What the Load Lab actually is

Two independent halves. You can port one or both.

**A. The internal-ballistics ENGINE (the hard part — port this).**
Given a handload (cartridge + bullet + powder + charge + barrel length) it predicts **muzzle velocity, peak chamber pressure, %-powder-burnt, barrel time, and the full pressure/velocity-vs-time curve**. It is a lumped-parameter (vivacity / Sebert / Resal-energy) interior-ballistics ODE, **pure TypeScript, zero framework/DB/HTTP deps**, calibrated against Gordon's Reloading Tool (GRT). Velocity lands ~1–1.5% median vs GRT; pressure is an estimate (~6–7% median, worse at burn-rate extremes) and is **deliberately treated as conservative-only** (see §6 safety).

It then **chains** its predicted muzzle velocity + the bullet's BC into the *existing external* ballistics solver to produce the downrange drop/velocity/energy/transonic table. Your app already has that external solver (`lib/ballistic-math/`), so you reuse yours — you do **not** need Gun Galore's external engine.

**B. The "Recommended Loads" DATA (optional — published manual charges).**
A 42,128-row table of published start/max charges (Somchem, ADI, Hodgdon, IMR, Vihtavuori, Hornady, Nosler, …) keyed by cartridge + bullet weight, each with a manual + page citation. This is *authoritative published data* shown next to the engine's *estimate*. Porting this is a data/storage decision (see §8), not physics.

**Data feeding the engine:** a vendored 4.7 MB JSON extracted from GRT — **578 cartridges / 5,648 bullets / 693 powders** with their burn coefficients and geometry. This is the engine's only data dependency and it is self-contained in the repo (no DB, no Frida, no external fetch needed to run the engine).

---

## 1. Exact file map (all under `C:\dev\gun-galore`)

### 1a. The engine — PORT THESE FIRST (pure math, framework-free)
| File | Lines | What it is |
|---|---|---|
| `backend/src/load-lab/internal-ballistics/ib-types.ts` | 164 | **Start here.** All interfaces (`IbPowder`, `IbLoad`, `IbCalib`, `IbResult`, `IbCurvePoint`), unit conversions, and `DEFAULT_CALIB` (the tuned global knobs). |
| `backend/src/load-lab/internal-ballistics/ib-engine.ts` | 235 | Public entry `solveInternalBallistics(load: IbLoad, powder: IbPowder, calib?) → IbResult`. Sets up state, runs the integrator, assembles the result + warnings. |
| `backend/src/load-lab/internal-ballistics/ib-engine-physics.ts` | 271 | The actual physics: burn law (`dz/dt = kBurn·L(z)·P`), Resal/Noble-Abel pressure, projectile EOM, RK4 step. The numerical core. |
| `backend/src/load-lab/internal-ballistics/powder-coefficients.ts` | 141 | Loads `grt_reloading_data.json` once and exposes typed lookups (`loadGrtData`, `RawCartridge`, `RawProjectile`, `RawPropellant`). **Node-specific:** reads via `fs`/`__dirname` — you must swap this for a bundler import on the frontend (see §7 gotcha). |

### 1b. The data (vendored — copy as-is)
| File | Size | What |
|---|---|---|
| `backend/src/load-lab/internal-ballistics/grt-data/grt_reloading_data.json` | 4.7 MB | The engine's fuel: cartridges + bullets + powders with all GRT coefficients. **Required.** |

### 1c. The orchestration / geometry (port the logic, drop the NestJS shell)
| File | Lines | What |
|---|---|---|
| `backend/src/load-lab/component-data.service.ts` | 233 | In-memory accessor over the JSON: typeahead search for the pickers, lookups by id/name, and **`computeGeometry()`** — turns cartridge + bullet + barrel + seating into the `initialGasVolumeCm3 / boreAreaMm2 / travelMm` the engine needs. Geometry validated against GRT (projectile path exact, case volume ~1%). It's a `@Injectable()` but the methods are pure — lift them into a plain module. |
| `backend/src/load-lab/load-lab.service.ts` | 312 | **The pipeline glue.** `compute(LoadLabInput) → LoadLabResult`: validate → `computeGeometry` → `solveInternalBallistics` → chain MV+BC into the external solver → charge ladder → case-fill metrics → **safety block**. `LoadLabInput` / `LoadLabResult` here are the contract your UI will consume. The external-solver call (lines 161–173) is the one spot you repoint at *your* `lib/ballistic-math`. |

### 1d. Backend HTTP + AI shell (GG-specific — reference only, mostly drop)
| File | Lines | What |
|---|---|---|
| `backend/src/load-lab/load-lab.controller.ts` | 104 | `POST /load-lab/compute`, `GET /load-lab/search`, `GET /load-lab/recommended-loads`. **Clerk-auth + PRO-gated** (Gun Galore tiers) — strip/replace the gating for your app's entitlement model (RevenueCat). |
| `backend/src/load-lab/load-lab.module.ts` | 23 | NestJS wiring. Only relevant if you keep a NestJS backend. |
| `backend/src/load-lab/recommended-loads.service.ts` | 319 | Serves the published-load lookup (§B). Contains the reusable **`cartridgeKey()`** and powder-key normalisers + **`workUpLadder()`** — useful even if you reshape storage. |

### 1e. Frontend (Next.js — your app is also Next.js, so these are close to drop-in)
All under `frontend/app/ask-gg/load-lab/` unless noted:
| File | Lines | What |
|---|---|---|
| `LoadLabPanel.tsx` | 635 | Orchestrator: the two-mode (Hunter / Competition) input form + results layout. |
| `LoadLabResultCard.tsx` | 226 | **Shared result surface** — the canonical render of one prediction (used by panel + chat). |
| `ComponentPicker.tsx` | 289 | Server-typeahead pickers for cartridge / bullet / powder. Calls `/load-lab/search`. |
| `PressureVelocityChart.tsx` | 243 | Dual-axis in-barrel P(t)/v(t) SVG chart. |
| `DownrangeChart.tsx` | 229 | Downrange drop chart with supersonic/transonic bands (adapted from a TrajectoryChart). |
| `DopeTable.tsx` | 101 | DOPE table (MOA & MIL). |
| `ChargeLadder.tsx` | 154 | Charge-ladder table. |
| `MetricCard.tsx` / `SafetyOverlay.tsx` | 109 / 52 | Metric tiles + the persistent advisory overlay. |
| `RecommendedLoadsPanel.tsx` | 283 | The published-loads panel (§B). |
| `frontend/lib/use-load-lab.ts` | 195 | The React hook (state, debounce, fetch to `/load-lab/*`). |

### 1f. Offline tooling (NOT needed to port — context only)
- `C:\dev\grt-oracle\` — the offline GRT Frida oracle + capture grid used to *calibrate/validate* the engine. You don't need it to ship; you'd only revisit it to re-tune.
- `backend/scripts/grt-benchmark.ts` — scores the engine against the oracle (the GO/NO-GO accuracy harness). Port this style as your regression test.
- `C:\Users\gerha\OneDrive\Desktop\GRT_extracted\` — the original GRT export (`grt_reloading_data.json` + CSVs). The repo's vendored JSON is the same data; prefer the repo copy.

---

## 2. Data flow (the chained pipeline)

```
user inputs                       component-data.service                 ib-engine
(cartridge, bullet,   ──pick──►   getCartridge / getBullet / getPowder
 powder, charge,                  computeGeometry() ─► {gasVol, boreArea, travel}
 barrel, seating)                                          │
                                                           ▼
                                  solveInternalBallistics(IbLoad, IbPowder)
                                                           │
                                   ┌───────────────────────┴────────────────────┐
                                   ▼                                             ▼
                       internal result                                 chain MV + bullet.g1bc
                  {pMax, vMuzzle, %burnt,                                        │
                   barrelTime, curve[]}                                         ▼
                                   │                            YOUR external solver (lib/ballistic-math)
                                   │                                  → downrange rows + transonic
                                   ▼                                             │
                          load-lab.service assembles LoadLabResult ◄────────────┘
                          { inputs, geometry, load(fill), internal,
                            external, ladder, safety, warnings }
                                   │
                                   ▼
                          LoadLabResultCard renders it
```

---

## 3. The engine contract (what you actually call)

One function. Everything else is plumbing.

```ts
solveInternalBallistics(load: IbLoad, powder: IbPowder, calib = DEFAULT_CALIB): IbResult
```

- **`IbPowder`** — straight from the GRT JSON per powder: `Ba, Bp, Qex, k, eta, pc, pcd, a0, a1, z1, z2, L[9]` (the 9-point burn curve). `powder-coefficients.ts` maps the raw JSON row → `IbPowder`.
- **`IbLoad`** — `initialGasVolumeCm3, boreAreaMm2, travelMm, projectileMassGr, chargeMassGr, shotStartBar?, sebert?`. The first three come from `computeGeometry()`; the rest from the bullet + user charge.
- **`IbCalib`** — **global** knobs (`kBurn, sebertScale, burnExp, ldSlope, …`) in `DEFAULT_CALIB`. **Do not introduce per-powder fudge factors.** These were fit against a 4-cartridge / 59-load GRT holdout; copy them verbatim.
- **`IbResult`** — `pMaxBar, vMuzzleFps/Mps, pMuzzleBar, barrelTimeMs, fractionBurnt, muzzleEnergyJ, efficiency, curve[], warnings[]`.

Units convert at the boundary (grains/mm/bar/cm³ in, SI inside) via the constants at the top of `ib-types.ts`.

---

## 4. Recommended port shape for hunt-ballistics (client-side, offline)

Your app is **Next.js + Capacitor, offline-first, no backend in-repo** (it calls `ballistics.gungalore.co.za` for some things). The engine is pure math, so the cleanest fit is a **100% client-side port into `lib/`** — it then runs on-device with no network, matching your offline ethos and your existing `lib/ballistic-math` pattern.

**Step by step:**

1. **Vendor the engine.** Copy the four `internal-ballistics/*.ts` files into a new `lib/load-lab/internal-ballistics/` (or fold into `lib/ballistic-math/`). They're plain TS — they compile as-is.

2. **Vendor the data.** Copy `grt_reloading_data.json` into the app (e.g. `lib/load-lab/data/`). At 4.7 MB it's bigger than your other bundles — decide: import it statically (simplest; adds to JS bundle), lazy-`import()` it on first Load Lab open (recommended for a mobile bundle), or split per-need. You already bundle data files, so follow that convention.

3. **Fix the data loader (the one real gotcha).** `powder-coefficients.ts` uses Node `fs` + `__dirname`. On the frontend, replace its `loadGrtData()` body with a static/lazy `import` of the JSON. Keep the same exported shape (`RawCartridge/RawProjectile/RawPropellant` + `loadGrtData()`) so nothing downstream changes.

4. **Port the accessor + geometry.** Lift the pure methods out of `component-data.service.ts` into a plain module (drop `@Injectable()`): `searchCartridges/Bullets/Powders`, `getCartridge/getBullet/getPowder`, and **`computeGeometry()`**. No behavioural change.

5. **Port the orchestrator and repoint downrange.** Recreate `load-lab.service.ts`'s `compute()` as a plain function. At the chain step, call **your** `lib/ballistic-math` solver instead of Gun Galore's `BallisticsService.calculate` — feed it `muzzleVelocityFps = ib.vMuzzleFps` and `bcG1 = bullet.g1bc`, take back drop/velocity/energy, and compute supersonic/transonic the same way (lines 174–180). Keep the `LoadLabResult` shape so the UI ports cleanly.

6. **Keep the safety block verbatim** (see §6). It is structural, not cosmetic.

7. **Port the UI.** The `frontend/app/ask-gg/load-lab/*.tsx` components are Next.js/React and map closely to your stack. Reuse your `TrajectoryChart.tsx` for downrange (the GG `DownrangeChart` is itself an adaptation of one). Re-skin to your design tokens. Wire the pickers to your local accessor instead of HTTP `/load-lab/search` (in-memory search is sub-millisecond).

8. **Replace gating.** Drop Gun Galore's Clerk/PRO checks; gate behind your RevenueCat entitlement (you already have `lib/entitlement/`).

**Alternative (backend service):** if you'd rather keep the engine server-side, port `load-lab.service.ts` + `component-data.service.ts` + the JSON into your backend and expose a `/compute` endpoint. Same code; you keep `fs`/`__dirname` and skip step 3. Only worth it if you don't want the 4.7 MB on-device.

---

## 5. Recommended-Loads data (§B) — only if you want published charges

The 42,128-row dataset lives at `backend/prisma/seed-data/manual-loads.jsonl` (16 MB) with:
- Prisma model `ManualLoad` (`backend/prisma/schema.prisma`, ~line 2454).
- Importer `backend/scripts/import-loads.ts` (validates + bulk-inserts).
- Migrations `backend/prisma/migrations/20260626160000_add_manual_loads` (+ `…170000_manualload_label`, `…180000_…widen_dedup`, `…627100000_…fill`).
- Query service `recommended-loads.service.ts` → `recommend(cartridge, bulletWeightGr, toleranceGr=5)`.

16 MB is heavy to bundle on a phone. Options, fastest→best:
- **(a) Skip it** — ship just the engine first.
- **(b) Backend endpoint** — load the JSONL into your backend DB (reuse `import-loads.ts` + the `ManualLoad` model) and expose `recommend()` as an API. Best if the app is online for this feature.
- **(c) Pre-compress + bundle** — collapse to per-cartridge JSON shards and lazy-load the one the user picks. Reuse `cartridgeKey()` from `recommended-loads.service.ts` so keys match.

Either way, keep `cartridgeKey()` and `workUpLadder()` — they encode the name-normalisation and start-low/work-up logic.

---

## 6. SAFETY — non-negotiable, copy exactly

The engine **can under-predict GRT peak pressure** (worst ~-27% at burn-rate extremes). Reporting a raw "safe" pressure would give false headroom — the one error that hurts people. So `load-lab.service.ts` (lines ~213–241) does this and **your port must keep it**:

- Every near/over-max verdict is computed against a **conservatively inflated** pressure: `pMaxConservativeBar = pMax × 1.30` (`PRESSURE_UNDERCALL_PAD = 0.3`).
- `overPressure = pctOfCeilingConservative ≥ 100`, `nearMax ≥ 90`. The UI **never shows a green "safe."**
- The `safety` block is part of the result payload (`advisoryOnly: true`, ceiling, raw %, conservative %, uncertainty %, flags) so every surface can render the **start-low / work-up / verify-against-a-published-manual** overlay.
- Velocity/trajectory are the trustworthy outputs; **pressure is a conservative guide, never a clearance.** Published manual data stays authoritative for charge weights — the engine is an *estimate*, never "the load to use."

If you change the calibration knobs, re-run the benchmark (§7) and re-confirm the pad still covers the worst under-call before shipping.

---

## 7. Build & verify

- **Engine first:** port §4 steps 1–6, then write a tiny regression test (mirror `backend/scripts/grt-benchmark.ts`) that runs ~10 known loads and asserts velocity within a few %. The engine is deterministic (fixed 1 µs RK4), so results are reproducible.
- **Parity (if you also keep a backend copy):** the original used a FE↔BE byte-for-byte parity harness (the "BC-3 pattern") — same inputs must give identical numbers on both sides.
- **Type-check:** `npx tsc --noEmit` in your app after each chunk.
- **Smoke test:** 6.5 Creedmoor + a 140 gr bullet + H4350 + ~41 gr → expect ~2,700 fps and a sane pMax under the 6.5 CM ceiling; the downrange chart should show a transonic band out past ~1,200 m.

### Gotchas
- **`__dirname`/`fs` in `powder-coefficients.ts`** → swap for a bundler import on the frontend (§4 step 3). This is the only Node-ism in the engine path.
- **Units:** never pass SI into the engine — it expects grains/mm/bar/cm³ and converts internally. Reuse the constants in `ib-types.ts`.
- **Don't per-powder-tune.** Keep `DEFAULT_CALIB` global. Per-powder factors were explicitly rejected (they over-fit one cartridge).
- **Cartridge name matching:** GRT names (`".308 Win. (7.62x51)"`) differ from manual names (`".308 Winchester"`). `cartridgeKey()` reconciles them — reuse it if you wire §B.
- **Prisma 7** (only if you take the DB path): the client needs the driver adapter — `new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) })`. See `backend/scripts/import-loads.ts`.
- **Bundle weight:** 4.7 MB JSON (engine) + optional 16 MB JSONL (loads). Lazy-load both; don't put them in the initial app bundle.

---

## 8. Minimum viable port (if you want the smallest first cut)

1. `ib-types.ts`, `ib-engine.ts`, `ib-engine-physics.ts` → `lib/`.
2. `grt_reloading_data.json` + a frontend `loadGrtData()`.
3. The `computeGeometry()` + `getCartridge/Bullet/Powder` from `component-data.service.ts`.
4. A thin `compute()` that calls the engine, chains into **your** `lib/ballistic-math`, and attaches the §6 safety block.
5. One result component (model on `LoadLabResultCard.tsx`) + your `TrajectoryChart`.

That gives a working on-device Load Lab. Add the pickers' polish, charge ladder, DOPE table, and the Recommended-Loads data afterwards.
