'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ScanResult,
  frameToGray,
  grabVisible,
  makeScratch,
  processCapture,
  verdicts,
  visibleRect,
} from '@/lib/scan/capture';
import { detectQuad } from '@/lib/scan/detect';
import { Pt, Quad, quadDrift, smoothQuad } from '@/lib/scan/geometry';
import CornerEditor from './corner-editor';
import {
  DocShape,
  SHAPES,
  SHAPE_ORDER,
  expectAspect as expectAspectFor,
  holdHint,
} from '@/lib/scan/shapes';
import AimFrame from './aim-frame';
import { aimAgreement, aimBox } from '@/lib/scan/aim';
import {
  exposureAllowsAutoCapture,
  exposureProblem,
} from '@/lib/scan/exposure';

// ────────────────────────────────────────────────────────────────────
// THE SCANNER.
//
// A live camera view with the document's corners drawn on it, a shutter, and a
// review step where the corners can be dragged before the photo is used.
//
// ⚠️ THE VIDEO IS NEVER DRAWN TO A CANVAS. A real <video> element is painted
// by the compositor at whatever the hardware manages, for free. A transparent
// canvas sits on top and draws ONLY the markers. That one decision is why
// detection can never stutter the preview: the worst case is the markers
// lagging the paper by a frame, which reads as settling — which is what a good
// scanner looks like.
//
// ⚠️ DETECTION RUNS AT 10fps; THE MARKERS ARE DRAWN AT 60. The drawing
// interpolates towards the latest smoothed quad, so ten detections a second
// look identical to sixty at a sixth of the cost. On a phone that cannot keep
// up, the rate drops and then live detection switches off entirely — the
// capture-time detection still runs, so the feature degrades to "we straighten
// it afterwards" rather than to a frozen screen.
//
// ⚠️ Z-INDEX 130. Above the date picker at 121, above the admin modal shell at
// 100, above the tab bar at 55. This is full-screen and nothing may sit over
// it.
// ────────────────────────────────────────────────────────────────────

const Z = 130;

/** Detection interval, in ms, at each health level. */
const RATES = [100, 200] as const;

export interface DocumentScannerProps {
  /**
   * What the member is most likely holding. Sets the starting guide frame and
   * the detector's aspect hint — and only those. It is a suggestion the
   * member can change on screen, never a filter: a competency certificate
   * comes both as an A4 sheet and as a card, and refusing the one we did not
   * expect would be refusing a real document.
   */
  shape?: DocShape;
  /**
   * Start with "more than one" already ticked.
   *
   * For the bulk-upload surfaces — the Motivation Centre's upload-all in
   * particular — where somebody arrives holding a whole pack and the single
   * -document flow is the unusual case, not the default.
   */
  multiDefault?: boolean;
  title: string;
  onDone: (files: File[]) => void | Promise<void>;
  onClose: () => void;
}

/**
 * Why automatic capture has not fired yet.
 *
 * 'steady' is not a fault — it means everything else is satisfied and the
 * only thing left is for the phone to stop moving, which is what the ring
 * around the shutter is filling up to show.
 */
type Blocker = 'off' | 'searching' | 'aim' | 'light' | 'steady';

type Phase =
  /**
   * ⚠️ THE CAMERA DOES NOT OPEN UNTIL THE MEMBER HAS SAID WHAT THEY ARE
   * HOLDING. Choosing afterwards meant choosing while a live camera was
   * already asking to be pointed at something, and the aim box could not be
   * drawn at the right shape until they had. It also means the permission
   * prompt arrives after they have committed to scanning something, which is
   * the moment they are most likely to grant it.
   */
  | 'choose'
  | 'starting'
  | 'live'
  | 'working'
  | 'review'
  | 'denied'
  | 'nocamera';

