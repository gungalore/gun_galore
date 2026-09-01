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

import {
  DETAIL_FLOOR_RATIO,
  FOV_SAMPLE,
  type FovSample,
  detailOf,
  rankByFov,
} from './fov';

/** A rear-facing candidate we could scan with. */
export interface CameraOption {
  deviceId: string;
  label: string;
  /**
   * A grey sample of what this lens sees, for the field-of-view comparison.
   *
   * ⚠️ THIS, NOT THE LABEL, IS HOW LENSES ARE RANKED. See fov.ts.
   */
  sample?: FovSample;
  /**
   * A hint from the label, for the diagnostics panel only.
   *
   * ⚠️ NEVER USED TO CHOOSE. iOS names its lenses and Android does not, so a
   * label-driven selector would be two different features wearing one name —
   * and it breaks the day a vendor renames a camera, silently, with nothing
   * erroring. It is displayed and ignored.
   */
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
 * Rank the candidates widest-first, from what they can see.
 *
 * ⚠️ MEASURED, NOT NAMED. The previous version read the label — matching
 * "Back Ultra Wide Camera" on iOS and falling back to Chrome's focusDistance
 * on Android. That was two different mechanisms wearing one feature's name,
 * which breaks the operator's rule that nothing ships for one platform and
 * not the other, and it was hostage to a string: rename a lens and the
 * scanner quietly reverts to the wrong one with nothing to show for it.
 *
 * Field of view is measurable with canvas frame grabs alone, which both
 * platforms have, and the widest lens is the closest-focusing one — that is
 * the physical shortcut the whole approach rests on. See fov.ts.
 *
 * Candidates with no sample keep their enumeration order behind those that
 * have one: an unmeasured lens is not a better guess than the browser's.
 */
export function rankCameras(options: readonly CameraOption[]): CameraOption[] {
  const measured = options.filter((o) => o.sample);
  const rest = options.filter((o) => !o.sample);
  const ranked = rankByFov(
    measured.map((o) => ({ o, sample: o.sample as FovSample })),
  ).map((x) => x.o);
  return [...ranked, ...rest];
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
  return mainCamera(rear) ?? rankCameras(rear)[0] ?? null;
}

/**
 * The rear camera to scan with: the LONGEST FOCAL LENGTH that still resolves.
 *
 * ⚠️ THIS HAS MOVED TWICE AND THE DIRECTION OF TRAVEL IS THE POINT. It began
 * as the WIDEST lens, because on a phone the widest is the closest-focusing —
 * short focal length gives both, which is why macro mode uses the ultra-wide.
 * That physics is sound; it was optimising the wrong property.
 *
 * The ultra-wide is the softest sensor on the phone and carries heavy barrel
 * distortion, which BENDS STRAIGHT LINES. A document scanner's whole job is
 * finding four straight edges and flattening the quad between them, and a
 * perspective transform cannot undo a curve — it assumes the edges were
 * straight to begin with. So it moved to the second-widest, the main camera.
 *
 * ⚠️ NOW IT GOES ALL THE WAY: THE NARROWEST. Distortion falls as focal length
 * rises, so the same argument that ruled out the ultra-wide keeps going past
 * the main. Operator, comparing outputs against Scanbot: "we need a way to
 * find the longest focus camera... seems like they give the best results".
 *
 * Two things make this safe rather than merely longer:
 *
 *   1. The DETAIL FLOOR still applies, and it is doing more work than before.
 *      Budget Androids enumerate 2 MP depth and macro sensors alongside the
 *      real cameras, and those rank perfectly well on field of view while
 *      producing mush. Picking the narrowest without the floor would hand the
 *      scan to a depth sensor on exactly the phones least able to recover.
 *
 *   2. A narrower lens is EASIER to focus for this task, not harder, which is
 *      the opposite of the usual worry about telephotos. The aim box is a
 *      fraction of the frame, so a narrower field means the member stands
 *      FURTHER back to fill it — away from the near-focus limit that made a
 *      card unscannable on the Samsung, not toward it.
 *
 * Returns null when nothing was measured — the caller falls back to the FOV
 * ranking, which falls back to enumeration order.
 */
export function mainCamera(options: readonly CameraOption[]): CameraOption | null {
  const measured = options.filter((o) => o.sample);
  if (measured.length < 2) return null;

  const best = Math.max(...measured.map((o) => detailOf(o.sample as FovSample)));
  // A scene with no structure anywhere scores zero for every lens; there is
  // nothing to choose on and pretending otherwise is how a bad rule looks
  // like a good one. Fall through to the FOV ranking instead.
  if (best <= 0) return null;
  const usable = measured.filter(
    (o) => detailOf(o.sample as FovSample) >= best * DETAIL_FLOOR_RATIO,
  );
  if (!usable.length) return null;

  // rankCameras is widest-first, so the last usable entry is the longest
  // focal length that cleared the detail floor.
  const byWidth = rankCameras(usable);
  return byWidth[byWidth.length - 1] ?? null;
}

/** Where the chosen lens is remembered between sessions. */
/**
 * ⚠️ VERSIONED, AND THE SUFFIX IS LOAD-BEARING. A stored preference outranks
 * the automatic choice — that is the point of storing it — which means
 * changing HOW the automatic choice is made reaches nobody who has ever
 * picked a lens. When selection moved from widest-field to the main camera,
 * every device carrying a saved ultra-wide kept using it, and the change
 * would have looked like it silently did nothing on exactly the phones most
 * likely to be testing it.
 *
 * Bumping the key retires those preferences. Bump it again on any future
 * change to what `bestCamera` means; leave it alone for changes that only
 * affect how a lens is opened.
 *
 * v2 -> v3 when the choice moved from the second-widest to the narrowest
 * usable lens. Without the bump every phone that has ever opened the scanner
 * would have kept its stored main camera and the change would have looked
 * like it did nothing.
 */
export const CAMERA_PREF_KEY = 'gg.scan.camera.v3';

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
//
// ⚠️ SILENT. Each candidate is opened, one frame is read into a canvas, and
// the track is stopped — nothing is ever attached to a visible element. The
// OS privacy indicator still flickers; that is enforced below the browser and
// is not something to hide.
//
// ⚠️ AND IT RUNS AFTER THE GRANT. enumerateDevices() returns empty labels and
// empty deviceIds beforehand, which is why most attempts at this find one
// camera on a phone that has three.
// ────────────────────────────────────────────────────────────────────

/** Read one frame from a live track into a square grey sample. */
async function sampleTrack(stream: MediaStream): Promise<FovSample | null> {
  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.srcObject = stream;
  try {
    await video.play();
    // One frame is enough, but the first is often black while the sensor
    // settles — wait for a couple of paints rather than grabbing immediately.
    await new Promise((r) => setTimeout(r, 250));
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;

    // The CENTRE SQUARE, not the whole frame: two lenses have different
    // aspect ratios, and comparing different shapes would measure the crop
    // rather than the field of view.
    const side = Math.min(w, h);
    const cv = document.createElement('canvas');
    cv.width = FOV_SAMPLE;
    cv.height = FOV_SAMPLE;
    const g = cv.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(video, (w - side) / 2, (h - side) / 2, side, side, 0, 0, FOV_SAMPLE, FOV_SAMPLE);
    const px = g.getImageData(0, 0, FOV_SAMPLE, FOV_SAMPLE).data;
    const data = new Uint8Array(FOV_SAMPLE * FOV_SAMPLE);
    for (let i = 0, j = 0; i < data.length; i++, j += 4) {
      data[i] = (px[j] * 299 + px[j + 1] * 587 + px[j + 2] * 114) / 1000;
    }
    return { data, size: FOV_SAMPLE };
  } catch {
    return null;
  } finally {
    video.srcObject = null;
  }
}

/**
 * List the rear cameras, sampling each so they can be ranked by field of view.
 *
 * `sample` costs roughly 300-800ms per lens, so it belongs behind a one-time
 * step and its result belongs in storage. With it off this returns the
 * candidates unranked, which is exactly today's behaviour.
 */
export async function probeCameras(
  current: MediaStreamTrack | null,
  opts: { sample?: boolean } = {},
): Promise<CameraOption[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  let devices: MediaDeviceInfo[] = [];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch {
    return [];
  }

  const rear: CameraOption[] = devices
    .filter((d) => d.kind === 'videoinput' && isRearLabel(d.label))
    .map((d) => ({
      deviceId: d.deviceId,
      label: d.label,
      kind: kindFromLabel(d.label),
      minFocusM: null,
    }));

  if (!opts.sample || rear.length < 2) return rear;

  // ⚠️ THE LENS ALREADY OPEN IS SAMPLED THROUGH THE STREAM WE ARE HOLDING.
  // Every other candidate costs a getUserMedia — 300-800ms — and since the
  // probe now runs on EVERY start-up rather than once per handset, that is a
  // delay the member waits through each session. Reading the current track
  // instead of closing and reopening it removes one of two or three opens for
  // free, and it is the one most likely to be the answer anyway.
  const onId = current?.getSettings?.().deviceId;
  if (onId) {
    const mine = rear.find((c) => c.deviceId === onId);
    if (mine) {
      try {
        mine.sample = (await sampleTrack(new MediaStream([current!]))) ?? undefined;
      } catch {
        // Fall through and let the loop below open it like any other.
      }
    }
  }

  for (const cam of rear) {
    if (!cam.deviceId || cam.sample) continue;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: cam.deviceId } },
      });
      cam.sample = (await sampleTrack(stream)) ?? undefined;
    } catch {
      // A lens the browser will enumerate but not open is not a candidate we
      // can use. Leave it unsampled and let it rank behind the measured ones —
      // never let one bad camera abort the whole probe.
    } finally {
      // ⚠️ ALWAYS. A leaked probe stream keeps the camera light on and, on
      // some Androids, stops the real stream opening at all.
      stream?.getTracks().forEach((t) => t.stop());
    }
  }
  return rear;
}
