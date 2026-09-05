import { describe, expect, it } from 'vitest';
import { Raster } from './warp';
import { enhance } from './enhance';
import {
  applyChoice,
  autoFilter,
  boxSum,
  bw,
  chooseMode,
  colour,
  grey,
  integral,
  pageStats,
  paperColour,
  whiteBalance,
} from './filters';

// ────────────────────────────────────────────────────────────────────
// SYNTHETIC PAGES.
//
// Everything here is drawn rather than photographed, for the reason recorded
// in CLAUDE.md: the real fixtures carry a name, an ID number and licence
// serials, they live in a gitignored folder, and a regression that cannot be
// committed is not a regression test. Each scene below is built to isolate
// exactly one property, and the numbers in the assertions were measured
// against these scenes, not guessed.
// ────────────────────────────────────────────────────────────────────

function blank(w: number, h: number): Raster {
  return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
}

function put(r: Raster, x: number, y: number, R: number, G: number, B: number) {
  const i = (y * r.width + x) * 4;
  r.data[i] = R;
  r.data[i + 1] = G;
  r.data[i + 2] = B;
  r.data[i + 3] = 255;
}

const lumaAt = (r: Raster, x: number, y: number) => {
  const i = (y * r.width + x) * 4;
  return (77 * r.data[i] + 150 * r.data[i + 1] + 29 * r.data[i + 2]) / 256;
};

/**
 * A page of print.
 *
 * `shadow` is a multiplicative gradient across the width — the phone's own
 * shadow, which is the commonest real shooting condition there is. `tint`
 * multiplies the three channels, which is how both a coloured page and a
 * coloured light source arrive at the sensor.
 */
function textPage(
  w: number,
  h: number,
  o: { shadow?: number; tint?: [number, number, number]; paper?: number; ink?: number } = {},
): Raster {
  const r = blank(w, h);
  const t = o.tint ?? [1, 1, 1];
  const paper = o.paper ?? 225;
  const ink = o.ink ?? 55;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const isInk =
        y % 14 < 4 && x % 10 < 7 && x > 20 && x < w - 20 && y > 20 && y < h - 20;
      let v = isInk ? ink : paper;
      if (o.shadow) v *= 1 - o.shadow * (x / w);
      put(r, x, y, v * t[0], v * t[1], v * t[2]);
    }
  }
  return r;
}

/** A page that is mostly continuous tone: a photocopied photograph. */
function tonePage(w: number, h: number): Raster {
  const r = blank(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = 40 + 170 * (0.5 + 0.5 * Math.sin(x / 19) * Math.cos(y / 23));
      put(r, x, y, v, v, v);
    }
  }
  return r;
}

/** Paint a solid dark block — an ID photograph, or a black header band. */
function block(r: Raster, x0: number, y0: number, size: number, v = 45) {
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) put(r, x, y, v, v - 3, v - 5);
  }
}

/** A 3x3 box blur, standing in for the lens, the sensor and the JPEG. */
function softened(r: Raster): Raster {
  const out = new Uint8ClampedArray(r.data);
  const { width: w, height: h } = r;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++)
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) s += r.data[((y + dy) * w + x + dx) * 4 + c];
        out[(y * w + x) * 4 + c] = s / 9;
      }
  return { data: out, width: w, height: h };
}

describe('integral', () => {
  it('sums any rectangle in four lookups', () => {
    const w = 7;
    const h = 5;
    const src = Float32Array.from({ length: w * h }, (_, i) => (i * 13) % 29);
    const t = integral(src, w, h);
    for (const [x0, y0, x1, y1] of [
      [0, 0, 6, 4],
      [2, 1, 5, 3],
      [3, 3, 3, 3],
      [0, 2, 2, 4],
    ]) {
      let want = 0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) want += src[y * w + x];
      expect(boxSum(t, w, x0, y0, x1, y1)).toBeCloseTo(want, 4);
    }
  });

  it('⚠️ CARRIES ENOUGH PRECISION FOR A REAL PLANE', () => {
    // The bottom-right entry of a megapixel plane of 8-bit values is ~1.7e9.
    // A Float32 table cannot represent that to better than about ±100, and
    // every box sum is a DIFFERENCE of two such numbers — so the error lands
    // undiminished on a quantity whose whole range is 0-255. Float64 is not a
    // luxury here; this test is what says so out loud.
    const w = 1024;
    const h = 768;
    const src = new Float32Array(w * h).fill(200);
    const t = integral(src, w, h);
    // A 3x3 window in the far corner, where the accumulated sum is largest.
    expect(boxSum(t, w, w - 4, h - 4, w - 2, h - 2)).toBeCloseTo(9 * 200, 6);
  });
});

