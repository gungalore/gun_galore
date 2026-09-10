import { MotivationStatus } from '@prisma/client';
import {
  REGENERABLE,
  STALE_GENERATION_MS,
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
