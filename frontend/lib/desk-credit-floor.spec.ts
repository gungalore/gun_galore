import { describe, expect, it } from 'vitest';
import {
  creditIsLow,
  describeThresholdVerdict,
  thresholdVerdict,
  type CreditSnapshot,
  type CreditThreshold,
} from './desk-site';

// ────────────────────────────────────────────────────────────────────
// A LOW-BALANCE WARNING THAT CANNOT GO OFF.
//
// 🚨 VERIFYNOW REACHED 28 CREDITS WITH THE BOARD CALM. The alarm chain did
// nothing until an operator hand-created CreditThreshold rows, and with the
// table empty the count of services below alarm was hard-wired to zero. The
// backend grew built-in floors for that; what stayed missing was any way to
// SEE that a floor is inert.
//
// There are three ways to write one, and on the credits row all three look
// identical to a vendor that is simply well stocked: switch it off, leave a
// side blank, or put warn at or below alarm. thresholdVerdict() names which,
// and these tests keep it welded to creditIsLow() — the two must agree or
// the row says one thing and the editor says another.
// ────────────────────────────────────────────────────────────────────

/**
 * ⚠️ NO CAST. The first version wrote `error: null` and cast the object to
 * CreditSnapshot, which tsc rejected — `error` is `string | undefined`, and
 * an absent error is undefined, not null. Casting through `unknown` would
 * have silenced exactly the drift this fixture exists to catch, so the
 * fixture matches the wire type instead.
 */
function snap(balance: number | null): CreditSnapshot {
  return { service: 'verifynow', balance, unit: 'credits', fetchedAt: '2026-09-03T00:00:00.000Z' };
}
function floor(
  warnThreshold: number | null,
  alarmThreshold: number | null,
  enabled = true,
): CreditThreshold {
  return { service: 'verifynow', warnThreshold, alarmThreshold, enabled };
}

describe('thresholdVerdict names why a floor is inert', () => {
  it('fires when warn sits above alarm', () => {
    expect(thresholdVerdict(floor(100, 25))).toEqual({ fires: true, at: 100 });
  });

  it('switched off never fires', () => {
    expect(thresholdVerdict(floor(100, 25, false))).toEqual({ fires: false, why: 'off' });
  });

  it('a blank side never fires', () => {
    expect(thresholdVerdict(floor(null, 25))).toEqual({ fires: false, why: 'unset' });
    expect(thresholdVerdict(floor(100, null))).toEqual({ fires: false, why: 'unset' });
  });

  it('warn at or below alarm reads as a ceiling, and never fires', () => {
    // ⚠️ THE ANTHROPIC ROW IS THIS ON PURPOSE — warn 10, alarm 25 encodes a
    // daily SPEND CEILING in the same two columns. The legacy page compared
    // it downward anyway and sat permanently red. Unflagged beats flagged
    // backwards, and the editor says so out loud rather than blocking it.
    expect(thresholdVerdict(floor(10, 25))).toEqual({ fires: false, why: 'not-a-floor' });
    expect(thresholdVerdict(floor(25, 25))).toEqual({ fires: false, why: 'not-a-floor' });
  });

  it('🚨 zero is a floor, not a blank', () => {
    // '' means "no floor" and 0 means "warn me when it hits nothing left".
    // Collapsing the two would silently delete a real, if extreme, setting.
    expect(thresholdVerdict(floor(0, -1))).toEqual({ fires: true, at: 0 });
    expect(thresholdVerdict(floor(null, -1))).toEqual({ fires: false, why: 'unset' });
  });
});

describe('the verdict agrees with the row, on every shape', () => {
  // The invariant: if thresholdVerdict says it cannot fire, then creditIsLow
  // must be false for EVERY balance. If it says it fires at N, creditIsLow
  // must be true at N and false above it. This is what stops the editor's
  // promise and the row's tag from drifting apart.
  const shapes: CreditThreshold[] = [
    floor(100, 25),
    floor(100, 25, false),
    floor(null, 25),
    floor(100, null),
    floor(10, 25),
    floor(25, 25),
    floor(0, -1),
  ];
  const balances = [null, 0, 1, 9, 10, 24, 25, 26, 99, 100, 101, 5000];

  it.each(shapes.map((t) => [JSON.stringify(t), t] as const))(
    'holds for %s',
    (_label, t) => {
      const v = thresholdVerdict(t);
      for (const b of balances) {
        const low = creditIsLow(snap(b), t);
        if (!v.fires) {
          expect(low, `inert floor flagged at balance ${b}`).toBe(false);
        } else if (b === null) {
          expect(low, 'an unread balance is not a low balance').toBe(false);
        } else {
          expect(low, `balance ${b} vs floor ${v.at}`).toBe(b <= v.at);
        }
      }
    },
  );

  it('a vendor with no threshold row at all is never flagged', () => {
    expect(creditIsLow(snap(0), undefined)).toBe(false);
  });
});

describe('the sentence the operator reads', () => {
  it('says the number and the unit when it fires', () => {
    const text = describeThresholdVerdict({ fires: true, at: 1500 }, 'credits');
    // ⚠️ en-ZA GROUPS WITH A NON-BREAKING SPACE (U+00A0), NOT A PLAIN ONE.
    // The literal '1 500' typed here looked identical to the output and did
    // not match. Normalise the separator rather than pasting an invisible
    // character into the assertion, where the next reader cannot see it.
    expect(text.replace(/\s/g, ' ')).toContain('1 500');
    expect(text).toContain('credits');
  });

  it('survives a vendor with no unit', () => {
    expect(describeThresholdVerdict({ fires: true, at: 10 }, null)).not.toContain('null');
    expect(describeThresholdVerdict({ fires: true, at: 10 }, undefined)).not.toContain('undefined');
  });

  it('every inert reason says outright that it will never flag', () => {
    for (const why of ['off', 'unset', 'not-a-floor'] as const) {
      expect(describeThresholdVerdict({ fires: false, why })).toMatch(/never/i);
    }
  });

  it('🚨 never phrases an inert floor as if it were protection', () => {
    // The failure mode is copy that reassures. "No floor set" alone reads as
    // housekeeping; it has to say what that COSTS.
    for (const why of ['off', 'unset', 'not-a-floor'] as const) {
      const text = describeThresholdVerdict({ fires: false, why });
      expect(text).not.toMatch(/^ok\b|fine|no action|nothing to do/i);
    }
  });
});