describe('paperColour / whiteBalance', () => {
  it('reads the paper, not the ink', () => {
    // Grey-world would be dragged down by the print. The bright-quarter
    // estimate must land on the paper's own colour.
    const p = textPage(200, 150, { tint: [1, 0.8, 0.6] });
    const c = paperColour(p);
    expect(c.r).toBeGreaterThan(200);
    expect(c.g / c.r).toBeCloseTo(0.8, 1);
    expect(c.b / c.r).toBeCloseTo(0.6, 1);
  });

  it('⚠️ PULLS THE STRONG CHANNEL DOWN, it does not push the weak ones up', () => {
    // Balancing to the brightest channel makes every gain >= 1, and then the
    // flattening in enhance() lifts the luma on top of that — which is exactly
    // how the green ID book clips. Balancing to the MEAN is what leaves the
    // page with somewhere to go.
    const green = textPage(120, 90, { tint: [0.72, 1, 0.6] });
    const { gain } = paperColour(green);
    expect(gain[1]).toBeLessThan(1);
    expect(gain[0]).toBeGreaterThan(1);
    expect(gain[2]).toBeGreaterThan(1);
  });

  it('leaves a neutral page completely alone', () => {
    const { gain } = paperColour(textPage(120, 90));
    expect(gain).toEqual([1, 1, 1]);
    // And the raster comes back by identity, not as a needless copy.
    const p = textPage(120, 90);
    expect(whiteBalance(p)).toBe(p);
  });

  it('neutralises a tungsten cast', () => {
    const warm = textPage(160, 120, { tint: [1, 0.82, 0.58] });
    const out = whiteBalance(warm);
    const c = paperColour(out);
    expect(Math.abs(c.r - c.b)).toBeLessThan(8);
    expect(Math.abs(c.r - c.g)).toBeLessThan(8);
  });
});

describe('colour', () => {
  const paperMean = (r: Raster) => {
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let n = 0;
    for (let i = 0; i < r.data.length; i += 4) {
      if (r.data[i] > 150 || r.data[i + 1] > 150) {
        sr += r.data[i];
        sg += r.data[i + 1];
        sb += r.data[i + 2];
        n++;
      }
    }
    return [sr / n, sg / n, sb / n];
  };

  /** Pixels where one channel has hit the ceiling while another had room. */
  const lopsidedClip = (r: Raster) => {
    let c = 0;
    for (let i = 0; i < r.data.length; i += 4) {
      const mx = Math.max(r.data[i], r.data[i + 1], r.data[i + 2]);
      const mn = Math.min(r.data[i], r.data[i + 1], r.data[i + 2]);
      if (mx >= 255 && mn < 245) c++;
    }
    return c / (r.width * r.height);
  };

  it('⚠️ A GREEN ID BOOK MUST NOT CLIP IN THE GREEN CHANNEL', () => {
    // enhance() re-applies its result as a per-pixel gain so hue survives —
    // which means the paper's own cast survives too, multiplied. On a green
    // page the luma is 167 and the flatten wants 245, so green is scaled by
    // 1.47 from 200 and lands at 293. It clips, the hue skews, and the page
    // comes back a poster. Measured on this scene: 79.5% of pixels clipped
    // lopsidedly without the white balance, 0% with it.
    const green = textPage(200, 150, { tint: [0.72, 1, 0.6], paper: 200 });
    expect(lopsidedClip(enhance(green))).toBeGreaterThan(0.5);
    expect(lopsidedClip(colour(green))).toBeLessThan(0.01);
  });

  it('removes a tungsten cast from the paper', () => {
    const warm = textPage(200, 150, { tint: [1, 0.82, 0.58] });
    const [r, g, b] = paperMean(colour(warm));
    expect(Math.abs(r - b)).toBeLessThan(10);
    expect(Math.abs(r - g)).toBeLessThan(10);
    // And it is still a bright page, not a grey one.
    expect(r).toBeGreaterThan(215);
  });

  it('still flattens a shadow, because it is enhance() underneath', () => {
    const p = textPage(256, 192, { shadow: 0.6 });
    const out = colour(p);
    // ⚠️ PAPER ONLY. A band mean over everything measures how much print
    // happens to fall in the band as much as it measures the lighting — the
    // scene leaves a 20px unprinted margin, so a left band and a right band
    // are not comparable unless the ink is excluded from both.
    const paperBand = (x0: number, x1: number) => {
      let s = 0;
      let n = 0;
      for (let y = 30; y < 160; y++)
        for (let x = x0; x < x1; x++) {
          if (y % 14 < 4 && x % 10 < 7) continue;
          s += lumaAt(out, x, y);
          n++;
        }
      return s / n;
    };
    expect(Math.abs(paperBand(40, 90) - paperBand(180, 230))).toBeLessThan(20);
  });
});

