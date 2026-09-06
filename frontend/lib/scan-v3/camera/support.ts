/** What this browser can do, answered up front so the UI never shows a dead button. */
export interface CameraSupport {
  secure: boolean;
  getUserMedia: boolean;
  handheld: boolean;
  ios: boolean;
  /** True when the camera can be used at all (secure + API present). */
  camera: boolean;
}

export function cameraSupport(): CameraSupport {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const secure = typeof window !== 'undefined' ? window.isSecureContext : false;
  const gum = !!nav?.mediaDevices?.getUserMedia;
  const handheld =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(pointer: coarse)').matches === true &&
    (nav?.maxTouchPoints ?? 0) > 0;
  const ua = nav?.userAgent ?? '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints ?? 0) > 1);
  return { secure, getUserMedia: gum, handheld, ios, camera: secure && gum };
}