export default function DocumentScanner({
  shape: initialShape = 'any',
  multiDefault = false,
  title,
  onDone,
  onClose,
}: DocumentScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [phase, setPhase] = useState<Phase>('choose');
  const [shape, setShape] = useState<DocShape>(initialShape);
  /**
   * Is the member scanning more than one page or side?
   *
   * Declared up front rather than discovered at the end. A licence card has a
   * back, a competency certificate runs to two pages, and an ID book has the
   * address page — and somebody who has said so gets taken straight back to
   * the camera after each shot instead of having to find "Add another" every
   * time. Somebody who has not said so is never asked about pages they do not
   * have.
   */
  const [multi, setMulti] = useState(multiDefault);
  const [err, setErr] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [shot, setShot] = useState<ScanResult | null>(null);
  const [pages, setPages] = useState<File[]>([]);
  const [editing, setEditing] = useState(false);
  const [said, setSaid] = useState('');
  /**
   * Auto-capture: shoot by itself once the corners are locked AND the phone
   * has stopped moving. On by default, because the operator asked for it and
   * because the moment somebody stops moving IS the sharpest frame they are
   * going to give us — a finger reaching for a shutter is what blurs it.
   *
   * ⚠️ IT MUST BE POSSIBLE TO TURN OFF. Auto-capture fires while a member is
   * still positioning, and on a document whose edges it is reading wrongly it
   * will keep firing. The switch stays on screen, and one manual capture
   * turns it off for the session.
   */
  const [auto, setAuto] = useState(true);
  const [holdPct, setHoldPct] = useState(0);
  /**
   * Blown-out fraction of the live frame.
   *
   * ⚠️ THE ONE THING NO ALGORITHM FIXES. A specular highlight on a laminated
   * licence card is saturated — there is no detail under it to recover, and
   * the edges inside it are gone too, which is exactly why detection stops
   * finding the card under a torch. What we CAN do is see it and say so,
   * because tilting the phone fixes it completely and instantly.
   */
  const [glare, setGlare] = useState(0);
  /**
   * Mean brightness of the live frame, 0-255.
   *
   * Too dark and the sensor is guessing at the edges; too bright and it has
   * clipped them away. Both are fixed by moving, and neither is fixed by any
   * amount of processing afterwards — which is why they are worth interrupting
   * for, and why the interruption STAYS UP until the number comes back.
   */
  const [luma, setLuma] = useState(128);

  // The live quad, and whether it has been steady long enough to trust.
  const quadRef = useRef<Quad | null>(null);
  const lockRef = useRef(0);
  const rawBlobRef = useRef<Blob | null>(null);
  const closedRef = useRef(false);
  // Read by the detect loop, which must not re-subscribe when these change —
  // tearing the loop down mid-hold would reset the stillness timer forever.
  const autoRef = useRef(true);
  const holdRef = useRef(0);
  const capturingRef = useRef(false);
  /** Does the latest detection look like a document, not just like a shape? */
  const confidentRef = useRef(false);
  const glareRef = useRef(0);
  const glareShownRef = useRef(0);
  const lumaRef = useRef(128);
  const lumaShownRef = useRef(128);
  /**
   * Does what the detector found sit where the member was asked to put it?
   *
   * Turns the aim box green, and gates auto-capture. ⚠️ IT IS ALSO WHAT
   * STOPS THE SCANNER SHOOTING THE DESK. On the operator's own IMG_4947 the
   * detector picked out the fabric and the ruler — a bigger, cleaner
   * rectangle than the licence card lying in the corner of the frame — and
   * scored it 0.68, comfortably above the acceptance floor. Nothing in the
   * image says which rectangle is the document. The member does, by putting
   * it in the box.
   */
  const aimedRef = useRef(false);
  const aimShownRef = useRef(false);
  /** Consecutive frames the quad has been outside the box. */
  const aimMissRef = useRef(3);
  const [aimed, setAimed] = useState(false);
  /** Which auto-capture condition is currently unmet. */
  const blockerShownRef = useRef<Blocker>('searching');
  const [blocker, setBlocker] = useState<Blocker>('searching');
  const captureRef = useRef<(() => Promise<void>) | null>(null);

  autoRef.current = auto;
  holdRef.current = holdPct;

  const say = useCallback((m: string) => {
    setSaid('');
    window.setTimeout(() => setSaid(m), 30);
  }, []);

  // ── the camera ────────────────────────────────────────────────────
  //
  // ⚠️ GATED ON `started`, NOT ON `phase`. Keying the effect on the phase
  // would tear the stream down and rebuild it on every trip through review,
  // and rebuilding a stream costs a second of black screen and a fresh
  // autofocus hunt. This runs once, when the member leaves the chooser.
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!started) return;
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPhase('nocamera');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            // ⚠️ ASK FOR EVERYTHING THE PHONE WILL GIVE. A browser cannot
            // reach the stills sensor — getUserMedia hands out video frames —
            // so the only lever on legibility is the track resolution, and
            // modern iPhones and Androids will serve 4K here if asked. `ideal`
            // rather than `min`: a phone that cannot manage it must still get
            // a working scanner rather than a rejected constraint.
            width: { ideal: 3840 },
            height: { ideal: 2160 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        // Torch is Chrome-on-Android only. Never render a dead button.
        const caps = track.getCapabilities?.() as
          | (MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] })
          | undefined;
        setHasTorch(caps?.torch === true);

        // ⚠️ ASK FOR CONTINUOUS FOCUS. A video track often defaults to a fixed
        // or slow focus, and a licence card held 150mm away sits near the
        // lens's near limit — which is where a soft frame comes from. This is
        // an advanced constraint and most devices quietly ignore it, so it is
        // attempted and its failure is not an error. It costs nothing on the
        // phones that do honour it, and those are the ones that were soft.
        if (caps?.focusMode?.includes('continuous')) {
          await track
            .applyConstraints({
              advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
            })
            .catch(() => undefined);
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setPhase('live');
        say('Camera ready. Line the document up inside the red corners.');
      } catch (e) {
        const name = (e as DOMException)?.name;
        setPhase(name === 'NotAllowedError' ? 'denied' : 'nocamera');
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [say, started]);

  // ⚠️ iOS SAFARI TEARS THE STREAM DOWN when the tab goes to the background,
  // and hands back a black viewfinder with a working shutter that captures
  // nothing. The existing KYC camera in this repo has that bug; this does not.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      const track = streamRef.current?.getVideoTracks()[0];
      if (track && track.readyState === 'ended') {
        setErr('The camera stopped when you left. Close and open it again.');
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // ── detect, smooth, draw ──────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'live') return;
    let raf = 0;
    let timer = 0;
    let scratch: CanvasRenderingContext2D | null = null;
    let rate = 0;
    let rolling = 0;
    let alive = true;

    // How long the quad must sit still before the shutter fires, and how far
    // a corner may drift while it does. 700ms is long enough not to fire while
    // somebody is still framing, short enough not to feel broken.
    // ⚠️ 1100ms, NOT 700. The operator's verdict on the first version was
    // "super sensitive", and they were right: at 700ms it fired while the
    // phone was still being positioned. A shutter that goes off early costs a
    // retake AND the member's trust in it; one that waits a beat too long
    // costs a beat.
    const HOLD_MS = 1100;
    /**
     * Mean frame-to-frame luma change below which the phone counts as still,
     * on a 0-255 scale. A hand at rest measures 1-3; deliberate movement is
     * 8 and up; the gap between them is wide.
     */
    const MOTION_STILL = 4;
    let steadySince = 0;
    /** Every 8th luma of the previous frame, for the motion measure. */
    let prevSample: Uint8Array | null = null;
    let motion = 255;

    const detectOnce = () => {
      if (!alive) return;
      const video = videoRef.current;
      if (!video || !video.videoWidth) {
        timer = window.setTimeout(detectOnce, RATES[rate]);
        return;
      }
      if (!scratch) {
        // Sized to what is VISIBLE, not to the track — otherwise the detector
        // works in one aspect and the markers are drawn in another.
        const vis = visibleRect(video);
        if (!vis) {
          timer = window.setTimeout(detectOnce, RATES[rate]);
          return;
        }
        scratch = makeScratch(vis.sw, vis.sh);
      }
      const t0 = performance.now();
      try {
        const gray = frameToGray(video, scratch);
        if (gray) {
          let blown = 0;
          let sum = 0;
          // ── motion, measured on the IMAGE ─────────────────────────
          //
          // ⚠️ NOT ON THE DETECTED QUAD, and this is the fix for "only the
          // A4 ever auto-captures". Stillness used to be quad drift between
          // consecutive detections — so on a textured carpet, where the
          // detector flip-flops between candidates, the drift spiked every
          // few frames and the 1.1-second clock restarted forever. The
          // member was perfectly still; the DETECTOR was fidgeting; and the
          // member is the one the clock is supposed to be about. Comparing
          // the sampled pixels of consecutive frames measures the hand and
          // only the hand.
          const n8 = Math.ceil(gray.data.length / 8);
          if (!prevSample || prevSample.length !== n8) {
            prevSample = new Uint8Array(n8);
            motion = 255; // first frame: unknown, treat as moving
          } else {
            let diff = 0;
            for (let i = 0, j = 0; i < gray.data.length; i += 8, j++) {
              diff += Math.abs(gray.data[i] - prevSample[j]);
            }
            motion = diff / n8;
          }
          for (let i = 0, j = 0; i < gray.data.length; i += 8, j++) {
            prevSample[j] = gray.data[i];
          }
          // Every eighth pixel is plenty for a percentage, and keeps this off
          // the detection budget.
          for (let i = 0; i < gray.data.length; i += 8) {
            if (gray.data[i] > 250) blown++;
            sum += gray.data[i];
          }
          const n = gray.data.length / 8;
          const mean = sum / n;
          lumaRef.current = mean;
          // A couple of levels of drift is not news. Re-rendering on every
          // frame would be.
          if (Math.abs(mean - lumaShownRef.current) > 3) {
            lumaShownRef.current = mean;
            setLuma(mean);
          }
          const frac = blown / n;
          glareRef.current = frac;
          if (Math.abs(frac - glareShownRef.current) > 0.01) {
            glareShownRef.current = frac;
            setGlare(frac);
          }
        }
        const found = gray
          ? detectQuad(gray, { expectAspect: expectAspectFor(shape) })
          : null;
        if (found) {
          // Into visible-frame pixels. The overlay and the shutter share that
          // coordinate space now, so a marker cannot disagree with the crop.
          const vis = visibleRect(video);
          const k = (vis ? vis.sw : video.videoWidth) / scratch.canvas.width;
          const scaled = found.quad.map((p) => ({
            x: p.x * k,
            y: p.y * k,
          })) as Quad;
          // ⚠️ CONSISTENCY BEFORE CONFIDENCE. The first version counted ANY
          // detection towards the lock — so when successive frames found two
          // DIFFERENT rectangles (the card, then the table edge, then the
          // card again), the lock still climbed and the EMA dragged the
          // markers back and forth between them. That was the jitter the
          // operator saw. Now only a detection that AGREES with the current
          // quad — within 8% of the frame — counts; a different rectangle
          // starts over, snapped rather than glided to, because gliding
          // across the frame between two candidates IS the jitter.
          const prev = quadRef.current;
          if (prev && quadDrift(prev, scaled) <= video.videoWidth * 0.08) {
            quadRef.current = smoothQuad(prev, scaled, 0.35);
            lockRef.current = Math.min(3, lockRef.current + 1);
          } else {
            quadRef.current = scaled;
            lockRef.current = 1;
          }
          confidentRef.current = found.confident;

          // ── does it sit in the box we asked for? ──────────────────
          //
          // The aim box is in CSS pixels over the video element; the quad is
          // in visible-frame pixels. One scale relates them, because
          // visibleRect already stripped the object-fit: cover crop.
          const el = video.getBoundingClientRect();
          const vw = vis ? vis.sw : video.videoWidth;
          const vh = vis ? vis.sh : video.videoHeight;
          const box = aimBox(shape, { width: el.width, height: el.height });
          const xs = scaled.map((pt) => (pt.x / vw) * el.width);
          const ys = scaled.map((pt) => (pt.y / vh) * el.height);
          const bounds = {
            x: Math.min(...xs),
            y: Math.min(...ys),
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys),
          };
          // ⚠️ A LOOSE THRESHOLD ON PURPOSE. This is here to reject the desk,
          // not to make anybody line a card up to the millimetre. Half the
          // union is a document roughly where it was asked to be; the fabric
          // -and-ruler rectangle that beat the card in IMG_4947 scores about
          // a tenth of that, and a card sitting off in one corner of the
          // frame scores nothing at all.
          const ok = aimAgreement(bounds, box) >= 0.35;

          // ⚠️ HYSTERESIS, FOR THE SAME REASON THE LOCK HAS IT. In the
          // operator's card recording the corners flipped red-green-red about
          // once a second while the card sat perfectly still on the desk —
          // the quad wobbles by a few pixels frame to frame and the
          // threshold happened to run through the middle of that wobble.
          //
          // That is not just ugly. Auto-capture needs the phone held steady
          // for 1.1 seconds, and every flicker restarted the count, so the
          // hold could never complete. One bad frame must not undo a second
          // of good ones: it takes three consecutive misses to give up, and
          // a single hit to come back.
          if (ok) {
            aimMissRef.current = 0;
          } else {
            aimMissRef.current += 1;
          }
          const held = ok || aimMissRef.current < 3;
          aimedRef.current = held;
          if (held !== aimShownRef.current) {
            aimShownRef.current = held;
            setAimed(held);
          }
        } else {
          // ⚠️ NEVER BLINK OFF. A single frame where a hand shadowed an edge
          // must not flash the markers away — it reads as a fault. Decay
          // instead, and only give up after several misses.
          lockRef.current = Math.max(0, lockRef.current - 1);
          if (lockRef.current === 0) {
            quadRef.current = null;
            confidentRef.current = false;
            aimedRef.current = false;
            aimMissRef.current = 3;
            if (aimShownRef.current) {
              aimShownRef.current = false;
              setAimed(false);
            }
          }
        }
      } catch {
        quadRef.current = null;
      }
      // ── the stillness gate ──────────────────────────────────────────
      //
      // Locked corners are not enough: the detector locks while the phone is
      // still drifting, and a capture taken mid-drift is the blurry one the
      // member then has to retake. So the quad must ALSO have stopped moving
      // — measured on the quad itself rather than on the accelerometer,
      // because it is the image that has to be sharp, and a phone panning
      // slowly across a desk registers as still to a motion sensor.
      const now = performance.now();
      const q = quadRef.current;

      // ⚠️ SAY WHICH GATE IS SHUT. Auto-capture is four conditions and a
      // timer, and when it does not fire the member sees a camera doing
      // nothing — which is indistinguishable from a camera that is broken.
      // Two rounds of "auto capture still not working" were spent guessing at
      // this from the outside; the scanner knows the answer every frame and
      // was simply not saying it.
      const why: Blocker = !autoRef.current
        ? 'off'
        : !q
          ? 'searching'
          : !aimedRef.current
            ? 'aim'
            : !exposureAllowsAutoCapture(glareRef.current, lumaRef.current)
              ? 'light'
              : 'steady';
      if (why !== blockerShownRef.current) {
        blockerShownRef.current = why;
        setBlocker(why);
      }

      // ⚠️ THREE GATES, EACH ABOUT THE MEMBER, NONE ABOUT THE DETECTOR.
      //
      // Something is in the box (aimed — hysteresis absorbs the detector's
      // fidgeting), the light is workable, and the HAND is still. The lock
      // count and quad drift are gone from this decision: both measured the
      // detector's stability, and on a patterned carpet the detector
      // flip-flops between candidates indefinitely while the member stands
      // rock still doing everything right. Only the A4 page — big enough to
      // drown the carpet out — could ever pass, which is exactly the split
      // the operator reported. The lock still decides when markers draw;
      // it has no say over the shutter any more.
      if (
        autoRef.current &&
        aimedRef.current &&
        // ⚠️ THE SAME CALL THE ALERT MAKES. Two copies of these thresholds
        // would eventually disagree, and a scanner that shows a warning and
        // then fires anyway — or shows nothing and refuses to fire — reads as
        // broken in a way nobody can describe well enough to report.
        exposureAllowsAutoCapture(glareRef.current, lumaRef.current)
      ) {
        if (motion <= MOTION_STILL) {
          if (!steadySince) steadySince = now;
        } else {
          steadySince = 0;
        }
        const held = steadySince ? now - steadySince : 0;
        setHoldPct(Math.min(1, held / HOLD_MS));
        if (held >= HOLD_MS && !capturingRef.current) {
          capturingRef.current = true;
          alive = false;
          setHoldPct(0);
          void captureRef.current?.();
          return;
        }
      } else {
        steadySince = 0;
        if (holdRef.current !== 0) setHoldPct(0);
      }

      const ms = now - t0;
      rolling = rolling * 0.8 + ms * 0.2;
      // A phone that cannot keep up slows down, then stops trying. The
      // capture-time detection still runs either way.
      if (rolling > 45 && rate < RATES.length - 1) rate++;
      if (rolling > 90) {
        alive = false;
        quadRef.current = null;
        return;
      }
      timer = window.setTimeout(detectOnce, RATES[rate]);
    };

    const draw = () => {
      const cv = overlayRef.current;
      const video = videoRef.current;
      if (cv && video && video.videoWidth) {
        const rect = video.getBoundingClientRect();
        if (cv.width !== Math.round(rect.width) || cv.height !== Math.round(rect.height)) {
          cv.width = Math.round(rect.width);
          cv.height = Math.round(rect.height);
        }
        const g = cv.getContext('2d');
        if (g) {
          g.clearRect(0, 0, cv.width, cv.height);
          const q = quadRef.current;
          // Drawn only once TWO consecutive detections have agreed. A single
          // unconfirmed candidate stays invisible — honest "still looking"
          // beats markers that flicker somewhere wrong for one frame.
          if (q && lockRef.current >= 2) {
            // The quad is already in VISIBLE-frame pixels, and the canvas
            // covers exactly that region — so this is one uniform scale, not
            // a cover transform. That is the whole point of visibleRect.
            const vis = visibleRect(video);
            const k = vis ? cv.width / vis.sw : 1;
            drawCorners(
              g,
              q.map((p) => ({ x: p.x * k, y: p.y * k })) as Quad,
              lockRef.current >= 3,
            );
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };

    detectOnce();
    raf = requestAnimationFrame(draw);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [phase, shape]);

  // ── the shutter ───────────────────────────────────────────────────
  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    capturingRef.current = true;
    setHoldPct(0);
    setPhase('working');
    say('Photo taken. Straightening it up.');
    try {
      const grabbed = await grabVisible(video);
      if (!grabbed) throw new Error('We could not take that photo.');
      const blob = grabbed.blob;
      rawBlobRef.current = blob;

      // ⚠️ THE AIM BOX GOES WITH THE PHOTOGRAPH. The corners the member lined
      // the document up against are the single most reliable thing we know
      // about where it is, and until now the still was re-detected in
      // isolation with no idea any of that had happened. That is how a
      // perfectly-aligned licence card came back as a tall strip of blue
      // blanket: the detector found a rectangle in the carpet and nothing
      // asked whether it was anywhere near the box.
      //
      // Mapped from CSS pixels into the captured image's own pixels — the
      // capture is the VISIBLE region at full resolution, which is the same
      // region the box was drawn over, so it is one uniform scale.
      // ⚠️ AS FRACTIONS, NOT PIXELS. The capture is the visible region, and
      // the aim box was drawn over exactly that region, so the two share a
      // coordinate space up to one scale factor — and expressing the box as a
      // fraction of the element means nothing downstream has to know what
      // that factor is. It used to be sent in captured pixels, and
      // processCapture's own decode shrinks anything over 3000px, so on a 4K
      // phone the crop came out over-scaled and low: the card lost its top
      // edge and gained a hand's width of carpet.
      const el = video.getBoundingClientRect();
      const box = aimBox(shape, { width: el.width, height: el.height });
      const res = await processCapture(blob, {
        expectAspect: expectAspectFor(shape),
        aimBox:
          el.width > 0 && el.height > 0
            ? {
                x: box.x / el.width,
                y: box.y / el.height,
                width: box.width / el.width,
                height: box.height / el.height,
              }
            : undefined,
      });
      setShot(res);
      setPhase('review');
      say(
        res.source === 'detected'
          ? 'Ready to check. We found the edges.'
          : res.source === 'aim'
            ? 'Ready to check. We used the corners you lined it up with.'
            : 'Ready to check. We could not find the edges, so we used the frame.',
      );
    } catch (e) {
      setErr((e as Error).message || 'That did not work. Try again.');
      setPhase('live');
    } finally {
      capturingRef.current = false;
    }
  }, [say, shape]);

  captureRef.current = capture;

  /** Re-run with corners the member dragged. Detection is deliberately skipped. */
  const reprocess = useCallback(
    async (quad: Quad) => {
      const blob = rawBlobRef.current;
      if (!blob) return;
      setPhase('working');
      try {
        setShot(await processCapture(blob, { manualQuad: quad }));
      } catch (e) {
        setErr((e as Error).message);
      }
      setPhase('review');
      setEditing(false);
      say('Corners updated.');
    },
    [say],
  );

  /**
   * Back to the chooser.
   *
   * ⚠️ IT DOES NOT THROW AWAY WHAT IS ALREADY SCANNED. Somebody who has
   * photographed the front of a licence card and wants to change to "A4 page"
   * for the certificate behind it is not asking to lose the front. The camera
   * does stop — a live stream behind a chooser is a hot lens and a flat
   * battery for no reason.
   */
  const backToChooser = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStarted(false);
    setShot(null);
    setEditing(false);
    setErr(null);
    setPhase('choose');
  }, []);

  /**
   * Hand the pages over and close.
   *
   * ⚠️ CLOSE FIRST, UPLOAD AFTER. This used to await onDone() before closing —
   * and onDone writes an encrypted file and makes two vision calls, which on a
   * phone is five to twenty seconds. The scanner sat there with its buttons
   * still showing and nothing moving, so "Use it" looked broken. It was not
   * broken; it was silent, which is worse.
   *
   * The scanner's job ends the moment the file exists. Both surfaces that
   * embed it already show upload progress of their own, so closing
   * immediately puts the member in front of that progress instead of in front
   * of a frozen camera.
   */
  const finish = useCallback(
    (extra: File[]) => {
      if (closedRef.current) return;
      closedRef.current = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      onClose();
      // Deliberately not awaited: the parent owns this now, including its
      // errors, which it is far better placed to show than a closing modal.
      void onDone(extra);
    },
    [onDone, onClose],
  );

  // Escape closes, in the capture phase so a modal underneath survives.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const body = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-blocking-overlay="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: Z,
        background: '#000',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Header
        title={title}
        onClose={onClose}
        // ⚠️ ALWAYS A WAY BACK. Every phase except the chooser itself can
        // return to it, including the two dead ends — a member who lands on
        // "no camera" with two pages already scanned must not be stuck
        // choosing between abandoning them and closing the whole thing.
        onBack={phase === 'choose' ? undefined : backToChooser}
        pages={pages.length}
      />

      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        {phase === 'choose' && (
          <Chooser
            shape={shape}
            onShape={setShape}
            multi={multi}
            onMulti={setMulti}
            pages={pages.length}
            onStart={() => {
              setPhase('starting');
              setStarted(true);
            }}
            onCancel={onClose}
            onUsePages={pages.length ? () => finish(pages) : undefined}
          />
        )}

        {(phase === 'starting' || phase === 'live' || phase === 'working') && (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                background: '#000',
              }}
            />
            <canvas
              ref={overlayRef}
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
              }}
            />
            <AimFrame shape={shape} locked={aimed} />
            <ExposureAlert glare={glare} luma={luma} torchOn={torchOn} />
        {phase === 'live' && (
          <p
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 12,
              margin: 0,
              textAlign: 'center',
              fontSize: 13,
              color: '#fff',
              textShadow: '0 1px 3px rgba(0,0,0,0.8)',
              pointerEvents: 'none',
            }}
          >
            {/* ⚠️ THE HINT FOLLOWS THE CORNERS. Telling somebody to "fill
                the frame" while a box on screen says otherwise is two
                instructions that disagree, and they will follow the picture.
                Once the corners go green the only thing left to say is hold
                still — anything else invites them to keep adjusting. */}
            {!auto
              ? aimed
                ? 'Got it — take the photo.'
                : `Put the ${SHAPES[shape].label.toLowerCase()} inside the red corners.`
              : blocker === 'searching'
                ? 'Looking for the edges…'
                : blocker === 'aim'
                  ? `Put the ${SHAPES[shape].label.toLowerCase()} inside the red corners.`
                  : blocker === 'light'
                    ? 'Fix the lighting above and it will take itself.'
                    : 'Got it — hold still.'}
          </p>
        )}
          </>
        )}

        {phase === 'working' && (
          <div style={overlayCentre}>
            <p style={{ fontSize: 15 }}>Straightening it up…</p>
          </div>
        )}

        {(phase === 'denied' || phase === 'nocamera') && (
          <div style={{ ...overlayCentre, padding: 24, textAlign: 'center' }}>
            <p style={{ fontSize: 16, fontWeight: 600 }}>
              {phase === 'denied'
                ? 'The camera is blocked'
                : 'No camera we can use'}
            </p>
            <p style={{ marginTop: 8, fontSize: 14, opacity: 0.85 }}>
              {phase === 'denied'
                ? 'Your browser is holding the camera back for this site. You can allow it in the address bar, or close this and choose a file instead — either works.'
                : 'Close this and choose a file instead. Everything after that is the same.'}
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" style={secondaryBtn} onClick={backToChooser}>
                Back
              </button>
              <button type="button" style={secondaryBtn} onClick={onClose}>
                Choose a file instead
              </button>
              {/* ⚠️ A DEAD END MUST NOT EAT WHAT IS ALREADY SCANNED. The
                  camera can fail on page three — permission revoked from the
                  notification shade, another app grabbing the lens — and the
                  two good pages behind it are still worth keeping. */}
              {pages.length > 0 && (
                <button
                  type="button"
                  style={{ ...secondaryBtn, background: 'var(--red)', border: 'none' }}
                  onClick={() => finish(pages)}
                >
                  Use the {pages.length} I have
                </button>
              )}
            </div>
          </div>
        )}

        {phase === 'review' && shot && (
          <Review
            shot={shot}
            editing={editing}
            onEdit={() => setEditing(true)}
            onCancelEdit={() => setEditing(false)}
            onQuad={reprocess}
            onRetake={() => {
              setShot(null);
              setEditing(false);
              setPhase('live');
              say('Ready for another go.');
            }}
            onUse={() => finish([...pages, shot.file])}
            multi={multi}
            onNextDocument={() => {
              setPages((p) => [...p, shot.file]);
              backToChooser();
              say('Saved. What is the next one?');
            }}
            onAddAnother={() => {
              setPages((p) => [...p, shot.file]);
              setShot(null);
              setEditing(false);
              setPhase('live');
              say('Saved. Ready for the next page.');
            }}
          />
        )}
      </div>

      {phase === 'live' && (
        <Controls
          hasTorch={hasTorch}
          torchOn={torchOn}
          onTorch={async () => {
            const track = streamRef.current?.getVideoTracks()[0];
            if (!track) return;
            const next = !torchOn;
            try {
              await track.applyConstraints({
                advanced: [{ torch: next } as MediaTrackConstraintSet],
              });
              setTorchOn(next);
            } catch {
              setHasTorch(false);
            }
          }}
          onShutter={() => {
            // ⚠️ TAKE THE PHOTO. THAT IS ALL.
            //
            // This used to also turn automatic capture OFF, on the theory
            // that reaching for the shutter meant the automatic one was not
            // helping. Two screen recordings killed that theory: on an A4
            // certificate the corners sat locked and green for eleven
            // seconds straight — detection was perfect — and the scanner
            // never fired, because one manual press early in the session had
            // silently switched auto off and nothing switched it back.
            //
            // It is a doom loop. Auto feels slow, so you press the shutter,
            // which disables auto, so every document after it needs a press,
            // which confirms that auto never works. The operator's report was
            // "every time I have to manual capture", and he was right.
            //
            // The toggle beside the shutter is how somebody turns it off.
            // That one is deliberate, visible and reversible; this one was
            // none of the three.
            void capture();
          }}
          auto={auto}
          onAuto={() => setAuto((a2) => !a2)}
          holdPct={holdPct}
          onDone={pages.length ? () => finish(pages) : undefined}
          pages={pages.length}
        />
      )}

      {err && (
        <p
          style={{
            padding: '10px 16px',
            background: 'rgba(200,16,46,0.9)',
            fontSize: 14,
          }}
        >
          {err}
        </p>
      )}

      <span
        role="status"
        aria-live="polite"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clipPath: 'inset(50%)',
        }}
      >
        {said}
      </span>
    </div>
  );

  return createPortal(body, document.body);
}