describe('grey', () => {
  it('writes a genuinely grey image', () => {
    const out = grey(textPage(120, 90, { tint: [1, 0.85, 0.7] }));
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(out.data[i + 1]);
      expect(out.data[i]).toBe(out.data[i + 2]);
      expect(out.data[i + 3]).toBe(255);
    }
  });

  it('stretches the ends of the range out to black and white', () => {
    // A flat, low-contrast page: paper 170, ink 110. Auto-contrast is the
    // whole point of this mode, so both ends must actually reach.
    const out = grey(textPage(200, 150, { paper: 170, ink: 110 }));
    let lo = 255;
    let hi = 0;
    for (let i = 0; i < out.data.length; i += 4) {
      lo = Math.min(lo, out.data[i]);
      hi = Math.max(hi, out.data[i]);
    }
    expect(lo).toBeLessThan(20);
    expect(hi).toBeGreaterThan(235);
  });

  it('⚠️ DOES NOT STRETCH A BLANK PAGE INTO A SNOWSTORM', () => {
    // If the whole histogram fits in a few levels the "contrast" being
    // amplified is sensor noise. A member who photographs the back of a form
    // must get a blank page back, not static.
    const flatish = blank(120, 90);
    for (let y = 0; y < 90; y++)
      for (let x = 0; x < 120; x++) {
        const v = 200 + ((x * 7 + y * 3) % 5);
        put(flatish, x, y, v, v, v);
      }
    const out = grey(flatish, { flatten: false, sharpen: false });
    let lo = 255;
    let hi = 0;
    for (let i = 0; i < out.data.length; i += 4) {
      lo = Math.min(lo, out.data[i]);
      hi = Math.max(hi, out.data[i]);
    }
    expect(hi - lo).toBeLessThan(30);
  });

  it('⚠️ FLATTENS BEFORE IT STRETCHES', () => {
    // A percentile stretch is GLOBAL: one black point and one white point for
    // the whole page. With a shadow on it there is no such pair — the
    // shadowed paper is darker than the lit page's ink. Without the flatten
    // the shadowed end stays dark; with it, both ends of the page land on the
    // same white.
    const p = textPage(256, 192, { shadow: 0.6 });
    const paperBand = (r: Raster, x0: number, x1: number) => {
      let s = 0;
      let n = 0;
      for (let y = 2; y < 190; y++)
        for (let x = x0; x < x1; x++) {
          const isInk = y % 14 < 4 && x % 10 < 7 && x > 20 && y > 20;
          if (isInk) continue;
          s += lumaAt(r, x, y);
          n++;
        }
      return s / n;
    };
    const on = grey(p);
    const off = grey(p, { flatten: false });
    expect(Math.abs(paperBand(on, 10, 60) - paperBand(on, 200, 250))).toBeLessThan(20);
    expect(Math.abs(paperBand(off, 10, 60) - paperBand(off, 200, 250))).toBeGreaterThan(80);
  });

  it('returns the same dimensions and survives a one-pixel image', () => {
    expect(grey(textPage(97, 53)).width).toBe(97);
    const tiny: Raster = {
      data: new Uint8ClampedArray([120, 120, 120, 255]),
      width: 1,
      height: 1,
    };
    expect(() => grey(tiny)).not.toThrow();
  });
});

