// warden/src/checks/nginx.ts
//
// Error rates, the error-log tail, and THE PROXY TIMEOUT DRIFT.
//
// 🚨 The timeout check is not routine housekeeping. Nothing on this site
// may take longer than 60s: nginx cuts at its proxy_read_timeout and
// Cloudflare cuts at ~100s regardless, so a request nginx is willing to
// wait 120s for can never complete end to end — it becomes a 524 at the
// edge and an operator staring at a request that "worked locally". The
// repo's infra/nginx/alloutdoor.conf says 90s and 120s; the live config
// says 60s. This check prints BOTH every sweep and names the delta,
// because whichever one you trust, the other one is what is running.
//
// ⚠️ nginx's access log only sees origin-bound traffic. Cloudflare-cached
// assets and Cloudflare's own edge errors (522/523, WAF blocks) never
// reach this box, so the error rate here is origin-facing, not what a
// visitor experienced. The verdict says so rather than overclaiming.

import type { CheckModule, CheckOutcome, Evidence } from '../types.js';
import { bad, cmd, ev, ok, unknown, warn } from './result.js';
import { readLiveNginxConfig } from './lib/nginx-conf.js';
import { parseAccessLogStatuses, parseProxyTimeouts } from './lib/parse.js';
import { firstLine } from './host.js';

/** Lines of access log to read per sweep. Big enough to be a rate on a
 *  quiet site, small enough that this stays a cheap tail rather than a
 *  scan of a rotated multi-gigabyte log. */
const ACCESS_WINDOW_LINES = 4000;
const ERROR_TAIL_LINES = 40;

/** House rule: no request may take longer than this. */
const HOUSE_MAX_SECONDS = 60;
/** Cloudflare gives up at about here whatever nginx allows. */
const EDGE_MAX_SECONDS = 100;

export const nginxErrorRateCheck: CheckModule = {
  id: 'nginx-error-rate',
  title: 'nginx 4xx / 5xx rate',
  cost: 'moderate',
  cadenceMs: 5 * 60_000,
  async run(ctx): Promise<CheckOutcome> {
    const args = ['-n', String(ACCESS_WINDOW_LINES), ctx.config.nginxAccessLog];
    const out = await ctx.run('tail', args, { timeoutMs: 8_000 });
    const from = cmd('tail', args);
    if (out.exitCode !== 0) {
      // Almost always EACCES: /var/log/nginx is root:adm and Warden's
      // service user is not in adm. That is a provisioning fact, not a
      // clean log — it must never read as "no errors".
      return unknown(`cannot read the access log — tail exited ${out.exitCode ?? 'without a code'}: ${firstLine(out.stderr)}`, [
        ev('command', from),
      ]);
    }
    const counts = parseAccessLogStatuses(out.stdout);
    if (counts.total === 0) {
      return unknown(`the access log tail was empty (${ctx.config.nginxAccessLog}) — no traffic recorded, or the wrong path`, [
        ev('command', from),
      ]);
    }
    if (counts.unparsed > counts.total / 2) {
      return unknown(
        `${counts.unparsed} of ${counts.total} log lines did not match the combined format — check nginx -T for a custom log_format`,
        [ev('command', from)],
      );
    }

    const readable = counts.total - counts.unparsed;
    const fivePct = (counts.byClass['5xx'] / readable) * 100;
    const fourPct = (counts.byClass['4xx'] / readable) * 100;
    const evidence: Evidence[] = [
      ev('window', `${readable} readable requests of the last ${counts.total} lines`, from),
      ev('5xx', `${counts.byClass['5xx']} (${fivePct.toFixed(2)}%)`),
      ev('4xx', `${counts.byClass['4xx']} (${fourPct.toFixed(2)}%)`),
      ev('2xx / 3xx', `${counts.byClass['2xx']} / ${counts.byClass['3xx']}`),
      ev('scope', 'origin-bound requests only — Cloudflare-cached hits and edge errors never reach this log'),
    ];
    if (counts.unparsed > 0) evidence.push(ev('unparsed lines', String(counts.unparsed)));

    if (fivePct >= 2) return bad(`${counts.byClass['5xx']} of the last ${readable} origin requests were 5xx (${fivePct.toFixed(2)}%).`, evidence);
    if (fivePct >= 0.5) return warn(`5xx rate is ${fivePct.toFixed(2)}% over the last ${readable} origin requests.`, evidence);
    if (fourPct >= 25) return warn(`4xx rate is ${fourPct.toFixed(1)}% over the last ${readable} origin requests.`, evidence);
    return ok(`5xx at ${fivePct.toFixed(2)}% over the last ${readable} origin requests.`, evidence);
  },
};

