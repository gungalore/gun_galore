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
    python tools/quad_bench.py rec.mp4              # reads the video directly
    python tools/quad_bench.py frames/              # or a directory of f_*.png

    A directory needs ffmpeg first:
        ffmpeg -i rec.mp4 -vsync 0 frames/f_%04d.png
    Reading the video directly needs opencv (pip install opencv-python) and
    picks the frame rate up from the file, so --fps is only for a directory.

    --colour track is the locked quad (#3ddc84), which is what a pan test is
    measuring; --colour seeking is the unlocked one (#f5c518).

    Check the reported "frames with overlay" count before believing anything
    else: if it is far below the total, the mask is picking up the wrong thing
    -- or the right thing in the wrong state.
"""

import argparse
import glob
import os
import sys

import numpy as np
from PIL import Image

# ⚠️ THESE ARE THE SCANNER'S ACTUAL OVERLAY COLOURS, NOT GENERIC HUE BOXES.
# document-scanner.tsx draws the tracked quad in TRACK #3ddc84 and the unlocked
# one in SEEKING #f5c518. The first draft of this table required blue < 130 for
# "green" and #3ddc84 has blue = 132 — it would have found nothing in exactly
# the locked state worth recording, and reported it as a total drop-out.
#
# "track" is the default because a lock is what the pan test is measuring.
COLOURS = {
    # TRACK #3ddc84 = (61, 220, 132)
    "track": lambda im: (im[..., 0] < 140) & (im[..., 1] > 170) & (im[..., 2] > 90) & (im[..., 2] < 190),
    # SEEKING #f5c518 = (245, 197, 24)
    "seeking": lambda im: (im[..., 0] > 180) & (im[..., 1] > 150) & (im[..., 2] < 110),
    "yellow": lambda im: (im[..., 0] > 180) & (im[..., 1] > 180) & (im[..., 2] < 110),
    "red": lambda im: (im[..., 0] > 170) & (im[..., 1] < 90) & (im[..., 2] < 90),
}


def largest_blob(mask):
    """Keep only the biggest connected run of matching pixels.

    ⚠️ WITHOUT THIS THE STATUS BAR RUINS THE MEASUREMENT, AND IT DOES IT
    QUIETLY. An iPhone screen recording carries a GREEN RECORDING DOT in the
    status bar — 26 pixels, present in every single frame, inside the same
    colour range as the tracked quad. It competes with the quad for the
    "top-most" extreme point and the winner flips frame to frame, which
    manufactured a p95 step of 139px on a clip whose overlay was in fact calm.
    The frames-with-overlay count looked healthy at 88% throughout, so nothing
    announced the problem.
    """
    n = int(mask.sum())
    if n == 0:
        return mask, 1, 1.0
    lab = None
    try:
        import cv2

        cnt, lab, stats, _ = cv2.connectedComponentsWithStats(
            mask.astype("uint8"), connectivity=8
        )
        if cnt > 1:
            big = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
            keep = lab == big
            return keep, cnt - 1, float(keep.sum()) / n
    except ImportError:
        pass
    if lab is None:
        try:
            from scipy import ndimage

            lab, cnt = ndimage.label(mask)
            if cnt > 1:
                sizes = ndimage.sum(mask, lab, range(1, cnt + 1))
                keep = lab == (1 + int(np.argmax(sizes)))
                return keep, cnt, float(keep.sum()) / n
        except ImportError:
            return mask, -1, 1.0
    return mask, 1, 1.0


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


def iter_pngs(files):
    for f in files:
        yield np.array(Image.open(f).convert("RGB")).astype(int)


def iter_video(path):
    """Read an .mp4 straight through, so no ffmpeg step is needed.

    ⚠️ THE FRAME RATE COMES FROM THE FILE, NOT FROM --fps. A screen recording
    off a phone is commonly 30fps even when the display runs at 60, and every
    drop-out figure is milliseconds computed from that number. Guessing it
    doubles or halves the answer.
    """
    try:
        import cv2
    except ImportError:
        sys.exit("reading a video needs opencv: pip install opencv-python")
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        sys.exit(f"could not open {path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    def gen():
        while True:
            ok, fr = cap.read()
            if not ok:
                break
            yield fr[:, :, ::-1].astype(int)  # BGR -> RGB
        cap.release()

    return gen(), fps, total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("frames", help="an .mp4, or a directory of f_0001.png from ffmpeg")
    ap.add_argument("--fps", type=float, default=60.0)
    ap.add_argument("--colour", default="track", choices=sorted(COLOURS))
    ap.add_argument(
        "--rest-below",
        type=float,
        default=2.0,
        help="a frame whose step is under this counts as AT REST (px)",
    )
    args = ap.parse_args()

    if os.path.isdir(args.frames):
        files = sorted(glob.glob(os.path.join(args.frames, "f_*.png")))
        if not files:
            sys.exit(f"no f_*.png in {args.frames} - did ffmpeg write there?")
        source, fps, total = iter_pngs(files), args.fps, len(files)
    else:
        source, fps, total = iter_video(args.frames)
        print(f"reading {args.frames} at {fps:.1f}fps, {total} frames")

    test = COLOURS[args.colour]
    steps, gaps, present = [], [], 0
    prev, gap = None, 0

    blob_share, comp_counts = [], []
    for im in source:
        m, ncomp, share = largest_blob(test(im))
        if ncomp > 0:
            comp_counts.append(ncomp)
            blob_share.append(share)
        pts = shape_of(m)
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
            f"overlay never found in {total} frames - wrong --colour, or the "
            "overlay is not a unique colour in this recording"
        )

    d = np.array(steps)
    # ⚠️ REST AND PAN ARE DIFFERENT REGIMES AND ONE MEDIAN HIDES BOTH. The
    # targets are "median AT REST" and "p95 DURING A PAN"; pooling them reports
    # a number that meets neither definition. Split on how much the overlay is
    # actually moving.
    rest, pan = d[d < args.rest_below], d[d >= args.rest_below]
    ms_per_frame = 1000.0 / fps

    print(f"frames                {total}   with overlay {present}")
    print(f"steps measured        {len(d)}")
    if comp_counts:
        stray = sum(1 for c in comp_counts if c > 1) / len(comp_counts)
        print(
            f"colour blobs/frame    median {int(np.median(comp_counts))}"
            f"   largest holds {np.median(blob_share) * 100:.0f}% of matched px"
        )
        if stray > 0.2:
            print("  NOTE: most frames carry more than one blob in this colour.")
            print("        Something else on screen matches it - a status-bar dot,")
            print("        a button. Only the largest blob is measured.")
    elif comp_counts == [] and present:
        print("colour blobs/frame    not checked (install opencv or scipy)")
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
