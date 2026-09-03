// warden/src/checks/backups.ts
//
// Did the nightly run, what did it produce, and — the one that matters —
// WHAT IS NOT IN THE SET.
//
// 🚨 backup-set-gap IS A STANDING BAD AND CANNOT RESOLVE ITSELF. The
// nightly 02:10 SAST job (infra/backup/backup.sh) dumps Postgres and tars
// SECURE_UPLOAD_DIR. It never touches CIP_SHEETS_DIR — /home/alloutdoor/data/cip
// by default, the C.I.P. sheet store the Bench and the motivation pipeline
// read — so losing that disk loses those files SILENTLY, with a green
// backup log either side of it. No command Warden may run fixes that: the
// fix is a reviewed edit to backup.sh, by a human, in a commit. Warden
// must never tar the directory itself as a "helpful" one-off — an ad hoc
// copy nobody reviewed is a second thing to get wrong, and it would make
// the board go green while the real gap stayed open.
//
// So this check measures the SCRIPT (does it mention that directory?) and
// reports the EXPOSURE (how many files, how big) as evidence. It clears
// only when the script changes.

import type { CheckModule, CheckOutcome, Evidence } from '../types.js';
import { ageWords, bad, bytes, cmd, ev, notMeasured, ok, unknown, warn } from './result.js';
import { settingUpdatedAt } from './database.js';
import { ratePerDay } from './history.js';

/** The heartbeat backup.sh writes on SUCCESS ONLY — it writes nothing on
 *  failure, and nothing at all when the database is unreachable, which is
 *  why staleness is the signal rather than any status field. */
const HEARTBEAT_KEY = 'cron:lastrun:box-backup';
/** admin-health.service.ts's own rule: stale at 3× the expected interval.
 *  The job is daily with an hour of slack, so 26h × 3. */
const STALE_MS = 3 * 26 * 60 * 60 * 1000;

export const backupLastRunCheck: CheckModule = {
  id: 'backup-last-run',
  title: 'Nightly backup',
  cost: 'cheap',
  cadenceMs: 30 * 60_000,
  async run(ctx): Promise<CheckOutcome> {
    const heartbeat = await settingUpdatedAt(ctx, HEARTBEAT_KEY);
    if (!heartbeat.ok) return unknown(heartbeat.error);

    const alerts = await ctx.queryDb(
      `select "createdAt"::text from "AdminAlert" where type = 'BACKUP_FAILED' and resolved = false order by "createdAt" desc limit 5`,
      { timeoutMs: 5_000 },
    );

    const evidence: Evidence[] = [];
    const now = ctx.now();

    if (heartbeat.at === null) {
      // No row at all means the job has never once succeeded since the
      // heartbeat was introduced — which is not the same as "it ran and
      // failed", and must not be reported as an age.
      evidence.push(notMeasured('last success', `no ${HEARTBEAT_KEY} row exists — the job has never written a success heartbeat`));
    } else {
      evidence.push(ev('last success', `${heartbeat.at.toISOString()} (${ageWords(heartbeat.at, now)} ago)`, `psql -c "select \\"updatedAt\\" from \\"Setting\\" where key='${HEARTBEAT_KEY}'"`));
    }

    if (alerts.ok) {
      evidence.push(ev('open BACKUP_FAILED alerts', alerts.value.length ? alerts.value.map((r) => r[0]).join(', ') : 'none'));
    } else {
      evidence.push(notMeasured('open BACKUP_FAILED alerts', alerts.error));
    }

    const tail = await ctx.run('tail', ['-n', '20', `${ctx.config.backupDir}/backup.log`], { timeoutMs: 5_000 });
    if (tail.exitCode === 0) {
      const last = tail.stdout.split('\n').filter((l) => /=== backup/.test(l)).pop();
      evidence.push(ev('backup.log', last ?? 'no === backup === line in the last 20', cmd('tail', ['-n', '20', `${ctx.config.backupDir}/backup.log`])));
    } else {
      evidence.push(notMeasured('backup.log', `cannot read ${ctx.config.backupDir}/backup.log`));
    }

    if (alerts.ok && alerts.value.length > 0) {
      return bad(`${alerts.value.length} unresolved BACKUP_FAILED alert${alerts.value.length === 1 ? '' : 's'} are open.`, evidence);
    }
    if (heartbeat.at === null) return bad('The nightly backup has never recorded a success.', evidence);
    const age = now.getTime() - heartbeat.at.getTime();
    if (age > STALE_MS) return bad(`The last successful backup was ${ageWords(heartbeat.at, now)} ago.`, evidence);
    if (age > 26 * 60 * 60 * 1000) return warn(`The last successful backup was ${ageWords(heartbeat.at, now)} ago — a night has been missed.`, evidence);
    return ok(`Last successful backup ${ageWords(heartbeat.at, now)} ago.`, evidence);
  },
};

