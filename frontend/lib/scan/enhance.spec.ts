import { describe, expect, it } from 'vitest';
import { Raster } from './warp';
import {
  boxBlur,
  claheAt,
  claheLut,
  dilate,
  enhance,
  erode,
  findCreases,
  flattenLuma,
  illuminationField,
  inspect,
  lumaPlane,
  meanAbsLaplacian,
  paperField,
  paperLevel,
  sharpenPlan,
  suppressCreases,
  unsharp,
  SHARP_CRISP,
  SHARP_SOFT,
} from './enhance';

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


// ────────────────────────────────────────────────────────────────────
// THE RING AROUND AN ID PHOTOGRAPH.
// ────────────────────────────────────────────────────────────────────

/** A printed page with one solid dark square on it: an ID photo, or a stamp. */
function pageWithBlock(
  w: number,
  h: number,
  sq: number,
  o: { paper?: number; ink?: number; block?: number } = {},
): Raster {
  const paper = o.paper ?? 214;
  const ink = o.ink ?? 60;
  const dark = o.block ?? 45;
  const x0 = Math.round((w - sq) / 2);
  const y0 = Math.round((h - sq) / 2);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inBlock = x >= x0 && x < x0 + sq && y >= y0 && y < y0 + sq;
      const isInk = !inBlock && y % 12 < 3 && x % 9 < 5;
      const v = inBlock ? dark : isInk ? ink : paper;
      const i = (y * w + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

const BLOCK_INK = (x: number, y: number) => y % 12 < 3 && x % 9 < 5;

describe('erode', () => {
  it('is the counterpart of dilate', () => {
    const w = 32;
    const src = new Float32Array(w * w).fill(200);
    for (let y = 14; y < 18; y++) for (let x = 14; x < 18; x++) src[y * w + x] = 20;
    // A closing fills a gap narrower than its structuring element...
    const closed = erode(dilate(src, w, w, 6), w, w, 6);
    expect(closed[16 * w + 16]).toBeGreaterThan(180);
    // ...and leaves one wider than it exactly where it was. THIS is the
    // property that makes a closing safe across a shadow edge, where a max
    // filter alone lifts a band of its own radius on the dark side.
    const big = new Float32Array(w * w).fill(200);
    for (let y = 4; y < 28; y++) for (let x = 4; x < 28; x++) big[y * w + x] = 20;
    const closedBig = erode(dilate(big, w, w, 3), w, w, 3);
    expect(closedBig[16 * w + 16]).toBeCloseTo(20, 3);
  });
});

describe('paperField', () => {
  it('\u26a0\ufe0f DOES NOT COLLAPSE INSIDE A DARK REGION WIDER THAN THE MAX FILTER', () => {
    // One scale could only find paper within its own radius, so inside a
    // 120px block there was none to find and the estimate fell onto the block
    // itself. The coarse closing reads straight across it at the paper level
    // around it.
    const p = pageWithBlock(512, 512, 120);
    const field = paperField(lumaPlane(p), 512, 512);
    const at = (x: number, y: number) => field[y * 512 + x];
    expect(at(20, 20)).toBeGreaterThan(190);
    expect(at(256, 256)).toBeGreaterThan(at(20, 20) * 0.85);
  });

  it('\u26a0\ufe0f STILL FOLLOWS A HARD SHADOW, which the coarse scale must not erase', () => {
    // The whole risk of a second, wider estimate: reach far enough for a
    // photograph and you reach across a shadow boundary too, and the field
    // stops tracking the thing it exists to track. A CLOSING cannot — the
    // erode takes the dark value back — and this is the test that says so.
    const w = 256;
    const h = 256;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = 230 * (x < w / 2 ? 1 : 0.45);
        const i = (y * w + x) * 4;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    const field = paperField(lumaPlane({ data, width: w, height: h }), w, h);
    expect(field[128 * w + 40]).toBeGreaterThan(200);
    expect(field[128 * w + 215]).toBeLessThan(130);
  });
});

describe('enhance, around a photograph', () => {
  it('\u26a0\ufe0f LEAVES NO RING DARKER THAN THE PAPER OUTSIDE A 120px DARK SQUARE', () => {
    // The guard against over-correcting. An inpainted or blurred background
    // estimate that reaches too far pulls the paper's own estimate UP near the
    // block, which divides that paper DOWN — a dark halo hugging every
    // photograph, which is both the artefact the fix exists to remove and the
    // easiest one to reintroduce while removing it.
    const W = 512;
    const SQ = 120;
    const after = enhance(pageWithBlock(W, W, SQ));
    const x0 = (W - SQ) / 2;
    const x1 = x0 + SQ;

    const paperAt = (x: number, y: number) =>
      BLOCK_INK(x, y) ? null : lumaAt(after, x, y);
    let far = 0;
    let farN = 0;
    for (let y = 8; y < 40; y++)
      for (let x = 8; x < 40; x++) {
        const v = paperAt(x, y);
        if (v !== null) {
          far += v;
          farN++;
        }
      }
    const paper = far / farN;

    let worst = 255;
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const dx = x < x0 ? x0 - x : x >= x1 ? x - x1 + 1 : 0;
        const dy = y < x0 ? x0 - y : y >= x1 ? y - x1 + 1 : 0;
        const d = Math.max(dx, dy);
        if (d < 1 || d > 40) continue;
        const v = paperAt(x, y);
        if (v !== null) worst = Math.min(worst, v);
      }
    }
    expect(worst).toBeGreaterThan(paper - 12);
  });

  it('\u26a0\ufe0f GIVES THE WHOLE SQUARE ONE GAIN — no dark rim, no washed-out middle', () => {
    // What actually broke. Measured before the second scale: rim 50, centre
    // 143 — the max filter found paper near the edge and nothing at all in the
    // middle, so the middle took the 2.5x cap and the rim took 1.15x, and the
    // photograph came out with a ring drawn round the inside of it. After the
    // fix: rim 53, centre 55.
    const W = 512;
    const SQ = 120;
    const after = enhance(pageWithBlock(W, W, SQ));
    const x0 = (W - SQ) / 2;

    const mean = (bx0: number, by0: number, bx1: number, by1: number) => {
      let s = 0;
      let n = 0;
      for (let y = by0; y < by1; y++)
        for (let x = bx0; x < bx1; x++) {
          s += lumaAt(after, x, y);
          n++;
        }
      return s / n;
    };
    const rim = mean(x0 + 2, x0 + 2, x0 + SQ - 2, x0 + 8);
    const core = mean(x0 + 45, x0 + 45, x0 + 75, x0 + 75);
    expect(Math.abs(core - rim)).toBeLessThan(15);
    // And the square is still a dark square, not a grey one.
    expect(core).toBeLessThan(110);
  });
});

