import { decideOpsAlert, OpsAlertInput } from './ops-alert-decision';

// A notifier fails in two directions and BOTH are quiet: saying nothing when
// something is wrong, and saying the same thing every half hour until the
// operator mutes the channel — at which point the next real problem is
// invisible too. Every test here is one of those.

const NOON_SAST = new Date(Date.UTC(2026, 7, 19, 10, 0, 0)); // 12:00 SAST
const TWO_AM_SAST = new Date(Date.UTC(2026, 7, 19, 0, 0, 0)); // 02:00 SAST

const input = (over: Partial<OpsAlertInput> = {}): OpsAlertInput => ({
  alerts: [],
  backupLastRun: new Date(NOON_SAST.getTime() - 2 * 3_600_000),
  lastFingerprint: null,
  config: { phone: '0821234567', quietHours: false },
  now: NOON_SAST,
  ...over,
});

const failure = { type: 'BACKUP_FAILED', context: 'Nightly backup FAILED.' };

describe('when it speaks', () => {
  it('texts about an unresolved alert', () => {
    const d = decideOpsAlert(input({ alerts: [failure] }));
    expect(d.send).toBe(true);
    expect(d.message).toContain('BACKUP_FAILED');
    expect(d.message).toContain('/admin/alerts');
  });

  it('texts when the backup has simply STOPPED RUNNING', () => {
    // The case the on-box script cannot report about itself: a removed cron, or
    // a box that was off, has nothing left to speak with.
    const d = decideOpsAlert(
      input({ backupLastRun: new Date(NOON_SAST.getTime() - 50 * 3_600_000) }),
    );
    expect(d.send).toBe(true);
    expect(d.message).toMatch(/No successful backup for 50h/);
  });

  it('says so when a backup has NEVER been recorded', () => {
    const d = decideOpsAlert(input({ backupLastRun: null }));
    expect(d.send).toBe(true);
    expect(d.message).toMatch(/No successful backup has ever been recorded/i);
  });

  it('tolerates a late run without crying wolf', () => {
    // 02:40 instead of 02:10 is not a problem, and a notifier that flags it
    // becomes one.
    const d = decideOpsAlert(
      input({ backupLastRun: new Date(NOON_SAST.getTime() - 25 * 3_600_000) }),
    );
    expect(d.send).toBe(false);
  });

  it('reports several problems in one message, not several messages', () => {
    const d = decideOpsAlert(
      input({
        alerts: [failure, { type: 'BACKUP_FAILED', context: 'and another' }],
        backupLastRun: null,
      }),
    );
    expect(d.message!.split('\n').length).toBeGreaterThan(3);
  });
});

describe('when it stays quiet', () => {
  it('says nothing when nothing is wrong', () => {
    const d = decideOpsAlert(input());
    expect(d.send).toBe(false);
    expect(d.clear).toBe(true);
  });

  it('sends nothing at all with no phone configured', () => {
    // Unconfigured is silent, not an error, and certainly not a crash every
    // thirty minutes.
    const d = decideOpsAlert(
      input({ alerts: [failure], config: { phone: '', quietHours: false } }),
    );
    expect(d.send).toBe(false);
    expect(d.reason).toMatch(/no phone/i);
  });

  it('does not repeat an identical problem', () => {
    const first = decideOpsAlert(input({ alerts: [failure] }));
    const second = decideOpsAlert(
      input({ alerts: [failure], lastFingerprint: first.fingerprint }),
    );
    expect(first.send).toBe(true);
    expect(second.send).toBe(false);
    expect(second.reason).toMatch(/already sent/i);
  });

  it('DOES speak again when the problem changes', () => {
    const first = decideOpsAlert(input({ alerts: [failure] }));
    const second = decideOpsAlert(
      input({
        alerts: [{ type: 'BACKUP_FAILED', context: 'something else broke' }],
        lastFingerprint: first.fingerprint,
      }),
    );
    expect(second.send).toBe(true);
  });

  it('clears once healthy, so the NEXT problem is not mistaken for the last', () => {
    const healthy = decideOpsAlert(input({ lastFingerprint: 'old-problem' }));
    expect(healthy.clear).toBe(true);

    // …and with the fingerprint cleared, the same problem sends again.
    const again = decideOpsAlert(input({ alerts: [failure], lastFingerprint: null }));
    expect(again.send).toBe(true);
  });
});

describe('quiet hours', () => {
  it('holds a 02:00 alert', () => {
    // A backup that failed at 02:10 will be just as broken at 07:00, and a 3am
    // text for something that can wait gets the channel muted.
    const d = decideOpsAlert(
      input({
        alerts: [failure],
        now: TWO_AM_SAST,
        config: { phone: '0821234567', quietHours: true },
      }),
    );
    expect(d.send).toBe(false);
    expect(d.reason).toMatch(/quiet hours/i);
  });

  it('sends the same alert during the day', () => {
    const d = decideOpsAlert(
      input({
        alerts: [failure],
        now: NOON_SAST,
        config: { phone: '0821234567', quietHours: true },
      }),
    );
    expect(d.send).toBe(true);
  });

  it('sends at 02:00 when quiet hours are off', () => {
    const d = decideOpsAlert(
      input({
        alerts: [failure],
        now: TWO_AM_SAST,
        config: { phone: '0821234567', quietHours: false },
      }),
    );
    expect(d.send).toBe(true);
  });

  it('does NOT mark a held alert as sent', () => {
    // Otherwise the 02:00 pass would suppress the 07:00 one and the operator
    // would never hear about it at all.
    const held = decideOpsAlert(
      input({
        alerts: [failure],
        now: TWO_AM_SAST,
        config: { phone: '0821234567', quietHours: true },
      }),
    );
    expect(held.fingerprint).toBeNull();
    expect(held.clear).toBe(false);

    const morning = decideOpsAlert(
      input({
        alerts: [failure],
        now: NOON_SAST,
        config: { phone: '0821234567', quietHours: true },
        lastFingerprint: held.fingerprint,
      }),
    );
    expect(morning.send).toBe(true);
  });

  it('treats SAST as UTC+2 all year — South Africa has no daylight saving', () => {
    // 05:59 SAST is quiet, 06:00 is not.
    const quiet = decideOpsAlert(
      input({
        alerts: [failure],
        now: new Date(Date.UTC(2026, 7, 19, 3, 59, 0)),
        config: { phone: '0821234567', quietHours: true },
      }),
    );
    const awake = decideOpsAlert(
      input({
        alerts: [failure],
        now: new Date(Date.UTC(2026, 7, 19, 4, 0, 0)),
        config: { phone: '0821234567', quietHours: true },
      }),
    );
    expect(quiet.send).toBe(false);
    expect(awake.send).toBe(true);
  });
});
