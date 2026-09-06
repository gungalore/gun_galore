'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { DocShape } from '@/lib/scan/shapes';
import type { DocumentScannerProps } from './document-scanner';

// ────────────────────────────────────────────────────────────────────
// THE WAY IN TO THE SCANNER.
//
// Light on purpose: it probes for a usable camera, renders one button, and
// pulls the scanner itself in only when that button is pressed. The detector,
// the warp and the enhancement are a few tens of kilobytes that nobody who
// picks a file from their phone should ever download.
//
// ⚠️ THE FILE PICKER IS NEVER REPLACED, ONLY JOINED. Every reason the camera
// can fail is a reason somebody still needs to upload a document: permission
// refused, an in-app browser that denies getUserMedia silently, an iPhone
// running an older iOS in standalone mode, a desktop with no camera, or a
// member who was sent a PDF by their association. `fallback` is required by
// the type for exactly that reason — there is no configuration of this
// component in which the picker is absent.
// ────────────────────────────────────────────────────────────────────

// ⚠️ TWO SCANNERS, ONE DOOR. NEXT_PUBLIC_SCANNER_V3=1 opens the new scanner
// (components/scan-v3, the ground-up rebuild: finds the document itself, no
// chooser, fires only when the print is in focus). Unset, the site is exactly
// what it was. Both are dynamic imports, so only the chosen one is ever
// downloaded; the flag is inlined at build time.
const SCANNER_V3 = process.env.NEXT_PUBLIC_SCANNER_V3 === '1';
const DocumentScanner = dynamic<DocumentScannerProps>(
  () => (SCANNER_V3 ? import('../scan-v3/document-scanner') : import('./document-scanner')),
  { ssr: false },
);

// The QR is only ever drawn on a desktop, so its library stays out of the
// bundle every phone downloads.
const PhoneHandoffDialog = dynamic(() => import('./phone-handoff-dialog'), {
  ssr: false,
});

export interface ScanButtonProps {
  /**
   * What the member is most likely holding — usually `shapeForKind(kind)`.
   * Sets the starting guide only; they can change it on screen.
   */
  shape?: DocShape;
  /** Start the scanner with "more than one" already ticked. */
  multiDefault?: boolean;
  /**
   * Where a phone-handed-off scan should send its files. Omit to leave the
   * "Use my phone camera" option out entirely.
   *
   * ⚠️ MINTING NEEDS A CLERK SESSION. The link is minted through viewerFetch,
   * so a page reached by an action token instead of a login (the KYC wizard
   * opened from an SMS) must omit this — the mint would 401 and the member
   * would be offered a button that only ever fails. On that phone the camera
   * is right there anyway.
   */
  handoff?: {
    dest: 'licence-centre' | 'motivation' | 'kyc';
    motivationId?: string;
  };
  /** The document kind currently selected, carried to the phone. */
  kind?: string;
  /** Re-read the list after the phone has sent something. */
  onHandoffArrived?: (count: number) => void;
  /** Names the scanner to a screen reader. */
  title: string;
  /**
   * A second line under the title, inside the camera's own header.
   *
   * ⚠️ PLUMBED BECAUSE THE GUIDANCE HAD NOWHERE TO GO. DocumentScanner has
   * carried `subtitle` since the seller-consent flow proved that anything
   * anchored to the bottom of a full-screen camera fights the shutter for that
   * space — but nothing routed through ScanButton could reach it, so a caller
   * with something to say while the lens is open could only say it before.
   * The Document Centre's safe-photograph guidance is exactly that case.
   */
  subtitle?: string;
  /**
   * Open straight into the camera, past the "what are you holding?" chooser.
   * For flows where the caller already knows, and asking again is a question
   * the member has already answered.
   */
  skipChoose?: boolean;
  /** Keep the aim box green throughout instead of red-until-detected. */
  staticAim?: boolean;
  onFiles: (files: File[]) => void | Promise<void>;
  /** The plain picker, rendered beside this and ALONE when there is no camera. */
  fallback: React.ReactNode;
  disabled?: boolean;
  label?: string;
  /**
   * Icons only, no words.
   *
   * For the checklist rows, where the control sits inside the line it acts on
   * — the row's own label already says what is being added, so repeating it
   * on two buttons is the clutter the operator asked to be rid of. The
   * accessible name and the tooltip still carry the full sentence, because a
   * screen reader and a hover both have room for it.
   */
  compact?: boolean;
  /**
   * Skip the trigger: the caller has ALREADY asked what is coming.
   *
   * ⚠️ THIS DOES NOT PICK A SURFACE, AND THAT IS THE ENTIRE POINT OF IT. An
   * earlier attempt at the same thing set `open` from outside, which opened
   * the on-device camera — on a desktop, where this component deliberately
   * offers the webcam to nobody, behind a button reading "Scan with phone".
   * The choice below stays here: the phone hand-off when this is not a
   * handheld, the camera when it is, and neither when neither is available.
   *
   * ⚠️ AND IT HIDES THIS COMPONENT'S OWN CONTROLS WHILE IT WORKS. They would
   * otherwise render for as long as the probe and the dialog's chunk take,
   * then be covered by the overlay — two buttons flashing up in a toolbar and
   * vanishing. They come back only in the case where nothing opened, which is
   * the case where the member genuinely needs them.
   */
  autoStart?: boolean;
  /** Fires when the scanner or the hand-off closes, however it was closed. */
  onClosed?: () => void;
}

