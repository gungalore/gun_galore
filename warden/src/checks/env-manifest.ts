// warden/src/checks/env-manifest.ts
//
// PRESENCE ONLY. Warden reads backend/.env and frontend/.env.production
// and reports, per variable in the manifest, whether it is set to
// something non-empty — the same rule desk-site.service.ts uses, so the
// Desk's gates board and Warden can never quietly disagree.
//
// 🚨 A VALUE NEVER LEAVES THIS CHECK. parseEnvPresence() carries lengths,
// not values, out of the parser; the only exception is the explicit
// NON_SECRET_ENV_KEYS allowlist, where the value IS the finding (a mode,
// a public URL). There is no other door, and a test asserts a
// non-allowlisted value never appears anywhere in the emitted result.
//
// ⚠️ FRONTEND CAVEAT, STATED IN THE EVIDENCE ITSELF: NEXT_PUBLIC_* values
// are inlined into the JS bundle at `next build` time. Reading the file on
// disk proves what the NEXT rebuild would embed — not what the currently
// served .next/ bundle contains. Someone can edit that file and the live
// site keeps the old value with nothing to show for it. The check says so
// rather than implying it measured the live bundle.

import type { CheckModule, CheckOutcome, Evidence } from '../types.js';
import { bad, ev, ok, unknown, warn } from './result.js';
import { parseEnvPresence, type EnvEntry } from './lib/parse.js';
import { BACKEND_ENV_MANIFEST, FRONTEND_ENV_MANIFEST, NON_SECRET_ENV_KEYS, type EnvVar } from './env-manifest.data.js';

export const backendEnvCheck: CheckModule = {
  id: 'env-backend',
  title: 'Backend environment',
  cost: 'cheap',
  cadenceMs: 15 * 60_000,
  async run(ctx): Promise<CheckOutcome> {
    const read = await ctx.readFile(ctx.config.backendEnvPath);
    if (!read.ok) return unknown(`cannot read the backend env file — ${read.error}`);
    return assess(parseEnvPresence(read.value, NON_SECRET_ENV_KEYS), BACKEND_ENV_MANIFEST, ctx.config.backendEnvPath, []);
  },
};

export const frontendEnvCheck: CheckModule = {
  id: 'env-frontend',
  title: 'Frontend environment',
  cost: 'cheap',
  cadenceMs: 15 * 60_000,
  async run(ctx): Promise<CheckOutcome> {
    const read = await ctx.readFile(ctx.config.frontendEnvPath);
    if (!read.ok) return unknown(`cannot read the frontend env file — ${read.error}`);
    return assess(parseEnvPresence(read.value, NON_SECRET_ENV_KEYS), FRONTEND_ENV_MANIFEST, ctx.config.frontendEnvPath, [
      ev(
        'caveat',
        'NEXT_PUBLIC_* values are baked into the bundle at build time — this reads the file on disk, which is what the NEXT build would embed, not necessarily what the served .next/ contains',
      ),
    ]);
  },
};

export const envChecks: CheckModule[] = [backendEnvCheck, frontendEnvCheck];

/**
 * The single gate between an env value and anything an operator, a chat
 * message or a model ever sees. Exported ONLY so it can be tested
 * directly: the parser already refuses to carry a non-allowlisted value
 * out, so a bug here would be invisible to an end-to-end test — two
 * independent layers, and this is the second one.
 */
export function valueForEvidence(name: string, info: EnvEntry): string | null {
  if (!NON_SECRET_ENV_KEYS.has(name)) return null;
  return info.value ?? null;
}

function assess(
  present: Map<string, EnvEntry>,
  manifest: readonly EnvVar[],
  path: string,
  extraEvidence: Evidence[],
): CheckOutcome {
  const missing = { 'fails-closed': [] as EnvVar[], feature: [] as EnvVar[], optional: [] as EnvVar[] };
  for (const entry of manifest) {
    if (!present.has(entry.name)) missing[entry.tier].push(entry);
  }

  const evidence: Evidence[] = [
    ev('file', path),
    ev('manifest', `${manifest.length} variables checked, ${manifest.length - missing['fails-closed'].length - missing.feature.length - missing.optional.length} set`),
    ...extraEvidence,
  ];

  // Each missing variable gets its own line naming what it disables — the
  // list of names alone is not actionable, and this is the whole reason
  // the manifest carries `disables`.
  for (const tier of ['fails-closed', 'feature', 'optional'] as const) {
    for (const entry of missing[tier]) {
      evidence.push(ev(`missing · ${entry.name}`, `${tier} — ${entry.disables}`));
    }
  }

  // The allowlisted values, printed deliberately. Everything else in the
  // file is reported as a length and nothing more.
  for (const [name, info] of present) {
    const printable = valueForEvidence(name, info);
    if (printable !== null) evidence.push(ev(`set · ${name}`, printable));
  }
  const secretsPresent = [...present.entries()].filter(([n]) => !NON_SECRET_ENV_KEYS.has(n));
  if (secretsPresent.length) {
    evidence.push(
      ev(
        'set (presence only)',
        secretsPresent
          .map(([n, info]) => `${n} (${info.length} chars)`)
          .sort()
          .join(', '),
      ),
    );
  }

  if (missing['fails-closed'].length > 0) {
    return bad(
      `${missing['fails-closed'].length} variable${missing['fails-closed'].length === 1 ? '' : 's'} that fail closed are unset: ${missing['fails-closed'].map((e) => e.name).join(', ')}.`,
      evidence,
    );
  }
  if (missing.feature.length > 0) {
    return warn(
      `${missing.feature.length} feature${missing.feature.length === 1 ? '' : 's'} silently disabled by unset variables: ${missing.feature.map((e) => e.name).join(', ')}.`,
      evidence,
    );
  }
  return ok(
    missing.optional.length
      ? `Everything required is set; ${missing.optional.length} optional variable${missing.optional.length === 1 ? '' : 's'} rely on their coded defaults.`
      : 'Every variable in the manifest is set.',
    evidence,
  );
}
