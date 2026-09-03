// warden/src/checks/pm2.ts
//
// Process state, restart counts, memory headroom, and the tail of whatever
// the app printed as it died.
//
// Two things here are easy to get wrong and both are guarded:
//
//  1. `unstable_restarts` is a COUNTER, not a state. A single reading
//     cannot tell "crash-looping right now" from "crashed once in March".
//     So the count goes into history and the verdict is about the DELTA
//     since the last sweep — a number that does not exist on a first
//     sweep, and is reported as not-measured rather than as zero.
//
//  2. Process NAMES are drifted in this repo: DEPLOYMENT.md says
//     alloutdoor-*, infra/pm2/ecosystem.config.js says gungalore-* under
//     the retired box's path and admits in its own header that it is not
//     what is running. So `pm2 jlist` is ground truth here and the config's
//     expected names are only used to RAISE A FINDING when they disagree —
//     never to decide which processes to look at.

import type { CheckModule, CheckOutcome, Evidence } from '../types.js';
import { bad, bytes, cmd, ev, notMeasured, ok, unknown, warn } from './result.js';
import { parsePm2Jlist, type Pm2Process } from './lib/parse.js';
import { firstLine } from './host.js';

const CRASH_TAIL_LINES = 30;

export const pm2ProcessesCheck: CheckModule = {
  id: 'pm2-processes',
  title: 'pm2 processes',
  cost: 'cheap',
  cadenceMs: 60_000,
  async run(ctx): Promise<CheckOutcome> {
    const out = await ctx.run('pm2', ['jlist'], { timeoutMs: 10_000 });
    const from = cmd('pm2', ['jlist']);
    if (out.exitCode !== 0) {
      return unknown(`pm2 jlist exited ${out.exitCode ?? 'without a code'}: ${firstLine(out.stderr)}`, [ev('command', from)]);
    }
    const processes = parsePm2Jlist(out.stdout, ctx.now().getTime());
    if (processes === null) {
      // 🚨 An unparseable jlist must NEVER become "no processes". That
      // would report a healthy-looking empty board while the site is down.
      return unknown('pm2 jlist did not return a JSON array — cannot tell what is running', [ev('command', from)]);
    }
    if (processes.length === 0) {
      return bad('pm2 reports no processes at all — nothing is running under pm2 on this box.', [ev('command', from)]);
    }

    const evidence: Evidence[] = [];
    let worst: 'ok' | 'warn' | 'bad' = 'ok';
    const alarms: string[] = [];

    for (const p of processes) {
      const ceiling = ctx.config.pm2MemoryCeilings[p.name];
      const memText =
        p.memoryBytes === null
          ? 'memory not reported'
          : ceiling
            ? `${bytes(p.memoryBytes)} of a ${bytes(ceiling)} restart ceiling (${((p.memoryBytes / ceiling) * 100).toFixed(0)}%)`
            : bytes(p.memoryBytes);
      evidence.push(
        ev(
          p.name,
          `${p.status}, up ${p.uptimeMs === null ? 'unknown' : humanMs(p.uptimeMs)}, ${memText}, ${p.restarts ?? '?'} restarts (${p.unstableRestarts ?? '?'} unstable)`,
          from,
        ),
      );

      if (p.status !== 'online') {
        worst = 'bad';
        alarms.push(`${p.name} is ${p.status}`);
      }

      if (p.unstableRestarts !== null) {
        const series = `pm2:unstable:${p.name}`;
        const previous = await ctx.history.recent(series, 2);
        const last = previous.length ? previous[previous.length - 1]!.value : null;
        await ctx.history.record(series, p.unstableRestarts, ctx.now());
        if (last === null) {
          evidence.push(notMeasured(`${p.name} restarts since last sweep`, 'first sweep for this process — no earlier count to compare'));
        } else {
          const delta = p.unstableRestarts - last;
          evidence.push(ev(`${p.name} restarts since last sweep`, String(delta)));
          if (delta > 0) {
            worst = worst === 'bad' ? 'bad' : 'warn';
            alarms.push(`${p.name} restarted ${delta}× since the last sweep`);
          }
        }
      } else {
        evidence.push(notMeasured(`${p.name} unstable restarts`, 'pm2 did not report unstable_restarts for this process'));
      }

      if (ceiling && p.memoryBytes !== null && p.memoryBytes > ceiling * 0.8) {
        worst = worst === 'bad' ? 'bad' : 'warn';
        alarms.push(`${p.name} is at ${((p.memoryBytes / ceiling) * 100).toFixed(0)}% of its memory ceiling`);
      }
    }

    // Name drift is a finding in its own right — a Warden watching the
    // wrong two names would report a healthy board for a dead site.
    const live = new Set(processes.map((p) => p.name));
    const missing = ctx.config.pm2Processes.filter((n) => !live.has(n));
    if (missing.length > 0) {
      worst = worst === 'bad' ? 'bad' : 'warn';
      alarms.push(`expected process${missing.length > 1 ? 'es' : ''} ${missing.join(', ')} not present under that name`);
      evidence.push(ev('name drift', `configured: ${ctx.config.pm2Processes.join(', ')} — live: ${[...live].join(', ')}`, from));
    }

    if (worst === 'bad') return bad(`pm2: ${alarms.join('; ')}.`, evidence);
    if (worst === 'warn') return warn(`pm2: ${alarms.join('; ')}.`, evidence);
    return ok(`All ${processes.length} pm2 processes online and stable.`, evidence);
  },
};