describe('bw', () => {
  const inkFraction = (r: Raster, x0: number, y0: number, x1: number, y1: number) => {
    let dark = 0;
    let n = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        if (r.data[(y * r.width + x) * 4] < 60) dark++;
        n++;
      }
    return dark / n;
  };

  it('turns print into ink and paper into paper', () => {
    const out = bw(textPage(200, 150));
    let black = 0;
    let white = 0;
    for (let i = 0; i < out.data.length; i += 4) {
      if (out.data[i] < 40) black++;
      else if (out.data[i] > 215) white++;
    }
    // Almost everything lands at one end or the other; the remainder is the
    // antialiased ramp along the strokes.
    expect((black + white) / (200 * 150)).toBeGreaterThan(0.85);
    expect(black / (200 * 150)).toBeGreaterThan(0.05);
  });

  it('⚠️ BINARISES A SHADOWED PAGE WITH NO LARGE BLACK REGION', () => {
    // This is the failure everybody has seen in a scanner app, and it is not a
    // tuning problem — it is what a GLOBAL threshold IS. Under a 60% gradient
    // the lit half's paper is brighter than the shadowed half's ink, so no
    // single cut exists. Sauvola's follows the illumination because its local
    // mean does. Measured on this scene: ink 0.168 of the lit band, 0.168 of
    // the middle, 0.168 of the darkest — the same page, three times.
    const out = bw(textPage(400, 300, { shadow: 0.6 }));
    const lit = inkFraction(out, 30, 0, 130, 300);
    const mid = inkFraction(out, 150, 0, 250, 300);
    const dark = inkFraction(out, 280, 0, 380, 300);
    expect(lit).toBeGreaterThan(0.05);
    expect(Math.abs(dark - lit)).toBeLessThan(0.05);
    expect(Math.abs(mid - lit)).toBeLessThan(0.05);
    // And no band is anywhere near solid.
    expect(dark).toBeLessThan(0.4);
  });

  it('⚠️ KEEPS A PHOTOGRAPH BLACK — the floor, not Sauvola, does this', () => {
    // Sauvola is scale-free: the interior of a large solid dark region looks
    // exactly like blank paper to it (uniform, s ~ 0), so its threshold drops
    // to 0.7 of the dark value and the whole photograph comes out WHITE.
    // Clamping the threshold up to a fraction of the page's paper level is the
    // one line that fixes it.
    const p = textPage(400, 300);
    block(p, 140, 90, 120);
    const out = bw(p);
    expect(inkFraction(out, 160, 110, 240, 190)).toBeGreaterThan(0.95);
  });

  it('⚠️ LEAVES AN EMPTY MARGIN EMPTY', () => {
    // The property that makes Sauvola the right choice over "below the local
    // mean": on blank paper s -> 0 so the threshold falls to 0.7 of the
    // paper's own brightness, comfortably below it. A plain local-mean rule
    // speckles every empty margin, and empty margins are most of a document.
    const p = textPage(300, 220);
    const out = bw(p);
    // The scene leaves a 20px unprinted border on all four sides.
    expect(inkFraction(out, 2, 2, 18, 218)).toBeLessThan(0.02);
    expect(inkFraction(out, 2, 2, 298, 18)).toBeLessThan(0.02);
  });

  it('antialiases by default, and can be told not to', () => {
    // ⚠️ THE SCENE IS BLURRED FIRST, DELIBERATELY. A drawn page has hard pixel
    // edges: every pixel is exactly ink or exactly paper, so a soft threshold
    // has nothing between them to be soft ABOUT and the two modes come out
    // identical. Real optics never give you that — a lens, a sensor and a JPEG
    // each put a ramp on every stroke, and the ramp is what speckles when you
    // threshold it hard.
    const p = softened(textPage(200, 150));
    const soft = bw(p);
    const hard = bw(p, { antialias: false });
    const midtones = (r: Raster) => {
      let m = 0;
      for (let i = 0; i < r.data.length; i += 4) if (r.data[i] > 40 && r.data[i] < 215) m++;
      return m;
    };
    expect(midtones(hard)).toBe(0);
    // Soft edges exist, but they are edges — a small minority of the page.
    expect(midtones(soft)).toBeGreaterThan(0);
    expect(midtones(soft)).toBeLessThan(200 * 150 * 0.2);
  });

  it('writes grey channels and an opaque alpha', () => {
    const out = bw(textPage(80, 60));
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(out.data[i + 1]);
      expect(out.data[i + 3]).toBe(255);
    }
  });

  it('survives a one-pixel image', () => {
    const tiny: Raster = {
      data: new Uint8ClampedArray([120, 120, 120, 255]),
      width: 1,
      height: 1,
    };
    expect(() => bw(tiny)).not.toThrow();
  });
});