// ── the markers ─────────────────────────────────────────────────────

/**
 * The blue corners.
 *
 * Corner brackets rather than a full outline, deliberately: an outline over a
 * live camera hides the edge of the document just as the member is trying to
 * line it up. Brackets say "we have these four points" and leave the paper
 * visible. Thin and translucent while we are still settling, solid once three
 * consecutive detections have agreed.
 */
const MARK = '#4DA3FF';

function drawCorners(g: CanvasRenderingContext2D, q: Quad, locked: boolean) {
  g.strokeStyle = MARK;
  g.lineWidth = locked ? 3 : 2;
  g.globalAlpha = locked ? 1 : 0.6;
  g.lineCap = 'round';
  g.lineJoin = 'round';

  const arm = Math.max(
    14,
    Math.min(38, Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y) * 0.18),
  );

  for (let i = 0; i < 4; i++) {
    const c = q[i];
    const prev = q[(i + 3) % 4];
    const next = q[(i + 1) % 4];
    const towards = (p: Pt) => {
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const len = Math.hypot(dx, dy) || 1;
      const d = Math.min(arm, len * 0.45);
      return { x: c.x + (dx / len) * d, y: c.y + (dy / len) * d };
    };
    const a = towards(prev);
    const b = towards(next);
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(c.x, c.y);
    g.lineTo(b.x, b.y);
    g.stroke();
  }

  // A faint join between the brackets once locked, so it reads as one shape.
  if (locked) {
    g.globalAlpha = 0.22;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(q[0].x, q[0].y);
    for (let i = 1; i < 4; i++) g.lineTo(q[i].x, q[i].y);
    g.closePath();
    g.stroke();
  }
  g.globalAlpha = 1;
}

