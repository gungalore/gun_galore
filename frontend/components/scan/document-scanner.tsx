'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  type ScanFilter,
  ScanResult,
  refilter,
  frameToGray,
  grabVisible,
  makeScratch,
  processCapture,
  visibleRect,
} from '@/lib/scan/capture';
import { detectQuad } from '@/lib/scan/detect';
import { Quad } from '@/lib/scan/geometry';
import { av } from '@/lib/asset-version';
import CornerEditor from './corner-editor';
import { type Grade, gradeScan } from '@/lib/scan/quality';
import type { ReportInput } from '@/lib/scan/diagnostic-report';
import AddDocument from './screens/add-document';
import DocumentType from './screens/document-type';
import PagesTray from './screens/pages-tray';
import ReviewScreen from './screens/review-screen';
import SavedScreen from './screens/saved';
import DiagnosticsPanel from './screens/diagnostics-panel';
import { QuadSmoother } from '@/lib/scan/smooth';
import { LIVE_FPS } from '@/lib/scan/docquad-live';
import { rotateResult } from '@/lib/scan/rotate';
import { QuadPresence, scaleAboutCentre } from '@/lib/scan/quad-presence';
import { QuadTracker } from '@/lib/scan/quad-track';
import { implausibleWhy } from '@/lib/scan/quad-plausible';
import {
  DocShape,
  SHAPES,
  acrossMm,
  expectAspect as expectAspectFor,
} from '@/lib/scan/shapes';
import { useScrollLock } from '@/lib/use-scroll-lock';
import { aimAgreement, aimBox } from '@/lib/scan/aim';
import { exposureProblem } from '@/lib/scan/exposure';
import {
  type CameraFacts,
  capDpiFor,
  dpiOf,
  readCameraFacts,
} from '@/lib/scan/framing';
import { DETECT_ACCEPT, lastDetectFailure } from '@/lib/scan/detect-client';
import {
  type Guidance,
  STEADY_MS,
  edgeMargin,
  guidanceFor,
  mayCapture,
  squareness,
  guidanceText,
  occupancy,
} from '@/lib/scan/guidance';
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
import { diagnosticsOn, saveToPhoneOn } from '@/lib/scan/diag-flag';

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
  ) => Promise<{
    quad: Quad;
    minConfidence: number;
    ms?: number;
    /** The model's 64x64 mask plane, when the server returned one. */
    mask?: Float32Array;
  } | null>;
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
  /**
   * @deprecated The aim frame it controlled is gone.
   *
   * ⚠️ KEPT SO CALLERS DO NOT BREAK, AND DOES NOTHING. The redesign replaced
   * the static aim box with the tracked quad — the box said "put it here" and
   * the quad says "it is there", and two contradictory instructions on one
   * screen is the thing the guidance work removed. Passing this is harmless;
   * expecting a frame from it is not.
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
  /**
   * The entry screen: photograph it, or choose a photo already on the phone.
   *
   * ⚠️ THE FIRST SCREEN NOW, AHEAD OF THE CHOOSER. The scanner used to open
   * straight into "what are you photographing?", which assumes the member is
   * about to point a camera at something. Plenty of them already have the
   * picture — taken last week, sent by a dealer, saved from an email — and had
   * no route in at all.
   */
  | 'add'
  | 'choose'
  | 'starting'
  | 'live'
  | 'working'
  | 'review'
  /** Every page taken so far, with a grade on each. */
  | 'pages'
  /** Where it went. */
  | 'saved'
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
  const [phase, setPhase] = useState<Phase>(skipChoose ? 'starting' : 'add');
  /** Shown over everything when the member asks for the numbers. */
  const [showDiag, setShowDiag] = useState(false);
  /** What the member called this document. Empty until they type. */
  const [docName, setDocName] = useState('');
  /** Kept pages, with the grade each one earned. */
  const [tray, setTray] = useState<
    { id: string; file: File; preview: string; grade: Grade; dpi: number | null; note?: string }[]
  >([]);
  /** Quarter turns applied to the current page, 0-3. */
  const [turns, setTurns] = useState(0);
  // ⚠️ STILL NON-NULL. `shape` is dereferenced without a guard in five places
  // (SHAPES[shape].label, SHAPES[shape].multiLabel, aimBox, AimFrame,
  // expectAspectFor), so a null here blows up on the chooser's own first paint.
  // 'a4' is the harmless working value; `picked` is what says whether anyone
  // has actually chosen, and the camera will not open until they have.
  const [shape, setShape] = useState<DocShape>(initialShape ?? 'a4');
  /**
   * Has a shape been chosen — by the member, or by a caller that knows?
   *
   * ⚠️ NOW A GATE, NOT A DECORATION. It used to drive only the tick, because
   * 'Something else' meant an unanswered chooser could still produce a working
   * scan. With that option removed there is no sizeless shape to fall through
   * to, and an unconfirmed guess would silently scan a card as an A4. So the
   * button that opens the camera is disabled until this is true.
   *
   * A caller passing `shape` still counts as an answer — it knows what door
   * the member came through.
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
  /** Survives the tab ending — see saveToPhoneOn. */
  const [canSave, setCanSave] = useState(false);
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
  const camerasRef = useRef<CameraOption[]>([]);
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
  /** What we are telling the member right now, derived from the tracked quad. */
  const guideRef = useRef<Guidance>('point');
  /**
   * Move to the next rear lens and remember it.
   *
   * ⚠️ A DIAGNOSTIC CONTROL, NOT A MEMBER-FACING ONE. The automatic choice
   * ranks by measured field of view and is right on both test phones, but
   * "right by measurement" and "right in the hand" are different claims and
   * only one of them can be checked from here. This is how the operator
   * checks the other.
   *
   * The preference is written before the stream reopens, so the camera effect
   * picks it up on its own terms rather than this reaching into the stream.
   */
  const cycleCamera = useCallback(() => {
    const rear = camerasRef.current;
    if (rear.length < 2) return;
    const at = rear.findIndex((c) => c.label === activeCamRef.current);
    const next = rear[(at + 1) % rear.length];
    if (!next?.label) return;
    writeCameraPref(next.label);
    // Tear the stream down; the effect keyed on `started` rebuilds it and
    // matchPref() will now select the one just written.
    setStarted(false);
    setTimeout(() => setStarted(true), 60);
  }, []);
  /** Live quality, measured off the tracked quad rather than predicted. */
  const qualityRef = useRef<{
    occupancy: number;
    tilt: number;
    dpi: number | null;
    /** How long the phone has been still, so a stuck gate is visible. */
    stillMs: number;
    /** Nearest corner's distance from the frame edge — the cliff check. */
    edgeMargin: number;
  } | null>(null);
  const [guide, setGuide] = useState<Guidance>('point');

  const detectRef = useRef<
    | { outcome: 'accepted' | 'declined'; minConfidence: number; ms: number }
    | { outcome: 'no-answer'; why: string }
    | { outcome: 'not-asked' }
    | null
  >(null);
  /**
   * Which rectangle we are following, and how sure we are of it.
   *
   * ⚠️ THE OVERLAY'S BLINK LIVED HERE, NOT IN THE FILTER. See quad-track.ts —
   * a detection that disagreed with the last one used to teleport the quad and
   * reset the lock to 1, and the outline is only drawn at lock >= 2, so the
   * markers vanished for a whole inference frame every time.
   */
  const trackerRef = useRef(new QuadTracker());
  /** Why the last model quad was thrown away, for the diagnostic report. */
  const rejectedQuadRef = useRef<string | null>(null);
  const lastCaptureRef = useRef<ScanReport['lastCapture']>(undefined);
  /**
   * Bumped on a throttle so the panel repaints without re-rendering per frame.
   * The value is never read — the re-render IS the effect, because the panel
   * rebuilds its text from the refs every time it renders.
   */
  const [, setDiagTick] = useState(0);
  const diagPaintedRef = useRef(0);

  useEffect(() => {
    setDiag(diagnosticsOn(window.location.search));
    setCanSave(saveToPhoneOn(window.location.search));
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
  // A ref copy so applyFilter does not have to be rebuilt on every shot —
  // rebuilding it would re-render Review mid-filter.
  const shotRef = useRef<ScanResult | null>(null);
  shotRef.current = shot;
  /**
   * ⚠️ REPLACED BY `tray`, WHICH CARRIES A GRADE PER PAGE. Kept only as a
   * derived view so the exit confirmation and the header count keep working —
   * they ask "how much work would this throw away", and the answer is now the
   * tray. A stale `pages` array would have answered zero and let the × discard
   * a five-page pack without a word.
   */
  const pages = useMemo(() => tray.map((t) => t.file), [tray]);
  const [editing, setEditing] = useState(false);
  editingRef.current = editing;
  /**
   * ⚠️ THE LIVE TICK MUST FOLLOW THE PANEL, NOT THE EDITOR. This gate used to
   * read editingRef, because the old readout was an overlay drawn on top of
   * the corner editor. The panel is its own screen now, so that condition was
   * asking "is a screen the member is no longer on still open?" — which meant
   * the numbers on the diagnostics screen were frozen at the moment it opened.
   */
  const showDiagRef = useRef(false);
  showDiagRef.current = showDiag;
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
   * Swap the cleanup on the page already taken.
   *
   * ⚠️ RE-DERIVES BOTH THE PREVIEW AND THE FILE. Showing a filtered preview
   * over an unfiltered file would be the worst kind of bug here — the member
   * approves what they see and something else is stored, on a document they
   * may never look at again.
   */
  /**
   * Hand the processed page to the phone, for comparison work.
   *
   * ⚠️ A DIAGNOSTIC, BEHIND THE SAME FLAG AS THE READOUT PANEL. Members do not
   * need this: their documents go to the Document Centre and are read from a
   * computer. It exists because scans upload ENCRYPTED to secure-uploads, so
   * nobody — including us — can get a scan back off a phone to compare against
   * another scanner without decrypting production storage.
   *
   * ⚠️ SHARE FIRST, DOWNLOAD SECOND, AND BOTH BECAUSE OF PARITY. Chrome on
   * Android honours <a download> and drops the file in Downloads. iOS Safari's
   * support is patchy and version-dependent, but its share sheet takes a File
   * and offers Files and Photos. navigator.share is present on both, so it is
   * the path that behaves the same on each; the anchor is the fallback for
   * whichever browser refuses.
   */
  const saveToPhone = useCallback(async () => {
    const cur = shotRef.current;
    if (!cur) return;
    const file = cur.file;
    try {
      const nav = navigator as Navigator & {
        canShare?: (d: { files?: File[] }) => boolean;
        share?: (d: { files?: File[]; title?: string }) => Promise<void>;
      };
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        await nav.share({ files: [file], title: file.name });
        return;
      }
    } catch {
      // A cancelled share sheet throws. That is the member declining, not a
      // failure, and falling through to a download would then save a file
      // they just said no to.
      return;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke late: Safari has been known to abort a download whose blob URL
    // was released in the same tick as the click.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }, []);

  /**
   * Resolution of a finished page, from its output size and known millimetres.
   *
   * One place, because the review badge and the page tray must never disagree
   * about how good the same scan is.
   */
  const shotDpi = useCallback((r: ScanResult, sh: DocShape): number | null => {
    const across = acrossMm(sh);
    if (!across || !r.outputWidth || !r.outputHeight) return null;
    return dpiOf(Math.min(r.outputWidth, r.outputHeight), across);
  }, []);

  /** Put the page on the pile, with the grade it earned. */
  const keepPage = useCallback(() => {
    const cur = shotRef.current;
    if (!cur) return;
    const dpi = shotDpi(cur, shape);
    const g = gradeScan({
      dpi,
      glare: cur.report?.glare,
      luma: cur.report?.meanLuma,
      source: cur.source,
      clipped: cur.clipped,
      measuredRatio: cur.measuredRatio,
      expectedRatio: expectAspectFor(shape),
    });
    setTray((t) => [
      ...t,
      {
        id: `${Date.now()}-${t.length}`,
        file: cur.file,
        preview: cur.preview,
        grade: g.grade,
        dpi,
        note: g.reasons[0],
      },
    ]);
  }, [shape, shotDpi]);

  /**
   * Keep this page and hand everything over.
   *
   * ⚠️ MULTI-PAGE GOES TO THE TRAY, NOT STRAIGHT OUT. A member with more than
   * one page should see what they are about to save — that screen is the whole
   * reason the tray exists. A single page has nothing to review that the
   * review screen has not already shown, so it saves directly.
   */
  const keepAndFinish = useCallback(async () => {
    const cur = shotRef.current;
    if (!cur) return;
    if (multi || tray.length) {
      keepPage();
      setShot(null);
      setPhase('pages');
      return;
    }
    setSavedCount(1);
    await finishRef.current?.([cur.file]);
  }, [multi, tray.length, keepPage]);

  /**
   * Turn the page a quarter turn.
   *
   * ⚠️ RE-ENCODES RATHER THAN SETTING A CSS TRANSFORM. The file is what gets
   * stored and read on a computer later; rotating only the preview would show
   * the member an upright page and save a sideways one, which is the worst
   * possible split between what was approved and what was kept.
   */
  const rotatePage = useCallback(async () => {
    const cur = shotRef.current;
    if (!cur || recutting) return;
    setRecutting(true);
    try {
      const next = (turns + 1) % 4;
      const out = await rotateResult(cur, 90);
      setTurns(next);
      setShot((prev) => (prev ? { ...prev, ...out } : prev));
    } catch {
      setErr('We could not turn that one.');
    } finally {
      setRecutting(false);
    }
  }, [recutting, turns]);

  /**
   * Everything the scanner knows, right now.
   *
   * ⚠️ BUILT ON DEMAND, NEVER HELD IN STATE. Half of this changes ten times a
   * second, and a report assembled when a panel opened describes a moment the
   * member has already moved past. It is cheap to build and expensive to keep
   * fresh, so it is built at the instant it is read.
   */
  const collectReport = useCallback((): ReportInput => {
    const last = trailRef.current[trailRef.current.length - 1];
    const q = qualityRef.current;
    const cur = shotRef.current;
    const track = streamRef.current?.getVideoTracks()[0];
    const st = track?.getSettings?.();
    const caps = track?.getCapabilities?.() as
      | { width?: { max?: number }; height?: { max?: number }; focusMode?: string[]; torch?: boolean }
      | undefined;
    return {
      build: process.env.NEXT_PUBLIC_BUILD_ID,
      shape,
      phase,
      camera: {
        width: st?.width ?? 0,
        height: st?.height ?? 0,
        frameRate: st?.frameRate,
        maxWidth: caps?.width?.max,
        maxHeight: caps?.height?.max,
        focusModes: caps?.focusMode,
        torch: caps?.torch,
        // ⚠️ FALL BACK TO THE LIVE TRACK. camerasRef is filled by the lens
        // probe, which lives inside a catch that deliberately swallows its
        // reason — a phone that will not enumerate must not cost the member
        // their scanner. The cost is that the report then said "rear lenses 0"
        // and named no lens at all, which reads as a fault rather than as a
        // probe that declined. The track always knows what it is running.
        label:
          activeCamRef.current ??
          streamRef.current?.getVideoTracks()[0]?.label ??
          undefined,
        rearCount: camerasRef.current.length || undefined,
        // ⚠️ SAY WHICH LENSES WERE ACTUALLY LOOKED THROUGH. Ranking is by
        // MEASURED field of view, so a lens that would not open in time is not
        // a candidate — it falls behind every sampled one. On a phone where
        // opening a second camera hangs (which wedged Samsung start-up until
        // the probe was given a timeout), everything reads "not measured" and
        // the choice silently falls back to enumeration order. Without this
        // the report would show three lenses and give no hint that none of
        // them were compared.
        lenses: camerasRef.current.length
          ? camerasRef.current.map(
              (c) =>
                `${c.label || 'unnamed'}${c.sample ? '' : '  (not measured — would not open in time)'}`,
            )
          : ['(lens probe did not report — using whatever facingMode gave us)'],
      },
      live: {
        status: liveStatusRef.current.state,
        medianMs:
          liveStatusRef.current.state === 'running'
            ? liveStatusRef.current.medianMs
            : undefined,
        lastConfidence: liveReadingRef.current?.minConfidence,
        minSigma: liveReadingRef.current?.minSigma,
        maskCoverage: liveReadingRef.current?.maskCoverage,
        lock: lockRef.current,
        guide: guideRef.current,
        fpsCap: LIVE_FPS,
        detectorOff: last?.detectorOff,
        rejectedQuad: rejectedQuadRef.current,
      },
      geometry: q
        ? {
            occupancy: q.occupancy,
            edgeMargin: q.edgeMargin,
            tilt: q.tilt,
            dpi: q.dpi,
            savedDpi: capDpiFor(shape),
            stillMs: q.stillMs,
          }
        : undefined,
      frame: last
        ? {
            ink: last.ink,
            motion: last.motion,
            rawMotion: last.rawMotion,
            glare: last.glare,
            luma: last.luma,
            heldMs: last.held,
            blocker: last.blocker ?? null,
          }
        : undefined,
      capture: cur
        ? {
            source: cur.source,
            pickedBy: cur.pickedBy,
            arbitration: cur.arbitration,
            maskFit: cur.maskFit,
            refined: cur.refined,
            seed: cur.seed
              ? { confidence: cur.seed.confidence, hits: cur.seed.hits }
              : undefined,
            sourceEdge: cur.sourceEdge,
            outputWanted: cur.outputWanted,
            outputW: cur.outputWidth,
            outputH: cur.outputHeight,
            snappedTo: cur.snapped,
            edgeMargin: cur.edgeMargin,
            measuredRatio: cur.measuredRatio,
            expectedRatio: expectAspectFor(shape),
            clipped: cur.clipped,
            filter: cur.filter,
            grade: gradeScan({
              dpi: shotDpi(cur, shape),
              glare: cur.report?.glare,
              luma: cur.report?.meanLuma,
              source: cur.source,
              clipped: cur.clipped,
              measuredRatio: cur.measuredRatio,
              expectedRatio: expectAspectFor(shape),
            }).label,
          }
        : undefined,
      env: {
        userAgent: typeof navigator === 'undefined' ? undefined : navigator.userAgent,
        viewport:
          typeof window === 'undefined'
            ? undefined
            : { width: window.innerWidth, height: window.innerHeight },
        dpr: typeof window === 'undefined' ? undefined : window.devicePixelRatio,
        standalone:
          typeof window !== 'undefined' &&
          window.matchMedia?.('(display-mode: standalone)').matches,
        online: typeof navigator === 'undefined' ? undefined : navigator.onLine,
        cores: typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency,
      },
      errors: err ? [err] : undefined,
    };
  }, [shape, phase, err, shotDpi]);

  const applyFilter = useCallback(
    (next: ScanFilter) => {
      const cur = shotRef.current;
      if (!cur || recutting) return;
      setRecutting(true);
      void (async () => {
        try {
          const { file, preview } = await refilter(cur.flat, next, cur.file.name);
          setShot((prev) =>
            prev ? { ...prev, file, preview, filter: next } : prev,
          );
        } catch {
          setErr('We could not change the filter on that one.');
        } finally {
          setRecutting(false);
        }
      })();
    },
    [recutting],
  );
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
          // ⚠️ MEASURED EVERY START-UP, AND THE AUTOMATIC CHOICE IS NEVER
          // REMEMBERED. It used to sample only when there was no stored
          // choice, and then store whatever it picked — so the FIRST launch
          // decided the lens forever. That is fine when the first launch
          // happened to measure well and permanent when it did not: a probe
          // run against a blank wall or in poor light has nothing to rank on,
          // the detail floor throws out the good lens, and the wrong answer is
          // then frozen on that handset with no way to notice.
          //
          // Operator: "the setup just has to change to the lense with the
          // longest focus everytime the app starts up... don't make it sticky
          // so it always calls up the same lense it first detected."
          //
          // ⚠️ IT COSTS 300-800ms PER LENS AND THAT IS THE REAL TRADE. Two or
          // three rear lenses is roughly one to two seconds before the member
          // can aim, spent behind the starting-up screen. Correctness won:
          // a scan taken on the wrong lens is wrong every time, and the delay
          // is once per session.
          //
          // A MANUAL pick is still remembered — that is a deliberate override
          // from the diagnostics panel, not something we detected, and it is
          // the escape hatch if the ranking is wrong on some handset.
          const cams = await probeCameras(track, { sample: true });
          const want = matchPref(cams, readCameraPref()) ?? bestCamera(cams);
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
          // ⚠️ NOTHING IS WRITTEN HERE. See above — persisting the automatic
          // choice is exactly what froze the first detection.
          activeCamRef.current =
            cams.find((c) => c.deviceId === track.getSettings?.().deviceId)
              ?.label ?? null;
          camerasRef.current = cams;
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
    trackerRef.current.reset();
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
     * The same, for the GUIDANCE — deliberately a separate clock.
     *
     * ⚠️ NOT steadySince. That one starts only once the autocapture gates
     * (ink, light, glare) have all passed, so it answers "how long has this
     * been capturable". Guidance needs "how long has the phone been still",
     * which is true earlier and for different reasons — a member holding
     * steady over a badly lit document is still holding steady, and telling
     * them to hold still while they already are is the instruction working.
     */
    let stillSince = 0;
    /**
     * Has this device proved too slow to run the detector every frame?
     *
     * Latches once. Only the green corners are lost — the frame measurements
     * that arm the shutter are cheap and carry on. See the note where it is
     * set for what this replaced.
     */
    let detectorOff = false;
    /**
     * Smooths the DRAWN quad. See smooth.ts.
     *
     * ⚠️ THE DISPLAY COPY ONLY. quadRef stays the raw detection, because that
     * is what crops the document and what every gate reads. This exists so the
     * preview stops twitching, and a crop is not a preview.
     */
    const smoother = new QuadSmoother();
    /**
     * Whether the box is on screen, and how solidly.
     *
     * ⚠️ ONE DROPPED INFERENCE MUST NOT BLINK IT. Misses at ~10Hz are routine —
     * a hand across the page, a moment of blur, a frame the model declines —
     * and hiding on the first turns a working tracker into a strobe.
     */
    const presence = new QuadPresence();
    let lastDrawAt = 0;

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
        const modelRaw =
          live && live.minConfidence >= DETECT_ACCEPT && lw > 0 && lh > 0
            ? (live.quad.map((p) => ({ x: p.x * lw, y: p.y * lh })) as Quad)
            : null;
        // ⚠️ THE MODEL'S QUAD IS CHECKED FOR BEING A RECTANGLE AT ALL, WHICH IT
        // NEVER WAS. Its four corners come from four INDEPENDENT heatmap
        // planes, so nothing ties them to each other, and measured over 30 real
        // fixtures 3 of them were not the shape of a photographed rectangle —
        // corners at 32° and 45°, one off the frame. Confidence cannot see it:
        // that 45° case scored 0.546, four corners individually plausible and
        // mutually impossible.
        //
        // A rejected quad falls through to exactly what happens when the model
        // finds nothing: the classical detector gets the frame, and IT rejects
        // its own output on the same two tests. So the fallback is a validated
        // second opinion rather than a blank, and if that finds nothing either
        // the tracker decays the lock and keeps drawing the last good quad —
        // we have lost this frame, not the document.
        const modelWhy = modelRaw ? implausibleWhy(modelRaw, lw, lh) : null;
        if (modelWhy) rejectedQuadRef.current = modelWhy;
        const modelQuad = modelWhy ? null : modelRaw;
        const found =
          modelQuad !== null
            ? { quad: modelQuad, score: live!.minConfidence, confident: true }
            : gray && !detectorOff
              ? detectQuad(gray, { expectAspect: expectAspectFor(shape) })
              : null;
        if (found) {
          // ⚠️ TWO DETECTORS, TWO COORDINATE SPACES, AND ONLY ONE NEEDS
          // SCALING. detectQuad answers in the DETECTION BUFFER's pixels
          // (~320 across), so its quad is multiplied up to visible-frame
          // pixels here. The model already answers in visible-frame
          // fractions — multiplied by vis.sw/sh a few lines above — so
          // scaling it again multiplies it by roughly 9.5 and puts every
          // corner far off screen.
          //
          // That is exactly what happened: the panel read "on-device
          // tracking · 111ms median" on one phone and 163ms on the other,
          // the model was genuinely running and genuinely finding the
          // document, and NO QUAD EVER APPEARED because it was being drawn
          // several thousand pixels outside the canvas.
          const vis = visibleRect(video);
          const k = (vis ? vis.sw : video.videoWidth) / scratch.canvas.width;
          const scaled =
            modelQuad !== null
              ? found.quad
              : (found.quad.map((p) => ({
                  x: p.x * k,
                  y: p.y * k,
                })) as Quad);
          // ⚠️ CONSISTENCY BEFORE CONFIDENCE. The first version counted ANY
          // detection towards the lock — so when successive frames found two
          // DIFFERENT rectangles (the card, then the table edge, then the
          // card again), the lock still climbed and the EMA dragged the
          // markers back and forth between them. That was the jitter the
          // operator saw. Now only a detection that AGREES with the current
          // quad — within 8% of the frame — counts; a different rectangle
          // starts over, snapped rather than glided to, because gliding
          // across the frame between two candidates IS the jitter.
          const tracked = trackerRef.current.push(scaled, video.videoWidth);
          quadRef.current = tracked.quad;
          lockRef.current = tracked.lock;
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
          const missed = trackerRef.current.push(null, video.videoWidth);
          quadRef.current = missed.quad;
          lockRef.current = missed.lock;
          if (lockRef.current === 0) {
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
        if (showDiagRef.current && now - diagPaintedRef.current > 300) {
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
        // ⚠️ THE GUIDANCE HAS A VETO. Without this the shutter fires on the
        // old ink/light/motion gates alone, which know nothing about how big
        // the document is — the operator got an auto-capture with the
        // certificate a fifth of the frame away while the screen was still
        // saying "Move closer". Saying it and then firing anyway is worse
        // than not saying it.
        if (
          holdComplete(held) &&
          !capturingRef.current &&
          mayCapture(guideRef.current)
        ) {
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
      // ⚠️ THE ON-DEVICE DETECTOR IS NOT JUDGED BY THIS CLOCK, AND WAS BEING
      // KILLED BY IT. `rolling` is an EMA of the frame function's own cost,
      // and it was calibrated when that function did classical detection and
      // nothing else. It now also letterboxes a frame and reads it back for
      // the model, so a HEALTHY tracker sits right around this threshold —
      // the operator's iPhone reported "95ms/frame · DETECTOR DROPPED (slow
      // device)" on the same frame as "live conf 0.973 · model accepted at
      // 0.965 · 94ms". The phone turned off a detector that was working, and
      // it did so BECAUSE it was working, because running it is what made the
      // loop cost 95ms. A gate that fires on the cost of success is not a
      // health check.
      //
      // LiveDetector already judges this properly and on the right quantity:
      // a rolling median of actual INFERENCE time against LIVE_TOO_SLOW_MS
      // (500), needing three strikes. The iPhone's 94ms is nowhere near it.
      // So while the live detector says it is running, its verdict governs
      // and this one abstains.
      //
      // And it no longer latches. The original was permanent because a device
      // that cannot keep up will not suddenly be able to — true of hardware,
      // false of a transient (a backgrounded tab, a thermal dip, another app
      // waking up), and a permanent kill on a transient is unrecoverable
      // without reopening the camera.
      const liveHealthy = liveStatusRef.current.state === 'running';
      if (rolling > 90 && !liveHealthy) {
        if (!detectorOff) {
          detectorOff = true;
          quadRef.current = null;
          setAimed(false);
        }
      } else if (detectorOff && (liveHealthy || rolling < 60)) {
        // Hysteresis on the way back, so a loop hovering at the threshold
        // does not flicker the markers on and off.
        detectorOff = false;
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
          // ⚠️ ADVANCED EVERY DRAWN FRAME, NOT ONLY ON DETECTION. That is the
          // whole trick: inference lands ~10 times a second and the display
          // refreshes 60, so drawing the raw quad shows the same rectangle for
          // five frames then jumps. Feeding the smoother the same target on
          // every frame lets it keep converging, which turns ten steps a
          // second into continuous motion. Scanbot's box looks better than
          // ours did with, as far as anyone can tell from the outside, a
          // comparable detection rate.
          const drawNow = performance.now();
          const dt = lastDrawAt ? (drawNow - lastDrawAt) / 1000 : 1 / 60;
          lastDrawAt = drawNow;
          const shownQuad =
            q && cv.width > 0
              ? smoother.push(q, dt)
              : (smoother.reset(), null);
          // Drawn only once TWO consecutive detections have agreed. A single
          // unconfirmed candidate stays invisible — honest "still looking"
          // beats markers that flicker somewhere wrong for one frame.
          // ⚠️ THE GUIDANCE COMES FROM THE QUAD NOW, NOT FROM A BOX.
          // The aim box was the instruction and the member did the measuring.
          // The detector finds the document itself, so we measure the thing we
          // actually cared about — how much of the frame it fills — and say the
          // one sentence that follows. Under 65% move closer, over 85% move
          // further, in between hold still.
          {
            const vr = visibleRect(video);
            const kx = vr ? cv.width / vr.sw : 1;
            const ky = vr ? cv.height / vr.sh : 1;
            // Its own clock read: draw() is the rAF loop and `now` belongs to
            // detectOnce, a different closure — reaching for it would read a
            // timestamp from whichever detection happened to be last.
            const tNow = performance.now();
            // ⚠️ READ THE MEASUREMENT, NEVER THE DIAGNOSTIC TRAIL. `motion` is
            // maintained by detectOnce every cycle. trailRef is a MIRROR of it
            // written under `if (diagRef.current)` — that is, only while the
            // diagnostics panel is open.
            //
            // Guidance used to read the mirror, and the consequence was as bad
            // as it sounds: with the panel closed the trail is empty, the
            // `?? 255` fallback fires on every frame, the phone is never
            // "still", and the shutter can NEVER fire. Every member outside
            // this room had a scanner that tracked the document perfectly and
            // then simply refused to take the picture.
            //
            // It hid because the failure was silent while `still` was an
            // instantaneous reading — a false `still` just meant 'steady', and
            // 'steady' was never on screen long enough to notice. Giving
            // stillness a clock turned it into a permanent "Hold still", which
            // is how it finally got reported. A feature that only works while
            // it is being watched is the exact shape of bug the diagnostics
            // panel exists to prevent, so it must not be the thing the product
            // depends on.
            const motionNow = motion;
            if (motionNow <= MOTION_STILL) {
              if (!stillSince) stillSince = tNow;
            } else {
              stillSince = 0;
            }
            const stillMs = stillSince ? tNow - stillSince : 0;
            // ⚠️ ONE SCALED QUAD, USED BY BOTH. occupancy and edgeMargin must
            // agree about which space they are in or they describe different
            // documents — the exact class of bug that has cost the most time
            // in this file.
            const canvasQuad =
              q && lockRef.current >= 2 && cv.width > 0
                ? (q.map((p) => ({ x: p.x * kx, y: p.y * ky })) as Quad)
                : null;
            const occ = canvasQuad
              ? occupancy(canvasQuad, cv.width, cv.height)
              : null;
            const edge = canvasQuad
              ? edgeMargin(canvasQuad, cv.width, cv.height)
              : 0;
            // ⚠️ MEASURED BEFORE THE GATE, BECAUSE THE GATE NEEDS IT. dpi is
            // computed below for the readout either way; the floor check
            // wants the same number, so it is worked out once here rather
            // than twice from two slightly different quads.
            const acrossNow = acrossMm(shape);
            const dpiNow =
              q && acrossNow && cv.width > 0
                ? dpiOf(
                    Math.max(
                      Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y),
                      Math.hypot(q[2].x - q[3].x, q[2].y - q[3].y),
                    ),
                    acrossNow,
                  )
                : null;
            const next = guidanceFor({
              occupancy: occ,
              locked: lockRef.current >= 2,
              // A DURATION. See STEADY_MS — an instantaneous reading made
              // 'steady' last one frame and the member never saw it.
              still: stillMs >= STEADY_MS,
              dpi: dpiNow,
              edgeMargin: edge,
              // Any consistent space works for the angles — they are ratios of
              // edge directions, not absolute positions — so the visible-frame
              // quad is fine as-is.
              quad: q ?? undefined,
            });
            // ⚠️ THE QUALITY NUMBERS, MEASURED OFF THE QUAD ITSELF. Not
            // predicted from a working distance or assumed from a box —
            // dpiOf takes the document's KNOWN millimetres against its
            // measured pixel span, so this is the real resolution on the real
            // lens at the real distance. It is the number that decides
            // whether a serial number will be readable.
            // ⚠️ THE SAME dpiNow THE GATE USED, NOT A SECOND MEASUREMENT.
            // Two derivations of one number drift the moment either is
            // touched, and a readout that disagrees with the gate deciding
            // the capture is worse than no readout — it is the panel lying
            // about why the shutter did or did not fire.
            //
            // ⚠️ AND IT IS MEASURED IN SOURCE PIXELS, NEVER DISPLAY PIXELS.
            // The quad arrives in visible-frame source space, which is what
            // the capture crops from and therefore what lands in the file.
            // Scaling by kx first would answer in on-screen CSS pixels —
            // roughly an eighth as many — and report a 300 dpi scan as 40.
            const q0 = q;
            qualityRef.current =
              q0 && occ !== null
                ? {
                    occupancy: occ,
                    tilt: squareness(q0),
                    dpi: dpiNow,
                    stillMs,
                    edgeMargin: edge,
                  }
                : null;
            if (next !== guideRef.current) {
              guideRef.current = next;
              setGuide(next);
            }
          }
          // ⚠️ STEPPED EVERY DRAWN FRAME, whether or not there is a quad —
          // the fades are animations and need the display's clock, and the
          // grace window only counts down on frames that actually happened.
          // `show`, not `vis` — visibleRect already owns that name below.
          const show = presence.step(
            !!shownQuad && lockRef.current >= 2,
            dt * 1000,
          );
          if (shownQuad && show.opacity > 0) {
            // ⚠️ THE SMOOTHED QUAD IS DRAWN; THE RAW ONE DECIDES. Everything
            // above this line — occupancy, edge margin, dpi, tilt — reads the
            // raw detection, because a gate must judge what was actually seen.
            // Only the pixels on screen come from the filter.
            //
            // The quad is already in VISIBLE-frame pixels, and the canvas
            // covers exactly that region — so this is one uniform scale, not
            // a cover transform. That is the whole point of visibleRect.
            const vis = visibleRect(video);
            const k = vis ? cv.width / vis.sw : 1;
            const onScreen = shownQuad.map((p) => ({
              x: p.x * k,
              y: p.y * k,
            })) as Quad;
            // The entrance settles INWARD onto the document; growing outward
            // reads as the detector still searching.
            const entering =
              show.scale !== 1
                ? (scaleAboutCentre(onScreen, show.scale) as Quad)
                : onScreen;
            g.save();
            g.globalAlpha = show.opacity;
            drawCorners(g, entering, lockRef.current >= 3);
            // ⚠️ ON THE SMOOTHED QUAD, so the arrow travels with the box
            // rather than snapping between the two. An indicator that
            // disagrees with the outline it sits on reads as two overlays.
            drawGuidance(
              g,
              entering,
              guideRef.current,
              lockRef.current >= 3 ? TRACK : SEEKING,
            );
            g.restore();
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
        // The mask rung. Absent on an older server, in which case the ladder
        // behaves exactly as it did before.
        mask: detected?.mask,
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
      // ⚠️ STRAIGHT TO REVIEW NOW, NOT INTO THE CORNER EDITOR. Opening the
      // editor on every shot predates the detector being trustworthy, and it
      // had a consequence nobody intended: tapping Apply without touching
      // anything re-ran the capture with the editor's starting quad as a
      // MANUAL one. Every scan was then recorded as "crop from manual", so a
      // diagnostic report said the member had dragged corners they had never
      // touched — which is exactly how a clipped detection got mistaken for a
      // bad drag.
      //
      // Corners is a choice on the review screen. A good crop costs no taps; a
      // bad one costs the same two it always did.
      say('Check it over.');
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
        const next = await processCapture(blob, {
          manualQuad: quad,
          // ⚠️ THE KNOWN ASPECT APPLIES TO A DRAGGED QUAD TOO. Without this
          // the corner editor silently fell back to the old snap heuristic —
          // the report read "aspect snap: A-series page" instead of "known" —
          // so every manually cropped document lost the proportions fix and
          // got whatever its four dragged corners happened to imply.
          expectAspect: expectAspectFor(shape),
        });
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
  /** How many pages the last save actually wrote, for the Saved screen. */
  const [savedCount, setSavedCount] = useState(0);
  /**
   * finish(), reachable from helpers defined above it.
   *
   * ⚠️ A REF, NOT A REORDER. finish depends on half the component's state and
   * moving it would drag its dependencies with it; a ref keeps the declaration
   * order intact and costs one indirection.
   */
  const finishRef = useRef<((files: File[]) => void | Promise<void>) | null>(null);

  /**
   * Run pictures the member already had through the same pipeline.
   *
   * ⚠️ THE SAME processCapture AS THE CAMERA, DELIBERATELY. A photograph from
   * the gallery needs the identical straightening, aspect correction and
   * quality check — it is not a lesser input, it is the same input arriving by
   * a different door. Giving it its own shortcut path is how two code paths
   * start disagreeing about what a good scan is.
   *
   * ⚠️ NO AIM BOX, THOUGH. There was no viewfinder, so there is no box the
   * member lined anything up against, and passing one would seed the corner
   * search from a rectangle that means nothing here.
   */
  const importFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setPhase('working');
      setErr(null);
      const added: typeof tray = [];
      for (const f of files) {
        try {
          const res = await processCapture(f, {
            expectAspect: expectAspectFor(shape),
            name: f.name || `scan-${added.length + 1}.jpg`,
          });
          // dpi from the output size against known millimetres — a gallery
          // page never had a tracked quad to measure off.
          const across = acrossMm(shape);
          const dpi = across
            ? dpiOf(Math.min(res.outputWidth, res.outputHeight), across)
            : null;
          const g = gradeScan({
            dpi,
            glare: res.report?.glare,
            luma: res.report?.meanLuma,
            source: res.source,
          });
          added.push({
            id: `${Date.now()}-${added.length}`,
            file: res.file,
            preview: res.preview,
            grade: g.grade,
            dpi,
            note: g.reasons[0],
          });
        } catch {
          // One bad picture must not lose the rest of the batch.
          setErr('One of those pictures could not be straightened.');
        }
      }
      if (!added.length) {
        setPhase('add');
        return;
      }
      setTray((t) => [...t, ...added]);
      setPhase('pages');
      say(`${added.length} added.`);
    },
    [say, shape],
  );


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
      // The camera is done with either way — holding it open behind a
      // confirmation screen keeps the indicator lit for no reason.
      streamRef.current?.getTracks().forEach((t) => t.stop());
      // Deliberately not awaited: the parent owns this now, including its
      // errors, which it is far better placed to show than a closing modal.
      void onDone(extra);
      // ⚠️ THE SCANNER NO LONGER CLOSES ITSELF HERE. It used to call onClose()
      // on the same tick, so a member photographed a statutory document, the
      // sheet vanished, and nothing ever confirmed that anything had been
      // kept. On a document they may not open again for a year, "did that
      // work?" is not a question to leave them holding.
      //
      // The Saved screen calls onClose when they are ready. Callers still get
      // onDone at exactly the same moment they always did.
      setSavedCount(extra.length);
      setPhase('saved');
    },
    [onDone],
  );
  finishRef.current = finish;


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
          // ⚠️ THE NEW SCREENS CARRY THEIR OWN BACK. add, choose, pages and
          // saved are full screens with their own headers and their own way
          // out; a second arrow in the shared chrome would sit above their
          // own and take a different route.
          phase === 'add' ||
          phase === 'choose' ||
          phase === 'pages' ||
          phase === 'saved' ||
          skipChoose
            ? undefined
            : backToChooser
        }
        pages={pages.length}
      />

      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        {phase === 'add' && (
          <AddDocument
            onCamera={() => setPhase('choose')}
            onFiles={(files) => void importFiles(files)}
            onClose={requestClose}
            existing={tray.length}
            onUseExisting={tray.length ? () => setPhase('pages') : undefined}
          />
        )}

        {phase === 'choose' && (
          <DocumentType
            shape={shape}
            picked={picked}
            onShape={(sel) => {
              setShape(sel);
              setPicked(true);
            }}
            multi={multi}
            onMulti={setMulti}
            onStart={() => {
              setPhase('starting');
              setStarted(true);
            }}
            onBack={() => setPhase('add')}
          />
        )}

        {phase === 'pages' && (
          <PagesTray
            pages={tray.map((t) => ({
              id: t.id,
              preview: t.preview,
              grade: t.grade,
              dpi: t.dpi,
              note: t.note,
            }))}
            onAdd={() => {
              setShot(null);
              setEditing(false);
              setErr(null);
              setPhase(started ? 'live' : 'add');
            }}
            onRetake={(id) => {
              setTray((t) => t.filter((x) => x.id !== id));
              setShot(null);
              setEditing(false);
              setPhase(started ? 'live' : 'add');
            }}
            onRemove={(id) => {
              setTray((t) => {
                const next = t.filter((x) => x.id !== id);
                if (!next.length) setPhase('add');
                return next;
              });
            }}
            onSave={() => void finish(tray.map((t) => t.file))}
            onBack={() => setPhase(started ? 'live' : 'add')}
          />
        )}

        {phase === 'saved' && (
          <SavedScreen
            count={savedCount}
            name={docName.trim() || undefined}
            onAnother={() => {
              setTray([]);
              setShot(null);
              setDocName('');
              setPicked(initialShape !== undefined);
              setPhase('add');
            }}
            onDone={onClose}
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
            // ⚠️ cover, AND IT MUST STAY cover. visibleRect() in capture.ts
            // is COVER MATHS — `Math.max(cw/vw, ch/vh)` — and the entire
            // coordinate chain runs through it: the detection buffer, the
            // tracked quad, the occupancy the guidance is derived from, and
            // grabVisible's crop at capture.
            //
            // This was briefly switched to `contain` to kill the jump into the
            // corner editor. It killed the scanner instead: on a 393x456
            // element showing a 3024x4032 frame, cover maths under a contain
            // layout reports the visible region as 3024x3508 when all 4032
            // rows are on screen. Thirteen per cent out vertically, with a
            // bogus offset, silently, everywhere — the guidance read "move
            // closer" at a document filling the frame and the live quad was
            // drawn where nobody could see it.
            //
            // The transition jump is real and worth fixing. It is cosmetic,
            // and it is not worth fixing HERE. Fix it in the editor, or teach
            // visibleRect both fits and pass it the mode.
            objectFit: 'cover',
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
        {/* ⚠️ THE OLD READOUT IS GONE, NOT HIDDEN. It rendered its
            own collapsed `diag` chip, so with the new panel there were TWO on
            screen — one of them sitting on top of the back arrow. Its job is
            done by screens/diagnostics-panel.tsx, which is a full screen
            rather than an overlay across the corners the member is dragging. */}

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
              {/* ⚠️ THE TRACKED QUAD SPEAKS FIRST. Once the detector holds a
                  document, what the member needs to hear is derived from it —
                  how much of the frame it fills — not from the exposure gates,
                  which are about a box that no longer exists. The gate hints
                  stay underneath for the case where nothing is found at all. */}
              {guide !== 'point'
                ? guidanceText(guide, SHAPES[shape].label.toLowerCase())
                : auto
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
          <div style={{ ...overlayCentre, gap: 18 }}>
            {/* ⚠️ THE MARK, NOT THE FULL LOCKUP. /logo.svg is the horizontal
                wordmark and it would run edge to edge on a phone held
                portrait; the mark is square and reads at any size.

                ⚠️ AND logo-mark.svg, NOT logo-mark-dark.svg. The suffix names
                the INK, not the ground it goes on: -dark is the #111111 ink
                for LIGHT surfaces, and the plain file is the #F5F5F5 ink for
                dark ones. This overlay is black on every device, so the dark
                variant rendered as an invisible monogram with a floating red
                road where the logo should be. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={av('/logo-mark.svg')}
              alt=""
              aria-hidden="true"
              width={64}
              height={64}
              style={{ opacity: 0.95 }}
            />
            <p style={{ fontSize: 15, margin: 0 }}>Processing…</p>
            {/* An indeterminate bar, because we genuinely cannot say how far
                along it is — rectifying is one synchronous step. A fake
                percentage would be a lie the member could time. */}
            <div
              aria-hidden="true"
              style={{
                width: 132,
                height: 3,
                borderRadius: 2,
                overflow: 'hidden',
                background: 'rgba(255,255,255,0.18)',
              }}
            >
              <div
                style={{
                  width: '40%',
                  height: '100%',
                  borderRadius: 2,
                  background: '#fff',
                  animation: 'gg-scan-sweep 1.1s ease-in-out infinite',
                }}
              />
            </div>
            <style>{`@keyframes gg-scan-sweep{0%{transform:translateX(-100%)}100%{transform:translateX(330%)}}
@media (prefers-reduced-motion:reduce){@keyframes gg-scan-sweep{0%,100%{transform:none;opacity:.5}}}`}</style>
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

        {phase === 'review' && shot && !editing && (
          <ReviewScreen
            preview={shot.preview}
            quality={gradeScan({
              dpi: shotDpi(shot, shape),
              glare: shot.report?.glare,
              luma: shot.report?.meanLuma,
              source: shot.source,
              clipped: shot.clipped,
              measuredRatio: shot.measuredRatio,
              expectedRatio: expectAspectFor(shape),
            })}
            name={docName}
            onName={setDocName}
            filter={shot.filter ?? 'shadow'}
            onFilter={applyFilter}
            busy={recutting}
            pageCount={tray.length + 1}
            onDiscard={() => {
              setShot(null);
              setErr(null);
              setPhase(tray.length ? 'pages' : started ? 'live' : 'add');
            }}
            onSave={() => void keepAndFinish()}
            onAddPage={() => {
              keepPage();
              setShot(null);
              setEditing(false);
              setErr(null);
              setPhase('live');
              say('Saved. Ready for the next page.');
            }}
            onCorners={() => setEditing(true)}
            onRotate={() => void rotatePage()}
            onRetake={() => {
              setShot(null);
              setEditing(false);
              setErr(null);
              setPhase('live');
              say('Ready for another go.');
            }}
            onSaveToPhone={canSave ? saveToPhone : undefined}
          />
        )}

        {phase === 'review' && shot && editing && (
          <div style={{ position: 'absolute', inset: 0, background: '#000' }}>
            <CornerEditor
              src={editorSrc ?? shot.sourcePreview}
              size={shot.sourceSize}
              quad={shot.quad}
              busy={recutting}
              onCancel={() => {
                if (!recutting) setEditing(false);
              }}
              onApply={reprocess}
            />
          </div>
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

      {showDiag && (
        <DiagnosticsPanel
          report={collectReport()}
          onCopyLive={collectReport}
          onClose={() => setShowDiag(false)}
          lenses={cameras.map((c) => c.label || 'unnamed')}
          onCycleLens={cameras.length > 1 ? cycleCamera : undefined}
        />
      )}

      {/* ⚠️ THE WAY IN IS SMALL AND ALWAYS THERE. It used to be a panel that
          covered the viewfinder; now it is a chip that opens a screen. A
          diagnostic tool nobody can reach when something goes wrong is not a
          tool. */}
      {diag && !showDiag && (
        <button
          type="button"
          onClick={() => setShowDiag(true)}
          style={{
            position: 'absolute',
            left: 10,
            top: 'max(10px, env(safe-area-inset-top))',
            zIndex: 55,
            minHeight: 32,
            padding: '0 10px',
            borderRadius: 6,
            border: '1px solid rgba(244,241,237,0.4)',
            background: 'rgba(0,0,0,0.55)',
            color: '#F4F1ED',
            fontSize: 11,
            fontFamily: 'ui-monospace, monospace',
            cursor: 'pointer',
          }}
        >
          diag
        </button>
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

/**
 * The live tracked quad.
 *
 * ⚠️ GREEN, NOT THE EDITOR'S BLUE. Two different quads appear in this flow —
 * this one tracks live and is the detector's opinion, and the corner editor's
 * is the crop the member is about to commit to. Sharing a colour made them
 * indistinguishable in a screenshot and, worse, in the hand.
 */
const TRACK = '#3ddc84';

/**
 * Found, but not yet worth firing on.
 *
 * ⚠️ A HUE CHANGE, NOT AN ALPHA CHANGE. This used to be one green at two
 * opacities, which is almost invisible over a live camera — the background
 * moves, so the eye has no fixed reference to judge 10% against 18%. Scanbot
 * draws its quad YELLOW while tracking and GREEN when it is about to capture,
 * and in the operator's own screenshots the two states are unmistakable at a
 * glance, from across the room, in a photograph of a phone.
 *
 * It also carries the whole instruction wordlessly. Scanbot shows no "Move
 * closer", no "Hold still", no aim box — the colour IS the guidance, and it
 * needs no translation.
 */
const SEEKING = '#f5c518';

/**
 * The instruction, drawn ON the document rather than under it.
 *
 * ⚠️ THE OPERATOR DREW THIS, AND THE DRAWING FIXES A REAL PROBLEM. Guidance
 * lived in a caption below the viewfinder, which asks the member to look away
 * from the thing they are aiming at, read a sentence, translate it into a
 * movement, and look back. Putting "MOVE CLOSER" inside the quad and a TILT
 * arrow on the edge that is wrong means the instruction is already where the
 * eye is, and the arrow says which edge without naming it.
 *
 * ⚠️ THE ARROW SITS ON THE SHORT EDGE AND POINTS OUTWARD, which is the reading
 * that needs no explanation: push this edge out. It is also correct.
 * Perspective shrinks whatever is furthest away, so the SHORT edge is the far
 * one; levelling the phone towards it brings it closer and lengthens it. The
 * arrow and the physics agree, which is why no words are needed.
 */
function drawGuidance(
  g: CanvasRenderingContext2D,
  q: Quad,
  guide: Guidance,
  ink: string,
): void {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  const span = Math.min(
    Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y),
    Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y),
  );

  g.save();
  g.globalAlpha = 1;
  g.fillStyle = ink;
  g.strokeStyle = ink;
  // A dark halo, because the document underneath is usually white paper and
  // green-on-white at this size is unreadable in daylight.
  g.shadowColor = 'rgba(0,0,0,0.85)';
  g.shadowBlur = 6;

  // ⚠️ TWO WORDS, AND NOTHING ELSE. This drew a TILT arrow on whichever edge
  // was furthest away, with the word TILT beside it. The reasoning was sound —
  // an arrow on the wrong edge says which edge without naming it — and it
  // still had to go, because the instruction it belonged to has gone: tilt and
  // distance competed for the same moment and alternated frame to frame, so
  // neither could be acted on. Operator: "lets lose the arrows and tilt text.
  // just keep the move closer and further."
  //
  // Tilt is still MEASURED — squareness() feeds the diagnostic readout and the
  // capture still rectifies whatever angle the page was held at. Only the
  // instruction is gone.
  if (guide !== 'closer' && guide !== 'further') {
    g.restore();
    return;
  }
  const size = Math.max(13, Math.min(26, span * 0.075));
  g.font = `700 ${size}px system-ui, -apple-system, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(guide === 'closer' ? 'MOVE CLOSER' : 'MOVE FURTHER', cx, cy);
  g.restore();
}

function drawCorners(g: CanvasRenderingContext2D, q: Quad, locked: boolean) {
  const ink = locked ? TRACK : SEEKING;
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
  g.globalAlpha = locked ? 0.18 : 0.12;
  g.fillStyle = ink;
  path();
  g.fill();

  g.globalAlpha = 1;
  g.strokeStyle = ink;
  // ⚠️ THICK ON PURPOSE. A 2px line advertises every sub-pixel wobble the
  // filter did not remove; a 5px one simply does not have the resolution to
  // show it. Scanbot's overlay measures ~5px opaque stroke with no fill, and
  // that choice is doing as much work as their filtering is.
  g.lineWidth = locked ? 5 : 4;
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
        {/* ⚠️ FILLED, NOT AN 18%-ALPHA RING. Operator: "make the scan button
            live again". It was never disabled — onShutter has always called
            capture() with no guidance veto on it — but a near-transparent
            outline over a dark camera view reads as a disabled control, and a
            control that looks dead is dead: nobody presses it to find out.
            Every phone camera in existence draws this as a solid white disc,
            so this is also the shape the member already knows.

            The veto belongs on AUTOMATIC capture only, and that is where it
            is. A member pressing the shutter has looked at the screen and
            decided; overruling them would be telling somebody holding their
            own document that we know better. */}
        <button
          type="button"
          onClick={onShutter}
          aria-label="Take the photo"
          style={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            border: '3px solid rgba(255,255,255,0.9)',
            background: '#fff',
            boxShadow: 'inset 0 0 0 3px #000',
            cursor: 'pointer',
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
        {/* ⚠️ A MODE, NOT A TOGGLE — operator asked for "a manual/auto mode".
            The toggle said "Auto ON"/"Auto OFF", which names one option and
            leaves the member to infer the other; several rounds of testing
            went by with somebody unsure whether the scanner was waiting for
            them or they were waiting for it. Two labelled segments, one lit,
            answers "what is it doing right now" without being tapped.

            Both segments are always live — this changes what the SCANNER does
            on its own, never whether the shutter works. Auto still fires only
            through the guidance gate; Manual simply stops it firing at all and
            leaves the disc as the only trigger.

            The lit segment reuses MARK, the same accent as the hold ring, so
            "armed" is one colour wherever it appears — deliberately not the
            gold the torch uses, or two neighbouring controls read alike. */}
        <div
          role="radiogroup"
          aria-label="When to take the photo"
          style={{
            display: 'inline-flex',
            minHeight: 44,
            borderRadius: 8,
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.3)',
          }}
        >
          {([false, true] as const).map((wantAuto) => {
            const on = auto === wantAuto;
            return (
              <button
                key={String(wantAuto)}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  if (auto !== wantAuto) onAuto();
                }}
                style={{
                  padding: '0 10px',
                  border: 'none',
                  background: on ? 'var(--mark)' : 'transparent',
                  color: on ? '#0f0f0f' : '#fff',
                  fontSize: 12,
                  fontWeight: on ? 700 : 500,
                  letterSpacing: '0.02em',
                  textShadow: on ? 'none' : '0 1px 3px rgba(0,0,0,0.8)',
                  cursor: 'pointer',
                }}
              >
                {wantAuto ? 'Auto' : 'Manual'}
              </button>
            );
          })}
        </div>
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


