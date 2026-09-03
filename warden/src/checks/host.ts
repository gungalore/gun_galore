// warden/src/checks/host.ts
//
// Disk, memory, load, uptime. The cheap end of the board — these run every
// sweep because they are two file reads and one `df`, and because they are
// the checks most likely to explain something else that is failing.
//
// Disk and memory both feed Warden's own history file: "how full" is a
// point-in-time fact, "filling at 3 GiB/day" is the one an operator can
// act on, and the second does not exist without the first being kept.

import type { CheckModule, CheckOutcome, Evidence } from '../types.js';
import { bad, bytes, cmd, ev, notMeasured, ok, unknown, warn } from './result.js';
import { ratePerDay } from './history.js';
import { parseDf, parseLoadavg, parseMeminfo, parseUptimeSeconds } from './lib/parse.js';

const DF_ARGS = ['-B1', '--output=source,fstype,size,used,avail,pcent,target', '-x', 'tmpfs', '-x', 'devtmpfs'];

/** Under this on the mount that holds the app, the database and the
 *  uploads, a `next build` alone can fill the rest — see infra/setup's
 *  note that all three share one disk on this box. */
const CRITICAL_FREE_BYTES = 2 * 1024 * 1024 * 1024;

export const diskCheck: CheckModule = {
  id: 'host-disk',
  title: 'Disk, per mount',
  cost: 'cheap',
  cadenceMs: 5 * 60_000,
  async run(ctx): Promise<CheckOutcome> {
    const out = await ctx.run('df', DF_ARGS, { timeoutMs: 5_000 });
    const from = cmd('df', DF_ARGS);
    if (out.exitCode !== 0) {
      return unknown(`df exited ${out.exitCode ?? 'without a code'}: ${firstLine(out.stderr)}`, [ev('command', from)]);
    }
    const { mounts, unparsed } = parseDf(out.stdout);
    if (mounts.length === 0) {
      // No readable mount line is NOT "no disks" — it is a df we do not
      // understand, and saying "0% used" here would be the worst kind of
      // lie this board can tell.
      return unknown(`df ran but produced no readable mount lines (${unparsed} unparsed)`, [ev('command', from)]);
    }

    const evidence: Evidence[] = [];
    let worst: 'ok' | 'warn' | 'bad' = 'ok';
    const alarms: string[] = [];
    const appMount = mountFor(ctx.config.appRoot, mounts.map((m) => m.target));

    for (const m of mounts) {
      await ctx.history.record(`disk:${m.target}`, m.usedBytes, ctx.now());
      const rate = ratePerDay(await ctx.history.recent(`disk:${m.target}`));
      const critical = m.target === appMount && m.availBytes < CRITICAL_FREE_BYTES;
      if (m.usePct >= 90 || critical) {
        worst = 'bad';
        alarms.push(`${m.target} at ${m.usePct}% (${bytes(m.availBytes)} free)`);
      } else if (m.usePct >= 80 && worst !== 'bad') {
        worst = 'warn';
        alarms.push(`${m.target} at ${m.usePct}%`);
      }
      evidence.push(
        ev(
          `${m.target} (${m.source})`,
          `${m.usePct}% used — ${bytes(m.usedBytes)} of ${bytes(m.sizeBytes)}, ${bytes(m.availBytes)} free`,
          from,
        ),
      );
      if (rate.ok) {
        const perDay = rate.perDay;
        const daysLeft = perDay > 0 ? m.availBytes / perDay : null;
        evidence.push(
          ev(
            `${m.target} growth`,
            `${perDay >= 0 ? '+' : ''}${bytes(Math.abs(perDay))}/day over ${Math.round(rate.spanMs / 3_600_000)}h` +
              (daysLeft !== null && daysLeft < 120 ? ` — full in about ${Math.round(daysLeft)} days at this rate` : ''),
          ),
        );
        if (daysLeft !== null && daysLeft < 14 && worst !== 'bad') {
          worst = 'warn';
          alarms.push(`${m.target} fills in about ${Math.round(daysLeft)} days`);
        }
      } else {
        evidence.push(notMeasured(`${m.target} growth`, rate.reason));
      }
    }
    if (unparsed > 0) evidence.push(ev('unparsed df lines', String(unparsed), from));

    if (worst === 'bad') return bad(`Disk is critical: ${alarms.join('; ')}.`, evidence);
    if (worst === 'warn') return warn(`Disk needs an eye: ${alarms.join('; ')}.`, evidence);
    return ok(`All ${mounts.length} mounts are under 80% used.`, evidence);
  },
};

