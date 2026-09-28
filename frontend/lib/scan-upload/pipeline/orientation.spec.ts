import { describe, it, expect, beforeAll } from 'vitest';
import { chooseRotationPage, rotateImageData, type Rotation } from './orientation';

// ────────────────────────────────────────────────────────────────────
// THE UPLOAD FORK'S PAGE ORIENTATION.
//
// The scanner leaves a page exactly as it was held — its upside-down
// heuristic was not trustworthy on real certificates (see the comment above
// chooseRotation). That is fine for a page framed live in the viewfinder; it
// is not fine for a portrait certificate uploaded from the gallery, where the
// phone stored it long-edge-first and the page lands on its side. So the
// upload fork scores all four quarter-turns and turns the page only when one
// horizontal reading clearly beats the rest. These tests pin that bargain:
// a sideways page comes back upright, and an ambiguous one is left alone.
//
// ⚠️ NODE HAS NO ImageData. The pipeline is pure typed arrays, but it
// CONSTRUCTS ImageData in downscale() and rotateImageData(), so the spec
// stands the constructor in. It only ever reads .data/.width/.height, which
// is all the shim provides.
// ────────────────────────────────────────────────────────────────────

interface Img {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

class FakeImageData implements Img {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(a: number | Uint8ClampedArray, b: number, c?: number) {
    if (typeof a === 'number') {
      this.width = a;
      this.height = b;
      this.data = new Uint8ClampedArray(a * b * 4);
    } else {
      this.data = a;
      this.width = b;
      this.height = c as number;
    }
  }
}

beforeAll(() => {
  (globalThis as unknown as { ImageData: unknown }).ImageData = FakeImageData;
});

/**
 * A page of small scattered stamps on a grid — the SAPS 524 certificate's
 * field boxes. By choosing the horizontal and vertical spacing independently
 * the two axes' blank-row fractions can be brought arbitrarily close, which is
 * what a real dense certificate does to this metric (see AXIS_EDGE).
 */
function makeStamps(
  width: number,
  height: number,
  mark: number,
  hx: number,
  hy: number,
): ImageData {
  const img = new FakeImageData(width, height);
  img.data.fill(PAPER);
  const top = Math.round(height * 0.08);
  const left = Math.round(width * 0.08);
  for (let y = top; y + mark <= height - top; y += hy) {
    for (let x = left; x + mark <= width - left; x += hx) {
      for (let r = 0; r < mark; r++) {
        for (let c = 0; c < mark; c++) {
          const i = ((y + r) * width + (x + c)) * 4;
          img.data[i] = INK;
          img.data[i + 1] = INK;
          img.data[i + 2] = INK;
          img.data[i + 3] = 255;
        }
      }
    }
  }
  return img as unknown as ImageData;
}

const PAPER = 240;
const INK = 30;

/** Paint a run of dark pixels centred in one row. */
function paintRow(img: Img, y: number, share: number) {
  const w = img.width;
  const n = Math.round(w * share);
  const x0 = Math.floor((w - n) / 2);
  for (let x = x0; x < x0 + n; x++) {
    const i = (y * w + x) * 4;
    img.data[i] = INK;
    img.data[i + 1] = INK;
    img.data[i + 2] = INK;
    img.data[i + 3] = 255;
  }
}

/**
 * A page of printed Latin text, laid out the way uprightScore expects to read
 * it: a sparser capital/ascender band ABOVE a dense x-height core, and a
 * thinner descender band below. That asymmetry is the whole signal.
 */
function makePage(width = 400, height = 560, pitch = 30, caps = 0.35): ImageData {
  const img = new FakeImageData(width, height);
  img.data.fill(PAPER);
  for (let y = 0; y + 20 <= height; y += pitch) {
    for (let r = 0; r < 8; r++) paintRow(img, y + r, caps); // capitals + ascenders
    for (let r = 8; r < 16; r++) paintRow(img, y + r, 1); // x-height core
    for (let r = 16; r < 20; r++) paintRow(img, y + r, 0.1); // descenders
  }
  return img as unknown as ImageData;
}

/** A blank sheet: paper and nothing else, so no line structure to read. */
function makeBlank(width = 400, height = 560): ImageData {
  const img = new FakeImageData(width, height);
  img.data.fill(PAPER);
  return img as unknown as ImageData;
}

/**
 * A page of solid, centred text lines of a given width share and pitch — a
 * certificate body narrower than the sheet, the verifier's counterexample
 * shape. Every line spans `share` of the width; `thickness` rows per `pitch`.
 */
function makeColumn(
  width: number,
  height: number,
  share: number,
  pitch: number,
  thickness = 15,
): ImageData {
  const img = new FakeImageData(width, height);
  img.data.fill(PAPER);
  const top = Math.round(height * 0.06);
  for (let y = top; y + thickness <= height - top; y += pitch) {
    for (let r = 0; r < thickness; r++) paintRow(img as unknown as Img, y + r, share);
  }
  return img as unknown as ImageData;
}

describe('chooseRotationPage — the upload fork', () => {
  it('leaves an upright page as it was held', () => {
    expect(chooseRotationPage(makePage(), 'a4')).toBe(0);
  });

  it('⚠️ TURNS A SIDEWAYS PAGE BACK — THE PORTRAIT-CERTIFICATE BUG', () => {
    // The member photographed it upright; the phone stored it long-edge
    // first, so it arrives turned a quarter turn. The fix turns it to restore
    // the horizontal reading. ⚠️ 90 OR 270, NOT A SPECIFIC ONE: the ink cannot
    // say which end is up (that is the whole reason 180 is never applied), so
    // the test is "back on the reading axis", not "back to this exact turn".
    const upright = makePage();
    const sideways = rotateImageData(upright, 90);
    expect(chooseRotationPage(sideways, 'a4')).toBe(90);
  });

  it('turns a page that arrives a quarter turn the other way', () => {
    const upright = makePage();
    const sideways = rotateImageData(upright, 270);
    expect(chooseRotationPage(sideways, 'a4')).toBe(90);
  });

  it('\u26a0\ufe0f TURNS A SPARSE PAGE WHOSE TWO AXES ARE BARELY APART', () => {
    // THE REAL-CERTIFICATE CASE. On the operator's own sideways exports of a
    // SAPS 524 competency certificate the blank-row axes came apart by as
    // little as 9% (side 0.592 against held 0.542) — under the old 1.5 edge,
    // so two of three pages stayed sideways. `makeStamps` reproduces that
    // narrow gap by spacing the field boxes wider horizontally than vertically:
    // rotating the page gives the reading axis only ~1.1x the blank rows, and
    // it must still be turned. The transpose is the upright page and must be
    // left alone, so this pins the DIRECTION as well as the threshold.
    const sideways = makeStamps(520, 520, 6, 26, 20);
    expect(chooseRotationPage(sideways, 'a4')).toBe(90);
    const upright = makeStamps(520, 520, 6, 20, 26);
    expect(chooseRotationPage(upright, 'a4')).toBe(0);
  });

  // ⚠️ THE VERIFIER'S COUNTEREXAMPLE. The previous version ranked candidate
  // orientations by the SIGNED uprightScore, whose per-line term inverts when
  // the capital/ascender band is dense — the "core" run swallows it and the
  // above/below comparison flips, so an upright page scores negative and its
  // 180° flip wins. The fix measures the AXIS (the blank-row fraction), which
  // is identical for a page and its own flip, so no upright page can be turned
  // over. This fixture sweeps the caps share the old spec pinned at 0.35 — the
  // value that hid the defect.
  it('⚠️ NEVER TURNS AN UPRIGHT PAGE OVER, HOWEVER HEAVY THE CAPS BAND', () => {
    for (const cap of [0.35, 0.5, 0.65, 0.8, 0.95, 1]) {
      for (const gap of [4, 10, 20]) {
        expect(chooseRotationPage(makePage(400, 560, 18 + gap, cap), 'a4')).toBe(0);
      }
    }
  });

  // The same fixture, on its side, must still come back — the fix trades no
  // sideways detection for the no-flip guarantee.
  it('still turns a heavy-caps page that arrives sideways', () => {
    for (const cap of [0.5, 0.8, 1]) {
      const sideways = rotateImageData(makePage(400, 560, 28, cap), 90);
      expect(chooseRotationPage(sideways, 'a4')).toBe(90);
    }
  });

  // ⚠️ THE SECOND COUNTEREXAMPLE: A NARROW CENTRED COLUMN. This is what broke
  // the first (whole-page) blank-row measure. Measuring blank rows over the
  // whole sheet made a page's score track how wide its TEXT is, not whether
  // the lines are horizontal: a narrow column has blank side margins, and
  // transposed those margins become blank rows, so a sideways page scored high
  // and an upright one low — inverting both decisions whenever the text was
  // under ~35% of the width. Measuring only across the inked span (which the
  // fix does) drops the margins from the count. This sweeps the whole width
  // range the verifier found, at the pitch it used.
  it('⚠️ READS A NARROW CENTRED COLUMN BY ITS LINES, NOT ITS MARGINS', () => {
    for (const share of [0.3, 0.35, 0.5, 0.65, 0.8, 1]) {
      for (const pitch of [18, 26, 40]) {
        const upright = makeColumn(800, 1131, share, pitch);
        expect(chooseRotationPage(upright, 'a4')).toBe(0);
        expect(chooseRotationPage(rotateImageData(upright, 90), 'a4')).toBe(90);
      }
    }
  });

  it('⚠️ LEAVES A BLANK PAGE ALONE — THERE IS NO READING TO TRUST', () => {
    // Below the absolute floor the evidence is not there, and a wrong turn is
    // worse than none; Rotate on the review screen is the fallback.
    expect(chooseRotationPage(makeBlank(), 'a4')).toBe(0);
  });

  it('leaves an unrecognised document as it was held when the evidence is weak', () => {
    // A page with one thin ink line and no line structure scores well under
    // the floor in every orientation, so nothing is turned.
    const img = new FakeImageData(400, 560);
    img.data.fill(PAPER);
    paintRow(img as unknown as Img, 280, 0.5);
    expect(chooseRotationPage(img as unknown as ImageData, 'other')).toBe(0);
  });

  it('⚠️ A CARD KEEPS THE SCANNER\u2019S OWN RULE, UNCHANGED', () => {
    // chooseRotationPage hands cards straight to chooseRotation: landscape, up
    // or down decided by the sign — never the four-way search.
    const landscape = makePage(560, 400);
    expect(chooseRotationPage(landscape, 'card')).toBe(0);
  });
});

describe('rotateImageData — the quarter-turn it relies on', () => {
  it('a full turn puts every pixel back where it started', () => {
    const img = makePage(40, 60, 20);
    const back = rotateImageData(rotateImageData(img, 90), 270);
    expect(back.width).toBe(40);
    expect(back.height).toBe(60);
    // ⚠️ RGB ONLY. A rotated pixel is written back opaque (the pipeline's
    // own choice — a page has no transparency), so the fixture's untouched
    // alpha is not expected to survive; every colour is.
    for (let i = 0; i < img.data.length; i += 4) {
      expect(back.data[i]).toBe(img.data[i]);
      expect(back.data[i + 1]).toBe(img.data[i + 1]);
      expect(back.data[i + 2]).toBe(img.data[i + 2]);
    }
  });

  it('takes the rotation it was asked for', () => {
    const turns: Rotation[] = [0, 90, 180, 270];
    for (const t of turns) {
      const out = rotateImageData(makePage(40, 60, 20), t);
      const swapped = t === 90 || t === 270;
      expect(out.width).toBe(swapped ? 60 : 40);
      expect(out.height).toBe(swapped ? 40 : 60);
    }
  });
});