// ── chrome ──────────────────────────────────────────────────────────

const overlayCentre: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  background: 'rgba(0,0,0,0.55)',
};

const secondaryBtn: React.CSSProperties = {
  marginTop: 16,
  minHeight: 44,
  padding: '0 18px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.35)',
  background: 'transparent',
  color: '#fff',
  fontSize: 15,
};

/**
 * WHAT ARE YOU PHOTOGRAPHING?
 *
 * The first screen, before the camera opens. It buys three things:
 *
 *   1. An aim box of the right shape and size, which is what the detector
 *      uses to tell the document from the desk it is lying on.
 *   2. The multi-page answer, asked once instead of after every shot.
 *   3. The camera permission prompt arriving AFTER the member has committed
 *      to scanning something, which is when they are most likely to say yes.
 *
 * ⚠️ EVERY OPTION SHOWS ITS REAL SIZE. The millimetres are not decoration —
 * they are how somebody holding a temporary authorisation works out that it
 * is the A4 option and not the card one, without us having to list every
 * document SAPS has ever issued.
 */
function Chooser({
  shape,
  onShape,
  multi,
  onMulti,
  pages,
  onStart,
  onCancel,
  onUsePages,
}: {
  shape: DocShape;
  onShape: (s: DocShape) => void;
  multi: boolean;
  onMulti: (v: boolean) => void;
  pages: number;
  onStart: () => void;
  onCancel: () => void;
  /** Present only once something has been scanned. */
  onUsePages?: () => void;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflowY: 'auto',
        padding: '4px 16px max(16px, env(safe-area-inset-bottom))',
      }}
    >
      <h2 style={{ margin: '4px 0 4px', fontSize: 18 }}>
        What are you photographing?
      </h2>
      <p style={{ margin: '0 0 14px', fontSize: 13, opacity: 0.75 }}>
        We will draw a frame the right shape to line it up in.
      </p>

      <div role="radiogroup" aria-label="What are you photographing?">
        {SHAPE_ORDER.map((k) => {
          const spec = SHAPES[k];
          const on = shape === k;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onShape(k)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                width: '100%',
                minHeight: 64,
                marginBottom: 8,
                padding: '10px 12px',
                textAlign: 'left',
                borderRadius: 10,
                color: '#fff',
                border: on
                  ? '2px solid var(--red)'
                  : '1px solid rgba(255,255,255,0.25)',
                background: on ? 'rgba(224,49,49,0.14)' : 'transparent',
              }}
            >
              <ShapeGlyph shape={k} />
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>
                  {spec.label}
                </span>
                <span style={{ display: 'block', fontSize: 12, opacity: 0.75 }}>
                  {spec.examples}
                </span>
                {spec.longMm !== null && spec.shortMm !== null && (
                  <span style={{ display: 'block', fontSize: 11, opacity: 0.55 }}>
                    {spec.shortMm} &times; {spec.longMm} mm &middot;{' '}
                    {holdHint(k)}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          minHeight: 44,
          marginTop: 6,
          fontSize: 14,
        }}
      >
        <input
          type="checkbox"
          checked={multi}
          onChange={(e) => onMulti(e.target.checked)}
          style={{ width: 20, height: 20 }}
        />
        {SHAPES[shape].multiLabel}
      </label>

      <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
        <button type="button" onClick={onCancel} style={secondaryBtn}>
          Cancel
        </button>
        {/* Coming back to change the shape mid-job must not strand the pages
            already taken. */}
        {onUsePages && (
          <button type="button" onClick={onUsePages} style={secondaryBtn}>
            Use the {pages} I have
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onStart}
          style={{ ...secondaryBtn, background: 'var(--red)', border: 'none' }}
        >
          {pages > 0 ? 'Scan another' : 'Open the camera'}
        </button>
      </div>
    </div>
  );
}

