#!/usr/bin/env python3
"""Measure the live quad overlay's feel from a screen recording.

WHY THIS EXISTS
    Every previous pass at the overlay was judged by looking at it, which is
    how it survived three rounds of "still twitchy". lib/scan/smooth-bench.spec.ts
    measures the same quantities against a synthetic detection stream, which is
    what the filter is tuned against; this measures the real thing on a real
    phone, which is what confirms the tuning survived contact with a camera.

TARGETS
    Measured by the operator from a frame analysis of Scanbot's own Web SDK
    demo running in iOS Safari, 2154 frames at 60fps:

        jitter at rest    median step  < 1px
        lag during pan    p95 step     < 12px
        drop-outs         <= 500ms while the document is > 15% of frame width

    The principle behind them: the live quad is a UI AFFORDANCE, NOT A
    MEASUREMENT. Scanbot's own overlay trails the card by 10-20px during a pan
    and sits visibly inside the leading edge. Optimise for "never twitches" and
    accept being wrong by 2%; precision is capture's job.

USAGE
    ffmpeg -i rec.mp4 -vsync 0 frames/f_%04d.png
    python tools/quad_bench.py frames [--fps 60] [--colour yellow]

    The overlay must be a colour nothing else on screen shares. Check the
    reported "frames with overlay" count before believing anything else: if it
    is far below the total, the mask is picking up the wrong thing.
"""

import argparse
import glob
import os
import sys

import numpy as np
from PIL import Image

# Hue-ish boxes in plain RGB. Add one here rather than tweaking a shared range.
COLOURS = {
    "yellow": lambda im: (im[..., 0] > 180) & (im[..., 1] > 180) & (im[..., 2] < 110),
    "red": lambda im: (im[..., 0] > 170) & (im[..., 1] < 90) & (im[..., 2] < 90),
    "green": lambda im: (im[..., 0] < 110) & (im[..., 1] > 170) & (im[..., 2] < 130),
    "cyan": lambda im: (im[..., 0] < 110) & (im[..., 1] > 170) & (im[..., 2] > 170),
}


def shape_of(mask):
    """Four numbers that move when the quad moves, rotates OR changes shape.

    ⚠️ NOT THE CENTROID ALONE. A centroid only sees translation: a quad that
    rotates about its centre, or whose corners breathe in and out, registers a
    step of roughly zero — and shape wobble is exactly what a loose overlay
    does. The extreme points in each diagonal direction pick that up, and they
    are cheap and robust to the stroke's thickness.
    """
    ys, xs = np.nonzero(mask)
    if len(xs) < 50:
        return None
    s, d = xs + ys, xs - ys
    return np.array(
        [
            [xs[np.argmin(s)], ys[np.argmin(s)]],  # top-left-most
            [xs[np.argmax(d)], ys[np.argmax(d)]],  # top-right-most
            [xs[np.argmax(s)], ys[np.argmax(s)]],  # bottom-right-most
            [xs[np.argmin(d)], ys[np.argmin(d)]],  # bottom-left-most
        ],
        dtype=float,
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("frames", help="directory of f_0001.png ... extracted with ffmpeg")
    ap.add_argument("--fps", type=float, default=60.0)
    ap.add_argument("--colour", default="yellow", choices=sorted(COLOURS))
    ap.add_argument(
        "--rest-below",
        type=float,
        default=2.0,
        help="a frame whose step is under this counts as AT REST (px)",
    )
    args = ap.parse_args()

    files = sorted(glob.glob(os.path.join(args.frames, "f_*.png")))
    if not files:
        sys.exit(f"no f_*.png in {args.frames} - did ffmpeg write there?")

    test = COLOURS[args.colour]
    steps, gaps, present = [], [], 0
    prev, gap = None, 0

    for f in files:
        im = np.array(Image.open(f).convert("RGB")).astype(int)
        pts = shape_of(test(im))
        if pts is None:
            gap += 1
            prev = None
            continue
        present += 1
        if gap:
            gaps.append(gap)
            gap = 0
        if prev is not None:
            steps.append(float(np.mean(np.hypot(*(pts - prev).T))))
        prev = pts
    if gap:
        gaps.append(gap)

    if not steps:
        sys.exit(
            f"overlay never found in {len(files)} frames - wrong --colour, or the "
            "overlay is not a unique colour in this recording"
        )

    d = np.array(steps)
    # ⚠️ REST AND PAN ARE DIFFERENT REGIMES AND ONE MEDIAN HIDES BOTH. The
    # targets are "median AT REST" and "p95 DURING A PAN"; pooling them reports
    # a number that meets neither definition. Split on how much the overlay is
    # actually moving.
    rest, pan = d[d < args.rest_below], d[d >= args.rest_below]
    ms_per_frame = 1000.0 / args.fps

    print(f"frames                {len(files)}   with overlay {present}")
    print(f"steps measured        {len(d)}")
    print()
    if len(rest):
        print(
            f"AT REST   n={len(rest):5d}  median {np.median(rest):6.2f}px"
            f"   {'PASS' if np.median(rest) < 1 else 'FAIL'}  (target < 1px)"
        )
    else:
        print("AT REST   none - the whole clip was moving")
    if len(pan):
        print(
            f"MOVING    n={len(pan):5d}  p95    {np.percentile(pan, 95):6.2f}px"
            f"   {'PASS' if np.percentile(pan, 95) < 12 else 'FAIL'}  (target < 12px)"
        )
    else:
        print("MOVING    none - the whole clip was at rest")
    print()
    if gaps:
        worst = max(gaps) * ms_per_frame
        print(f"drop-outs             {len(gaps)}  longest {worst:.0f}ms"
              f"   {'PASS' if worst <= 500 else 'FAIL'}  (target <= 500ms)")
        print(f"  all (ms)            {[round(g * ms_per_frame) for g in gaps]}")
    else:
        print("drop-outs             none")
    print()
    # Plain ASCII on purpose: this runs on a Windows console, where printing
    # a non-cp1252 character raises UnicodeEncodeError and takes the whole
    # report down after the numbers were already computed.
    print("NOTE: a low median alone is not a calm overlay - a filter that")
    print("      ignores its input passes every jitter target. Check that")
    print("      MOVING actually moved.")


if __name__ == "__main__":
    main()
