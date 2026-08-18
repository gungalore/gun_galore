// ────────────────────────────────────────────────────────────────────
// WHETHER TO TEXT THE OPERATOR, AND WHAT TO SAY.
//
// Pure — no Nest, no Prisma, no clock, no SMS. The cron does the IO and this
// makes every decision, which is the only way it can be tested: importing
// TasksService pulls in the whole dependency chain down to meilisearch's ESM
// build, which Jest cannot load.
//
// A notifier fails in two directions and BOTH are quiet:
//
//   SAYING NOTHING when something is wrong — the failure the operator finds out
//   about weeks later, when they need the backup.
//
//   SAYING THE SAME THING every half hour until they mute the channel, at which
//   point the next real problem is invisible too.
//
// So there is a fingerprint, and it resets when things go healthy.
// ────────────────────────────────────────────────────────────────────

export interface OpsAlertInput {
  /** Unresolved, urgent alerts of the watched types. */
  alerts: { type: string; context: string | null }[];
  /** When the nightly backup last SUCCEEDED. Null = never. */
  backupLastRun: Date | null;
  /** What was last texted, so an unchanged problem stays quiet. */
  lastFingerprint: string | null;
  config: { phone: string; quietHours: boolean };
  now: Date;
}

export interface OpsAlertDecision {
  send: boolean;
  message: string | null;
  fingerprint: string | null;
  /** True when everything is healthy, so the caller clears the fingerprint. */
  clear: boolean;
  /** For the log — why nothing was sent. */
  reason: string;
}

/**
 * A successful backup is expected daily. 26 hours allows for a late run and the
 * half-hour check interval without crying wolf on a job that simply ran at
 * 02:40 instead of 02:10.
 */
const BACKUP_STALE_HOURS = 26;

/** SAST is UTC+2 all year — South Africa has no daylight saving. */
function sastHour(now: Date): number {
  return new Date(now.getTime() + 2 * 60 * 60 * 1000).getUTCHours();
}

export function decideOpsAlert(input: OpsAlertInput): OpsAlertDecision {
  const { alerts, backupLastRun, lastFingerprint, config, now } = input;

  if (!config.phone) {
    return {
      send: false,
      message: null,
      fingerprint: null,
      clear: false,
      reason: 'no phone configured',
    };
  }

  const lines: string[] = [];
  for (const a of alerts.slice(0, 5)) {
    lines.push(`${a.type}: ${(a.context ?? '').slice(0, 110)}`);
  }

  // The case the on-box script cannot report about itself: a cron that was
  // removed, or a box that was off, has nothing left to speak with.
  const ageHours = backupLastRun
    ? (now.getTime() - backupLastRun.getTime()) / 3_600_000
    : Infinity;
  if (ageHours > BACKUP_STALE_HOURS) {
    lines.push(
      backupLastRun
        ? `No successful backup for ${Math.floor(ageHours)}h.`
        : 'No successful backup has ever been recorded.',
    );
  }

  if (!lines.length) {
    // Healthy. Clear the fingerprint so the NEXT problem sends at once rather
    // than being mistaken for the last one.
    return {
      send: false,
      message: null,
      fingerprint: null,
      clear: true,
      reason: 'nothing wrong',
    };
  }

  const fingerprint = lines.join('|').slice(0, 500);

  // QUIET HOURS come AFTER the fingerprint is computed but BEFORE the send, so
  // a problem raised at 02:10 is still recognised as the same problem at 07:00
  // rather than arriving twice.
  if (config.quietHours) {
    const h = sastHour(now);
    if (h >= 22 || h < 6) {
      return {
        send: false,
        message: null,
        fingerprint: null,
        clear: false,
        reason: 'quiet hours (22:00-06:00 SAST)',
      };
    }
  }

  if (lastFingerprint === fingerprint) {
    return {
      send: false,
      message: null,
      fingerprint,
      clear: false,
      reason: 'already sent for this exact problem',
    };
  }

  return {
    send: true,
    message: `All Outdoor ops:\n${lines.join('\n')}\nSee /admin/alerts.`,
    fingerprint,
    clear: false,
    reason: 'sending',
  };
}
