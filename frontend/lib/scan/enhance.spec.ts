import { describe, expect, it } from 'vitest';
import { Raster } from './warp';
import { boxBlur, claheLut, enhance, illuminationField, inspect } from './enhance';

/** A page of print under a lighting gradient, as RGBA. */
function page(
  w: number,
  h: number,
  o: { shadow?: number; paper?: number; ink?: number; colour?: boolean } = {},
): Raster {
  const shadow = o.shadow ?? 0;
  const paper = o.paper ?? 220;
  const ink = o.ink ?? 60;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Rows of "text".
      const isInk = y % 12 < 4 && x % 9 < 6;
      let v = isInk ? ink : paper;
      // A strong gradient across the page: the phone's own shadow.
      if (shadow > 0) v *= 1 - shadow * (x / w);
      const i = (y * w + x) * 4;
      data[i] = v;
      data[i + 1] = o.colour ? v * 0.75 : v;
      data[i + 2] = o.colour ? v * 0.5 : v;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

const lumaAt = (r: Raster, x: number, y: number) => {
  const i = (y * r.width + x) * 4;
  return (77 * r.data[i] + 150 * r.data[i + 1] + 29 * r.data[i + 2]) / 256;
};

/** Contrast between print and paper in one column band. */
function localSwing(r: Raster, xFrom: number, xTo: number): number {
  let lo = 255;
  let hi = 0;
  for (let y = 0; y < r.height; y++) {
    for (let x = xFrom; x < xTo; x++) {
      const v = lumaAt(r, x, y);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  return hi - lo;
}

describe('boxBlur', () => {
  it('preserves the mean', () => {
    const src = Float32Array.from({ length: 64 * 64 }, (_, i) => (i * 37) % 256);
    const before = src.reduce((a, b) => a + b, 0) / src.length;
    const out = boxBlur(src, 64, 64, 4, 3);
    const after = out.reduce((a, b) => a + b, 0) / out.length;
    // Edge clamping shifts it slightly; a few luma steps is expected.
    expect(Math.abs(after - before)).toBeLessThan(4);
  });

  it('flattens a step into a ramp', () => {
    const w = 64;
    const src = new Float32Array(w * 4);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < w; x++) src[y * w + x] = x < 32 ? 0 : 255;
    const out = boxBlur(src, w, 4, 6, 3);
    // Right at the step the value must be somewhere in between.
    expect(out[2 * w + 32]).toBeGreaterThan(40);
    expect(out[2 * w + 32]).toBeLessThan(215);
    // Far from it, unchanged.
    expect(out[2 * w + 2]).toBeLessThan(30);
    expect(out[2 * w + 61]).toBeGreaterThan(225);
  });
});

describe('illuminationField', () => {
  it('follows the lighting and ignores the print', () => {
    const p = page(256, 192, { shadow: 0.55 });
    const luma = new Float32Array(256 * 192);
    for (let i = 0; i < luma.length; i++) luma[i] = lumaAt(p, i % 256, (i / 256) | 0);
    const field = illuminationField(luma, 256, 192);

    // The field must be much brighter on the lit side than the shadowed one.
    const left = field[100 * 256 + 10];
    const right = field[100 * 256 + 245];
    expect(left).toBeGreaterThan(right * 1.4);

    // And it must be SMOOTH — no glyph should show through it, or dividing by
    // it would erase the text along with the shadow.
    let maxStep = 0;
    for (let x = 1; x < 255; x++) {
      maxStep = Math.max(
        maxStep,
        Math.abs(field[100 * 256 + x] - field[100 * 256 + x - 1]),
      );
    }
    expect(maxStep).toBeLessThan(6);
  });
});

describe('claheLut', () => {
  it('produces one non-decreasing curve per tile', () => {
    const luma = Float32Array.from({ length: 128 * 128 }, (_, i) => (i * 13) % 256);
    const luts = claheLut(luma, 128, 128, 8, 64);
    expect(luts).toHaveLength(64);
    for (const l of luts) {
      for (let b = 1; b < l.length; b++) expect(l[b]).toBeGreaterThanOrEqual(l[b - 1]);
    }
  });

  it('⚠️ CLIPS, so flat paper does not become amplified noise', () => {
    // A tile of almost-uniform paper. Unclipped equalisation would stretch its
    // tiny variation across the whole range — which is sensor noise, magnified.
    const w = 64;
    const luma = new Float32Array(w * w).fill(200);
    for (let i = 0; i < luma.length; i += 7) luma[i] = 202;
    const clipped = claheLut(luma, w, w, 8, 64, 3);
    const wild = claheLut(luma, w, w, 8, 64, 1000);
    const spread = (l: Float32Array) => l[l.length - 1] - l[0];
    // Both saturate at the top; the clipped one starts far higher, meaning it
    // has NOT stretched the near-empty low bins across the range.
    expect(spread(clipped[0])).toBeLessThan(spread(wild[0]));
  });
});

describe('inspect', () => {
  it('measures glare', () => {
    // A blown-out page: nothing to recover, but we can SAY so, and a member
    // tilting the phone fixes it completely.
    expect(inspect(page(64, 64, { paper: 255, ink: 255 })).glare).toBeGreaterThan(
      0.9,
    );
    // A normal page must not be reported as glared.
    expect(inspect(page(64, 64)).glare).toBeLessThan(0.05);
  });

  it('measures sharpness, and a blurred page scores lower', () => {
    const sharp = page(128, 128);
    const soft: Raster = {
      data: new Uint8ClampedArray(sharp.data),
      width: 128,
      height: 128,
    };
    // Blur it by hand.
    for (let pass = 0; pass < 3; pass++) {
      const copy = new Uint8ClampedArray(soft.data);
      for (let y = 1; y < 127; y++)
        for (let x = 1; x < 127; x++)
          for (let k = 0; k < 3; k++) {
            const i = (y * 128 + x) * 4 + k;
            soft.data[i] =
              (copy[i - 4] + copy[i + 4] + copy[i - 512] + copy[i + 512]) / 4;
          }
    }
    expect(inspect(sharp).sharpness).toBeGreaterThan(inspect(soft).sharpness);
  });

  it('measures mean luma', () => {
    expect(inspect(page(32, 32, { paper: 30, ink: 20 })).meanLuma).toBeLessThan(40);
    expect(inspect(page(32, 32, { paper: 240, ink: 200 })).meanLuma).toBeGreaterThan(
      180,
    );
  });
});

describe('enhance', () => {
  it('⚠️ EVENS OUT A SHADOW ACROSS THE PAGE', () => {
    // The whole point. Before: the shadowed side is far darker than the lit
    // side, and a vision model reading small print there struggles. After: the
    // two sides sit at a similar level and the print/paper swing survives on
    // BOTH.
    const before = page(256, 192, { shadow: 0.6 });
    const after = enhance(before);

    const meanBand = (r: Raster, x0: number, x1: number) => {
      let s = 0;
      let n = 0;
      for (let y = 0; y < r.height; y++)
        for (let x = x0; x < x1; x++) {
          s += lumaAt(r, x, y);
          n++;
        }
      return s / n;
    };

    const litBefore = meanBand(before, 5, 40);
    const darkBefore = meanBand(before, 215, 250);
    const litAfter = meanBand(after, 5, 40);
    const darkAfter = meanBand(after, 215, 250);

    // The two ends started far apart and must end up much closer together.
    const spreadBefore = Math.abs(litBefore - darkBefore);
    const spreadAfter = Math.abs(litAfter - darkAfter);
    expect(spreadBefore).toBeGreaterThan(60);
    expect(spreadAfter).toBeLessThan(spreadBefore / 2);

    // And the text must still be there on the previously dark side — this is
    // the check that we flattened the LIGHTING and not the CONTENT.
    expect(localSwing(after, 215, 250)).toBeGreaterThan(40);
  });

  it('⚠️ SENDS THE PAPER TO WHITE, NOT TO THE AVERAGE', () => {
    // The operator's side-by-side against the plain camera app: our scan came
    // out uniformly GREY, because flattening normalised to the field's own
    // mean — it removed the gradient and preserved the murk. A scan's paper
    // is white. That is half of what makes it read as a scan.
    const before = page(256, 192, { paper: 150, ink: 40 });
    const after = enhance(before);
    let paperSum = 0;
    let n = 0;
    for (let y = 5; y < 187; y++) {
      for (let x = 5; x < 251; x++) {
        const isInk = y % 12 < 4 && x % 9 < 6;
        if (!isInk) {
          paperSum += lumaAt(after, x, y);
          n++;
        }
      }
    }
    expect(paperSum / n).toBeGreaterThan(215);
  });

  it('⚠️ REMOVES A HARD-EDGED SHADOW, not only a soft gradient', () => {
    // The hand shadow in the operator's SAPS-form scan had a sharp edge, and
    // a blurred illumination field glides straight across an edge like that —
    // the estimate barely dips, so the division barely lifts, and the shadow
    // stays on the page. The paper field follows it exactly because paper in
    // shadow is still the local maximum.
    const w = 256;
    const h = 192;
    const before = page(w, h, { paper: 230, ink: 50 });
    // A hard 45% shadow over the right half, applied to everything.
    for (let y = 0; y < h; y++) {
      for (let x = 128; x < w; x++) {
        const i = (y * w + x) * 4;
        before.data[i] = before.data[i] * 0.55;
        before.data[i + 1] = before.data[i + 1] * 0.55;
        before.data[i + 2] = before.data[i + 2] * 0.55;
      }
    }
    const after = enhance(before);
    const paperMean = (r: typeof after, x0: number, x1: number) => {
      let sum = 0;
      let n = 0;
      for (let y = 5; y < h - 5; y++) {
        for (let x = x0; x < x1; x++) {
          const isInk = y % 12 < 4 && x % 9 < 6;
          if (!isInk) {
            sum += lumaAt(r, x, y);
            n++;
          }
        }
      }
      return sum / n;
    };
    // Away from the boundary band, lit and shadowed paper must land on the
    // SAME white — that is the uniform background the operator asked for.
    const lit = paperMean(after, 20, 100);
    const shaded = paperMean(after, 160, 240);
    expect(Math.abs(lit - shaded)).toBeLessThan(14);
    expect(shaded).toBeGreaterThan(205);
  });

  it('⚠️ DOES NOT DRAG A PHOTOGRAPH UP TO WHITE with the paper', () => {
    // An ID photo is a large genuinely-dark region. The gain cap is what
    // keeps it one: paper whitens because its background estimate IS paper;
    // the photo's estimate is the photo, and the cap stops the division
    // inventing brightness that was never there.
    const w = 256;
    const h = 192;
    const before = page(w, h, { paper: 225 });
    // A 70px-wide dark photograph block.
    for (let y = 60; y < 150; y++) {
      for (let x = 90; x < 160; x++) {
        const i = (y * w + x) * 4;
        before.data[i] = 55;
        before.data[i + 1] = 50;
        before.data[i + 2] = 48;
      }
    }
    const after = enhance(before);
    let sum = 0;
    let n = 0;
    for (let y = 80; y < 130; y++) {
      for (let x = 110; x < 140; x++) {
        sum += lumaAt(after, x, y);
        n++;
      }
    }
    // Well below paper. (CLAHE lifts it some; identity it is not.)
    expect(sum / n).toBeLessThan(160);
  });

  it('keeps colour, because the classifier reads it', () => {
    // A warm-toned card. If enhancement worked on greyscale and wrote back
    // grey, the classifier loses the strongest cue it has for telling one kind
    // of document from another.
    const before = page(128, 96, { colour: true, shadow: 0.3 });
    const after = enhance(before);
    let colouredPixels = 0;
    for (let i = 0; i < after.data.length; i += 4) {
      if (after.data[i] > after.data[i + 2] + 10) colouredPixels++;
    }
    expect(colouredPixels).toBeGreaterThan((after.data.length / 4) * 0.5);
  });

  it('does not binarise — mid-tones survive', () => {
    // Deliberate: a 1-bit image is worse for a multimodal model, and it
    // destroys the laminate and security print on a licence card.
    const after = enhance(page(128, 96, { paper: 200, ink: 90 }));
    let mids = 0;
    for (let i = 0; i < after.data.length; i += 4) {
      const v = after.data[i];
      if (v > 40 && v < 215) mids++;
    }
    expect(mids).toBeGreaterThan(0);
  });

  it('leaves the alpha channel opaque', () => {
    const after = enhance(page(64, 64));
    for (let i = 3; i < after.data.length; i += 4) expect(after.data[i]).toBe(255);
  });

  it('returns the same dimensions', () => {
    const after = enhance(page(97, 53));
    expect(after.width).toBe(97);
    expect(after.height).toBe(53);
  });

  it('each stage can be turned off independently', () => {
    const src = page(96, 96, { shadow: 0.4 });
    const none = enhance(src, {
      flatten: false,
      localContrast: false,
      sharpen: false,
    });
    // With everything off it is a pass-through.
    for (let i = 0; i < src.data.length; i += 401) {
      expect(Math.abs(none.data[i] - src.data[i])).toBeLessThanOrEqual(2);
    }
  });

  it('survives a one-pixel image', () => {
    const tiny: Raster = {
      data: new Uint8ClampedArray([120, 120, 120, 255]),
      width: 1,
      height: 1,
    };
    expect(() => enhance(tiny)).not.toThrow();
  });
});
