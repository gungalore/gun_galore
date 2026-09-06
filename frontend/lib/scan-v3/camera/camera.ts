import { cameraSupport } from './support';
/**
 * Camera access. Asks for the rear camera at the largest size the browser
 * will give (request 4K, read back the truth), and reports which extras the
 * device exposes so the UI only offers what works.
 */
export interface CameraCapabilities {
  torch: boolean;
  zoom: { min: number; max: number } | null;
  focusModes: string[];
}

export interface OpenCamera {
  stream: MediaStream;
  track: MediaStreamTrack;
  width: number;
  height: number;
  capabilities: CameraCapabilities;
  /** Size of the still a capture will produce: the native photo where the photo API exists, else the video frame. */
  stillWidth: number;
  stillHeight: number;
  /**
   * True when stills come from a native photo pipeline (Android's takePhoto)
   * rather than the video frame: the preview then stands for a bigger, sharper
   * photo and is judged more gently.
   */
  photoPipeline: boolean;
  /**
   * The photo size to ask the native pipeline for, in the camera's own
   * orientation: the largest it offers up to `PHOTO_MAX_EDGE`. A phone that
   * offers 50 or 108 megapixels would otherwise hand over a photo that is slow
   * to take and can run the browser out of memory to decode.
   */
  photoSettings: PhotoSettings | null;
  /** Which camera this is, for the diagnostics ("camera2 0, facing back"). */
  label: string;
  /** What the camera self-test found ("camera 2: fixed; camera 0: af"), for the diagnostics. */
  probe: string;
}

export interface PhotoSettings {
  imageWidth: number;
  imageHeight: number;
}

/** Longest edge of a photo worth asking for: 4000 px puts 1000+ px on a card at a third of the frame. */
export const PHOTO_MAX_EDGE = 4096;

interface PhotoRange {
  min?: number;
  max?: number;
  step?: number;
}

/**
 * The photo size to request: the camera's largest, scaled down to
 * `PHOTO_MAX_EDGE` on the long side when it is bigger, on the size steps the
 * camera allows. Null when the camera does not say what it offers.
 */
export function choosePhotoSize(width: PhotoRange | undefined, height: PhotoRange | undefined): PhotoSettings | null {
  const pw = width?.max ?? 0;
  const ph = height?.max ?? 0;
  if (pw <= 0 || ph <= 0) return null;
  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(pw, ph));
  const snap = (v: number, r: PhotoRange | undefined, max: number): number => {
    const min = r?.min ?? 1;
    const step = r?.step && r.step > 0 ? r.step : 1;
    const stepped = min + Math.round((v - min) / step) * step;
    return Math.max(min, Math.min(max, stepped));
  };
  return { imageWidth: snap(pw * scale, width, pw), imageHeight: snap(ph * scale, height, ph) };
}

export type CameraError = 'denied' | 'none' | 'busy' | 'unknown';

/** Anything that yields a camera. The harness injects a simulated one. */
export type CameraOpener = () => Promise<OpenCamera>;

export class CameraOpenError extends Error {
  constructor(public readonly reason: CameraError, message: string) {
    super(message);
  }
}

interface LooseCapabilities {
  torch?: boolean;
  zoom?: { min?: number; max?: number };
  focusMode?: string[];
  facingMode?: string[];
  width?: { max?: number };
  height?: { max?: number };
}

/** A camera that can focus: continuous or on request. A lens that offers only 'manual' (or nothing) is fixed. */
function canFocus(caps: LooseCapabilities): boolean {
  return Array.isArray(caps.focusMode) && caps.focusMode.some((m) => m === 'continuous' || m === 'single-shot');
}

function trackCaps(track: MediaStreamTrack): LooseCapabilities {
  return (typeof track.getCapabilities === 'function' ? track.getCapabilities() : {}) as LooseCapabilities;
}

/** The camera chosen by the self-test, remembered per browser so the test runs once. */
const PICK_KEY = 'aos-scan-camera';
/** Re-run the self-test after this long, in case a browser update changes what a camera offers. */
const PICK_TTL_MS = 14 * 24 * 3600 * 1000;

interface CameraPick {
  deviceId: string;
  label: string;
  focus: boolean;
  /** Which cameras existed when the choice was made. */
  roster: string;
  at: number;
}

