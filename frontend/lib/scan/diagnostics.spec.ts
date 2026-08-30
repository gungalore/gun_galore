import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  deviceContext,
  gates,
  pushFrame,
  report,
  summarise,
  type FrameSnapshot,
} from './diagnostics';
import { clearDiagnostics, diagnosticsOn, withDiagnostics } from './diag-flag';
import { INK_AT, MOTION_STILL, HOLD_MS } from './autocapture';
import { GLARE_AT, DARK_AT, BRIGHT_AT } from './exposure';

// ────────────────────────────────────────────────────────────────────
// A DIAGNOSTIC THAT DISAGREES WITH THE GATE IS WORSE THAN NO DIAGNOSTIC.
//
// The point of this readout is to answer "why did it not fire" on a phone
// nobody can attach a debugger to. If it carried its own copy of a threshold
// it would eventually report a pass on a frame the scanner refused — and the
// person holding the phone would have no way at all to tell which of the two
// was lying. So every assertion below is written against the IMPORTED
// constants, never a literal.
// ────────────────────────────────────────────────────────────────────

const frame = (o: Partial<FrameSnapshot> = {}): FrameSnapshot => ({
  t: 0,
  ink: 0.5,
  motion: 1,
  glare: 0,
  luma: 128,
  blocker: null,
  held: 0,
  ms: 10,
  detectorOff: false,
  ...o,
});

describe('⚠️ the gate readout tracks the real thresholds', () => {
  it('shows all three gates, not just the first failure', () => {
    // autoBlocker returns the FIRST shut gate because that is the one thing
    // to tell a member. Debugging wants the opposite.
    const g = gates({ ink: 0, motion: 99, glare: 1, luma: 0 });
    expect(g.map((x) => x.key)).toEqual(['ink', 'light', 'steady']);
    expect(g.every((x) => !x.pass)).toBe(true);
  });

  it('passes ink exactly at the threshold, not just above it', () => {
    expect(gates({ ink: INK_AT, motion: 0, glare: 0, luma: 128 })[0].pass).toBe(true);
    expect(gates({ ink: INK_AT - 0.001, motion: 0, glare: 0, luma: 128 })[0].pass).toBe(false);
  });

  it('passes motion exactly at MOTION_STILL', () => {
    const at = gates({ ink: 1, motion: MOTION_STILL, glare: 0, luma: 128 })[2];
    const over = gates({ ink: 1, motion: MOTION_STILL + 0.1, glare: 0, luma: 128 })[2];
    expect(at.pass).toBe(true);
    expect(over.pass).toBe(false);
  });

  it('fails light on glare, on too bright and on too dark', () => {
    const light = (glare: number, luma: number) =>
      gates({ ink: 1, motion: 0, glare, luma })[1].pass;
    expect(light(GLARE_AT + 0.001, 128)).toBe(false);
    expect(light(0, BRIGHT_AT + 1)).toBe(false);
    expect(light(0, DARK_AT - 1)).toBe(false);
    expect(light(GLARE_AT, 128)).toBe(true);
  });

  it('⚠️ SAYS THE NUMBER AND WHAT IT NEEDED, not just pass or fail', () => {
    // "steady" was already on screen when nobody could explain it. A bare
    // fail repeats that; the number is the whole contribution.
    const g = gates({ ink: 0.04, motion: 0, glare: 0, luma: 128 })[0];
    expect(g.detail).toContain('0.04');
    expect(g.detail).toContain(String(INK_AT));
  });
});

describe('⚠️ the summary answers "why does it not fire"', () => {
  it('names the gate that stood in the way, as a share of frames', () => {
    const trail = [
      frame({ t: 0, blocker: 'empty' }),
      frame({ t: 100, blocker: 'empty' }),
      frame({ t: 200, blocker: 'steady' }),
      frame({ t: 300, blocker: 'empty' }),
    ];
    const s = summarise(trail);
    expect(s.blockedBy.empty).toBe(0.75);
    expect(s.blockedBy.steady).toBe(0.25);
    expect(s.everReady).toBe(false);
  });

  it('⚠️ DISTINGUISHES "NEVER READY" FROM "READY BUT NEVER HELD"', () => {
    // Identical from the outside — a camera sitting there — and completely
    // different bugs. One is a reading, the other is the hold.
    const neverReady = summarise([frame({ blocker: 'empty' })]);
    expect(neverReady.everReady).toBe(false);

    const readyButShort = summarise([
      frame({ t: 0, blocker: null, held: 200 }),
      frame({ t: 100, blocker: 'steady', held: 0 }),
    ]);
    expect(readyButShort.everReady).toBe(true);
    expect(readyButShort.longestHoldMs).toBe(200);
    expect(readyButShort.longestHoldMs).toBeLessThan(readyButShort.holdNeededMs);
  });

  it('reports what the hold had to beat, from the real constant', () => {
    expect(summarise([frame()]).holdNeededMs).toBe(HOLD_MS);
  });

  it('gives min/median/max for each reading', () => {
    const s = summarise([
      frame({ ink: 0.1 }),
      frame({ ink: 0.5 }),
      frame({ ink: 0.9 }),
    ]);
    expect(s.readings.ink).toEqual({ min: 0.1, med: 0.5, max: 0.9 });
  });

  it('records when the detector was dropped for being slow', () => {
    const s = summarise([
      frame({ t: 0, detectorOff: false }),
      frame({ t: 500, detectorOff: true }),
      frame({ t: 900, detectorOff: true }),
    ]);
    expect(s.detectorOffAt).toBe(500);
  });

  it('survives an empty trail', () => {
    const s = summarise([]);
    expect(s.frames).toBe(0);
    expect(s.everReady).toBe(false);
    expect(s.readings.ink).toEqual({ min: 0, med: 0, max: 0 });
  });
});

