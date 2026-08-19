import { describe, expect, it } from 'vitest';
import { visibleRect } from './capture';

// ────────────────────────────────────────────────────────────────────
// WHAT THE MEMBER CAN SEE.
//
// The scanner's preview is `object-fit: cover` in a portrait box. A landscape
// camera track is therefore cropped hard at the sides before it reaches the
// screen — and for one release both the detector and the shutter used the
// WHOLE track, so a member framed a card in a portrait window while we hunted
// rectangles in a wider scene they had never seen, and captured that scene.
// On a real desk it found a tall slice of mousepad and cropped to it.
//
// visibleRect is the single definition of that region. These tests are the
// arithmetic, because it is the kind of arithmetic that looks obviously right
// and is off by a factor of two.
// ────────────────────────────────────────────────────────────────────

/** Enough of an HTMLVideoElement for visibleRect. */
function fakeVideo(
  videoWidth: number,
  videoHeight: number,
  clientWidth: number,
  clientHeight: number,
): HTMLVideoElement {
  return {
    videoWidth,
    videoHeight,
    clientWidth,
    clientHeight,
  } as HTMLVideoElement;
}

describe('visibleRect', () => {
  it('⚠️ CROPS THE SIDES of a landscape track in a portrait box', () => {
    // The operator's exact case: 1080p landscape from the camera, shown in a
    // tall phone window. Only a narrow middle column is ever on screen.
    const v = fakeVideo(1920, 1080, 390, 780);
    const r = visibleRect(v)!;
    expect(r.sh).toBeCloseTo(1080, 6); // full height survives
    expect(r.sw).toBeCloseTo(540, 6); // 1080 * (390/780)
    expect(r.sx).toBeCloseTo(690, 6); // centred: (1920-540)/2
    expect(r.sy).toBeCloseTo(0, 6);
    // And the visible aspect must match the box, or the markers land wrong.
    expect(r.sw / r.sh).toBeCloseTo(390 / 780, 6);
  });

  it('crops top and bottom of a portrait track in a landscape box', () => {
    const r = visibleRect(fakeVideo(1080, 1920, 800, 400))!;
    expect(r.sw).toBeCloseTo(1080, 6);
    expect(r.sh).toBeCloseTo(540, 6);
    expect(r.sy).toBeCloseTo(690, 6);
    expect(r.sx).toBeCloseTo(0, 6);
  });

  it('takes the whole frame when the aspects already agree', () => {
    const r = visibleRect(fakeVideo(1600, 900, 800, 450))!;
    expect(r.sx).toBeCloseTo(0, 6);
    expect(r.sy).toBeCloseTo(0, 6);
    expect(r.sw).toBeCloseTo(1600, 6);
    expect(r.sh).toBeCloseTo(900, 6);
  });

  it('never returns a region outside the track', () => {
    for (const [vw, vh, cw, ch] of [
      [1920, 1080, 100, 4000],
      [640, 480, 4000, 100],
      [1280, 720, 1, 1],
      [3840, 2160, 411, 890],
    ] as const) {
      const r = visibleRect(fakeVideo(vw, vh, cw, ch))!;
      expect(r.sx).toBeGreaterThanOrEqual(0);
      expect(r.sy).toBeGreaterThanOrEqual(0);
      expect(r.sw).toBeGreaterThan(0);
      expect(r.sh).toBeGreaterThan(0);
      expect(r.sx + r.sw).toBeLessThanOrEqual(vw + 1e-6);
      expect(r.sy + r.sh).toBeLessThanOrEqual(vh + 1e-6);
    }
  });

  it('is centred, so the middle of the screen is the middle of the crop', () => {
    const vw = 1920;
    const r = visibleRect(fakeVideo(vw, 1080, 390, 780))!;
    expect(r.sx + r.sw / 2).toBeCloseTo(vw / 2, 6);
  });

  it('returns null before the track has dimensions', () => {
    expect(visibleRect(fakeVideo(0, 0, 390, 780))).toBeNull();
  });

  it('falls back to the track size when the element has not laid out yet', () => {
    // clientWidth/Height are 0 until layout. Treating that as a zero-width
    // crop would hand the detector an empty buffer.
    const r = visibleRect(fakeVideo(1920, 1080, 0, 0))!;
    expect(r.sw).toBeCloseTo(1920, 6);
    expect(r.sh).toBeCloseTo(1080, 6);
  });
});