/** A little outline at the option's real proportions. */
function ShapeGlyph({ shape }: { shape: DocShape }) {
  const spec = SHAPES[shape];
  const box = 38;
  let w = box;
  let h = box * 0.78;
  if (spec.longMm !== null && spec.shortMm !== null) {
    const a = spec.portrait ? spec.shortMm / spec.longMm : spec.longMm / spec.shortMm;
    if (a >= 1) {
      w = box;
      h = box / a;
    } else {
      h = box;
      w = box * a;
    }
  }
  return (
    <span
      aria-hidden="true"
      style={{
        width: box,
        height: box,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
      }}
    >
      <span
        style={{
          width: w,
          height: h,
          borderRadius: 3,
          border:
            spec.longMm === null
              ? '1.5px dashed rgba(255,255,255,0.6)'
              : '1.5px solid rgba(255,255,255,0.8)',
        }}
      />
    </span>
  );
}

function Header({
  title,
  onClose,
  onBack,
  pages,
}: {
  title: string;
  onClose: () => void;
  onBack?: () => void;
  pages: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: 'max(10px, env(safe-area-inset-top)) 12px 10px',
      }}
    >
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to choosing what you are photographing"
          style={{
            width: 44,
            height: 44,
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.3)',
            background: 'transparent',
            color: '#fff',
            fontSize: 18,
          }}
        >
          &#8592;
        </button>
      )}
      <p style={{ flex: 1, margin: 0, fontSize: 15, fontWeight: 600 }}>
        {title}
        {pages > 0 && (
          <span style={{ marginLeft: 8, opacity: 0.7, fontWeight: 400 }}>
            {pages} saved
          </span>
        )}
      </p>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close the camera"
        style={{
          width: 44,
          height: 44,
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.3)',
          background: 'transparent',
          color: '#fff',
          fontSize: 20,
        }}
      >
        ×
      </button>
    </div>
  );
}

