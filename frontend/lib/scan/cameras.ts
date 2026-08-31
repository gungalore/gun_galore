// ────────────────────────────────────────────────────────────────────
// Choosing which lens to scan with.
//
// ⚠️ WE HAVE NEVER CHOSEN. The scanner asks getUserMedia for
// `facingMode: { ideal: 'environment' }` and takes whatever the browser
// hands back, which on every multi-lens phone is the main wide camera — the
// one with the WORST minimum focus distance. Operator, on a Samsung S23:
// "seems like I have to hold the phone to close for it to be able to focus".
// He was not holding it wrong. We put him on the wrong lens and never offered
// him another.
//
// The fix is not focus control, which iOS Safari does not have and most
// Androids ignore. It is lens SELECTION, which both platforms support and
// which Scanbot's web SDK exposes as a plain "Cameras" menu. Observed on the
// operator's own two phones:
//
//   iPhone   Front Camera · Back Dual Wide Camera (default) ·
//            Back Ultra Wide Camera · Back Camera
//   Samsung  camera 1, facing front · camera 3, facing front ·
//            camera 2, facing back (default) · camera 0, facing back
//
// So the two platforms need two different strategies, and that asymmetry is
// the whole design of this file:
//
//   iOS      labels are MEANINGFUL. "Back Ultra Wide Camera" says exactly what
//            we want. Match it and stop.
//   Android  labels are USELESS — "camera 0, facing back" tells us nothing.
//            The lens must be identified by capability or by measurement.
//
// ⚠️ AND ORDER MATTERS: enumerateDevices() returns EMPTY labels and empty
// deviceIds until a getUserMedia grant exists. Enumerating first is why most
// attempts at this "find" only one camera. Grant, then enumerate.
// ────────────────────────────────────────────────────────────────────

/** A rear-facing candidate we could scan with. */
export interface CameraOption {
  deviceId: string;
  label: string;
  /** Our guess at the physical lens, from the label alone. */
  kind: 'ultra-wide' | 'wide' | 'telephoto' | 'unknown';
  /**
   * Minimum focus distance in metres, if the browser will say.
   *
   * Chrome-Android exposes `focusDistance` on MediaTrackCapabilities; Safari
   * does not. Where present it is the direct answer — smallest focuses
   * closest — and it beats guessing from a label.
   */
  minFocusM: number | null;
}

/**
 * ⚠️ "ULTRA WIDE", NOT "WIDE". The iPhone's DEFAULT lens is labelled "Back
 * Dual Wide Camera", so a naive /wide/ match selects the very lens we are
 * trying to move away from and looks like it worked. The word that
 * distinguishes them is "ultra".
 */
const ULTRA_WIDE = /ultra[\s-]?wide/i;
const TELEPHOTO = /tele(photo)?/i;
const WIDE = /wide/i;

/** What lens does this label describe, if it describes one at all? */
export function kindFromLabel(label: string): CameraOption['kind'] {
  if (ULTRA_WIDE.test(label)) return 'ultra-wide';
  if (TELEPHOTO.test(label)) return 'telephoto';
  if (WIDE.test(label)) return 'wide';
  return 'unknown';
}

/**
 * Is this a rear camera?
 *
 * Both platforms say so in the label, in their own words — "Back ..." on iOS,
 * "facing back" on Android. A device with no usable label at all is KEPT
 * rather than dropped: an unlabelled rear camera is still a candidate, and
 * dropping it would leave some phone with no options at all.
 */
export function isRearLabel(label: string): boolean {
  if (!label) return true;
  if (/front/i.test(label)) return false;
  return /back|rear|environment/i.test(label) || !/front/i.test(label);
}

/**
 * Rank the candidates, best first.
 *
 * The order of preference, and why:
 *
 *  1. A measured `minFocusM`, smallest first. This is the actual property we
 *     care about — how close the lens will focus — reported by the browser
 *     rather than inferred. Where Chrome gives it, nothing else should argue.
 *  2. A label saying "ultra wide". On iOS this is all we get, and it is
 *     reliable: Apple names the lens.
 *  3. Anything not telephoto. A telephoto's minimum focus distance is the
 *     worst of the set and it is never the right choice for a document at
 *     arm's length.
 *
 * ⚠️ STABLE, NOT CLEVER. Equal candidates keep their enumeration order, so a
 * phone that reports nothing useful behaves exactly as it does today rather
 * than shuffling between sessions. A scanner that picks a different lens each
 * time it opens is worse than one that always picks the wrong lens.
 */
export function rankCameras(options: readonly CameraOption[]): CameraOption[] {
  return [...options]
    .map((o, i) => ({ o, i }))
    .sort((a, b) => {
      const am = a.o.minFocusM;
      const bm = b.o.minFocusM;
      if (am !== null && bm !== null && am !== bm) return am - bm;
      if (am !== null && bm === null) return -1;
      if (am === null && bm !== null) return 1;

      const rank = (k: CameraOption['kind']) =>
        k === 'ultra-wide' ? 0 : k === 'wide' ? 1 : k === 'unknown' ? 2 : 3;
      const r = rank(a.o.kind) - rank(b.o.kind);
      if (r !== 0) return r;

      return a.i - b.i;
    })
    .map((x) => x.o);
}

