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
import { useScrollLock } from '@/lib/use-scroll-lock';
import { aimAgreement, aimBox } from '@/lib/scan/aim';
import { exposureProblem } from '@/lib/scan/exposure';
import {
  type CameraFacts,
  framingPlan,
  readCameraFacts,
} from '@/lib/scan/framing';
import { DETECT_ACCEPT, lastDetectFailure } from '@/lib/scan/detect-client';
import {
  LiveDetector,
  type LiveReading,
  type LiveStatus,
} from '@/lib/scan/docquad-live';
import {
  type CameraOption,
  bestCamera,
  matchPref,
  probeCameras,
  readCameraPref,
  writeCameraPref,
} from '@/lib/scan/cameras';
import {
  ARM_MS,
  AutoBlocker,
  MOTION_STILL,
  autoBlocker,
  autoHint,
  holdComplete,
  holdProgress,
} from '@/lib/scan/autocapture';
import { inkiness } from '@/lib/scan/detect';
import { LIVE_DOC_CONFIDENCE, seededCorners } from '@/lib/scan/edges';
import {
  mapToBuffer,
  motionOf,
  rectQuad,
  regionExposure,
  sampleRegion,
  regionGray,
  coarsen,
} from '@/lib/scan/frame-stats';
import {
  deviceContext,
  pushFrame,
  type DeviceContext,
  type FrameSnapshot,
  type ScanReport,
} from '@/lib/scan/diagnostics';
import { diagnosticsOn } from '@/lib/scan/diag-flag';
import ScanDiagnostics from './scan-diagnostics';
import { OVERLAY_WARNING } from '@/lib/scan/overlay';

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
//
// ⚠️ AUTOMATIC CAPTURE IS ON BY DEFAULT, AND THIS IS ITS SECOND LIFE.
//
// It existed, failed in two distinct ways, was removed in full, and has been
// re-specified rather than revived. Both failures shaped what is here now, so
// neither may be lost:
//
//   1. "IT NEVER CAPTURED." The old gate required the DETECTED quad to agree
//      with the aim box — and on a real licence card the detector never sees
//      the card at all (the skipped regression in detect.spec.ts: "the card is
//      never a CANDIDATE"; the mat is). The gate waited on an agreement that
//      could not arrive.
//
//   2. "THE IMAGES CAME OUT SKEW OR OUTSIDE THE FOCUS LINES." The crop also
//      came from the detector's quad back then, so a shot cut out whatever
//      rectangle it had latched onto.
//
// The second is already dead, and not by anything to do with auto-capture:
// processCapture now crops EXACTLY the aim box, so a capture can only produce
// the rectangle the member lined the document up against.
//
// The first is fixed by taking the detector out of the decision. It has no say
// in the crop, so it does not hold the trigger either — the gate now asks three
// questions about the FRAME (is a document in the box, can it be read, is it
// still) and lives in lib/scan/autocapture.ts with tests. Detection still runs,
// and still does exactly one job: turning the aim box green.
//
// ⚠️ THE RULES THAT SURVIVED FROM THE FIRST LIFE, ALL PAID FOR:
//   * 1100ms hold, not 700 — at 700 it fired while the phone was still being
//     positioned.
//   * Stillness measured on FRAME PIXELS, never on the detected quad, which a
//     patterned carpet could stall for ever.
//   * The manual shutter must NEVER switch auto off. That rule produced a doom
//     loop nobody could describe: auto feels slow → you press → auto is off for
//     the session → every document needs a press → auto never works. The toggle
//     beside the shutter is the only thing that may change it.
//   * The ring round the shutter fills as the hold completes, so a shot is
//     never a surprise.
// ────────────────────────────────────────────────────────────────────

const Z = 130;

/** Detection interval, in ms, at each health level. */
const RATES = [100, 200] as const;