describe('the inlined CLAHE loop', () => {
  it('\u26a0\ufe0f MATCHES claheAt PIXEL FOR PIXEL', () => {
    // enhance() hoists the column half of claheAt out of a six-million-call
    // loop. The saving is real (894ms to 562ms on the 3000x2000 bench) and so
    // is the risk: an off-by-one in the tile weights would shift the whole
    // image by half a tile and nothing else in the suite would notice. This
    // rebuilds enhance() out of the exported primitives, using the readable
    // claheAt, and demands the same pixels.
    const w = 97;
    const h = 61;
    const src = page(w, h, { shadow: 0.4, paper: 210, ink: 70 });
    const mine = enhance(src);

    const luma = lumaPlane(src);
    const corrected = flattenLuma(luma, w, h);
    const luts = claheLut(corrected, w, h, 8, 64, 2);
    const lifted = new Float32Array(corrected.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        lifted[i] = claheAt(luts, 8, 64, w, h, x, y, corrected[i]);
      }
    // The sharpener is rebuilt from its OWN exported pieces rather than
    // re-implemented here, so this stays a pin on the CLAHE loop instead of
    // quietly becoming a second, weaker copy of the unsharp tests below.
    const sharp = unsharp(lifted, w, h, sharpenPlan(meanAbsLaplacian(luma, w, h, 2)));
    const ref = new Uint8ClampedArray(src.data.length);
    for (let i = 0, q = 0; q < lifted.length; i += 4, q++) {
      const f = sharp[q];
      const gain = luma[q] > 1 ? f / luma[q] : 1;
      ref[i] = src.data[i] * gain;
      ref[i + 1] = src.data[i + 1] * gain;
      ref[i + 2] = src.data[i + 2] * gain;
      ref[i + 3] = src.data[i + 3];
    }
    for (let i = 0; i < ref.length; i++) {
      expect(Math.abs(mine.data[i] - ref[i])).toBeLessThanOrEqual(1);
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// SMALL PRINT ON REAL-ISH PAPER.
//
// `page()` above draws 4px slabs of solid ink, which is a hard edge and a
// caricature of print — it cannot show a halo, because a halo lives on the
// paper NEXT to a stroke and a slab that wide has almost no next-to. These
// scenes draw glyph-sized marks instead: 8px tall, 2px strokes, with word gaps
// and margins, which is what a licence or a certificate actually is.
//
// ⚠️ EVERYTHING HERE IS DRAWN, NOT PHOTOGRAPHED — the real fixtures carry a
// name, an ID number and licence serials, they live in a gitignored folder,
// and a regression that cannot be committed is not a regression test. The
// numbers asserted below were measured against these scenes.
// ────────────────────────────────────────────────────────────────────

interface PrintPage {
  raster: Raster;
  /** 1 where a stroke was drawn. */
  ink: Uint8Array;
}

/**
 * A page of 8px type.
 *
 * `soften` blurs it, which is what a phone with a lower-resolving lens does —
 * the operator's Samsung against his iPhone — and is the condition under which
 * a symmetric unsharp mask paints a grey ring round every glyph.
 */
function printPage(
  w: number,
  h: number,
  o: { paper?: number; ink?: number; soften?: number } = {},
): PrintPage {
  const paper = o.paper ?? 232;
  const inkV = o.ink ?? 55;
  const plane = new Float32Array(w * h).fill(paper);
  const ink = new Uint8Array(w * h);
  // Lines of 8px type on a 20px pitch, inside a 10% margin, with word gaps.
  for (let ty = Math.round(h * 0.1); ty < h * 0.9 - 8; ty += 20) {
    let x = Math.round(w * 0.1);
    while (x < w * 0.9 - 8) {
      const word = 3 + ((x * 7 + ty * 3) % 5);
      for (let g = 0; g < word && x < w * 0.9 - 8; g++, x += 7) {
        // A glyph: two 2px uprights and a crossbar, 8px tall.
        for (let dy = 0; dy < 8; dy++) {
          for (const dx of [0, 1, 4, 5]) ink[(ty + dy) * w + x + dx] = 1;
        }
        for (const dx of [2, 3]) {
          ink[(ty + 4) * w + x + dx] = 1;
          ink[(ty + 5) * w + x + dx] = 1;
        }
      }
      x += 7; // the space between words
    }
  }
  for (let i = 0; i < plane.length; i++) if (ink[i]) plane[i] = inkV;
  if (o.soften) plane.set(boxBlur(plane, w, h, o.soften, 2));

  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0, i = 0; p < plane.length; p++, i += 4) {
    data[i] = plane[p];
    data[i + 1] = plane[p];
    data[i + 2] = plane[p];
    data[i + 3] = 255;
  }
  return { raster: { data, width: w, height: h }, ink };
}

/**
 * ⚠️ A SEPARATE SCENE FOR THE HALO, AND IT HAS TO BE SPARSE.
 *
 * On `printPage` the glyphs sit 7px apart, so "paper within 3px of a stroke"
 * is mostly the 2px counter INSIDE a letter — which on a softened source is
 * grey because the two uprights have bled into it, and no photometric filter
 * can or should make it white again. Measuring a halo there measures the
 * scene, not the code: it read 70 levels before the mask ran at all.
 *
 * This grid of isolated 2x8 strokes, 40px apart, is the same 8px print at the
 * same stroke width, but with real open paper on every side of every mark —
 * so near-paper and far-paper both mean what they say.
 */
function spacedMarks(
  w: number,
  h: number,
  o: { soften?: number } = {},
): PrintPage {
  const plane = new Float32Array(w * h).fill(232);
  const ink = new Uint8Array(w * h);
  for (let y = 20; y < h - 20; y += 40) {
    for (let x = 20; x < w - 20; x += 40) {
      for (let dy = 0; dy < 8; dy++)
        for (let dx = 0; dx < 2; dx++) ink[(y + dy) * w + x + dx] = 1;
    }
  }
  for (let i = 0; i < plane.length; i++) if (ink[i]) plane[i] = 55;
  if (o.soften) plane.set(boxBlur(plane, w, h, o.soften, 2));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0, i = 0; p < plane.length; p++, i += 4) {
    data[i] = plane[p];
    data[i + 1] = plane[p];
    data[i + 2] = plane[p];
    data[i + 3] = 255;
  }
  return { raster: { data, width: w, height: h }, ink };
}

/** Chebyshev distance from the drawn strokes, capped. */
function distanceFromInk(ink: Uint8Array, w: number, h: number, cap: number) {
  const d = new Int32Array(w * h).fill(cap);
  for (let i = 0; i < ink.length; i++) if (ink[i]) d[i] = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let m = d[i];
      if (x > 0) m = Math.min(m, d[i - 1] + 1);
      if (y > 0) m = Math.min(m, d[i - w] + 1);
      if (x > 0 && y > 0) m = Math.min(m, d[i - w - 1] + 1);
      if (x < w - 1 && y > 0) m = Math.min(m, d[i - w + 1] + 1);
      d[i] = m;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let m = d[i];
      if (x < w - 1) m = Math.min(m, d[i + 1] + 1);
      if (y < h - 1) m = Math.min(m, d[i + w] + 1);
      if (x < w - 1 && y < h - 1) m = Math.min(m, d[i + w + 1] + 1);
      if (x > 0 && y < h - 1) m = Math.min(m, d[i + w - 1] + 1);
      d[i] = m;
    }
  return d;
}

/**
 * THE HALO NUMBER: paper 1–3px from a stroke, against paper 18–24px away.
 * Positive means the near paper is DARKER — the grey shadow round the text.
 * `edge` is the contrast across the stroke boundary, which is what any halo
 * fix is at risk of paying with.
 */
function haloOf(
  plane: Float32Array,
  w: number,
  h: number,
  ink: Uint8Array,
  nearFrom = 1,
  nearTo = 3,
) {
  const d = distanceFromInk(ink, w, h, 40);
  let near = 0;
  let nearN = 0;
  let far = 0;
  let farN = 0;
  let edge = 0;
  let edgeN = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = plane[i];
      if (d[i] >= 18 && d[i] <= 24) {
        far += v;
        farN++;
        continue;
      }
      if (d[i] < nearFrom || d[i] > nearTo) continue;
      near += v;
      nearN++;
      if (d[i] !== 1) continue;
      let best = 0;
      if (x > 0 && ink[i - 1]) best = Math.max(best, v - plane[i - 1]);
      if (x < w - 1 && ink[i + 1]) best = Math.max(best, v - plane[i + 1]);
      if (y > 0 && ink[i - w]) best = Math.max(best, v - plane[i - w]);
      if (y < h - 1 && ink[i + w]) best = Math.max(best, v - plane[i + w]);
      if (best > 0) {
        edge += best;
        edgeN++;
      }
    }
  }
  return {
    halo: (farN ? far / farN : 0) - (nearN ? near / nearN : 0),
    edge: edgeN ? edge / edgeN : 0,
  };
}