export const pm2CrashOutputCheck: CheckModule = {
  id: 'pm2-crash-output',
  title: 'Recent crash output',
  cost: 'moderate',
  cadenceMs: 10 * 60_000,
  async run(ctx): Promise<CheckOutcome> {
    // Read the process log files directly rather than `pm2 logs`, which
    // wraps everything in colour codes and its own prefixes.
    const files = ctx.config.pm2Processes.map((name) => ({
      name,
      path: `${ctx.config.appRoot}/logs/${name.replace(/^alloutdoor-|^gungalore-/, '')}-error.log`,
    }));

    const evidence: Evidence[] = [];
    const unreadable: string[] = [];
    let sawFatal = false;
    let sawAny = false;

    for (const file of files) {
      const args = ['-n', String(CRASH_TAIL_LINES), file.path];
      const out = await ctx.run('tail', args, { timeoutMs: 5_000 });
      if (out.exitCode !== 0) {
        unreadable.push(`${file.path} (${firstLine(out.stderr)})`);
        continue;
      }
      const lines = out.stdout.split('\n').filter((l) => l.trim());
      if (lines.length === 0) {
        evidence.push(ev(file.name, 'error log is empty', cmd('tail', args)));
        continue;
      }
      sawAny = true;
      const fatal = lines.filter((l) => /FATAL|UnhandledPromiseRejection|Cannot find module|EADDRINUSE|out of memory/i.test(l));
      if (fatal.length) sawFatal = true;
      // ⚠️ App error output can contain member text and, in a bad stack
      // trace, config values. Truncated per line; secrets are stripped by
      // ev() itself (checks/result.ts) before this evidence exists at all —
      // not by anything in src/safety/, which has been deleted.
      for (const [i, l] of lines.slice(-6).entries()) {
        evidence.push(ev(`${file.name} ${i + 1}`, l.length > 240 ? `${l.slice(0, 240)}…` : l, cmd('tail', args)));
      }
    }

    if (!sawAny && unreadable.length === files.length) {
      return unknown(`no process error log could be read: ${unreadable.join('; ')}`);
    }
    if (unreadable.length > 0) evidence.push(notMeasured('some logs', unreadable.join('; ')));

    if (sawFatal) return warn('The tail of a process error log contains a fatal-looking line.', evidence);
    return ok('Nothing fatal in the tail of the process error logs.', evidence);
  },
};

export const pm2Checks: CheckModule[] = [pm2ProcessesCheck, pm2CrashOutputCheck];

function humanMs(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export type { Pm2Process };
