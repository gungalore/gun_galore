import { useEffect, useRef, useState, type ReactElement } from 'react';
import { CameraOpenError, openRearCamera, setTorch, stopCamera, type CameraError, type CameraOpener, type OpenCamera } from '../../camera/camera';
import { grabFrame, grabRegion, grabStill, type StillSource } from '../../camera/still';
import type { Detector } from '../../pipeline/detector';
import { MIN_CONFIDENCE } from '../../pipeline/detector';
import { DEFAULT_GATES, documentCrispness, evaluateGates, HINT_TEXT, regionCrispness, softPreviewGates, TEXT_INSET, toGrey, type GateResult } from '../../pipeline/gates';
import { focusContinuous, focusOnce } from '../../camera/camera';
import { isSmall, mapLiveToStill } from '../../pipeline/locate';
import { linearFill, orderQuad, touchesEdge } from '../../pipeline/geometry';
import type { Quad } from '../../pipeline/geometry';
import type { LiveOutline } from '../../pipeline/locate';
import { scaleQuad } from '../../pipeline/geometry';
import { QuadSmoother, StabilityLatch } from '../../pipeline/tracker';
import { Icon } from '../icons';
import { TopBar } from './TopBar';

export interface DiagSample {
  fps: number;
  detectMs: number | null;
  hint: string;
  gates: GateResult | null;
  locked: boolean;
  progress: number;
  streamSize: string;
}

export interface CaptureMeta {
  source: StillSource;
  stillWidth: number;
  stillHeight: number;
  videoWidth: number;
  videoHeight: number;
  /** Whether a live outline went along with the still, to seed the search. */
  liveQuadUsed: boolean;
  /** The live outline itself, in video pixels, so archived stills can replay the search. */
  liveQuad?: Quad | null;
  /** Crispness of the print in the still that was accepted (see `documentCrispness`), when it could be judged. */
  stillCrispness?: number | null;
  /** How many stills were taken before one was accepted. */
  tries?: number;
  /** Whether the camera took an explicit focus request before the photo. */
  focused?: boolean;
  /** Milliseconds spent waiting for the focus to settle before the first photo. */
  settleMs?: number;
}

export interface CameraScreenProps {
  detector: Detector;
  pagesCount: number;
  onCaptured: (still: ImageData, live: LiveOutline | null, meta: CaptureMeta) => void;
  onError: (reason: CameraError) => void;
  onPick: () => void;
  onClose: () => void;
  onDiag?: (d: DiagSample) => void;
  /** Defaults to the rear camera. */
  openCamera?: CameraOpener;
}

const LIVE_FPS = 12;
/** Print this crisp in the preview at lock means the lens has settled: take the photo at once. */
const CONVERGED_CRISPNESS = 180;

/** The still's size, oriented like the video (a track may report its size landscape while the video plays portrait). */
function stillSizeFor(cam: OpenCamera, video: HTMLVideoElement): { width: number; height: number } {
  const portrait = video.videoHeight > video.videoWidth;
  const w = cam.stillWidth;
  const h = cam.stillHeight;
  if (w <= 0 || h <= 0) return { width: video.videoWidth, height: video.videoHeight };
  return portrait === h > w ? { width: w, height: h } : { width: h, height: w };
}
/** Stills taken before a soft one is accepted anyway. */
const MAX_STILL_TRIES = 3;
/** Pause between stills, for the focus to settle after "hold still". */
const RETAKE_PAUSE_MS = 400;
/** Longest wait for the focus to settle before a photo, and how often the print is sampled meanwhile. */
const SETTLE_MAX_MS = 1200;
const SETTLE_STEP_MS = 120;
/** Focus counts as settled when this many samples in a row agree within the tolerance. */
const SETTLE_RUN = 3;
const SETTLE_TOLERANCE = 0.04;
/** How long a lost outline is still tracked in its window before the search widens. */
const TRACK_MEMORY_MS = 1500;
/** Room around the last outline when looking for it again, as a share of its size. */
const TRACK_MARGIN = 0.5;
/** The middle of the frame tried, every other frame, when nothing has been seen. */
const CENTRE_SHARE = 0.62;
const RING_R = 32;
const RING_C = 2 * Math.PI * RING_R;