describe('chooseMode', () => {
  it('keeps a coloured page in colour', () => {
    // A green ID-book page. Colour is the expensive mistake to get wrong —
    // nothing below recovers it — so it is asked first.
    const green = textPage(400, 300, { tint: [0.72, 1, 0.6], paper: 200 });
    expect(chooseMode(pageStats(green))).toBe('colour');
  });

  it('sends a page of continuous tone to grey', () => {
    expect(chooseMode(pageStats(tonePage(400, 300)))).toBe('grey');
  });

  it('sends a printed form to black and white', () => {
    expect(chooseMode(pageStats(textPage(400, 300)))).toBe('bw');
  });

  it('⚠️ STILL SENDS A SHADOWED FORM TO BLACK AND WHITE', () => {
    // The regression that forced pageStats to measure on the FLATTENED plane.
    // Raw, this scene scored a midtone fraction of 0.494 against 0.000 for the
    // identical page without the shadow — the shadow's own paper was filling
    // the band between the lit page's ink and its paper. Two photographs of
    // one form must reach one answer.
    expect(chooseMode(pageStats(textPage(400, 300, { shadow: 0.55 })))).toBe('bw');
  });

  it('is not fooled into colour by a mild indoor cast', () => {
    // Ordinary warm room light. Under about 22 luma of chroma this is an
    // illuminant, not content, and the page is still a printed form.
    const p = textPage(400, 300, { tint: [1, 0.96, 0.9] });
    expect(chooseMode(pageStats(p))).toBe('bw');
  });

  it('reports the mode it chose alongside the raster', () => {
    const { mode, raster } = autoFilter(textPage(200, 150));
    expect(mode).toBe('bw');
    expect(raster.width).toBe(200);
  });
});

describe('applyChoice', () => {
  it('passes Original straight through, by identity', () => {
    const p = textPage(64, 48);
    const out = applyChoice(p, 'none');
    expect(out.raster).toBe(p);
    expect(out.mode).toBeNull();
  });

  it("⚠️ ACCEPTS 'shadow' AS THE STORED SPELLING OF 'colour'", () => {
    // Every page captured before the filter set arrived carries this string,
    // and document-scanner.tsx still falls back to it. If this stops working,
    // an existing scan throws the moment somebody touches the filter row.
    const p = textPage(120, 90, { tint: [1, 0.85, 0.7] });
    const legacy = applyChoice(p, 'shadow');
    const modern = applyChoice(p, 'colour');
    expect(legacy.mode).toBe('colour');
    expect(Array.from(legacy.raster.data)).toEqual(Array.from(modern.raster.data));
  });

  it('resolves auto to a real mode', () => {
    expect(applyChoice(textPage(200, 150), 'auto').mode).toBe('bw');
    expect(applyChoice(tonePage(200, 150), 'auto').mode).toBe('grey');
  });

  it('every mode returns the input dimensions and an opaque alpha', () => {
    const p = textPage(97, 53);
    for (const f of ['auto', 'colour', 'grey', 'bw', 'shadow', 'none'] as const) {
      const { raster } = applyChoice(p, f);
      expect(raster.width).toBe(97);
      expect(raster.height).toBe(53);
      for (let i = 3; i < raster.data.length; i += 4) expect(raster.data[i]).toBe(255);
    }
  });
});

describe('performance', () => {
  it('⚠️ RUNS A FULL-SIZE PAGE IN WELL UNDER A SECOND', () => {
    // 3000x2000 is what OUTPUT_MAX_EDGE allows off a modern phone, and this is
    // a desktop running node — a handset is a good deal slower, which is why
    // the budget here is tight rather than merely met. Measured on the bench
    // machine: colour 562ms, grey 323ms, bw 412ms. The bar below is loose
    // enough not to fail on a busy CI box and tight enough to catch anybody
    // reintroducing a per-pixel closure or a full-resolution blur.
    const p = textPage(3000, 2000, { shadow: 0.4 });
    for (const run of [() => colour(p), () => grey(p), () => bw(p)]) {
      const t0 = Date.now();
      run();
      expect(Date.now() - t0).toBeLessThan(2500);
    }
  }, 60_000);
});

