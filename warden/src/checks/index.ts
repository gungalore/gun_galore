// warden/src/checks/index.ts
//
// The measurement layer's public face, for whoever builds the daemon's
// HTTP surface and its diagnosis turn. Nothing here calls a model and
// nothing here runs a fix — a sweep produces FACTS, and the facts are
// complete before Claude is ever asked anything about them.
//
// Typical wiring in the daemon:
//   const ctx = createSystemContext();
//   const memory = createSweepMemory();
//   const sweep = await runSweep(ALL_CHECKS, ctx, memory);   // background loop
//   ...serve GET /chat from the LAST completed sweep, never from a new one:
//   the backend's read budget is 8s and a full sweep is not an 8s job.

export * from '../types.js';
export { ALL_CHECKS, findCheck } from './registry.js';
export { runSweep, runOne, createSweepMemory, type SweepMemory, type SweepOptions } from './engine.js';
export { createSystemContext, loadConfig } from './context.js';
export { JsonFileHistory, MemoryHistory, ratePerDay, MIN_RATE_SPAN_MS } from './history.js';
export { ok, warn, bad, standingBad, unknown, ev, notMeasured, cmd, bytes, ageWords, parseDate } from './result.js';
export { BACKEND_ENV_MANIFEST, FRONTEND_ENV_MANIFEST, NON_SECRET_ENV_KEYS } from './env-manifest.data.js';