export function CameraScreen({ detector, pagesCount, onCaptured, onError, onPick, onClose, onDiag, openCamera = openRearCamera }: CameraScreenProps): ReactElement {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const camRef = useRef<OpenCamera | null>(null);
  const capturingRef = useRef(false);
  /** Set once a capture has been handed over; nothing on this screen may fire again. */
  const doneRef = useRef(false);
  const stopLoopRef = useRef<() => void>(() => undefined);
  const [hint, setHint] = useState<{ text: string; tone: 'neutral' | 'ok' | 'warn' }>({ text: HINT_TEXT.searching, tone: 'neutral' });
  const [progress, setProgress] = useState(0);
  const [locked, setLocked] = useState(false);
  const [torch, setTorchState] = useState<{ available: boolean; on: boolean }>({ available: false, on: false });
  /** True from the shutter until the still has been handed over; the screen freezes meanwhile. */
  const [capturing, setCapturing] = useState(false);
  /** The white flash: only once a photo has actually been taken and accepted. */
  const [flash, setFlash] = useState(false);
  const gatesRef = useRef<GateResult | null>(null);

  // Capture, from the ring or from the latch.
  const capture = async (quad: Quad | null, frameW: number, frameH: number): Promise<void> => {
    const video = videoRef.current;
    if (!video || capturingRef.current || doneRef.current) return;
    if (video.videoWidth < 64 || video.videoHeight < 64) return; // stream gone
    capturingRef.current = true;
    stopLoopRef.current(); // the detector is free for the still, and no second shutter
    setCapturing(true);
    // Not "Got it" yet: the photo is still to be taken, and a member who hears
    // "got it" moves. The flash and the words come when the photo exists.
    setHint({ text: 'Hold still...', tone: 'ok' });
    setProgress(1);
    try {
      // The live outline, in video pixels: it seeds the still's zoomed search and
      // says where to judge the still's print.
      const live = quad ? { quad: scaleQuad(quad, video.videoWidth / frameW, video.videoHeight / frameH), width: video.videoWidth, height: video.videoHeight } : null;
      const fill = quad ? linearFill(quad, frameW, frameH) : 0;
      const fillNeeded = gatesRef.current?.fillNeeded ?? DEFAULT_GATES.minFill;
      let still: ImageData | null = null;
      let source: StillSource = 'frame';
      let stillCrispness: number | null = null;
      let tries = 0;
      const track = camRef.current?.track ?? null;
      const cam = camRef.current;
      const softPreview = !!cam?.photoPipeline;
      /** Crispness of the print inside the live outline, from the video now. */
      const sampleCrispness = (): number | null => {
        if (!live) return null;
        const xs = live.quad.map((p) => p.x);
        const ys = live.quad.map((p) => p.y);
        const bw = Math.max(...xs) - Math.min(...xs);
        const bh = Math.max(...ys) - Math.min(...ys);
        const region = grabRegion(video, Math.min(...xs) + bw * TEXT_INSET, Math.min(...ys) + bh * TEXT_INSET, bw * (1 - 2 * TEXT_INSET), bh * (1 - 2 * TEXT_INSET), Infinity);
        return region ? regionCrispness(region, bw) : null;
      };
      // If the print was already crisp when the ring filled the lens has settled:
      // take the photo at once, every tenth of a second is a chance to move.
      // Otherwise ask for a focus on the document and wait for the preview's
      // print to stop changing: a photo taken while the lens moves is blur.
      const centre = live ? { x: (live.quad[0].x + live.quad[2].x) / 2 / live.width, y: (live.quad[0].y + live.quad[2].y) / 2 / live.height } : undefined;
      const lockCrispness = gatesRef.current?.crispness ?? null;
      const needsFocus = softPreview && (lockCrispness === null || lockCrispness < CONVERGED_CRISPNESS);
      const focused = needsFocus ? await focusOnce(track, centre) : false;
      const settleStart = performance.now();
      let settleMs = 0;
      if (needsFocus && live) {
        let run = 0;
        let prev: number | null = null;
        while (performance.now() - settleStart < SETTLE_MAX_MS && !doneRef.current) {
          await new Promise((r) => setTimeout(r, SETTLE_STEP_MS));
          const c = sampleCrispness();
          if (c !== null && prev !== null && Math.abs(c - prev) <= SETTLE_TOLERANCE * Math.max(c, prev)) run++;
          else run = 0;
          prev = c;
          if (run >= SETTLE_RUN - 1) break;
        }
        settleMs = Math.round(performance.now() - settleStart);
      }
      // The camera stays open and this screen stays mounted until the still exists:
      // tearing the stream down first hands back an empty frame. The still is judged
      // where the live outline says the print is; a soft one is taken again, since
      // a preview can look focused when the photo is not.
      for (;;) {
        tries++;
        const got = await grabStill(video, camRef.current?.track ?? null, camRef.current?.photoSettings ?? null);
        if (doneRef.current) return;
        still = got.image;
        source = got.source;
        stillCrispness = live && still.width >= 64 ? documentCrispness(still, orderQuad(mapLiveToStill(live, still.width, still.height))) : null;
        if (stillCrispness === null || stillCrispness >= DEFAULT_GATES.minPhotoCrispness || tries >= MAX_STILL_TRIES) break;
        const tooClose = fill > fillNeeded * DEFAULT_GATES.tooCloseFactor;
        setHint({ text: tooClose ? HINT_TEXT.far : 'A bit blurry - hold still...', tone: 'warn' });
        if (softPreview) await focusOnce(track, centre);
        await new Promise((r) => setTimeout(r, RETAKE_PAUSE_MS));
        if (doneRef.current) return;
        setHint({ text: 'Got it!', tone: 'ok' });
      }
      doneRef.current = true;
      setFlash(true);
      setHint({ text: 'Got it!', tone: 'ok' });
      video.pause();
      if (focused) void focusContinuous(track);
      onCaptured(still, live, { source, stillWidth: still.width, stillHeight: still.height, videoWidth: video.videoWidth, videoHeight: video.videoHeight, liveQuadUsed: !!live, liveQuad: live?.quad ?? null, stillCrispness, tries, focused, settleMs });
    } catch {
      // The still could not be taken; let the member try again.
      void focusContinuous(camRef.current?.track ?? null);
      doneRef.current = false;
      setCapturing(false);
      setProgress(0);
      setHint({ text: HINT_TEXT.searching, tone: 'neutral' });
    } finally {
      capturingRef.current = false;
    }
  };
  const captureRef = useRef(capture);
  captureRef.current = capture;

  useEffect(() => {
    let cancelled = false;
    // The element this effect started with: the cleanup must not read the ref afresh.
    const videoEl = videoRef.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const smoother = new QuadSmoother();
    const latch = new StabilityLatch();
    let lastTick = 0;
    let busy = false;
    let frames = 0;
    let fpsAt = performance.now();
    let fps = 0;
    let lastDetectMs: number | null = null;
    let latestQuad: Quad | null = null;
    let latestFrame = { w: 1, h: 1 };
    let lastGates: GateResult | null = null;
    /** Where the outline was last seen (frame pixels), to look there first. */
    let lastSeen: { quad: Quad; at: number } | null = null;
    let searchFlip = false;
    /** After a missed window, the next tick looks at the whole frame instead. */
    let wholeNext = false;

    /**
     * Run the detector on a window of the video (frame pixels), answering in
     * frame pixels. A small outline is a few dozen pixels in the whole-frame
     * view and the model loses it; in a window around where it was, or the
     * middle of the frame, it is large and found.
     */
    const detectIn = async (video: HTMLVideoElement, frameW: number, frameH: number, box: { x0: number; y0: number; x1: number; y1: number }): Promise<Quad | null> => {
      const kx = video.videoWidth / frameW;
      const ky = video.videoHeight / frameH;
      const x0 = Math.max(0, box.x0);
      const y0 = Math.max(0, box.y0);
      const x1 = Math.min(frameW, box.x1);
      const y1 = Math.min(frameH, box.y1);
      const bw = x1 - x0;
      const bh = y1 - y0;
      if (bw < 16 || bh < 16) return null;
      const outWidth = bw >= bh ? detector.inputSize : Math.round((detector.inputSize * bw) / bh);
      const region = grabRegion(video, x0 * kx, y0 * ky, bw * kx, bh * ky, outWidth);
      if (!region) return null;
      const det = await detector.detect(region, 'live').catch(() => null);
      if (!det || det.confidence < MIN_CONFIDENCE) return null;
      // On the window's border means the document runs past it: not an answer.
      if (touchesEdge(det.quad, region.width, region.height, 0.015)) return null;
      const sx = bw / region.width;
      const sy = bh / region.height;
      return det.quad.map((p) => ({ x: x0 + p.x * sx, y: y0 + p.y * sy })) as Quad;
    };

    const draw = (quad: Quad | null, state: 'tracking' | 'locked' | 'none'): void => {
      const c = overlayRef.current;
      const video = videoRef.current;
      const stage = stageRef.current;
      if (!c || !video || !stage) return;
      const sw = stage.clientWidth;
      const sh = stage.clientHeight;
      if (c.width !== sw || c.height !== sh) {
        c.width = sw;
        c.height = sh;
      }
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, sw, sh);
      if (!quad || state === 'none') return;
      // object-fit: cover mapping from frame pixels to stage pixels
      const vw = latestFrame.w;
      const vh = latestFrame.h;
      const s = Math.max(sw / vw, sh / vh);
      const ox = (sw - vw * s) / 2;
      const oy = (sh - vh * s) / 2;
      const pts = quad.map((p) => ({ x: p.x * s + ox, y: p.y * s + oy }));
      const col = state === 'locked' ? '#2ECC71' : '#FFFFFF';
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = state === 'locked' ? 'rgba(46,204,113,0.16)' : 'rgba(255,255,255,0.08)';
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = state === 'locked' ? 3 : 2;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      const len = 22;
      for (let i = 0; i < 4; i++) {
        const p = pts[i];
        for (const q of [pts[(i + 1) % 4], pts[(i + 3) % 4]]) {
          const d = Math.hypot(q.x - p.x, q.y - p.y) || 1;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + ((q.x - p.x) / d) * len, p.y + ((q.y - p.y) / d) * len);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.fill();
      }
    };

    // A timer, not requestAnimationFrame: the loop is paced by the detector, not
    // by the display, and it must keep going when the page is not being painted.
    const schedule = (delay: number): void => {
      if (cancelled) return;
      timer = setTimeout(() => void tick(performance.now()), delay);
    };
    stopLoopRef.current = () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
    const tick = async (t: number): Promise<void> => {
      if (cancelled) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2 || busy || capturingRef.current) {
        schedule(50);
        return;
      }
      lastTick = t;
      busy = true;
      try {
        const frame = grabFrame(video, detector.inputSize);
        latestFrame = { w: frame.width, h: frame.height };
        const t0 = performance.now();
        let raw: Quad | null = null;
        const remembered = lastSeen && t - lastSeen.at < TRACK_MEMORY_MS ? lastSeen.quad : null;
        // A small outline seen a moment ago: look for it in a window around that spot.
        // One detector pass a tick: a missed window hands the next tick to the whole frame.
        let looked = false;
        if (remembered && isSmall(remembered, frame.width, frame.height) && !wholeNext) {
          looked = true;
          const xs = remembered.map((p) => p.x);
          const ys = remembered.map((p) => p.y);
          const mw = (Math.max(...xs) - Math.min(...xs)) * TRACK_MARGIN;
          const mh = (Math.max(...ys) - Math.min(...ys)) * TRACK_MARGIN;
          raw = await detectIn(video, frame.width, frame.height, { x0: Math.min(...xs) - mw, y0: Math.min(...ys) - mh, x1: Math.max(...xs) + mw, y1: Math.max(...ys) + mh });
          if (cancelled) return;
          wholeNext = !raw;
        }
        if (!raw && !looked) {
          wholeNext = false;
          const det = await detector.detect(frame, 'live').catch(() => null);
          if (cancelled) return; // unmounted or captured while the model was thinking
          raw = det && det.confidence >= MIN_CONFIDENCE ? det.quad : null;
        }
        // Nothing anywhere: every other frame, try the middle, where people hold a document.
        if (!raw && !remembered && !looked) {
          searchFlip = !searchFlip;
          if (searchFlip) {
            const cx = frame.width / 2;
            const cy = frame.height / 2;
            raw = await detectIn(video, frame.width, frame.height, { x0: cx - (frame.width * CENTRE_SHARE) / 2, y0: cy - (frame.height * CENTRE_SHARE) / 2, x1: cx + (frame.width * CENTRE_SHARE) / 2, y1: cy + (frame.height * CENTRE_SHARE) / 2 });
            if (cancelled) return;
          }
        }
        lastDetectMs = performance.now() - t0;
        if (raw) lastSeen = { quad: raw, at: t };
        const quad = raw ? smoother.push(raw, t) : smoother.miss();
        latestQuad = quad;
        const grey = toGrey(frame);
        const cam = camRef.current;
        // The print inside the outline, from the video at native resolution: the
        // 256 px analysis frame cannot tell focused text from defocused text.
        let crispness: number | null = null;
        if (quad) {
          const kx = video.videoWidth / frame.width;
          const ky = video.videoHeight / frame.height;
          const xs = quad.map((p) => p.x * kx);
          const ys = quad.map((p) => p.y * ky);
          const bw = Math.max(...xs) - Math.min(...xs);
          const bh = Math.max(...ys) - Math.min(...ys);
          // The inside of the outline at native resolution; the measure scales it itself.
          const region = grabRegion(video, Math.min(...xs) + bw * TEXT_INSET, Math.min(...ys) + bh * TEXT_INSET, bw * (1 - 2 * TEXT_INSET), bh * (1 - 2 * TEXT_INSET), Infinity);
          if (region) crispness = regionCrispness(region, bw);
        }
        // A preview that stands for a bigger photo (Android) is softer than that photo.
        const softPreview = !!cam?.photoPipeline;
        const gates = evaluateGates(quad, frame, grey, softPreview ? softPreviewGates(DEFAULT_GATES) : DEFAULT_GATES, cam ? stillSizeFor(cam, video) : undefined, crispness);
        lastGates = gates;
        gatesRef.current = gates;
        const state = latch.update(quad, gates.pass, t, frame.width, frame.height);
        // Only touch React state when something the member can see changed.
        const tone = state.locked ? 'ok' : gates.hint === 'dark' || gates.hint === 'glare' || gates.hint === 'blur' || gates.hint === 'far' ? 'warn' : 'neutral';
        setHint((h) => (h.text === HINT_TEXT[gates.hint] && h.tone === tone ? h : { text: HINT_TEXT[gates.hint], tone }));
        const p = Math.round(state.progress * 50) / 50;
        setProgress((prev) => (prev === p ? prev : p));
        setLocked((prev) => (prev === state.locked ? prev : state.locked));
        draw(quad, state.locked ? 'locked' : quad ? 'tracking' : 'none');
        frames++;
        if (t - fpsAt > 1000) {
          fps = (frames * 1000) / (t - fpsAt);
          frames = 0;
          fpsAt = t;
        }
        onDiag?.({
          fps: Math.round(fps),
          detectMs: lastDetectMs === null ? null : Math.round(lastDetectMs),
          hint: gates.hint,
          gates,
          locked: state.locked,
          progress: state.progress,
          streamSize: `${video.videoWidth}x${video.videoHeight}${cam?.photoPipeline ? ` (still ${cam.stillWidth}x${cam.stillHeight})` : ''}${cam?.capabilities.focusModes.length ? ` af:${cam.capabilities.focusModes.join('/')}` : ''}${cam?.label ? ` [${cam.label}]` : ''}${cam?.probe ? ` {${cam.probe}}` : ''}`,
        });
        if (state.progress >= 1 && !capturingRef.current && !doneRef.current) {
          void captureRef.current(latestQuad, frame.width, frame.height);
        }
      } finally {
        busy = false;
        schedule(Math.max(0, 1000 / LIVE_FPS - (performance.now() - lastTick)));
      }
    };

    (async () => {
      try {
        // A detector that cannot load leaves the camera usable with a manual shutter.
        await detector.ready().catch((e: Error) => {
          console.warn('[aos] detector unavailable, manual shutter only:', e.message);
        });
        const cam = await openCamera();
        if (cancelled) {
          stopCamera(cam);
          return;
        }
        camRef.current = cam;
        const video = videoRef.current;
        if (video) {
          video.srcObject = cam.stream;
          await video.play().catch(() => undefined);
        }
        setTorchState({ available: cam.capabilities.torch, on: false });
        schedule(0);
      } catch (e) {
        if (cancelled) return;
        onError(e instanceof CameraOpenError ? e.reason : 'unknown');
      }
    })();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      stopCamera(camRef.current);
      camRef.current = null;
      if (videoEl) {
        videoEl.pause();
        videoEl.srcObject = null;
      }
      void lastGates;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detector, openCamera]);

  const manualCapture = (): void => {
    const video = videoRef.current;
    if (!video || capturing) return;
    void captureRef.current(null, video.videoWidth, video.videoHeight);
  };

  const toggleTorch = async (): Promise<void> => {
    const track = camRef.current?.track;
    if (!track) return;
    const ok = await setTorch(track, !torch.on);
    if (ok) setTorchState((s) => ({ ...s, on: !s.on }));
  };

  return (
    <>
      <TopBar left={{ icon: 'close', onClick: onClose, aria: 'Close' }} title="Scan" />
      <div className="aos-stage" ref={stageRef}>
        <video ref={videoRef} className="aos-video" playsInline muted autoPlay />
        <canvas ref={overlayRef} className="aos-overlay" />
        {flash ? <div className="aos-shutter-flash" aria-hidden="true" /> : null}
        <div className="aos-stage-ui">
          <div className={`aos-hint ${hint.tone === 'ok' ? 'aos-ok' : hint.tone === 'warn' ? 'aos-warn' : ''}`} role="status" aria-live="polite">
            <Icon name={flash ? 'check' : hint.tone === 'ok' ? 'hand' : hint.tone === 'warn' ? 'alert' : 'doc'} size={22} />
            <span>{hint.text}</span>
          </div>
        </div>
      </div>
      <div className="aos-camera-controls">
        <button type="button" className="aos-control" onClick={onPick} aria-label="Choose from photos">
          <span className={`aos-thumb ${pagesCount ? 'aos-filled' : ''}`}>
            <Icon name="photos" size={22} />
            {pagesCount ? <span className="aos-badge-count">{pagesCount}</span> : null}
          </span>
          <span>{pagesCount ? 'Pages' : 'Photos'}</span>
        </button>
        <div className="aos-ring-label">
          <button type="button" className="aos-ring" onClick={manualCapture} aria-label="Take the scan now">
            <svg width="76" height="76" viewBox="0 0 76 76">
              <circle cx="38" cy="38" r={RING_R} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="4" />
              <circle
                cx="38"
                cy="38"
                r={RING_R}
                fill="none"
                stroke={locked ? '#2ECC71' : '#FFFFFF'}
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={RING_C}
                strokeDashoffset={RING_C * (1 - progress)}
                transform="rotate(-90 38 38)"
              />
              <circle cx="38" cy="38" r="24" fill={locked ? '#2ECC71' : '#FFFFFF'} />
            </svg>
          </button>
          <span>{locked ? 'Auto' : 'Tap to scan'}</span>
        </div>
        {torch.available ? (
          <button type="button" className="aos-control" onClick={toggleTorch} aria-pressed={torch.on} aria-label="Light">
            <span className={`aos-control-btn ${torch.on ? 'aos-on' : ''}`}>
              <Icon name={torch.on ? 'flash' : 'flashOff'} size={24} />
            </span>
            <span>Light {torch.on ? 'on' : 'off'}</span>
          </button>
        ) : (
          <span className="aos-control" aria-hidden="true" />
        )}
      </div>
    </>
  );
}
