import {
  INK_AT,
  MOTION_STILL,
  HOLD_MS,
  type AutoBlocker,
  type FrameReading,
} from './autocapture';
import { BRIGHT_AT, DARK_AT, GLARE_AT } from './exposure';

// ────────────────────────────────────────────────────────────────────
// WHAT THE SCANNER WAS SEEING, AFTER THE FACT.
//
// Operator, 2026-08-30: "is there anyway we can track whats happening on the
// phone when testing this? like a log we can send or something to troubleshoot
// this not firing?"
//
// ⚠️ THE PROBLEM THIS SOLVES IS NOT "NO LOGGING", IT IS "NO WITNESS". Four
// separate faults stopped auto-capture on a phone and every one of them was
// invisible to every desktop run — they were found by reading code and
// reasoning about aspect ratios, which worked, but took a fan-out of ten
// agents and would not have been needed if the phone could simply say which
// gate was shut and what number shut it.
//
// So this is deliberately not a general logger. It records exactly the four
// readings autoBlocker decides on, against the thresholds it decides with, and
// summarises which one was standing in the way.
//
// ⚠️ NUMBERS ONLY. NEVER PIXELS, NEVER AN IMAGE, NEVER A FILENAME.
// This module is one import away from rasters of somebody's ID document and
// firearm licence. Everything here is a scalar measured FROM an image and
// nothing here can be turned back INTO one. A diagnostic that is unsafe to
// paste into a chat window is a diagnostic nobody will send.
//
// ⚠️ AND EVERY THRESHOLD IS IMPORTED, NEVER RESTATED. A diagnostic carrying
// its own copy of INK_AT would eventually disagree with the gate, and then it
// would be confidently reporting a pass on a frame the scanner refused —
// which is worse than no diagnostic at all.
// ────────────────────────────────────────────────────────────────────

/** One frame, as the shutter decision saw it. */
export interface FrameSnapshot extends FrameReading {
  /** ms since the scanner opened. */
  t: number;
  /** The gate that was shut, or null if the frame was ready to fire. */
  blocker: AutoBlocker | null;
  /** How long the phone had been still, in ms. */
  held: number;
  /** What this frame cost to measure, in ms. */
  ms: number;
  /**
   * The same movement measure taken over the WHOLE frame instead of the aim
   * box. Diagnostic only — the shutter never sees it.
   *
   * ⚠️ CARRIED SO ONE TEST RUN SETTLES AN ARGUMENT. Motion was measured
   * whole-frame while every other reading was scoped to the box, and on a
   * document lying on a woven carpet it pinned at 22.31 against a limit of 4.
   * Scoping it to the box is right regardless; printing both is what says how
   * much of that 22 was the carpet and how much was the downscale underneath.
   */
  frameMotion?: number;
  /**
   * The boxed movement measure BEFORE coarsening — the previous method.
   *
   * ⚠️ CARRIED SO THE NEXT RUN IS NOT ANOTHER GUESS. Scoping to the box read
   * 30.92 against a whole-frame 30.18: identical, so the background was never
   * it. Coarsening is the third attempt at this number, and printing the
   * before and after side by side is what turns "still broken" into "the
   * averaging is what mattered" or "it is neither, look elsewhere".
   */
  rawMotion?: number;
  /** Had the device been judged too slow to run the detector? */
  detectorOff: boolean;
}

/** One gate, in the order autoBlocker checks them, with its own numbers. */
export interface GateReading {
  key: 'ink' | 'light' | 'steady';
  label: string;
  value: number;
  /** What it has to beat, in the same unit. */
  limit: number;
  pass: boolean;
  /** Plain words for the phone's screen. */
  detail: string;
}

const f2 = (n: number) => Math.round(n * 100) / 100;
const f3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Every gate's current state, whether or not it is the one blocking.
 *
 * ⚠️ ALL OF THEM, NOT JUST THE FIRST FAILURE. autoBlocker returns the first
 * shut gate because that is the one thing to tell a member. Debugging wants
 * the opposite: "ink passes, light passes, motion is 4.2 against 4" is a
 * diagnosis, whereas "steady" on its own is the same word the screen was
 * already showing when nobody could explain it.
 */
export function gates(r: FrameReading): GateReading[] {
  const lightBad =
    r.glare > GLARE_AT || r.luma > BRIGHT_AT || r.luma < DARK_AT;
  return [
    {
      key: 'ink',
      label: 'Something in the box',
      value: f3(r.ink),
      limit: INK_AT,
      pass: r.ink >= INK_AT,
      detail: `ink ${f3(r.ink)} needs ≥ ${INK_AT}`,
    },
    {
      key: 'light',
      label: 'Readable light',
      value: f3(r.glare),
      limit: GLARE_AT,
      pass: !lightBad,
      detail: `glare ${f3(r.glare)} needs ≤ ${GLARE_AT}, luma ${Math.round(
        r.luma,
      )} needs ${DARK_AT}–${BRIGHT_AT}`,
    },
    {
      key: 'steady',
      label: 'Held still',
      value: f2(r.motion),
      limit: MOTION_STILL,
      pass: r.motion <= MOTION_STILL,
      detail: `motion ${f2(r.motion)} needs ≤ ${MOTION_STILL}`,
    },
  ];
}

/** Add a frame to a fixed-length trail, oldest dropped first. */
export function pushFrame(
  trail: FrameSnapshot[],
  s: FrameSnapshot,
  cap = 400,
): FrameSnapshot[] {
  trail.push(s);
  if (trail.length > cap) trail.splice(0, trail.length - cap);
  return trail;
}

export interface Spread {
  min: number;
  med: number;
  max: number;
}