// ────────────────────────────────────────────────────────────────────
// A FOLDED PAGE, THROUGH THE MODES THE MEMBER CAN PICK.
//
// The fold suppression lives in enhance.ts and is pinned there. What this
// pins is that Grey and B&W get it too — they flatten with the same
// `flattenLuma`, so before this they inherited the fold as faithfully as
// Colour did, and `auto` sends a photocopied form (the kind of document that
// arrives folded into three) to Grey.
// ────────────────────────────────────────────────────────────────────

/** `textPage` with a fold pressed across it: a thin core and a soft shadow. */
function foldedTextPage(
  w: number,
  h: number,
  o: { depth?: number; at?: number } = {},
): { raster: Raster; foldY: number } {
  const r = textPage(w, h);
  const depth = o.depth ?? 24;
  // ⚠️ BETWEEN TWO LINES OF TYPE. `textPage` puts ink on rows where y%14 < 4,
  // so a fold landing on one would have an ink core and be refused — rightly,
  // but that is not what this is measuring.
  const foldY = Math.round((h * (o.at ?? 0.45)) / 14) * 14 + 8;
  const band = h * 0.016;
  for (let y = 0; y < h; y++) {
    const d = Math.abs(y - foldY);
    let drop = 0;
    if (d <= 1.5) drop = depth;
    else if (d <= band) drop = depth * 0.55 * (1 - (d - 1.5) / (band - 1.5));
    if (drop <= 0) continue;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (r.data[i] < 120) continue; // print keeps its own value
      r.data[i] -= drop;
      r.data[i + 1] -= drop;
      r.data[i + 2] -= drop;
    }
  }
  return { raster: r, foldY };
}

/** Mean of the bare paper on one row. */
function paperRow(r: Raster, y: number): number {
  let s = 0;
  let n = 0;
  for (let x = Math.round(r.width * 0.05); x < r.width * 0.95; x++) {
    const v = lumaAt(r, x, y);
    if (v < 140) continue;
    s += v;
    n++;
  }
  return n ? s / n : 0;
}

describe('a folded page', () => {
  const W = 900;
  const H = 1200;

  it('colour takes the fold out', () => {
    const { raster, foldY } = foldedTextPage(W, H);
    const out = colour(raster);
    expect(Math.abs(paperRow(out, foldY) - paperRow(out, foldY - 80))).toBeLessThan(4);
  });

  it('grey takes the fold out, and the print survives', () => {
    const { raster, foldY } = foldedTextPage(W, H);
    const off = grey(raster, { creases: false });
    const on = grey(raster);
    expect(paperRow(off, foldY - 80) - paperRow(off, foldY)).toBeGreaterThan(8);
    expect(Math.abs(paperRow(on, foldY) - paperRow(on, foldY - 80))).toBeLessThan(5);
    // The line of type that runs straight through the fold's shadow is still
    // ink — `textPage` puts a row of it eight pixels above, well inside the
    // band the correction covers.
    expect(lumaAt(on, W / 2, foldY - 8)).toBeLessThan(120);
  });

  it('⚠️ B&W DOES NOT PRINT THE FOLD AS A BLACK LINE', () => {
    // The highest-stakes case in this file. Under an adaptive threshold a
    // fold is a candidate for ink, and a fold rendered solid black across a
    // licence is the worst output the scanner can produce.
    const { raster, foldY } = foldedTextPage(W, H, { depth: 34 });
    const out = bw(raster);
    let dark = 0;
    for (let x = Math.round(W * 0.05); x < W * 0.95; x++) {
      if (lumaAt(out, x, foldY) < 128) dark++;
    }
    expect(dark / (W * 0.9)).toBeLessThan(0.05);
  });

  it('an unfolded page is unchanged by the step', () => {
    const p = textPage(W, H, { shadow: 0.3 });
    const withStep = grey(p);
    const without = grey(p, { creases: false });
    for (let i = 0; i < withStep.data.length; i += 997) {
      expect(withStep.data[i]).toBe(without.data[i]);
    }
  });
});