describe('the sharpening schedule', () => {
  it('gives a soft source a bigger radius, less gain and a deadzone', () => {
    const soft = sharpenPlan(SHARP_SOFT - 1);
    const crisp = sharpenPlan(SHARP_CRISP + 4);
    expect(soft.radius).toBeGreaterThan(crisp.radius);
    expect(soft.gain).toBeLessThan(crisp.gain);
    expect(soft.threshold).toBeGreaterThan(2);
    expect(soft.passes).toBeGreaterThan(1);
  });

  it('⚠️ LEAVES A CRISP SOURCE ON EXACTLY THE OLD SETTINGS', () => {
    // 0.6, radius 1, one pass, no deadzone is what this file did before the
    // schedule existed. A sharp iPhone capture must change only by the halo
    // clamp, or "we fixed the Samsung" would quietly also mean "we changed
    // the iPhone".
    const crisp = sharpenPlan(SHARP_CRISP);
    expect(crisp.gain).toBeCloseTo(0.6, 6);
    expect(crisp.radius).toBe(1);
    expect(crisp.passes).toBe(1);
    expect(crisp.threshold).toBeCloseTo(0, 6);
  });

  it('is continuous, and clamps outside the measured range', () => {
    expect(sharpenPlan(-100)).toEqual(sharpenPlan(SHARP_SOFT));
    expect(sharpenPlan(1000)).toEqual(sharpenPlan(SHARP_CRISP));
    const mid = sharpenPlan((SHARP_SOFT + SHARP_CRISP) / 2);
    expect(mid.gain).toBeGreaterThan(sharpenPlan(SHARP_SOFT).gain);
    expect(mid.gain).toBeLessThan(sharpenPlan(SHARP_CRISP).gain);
  });

  it('measures a soft page as soft and a crisp one as crisp', () => {
    const crisp = printPage(320, 240);
    const soft = printPage(320, 240, { soften: 3 });
    const lap = (p: PrintPage) => meanAbsLaplacian(lumaPlane(p.raster), 320, 240);
    expect(lap(crisp)).toBeGreaterThan(SHARP_CRISP);
    expect(lap(soft)).toBeLessThan(SHARP_SOFT);
  });

  it('the strided Laplacian agrees with the exact one', () => {
    // enhance() measures with step 2 to save a full-resolution pass; inspect()
    // measures with step 1 because the verdicts the member sees read it.
    const p = printPage(320, 240, { soften: 1 });
    const luma = lumaPlane(p.raster);
    const exact = meanAbsLaplacian(luma, 320, 240, 1);
    expect(meanAbsLaplacian(luma, 320, 240, 2)).toBeCloseTo(exact, 0);
    expect(inspect(p.raster).sharpness).toBeCloseTo(exact, 6);
  });
});

