// ────────────────────────────────────────────────────────────────────
// Ranking lenses by field of view, from what they happen to be looking at.
//
// ⚠️ WHY NOT JUST READ THE LABEL. Because it works until it does not. The
// operator's iPhone names its lenses ("Back Ultra Wide Camera") and his
// Samsung does not ("camera 0, facing back"), so a label-matching selector is
// two different features wearing one name — and his rule is that no feature
// ships for one platform and not the other. It is also hostage to a string:
// Apple renames a lens, or ships a phone with a fourth one, and a scanner
// that silently reverts to the wrong lens is the worst kind of regression
// because nothing errors.
//
// ⚠️ WHY NOT READ focusDistance. Chrome-Android exposes it and Safari does
// not. Same problem.
//
// So we measure, using only canvas frame grabs, which both platforms have.
//
// THE SHORTCUT THAT MAKES THIS TRACTABLE: on a phone, the widest lens is the
// closest-focusing lens. Short focal length gives both a wide field and a
// near minimum focus — it is exactly why a phone's macro mode uses the
// ultrawide. So we never need focus distance, which cannot be measured
// blind. We need field of view, which can: point two lenses at the same
// scene and the wider one contains everything the narrower one sees, plus
// more, at a smaller scale.
//
// What this needs is not a target — any ordinary scene will do, a desk, a
// carpet, a hand. What it needs is STRUCTURE. Pointed at a blank wall there
// is nothing to match and the honest answer is to decline, not to guess.
// ────────────────────────────────────────────────────────────────────

/** Working size for the comparison. Small on purpose: this is shape, not detail. */
export const FOV_SAMPLE = 64;

/**
 * How well two samples have to correlate before we believe the match.
 *
 * Below this the scene had no structure to match on — a blank wall, a dark
 * drawer, a badly out-of-focus frame — and any ratio we computed would be
 * noise dressed as a measurement.
 */
export const FOV_MIN_CORRELATION = 0.35;

/** A square, grey, fixed-size sample of what one lens sees. */
export interface FovSample {
  /** FOV_SAMPLE * FOV_SAMPLE grey values, 0-255. */
  data: Uint8Array;
  size: number;
}

/**
 * Normalised cross-correlation of two equally-sized samples.
 *
 * Normalised on purpose: two lenses on the same phone meter and white-balance
 * independently, so the same scene arrives at different brightness and
 * contrast through each. Plain difference would rank them by exposure. NCC
 * subtracts each sample's own mean and divides by its own deviation, so it
 * compares STRUCTURE and ignores level and gain entirely.
 *
 * Returns -1..1. A flat sample has no structure and returns 0 rather than
 * dividing by zero.
 */
export function correlate(a: FovSample, b: FovSample): number {
  const n = Math.min(a.data.length, b.data.length);
  if (n === 0) return 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a.data[i];
    sb += b.data[i];
  }
  const ma = sa / n;
  const mb = sb / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a.data[i] - ma;
    const y = b.data[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da < 1e-6 || db < 1e-6) return 0;
  return num / Math.sqrt(da * db);
}

/**
 * Take the centre `scale` fraction of a sample and stretch it back to full size.
 *
 * This is what simulates "what would this lens see if it were narrower" — the
 * crop a longer focal length would have given of the same scene.
 *
 * Nearest-neighbour on purpose. We are matching structure at 64x64, the
 * candidate scales are coarse, and a smoother resample would cost time in a
 * loop that runs a few hundred times without changing which scale wins.
 */
export function centreCrop(s: FovSample, scale: number): FovSample {
  const size = s.size;
  const clamped = Math.min(1, Math.max(0.05, scale));
  const span = size * clamped;
  const off = (size - span) / 2;
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    const sy = Math.min(size - 1, Math.round(off + (y / size) * span));
    for (let x = 0; x < size; x++) {
      const sx = Math.min(size - 1, Math.round(off + (x / size) * span));
      out[y * size + x] = s.data[sy * size + sx];
    }
  }
  return { data: out, size };
}

export interface FovMatch {
  /**
   * How much of `wide`'s view `narrow` covers, 0..1.
   *
   * 1 means the two lenses see the same field. 0.5 means `narrow` sees half
   * of what `wide` sees — so `wide` is twice the field of view.
   */
  scale: number;
  /** Correlation at that scale. Low means the scene had nothing to match on. */
  correlation: number;
  /** Did the match clear FOV_MIN_CORRELATION? */
  trusted: boolean;
}

/**
 * Find how much of `wide`'s field the `narrow` sample covers.
 *
 * Searches candidate scales coarsely then refines around the winner — a plain
 * linear sweep at the resolution we need would cost four times as much for
 * the same answer.
 *
 * ⚠️ SYMMETRIC BY CONSTRUCTION: if `narrow` is actually the WIDER of the two,
 * no crop of `wide` will match it well and the correlation stays low, so this
 * reports untrusted rather than inventing a ratio. Callers compare both ways
 * round and believe the direction that correlates.
 */
export function matchFov(wide: FovSample, narrow: FovSample): FovMatch {
  let best = { scale: 1, correlation: -1 };
  const consider = (scale: number) => {
    const c = correlate(centreCrop(wide, scale), narrow);
    if (c > best.correlation) best = { scale, correlation: c };
  };
  for (let s = 0.25; s <= 1.0001; s += 0.05) consider(s);
  const around = best.scale;
  for (let s = around - 0.04; s <= around + 0.04; s += 0.01) {
    if (s >= 0.05 && s <= 1) consider(s);
  }
  return {
    scale: best.scale,
    correlation: best.correlation,
    trusted: best.correlation >= FOV_MIN_CORRELATION,
  };
}

/**
 * Which of two lenses is wider, from one sample each.
 *
 * Returns 'a', 'b', or null when the scene did not support a decision. Null
 * is a first-class answer, not a failure: pointed at a blank surface there is
 * genuinely nothing to measure, and a caller that gets null keeps whatever
 * the browser chose.
 */
export function widerOf(a: FovSample, b: FovSample): 'a' | 'b' | null {
  const aWider = matchFov(a, b);
  const bWider = matchFov(b, a);
  if (!aWider.trusted && !bWider.trusted) return null;

  // Whichever direction explains the other with a real crop wins. A ratio
  // near 1 in both directions means the lenses see the same field — no
  // meaningful difference, so no reason to switch.
  const aExplains = aWider.trusted ? 1 - aWider.scale : -1;
  const bExplains = bWider.trusted ? 1 - bWider.scale : -1;
  if (Math.abs(aExplains - bExplains) < 0.05) return null;
  return aExplains > bExplains ? 'a' : 'b';
}

/**
 * Order lenses widest-first from one sample each.
 *
 * ⚠️ STABLE. Comparisons that decline (null) leave the pair in their original
 * order, so a phone whose scene supports no decision at all behaves exactly
 * as it does today rather than shuffling. A scanner that picks a different
 * lens each time it opens is worse than one that always picks the same
 * mediocre lens.
 *
 * Insertion sort rather than Array.sort: our comparator is not a total order
 * (it can return "cannot tell" for one pair and a firm answer for another),
 * and Array.sort with an inconsistent comparator is undefined behaviour.
 */
export function rankByFov<T extends { sample: FovSample }>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = 1; i < out.length; i++) {
    const cur = out[i];
    let j = i - 1;
    while (j >= 0 && widerOf(cur.sample, out[j].sample) === 'a') {
      out[j + 1] = out[j];
      j--;
    }
    out[j + 1] = cur;
  }
  return out;
}