describe('the trail', () => {
  it('drops the oldest frames past the cap', () => {
    let t: FrameSnapshot[] = [];
    for (let i = 0; i < 10; i++) t = pushFrame(t, frame({ t: i }), 4);
    expect(t).toHaveLength(4);
    expect(t[0].t).toBe(6);
    expect(t[3].t).toBe(9);
  });
});

describe('⚠️ device context exposes the aspect drift', () => {
  it('reads 1 while the buffer and the element still agree', () => {
    const d = deviceContext({
      ua: 'x',
      dpr: 3,
      video: { w: 1920, h: 1080 },
      element: { w: 320, h: 568 },
      buffer: { w: 320, h: 568 },
    });
    expect(d.aspectDrift).toBe(1);
  });

  it('⚠️ MOVES OFF 1 WHEN THE ADDRESS BAR COLLAPSES', () => {
    // This is the number that would have made the ink bug obvious. The buffer
    // was built at 320x568 and the pane became 320x640.
    const d = deviceContext({
      ua: 'x',
      dpr: 3,
      video: { w: 1920, h: 1080 },
      element: { w: 320, h: 640 },
      buffer: { w: 320, h: 568 },
    });
    expect(d.aspectDrift).not.toBe(1);
    expect(d.aspectDrift).toBeLessThan(1);
  });
});

describe('⚠️ the report carries numbers and nothing else', () => {
  const device = deviceContext({
    ua: 'Mozilla/5.0 (Linux; Android 14)',
    dpr: 3,
    video: { w: 1920, h: 1080 },
    element: { w: 320, h: 640 },
    buffer: { w: 320, h: 568 },
  });

  it('is JSON-serialisable and holds no image data', () => {
    const r = report(device, [frame(), frame({ t: 100 })], '2026-08-30T00:00:00Z');
    const json = JSON.stringify(r);
    // Nothing that could reconstruct a document: no data URLs, no base64
    // blobs, no file names.
    expect(json).not.toMatch(/data:image|base64|blob:|\.jpg|\.png/i);
    expect(JSON.parse(json).summary.frames).toBe(2);
  });

  it('keeps only a short tail', () => {
    const trail = Array.from({ length: 50 }, (_, i) => frame({ t: i }));
    expect(report(device, trail, 'now', undefined, 5).tail).toHaveLength(5);
  });

  it('carries how the last capture was cropped', () => {
    // 'aim' means nobody moved the corners, so no perspective was corrected —
    // the first thing to know if an image comes back skew.
    const r = report(device, [frame()], 'now', {
      source: 'aim',
      glare: 0.01,
      sharpness: 5,
      meanLuma: 150,
    });
    expect(r.lastCapture?.source).toBe('aim');
  });
});

describe('the ?diag=1 opt-in', () => {
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
        removeItem: (k: string) => {
          delete store[k];
        },
      },
    });
  });

  it('is off by default', () => {
    expect(diagnosticsOn('')).toBe(false);
  });

  it('turns on for ?diag=1 and survives the parameter going away', () => {
    expect(diagnosticsOn('?diag=1')).toBe(true);
    expect(diagnosticsOn('')).toBe(true);
  });

  it('⚠️ MATCHES EXACTLY "1", NEVER TRUTHINESS', () => {
    for (const s of ['?diag=0', '?diag=false', '?diag=', '?diag', '?diag=true']) {
      store = {};
      expect(diagnosticsOn(s), s).toBe(false);
    }
  });

  it('clears', () => {
    diagnosticsOn('?diag=1');
    clearDiagnostics();
    expect(diagnosticsOn('')).toBe(false);
  });

  it('⚠️ NEVER THROWS WHEN STORAGE IS BLOCKED', () => {
    // sessionStorage throws on ACCESS in a private window, and the caller is
    // a page load. Throwing here would take the scanner down with it.
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    expect(() => diagnosticsOn('?diag=1')).not.toThrow();
    expect(diagnosticsOn('?diag=1')).toBe(false);
    expect(() => clearDiagnostics()).not.toThrow();
  });
});

describe('⚠️ carrying the flag to the phone', () => {
  it('appends to a hand-off URL that already has a query', () => {
    expect(withDiagnostics('https://x/scan/handoff?t=abc', true)).toBe(
      'https://x/scan/handoff?t=abc&diag=1',
    );
  });

  it('starts a query when there is none', () => {
    expect(withDiagnostics('https://x/scan/handoff', true)).toBe(
      'https://x/scan/handoff?diag=1',
    );
  });

  it('does not double up', () => {
    const once = withDiagnostics('https://x?t=1', true);
    expect(withDiagnostics(once, true)).toBe(once);
  });

  it('leaves the URL alone when off', () => {
    expect(withDiagnostics('https://x?t=1', false)).toBe('https://x?t=1');
  });
});