export const memoryCheck: CheckModule = {
  id: 'host-memory',
  title: 'Memory and swap',
  cost: 'cheap',
  cadenceMs: 5 * 60_000,
  async run(ctx): Promise<CheckOutcome> {
    const read = await ctx.readFile('/proc/meminfo');
    if (!read.ok) return unknown(read.error);
    const info = parseMeminfo(read.value);
    if (!info) return unknown('/proc/meminfo has no MemTotal/MemAvailable — not a Linux box, or a kernel we do not parse');

    await ctx.history.record('mem:swapUsed', info.swapUsedBytes, ctx.now());
    const swapRate = ratePerDay(await ctx.history.recent('mem:swapUsed'));
    const availPct = (info.availableBytes / info.totalBytes) * 100;
    const swapPct = info.swapTotalBytes > 0 ? (info.swapUsedBytes / info.swapTotalBytes) * 100 : 0;

    const evidence: Evidence[] = [
      ev('available', `${bytes(info.availableBytes)} of ${bytes(info.totalBytes)} (${availPct.toFixed(1)}%)`, 'cat /proc/meminfo'),
      ev('swap used', info.swapTotalBytes > 0 ? `${bytes(info.swapUsedBytes)} of ${bytes(info.swapTotalBytes)} (${swapPct.toFixed(1)}%)` : 'no swap configured'),
      swapRate.ok
        ? ev('swap trend', `${swapRate.perDay >= 0 ? '+' : ''}${bytes(Math.abs(swapRate.perDay))}/day`)
        : notMeasured('swap trend', swapRate.reason),
    ];

    // Swap on this box exists to survive `next build`'s >2GB peak, not to
    // be used continuously — swap filling while nothing is building means
    // the box is undersized, which is why the trend matters more than the
    // level.
    if (availPct < 5) return bad(`Only ${availPct.toFixed(1)}% of memory is available.`, evidence);
    if (availPct < 15) return warn(`Memory is tight: ${availPct.toFixed(1)}% available.`, evidence);
    if (swapPct > 25 && swapRate.ok && swapRate.perDay > 0) {
      return warn(`Swap is ${swapPct.toFixed(0)}% used and still climbing outside a build window.`, evidence);
    }
    return ok(`${bytes(info.availableBytes)} available (${availPct.toFixed(0)}%), swap quiet.`, evidence);
  },
};

export const loadCheck: CheckModule = {
  id: 'host-load',
  title: 'Load average',
  cost: 'cheap',
  cadenceMs: 5 * 60_000,
  async run(ctx): Promise<CheckOutcome> {
    const read = await ctx.readFile('/proc/loadavg');
    if (!read.ok) return unknown(read.error);
    const load = parseLoadavg(read.value);
    if (!load) return unknown(`/proc/loadavg is not in the expected shape: ${firstLine(read.value)}`);
    const cpus = ctx.cpuCount();
    const evidence: Evidence[] = [
      ev('1 / 5 / 15 min', `${load.one.toFixed(2)} / ${load.five.toFixed(2)} / ${load.fifteen.toFixed(2)}`, 'cat /proc/loadavg'),
      ev('vCPUs', String(cpus)),
    ];
    if (load.five >= cpus * 2) return bad(`Load ${load.five.toFixed(2)} over five minutes on ${cpus} vCPUs.`, evidence);
    if (load.one >= cpus) return warn(`Load ${load.one.toFixed(2)} is at or above the ${cpus} vCPUs available.`, evidence);
    return ok(`Load ${load.one.toFixed(2)} on ${cpus} vCPUs.`, evidence);
  },
};

export const uptimeCheck: CheckModule = {
  id: 'host-uptime',
  title: 'Uptime',
  cost: 'cheap',
  cadenceMs: 10 * 60_000,
  async run(ctx): Promise<CheckOutcome> {
    const read = await ctx.readFile('/proc/uptime');
    if (!read.ok) return unknown(read.error);
    const seconds = parseUptimeSeconds(read.value);
    if (seconds === null) return unknown(`/proc/uptime is not in the expected shape: ${firstLine(read.value)}`);
    const bootedAt = new Date(ctx.now().getTime() - seconds * 1000);
    const evidence: Evidence[] = [
      ev('up for', humanDuration(seconds), 'cat /proc/uptime'),
      ev('booted at', bootedAt.toISOString()),
    ];
    // A recent boot nobody mentioned is worth saying out loud — it is the
    // context for a pm2 restart count that reset, or a cron that has not
    // run yet today.
    if (seconds < 30 * 60) return warn(`The box rebooted ${humanDuration(seconds)} ago.`, evidence);
    return ok(`Up ${humanDuration(seconds)}.`, evidence);
  },
};

export const hostChecks: CheckModule[] = [diskCheck, memoryCheck, loadCheck, uptimeCheck];

// ── local helpers ───────────────────────────────────────────────────────

/** Longest mount target that is a prefix of `p` — the mount that actually
 *  holds it. Naive matching would credit "/" for everything. */
function mountFor(p: string, targets: string[]): string | null {
  let best: string | null = null;
  for (const t of targets) {
    if (p === t || p.startsWith(t.endsWith('/') ? t : `${t}/`)) {
      if (!best || t.length > best.length) best = t;
    }
  }
  return best;
}

export function firstLine(text: string): string {
  const line = (text ?? '').trim().split('\n')[0] ?? '';
  return line.length > 300 ? `${line.slice(0, 300)}…` : line || '(no output)';
}

function humanDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
