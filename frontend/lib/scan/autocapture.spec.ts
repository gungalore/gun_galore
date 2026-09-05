import { describe, expect, it } from 'vitest';
import { BRIGHT_AT, DARK_AT, GLARE_AT } from './exposure';
import {
  HOLD_MS,
  INK_AT,
  LOWEST_MEASURED_DOCUMENT_INK,
  MOTION_STILL,
  autoBlocker,
  autoHint,
  holdComplete,
  holdProgress,
  MIN_FILL,
} from './autocapture';

// ────────────────────────────────────────────────────────────────────
// The gate that decides whether the scanner may shoot by itself.
//
// The first test is the one that matters. Automatic capture was removed once
// because it NEVER FIRED: the gate asked the detector whether it agreed with
// the aim box, and on a real licence card the detector never sees the card at
// all (see the skipped regression in detect.spec.ts). Nothing here may consult
// the detector — a document sitting in the box, in decent light, held still,
// must fire.
// ────────────────────────────────────────────────────────────────────

/** A frame with a document in the box, good light, phone at rest. */
function good(over: Partial<Parameters<typeof autoBlocker>[1]> = {}) {
  return { ink: 0.3, motion: 1, glare: 0, luma: 128, fill: 0.7, ...over };
}

describe('autoBlocker', () => {
  it('⚠️ FIRES on a document in the box, in good light, held still', () => {
    // The whole point. If this ever goes red, auto-capture is back to the
    // behaviour that got it deleted.
    expect(autoBlocker(true, good())).toBeNull();
  });

  it('refuses when the member turned it off, whatever the frame looks like', () => {
    expect(autoBlocker(false, good())).toBe('off');
  });

  it('refuses an empty box — the mat is not a document', () => {
    expect(autoBlocker(true, good({ ink: 0 }))).toBe('empty');
    expect(autoBlocker(true, good({ ink: INK_AT - 0.001 }))).toBe('empty');
    // At the floor exactly, it is a document.
    expect(autoBlocker(true, good({ ink: INK_AT }))).toBeNull();
  });

  it('⚠️ REFUSES TO SHOOT THROUGH GLARE, TOO BRIGHT OR TOO DARK', () => {
    // These three are the only failures no processing recovers. Firing anyway
    // hands the member a scan they cannot read and no explanation of why.
    expect(autoBlocker(true, good({ glare: GLARE_AT + 0.01 }))).toBe('light');
    expect(autoBlocker(true, good({ luma: BRIGHT_AT + 1 }))).toBe('light');
    expect(autoBlocker(true, good({ luma: DARK_AT - 1 }))).toBe('light');
  });

  it('waits for the phone to stop moving', () => {
    expect(autoBlocker(true, good({ motion: MOTION_STILL + 1 }))).toBe('steady');
    expect(autoBlocker(true, good({ motion: MOTION_STILL }))).toBeNull();
  });

  it('⚠️ WAITS FOR THE OPERATOR\'S 60% — a small or untracked document does not fire', () => {
    expect(autoBlocker(true, good({ fill: null }))).toBe('small');
    expect(autoBlocker(true, good({ fill: MIN_FILL - 0.01 }))).toBe('small');
    expect(autoBlocker(true, good({ fill: MIN_FILL }))).toBeNull();
    // Named after 'empty' and before 'light': point it, fill the frame, fix
    // the light, hold still — the order the member can act on.
    expect(autoBlocker(true, good({ ink: 0, fill: null }))).toBe('empty');
    expect(autoBlocker(true, good({ fill: 0.2, glare: 0.9 }))).toBe('small');
  });

  it('⚠️ NAMES THE SHUT GATE IN THE ORDER THE MEMBER CAN ACT ON IT', () => {
    // Point it at the document, THEN fix the light, THEN hold still. A frame
    // failing all three must say "empty" first: telling somebody to hold still
    // while the camera is pointed at their desk is how the old version became
    // impossible to report on.
    const awful = { ink: 0, motion: 50, glare: 0.9, luma: 250, fill: 0.7 };
    expect(autoBlocker(true, awful)).toBe('empty');
    expect(autoBlocker(true, { ...awful, ink: 0.3 })).toBe('light');
    expect(autoBlocker(true, { ...awful, ink: 0.3, glare: 0, luma: 128, fill: 0.7 })).toBe(
      'steady',
    );
  });
});