export const nginxErrorLogCheck: CheckModule = {
  id: 'nginx-error-log',
  title: 'nginx error log',
  cost: 'cheap',
  cadenceMs: 5 * 60_000,
  async run(ctx): Promise<CheckOutcome> {
    const args = ['-n', String(ERROR_TAIL_LINES), ctx.config.nginxErrorLog];
    const out = await ctx.run('tail', args, { timeoutMs: 8_000 });
    const from = cmd('tail', args);
    if (out.exitCode !== 0) {
      return unknown(`cannot read the error log — tail exited ${out.exitCode ?? 'without a code'}: ${firstLine(out.stderr)}`, [
        ev('command', from),
      ]);
    }
    const lines = out.stdout.split('\n').filter((l) => l.trim());
    const severe = lines.filter((l) => /\[(emerg|alert|crit)\]/.test(l));
    const errors = lines.filter((l) => /\[error\]/.test(l));

    // ⚠️ These lines carry member-supplied text (request URIs, upstream
    // messages). They are DATA. Truncated hard here so a single enormous
    // line cannot dominate the board or the prompt fence.
    const sample = [...severe, ...errors].slice(0, 8).map((l) => (l.length > 240 ? `${l.slice(0, 240)}…` : l));
    const evidence: Evidence[] = [
      ev('window', `last ${lines.length} lines`, from),
      ev('emerg/alert/crit', String(severe.length)),
      ev('error', String(errors.length)),
      ...sample.map((l, i) => ev(`line ${i + 1}`, l)),
    ];

    if (severe.length > 0) return bad(`${severe.length} emerg/alert/crit lines in the last ${lines.length} error-log lines.`, evidence);
    if (errors.length >= 5) return warn(`${errors.length} error lines in the last ${lines.length} error-log lines.`, evidence);
    if (errors.length > 0) return ok(`${errors.length} error lines in the last ${lines.length} — nothing severe.`, evidence);
    return ok(`No error lines in the last ${lines.length}.`, evidence);
  },
};

export const nginxTimeoutDriftCheck: CheckModule = {
  id: 'nginx-proxy-timeout',
  title: 'nginx proxy timeout, live vs repo',
  cost: 'cheap',
  cadenceMs: 30 * 60_000,
  async run(ctx): Promise<CheckOutcome> {
    const live = await readLiveNginxConfig(ctx);
    const repo = await ctx.readFile(ctx.config.nginxRepoConfPath);

    if (!live.ok) {
      // The repo value alone answers nothing — the whole point is the
      // delta, and reporting only the repo's number would state the
      // opposite of the truth on this box.
      return unknown(`cannot read the live nginx config — ${live.error}`, [
        ev('repo copy', repo.ok ? describeTimeouts(parseProxyTimeouts(repo.value)) : `unreadable: ${repo.error}`, ctx.config.nginxRepoConfPath),
      ]);
    }

    const liveTimeouts = parseProxyTimeouts(live.value.text);
    const repoTimeouts = repo.ok ? parseProxyTimeouts(repo.value) : null;
    const liveRead = liveTimeouts.filter((t) => t.directive === 'proxy_read_timeout');

    const evidence: Evidence[] = [
      ev('live', liveTimeouts.length ? describeTimeouts(liveTimeouts) : 'no proxy_*_timeout directive set (nginx default 60s applies)', live.value.source),
      ev(
        'repo',
        repoTimeouts ? describeTimeouts(repoTimeouts) : `unreadable: ${repo.ok ? 'n/a' : repo.error}`,
        ctx.config.nginxRepoConfPath,
      ),
      ev('caps', `house rule ${HOUSE_MAX_SECONDS}s; Cloudflare gives up at about ${EDGE_MAX_SECONDS}s`),
    ];

    const liveSet = new Set(liveTimeouts.map((t) => `${t.directive}=${t.seconds}`));
    const repoSet = new Set((repoTimeouts ?? []).map((t) => `${t.directive}=${t.seconds}`));
    const drifted = repoTimeouts !== null && (liveSet.size !== repoSet.size || [...liveSet].some((k) => !repoSet.has(k)));
    if (drifted) {
      evidence.push(ev('drift', 'the live config and the repo copy do not agree — the live one is what bites'));
    }

    const overEdge = liveRead.filter((t) => t.seconds >= EDGE_MAX_SECONDS);
    const overHouse = liveRead.filter((t) => t.seconds > HOUSE_MAX_SECONDS);

    if (overEdge.length > 0) {
      return bad(
        `Live proxy_read_timeout is ${overEdge.map((t) => `${t.seconds}s`).join(', ')} — past Cloudflare's own ~${EDGE_MAX_SECONDS}s cut-off, so such a request can never complete.`,
        evidence,
      );
    }
    if (overHouse.length > 0) {
      return warn(
        `Live proxy_read_timeout is ${overHouse.map((t) => `${t.seconds}s`).join(', ')}, above the ${HOUSE_MAX_SECONDS}s house rule.`,
        evidence,
      );
    }
    if (drifted) {
      return warn(`Live nginx timeouts differ from the repo copy — repo ${describeTimeouts(repoTimeouts!)}, live ${describeTimeouts(liveTimeouts)}.`, evidence);
    }
    return ok(
      liveRead.length
        ? `Live proxy_read_timeout ${liveRead.map((t) => `${t.seconds}s`).join(', ')}, within the ${HOUSE_MAX_SECONDS}s rule and matching the repo.`
        : `No proxy_*_timeout set; nginx's ${HOUSE_MAX_SECONDS}s default applies.`,
      evidence,
    );
  },
};

export const nginxChecks: CheckModule[] = [nginxErrorRateCheck, nginxErrorLogCheck, nginxTimeoutDriftCheck];

function describeTimeouts(timeouts: { directive: string; seconds: number }[]): string {
  if (timeouts.length === 0) return 'none set';
  const seen = new Map<string, Set<number>>();
  for (const t of timeouts) {
    const set = seen.get(t.directive) ?? new Set<number>();
    set.add(t.seconds);
    seen.set(t.directive, set);
  }
  return [...seen.entries()].map(([d, s]) => `${d} ${[...s].map((n) => `${n}s`).join('/')}`).join(', ');
}