/**
 * The one we would open, or null when there is nothing to choose between.
 *
 * Returns null for a single candidate ON PURPOSE: with one rear camera there
 * is no choice to make, and asking getUserMedia for it by deviceId is a
 * strictly narrower constraint than facingMode with nothing gained. Let the
 * browser do what it already does.
 */
export function bestCamera(options: readonly CameraOption[]): CameraOption | null {
  const rear = options.filter((o) => isRearLabel(o.label));
  if (rear.length < 2) return null;
  return rankCameras(rear)[0] ?? null;
}

/** Where the chosen lens is remembered between sessions. */
export const CAMERA_PREF_KEY = 'gg.scan.camera';

/**
 * Read the member's remembered lens.
 *
 * ⚠️ KEYED ON THE LABEL, NOT THE deviceId. Chrome rotates deviceIds per
 * origin and per permission grant, so a stored id is routinely stale by the
 * next visit, and asking for a stale id with `exact` throws
 * OverconstrainedError rather than falling back. The label is stable for a
 * given handset and is what we match on return.
 */
export function readCameraPref(): string | null {
  try {
    return localStorage.getItem(CAMERA_PREF_KEY);
  } catch {
    // Private mode, blocked storage, an embedded webview with no DOM storage.
    // A remembered lens is a convenience; losing it must never break scanning.
    return null;
  }
}

export function writeCameraPref(label: string): void {
  try {
    localStorage.setItem(CAMERA_PREF_KEY, label);
  } catch {
    /* see readCameraPref */
  }
}

/** Match a remembered label back to a live device, if it is still there. */
export function matchPref(
  options: readonly CameraOption[],
  pref: string | null,
): CameraOption | null {
  if (!pref) return null;
  return options.find((o) => o.label === pref) ?? null;
}

// ────────────────────────────────────────────────────────────────────
// The runtime probe
// ────────────────────────────────────────────────────────────────────

type CapsWithFocus = MediaTrackCapabilities & {
  focusDistance?: { min?: number; max?: number };
};

function focusMinOf(track: MediaStreamTrack | null | undefined): number | null {
  try {
    const caps = track?.getCapabilities?.() as CapsWithFocus | undefined;
    const m = caps?.focusDistance?.min;
    return typeof m === 'number' && Number.isFinite(m) ? m : null;
  } catch {
    return null;
  }
}

/**
 * List the rear cameras, with a focus distance for any that will report one.
 *
 * ⚠️ CALL THIS ONLY AFTER A getUserMedia GRANT EXISTS. enumerateDevices()
 * returns entries with EMPTY labels and empty deviceIds beforehand — that is
 * the single most common reason an attempt at this appears to find one camera
 * on a phone that has three.
 *
 * `openToProbe` opens each candidate briefly to read its capabilities. That is
 * the only way to get focusDistance for a lens we are not currently on, and it
 * costs roughly 200-700ms per camera, so it belongs behind a one-time
 * "checking your cameras" step and its result belongs in storage. With it off,
 * only the already-open track contributes a real number and the rest are
 * ranked on their labels — which is the right trade on iOS, where labels are
 * meaningful and focusDistance is never exposed anyway.
 */
export async function probeCameras(
  current: MediaStreamTrack | null,
  opts: { openToProbe?: boolean } = {},
): Promise<CameraOption[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  let devices: MediaDeviceInfo[] = [];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch {
    return [];
  }

  const currentId = current?.getSettings?.().deviceId;
  const currentMin = focusMinOf(current);

  const rear = devices
    .filter((d) => d.kind === 'videoinput' && isRearLabel(d.label))
    .map((d) => ({
      deviceId: d.deviceId,
      label: d.label,
      kind: kindFromLabel(d.label),
      minFocusM: d.deviceId && d.deviceId === currentId ? currentMin : null,
    }));

  if (!opts.openToProbe || rear.length < 2) return rear;

  for (const cam of rear) {
    if (cam.minFocusM !== null || !cam.deviceId) continue;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: cam.deviceId } },
      });
      cam.minFocusM = focusMinOf(stream.getVideoTracks()[0]);
    } catch {
      // A lens the browser will enumerate but not open is not a candidate we
      // can use. Leave its focus unknown and let the ranking fall back to the
      // label — never let one bad camera abort the whole probe.
    } finally {
      // ⚠️ ALWAYS. A leaked probe stream keeps the camera light on and, on
      // some Androids, prevents the real stream from opening at all.
      stream?.getTracks().forEach((t) => t.stop());
    }
  }
  return rear;
}