describe('the ink floor against the real photographs', () => {
  it('⚠️ STAYS BELOW THE FAINTEST DOCUMENT EVER MEASURED', () => {
    // The eighteen calibration photographs are PII and can never be committed,
    // so the measurement they produced is pinned here instead: the faintest
    // real document scored 0.173 over the aim box. A floor at or above that
    // starts refusing real documents, which is exactly the failure that got
    // auto-capture deleted the first time.
    expect(INK_AT).toBeLessThan(LOWEST_MEASURED_DOCUMENT_INK);
    // And with room to spare — a floor 0.01 under the faintest one measured is
    // a floor tuned to eighteen photographs, not to the world.
    expect(LOWEST_MEASURED_DOCUMENT_INK - INK_AT).toBeGreaterThan(0.05);
  });

  it('admits the faintest measured document', () => {
    const faintest = { ink: LOWEST_MEASURED_DOCUMENT_INK, motion: 1, glare: 0, luma: 128, fill: 0.7 };
    expect(autoBlocker(true, faintest)).toBeNull();
  });
});

describe('the hold', () => {
  it('fills the ring across the hold and never past it', () => {
    expect(holdProgress(0)).toBe(0);
    expect(holdProgress(-5)).toBe(0);
    expect(holdProgress(HOLD_MS / 2)).toBeCloseTo(0.5, 5);
    expect(holdProgress(HOLD_MS)).toBe(1);
    expect(holdProgress(HOLD_MS * 10)).toBe(1);
  });

  it('fires at the hold and not a millisecond before', () => {
    expect(holdComplete(HOLD_MS - 1)).toBe(false);
    expect(holdComplete(HOLD_MS)).toBe(true);
  });

  it('⚠️ IS LONG ENOUGH TO TELL A PAUSE FROM A STOP', () => {
    // This asserted `holdComplete(700) === false`, pinning the era when the
    // hold was 1100 because 700 had been "super sensitive". That verdict was
    // real but it was never about this number — the MOTION READING underneath
    // was broken, so the gate could not tell positioning from stillness and
    // the wait was effectively random. With the reading honest the operator
    // moved it to 750 and then to 300, against numbers that finally mean
    // something.
    //
    // So the old literal is gone: a test that pins a superseded decision goes
    // red on the correct change, which teaches people to edit tests. What
    // survives is the reason the hold exists at all — below roughly a quarter
    // of a second it stops distinguishing a hand that paused on its way
    // somewhere from a hand that arrived, and the failure that prevents costs
    // a retake and the member's trust in the next shot.
    expect(HOLD_MS).toBeGreaterThanOrEqual(250);
  });
});

describe('autoHint', () => {
  it('says the thing the member can act on, per gate', () => {
    expect(autoHint('empty', 'card')).toContain('inside the corners');
    expect(autoHint('light', 'card')).toContain('lighting');
    expect(autoHint('steady', 'card')).toContain('Hold still');
  });

  it('tells a member who turned it off that the shutter is theirs', () => {
    expect(autoHint('off', 'card')).toContain('take the photo');
  });
});

describe('⚠️ the shutter will not fire at a surface with no document on it', () => {
  // Operator: "why does the auto scan just fire off for fucking nothing?"
  // Because none of the three original gates could answer it. INK_AT's own
  // note admits as much — "what it cannot do is refuse to photograph a
  // tablecloth" — and his panel showed `empty 2%`, meaning ink passed on
  // essentially every frame while the phone was pointed at a woven carpet.
  const still = { motion: 1, glare: 0, luma: 150, fill: 0.7 };

  it('refuses when the detector says there is no document, however inky', () => {
    // A patterned surface scores high on ink and is still not a document.
    expect(autoBlocker(true, { ...still, ink: 0.9, document: false })).toBe('empty');
  });

  it('fires when the detector says there is', () => {
    expect(autoBlocker(true, { ...still, ink: 0.5, document: true })).toBeNull();
  });

  it('⚠️ A DETECTOR VERDICT OUTRANKS INK IN BOTH DIRECTIONS', () => {
    // Low ink with a found document still fires: inkiness measures local
    // texture, so a sparse page reads low while being unmistakably a page.
    expect(autoBlocker(true, { ...still, ink: 0.01, document: true })).toBeNull();
  });

  it('⚠️ FALLS BACK TO INK WHEN THERE IS NO VERDICT, NOT TO REFUSING', () => {
    // The detector is dropped on a device too slow to run it. Refusing to fire
    // at all there would be a worse failure than the one this gate fixes.
    expect(autoBlocker(true, { ...still, ink: 0.5, document: undefined })).toBeNull();
    expect(autoBlocker(true, { ...still, ink: 0.01, document: undefined })).toBe('empty');
  });

  it('still checks light and stillness after the document is found', () => {
    expect(autoBlocker(true, { ...still, ink: 0.5, document: true, glare: 0.9 })).toBe('light');
    expect(autoBlocker(true, { ...still, motion: 99, ink: 0.5, document: true })).toBe('steady');
  });
});