export interface DocumentScannerProps {
  /**
   * Ask the server where the document is, once, on capture.
   *
   * ⚠️ A PROP, NOT AN IMPORT, BECAUSE THIS COMPONENT HAS NO AUTH AND SHOULD
   * NOT GAIN ANY. It is a pure UI piece: it produces a File and hands it to
   * whoever mounted it, and the parent — which already holds either a Clerk
   * session or a scan-handoff token — does the authed calls. Wiring fetch in
   * here would give the scanner two ways to be signed in and neither of them
   * tested.
   *
   * Optional throughout. A parent that does not pass it gets exactly the
   * behaviour that shipped before: the corner editor opens on the aim box.
   */
  detect?: (
    frame: Blob,
  ) => Promise<{ quad: Quad; minConfidence: number; ms?: number } | null>;
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
  /**
   * Skip the "what are you holding?" step and open the camera on this shape.
   *
   * ⚠️ FOR FLOWS WHERE WE ALREADY KNOW. A seller who tapped a link that says
   * "photograph your firearm licence" does not need to be asked what they are
   * holding, and asking a stranger an extra question before the camera opens
   * is how a two-minute task starts feeling like an application form. The
   * shape is still changeable on screen — see the note on `shape`.
   */
  skipChoose?: boolean;
  /**
   * Keep the aim box green throughout instead of red-until-detected.
   *
   * Operator, 2026-08-23: "keep it static green. User must just point, fit in
   * the box and shoot." See AimFrame's own note for why a verdict-coloured box
   * is wrong for a flow whose user is a stranger with nobody to ask.
   */
  staticAim?: boolean;
  title: string;
  /**
   * A second line under the title, in the header itself.
   *
   * ⚠️ IT LIVES IN THE HEADER ON PURPOSE. The seller-consent flow used to
   * render its own guidance as a `position: fixed; bottom` overlay, which sat
   * directly on top of the shutter row in the capture phase and on the
   * Cancel/Reset/Apply row in the align phase — reported from a real phone,
   * 2026-08-24. Anything anchored to the bottom of a full-screen camera
   * fights the controls for that space. A subtitle in the header is in normal
   * flow above everything and cannot collide with a control. Optional: the
   * callers that do not pass it render exactly as before.
   */
  subtitle?: string;
  onDone: (files: File[]) => void | Promise<void>;
  onClose: () => void;
}

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
  // ⚠️ NO DEFAULT HERE ON PURPOSE. `= 'any'` made "nobody has answered yet"
  // indistinguishable from "they answered: something else", and the chooser
  // rendered the vaguest option pre-ticked with the red selected border. A
  // member in a hurry taps past it to Open the camera and gets the weakest aim
  // prior we have. `picked` below carries the distinction.
  shape: initialShape,
  multiDefault = false,
  skipChoose = false,
  staticAim = false,
  title,
  subtitle,
  onDone,
  onClose,
  detect,
}: DocumentScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /**
   * The dialog itself, so focus can be moved into it.
   *
   * ⚠️ IT DECLARES aria-modal AND THEN DID NO FOCUS WORK AT ALL. The scanner
   * is portalled to document.body, so it is the LAST child of body while the
   * trigger that opened it sits earlier in the tab order — meaning a keyboard
   * member who opened a full-screen camera was still focused on the button
   * behind it, and tabbing walked the page underneath rather than the dialog.
   */
  const dialogRef = useRef<HTMLDivElement>(null);

  // ⚠️ skipChoose STARTS AT 'starting', NOT 'live'. The camera still has to be
  // asked for and the permission prompt still has to be answered; jumping
  // straight to 'live' would render a viewfinder over a stream that does not
  // exist yet. All skipChoose does is answer the "what are you holding"
  // question on the caller's behalf.
  const [phase, setPhase] = useState<Phase>(skipChoose ? 'starting' : 'choose');
  // ⚠️ STILL NON-NULL. `shape` is dereferenced without a guard in five places
  // (SHAPES[shape].label, SHAPES[shape].multiLabel, aimBox, AimFrame,
  // expectAspectFor), so a null here blows up on the chooser's own first paint.
  // 'any' remains the working value; `picked` is what the chooser reads to
  // decide whether anyone has actually chosen it.
  const [shape, setShape] = useState<DocShape>(initialShape ?? 'any');
  /**
   * Has a shape been chosen — by the member, or by a caller that knows?
   *
   * A caller passing `shape` IS an answer: shapeForKind returns 'any'
   * deliberately for SAFE_PHOTOGRAPHS and OTHER, and there it is the right
   * answer and should show as ticked.
   */
  const [picked, setPicked] = useState(initialShape !== undefined);
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
  // ── the diagnostic readout ──────────────────────────────────────────
  //
  // ⚠️ OFF UNLESS ?diag=1, AND IT COSTS NOTHING WHEN OFF. The trail is only
  // written and the tick only fired while `diag` is true, so a member who
  // never asks for it runs exactly the loop they ran before.
  /** Did the seeded search find a document in the box on the last frame? */
  const docRef = useRef(false);
  const docConfRef = useRef(0);
  const [diag, setDiag] = useState(false);
  const diagRef = useRef(false);
  diagRef.current = diag;
  /** Read inside the detect loop, which must not close over React state. */
  const editingRef = useRef(false);
  const trailRef = useRef<FrameSnapshot[]>([]);
  const deviceRef = useRef<DeviceContext | null>(null);
  // ⚠️ WHAT THE CAMERA ACTUALLY GAVE US, which nothing has ever read.
  // The constraints below ask for 3840x2160 `ideal`; whether that is
  // honoured decides whether an A4 page is scannable at all on this
  // device (a page needs 2.45x a card's pixels for the same legibility).
  const cameraRef = useRef<CameraFacts | null>(null);
  /** Rear lenses this phone offers, for the picker and the diagnostics panel. */
  const [cameras, setCameras] = useState<CameraOption[]>([]);
  /** Which lens we actually ended up on, so the panel can say. */
  const activeCamRef = useRef<string | null>(null);
  /**
   * ⚠️ WHAT THE MODEL SAID, AND WHY WE DID NOT USE IT.
   *
   * `last crop: aim` is overloaded four ways — the model declined, the model
   * errored, the request timed out, or nothing ever asked it. On the
   * operator's Samsung on a pink blanket the panel reported `aim` and there
   * was no way to tell which of the four had happened, so there was nothing
   * to act on. This records the answer itself.
   */
  /**
   * ⚠️ THE MODEL, ON THE PHONE, DRIVING THE LIVE BOX.
   *
   * The classical detector this replaces scores 0/4 on the operator's woven
   * blanket and costs 142-163ms a frame on his Samsung — slow enough that the
   * loop DROPS it entirely ("DETECTOR DROPPED (slow device)"), so on that
   * phone there was no live box at all. The model finds the same documents at
   * 0.81-0.87 and runs in a worker, off the frame budget.
   */
  const liveRef = useRef<LiveDetector | null>(null);
  const liveStatusRef = useRef<LiveStatus>({ state: 'loading' });
  const liveReadingRef = useRef<LiveReading | null>(null);

  const detectRef = useRef<
    | { outcome: 'accepted' | 'declined'; minConfidence: number; ms: number }
    | { outcome: 'no-answer'; why: string }
    | { outcome: 'not-asked' }
    | null
  >(null);
  const lastCaptureRef = useRef<ScanReport['lastCapture']>(undefined);
  /** Bumped on a throttle so the panel repaints without re-rendering per frame. */
  const [diagTick, setDiagTick] = useState(0);
  const diagPaintedRef = useRef(0);

  useEffect(() => {
    setDiag(diagnosticsOn(window.location.search));
  }, []);

  /**
   * The height actually visible right now.
   *
   * ⚠️ MEASURED, BECAUSE dvh LIED. `position: fixed; inset: 0` covers the
   * LARGE viewport, so on Chrome for iOS the foot of this dialog sat behind
   * the browser's bottom toolbar and the corner editor's Apply button was off
   * the screen. Setting `height: 100dvh` was the obvious answer and it did not
   * hold: the operator's two screenshots, same phone and same minute, show it
   * wrong on arrival and right after minimising and restoring the browser.
   *
   * That is the signature of a unit resolved once against a stale chrome state
   * and never re-evaluated — iOS does not reliably re-resolve dvh for a fixed
   * element when the toolbars move. visualViewport is the API that exists to
   * answer this question and it fires an event when the answer changes, so we
   * ask it instead of guessing.
   *
   * The dvh in .gg-scan-root stays as the pre-hydration fallback.
   */
  const [viewportH, setViewportH] = useState<number | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    const read = () => setViewportH(vv?.height ?? window.innerHeight);
    read();
    vv?.addEventListener('resize', read);
    vv?.addEventListener('scroll', read);
    window.addEventListener('orientationchange', read);
    return () => {
      vv?.removeEventListener('resize', read);
      vv?.removeEventListener('scroll', read);
      window.removeEventListener('orientationchange', read);
    };
  }, []);
  const [shot, setShot] = useState<ScanResult | null>(null);
  const [pages, setPages] = useState<File[]>([]);
  const [editing, setEditing] = useState(false);
  editingRef.current = editing;
  /**
   * A re-cut from the corner editor is in flight.
   *
   * ⚠️ NOT `phase = 'working'`. That phase makes the <video>, the overlay
   * canvas and the aim frame visible again, so pressing Apply replaced the
   * member's photograph with a live picture of their desk — at the exact
   * moment they were told to trust the correction. The editor now stays
   * mounted over the top and this flag only disables its buttons, so the
   * thing on screen while we work is the thing they were looking at.
   */
  const [recutting, setRecutting] = useState(false);
  /**
   * Asking before the exit that would eat what is already scanned.
   *
   * ⚠️ THE × AND ESCAPE ARE WHAT A PANICKING MEMBER REACHES FOR. Both used to
   * call onClose() straight through, so four pages into a licence pack they
   * destroyed all four without a word. The dead-end screens in this same file
   * already carry a "Use the {n} I have" button for exactly this reason.
   */
  const [confirmExit, setConfirmExit] = useState(false);
  /**
   * Shoot by itself once a document is in the box, the light is workable and
   * the phone has stopped moving.
   *
   * ⚠️ ON BY DEFAULT — operator, 2026-08-25. The previous version defaulted OFF
   * because it could not be trusted to fire; this one asks a question it can
   * actually answer (see lib/scan/autocapture.ts). The toggle beside the
   * shutter is the ONLY thing that may change this. In particular the manual
   * shutter must NOT: that rule cost two screen recordings and a doom loop
   * last time — auto feels slow, so you press, which disables auto, so every
   * document after it needs a press, which proves auto never works.
   */
  const [auto, setAuto] = useState(true);
  /** 0-1 around the shutter, so an automatic shot is never a surprise. */
  const [holdPct, setHoldPct] = useState(0);
  /** Which gate is currently shut — drives the caption under the aim box. */
  const [blocker, setBlocker] = useState<AutoBlocker | null>('empty');
  /**
   * The FULL-RESOLUTION capture, for the corner editor's magnifier.
   *
   * ⚠️ THE LOUPE WAS MAGNIFYING A SHRUNKEN COPY OF THE THING IT EXISTS TO
   * SHOW. `shot.sourcePreview` is previewUrl(raster, 1200) at quality 0.82,
   * while `shot.sourceSize` is the full raster — so the magnifier's
   * backgroundSize, computed from sourceSize, UPSCALED a lossy 1200px image
   * and put JPEG block artefacts exactly on the paper/desk boundary the member
   * was aiming at. It bit hardest on the good hardware, which is the opposite
   * of what should happen.
   *
   * The raw blob is the original capture at quality 0.95 and is already alive
   * for the whole editing session — `reprocess` re-decodes it on Apply — so
   * this costs one object URL and no extra encode. Geometry is unaffected:
   * processCapture's decode shrink is uniform, so the aspect matches and
   * containFit still maps through `sourceSize`.
   */
  const [editorSrc, setEditorSrc] = useState<string | null>(null);
  const [said, setSaid] = useState('');
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
  const capturingRef = useRef(false);
  // Read by the detect loop, which must not tear down and re-subscribe when
  // these change — restarting it mid-hold would reset the stillness clock for
  // ever, which is one of the ways the old version never fired.
  const autoRef = useRef(true);
  const holdShownRef = useRef(0);
  const blockerShownRef = useRef<AutoBlocker | null>('empty');
  const captureRef = useRef<(() => Promise<void>) | null>(null);
  /** inkiness() over the aim box, refreshed every detection tick. */
  const inkRef = useRef(0);
  /** Does the latest detection look like a document, not just like a shape? */
  const confidentRef = useRef(false);
  const glareRef = useRef(0);
  const glareShownRef = useRef(0);
  const lumaRef = useRef(128);
  const lumaShownRef = useRef(128);
  /**
   * Does what the detector found sit where the member was asked to put it?
   *
   * Turns the aim box green.
   *
   * ⚠️ IT USED TO GATE AUTO-CAPTURE TOO, and the reason it did is worth
   * keeping even though the shutter is now always the member's: on the
   * operator's own IMG_4947 the detector picked out the fabric and the ruler
   * — a bigger, cleaner rectangle than the licence card lying in the corner
   * of the frame — and scored it 0.68, comfortably above the acceptance
   * floor. Nothing in the image says which rectangle is the document. The
   * member does, by putting it in the box. That is why the box exists and
   * why the corner editor follows every shot.
   */
  const aimedRef = useRef(false);
  const aimShownRef = useRef(false);
  /** Consecutive frames the quad has been outside the box. */
  const aimMissRef = useRef(3);
  const [aimed, setAimed] = useState(false);

  autoRef.current = auto;

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
  // ⚠️ skipChoose MUST SET THIS TOO. The camera effect below gates on
  // `started`, which the Chooser normally flips — so skipping the chooser
  // without it opens a viewfinder over a stream nobody ever asked for.
  const [started, setStarted] = useState(skipChoose);
  useEffect(() => {
    if (!started) return;
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPhase('nocamera');
        return;
      }
      try {
        let stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            // ⚠️ ASK FOR EVERYTHING THE PHONE WILL GIVE. A browser cannot
            // reach the stills sensor — getUserMedia hands out video frames —
            // so the only lever on legibility is the track resolution, and
            // modern iPhones and Androids will serve 4K here if asked. `ideal`
            // rather than `min`: a phone that cannot manage it must still get
            // a working scanner rather than a rejected constraint.
            //
            // ⚠️ 4:3, NOT 16:9 — WE WERE ASKING FOR A VIDEO SHAPE TO
            // PHOTOGRAPH DOCUMENTS. This read 3840x2160 and the readout below
            // caught what that costs. On the operator's iPhone the panel
            // printed, in as many words:
            //
            //   asked 3840x2160 · max 4032x3024
            //   device can do 4032x3024 — browser gave 3840x2160
            //
            // A document spans the frame's SHORT axis, and 16:9 held portrait
            // gives it 2160 pixels while the same sensor's native 4:3 gives it
            // 3024. That is 40% more resolution on the only axis that decides
            // whether a serial number is readable, thrown away by asking for a
            // cinema aspect. Sensors are 4:3; 16:9 is a crop of one.
            width: { ideal: 4032 },
            height: { ideal: 3024 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        let track = stream.getVideoTracks()[0];

        // ⚠️ THE BROWSER PICKS THE WRONG LENS AND WE HAVE NEVER ARGUED.
        // facingMode:'environment' hands back the main wide camera on every
        // multi-lens phone — the one with the WORST minimum focus distance —
        // which is the operator's Samsung complaint in full: "seems like I
        // have to hold the phone to close for it to be able to focus". He was
        // not holding it wrong; we put him on the wrong lens.
        //
        // The probe is SILENT. It opens each rear candidate, reads its
        // capabilities and stops the track without ever attaching it to a
        // video element, so nothing appears on screen. (The OS privacy
        // indicator still flickers — that is enforced below the browser and
        // cannot be suppressed. Worth knowing, not worth hiding.)
        //
        // ⚠️ AND IT RUNS AFTER THE GRANT, NEVER BEFORE. enumerateDevices()
        // returns empty labels and empty deviceIds until a getUserMedia grant
        // exists, which is why most attempts at this "find" one camera on a
        // phone that has three.
        try {
          // ⚠️ SAMPLE ONLY ONCE PER DEVICE. Opening every lens to read a
          // frame costs 300-800ms each, which is a real pause in front of a
          // member. So it runs when we have no remembered choice, and never
          // again — the answer is a property of the handset, not of the
          // session.
          const remembered = readCameraPref();
          const cams = await probeCameras(track, { sample: !remembered });
          const want = matchPref(cams, remembered) ?? bestCamera(cams);
          const onId = track.getSettings?.().deviceId;
          if (want && want.deviceId && want.deviceId !== onId) {
            const better = await navigator.mediaDevices.getUserMedia({
              video: {
                deviceId: { exact: want.deviceId },
                width: { ideal: 4032 },
                height: { ideal: 3024 },
              },
              audio: false,
            });
            if (cancelled) {
              better.getTracks().forEach((t) => t.stop());
              stream.getTracks().forEach((t) => t.stop());
              return;
            }
            // Only now let the old one go — if the switch had failed we would
            // still be holding a working camera rather than none.
            stream.getTracks().forEach((t) => t.stop());
            streamRef.current = better;
            track = better.getVideoTracks()[0];
            stream = better;
          }
          if (want?.label) writeCameraPref(want.label);
          activeCamRef.current =
            cams.find((c) => c.deviceId === track.getSettings?.().deviceId)
              ?.label ?? null;
          setCameras(cams);
        } catch {
          // A phone that will not enumerate, or a lens it will list but not
          // open, must not cost the member their scanner. Stay on whatever
          // facingMode gave us — which is exactly what shipped before.
        }

        // Read back what we were actually given, before touching anything —
        // applyConstraints below can change it, and the honest baseline is
        // what the browser chose when asked for 4K.
        cameraRef.current = readCameraFacts(track, {
          width: 4032,
          height: 3024,
        });
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
        // Start the on-device detector alongside the camera. It loads ~8MB
        // once, cached by the service worker; every failure path inside it
        // ends in status 'unavailable' and the scanner carries on exactly as
        // it did before.
        if (!liveRef.current) {
          liveRef.current = new LiveDetector((st) => {
            liveStatusRef.current = st;
          });
          liveRef.current.start();
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
      liveRef.current?.stop();
      liveRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [say, started]);

  /**
   * Keep the element and the stream married, whatever else re-renders.
   *
   * ⚠️ BELT AND BRACES BEHIND THE MOUNT FIX ABOVE. The video no longer
   * unmounts between shots, so in the ordinary run this does nothing — but
   * the whole defect was that ONE assignment, inside an effect keyed on
   * something else, was the only thing standing between the member and a
   * black screen. Any future change that remounts this element recovers here
   * instead of shipping the same bug again.
   *
   * ⚠️ THE NULL BRANCH IS NOT OPTIONAL. backToChooser stops the tracks and
   * clears streamRef; with the element now permanently mounted, leaving a
   * dead stream attached would leave the chooser sitting behind a frozen last
   * frame of whatever was last in shot.
   */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const stream = streamRef.current;
    if (!stream) {
      if (v.srcObject) v.srcObject = null;
      return;
    }
    if (v.srcObject !== stream) {
      v.srcObject = stream;
      void v.play().catch(() => undefined);
    }
  }, [phase, started]);

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

    // ⚠️ START EACH DOCUMENT BLANK. These refs live on the component, so they
    // survived the trip through review and back: page two of a pack opened
    // with page one's quad still drawn and the aim box still green, over a
    // camera pointed at something else entirely. The member is told we have
    // found their document before they have even put it down — and if they
    // shoot on that cue, the aim box we hand processCapture is the only thing
    // that saves the crop.
    quadRef.current = null;
    lockRef.current = 0;
    confidentRef.current = false;
    aimedRef.current = false;
    aimMissRef.current = 3;
    if (aimShownRef.current) {
      aimShownRef.current = false;
      setAimed(false);
    }

    let raf = 0;
    let timer = 0;
    /** Clock the diagnostic trail is measured from. */
    const startedAt = performance.now();
    let scratch: CanvasRenderingContext2D | null = null;
    let rate = 0;
    let rolling = 0;
    let alive = true;

    /** Every 8th luma of the previous frame, for the motion measure. */
    let prevSample: Uint8Array | null = null;
    /** Whole-frame sample, diagnostic only — nothing gates on it. */
    let prevWide: Uint8Array | null = null;
    /** Coarsened aim box from the previous frame — what the gate compares. */
    let prevCoarse: Uint8Array | null = null;
    let motion = 255;
    let frameMotion = 255;
    /** The pre-coarsening measure, diagnostic only. */
    let rawMotion = 255;
    /** When the phone last started being still, or 0 while it is moving. */
    let steadySince = 0;
    /**
     * Has this device proved too slow to run the detector every frame?
     *
     * Latches once. Only the green corners are lost — the frame measurements
     * that arm the shutter are cheap and carry on. See the note where it is
     * set for what this replaced.
     */
    let detectorOff = false;

    // ⚠️ THE DETECTOR DOES NOT HOLD THE TRIGGER. It turns the aim box green
    // and it supplies nothing else — the crop is the aim box and the fire
    // decision is made from the frame itself (lib/scan/autocapture.ts). That
    // separation is the whole fix for "it never captured": the old gate waited
    // on a detector that, on a real licence card, never sees the card at all.
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
          // ── motion, measured on the IMAGE ─────────────────────────
          //
          // ⚠️ NOT ON THE DETECTED QUAD. Stillness used to be quad drift
          // between consecutive detections — so on a textured carpet, where
          // the detector flip-flops between candidates, the drift spiked every
          // few frames and the clock restarted for ever. The member was
          // perfectly still; the DETECTOR was fidgeting; and the member is the
          // one the clock is supposed to be about. Comparing the sampled
          // pixels of consecutive frames measures the hand and only the hand.
          //
          // ⚠️ AND WITH A UNIFORM BRIGHTNESS SHIFT REMOVED — see motionOf.
          // This was a plain mean of abs(cur - prev), and we never lock
          // exposure or white balance (only focusMode is applied; the other
          // two constraints are unreliable across iOS and Android and locking
          // them risks freezing at a bad exposure). So the phone's AE hunts
          // for the life of the stream, moving every pixel together, and a
          // plain mean cannot tell that from a hand. MOTION_STILL is 4 on a
          // 0-255 scale; a hunt of a few levels pinned the reading above it
          // and 'steady' never cleared.
          // Whole-frame, kept ONLY as a diagnostic so the two readings can be
          // compared in one run. Nothing gates on it.
          const n8 = Math.ceil(gray.data.length / 8);
          const wide = new Uint8Array(n8);
          for (let i = 0, j = 0; i < gray.data.length; i += 8, j++) {
            wide[j] = gray.data[i];
          }
          frameMotion =
            prevWide && prevWide.length === n8 ? motionOf(wide, prevWide) : 255;
          prevWide = wide;

          // ── everything else is asked about the AIM BOX ────────────
          //
          // ⚠️ ONE RECT, THREE READINGS. `ink` was always measured here and
          // glare and luma were measured across the WHOLE camera view, which
          // is the third fault that stopped a phone capturing: GLARE_AT is
          // 0.02 and glare outranks every other exposure check, so two per
          // cent of ANYTHING in view being blown refused the shutter — a
          // window, a lamp, a white wall behind the desk. A phone is held
          // closer and sees more of the room than a laptop webcam, so it
          // tripped on scenery the member was not pointing at, and the hint
          // read "fix the lighting" about light nowhere near the document.
          //
          // Scoping to the box sharpens the check rather than weakening it:
          // the glare that matters is the reflection ON the document, and
          // that is inside the box and still caught.
          //
          // ⚠️ AND THE MAPPING IS PER AXIS — see mapToBuffer. A single
          // width-derived scale was applied to y as well, which is only
          // correct while the buffer and the video's CSS box share an aspect
          // ratio. `scratch` is built once and `elBox` is read live, so on a
          // phone the collapsing address bar drifts them apart within
          // seconds; the y mapping then walked off the buffer, inkiness
          // returned exactly 0, and 'empty' latched for ever.
          const elBox = video.getBoundingClientRect();
          if (elBox.width > 0 && elBox.height > 0) {
            const rect = mapToBuffer(
              aimBox(shape, { width: elBox.width, height: elBox.height }),
              { x: 0, y: 0, width: elBox.width, height: elBox.height },
              gray,
            );
            inkRef.current = inkiness(gray, [...rectQuad(rect)] as Quad);

            // ── the reading the shutter actually gates on ──────────────
            //
            // ⚠️ THE AIM BOX, LIKE EVERY OTHER READING. This was measured over
            // the whole frame while ink, glare and luma were correctly scoped
            // here — so a woven carpet the member was not even pointing at
            // counted, at full weight, as evidence that their hand was moving.
            // On the operator's phone that pinned motion at 22.31 against a
            // limit of 4 and it never once dropped below it in 400 frames.
            // ⚠️ BOX-AVERAGED DOWN BEFORE COMPARING. Scoping to the box was
            // not enough on its own: measured afterwards the boxed figure was
            // 30.92 and the whole frame 30.18 — the same number, so the
            // background was never the difference. The certificate is covered
            // in printed text, which aliases under a 6.75x downscale exactly
            // as the carpet weave does, and asking the canvas for
            // `imageSmoothingQuality: 'high'` changed nothing because WebKit
            // does not honour it the way Chromium does.
            //
            // `coarsen` averages that detail away with our own arithmetic, so
            // what is compared is the gross shape of the scene — which is all
            // "has the phone moved" ever meant.
            const coarse = coarsen(regionGray(gray, rect));
            motion =
              prevCoarse && prevCoarse.length === coarse.data.length
                ? motionOf(coarse.data, prevCoarse)
                : 255; // first frame, or the box resized: treat as moving
            prevCoarse = coarse.data;

            // The previous measure, kept beside it so one run says whether
            // coarsening is what did it. Diagnostic only — nothing gates here.
            const flat = sampleRegion(gray, rect);
            rawMotion =
              prevSample && prevSample.length === flat.length
                ? motionOf(flat, prevSample)
                : 255;
            prevSample = flat;

            // ⚠️ IS THERE ACTUALLY A DOCUMENT HERE? The one question the three
            // gates could never answer — see FrameReading.document. Four 1-D
            // band scans, far cheaper than the detectQuad already running
            // beside it, and unlike inkiness it declines on bare carpet.
            const seen = seededCorners(gray, [...rectQuad(rect)] as Quad);
            docRef.current = seen.corners !== null && seen.confidence >= LIVE_DOC_CONFIDENCE;
            docConfRef.current = seen.confidence;

            const { glare: frac, luma: mean } = regionExposure(gray, rect);
            lumaRef.current = mean;
            // A couple of levels of drift is not news. Re-rendering on every
            // frame would be.
            if (Math.abs(mean - lumaShownRef.current) > 3) {
              lumaShownRef.current = mean;
              setLuma(mean);
            }
            glareRef.current = frac;
            if (Math.abs(frac - glareShownRef.current) > 0.01) {
              glareShownRef.current = frac;
              setGlare(frac);
            }
          }
        }
        // ⚠️ THE MODEL FIRST, THE CLASSICAL DETECTOR ONLY AS FALLBACK.
        //
        // detect() returns null the instant an inference is already running —
        // that is a DROPPED FRAME and it is deliberate. Inference is ~100ms
        // and the camera produces a frame every 33ms; queueing them would make
        // the box lag the scene by however deep the queue got, which is the
        // one thing a tracking box must never do. The smoothing below covers
        // the gaps.
        const visNow = visibleRect(video);
        if (liveRef.current && liveStatusRef.current.state !== 'unavailable') {
          void liveRef.current
            .detect(video, visNow ?? undefined)
            .then((r) => {
              if (r) liveReadingRef.current = r;
            });
        }
        const live = liveReadingRef.current;
        // Fractions of the VISIBLE region, which is the overlay's own space.
        const lw = visNow ? visNow.sw : video.videoWidth;
        const lh = visNow ? visNow.sh : video.videoHeight;
        const modelQuad =
          live && live.minConfidence >= DETECT_ACCEPT && lw > 0 && lh > 0
            ? (live.quad.map((p) => ({ x: p.x * lw, y: p.y * lh })) as Quad)
            : null;
        const found =
          modelQuad !== null
            ? { quad: modelQuad, score: live!.minConfidence, confident: true }
            : gray && !detectorOff
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
      // ── may we shoot? ───────────────────────────────────────────────
      //
      // Three questions about the FRAME, none about the detector: is there a
      // document in the box, can it be read, is it still. See
      // lib/scan/autocapture.ts for why it is three and why they are these.
      const now = performance.now();
      const why = autoBlocker(autoRef.current, {
        document: detectorOff ? undefined : docRef.current,
        ink: inkRef.current,
        motion,
        glare: glareRef.current,
        luma: lumaRef.current,
      });

      // ⚠️ SAY WHICH GATE IS SHUT. When it does not fire, the member sees a
      // camera doing nothing — indistinguishable from a camera that is broken.
      // Two rounds of "auto capture still not working" were spent guessing at
      // this from the outside; the scanner knows the answer every frame and
      // was simply not saying it.
      if (why !== blockerShownRef.current) {
        blockerShownRef.current = why;
        setBlocker(why);
      }

      // ── the witness ─────────────────────────────────────────────────
      //
      // Written here rather than anywhere earlier because this is the only
      // point where all four readings AND the verdict on them exist together
      // — which is exactly what makes the difference between "it does
      // nothing" and "ink never reached 0.1".
      if (diagRef.current) {
        pushFrame(trailRef.current, {
          t: Math.round(now - startedAt),
          ink: inkRef.current,
          motion,
          glare: glareRef.current,
          luma: lumaRef.current,
          blocker: why,
          held: steadySince ? now - steadySince : 0,
          ms: Math.round(rolling),
          frameMotion,
          rawMotion,
          detectorOff,
        });
        const elBoxNow = video.getBoundingClientRect();
        deviceRef.current = deviceContext({
          ua: navigator.userAgent,
          dpr: window.devicePixelRatio || 1,
          video: { w: video.videoWidth, h: video.videoHeight },
          element: { w: elBoxNow.width, h: elBoxNow.height },
          buffer: { w: scratch.canvas.width, h: scratch.canvas.height },
        });
        // Repaint the panel a few times a second, never per frame — and not
        // at all while it is hidden, which is the whole live phase. The panel
        // reads the refs and the trail when it renders, so it opens current
        // without having been kept warm.
        if (editingRef.current && now - diagPaintedRef.current > 300) {
          diagPaintedRef.current = now;
          setDiagTick((n) => n + 1);
        }
      }

      // ⚠️ NOT ARMED YET. See ARM_MS — a phone being carried towards a
      // document is steady, so the gates open long before there is anything
      // framed to photograph.
      const armed = now - startedAt >= ARM_MS;

      if (why === null && armed) {
        if (!steadySince) steadySince = now;
        const held = now - steadySince;
        const pct = holdProgress(held);
        // Only re-render when the ring visibly moves.
        if (Math.abs(pct - holdShownRef.current) > 0.02 || pct === 1) {
          holdShownRef.current = pct;
          setHoldPct(pct);
        }
        if (holdComplete(held) && !capturingRef.current) {
          capturingRef.current = true;
          alive = false;
          holdShownRef.current = 0;
          setHoldPct(0);
          void captureRef.current?.();
          return;
        }
      } else {
        steadySince = 0;
        if (holdShownRef.current !== 0) {
          holdShownRef.current = 0;
          setHoldPct(0);
        }
      }

      const ms = now - t0;
      rolling = rolling * 0.8 + ms * 0.2;
      // ⚠️ A SLOW PHONE DROPS THE DETECTOR, IT NEVER STOPS MEASURING.
      //
      // This read `if (rolling > 90) { alive = false; ...; return; }` — placed
      // above the only line that re-arms the next tick, so once the rolling
      // frame cost crossed 90ms the loop stopped for the rest of the session.
      // autoBlocker is only ever evaluated inside this function, so ink,
      // motion, glare and luma froze and the shutter could never arm again.
      // The overlay went with it. Nothing on screen said so: a camera doing
      // nothing is indistinguishable from a camera that is broken, which is
      // exactly the report that came back from the phone.
      //
      // The right degradation was already implied by this module's own
      // design — "THE DETECTOR DOES NOT HOLD THE TRIGGER". detectQuad is the
      // expensive part and it only draws the green corners; the three
      // measurements that decide the capture are cheap. So a phone that
      // cannot keep up loses the markers and keeps the automatic shutter,
      // rather than losing both.
      if (rolling > 45 && rate < RATES.length - 1) rate++;
      if (rolling > 90 && !detectorOff) {
        detectorOff = true;
        quadRef.current = null;
        setAimed(false);
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
    // ⚠️ AFTER THE GUARD, NOT BEFORE IT. Clearing on the first line would mean
    // a shutter press against a dead stream wipes the only explanation the
    // member has of why the last one failed.
    setErr(null);
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
      // ⚠️ MEASURED FROM THE PHOTOGRAPH, NOT FROM THE ELEMENT — AND THAT IS
      // THE WHOLE FIX.
      //
      // This read `video.getBoundingClientRect()` here, AFTER `setPhase`
      // and AFTER `await grabVisible(...)`. Two separate measurements with a
      // React re-render and an await between them: the raster came from the
      // element's size at grab time, and the fractions were computed from its
      // size some milliseconds later. When the browser's toolbar moved in that
      // gap the two disagreed, and the crop came out at a different aspect
      // from the box the member had aimed into.
      //
      // Measured on the operator's Samsung: the panel reported the aim box at
      // aspect 0.707, exactly A4 — and the file that reached the server was
      // 1646x1969, aspect 0.836. A page framed inside a correct box, cropped
      // to the wrong one, losing about 20mm off each end.
      //
      // `grabVisible` returns the dimensions of the region it actually
      // captured, and `visibleRect` guarantees that region has the element's
      // aspect at that instant. `aimBox` depends only on aspect — it is
      // otherwise proportional — so computing it against the raster gives the
      // same rectangle the member was aiming at, expressed in the photograph's
      // own pixels. The element never enters the mapping, so nothing it does
      // afterwards can distort it.
      const box = aimBox(shape, {
        width: grabbed.width,
        height: grabbed.height,
      });
      // ⚠️ ONE ROUND TRIP, AND IT MAY NOT BLOCK THE SCAN. detectDocument never
      // throws — offline, timeout, a 500, the model missing on the box all
      // arrive here as null, and null simply means the aim box is used, which
      // is what happened before this existed. A member in a gun shop on one
      // bar must still be able to photograph their licence.
      const detected = detect ? await detect(blob) : null;
      // Record WHICH of the four things happened, not just that we fell back.
      detectRef.current = !detect
        ? { outcome: 'not-asked' }
        : detected === null
          ? { outcome: 'no-answer', why: lastDetectFailure ?? 'unknown' }
          : {
              outcome:
                detected.minConfidence >= DETECT_ACCEPT ? 'accepted' : 'declined',
              minConfidence: detected.minConfidence,
              ms: detected.ms ?? 0,
            };
      const res = await processCapture(blob, {
        detected: detected ?? undefined,
        expectAspect: expectAspectFor(shape),
        aimBox:
          grabbed.width > 0 && grabbed.height > 0
            ? {
                x: box.x / grabbed.width,
                y: box.y / grabbed.height,
                width: box.width / grabbed.width,
                height: box.height / grabbed.height,
              }
            : undefined,
      });
      // ⚠️ `source` IS THE SKEW ANSWER, AND IT IS ONLY KNOWABLE HERE. 'aim'
      // means the crop was the aim-box rectangle — and warping a rectangle to
      // a rectangle corrects no perspective at all. The dewarp happens on the
      // SECOND pass, from the corners dragged in the editor. So a capture that
      // comes back skew is a capture whose corners were never moved, and after
      // the fact nothing else records that.
      lastCaptureRef.current = {
        source: res.source,
        glare: res.report.glare,
        sharpness: res.report.sharpness,
        meanLuma: res.report.meanLuma,
        seed: res.seed,
      };
      setShot(res);
      setPhase('review');
      // ⚠️ STRAIGHT INTO THE CORNER EDITOR, not the enhanced preview. The
      // operator's chosen flow: shoot manually, then fix the corners. The
      // editor opens with our best guess already drawn — a good guess is two
      // taps (Apply) from done, a bad one is caught BEFORE the member sees a
      // mangled crop and loses faith in the whole thing.
      setEditing(true);
      say('Check the corners, then apply.');
    } catch (e) {
      setErr((e instanceof Error && e.message) || 'That did not work. Try again.');
      setPhase('live');
    } finally {
      capturingRef.current = false;
    }
  }, [say, shape]);

  // The detect loop fires through this rather than closing over `capture`, so
  // it never has to re-subscribe when the callback is rebuilt — a teardown
  // mid-hold would reset the stillness clock.
  captureRef.current = capture;

  /** Re-run with corners the member dragged. Detection is deliberately skipped. */
  const reprocess = useCallback(
    async (quad: Quad) => {
      const blob = rawBlobRef.current;
      if (!blob) return;
      setErr(null);
      // ⚠️ THE SUCCESS PATH USED TO RUN WHETHER OR NOT IT SUCCEEDED. setPhase,
      // setEditing(false) and "Corners updated." all sat AFTER the try/catch,
      // so a failed re-cut threw the member out of the editor, destroyed the
      // corners they had just spent half a minute placing (CornerEditor holds
      // them in local state and unmounts with them), put the OLD wrong crop
      // back on screen — and told a screen reader it had worked.
      setRecutting(true);
      try {
        const next = await processCapture(blob, { manualQuad: quad });
        setShot(next);
        setEditing(false);
        say('Corners updated.');
      } catch (e) {
        // ⚠️ `instanceof`, NOT `(e as Error).message`. A rejection with null or
        // undefined makes that cast throw INSIDE the catch, which escapes the
        // callback and leaves the scanner wedged with nothing on screen.
        setErr(
          (e instanceof Error && e.message) ||
            'We could not re-cut that. Your corners are still where you put them — try Apply again.',
        );
        // Stay in the editor. The corners are still on screen and still theirs.
      } finally {
        setRecutting(false);
      }
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

  /**
   * The exit the × and Escape actually take.
   *
   * ⚠️ IT ASKS FIRST WHEN THERE IS SOMETHING TO LOSE. Both used to call
   * onClose() straight through. Four pages into a licence pack that destroyed
   * all four, instantly and silently — and those two controls are precisely
   * what somebody reaches for when they think they have done something wrong.
   * The dead-end screens further down this file already carry a "Use the {n}
   * I have" button under a comment reading "A DEAD END MUST NOT EAT WHAT IS
   * ALREADY SCANNED"; the ordinary exits were the ones that did.
   *
   * Nothing captured yet → straight out, as before. No confirmation on an
   * empty scanner: that is a dialog for the sake of one.
   */
  const heldCount = pages.length + (shot ? 1 : 0);
  const requestClose = useCallback(() => {
    if (heldCount > 0) {
      setConfirmExit(true);
      return;
    }
    onClose();
  }, [heldCount, onClose]);

  // Full-screen camera for as long as this component is mounted — the
  // scanner has no closed state of its own, the parent unmounts it.
  useScrollLock(true);

  // Escape closes, in the capture phase so a modal underneath survives.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      // ⚠️ THE INNERMOST LAYER FIRST. CornerEditor has no key handler of its
      // own, so Escape mid-edit used to skip past it and take down the whole
      // session — including the corners being dragged at that moment.
      if (confirmExit) {
        setConfirmExit(false);
        return;
      }
      if (recutting) return;
      if (editing) {
        setEditing(false);
        return;
      }
      requestClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
    };
  }, [requestClose, confirmExit, editing, recutting]);

  // Full-resolution source for the editor's loupe — see `editorSrc`. Created
  // when the editor opens and revoked when it closes, so a six-page pack never
  // holds more than one of these at a time.
  useEffect(() => {
    if (!editing) return;
    const blob = rawBlobRef.current;
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setEditorSrc(url);
    return () => {
      URL.revokeObjectURL(url);
      setEditorSrc(null);
    };
  }, [editing, shot]);

  /**
   * Take focus on open, hand it back on close.
   *
   * ⚠️ SEPARATE EFFECT, EMPTY DEPS. The Escape effect above re-runs whenever
   * the phase changes; moving focus from there would drag it back to the
   * container every time the member took a photo, out of whatever control they
   * were on. This runs once per mount, which is what "on open" means.
   *
   * preventScroll because the container is a fixed full-screen layer — letting
   * the browser scroll to it would shift the page behind it for no reason.
   */
  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      // Only if the trigger is still in the document — a scanner opened from a
      // row that has since re-rendered would otherwise throw focus to nowhere,
      // which sends a screen reader back to the top of the page.
      if (returnTo && document.contains(returnTo)) {
        returnTo.focus({ preventScroll: true });
      }
    };
  }, []);

  const body = (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      // Focusable as a container, not as a stop on the tab route: -1 means
      // focus() can reach it while Tab never lands on it again.
      tabIndex={-1}
      data-blocking-overlay="true"
      // ⚠️ dvh, BECAUSE THIS ONE LIVES INSIDE BROWSER CHROME.
      //
      // `position: fixed; inset: 0` covers the LARGE viewport — the one with
      // the toolbars collapsed. Chrome for iOS shows a bottom toolbar, so the
      // foot of this dialog sat behind it: the corner editor's instruction
      // line was cut off mid-sentence and its Cancel / Reset / Apply row was
      // entirely off-screen. The member could drag the corners and had no way
      // to accept them.
      //
      // This is the exact opposite of what the standalone shell wants, and
      // deliberately so — see the note on .gg-shell in globals.css. Installed,
      // there is no chrome and vh is right; in a browser tab there is, and dvh
      // is the one that tracks it. The class carries a vh fallback for engines
      // without dvh.
      className="gg-scan-root"
      style={{
        position: 'fixed',
        inset: 0,
        // Overrides the class's dvh once we have measured for real.
        ...(viewportH ? { height: viewportH } : null),
        zIndex: Z,
        background: '#000',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        // ⚠️ STOP iOS INFLATING THE TEXT. Safari auto-enlarges text on a page
        // with no viewport lock, and on a real phone it rendered the 15px
        // title at roughly 40px — two lines where one was meant, which is half
        // of why the old bottom-anchored caption collided with the controls.
        // Pinning it to 100% makes every size in here the size it says.
        WebkitTextSizeAdjust: '100%',
      }}
    >
      <Header
        title={title}
        subtitle={subtitle}
        onClose={requestClose}
        // ⚠️ ALWAYS A WAY BACK. Every phase except the chooser itself can
        // return to it, including the two dead ends — a member who lands on
        // "no camera" with two pages already scanned must not be stuck
        // choosing between abandoning them and closing the whole thing.
        // ⚠️ NO BACK ARROW INTO A CHOOSER THE CALLER OPTED OUT OF. With
        // skipChoose the member was never asked what they are holding — the
        // link they tapped already said. Offering "back" to a screen they have
        // never seen invents a step, and lands them on a question with no
        // obvious answer. They still change shape from the chooser if they
        // reach it any other way; they just are not sent there.
        onBack={
          phase === 'choose' || skipChoose ? undefined : backToChooser
        }
        pages={pages.length}
      />

      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        {phase === 'choose' && (
          <Chooser
            shape={shape}
            picked={picked}
            onShape={(s) => {
              setShape(s);
              setPicked(true);
            }}
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

        {/*
          ⚠️ THE VIDEO IS MOUNTED FOR THE LIFE OF THE SCANNER, AND HIDDEN RATHER
          THAN REMOVED. It used to sit inside the phase gate below, which does
          not include `review` — so every single shot destroyed this element,
          and coming back to the camera mounted a brand new empty one.

          The stream is bound to it in exactly ONE place (`srcObject` in the
          camera effect above), and that effect is deliberately keyed on
          `started` rather than `phase` so a six-page pack does not pay for a
          fresh getUserMedia and an autofocus hunt per page. That reasoning is
          right and stays. What was missed is the consequence: the STREAM
          survived review, the ELEMENT did not, and nothing remarried them.

          Operator, 2026-08-25: "When I scan a document and choose next scan
          the screen goes black, I then have to go back and select the size
          document I want to scan and it opens correctly." Both halves are
          explained by that. "Next page" and "Take it again" only set the
          phase, so they landed on a fresh element with no source — black,
          with a live camera light and a shutter that did nothing, because
          capture() early-returns on videoWidth 0. Going back to the chooser
          is the ONLY path that flips `started`, which is the only thing that
          re-runs the effect that assigns srcObject; the shape was never the
          point, the toggle was.

          ⚠️ visibility, NOT display:none. Some mobile browsers pause or drop
          the track on a display:none video, which is the same black frame by
          another route.
        */}
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
            // ⚠️ contain, NOT cover — MATCHING THE CORNER EDITOR.
            //
            // Operator: "that image zoom shit is still there when
            // straightening the edges". Nothing was zooming: the preview was
            // object-fit: cover (fills the screen, crops the edges away) and
            // the editor is object-fit: contain (shows the whole photograph,
            // letterboxed). Same picture, two different windows onto it, so at
            // the moment of transition the document appeared to shrink and the
            // box to jump.
            //
            // contain here costs some screen area and removes the jump
            // entirely — and it removes a subtler trap with it: under cover,
            // part of what the camera captures is off-screen, so a document
            // that looked comfortably inside the frame could have a corner in
            // the cropped-away region. What you aim at is now what you get.
            objectFit: 'contain',
            background: '#000',
            visibility:
              phase === 'starting' || phase === 'live' || phase === 'working'
                ? 'visible'
                : 'hidden',
          }}
        />

        {/* ⚠️ ONLY UNDER ?diag=1, AND AT THE ROOT SO IT OUTLIVES THE SHUTTER.
            This sat inside the live overlay, so it vanished the instant a
            capture happened — and with the hold at 300ms a capture happens
            almost immediately, leaving no moment to photograph it. The
            question it was built to answer is 'why did that come out wrong',
            which is only ever asked once the wrong thing is on screen. It
            carries a hide button and is absent entirely without the flag. */}
            {/* ⚠️ ONLY UNDER ?diag=1. Absent entirely for everybody else —
            this is the scanner explaining itself to whoever is debugging
            it, not a member-facing surface. */}
        {diag && (
          <ScanDiagnostics
            key={diagTick}
            reading={{
              ink: inkRef.current,
              motion:
                trailRef.current[trailRef.current.length - 1]?.motion ?? 255,
              glare: glareRef.current,
              luma: lumaRef.current,
            }}
            held={trailRef.current[trailRef.current.length - 1]?.held ?? 0}
            frameMs={
              trailRef.current[trailRef.current.length - 1]?.ms ?? 0
            }
            frameMotion={
              trailRef.current[trailRef.current.length - 1]?.frameMotion
            }
            rawMotion={
              trailRef.current[trailRef.current.length - 1]?.rawMotion
            }
            shape={shape}
            detectorOff={
              trailRef.current[trailRef.current.length - 1]?.detectorOff ??
              false
            }
            device={deviceRef.current}
            camera={cameraRef.current}
            cameras={cameras}
            activeCamera={activeCamRef.current}
            lastDetect={detectRef.current}
            live={liveStatusRef.current}
            trail={trailRef.current}
            lastCapture={lastCaptureRef.current}
          />
        )}

        {(phase === 'starting' || phase === 'live' || phase === 'working') && (
          <>
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
            {/* ⚠️ GREEN MEANS "I CAN SEE A DOCUMENT", NOT "THE DETECTOR
                LATCHED". It was wired to `aimed` — the live detector's lock —
                and the detector has not held the trigger since auto-capture
                was re-specified around the three frame gates. So the colour
                was reporting on something with no bearing on whether the
                shutter would fire: the operator's Samsung S23 showed red the
                entire time while capturing perfectly, and his iPhone 15 showed
                green, on the same page with the same props.

                This component's own note already argues the case — "a box
                that stays red while they are doing everything right reads as
                'this is not working', and there is nobody to ask".

                Now it follows the gates the shutter actually reads: red only
                for `empty` and `light`, which are the two a member can DO
                something about, and green once the document is in the box and
                readable. Steadiness is not in it, deliberately — that is the
                hold ring's job, and a frame flickering with every tremor would
                be noise rather than signal. */}
            {/* ⚠️ THE AIM BOX STANDS DOWN ONCE THE MODEL HAS A LOCK. Two
                boxes on screen — a fixed rectangle to line up against AND a
                quad following the document — is a contradiction: the member
                cannot satisfy both, and the tracked one is the truthful one.
                It comes back the moment tracking is lost, so a phone where the
                model cannot run behaves exactly as before. */}
            <AimFrame
              hidden={lockRef.current >= 2 && quadRef.current !== null}
              shape={shape}
              locked={blocker === null || blocker === 'steady'}
              alwaysGreen={staticAim}
            />
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
              pointerEvents: 'none',
            }}
          >
            {/* ⚠️ THE HINT FOLLOWS THE CORNERS. Telling somebody to "fill
                the frame" while a box on screen says otherwise is two
                instructions that disagree, and they will follow the picture.
                Once the corners go green the only thing left to say is hold
                still — anything else invites them to keep adjusting. */}
            {/* ⚠️ THE COLOUR WORD FOLLOWS THE BOX. With staticAim the corners
                are green from the start, so "inside the red corners" described
                a box that was never red — the same disagree-with-the-picture
                trap this very comment warns about. */}
            {/* ⚠️ AND EXPOSURE OUTRANKS ALL OF IT. On the manual path — which
                is the DEFAULT, since auto is off — this line only ever asked
                the detector. So a member holding a licence card under a lamp
                got "Glare on the document" pinned across the top of the screen
                and "Got it — take the photo." across the bottom, at the same
                time, about the same frame. They take the photo, because that is
                the one that sounds like an instruction.

                Read from exposureProblem, which is what the alert on screen is
                already saying — see lib/scan/exposure.ts. */}
            {/* Three states now, not eight: fix the light, line it up, take it.
                The branches naming what auto-capture was waiting for went with
                auto-capture — there is nothing left to wait for. */}
            <span
              style={{
                display: 'inline-block',
                padding: '5px 12px',
                borderRadius: 6,
                background: 'rgba(0,0,0,0.70)',
              }}
            >
              {auto
                ? autoHint(blocker, SHAPES[shape].label.toLowerCase())
                : exposureProblem(glare, luma, torchOn)
                  ? 'Fix the lighting above first.'
                  : aimed
                    ? 'Got it — take the photo.'
                    : /* ⚠️ DO NOT NAME THE COLOUR. This read "inside the red
                          corners", which was only ever true while the frame's
                          colour tracked the detector — it now tracks the gates,
                          so by the time somebody reads this sentence the
                          corners may well be green. A caption that describes
                          the screen wrongly is worse than one that describes
                          less of it. */
                      `Put the ${SHAPES[shape].label.toLowerCase()} inside the corners.`}
            </span>
          </p>
        )}
          </>
        )}

        {/* ⚠️ THE PERMISSION PROMPT ARRIVES OVER A BLANK SCREEN. Between
            pressing "Open the camera" and the stream arriving, the member saw a
            black rectangle with four aim corners floating on it and not one
            word — while the browser put a permission dialog on top asking them
            to decide something. Saying what is happening is the difference
            between "it is starting" and "it has broken". */}
        {phase === 'starting' && (
          <div style={overlayCentre}>
            <p style={{ fontSize: 15 }}>Starting the camera…</p>
            <p
              style={{
                fontSize: 13,
                opacity: 0.8,
                maxWidth: 260,
                textAlign: 'center',
              }}
            >
              If your phone asks, allow it to use the camera.
            </p>
          </div>
        )}

        {phase === 'working' && (
          <div style={overlayCentre}>
            <p style={{ fontSize: 15 }}>Straightening it up…</p>
          </div>
        )}

        {(phase === 'denied' || phase === 'nocamera') && (
          <div style={{ ...overlayCentre, padding: 24, textAlign: 'center' }}>
            <p style={{ fontSize: 16, fontWeight: 600 }}>
              {/* ⚠️ "No camera we can use" WAS ALSO WHAT A BUSY CAMERA GOT.
                  Every non-permission failure lands on `nocamera`, and the
                  commonest of them by far is NotReadableError — the lens is
                  held by another app, which is fixable in five seconds if you
                  are told. The old heading said the device had no camera, which
                  is both wrong and unactionable. */}
              {phase === 'denied'
                ? 'The camera is blocked'
                : 'We cannot reach the camera'}
            </p>
            <p style={{ marginTop: 8, fontSize: 14, opacity: 0.85 }}>
              {/* ⚠️ "IN THE ADDRESS BAR" NAMES A CONTROL THE PHONE DOES NOT
                  HAVE. This screen is reached overwhelmingly from a handheld —
                  and in an installed PWA there is no address bar on screen at
                  all. Sending somebody to look for one is sending them to look
                  for nothing, on the screen where they are already stuck. The
                  padlock is the control that actually exists in mobile Safari
                  and Chrome, and "your browser settings" covers the rest
                  without promising a specific button. */}
              {phase === 'denied'
                ? 'Your browser is holding the camera back for this site. You can allow it from the padlock beside the web address, or from your browser settings — or close this and choose a file instead. Either works.'
                : 'Another app may be using the camera, or this browser cannot reach one. Closing the other app and trying again usually does it — or close this and choose a file instead. Everything after that is the same.'}
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
            busy={recutting}
            sourceSrc={editorSrc}
            onEdit={() => setEditing(true)}
            // A cancel mid-recut would unmount the editor and flash the live
            // camera back over the photograph — the very thing A1 removed.
            onCancelEdit={() => {
              if (!recutting) setEditing(false);
            }}
            onQuad={reprocess}
            onRetake={() => {
              setShot(null);
              setEditing(false);
              setErr(null);
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
              setErr(null);
              setPhase('live');
              say('Saved. Ready for the next page.');
            }}
          />
        )}

        {/* ⚠️ THE ONLY SCREEN IN HERE THAT CAN LOSE WORK, SO IT SAYS SO IN
            THE COUNT. "You have 4 photos" is the whole argument — a member who
            genuinely wants out still gets out in one more tap, and a member who
            hit × by mistake keeps their morning. Ordered safest-first: the
            default action under the thumb is the one that changes nothing. */}
        {confirmExit && (
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="You have photos that have not been used yet"
            style={{ ...overlayCentre, background: 'rgba(0,0,0,0.86)', padding: 24 }}
          >
            <p style={{ fontSize: 17, fontWeight: 600, margin: 0, textAlign: 'center' }}>
              {heldCount === 1
                ? 'You have 1 photo'
                : `You have ${heldCount} photos`}
            </p>
            <p
              style={{
                fontSize: 14,
                margin: '6px 0 0',
                textAlign: 'center',
                color: 'rgba(255,255,255,0.75)',
                maxWidth: 300,
              }}
            >
              Closing now throws them away.
            </p>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                marginTop: 20,
                width: '100%',
                maxWidth: 300,
              }}
            >
              <button
                type="button"
                onClick={() => setConfirmExit(false)}
                style={{
                  ...secondaryBtn,
                  background: 'var(--red)',
                  border: 'none',
                }}
              >
                Keep scanning
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmExit(false);
                  finish(shot ? [...pages, shot.file] : pages);
                }}
                style={secondaryBtn}
              >
                {heldCount === 1 ? 'Use the 1 I have' : `Use the ${heldCount} I have`}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmExit(false);
                  onClose();
                }}
                style={{
                  ...secondaryBtn,
                  border: 'none',
                  color: 'rgba(255,255,255,0.6)',
                  fontSize: 14,
                }}
              >
                Throw them away
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ⚠️ ABOVE THE CONTROLS, AND DISMISSIBLE.
          It used to render BELOW the shutter row, so the shutter jumped down
          under the member's thumb the instant an error appeared — at the one
          moment they were about to press it again. And setErr(null) existed in
          exactly one place in the file (backToChooser), so a single transient
          failure stayed pinned through the retry, the review and every page
          after it. A red banner that outlives its problem is how a member
          learns to ignore all of them.

          The × belongs to THIS banner only. ExposureAlert stays
          non-dismissible and clears solely when the frame is good — see its
          own note, and lib/scan/exposure.ts. */}
      {err && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding:
              phase === 'live'
                ? '10px 8px 10px 16px'
                : '10px 8px max(10px, env(safe-area-inset-bottom)) 16px',
            // The brand red at 90%, previously spelled out longhand as
            // rgba(200,16,46,0.9) — the same colour, but nothing tied it to the
            // token, so it read as a third arbitrary red. color-mix rather than
            // bare var(--red), which would silently drop the alpha.
            background: 'color-mix(in srgb, var(--red) 90%, transparent)',
            fontSize: 14,
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>{err}</span>
          <button
            type="button"
            onClick={() => setErr(null)}
            aria-label="Dismiss this message"
            style={{
              width: 44,
              height: 44,
              marginTop: -10,
              flex: '0 0 auto',
              border: 'none',
              background: 'transparent',
              color: '#fff',
              fontSize: 20,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      )}

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
              // ⚠️ SAY SO; DO NOT VANISH. This used to call setHasTorch(false),
              // and the button is rendered under `{hasTorch && ...}` — so the
              // single most common outcome of a platform refusing the torch was
              // the control disappearing from under the member's finger at the
              // exact moment they pressed it. Nothing tells them what happened,
              // and there is no way to try again. Plenty of tracks advertise
              // the capability and refuse the first call but honour a later
              // one, so keeping the button is also the more useful behaviour.
              setTorchOn(false);
              setErr('This phone would not let us turn the light on.');
            }
          }}
          // ⚠️ TAKE THE PHOTO. THAT IS ALL. It must NOT also switch auto off.
          // That rule was tried and it produced a doom loop nobody could
          // describe: auto feels slow, so you press the shutter, which
          // disables auto, so every document after it needs a press, which
          // proves auto never works. Two screen recordings showed corners
          // locked green for eleven seconds with the scanner sitting there,
          // because one manual press early in the session had silently
          // switched it off. The toggle beside the shutter is the only thing
          // that may change it — deliberate, visible and reversible.
          onShutter={() => void capture()}
          auto={auto}
          onAuto={() => setAuto((a) => !a)}
          holdPct={holdPct}
          onDone={pages.length ? () => finish(pages) : undefined}
          pages={pages.length}
        />
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
  // ⚠️ THE WHOLE DOCUMENT, NOT FOUR BRACKETS. This drew corner marks with a
  // 22%-alpha join, which reads as "here are some corners" rather than "I have
  // found your document". Operator, having filmed Scanbot and Adobe Scan:
  // "I want a live box that tracks the whole document like Scanbot and Adobe
  // scan does."
  //
  // Both of those draw a semi-transparent FILLED REGION with a solid stroke,
  // and the fill is what makes it read as one object at a glance — an outline
  // alone still asks the eye to join it up. Verified in his own recordings:
  // Adobe's overlay tints the document's interior, and the boundary is drawn
  // raw rather than as four separate marks.
  const path = () => {
    g.beginPath();
    g.moveTo(q[0].x, q[0].y);
    for (let i = 1; i < 4; i++) g.lineTo(q[i].x, q[i].y);
    g.closePath();
  };

  // The fill goes first so the stroke sits crisply on top of it.
  g.globalAlpha = locked ? 0.18 : 0.1;
  g.fillStyle = MARK;
  path();
  g.fill();

  g.globalAlpha = locked ? 1 : 0.75;
  g.strokeStyle = MARK;
  g.lineWidth = locked ? 3 : 2;
  g.lineJoin = 'round';
  path();
  g.stroke();

  // Corners still get a little weight — they are where the eye checks the fit,
  // and they are what the member will drag in the editor a moment later.
  if (locked) {
    g.lineWidth = 5;
    g.lineCap = 'round';
    const arm = Math.max(
      10,
      Math.min(26, Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y) * 0.12),
    );
    for (let i = 0; i < 4; i++) {
      const c = q[i];
      for (const p of [q[(i + 3) % 4], q[(i + 1) % 4]]) {
        const dx = p.x - c.x;
        const dy = p.y - c.y;
        const len = Math.hypot(dx, dy) || 1;
        const d = Math.min(arm, len * 0.4);
        g.beginPath();
        g.moveTo(c.x, c.y);
        g.lineTo(c.x + (dx / len) * d, c.y + (dy / len) * d);
        g.stroke();
      }
    }
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