/**
 * THE ALERT THAT DOES NOT GO AWAY.
 *
 * ⚠️ IT STAYS UP UNTIL THE PROBLEM IS GONE. Not a toast, not a three-second
 * flash: the operator was explicit, and he is right. A member who has just
 * been told about glare is a member who is about to move the phone — and a
 * message that has already faded by then leaves them moving it without
 * knowing whether it helped. This one clears itself the moment the frame is
 * good, which is also the only honest signal that it worked.
 */
function ExposureAlert({
  glare,
  luma,
  torchOn,
}: {
  glare: number;
  luma: number;
  torchOn: boolean;
}) {
  const problem = exposureProblem(glare, luma, torchOn);
  if (!problem) return null;
  return (
    <div
      // Assertive, because it is about the thing the member is doing RIGHT NOW
      // and a polite announcement would arrive after the photo.
      role="alert"
      aria-live="assertive"
      style={{
        position: 'absolute',
        top: 'max(12px, env(safe-area-inset-top))',
        left: 12,
        right: 12,
        padding: '10px 12px',
        borderRadius: 10,
        background: 'rgba(180,32,32,0.94)',
        color: '#fff',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        pointerEvents: 'none',
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 18, lineHeight: '20px' }}>
        &#9888;
      </span>
      <span>
        <strong style={{ display: 'block', fontSize: 15 }}>
          {problem.head}
        </strong>
        <span style={{ fontSize: 13, opacity: 0.95 }}>{problem.body}</span>
      </span>
    </div>
  );
}