function spread(xs: number[]): Spread {
  if (!xs.length) return { min: 0, med: 0, max: 0 };
  const s = [...xs].sort((a, b) => a - b);
  return {
    min: f3(s[0]),
    med: f3(s[Math.floor(s.length / 2)]),
    max: f3(s[s.length - 1]),
  };
}

export interface TrailSummary {
  frames: number;
  seconds: number;
  /** Share of frames each gate was the one standing in the way, 0-1. */
  blockedBy: Partial<Record<AutoBlocker | 'ready', number>>;
  readings: Record<'ink' | 'motion' | 'glare' | 'luma', Spread>;
  /** Did every gate open on the same frame, even once? */
  everReady: boolean;
  /** Longest unbroken stillness, in ms. HOLD_MS is what it must beat. */
  longestHoldMs: number;
  holdNeededMs: number;
  medianFrameMs: number;
  /** When the detector was dropped for being too slow, in ms, or null. */
  detectorOffAt: number | null;
}

/**
 * The whole trail in one paragraph of numbers.
 *
 * ⚠️ `blockedBy` IS THE ANSWER TO "WHY DOES IT NOT FIRE" and it is the reason
 * this function exists rather than just dumping frames. A share of 1.0 against
 * 'empty' says the ink gate never once opened, which is a completely different
 * bug from 'steady' at 1.0 — and both of them look identical from the outside,
 * because both are a camera sitting there doing nothing.
 */
export function summarise(trail: readonly FrameSnapshot[]): TrailSummary {
  const n = trail.length;
  const counts: Partial<Record<AutoBlocker | 'ready', number>> = {};
  let longest = 0;
  let offAt: number | null = null;
  for (const s of trail) {
    const k = s.blocker ?? 'ready';
    counts[k] = (counts[k] ?? 0) + 1;
    if (s.held > longest) longest = s.held;
    if (s.detectorOff && offAt === null) offAt = s.t;
  }
  const blockedBy: Partial<Record<AutoBlocker | 'ready', number>> = {};
  for (const [k, v] of Object.entries(counts)) {
    blockedBy[k as AutoBlocker | 'ready'] = n ? f3(v / n) : 0;
  }
  return {
    frames: n,
    seconds: n ? f2((trail[n - 1].t - trail[0].t) / 1000) : 0,
    blockedBy,
    readings: {
      ink: spread(trail.map((s) => s.ink)),
      motion: spread(trail.map((s) => s.motion)),
      glare: spread(trail.map((s) => s.glare)),
      luma: spread(trail.map((s) => s.luma)),
    },
    everReady: trail.some((s) => s.blocker === null),
    longestHoldMs: Math.round(longest),
    holdNeededMs: HOLD_MS,
    medianFrameMs: spread(trail.map((s) => s.ms)).med,
    detectorOffAt: offAt,
  };
}

/**
 * What the phone and the page are, which is where three of the four faults
 * actually lived.
 *
 * ⚠️ THE TWO SIZES ARE THE POINT. A buffer built at one aspect ratio and a CSS
 * box read live at another is what made `ink` read zero for ever, and it is
 * invisible in every other kind of log. Printing both, every time, means the
 * next aspect-drift bug announces itself instead of needing to be deduced.
 */
export interface DeviceContext {
  ua: string;
  dpr: number;
  /** The video track's own dimensions. */
  video: { w: number; h: number };
  /** The element's CSS box, live. */
  element: { w: number; h: number };
  /** The detection buffer, as built. */
  buffer: { w: number; h: number };
  /** element aspect ÷ buffer aspect. 1 means they still agree. */
  aspectDrift: number;
}

export function deviceContext(d: {
  ua: string;
  dpr: number;
  video: { w: number; h: number };
  element: { w: number; h: number };
  buffer: { w: number; h: number };
}): DeviceContext {
  const ea = d.element.h ? d.element.w / d.element.h : 0;
  const ba = d.buffer.h ? d.buffer.w / d.buffer.h : 0;
  return { ...d, aspectDrift: ba ? f3(ea / ba) : 0 };
}

export interface ScanReport {
  at: string;
  device: DeviceContext;
  summary: TrailSummary;
  /** The last few frames, for anything the summary flattened away. */
  tail: FrameSnapshot[];
  /**
   * How the crop was chosen on the last capture, if there was one.
   *
   * ⚠️ 'aim' MEANS NOBODY MOVED THE CORNERS. The first pass crops exactly the
   * aim-box rectangle, and warping a rectangle to a rectangle corrects no
   * perspective at all — the dewarp only happens on the SECOND pass, from the
   * corners dragged in the editor. So if a capture comes back skew, this field
   * says whether it was ever corrected, which is the first thing to know and
   * is otherwise unknowable after the fact.
   */
  lastCapture?: {
    source: string;
    glare: number;
    sharpness: number;
    meanLuma: number;
    /** The seeded corner search's own verdict, when it ran. */
    seed?: { confidence: number; hits: number[]; residuals: number[] };
  };
}

/** The whole thing as pasteable JSON. Numbers only — safe to send anywhere. */
export function report(
  device: DeviceContext,
  trail: readonly FrameSnapshot[],
  at: string,
  lastCapture?: ScanReport['lastCapture'],
  tailSize = 12,
): ScanReport {
  return {
    at,
    device,
    summary: summarise(trail),
    tail: trail.slice(-tailSize).map((s) => ({
      ...s,
      ink: f3(s.ink),
      motion: f2(s.motion),
      glare: f3(s.glare),
      luma: Math.round(s.luma),
      t: Math.round(s.t),
      held: Math.round(s.held),
      ms: Math.round(s.ms),
    })),
    lastCapture,
  };
}