describe('the halo-suppressed unsharp mask', () => {
  it('⚠️ DOES NOT DARKEN THE PAPER ROUND THE TEXT', () => {
    // The operator's report, in a number: on the Samsung output there was a
    // grey ring on the paper against every glyph. Measured here, the paper
    // 1–3px from a stroke comes out 5.3 levels BRIGHTER than the open page,
    // not darker. The bar is 2 levels of darkening.
    const p = spacedMarks(420, 300);
    const after = enhance(p.raster);
    expect(haloOf(lumaPlane(after), 420, 300, p.ink).halo).toBeLessThanOrEqual(2);
  });

  it('⚠️ AND DOES NOT ADD ONE TO A SOFT SOURCE EITHER', () => {
    // ⚠️ READ AT 4–6px, AND THAT IS NOT THE BAR BEING MOVED. A soft lens has
    // already smeared the stroke into the paper 1–3px away BEFORE any of this
    // runs — on this scene the source itself is 15 levels grey there, and
    // taking that out is deconvolution, not a filter, and would come out of
    // the small print. What the pipeline must not do is INVENT darkening
    // where the optics left none, and 4–6px is where the optics left none:
    // source 0.0, output −1.0.
    const p = spacedMarks(420, 300, { soften: 1 });
    const before = lumaPlane(p.raster);
    expect(haloOf(before, 420, 300, p.ink, 4, 6).halo).toBeLessThan(0.5);
    const after = lumaPlane(enhance(p.raster));
    expect(haloOf(after, 420, 300, p.ink, 4, 6).halo).toBeLessThanOrEqual(2);
  });

  it('⚠️ AND KEEPS THE SMALL PRINT AT LEAST AS LEGIBLE', () => {
    // The trap in any halo fix is paying for it with contrast, so this is
    // measured against what SHIPPED — the fixed 0.6 gain at radius 1 with no
    // deadzone and no paper protection — and not against a strawman.
    //
    // Measured on this scene: edge contrast between a stroke and the paper
    // beside it 41.9 → 44.6 at σ=1 and 13.2 → 14.1 at σ=2. It goes UP, because
    // a radius that spans the ramp is what a soft source needed; the clamp
    // only ever touches the paper side, which is not where the contrast is.
    const w = 420;
    const h = 300;
    for (const soften of [1, 2]) {
      const p = spacedMarks(w, h, { soften });
      const luma = lumaPlane(p.raster);
      const mine = unsharp(luma, w, h, sharpenPlan(meanAbsLaplacian(luma, w, h, 2)));
      const blur = boxBlur(luma, w, h, 1, 1);
      const shipped = new Float32Array(luma.length);
      for (let i = 0; i < luma.length; i++) {
        shipped[i] = Math.max(0, Math.min(255, luma[i] + 0.6 * (luma[i] - blur[i])));
      }
      expect(haloOf(mine, w, h, p.ink).edge).toBeGreaterThan(
        haloOf(shipped, w, h, p.ink).edge,
      );
      // …and out where the lens left the paper clean, it is no darker.
      expect(haloOf(mine, w, h, p.ink, 4, 6).halo).toBeLessThanOrEqual(
        haloOf(shipped, w, h, p.ink, 4, 6).halo,
      );
    }
  });

  it('lets ink darken freely while paper may lose only two levels', () => {
    const w = 64;
    const h = 64;
    const plane = new Float32Array(w * h).fill(240);
    for (let y = 20; y < 44; y++) for (let x = 20; x < 44; x++) plane[y * w + x] = 40;
    // A little texture, so the mask has something to bite on everywhere.
    for (let i = 0; i < plane.length; i++) plane[i] += ((i % w) % 7) - 3;
    const before = Float32Array.from(plane);
    const out = unsharp(plane, w, h, { gain: 2, radius: 3, passes: 2, threshold: 0 });
    let biggest = 0;
    for (let i = 0; i < before.length; i++) {
      if (before[i] > 240 * 0.88) {
        expect(before[i] - out[i]).toBeLessThanOrEqual(2.01);
      }
      biggest = Math.max(biggest, before[i] - out[i]);
    }
    // …and somewhere on the blob's rim it darkened by a great deal more, which
    // is the contrast the clamp is careful not to take away.
    expect(biggest).toBeGreaterThan(10);
  });

  it('the deadzone leaves flat noise alone', () => {
    const w = 48;
    const h = 48;
    const plane = new Float32Array(w * h);
    for (let i = 0; i < plane.length; i++) plane[i] = 230 + ((i * 37) % 3) - 1;
    const before = Float32Array.from(plane);
    const out = unsharp(plane, w, h, { gain: 0.5, radius: 3, passes: 2, threshold: 3 });
    for (let i = 0; i < before.length; i++) {
      expect(Math.abs(out[i] - before[i])).toBeLessThanOrEqual(0.01);
    }
  });

  it('paperLevel finds the paper on a printed page', () => {
    const p = printPage(200, 200);
    expect(paperLevel(lumaPlane(p.raster), 0.9)).toBeGreaterThan(225);
  });
});

