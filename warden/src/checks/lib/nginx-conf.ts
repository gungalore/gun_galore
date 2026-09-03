// warden/src/checks/lib/nginx-conf.ts
//
// Reading the config nginx is ACTUALLY serving, which is not the same
// thing as the config in the repo and — on this box — is known to differ.
// The repo's infra/nginx/alloutdoor.conf still says gungalore.co.za and
// still says proxy_read_timeout 120s; the live one says 60s. Every check
// that has an opinion about nginx therefore reads from HERE, and diffs
// against the repo copy rather than trusting it.
//
// Two ways in, in order of truth:
//   1. `nginx -T` — the merged, as-loaded config. Usually needs root, so
//      it is tried and allowed to fail.
//   2. the files in sites-enabled — what would load on the next reload.
// Neither working is an UNKNOWN with both reasons stated, never a silent
// fall-through to the repo copy (which would make the drift check compare
// the repo against itself and report "no drift").

import type { Attempt, CheckContext } from '../../types.js';
import { attempt, failed } from '../../types.js';

export interface LiveNginxConfig {
  text: string;
  /** How we got it, for the evidence line. */
  source: string;
}

export async function readLiveNginxConfig(ctx: CheckContext): Promise<Attempt<LiveNginxConfig>> {
  const dumped = await ctx.run('nginx', ['-T'], { timeoutMs: 8_000 });
  if (dumped.exitCode === 0 && dumped.stdout.trim()) {
    return attempt({ text: dumped.stdout, source: 'nginx -T' });
  }
  const dumpReason = `nginx -T exited ${dumped.exitCode ?? 'without a code'}${
    dumped.stderr.trim() ? `: ${dumped.stderr.trim().split('\n')[0]}` : ''
  }`;

  const dir = ctx.config.nginxSitesEnabledDir;
  const listed = await ctx.listDir(dir);
  if (!listed.ok) return failed<LiveNginxConfig>(`${dumpReason}; and ${listed.error}`);

  const parts: string[] = [];
  const readFailures: string[] = [];
  for (const name of listed.value) {
    const read = await ctx.readFile(`${dir}/${name}`);
    if (read.ok) parts.push(`# ${dir}/${name}\n${read.value}`);
    else readFailures.push(read.error);
  }
  if (parts.length === 0) {
    return failed<LiveNginxConfig>(
      `${dumpReason}; and no file under ${dir} could be read${readFailures.length ? ` (${readFailures[0]})` : ''}`,
    );
  }
  return attempt({
    text: parts.join('\n'),
    source: `${dir}/* (nginx -T unavailable — ${dumpReason})`,
  });
}
