import { MotivationStatus } from '@prisma/client';
import {
  REGENERABLE,
  STALE_GENERATION_MS,
  answersFingerprint,
  advisoryIssues,
  gateFeedbackIssues,
  reasonNeeded,
} from './motivation-generation.service';

// ────────────────────────────────────────────────────────────────────
// A GENERATION THAT DIED MID-FLIGHT MUST NOT LOCK THE MEMBER OUT FOREVER.
//
// ⚠️ THIS HAPPENED, IN PRODUCTION, ON 2026-09-10. `pm2 reload` is a restart on
// this box — fork mode, one instance, which CLAUDE.md says in as many words —
// so a deploy while somebody is generating kills the request in flight. The row
// stays GENERATING; GENERATING is not in REGENERABLE; and every retry from then
// on is answered "This document is already being prepared. Give it a moment."
// MO000075 sat like that until the status was edited by hand against the
// production database.
//
// The same thing happens on a crash, an OOM kill, or the nightly reboot. It is
// not a deploy problem, it is a missing recovery path.
// ────────────────────────────────────────────────────────────────────

describe('the stale-generation window', () => {
  it('⚠️ IS LONGER THAN THE SLOWEST REAL PASS, so it cannot race a live one', () => {
    /**
     * The slowest run observed on MO000075 was about two minutes: three
     * drafts at five to nine seconds each, a gate at 37.8 s and a verify at
     * 51.6 s. Ten minutes leaves room for a much worse day on the provider
     * without ever reclaiming a generation that is still running.
     */
    const slowestObservedMs = 2 * 60 * 1000;
    expect(STALE_GENERATION_MS).toBeGreaterThan(slowestObservedMs * 4);
  });

  it('⚠️ IS SHORT ENOUGH THAT A STRANDED MEMBER IS NOT WAITING ON AN ADMIN', () => {
    // The alternative to this number is a support ticket and a hand-edited
    // row, which is what it cost the first time.
    expect(STALE_GENERATION_MS).toBeLessThanOrEqual(15 * 60 * 1000);
  });
});

describe('⚠️ WHAT MAY BE CLAIMED', () => {
  it('never lists GENERATING as ordinarily regenerable', () => {
    /**
     * The recovery is deliberately NOT "add GENERATING to REGENERABLE". That
     * would let two clicks a second apart both call the model, which is the
     * duplicated spend the compare-and-swap exists to prevent. Only a
     * GENERATING row that has sat untouched past the window may be re-claimed,
     * and the staleness is part of the WHERE rather than of this list.
     */
    expect(REGENERABLE).not.toContain(MotivationStatus.GENERATING);
  });

  it('lets a finished or failed document be generated again', () => {
    expect(REGENERABLE).toContain(MotivationStatus.COMPLETED);
    expect(REGENERABLE).toContain(MotivationStatus.FAILED);
  });

  it('⚠️ NEVER LETS AN ABANDONED ONE BE PICKED BACK UP', () => {
    // An admin voided it, or the member walked away. Regenerating would spend
    // money on a document nobody is waiting for.
    expect(REGENERABLE).not.toContain(MotivationStatus.ABANDONED);
  });
});

describe('the automatic reason', () => {
  // ⚠️ THE APPLICANT IS NEVER ASKED TO WRITE ONE. Operator, 2026-09-20. The
  // reason is generated from the pack's own facts when the box is empty, so
  // the guard has to fire exactly when there is nothing there.
  it('is needed when the applicant wrote nothing', () => {
    expect(reasonNeeded({})).toBe(true);
    expect(reasonNeeded({ firearm_fit_reason: '' })).toBe(true);
    expect(reasonNeeded({ firearm_fit_reason: '   ' })).toBe(true);
  });

  it('is NOT needed when the applicant wrote one', () => {
    expect(
      reasonNeeded({ firearm_fit_reason: 'The low recoil suits my practice.' }),
    ).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// THE GATE'S FINDINGS REACH THE NEXT WRITER RUN.
// ────────────────────────────────────────────────────────────────────
describe('gate feedback', () => {
  it('reads the verdict issues, defensively', () => {
    expect(gateFeedbackIssues({ issues: ['a', '', 'b'] })).toEqual(['a', 'b']);
    expect(gateFeedbackIssues(null)).toEqual([]);
    expect(gateFeedbackIssues({})).toEqual([]);
    expect(gateFeedbackIssues({ issues: 'nope' })).toEqual([]);
  });

  it('caps the list so a chatty verdict cannot flood the retry', () => {
    const many = Array.from({ length: 20 }, (_, i) => `issue ${i}`);
    expect(gateFeedbackIssues({ issues: many })).toHaveLength(8);
  });
});

// ────────────────────────────────────────────────────────────────────
// THE CYCLE RESET KEY, AND THE ADVISORY REPETITION NOTES.
// ────────────────────────────────────────────────────────────────────
describe('answers fingerprint', () => {
  it('is stable and order-independent, and moves when an answer does', () => {
    const a = { a: '1', b: '2' };
    const b = { b: '2', a: '1' };
    expect(answersFingerprint(a)).toBe(answersFingerprint(b));
    expect(answersFingerprint({ ...a, a: '9' })).not.toBe(
      answersFingerprint(a),
    );
  });
});

describe('advisory issues', () => {
  it('never fails a clean document', () => {
    expect(
      advisoryIssues(
        'I hunt impala at 150 m in the Karoo.\n\nMy competency is at Annexure C.',
        'S16_DEDICATED_HUNTER' as never,
      ),
    ).toEqual([]);
  });

  it('names repeated sentences as advice, not a refusal', () => {
    const repeated =
      'The species I target include impala, kudu and blesbok in the bushveld. ' +
      'The species I target include impala, kudu and blesbok in the bushveld.';
    const out = advisoryIssues(repeated, 'S16_DEDICATED_HUNTER' as never);
    expect(out.join(' ')).toContain('repeats');
  });
});