// ⚠️ NO marginTop. It used to carry `marginTop: 16`, which is a spacing
// decision belonging to a layout, not to a button — and this one button is
// used in three layouts. In the chooser it doubled with the row's own
// `marginTop: 14` to a 30px gap; in the review row, inside `flexWrap`, it put
// 16px above every button on every wrapped line. Layouts space their own
// children now, with `gap`.
const secondaryBtn: React.CSSProperties = {
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
  picked,
  onShape,
  multi,
  onMulti,
  pages,
  onStart,
  onCancel,
  onUsePages,
}: {
  shape: DocShape;
  /** Has anyone actually answered, or is `shape` just the working default? */
  picked: boolean;
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
          // Nothing reads as chosen until somebody has chosen it — this drives
          // both aria-checked and the red selected border.
          const on = picked && shape === k;
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
                // Keyed to the same token as the border above it. It used to be
                // rgba(224,49,49,0.14) — the AIM FRAME's red, inside a
                // var(--red) border, so the fill and its own outline were two
                // different colours.
                background: on
                  ? 'color-mix(in srgb, var(--red) 14%, transparent)'
                  : 'transparent',
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
  subtitle,
  onClose,
  onBack,
  pages,
}: {
  title: string;
  subtitle?: string;
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
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
          {title}
          {pages > 0 && (
            <span style={{ marginLeft: 8, opacity: 0.7, fontWeight: 400 }}>
              {pages} saved
            </span>
          )}
        </p>
        {subtitle && (
          <p
            style={{
              margin: '3px 0 0',
              fontSize: 12.5,
              lineHeight: 1.35,
              fontWeight: 400,
              color: 'rgba(255,255,255,0.72)',
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
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
        // ⚠️ DELIBERATELY NOT var(--red), AND NOT DRIFT. This alert is
        // composited over a LIVE CAMERA — often a bright document under a lamp,
        // which is exactly the frame it fires on. The brand red is darker and
        // loses its edge against that; this one is brighter and near-opaque so
        // the single warning no algorithm can undo stays readable on the worst
        // possible backdrop. Recorded here because undocumented is how it got
        // mistaken for a fourth stray red.
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

/**
 * The shutter row.
 *
 * ⚠️ THERE IS NO AUTOMATIC CAPTURE. The scanner used to be able to fire by
 * itself once the corners were locked, the light was workable and the phone
 * had been still for 1.1 seconds — with an "Auto ON/OFF" toggle here and a
 * ring around the shutter filling to show a shot coming. All of it is gone, on
 * the operator's instruction: manual capture only.
 *
 * It is not coming back by accident. Three rounds of tuning went into it and
 * it still cost more trust than it saved time — a misfire costs a retake AND
 * the member's confidence that the next one will behave. If it is ever wanted
 * again it should be re-specified from scratch, not revived from git.
 */
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
  /** 0-1 of the way through the hold. */
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
        {/* ⚠️ THE LIGHT MOVED OUT OF HERE, to sit beside the auto toggle —
            operator, 2026-08-30. This slot stays as a spacer so the shutter
            remains centred on the screen rather than sliding left. */}
      </div>

      <div style={{ position: 'relative', width: 72, height: 72 }}>
        {/* The hold ring: fills as the phone holds still, so an automatic
            capture is never a surprise — the member can see it coming and move
            if they did not mean it. */}
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

      <div
        style={{
          width: 104,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 8,
        }}
      >
        {/* ⚠️ THE LIGHT SITS WITH AUTO NOW, not across the shutter from it —
            operator, 2026-08-30. The two are the only settings on this screen
            and they belong together; the left slot is kept as a spacer so the
            shutter stays centred.

            The colours were already chosen for this: the auto chip uses MARK
            and the light uses gold, deliberately different, because two
            neighbouring toggles that read alike are two toggles nobody can
            tell apart at a glance.

            ⚠️ AND IT IS STILL `hasTorch &&`. Torch is a Chrome-on-Android
            capability; iOS Safari does not expose it at all, so on an iPhone
            this simply is not there. That is not a bug to chase — it is the
            platform, and rendering a dead button would be worse. */}
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
              padding: '0 10px',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.3)',
              background: 'transparent',
              color: '#fff',
              fontSize: 13,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              textShadow: '0 1px 3px rgba(0,0,0,0.8)',
            }}
          >
            <span>Light</span>
            <span
              style={{
                fontSize: 11,
                letterSpacing: '0.06em',
                padding: '2px 6px',
                borderRadius: 6,
                textShadow: 'none',
                background: torchOn ? '#e8b53a' : 'transparent',
                color: torchOn ? '#0f0f0f' : '#fff',
                border: torchOn
                  ? '1px solid transparent'
                  : '1px solid rgba(255,255,255,0.55)',
                fontWeight: 600,
              }}
            >
              {torchOn ? 'ON' : 'OFF'}
            </span>
          </button>
        )}
        {/* ⚠️ A NAME AND A STATE, NOT A SENTENCE. "Auto off" reads equally as
            "auto is off" and "tap to turn auto off". The torch button beside
            it gets this right — "Light on" / "Light", never "Light off". The
            ON chip reuses MARK, the same accent as the hold ring, so "auto is
            armed" is one colour wherever it appears; deliberately NOT the gold
            the torch uses, or two neighbouring toggles would read alike. */}
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
            background: 'transparent',
            color: '#fff',
            fontSize: 13,
            // Spacing is the column's `gap` now that the light shares it —
            // a margin here as well would double it.
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            textShadow: '0 1px 3px rgba(0,0,0,0.8)',
          }}
        >
          <span>Auto</span>
          <span
            style={{
              fontSize: 11,
              letterSpacing: '0.06em',
              padding: '2px 6px',
              borderRadius: 6,
              textShadow: 'none',
              background: auto ? MARK : 'transparent',
              color: auto ? '#0f0f0f' : '#fff',
              border: auto ? '1px solid transparent' : '1px solid rgba(255,255,255,0.55)',
              fontWeight: 600,
            }}
          >
            {auto ? 'ON' : 'OFF'}
          </span>
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
  busy,
  sourceSrc,
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
  /** A re-cut is in flight — the editor stays up, its buttons go quiet. */
  busy: boolean;
  /**
   * Full-resolution capture for the editor. Null for the frame or two before
   * the object URL exists, which falls back to the 1200px preview — the same
   * picture at lower resolution, so it reads as sharpening rather than as a
   * flash.
   */
  sourceSrc: string | null;
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
          src={sourceSrc ?? shot.sourcePreview}
          size={shot.sourceSize}
          quad={shot.quad}
          busy={busy}
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
            padding: '0 16px 6px',
            fontSize: 13,
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {/* ⚠️ "IT IS A BIT DARK" AND "THIS MAY BE YOUR DESK, NOT YOUR
              DOCUMENT" ARE NOT THE SAME SENTENCE. They used to render as
              identical grey lines in one unlabelled list, immediately above a
              red button saying "Use it" — and a member in a hurry reads the
              picture, not the small print. A warn now sits on its own tinted
              plate with a rule down the side.

              ⚠️ THE opacity USED TO SIT ON THIS <ul>, so no child could reach
              full opacity from inside it however it was styled. It moved to
              the note rows, which are the only ones that should be quiet. */}
          {notes.map((v) => (
            <li
              key={v.text}
              style={
                v.level === 'warn'
                  ? {
                      background: 'rgba(212,154,58,0.14)',
                      // Constant, not var(--warning): this sits on the viewfinder's black.
                      borderLeft: `3px solid ${OVERLAY_WARNING}`,
                      borderRadius: 6,
                      padding: '8px 10px',
                      color: '#fff',
                      display: 'flex',
                      gap: 8,
                    }
                  : { opacity: 0.9 }
              }
            >
              {v.level === 'warn' && (
                <>
                  {/* A bare glyph announces as "warning sign", which is not a
                      sentence. The word carries it instead. */}
                  <span
                    aria-hidden="true"
                    style={{ color: OVERLAY_WARNING, flex: '0 0 auto' }}
                  >
                    &#9888;
                  </span>
                  <span
                    style={{
                      position: 'absolute',
                      width: 1,
                      height: 1,
                      overflow: 'hidden',
                      clipPath: 'inset(50%)',
                    }}
                  >
                    Warning:
                  </span>
                </>
              )}
              <span>{v.text}</span>
            </li>
          ))}
        </ul>
      )}

      {/* ⚠️ THE PRIMARY ACTION SITS IN ONE PLACE, ALWAYS.
          This was a single `flexWrap` row of five buttons. At 15px with the
          38px chassis that is roughly 680px of buttons into 358px of usable
          width, so it wrapped to THREE lines and the red primary landed alone
          in the bottom-LEFT corner — the furthest point on the screen from a
          right thumb, in a different place on every page of a six-page pack.

          Now: one full-width primary on its own line, everything else in a
          two-column grid beneath it. At 358px each column is 174px, which
          clears the widest label ("Different document"). The primary still
          follows what the member already told us — somebody who said "front
          and back" gets "Next page", never "Use it". */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: '10px 16px max(16px, env(safe-area-inset-bottom))',
        }}
      >
        <button
          type="button"
          onClick={multi ? onAddAnother : onUse}
          style={{
            ...secondaryBtn,
            width: '100%',
            background: 'var(--red)',
            border: 'none',
            fontWeight: 600,
          }}
        >
          {multi ? 'Next page' : 'Use it'}
        </button>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button type="button" onClick={onRetake} style={secondaryBtn}>
            Take it again
          </button>
          <button type="button" onClick={onEdit} style={secondaryBtn}>
            Fix the corners
          </button>
          {multi ? (
            <>
              {/* ⚠️ THE NEXT THING IS OFTEN A DIFFERENT SHAPE. Somebody
                  working through a motivation pack photographs an A4
                  competency certificate, then a licence card, then the page
                  of an ID book. Sending them straight back to the camera with
                  the previous document's aim box means the corners are wrong
                  for everything after the first one. */}
              <button type="button" onClick={onNextDocument} style={secondaryBtn}>
                Different document
              </button>
              <button type="button" onClick={onUse} style={secondaryBtn}>
                That is all
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onAddAnother}
              style={{ ...secondaryBtn, gridColumn: '1 / -1' }}
            >
              Add another
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