function Controls({
  hasTorch,
  torchOn,
  onTorch,
  onShutter,
  onDone,
  pages,
  auto,
  onAuto,
  holdPct,
}: {
  hasTorch: boolean;
  torchOn: boolean;
  onTorch: () => void;
  onShutter: () => void;
  onDone?: () => void;
  pages: number;
  auto: boolean;
  onAuto: () => void;
  holdPct: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '14px 20px max(18px, env(safe-area-inset-bottom))',
      }}
    >
      <div style={{ width: 88 }}>
        {hasTorch && (
          <button
            type="button"
            onClick={onTorch}
            aria-pressed={torchOn}
            // ⚠️ "For dark rooms" is not decoration. A torch at close range on
            // a laminated licence card produces exactly the blown highlight
            // that cannot be recovered from.
            aria-label={torchOn ? 'Turn the light off' : 'Light, for dark rooms'}
            style={{
              minHeight: 44,
              padding: '0 12px',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.3)',
              background: torchOn ? 'rgba(232,181,58,0.25)' : 'transparent',
              color: '#fff',
              fontSize: 13,
            }}
          >
            {torchOn ? 'Light on' : 'Light'}
          </button>
        )}
      </div>

      <div style={{ position: 'relative', width: 72, height: 72 }}>
        {/* The hold ring: fills as the phone holds still, so an automatic
            capture is never a surprise — the member can see it coming and
            move if they did not mean it. */}
        {auto && holdPct > 0 && (
          <svg
            width="72"
            height="72"
            viewBox="0 0 72 72"
            aria-hidden="true"
            style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}
          >
            <circle
              cx="36"
              cy="36"
              r="33"
              fill="none"
              stroke={MARK}
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={`${holdPct * 207} 207`}
            />
          </svg>
        )}
        <button
          type="button"
          onClick={onShutter}
          aria-label="Take the photo"
          style={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            border: '4px solid #fff',
            background: 'rgba(255,255,255,0.18)',
          }}
        />
      </div>

      <div style={{ width: 88, textAlign: 'right' }}>
        <button
          type="button"
          onClick={onAuto}
          aria-pressed={auto}
          aria-label={
            auto
              ? 'Automatic capture is on. Turn it off.'
              : 'Automatic capture is off. Turn it on.'
          }
          style={{
            minHeight: 44,
            padding: '0 10px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.3)',
            background: auto ? 'rgba(77,163,255,0.25)' : 'transparent',
            color: '#fff',
            fontSize: 13,
            marginBottom: onDone ? 8 : 0,
          }}
        >
          {auto ? 'Auto on' : 'Auto off'}
        </button>
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            style={{
              minHeight: 44,
              padding: '0 12px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--red)',
              color: '#fff',
              fontSize: 14,
            }}
          >
            Use {pages}
          </button>
        )}
      </div>
    </div>
  );
}