export default function ScanButton({
  // ⚠️ NO `= 'any'` DEFAULT. It laundered "the caller did not say" into "the
  // caller said: something else" before DocumentScanner ever saw it, which is
  // what made the chooser open with the vaguest option pre-ticked. Passing
  // undefined straight through lets the scanner tell the two apart.
  shape,
  multiDefault = false,
  handoff,
  kind,
  onHandoffArrived,
  title,
  subtitle,
  skipChoose,
  staticAim,
  onFiles,
  fallback,
  disabled = false,
  label = 'Take a photo',
  compact = false,
  autoStart = false,
  onClosed,
}: ScanButtonProps) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(false);
  /**
   * Opened once, ever — and a ref rather than a dependency.
   *
   * ⚠️ `handheld` and `usable` are resolved asynchronously, so the effect
   * below runs again as they land. Without the latch, a member who opened the
   * hand-off and closed it would have it reopen under them the moment the
   * second probe settled: a dialog that cannot be dismissed.
   */
  const started = useRef(false);
  /**
   * Is this a device somebody actually holds?
   *
   * ⚠️ THE CAMERA PROBE CANNOT ANSWER THIS. enumerateDevices reports a
   * videoinput for a laptop's built-in webcam before any permission is
   * granted, so "a camera exists" has never meant "this is a phone" — and a
   * webcam pointed at a licence card produces a photograph nobody can read,
   * after spending a permission prompt to get it.
   *
   * Both signals are required together: pointer:coarse alone fires on
   * touch-screen laptops, and maxTouchPoints alone fires on anything with a
   * trackpad that reports touch. No user-agent sniffing and no viewport
   * width — an external monitor on a tablet and a narrow desktop window both
   * lie about what they are.
   */
  const [handheld, setHandheld] = useState<boolean | null>(null);
  // null while we do not know yet. Rendering the button and then removing it
  // would be a control vanishing under a thumb.
  const [usable, setUsable] = useState<boolean | null>(null);

  useEffect(() => {
    // A capability probe, not a permission request. enumerateDevices does not
    // prompt; asking for the stream would, and prompting before the member has
    // said they want the camera is how a site loses that permission for good.
    let alive = true;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          if (alive) setUsable(false);
          return;
        }
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (alive) setUsable(devices.some((d) => d.kind === 'videoinput'));
        if (alive) {
          setHandheld(
            window.matchMedia?.('(pointer: coarse)').matches === true &&
              navigator.maxTouchPoints > 0,
          );
        }
      } catch {
        if (alive) setUsable(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const canPhone = handheld === false && !!handoff;
  const canCamera = handheld === true && usable === true;
  /**
   * The probe has answered and NEITHER surface is available: an auto-start
   * that will never start.
   *
   * ⚠️ KEYED ON `usable`, NOT ON `handheld`. The catch path above sets only
   * `usable`, leaving `handheld` null forever — a member whose browser throws
   * on enumerateDevices would otherwise sit in front of a component that
   * renders nothing at all, having hidden the picker to wait for something
   * that is never coming.
   */
  const stalled = autoStart && usable !== null && !canPhone && !canCamera;

  useEffect(() => {
    if (!autoStart || started.current) return;
    if (canPhone) {
      started.current = true;
      setPhone(true);
      return;
    }
    if (canCamera) {
      started.current = true;
      setOpen(true);
    }
  }, [autoStart, canPhone, canCamera]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* On a desktop the phone is the ONLY camera offered. */}
      {!autoStart && handoff && handheld === false && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setPhone(true)}
          aria-label={`Use my phone camera for ${title}`}
          title="Use my phone camera"
          className={
            compact
              ? 'gg-datecell inline-flex h-11 w-11 items-center justify-center rounded border disabled:opacity-50'
              : 'gg-datecell inline-flex min-h-[44px] items-center gap-2 rounded border px-3 py-2 text-sm disabled:opacity-50'
          }
          style={{
            borderColor: 'var(--red)',
            background: 'var(--bg-inset)',
            color: 'var(--text-primary)',
          }}
        >
          <PhoneIcon />
          {!compact && 'Use my phone camera'}
        </button>
      )}

      {/* ⚠️ HANDHELD ONLY. The webcam used to be offered here, demoted, on
          the theory that USB document cameras exist and phones go flat. The
          operator has ruled: a laptop webcam focuses at half a metre and
          cannot resolve a licence serial, so every scan it produces is one
          that has to be taken again. An option that never yields a usable
          document is not a fallback, it is a trap — and the file picker
          beside it is the honest one. */}
      {!autoStart && usable && handheld === true && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          aria-label={`${label} — ${title}`}
          title={label}
          className={
            compact
              ? 'gg-datecell inline-flex h-11 w-11 items-center justify-center rounded border disabled:opacity-50'
              : 'gg-datecell inline-flex min-h-[44px] items-center gap-2 rounded border px-3 py-2 text-sm disabled:opacity-50'
          }
          style={{
            borderColor: 'var(--border)',
            background: 'var(--bg-inset)',
            color: 'var(--text-primary)',
          }}
        >
          <CameraIcon />
          {!compact && label}
        </button>
      )}

      {/* The picker is always here, and always first in the DOM: a member who
          cannot see the screen reaches the path that does not need sight.
          Under `autoStart` it waits until the auto-start is known to have
          failed — see `stalled`; the one thing it must never do is stay
          hidden, which is why that flag reads the probe and not the choice. */}
      {(!autoStart || stalled) && fallback}

      {phone && handoff && (
        <PhoneHandoffDialog
          dest={handoff.dest}
          motivationId={handoff.motivationId}
          kind={kind}
          // ⚠️ THE WHOLE title CHAIN WAS DEAD. The dialog declares the prop and
          // posts it with the mint, and the backend stores it on the token —
          // but no caller ever passed one, so every hand-off ever minted
          // carried `title: undefined`. It costs nothing to send the name of
          // the thing the member is standing at the desk trying to photograph.
          title={title}
          onClose={() => {
            setPhone(false);
            onClosed?.();
          }}
          onArrived={(n) => onHandoffArrived?.(n)}
        />
      )}

      {open && (
        <DocumentScanner
          shape={shape}
          multiDefault={multiDefault}
          title={title}
          subtitle={subtitle}
          skipChoose={skipChoose}
          staticAim={staticAim}
          onDone={onFiles}
          onClose={() => {
            setOpen(false);
            onClosed?.();
          }}
        />
      )}
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8.5A2.5 2.5 0 015.5 6h1.7l1.2-2h7.2l1.2 2h1.7A2.5 2.5 0 0121 8.5v9A2.5 2.5 0 0118.5 20h-13A2.5 2.5 0 013 17.5z" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  );
}