// ────────────────────────────────────────────────────────────────────
// CREASES
// ────────────────────────────────────────────────────────────────────

/**
 * A printed page with a fold pressed into it: a thin dark core with a soft
 * shadow either side.
 *
 * ⚠️ THE FOLD IS DRAWN OVER THE PAPER ONLY, and that is what lets the test
 * demand every stroke back byte for byte. A real fold does darken the ink it
 * crosses a little; leaving that out here makes the assertion sharper, not
 * weaker, because the code's rule is "anything this dark is ink, do not touch
 * it" either way.
 */
function foldedPage(
  w: number,
  h: number,
  o: {
    tiltDeg?: number;
    depth?: number;
    core?: number;
    bandFrac?: number;
    at?: number;
    vertical?: boolean;
  } = {},
): PrintPage {
  const { raster, ink } = printPage(w, h);
  const tilt = Math.tan(((o.tiltDeg ?? 0) * Math.PI) / 180);
  const depth = o.depth ?? 22;
  const core = o.core ?? 3;
  const vertical = o.vertical ?? false;
  const nAcross = vertical ? w : h;
  const nAlong = vertical ? h : w;
  // ⚠️ 0.425 PUTS THE FOLD BETWEEN TWO LINES OF TYPE, and that is deliberate:
  // at 0.42 it lands exactly ON one, its core is ink for most of its length,
  // and the ink gate refuses it. That is the right refusal — a fold hidden
  // under a line of print is a fold we would rather miss than guess at — but
  // it is not what these tests are measuring.
  const centre = nAcross * (o.at ?? 0.425);
  const band = nAcross * (o.bandFrac ?? 0.016);
  for (let a = 0; a < nAlong; a++) {
    const line = centre + (a - nAlong / 2) * tilt;
    for (let c = 0; c < nAcross; c++) {
      const x = vertical ? c : a;
      const y = vertical ? a : c;
      const p = y * w + x;
      if (ink[p]) continue;
      const d = Math.abs(c - line);
      let drop = 0;
      if (d <= core / 2) drop = depth;
      else if (d <= band) drop = depth * 0.55 * (1 - (d - core / 2) / (band - core / 2));
      if (drop <= 0) continue;
      const i = p * 4;
      raster.data[i] -= drop;
      raster.data[i + 1] -= drop;
      raster.data[i + 2] -= drop;
    }
  }
  return { raster, ink };
}