function loadPick(roster: string): CameraPick | null {
  try {
    const raw = localStorage.getItem(PICK_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as CameraPick;
    if (p.roster !== roster || Date.now() - p.at > PICK_TTL_MS) return null;
    return p;
  } catch {
    return null;
  }
}

function savePick(p: CameraPick): void {
  try {
    localStorage.setItem(PICK_KEY, JSON.stringify(p));
  } catch {
    /* private mode */
  }
}

/** The number in an Android camera label ("camera2 0, facing back"): 0 is the main lens on nearly every phone. */
function labelIndex(label: string): number {
  const m = /camera2?\s*(\d+)/i.exec(label);
  return m ? Number(m[1]) : 99;
}

type Open = (video: MediaTrackConstraints) => Promise<MediaStream>;

/**
 * Choose the rear camera by testing it. "facingMode: environment" hands over
 * whichever rear camera the phone lists first; on many Samsungs that is the
 * ultra-wide, a fixed-focus lens with no autofocus, sharp at one distance
 * only. The browser only tells us whether a camera can focus once it is
 * open, so the rear cameras are opened in turn, the main lens first (camera
 * 0), until one that focuses is found. The answer is remembered per browser,
 * so the test costs a second or two once, not on every scan.
 */
async function chooseRearCamera(first: MediaStream, size: MediaTrackConstraints, open: Open): Promise<{ stream: MediaStream; probe: string }> {
  const firstTrack = first.getVideoTracks()[0];
  const firstId = firstTrack.getSettings().deviceId ?? '';
  const firstCaps = trackCaps(firstTrack);
  if (!navigator.mediaDevices?.enumerateDevices) return { stream: first, probe: 'no device list' };
  let devices: MediaDeviceInfo[];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch {
    return { stream: first, probe: 'no device list' };
  }
  const rear = devices
    .filter((d) => d.kind === 'videoinput' && d.deviceId)
    .map((d) => {
      const info = d as MediaDeviceInfo & { getCapabilities?: () => LooseCapabilities };
      const caps = typeof info.getCapabilities === 'function' ? info.getCapabilities() : {};
      const facing = caps.facingMode ?? [];
      const front = facing.includes('user') || (!facing.length && /front|user|face/i.test(d.label));
      const back = facing.includes('environment') || /back|rear|environment/i.test(d.label) || d.deviceId === firstId;
      return { d, front, back };
    })
    .filter((c) => c.back && !c.front)
    .map((c) => c.d)
    .sort((a, b) => labelIndex(a.label) - labelIndex(b.label));
  const roster = rear.map((d) => d.deviceId).sort().join('|');
  const describe = (label: string, caps: LooseCapabilities): string => `${label || '?'}: ${canFocus(caps) ? 'af' : 'fixed'}`;

  // The first camera focuses: done, and remembered.
  if (canFocus(firstCaps)) {
    savePick({ deviceId: firstId, label: firstTrack.label, focus: true, roster, at: Date.now() });
    return { stream: first, probe: describe(firstTrack.label, firstCaps) };
  }
  // A remembered answer skips the test.
  const known = loadPick(roster);
  if (known) {
    if (known.deviceId === firstId || !known.focus) return { stream: first, probe: `remembered ${known.label}: ${known.focus ? 'af' : 'fixed'}` };
    for (const t of first.getTracks()) t.stop();
    try {
      const stream = await open({ deviceId: { exact: known.deviceId }, ...size });
      return { stream, probe: `remembered ${known.label}: af` };
    } catch {
      return { stream: await open({ deviceId: { exact: firstId }, ...size }), probe: `remembered ${known.label} would not open` };
    }
  }
  // The test: open each other rear camera small and briefly (a phone opens one
  // camera at a time, so the first is released first), stop at one that focuses.
  const notes = [describe(firstTrack.label, firstCaps)];
  for (const t of first.getTracks()) t.stop();
  for (const d of rear) {
    if (d.deviceId === firstId) continue;
    let probeStream: MediaStream | null = null;
    try {
      probeStream = await open({ deviceId: { exact: d.deviceId }, width: { ideal: 640 }, height: { ideal: 480 } });
      const t = probeStream.getVideoTracks()[0];
      const caps = trackCaps(t);
      notes.push(describe(t.label || d.label, caps));
      const focus = canFocus(caps);
      for (const x of probeStream.getTracks()) x.stop();
      probeStream = null;
      if (focus) {
        savePick({ deviceId: d.deviceId, label: t.label || d.label, focus: true, roster, at: Date.now() });
        const stream = await open({ deviceId: { exact: d.deviceId }, ...size });
        return { stream, probe: notes.join('; ') };
      }
    } catch {
      notes.push(`${d.label || '?'}: would not open`);
      if (probeStream) for (const x of probeStream.getTracks()) x.stop();
    }
  }
  // Nothing focuses: back to the first, and remember not to test again for a while.
  savePick({ deviceId: firstId, label: firstTrack.label, focus: false, roster, at: Date.now() });
  const stream = await open({ deviceId: { exact: firstId }, ...size });
  return { stream, probe: notes.join('; ') };
}

export async function openRearCamera(): Promise<OpenCamera> {
  // On Android Chrome the still comes from the native photo pipeline (12 MP),
  // so the preview only needs 1080p and the live loop runs faster. On iOS every
  // browser is WebKit: ImageCapture exists but its "photo" is just the video
  // frame, so the stream itself must be as large as the phone allows.
  const hasPhotoApi = typeof (globalThis as { ImageCapture?: unknown }).ImageCapture !== 'undefined';
  const wantPreviewOnly = hasPhotoApi && !cameraSupport().ios;
  const size: MediaTrackConstraints = {
    width: { ideal: wantPreviewOnly ? 1920 : 3840 },
    height: { ideal: wantPreviewOnly ? 1080 : 2160 },
  };
  const open: Open = (video) => navigator.mediaDevices.getUserMedia({ audio: false, video });
  let stream: MediaStream;
  let probe = '';
  try {
    // The browser's own choice of rear camera first: this grants permission and
    // reveals the camera list. Then the self-test may move to a better one.
    stream = await open({ facingMode: { ideal: 'environment' }, ...size });
    if (!cameraSupport().ios) {
      const chosen = await chooseRearCamera(stream, size, open);
      stream = chosen.stream;
      probe = chosen.probe;
    }
  } catch (e) {
    const name = (e as DOMException)?.name ?? '';
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new CameraOpenError('denied', 'Camera permission was refused');
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new CameraOpenError('none', 'No rear camera found');
    if (name === 'NotReadableError' || name === 'AbortError') throw new CameraOpenError('busy', 'The camera is in use by another app');
    throw new CameraOpenError('unknown', String((e as Error)?.message ?? e));
  }
  const track = stream.getVideoTracks()[0];
  const settings = track.getSettings();
  const caps = (typeof track.getCapabilities === 'function' ? track.getCapabilities() : {}) as LooseCapabilities;
  // Ask for continuous focus where the browser lets us (Chrome Android).
  if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
    try {
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] });
    } catch {
      /* optional */
    }
  }
  // Where the native photo API exists, ask how big its photos are; the fill
  // rule uses this so a card is not brought closer than it needs to be.
  let stillWidth = settings.width ?? 0;
  let stillHeight = settings.height ?? 0;
  let photoPipeline = false;
  let photoSettings: PhotoSettings | null = null;
  const IC = (globalThis as { ImageCapture?: new (t: MediaStreamTrack) => { getPhotoCapabilities(): Promise<{ imageWidth?: PhotoRange; imageHeight?: PhotoRange }> } }).ImageCapture;
  if (IC && !cameraSupport().ios) {
    try {
      const pc = await new IC(track).getPhotoCapabilities();
      photoSettings = choosePhotoSize(pc.imageWidth, pc.imageHeight);
      if (photoSettings) {
        const pw = photoSettings.imageWidth;
        const ph = photoSettings.imageHeight;
        // Orient like the video (portrait phones report photos landscape).
        const videoPortrait = stillHeight > stillWidth;
        stillWidth = videoPortrait ? Math.min(pw, ph) : Math.max(pw, ph);
        stillHeight = videoPortrait ? Math.max(pw, ph) : Math.min(pw, ph);
        photoPipeline = true;
      }
    } catch {
      /* keep the video size */
    }
  }
  return {
    stream,
    track,
    width: settings.width ?? 0,
    height: settings.height ?? 0,
    stillWidth,
    stillHeight,
    photoPipeline,
    photoSettings,
    label: track.label,
    probe,
    capabilities: {
      torch: caps.torch === true,
      zoom: caps.zoom && typeof caps.zoom.max === 'number' ? { min: caps.zoom.min ?? 1, max: caps.zoom.max } : null,
      focusModes: Array.isArray(caps.focusMode) ? caps.focusMode : [],
    },
  };
}

