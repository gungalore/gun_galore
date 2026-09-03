// warden/src/checks/result.ts
//
// Constructors for the four outcomes, plus the small formatters every
// check needs. These exist so that the ONE thing a check must never do —
// report a number nobody measured — takes more effort than doing it
// properly: `unknown()` demands a reason, and `notMeasured()` gives a
// check a way to say "this specific number is missing" INSIDE an otherwise
// healthy row, which is the case that would otherwise become a zero.
//
// 🚨 EVIDENCE IS REDACTED HERE, AND ONLY HERE. `ev()` is the sole
// constructor every check in the registry uses to build an Evidence —
// grep confirms no check builds `{ label, value }` by hand — so redacting
// `value` inside it is a structural guarantee, not a convention a call
// site can forget. It used to be neither: pm2.ts's own crash-log evidence
// carried a comment claiming "secrets are additionally stripped by
// safety/audit.ts's redactor before anything reaches a prompt or a chat
// message" — but src/safety/ was the RETIRED copy, unreachable from
// src/index.ts and since deleted, and the live redactor in
// exec/audit.ts was wired into exactly two call sites, neither of which is
// diagnose/prompt.ts or state/messages.ts — the two places that actually
// turn evidence into prompt facts and chat messages. A pm2 crash tail or
// an nginx error line can carry an env value a member's request echoed
// back, or a Postgres error naming a config value from a bad insert; that
// text was reaching Claude's diagnosis prompt AND the Desk's chat thread
// with no redaction pass at all — rule 8 broken by every one of the ~29
// checks that call ev(), not by one call site.
//
// `from` (the command that produced a value, e.g. `tail -c 5000
// /var/log/…`) is templated argv, never external content, so it is left
// alone — redacting it would cost a process.env scan for no realizable
// gain. `label` is likewise always a check-authored constant.

import type { CheckOutcome, Evidence } from '../types.js';
import { redactSecrets } from '../exec/index.js';

export function ok(verdict: string, evidence: Evidence[]): CheckOutcome {
  return { status: 'ok', verdict, evidence };
}

export function warn(verdict: string, evidence: Evidence[]): CheckOutcome {
  return { status: 'warn', verdict, evidence };
}

export function bad(verdict: string, evidence: Evidence[]): CheckOutcome {
  return { status: 'bad', verdict, evidence };
}

/**
 * A fault no command Warden runs can clear — it needs a commit, a
 * credential or a human decision. `gateKey` names the thing that has to
 * change. Upstream this becomes a red gate: no command, not approvable,
 * not dismissable, re-raised every sweep until the file changes.
 */
export function standingBad(verdict: string, evidence: Evidence[], gateKey: string): CheckOutcome {
  return { status: 'bad', verdict, evidence, standing: true, gateKey };
}

/**
 * Could not measure. The reason is mandatory and is what the board shows
 * next to the em dash. Never phrase it as a finding ("no errors") — phrase
 * it as the wall you hit ("cannot read /var/log/nginx/access.log: EACCES").
 */
export function unknown(reason: string, evidence: Evidence[] = []): CheckOutcome {
  return { status: 'unknown', reason, evidence };
}

export function ev(label: string, value: string, from?: string): Evidence {
  const { text } = redactSecrets(value);
  return from ? { label, value: text, from } : { label, value: text };
}

/**
 * The em dash, in evidence form. Use this for a single number inside an
 * otherwise-measured row — a growth rate with one sample, a last-success
 * timestamp no table records. `value` reads as an explicit absence so it
 * cannot be mistaken for a measurement of zero.
 */
export function notMeasured(label: string, reason: string): Evidence {
  return { label, value: `— (not measured: ${reason})` };
}

/** argv rendered for a human to re-run. Not shell-quoted — it is a label,
 *  never a string anything executes. */
export function cmd(file: string, args: string[]): string {
  return [file, ...args].join(' ');
}

export function bytes(n: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function pct(part: number, whole: number): string {
  if (whole <= 0) return '—';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

export function ageWords(from: Date, to: Date): string {
  const ms = to.getTime() - from.getTime();
  if (!Number.isFinite(ms)) return 'unknown';
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'under a minute';
  if (mins < 90) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${Math.round(hours / 24)} days`;
}

/** Parse a Postgres timestamp / ISO string, or say it could not be read.
 *  Returns null rather than an Invalid Date, so a bad row cannot become
 *  epoch-zero and then "56 years stale". */
export function parseDate(raw: string | undefined | null): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Postgres' default output ("2026-09-02 03:20:11.123+02") parses in V8,
  // but only once the space becomes a T for the ISO path; try raw first so
  // an already-ISO value is untouched.
  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) return direct;
  const iso = new Date(trimmed.replace(' ', 'T'));
  return Number.isNaN(iso.getTime()) ? null : iso;
}