/** Mean of the bare paper on the line `dy` from the fold. */
function paperOnLine(
  plane: Float32Array,
  w: number,
  h: number,
  ink: Uint8Array,
  centre: number,
  tilt: number,
  dy: number,
) {
  let s = 0;
  let n = 0;
  for (let x = Math.round(w * 0.05); x < w * 0.95; x++) {
    const y = Math.round(centre + (x - w / 2) * tilt) + dy;
    if (y < 0 || y >= h || ink[y * w + x]) continue;
    s += plane[y * w + x];
    n++;
  }
  return n ? s / n : 0;
}

describe('creases', () => {
  const W = 900;
  const H = 1200;

  it('finds a fold, square or tilted, and MEASURES its tilt', () => {
    for (const tiltDeg of [0, 1.5, -2.5]) {
      const p = foldedPage(W, H, { tiltDeg });
      const bands = findCreases(flattenLuma(lumaPlane(p.raster), W, H), W, H);
      expect(bands.length).toBe(1);
      expect(bands[0].axis).toBe('row');
      expect(Math.abs(bands[0].centre - H * 0.425)).toBeLessThan(6);
      // ⚠️ MEASURED, not read off the 1° seed grid the vote was quantised to.
      expect(bands[0].slope).toBeCloseTo(Math.tan((tiltDeg * Math.PI) / 180), 2);
    }
  });

  it('finds a fold running the other way', () => {
    const p = foldedPage(W, H, { vertical: true, tiltDeg: 1 });
    const bands = findCreases(flattenLuma(lumaPlane(p.raster), W, H), W, H);
    expect(bands.length).toBe(1);
    expect(bands[0].axis).toBe('col');
    expect(Math.abs(bands[0].centre - W * 0.425)).toBeLessThan(6);
  });

  it('⚠️ PUTS THE PAPER BACK, AND LEAVES THE TEXT CROSSING IT ALONE', () => {
    const tiltDeg = 1.5;
    const tilt = Math.tan((tiltDeg * Math.PI) / 180);
    const p = foldedPage(W, H, { tiltDeg });
    const flat = flattenLuma(lumaPlane(p.raster), W, H);
    const before = Float32Array.from(flat);
    const centre = H * 0.425;

    const creased = paperOnLine(flat, W, H, p.ink, centre, tilt, 0);
    const open = paperOnLine(flat, W, H, p.ink, centre, tilt, -80);
    expect(open - creased).toBeGreaterThan(15); // the fold is really there

    const { bands } = suppressCreases(flat, W, H);
    expect(bands.length).toBe(1);
    expect(
      Math.abs(paperOnLine(flat, W, H, p.ink, centre, tilt, 0) - open),
    ).toBeLessThan(3);

    // Every stroke that crossed the fold comes back byte for byte. This is the
    // whole reason the correction stops at the ink threshold.
    let crossings = 0;
    let moved = 0;
    for (let x = 0; x < W; x++) {
      const y0 = Math.round(centre + (x - W / 2) * tilt);
      for (let dy = -30; dy <= 30; dy++) {
        const y = y0 + dy;
        if (y < 0 || y >= H) continue;
        const i = y * W + x;
        if (!p.ink[i]) continue;
        crossings++;
        if (flat[i] !== before[i]) moved++;
      }
    }
    expect(crossings).toBeGreaterThan(200);
    expect(moved).toBe(0);
  });

  it('⚠️ AN UNCREASED PAGE COMES BACK BYTE-IDENTICAL', () => {
    // Not "close enough": the plane is returned untouched, because a page with
    // no fold must not pay for this step in either pixels or memory.
    const p = printPage(W, H);
    const flat = flattenLuma(lumaPlane(p.raster), W, H);
    const before = Float32Array.from(flat);
    const { luma, bands } = suppressCreases(flat, W, H);
    expect(bands).toEqual([]);
    expect(luma).toBe(flat);
    let moved = 0;
    for (let i = 0; i < flat.length; i++) if (flat[i] !== before[i]) moved++;
    expect(moved).toBe(0);
  });

  it('does not fire on lines of text', () => {
    // A text row is the only other thing on a page that is long, thin and
    // darker than paper. It is rejected because the profile ignores ink and so
    // reports the clean paper BETWEEN the letters, and because a text row is
    // not dark for three quarters of its LENGTH — it has word gaps and margins.
    const p = printPage(W, H);
    expect(findCreases(flattenLuma(lumaPlane(p.raster), W, H), W, H)).toEqual([]);
  });

  it('does not fire on a printed rule or a table border', () => {
    // Print is high contrast, so the faint window excludes it outright — and a
    // printed hairline has no soft shadow either, which is the second reason.
    const p = printPage(W, H);
    const rule = (y: number, thick: number, v: number) => {
      for (let d = 0; d < thick; d++)
        for (let x = Math.round(W * 0.08); x < W * 0.92; x++) {
          const i = ((y + d) * W + x) * 4;
          p.raster.data[i] = v;
          p.raster.data[i + 1] = v;
          p.raster.data[i + 2] = v;
        }
    };
    rule(300, 3, 60);
    rule(700, 2, 120);
    for (let y = 300; y < 703; y++)
      for (const x of [Math.round(W * 0.08), Math.round(W * 0.92)]) {
        const i = (y * W + x) * 4;
        p.raster.data[i] = 60;
        p.raster.data[i + 1] = 60;
        p.raster.data[i + 2] = 60;
      }
    expect(findCreases(flattenLuma(lumaPlane(p.raster), W, H), W, H)).toEqual([]);
  });

  it('does not fire on a broad lighting gradient', () => {
    const p = printPage(W, H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const k = 1 - 0.35 * (x / W);
        const i = (y * W + x) * 4;
        p.raster.data[i] *= k;
        p.raster.data[i + 1] *= k;
        p.raster.data[i + 2] *= k;
      }
    expect(findCreases(flattenLuma(lumaPlane(p.raster), W, H), W, H)).toEqual([]);
  });

  it('enhance() takes the fold out, and can be told not to', () => {
    const tiltDeg = 1.2;
    const tilt = Math.tan((tiltDeg * Math.PI) / 180);
    const p = foldedPage(W, H, { tiltDeg });
    const centre = H * 0.425;
    const read = (r: Raster) => {
      const plane = lumaPlane(r);
      return {
        fold: paperOnLine(plane, W, H, p.ink, centre, tilt, 0),
        open: paperOnLine(plane, W, H, p.ink, centre, tilt, -80),
      };
    };
    const off = read(enhance(p.raster, { creases: false }));
    const on = read(enhance(p.raster));
    expect(off.open - off.fold).toBeGreaterThan(10);
    expect(Math.abs(on.open - on.fold)).toBeLessThan(4);
  });

  it('survives a page too small to have a fold', () => {
    const tiny = printPage(40, 30);
    expect(findCreases(lumaPlane(tiny.raster), 40, 30)).toEqual([]);
    expect(() => enhance(tiny.raster)).not.toThrow();
  });
});