export async function setTorch(track: MediaStreamTrack, on: boolean): Promise<boolean> {
  try {
    await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}

export function stopCamera(cam: OpenCamera | null): void {
  cam?.stream.getTracks().forEach((t) => t.stop());
}

/**
 * Ask the camera to focus once, on a point of the frame (0..1), the way a
 * tap-to-focus does. Chrome Android exposes this as the 'single-shot' focus
 * mode; a still taken in that mode runs the autofocus before exposing, which
 * continuous mode does not promise. Returns false where it is not available.
 */
export async function focusOnce(track: MediaStreamTrack | null, at?: { x: number; y: number }): Promise<boolean> {
  if (!track || typeof track.getCapabilities !== 'function') return false;
  const caps = track.getCapabilities() as LooseCapabilities & { pointsOfInterest?: unknown };
  if (!Array.isArray(caps.focusMode) || !caps.focusMode.includes('single-shot')) return false;
  const set: Record<string, unknown> = { focusMode: 'single-shot' };
  if (at && caps.pointsOfInterest !== undefined) set.pointsOfInterest = [{ x: Math.min(1, Math.max(0, at.x)), y: Math.min(1, Math.max(0, at.y)) }];
  try {
    await track.applyConstraints({ advanced: [set as MediaTrackConstraintSet] });
    return true;
  } catch {
    try {
      // Some phones refuse the point but take the mode.
      await track.applyConstraints({ advanced: [{ focusMode: 'single-shot' } as MediaTrackConstraintSet] });
      return true;
    } catch {
      return false;
    }
  }
}

/** Back to continuous focus after a still. */
export async function focusContinuous(track: MediaStreamTrack | null): Promise<void> {
  if (!track || typeof track.getCapabilities !== 'function') return;
  const caps = track.getCapabilities() as LooseCapabilities;
  if (!Array.isArray(caps.focusMode) || !caps.focusMode.includes('continuous')) return;
  try {
    await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] });
  } catch {
    /* optional */
  }
}