export const backupArtifactsCheck: CheckModule = {
  id: 'backup-artifacts',
  title: 'Backup files on disk',
  cost: 'moderate',
  cadenceMs: 60 * 60_000,
  async run(ctx): Promise<CheckOutcome> {
    const dump = await newestIn(ctx, `${ctx.config.backupDir}/db`, /\.dump$/);
    const uploads = await newestIn(ctx, `${ctx.config.backupDir}/uploads`, /\.tar\.gz$/);

    if (!dump.ok && !uploads.ok) {
      return unknown(`neither backup directory could be read — ${dump.error}; ${uploads.error}`);
    }

    const evidence: Evidence[] = [];
    let verdict: 'ok' | 'warn' | 'bad' = 'ok';
    const notes: string[] = [];

    for (const [label, found] of [['database dump', dump], ['uploads archive', uploads]] as const) {
      if (!found.ok) {
        evidence.push(notMeasured(label, found.error));
        verdict = verdict === 'bad' ? 'bad' : 'warn';
        notes.push(`${label} not readable`);
        continue;
      }
      if (!found.value) {
        evidence.push(ev(label, 'no matching file in the directory'));
        verdict = 'bad';
        notes.push(`no ${label} on disk`);
        continue;
      }
      const file = found.value;
      evidence.push(ev(label, `${file.path} — ${bytes(file.sizeBytes)}, written ${ageWords(new Date(file.mtime), ctx.now())} ago`, `ls -la ${found.dir}`));

      const series = `backup:${label.replace(/\s+/g, '-')}`;
      const previous = await ctx.history.recent(series, 2);
      const last = previous.length ? previous[previous.length - 1]!.value : null;
      await ctx.history.record(series, file.sizeBytes, ctx.now());
      if (last === null) {
        // A dump's size means nothing on its own. "Half of yesterday's" is
        // the finding, and it does not exist yet.
        evidence.push(notMeasured(`${label} vs previous`, 'no earlier size recorded yet'));
      } else if (last > 0 && file.sizeBytes < last * 0.5) {
        verdict = 'bad';
        notes.push(`${label} is less than half its previous size`);
        evidence.push(ev(`${label} vs previous`, `${bytes(file.sizeBytes)} against ${bytes(last)}`));
      } else {
        const rate = ratePerDay(await ctx.history.recent(series));
        evidence.push(
          rate.ok
            ? ev(`${label} trend`, `${rate.perDay >= 0 ? '+' : ''}${bytes(Math.abs(rate.perDay))}/day`)
            : notMeasured(`${label} trend`, rate.reason),
        );
      }
    }

    if (verdict === 'bad') return bad(`Backup files: ${notes.join('; ')}.`, evidence);
    if (verdict === 'warn') return warn(`Backup files: ${notes.join('; ')}.`, evidence);
    return ok('Both the newest dump and the newest uploads archive are present and plausibly sized.', evidence);
  },
};