// ── review ──────────────────────────────────────────────────────────

function Review({
  shot,
  editing,
  onEdit,
  onCancelEdit,
  onQuad,
  onRetake,
  onUse,
  onAddAnother,
  onNextDocument,
  multi,
}: {
  shot: ScanResult;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onQuad: (q: Quad) => void;
  onRetake: () => void;
  onUse: () => void;
  onAddAnother: () => void;
  /** Keep the page, but go back and say what the next one is. */
  onNextDocument: () => void;
  /** Did the member say up front that there is more than one? */
  multi: boolean;
}) {
  const notes = verdicts(shot);

  // ⚠️ THE EDITOR TAKES THE WHOLE SCREEN, and shows the ORIGINAL photograph.
  // It used to be a strip under a 240px-tall thumbnail of the RECTIFIED
  // output — so the one image on screen was the consequence of the corners
  // being wrong, and the document's real edges were nowhere to be seen.
  if (editing) {
    return (
      <div style={{ position: 'absolute', inset: 0, background: '#000' }}>
        <CornerEditor
          src={shot.sourcePreview}
          size={shot.sourceSize}
          quad={shot.quad}
          onCancel={onCancelEdit}
          onApply={onQuad}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#000',
      }}
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 12,
          minHeight: 0,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={shot.preview}
          alt="The document as it will be saved"
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
        />
      </div>

      {notes.length > 0 && (
        <ul
          style={{
            margin: 0,
            padding: '0 18px 6px',
            fontSize: 13,
            opacity: 0.9,
            listStyle: 'none',
          }}
        >
          {notes.map((n) => (
            <li key={n} style={{ marginBottom: 4 }}>
              {n}
            </li>
          ))}
        </ul>
      )}

      <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            padding: '10px 16px max(16px, env(safe-area-inset-bottom))',
          }}
        >
          <button type="button" onClick={onRetake} style={secondaryBtn}>
            Take it again
          </button>
          <button type="button" onClick={onEdit} style={secondaryBtn}>
            Fix the corners
          </button>
          <div style={{ flex: 1 }} />
          {/* ⚠️ THE PRIMARY ACTION FOLLOWS WHAT THEY ALREADY TOLD US.
              Somebody who said "front and back" is going to press "Next page"
              — putting "Use it" under their thumb instead means one tap ends
              the job with half the document. Somebody scanning one page never
              sees "Next page" at all. */}
          {multi ? (
            <>
              <button type="button" onClick={onUse} style={secondaryBtn}>
                That is all
              </button>
              {/* ⚠️ THE NEXT THING IS OFTEN A DIFFERENT SHAPE. Somebody
                  working through a motivation pack photographs an A4
                  competency certificate, then a licence card, then the page
                  of an ID book. Sending them straight back to the camera with
                  the previous document's aim box means the corners are wrong
                  for everything after the first one. */}
              <button type="button" onClick={onNextDocument} style={secondaryBtn}>
                Different document
              </button>
              <button
                type="button"
                onClick={onAddAnother}
                style={{
                  ...secondaryBtn,
                  background: 'var(--red)',
                  border: 'none',
                }}
              >
                Next page
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={onAddAnother} style={secondaryBtn}>
                Add another
              </button>
              <button
                type="button"
                onClick={onUse}
                style={{
                  ...secondaryBtn,
                  background: 'var(--red)',
                  border: 'none',
                }}
              >
                Use it
              </button>
            </>
          )}
        </div>
    </div>
  );
}