export const backupSetGapCheck: CheckModule = {
  id: 'backup-set-gap',
  title: 'What the backup does not cover',
  cost: 'cheap',
  cadenceMs: 60 * 60_000,
  async run(ctx): Promise<CheckOutcome> {
    const script = await ctx.readFile(ctx.config.backupScriptPath);
    if (!script.ok) {
      // Cannot read the script, cannot claim it covers anything — and
      // must not claim the gap is closed either.
      return unknown(`cannot read the backup script, so its coverage is unknown — ${script.error}`);
    }
    const cipDir = ctx.config.cipSheetsDir;
    const covered = script.value.includes(cipDir) || /CIP_SHEETS_DIR/.test(script.value);

    // The exposure, measured live. Both of these may fail independently
    // and each says so rather than reporting zero.
    const evidence: Evidence[] = [
      ev('directory', cipDir),
      ev('backup script', ctx.config.backupScriptPath),
      ev('covered by the nightly job', covered ? 'yes — the script now references it' : 'NO'),
      ev('what the script does cover', 'the Postgres dump and SECURE_UPLOAD_DIR'),
    ];

    const found = await ctx.run('find', [cipDir, '-type', 'f'], { timeoutMs: 20_000 });
    if (found.exitCode === 0) {
      const files = found.stdout.split('\n').filter((l) => l.trim()).length;
      evidence.push(ev('files at risk', String(files), cmd('find', [cipDir, '-type', 'f'])));
    } else {
      evidence.push(notMeasured('files at risk', `find exited ${found.exitCode ?? 'without a code'}: ${(found.stderr || '').trim().split('\n')[0] ?? ''}`));
    }

    const du = await ctx.run('du', ['-sb', cipDir], { timeoutMs: 20_000 });
    if (du.exitCode === 0) {
      const size = Number(du.stdout.trim().split(/\s+/)[0]);
      evidence.push(ev('size at risk', Number.isFinite(size) ? bytes(size) : du.stdout.trim(), cmd('du', ['-sb', cipDir])));
    } else {
      evidence.push(notMeasured('size at risk', `du exited ${du.exitCode ?? 'without a code'}: ${(du.stderr || '').trim().split('\n')[0] ?? ''}`));
    }

    if (covered) {
      return ok(`${ctx.config.backupScriptPath} now references ${cipDir} — the gap is closed.`, evidence);
    }
    // Deliberately NOT a proposal: there is no command to approve. It is a
    // red gate, re-raised every sweep, until backup.sh changes.
    return {
      status: 'bad',
      standing: true,
      gateKey: 'BACKUP_SET_CIP',
      verdict: `${cipDir} is not in the backup set — losing that disk loses those files silently, and only an edit to ${ctx.config.backupScriptPath} fixes it.`,
      evidence,
    };
  },
};

export const backupChecks: CheckModule[] = [backupLastRunCheck, backupArtifactsCheck, backupSetGapCheck];

// ── helpers ─────────────────────────────────────────────────────────────

type Newest =
  | { ok: true; dir: string; value: { path: string; sizeBytes: number; mtime: string } | null }
  | { ok: false; error: string };

async function newestIn(ctx: Parameters<CheckModule['run']>[0], dir: string, pattern: RegExp): Promise<Newest> {
  const listed = await ctx.listDir(dir);
  if (!listed.ok) return { ok: false, error: listed.error };
  const candidates = listed.value.filter((n) => pattern.test(n));
  let best: { path: string; sizeBytes: number; mtime: string } | null = null;
  for (const name of candidates) {
    const stat = await ctx.stat(`${dir}/${name}`);
    if (!stat.ok) continue;
    if (!best || stat.value.mtime > best.mtime) {
      best = { path: stat.value.path, sizeBytes: stat.value.sizeBytes, mtime: stat.value.mtime };
    }
  }
  return { ok: true, dir, value: best };
}
