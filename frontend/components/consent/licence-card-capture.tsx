'use client';

import { useCallback, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { advanceCapture, type CardSide } from '@/lib/scan/two-side-capture';
import type { DocumentScannerProps } from '../scan/document-scanner';

// ────────────────────────────────────────────────────────────────────
// PHOTOGRAPHING BOTH SIDES OF A FIREARM LICENCE.
//
// Operator, 2026-08-23: "the aim box that the license needs to fit in, keep it
// static green. User must just point, fit in the box and shoot, then align the
// corners, preview and do it for the rear as well."
//
// ⚠️ THIS IS A WRAPPER, NOT A CAMERA. DocumentScanner already does every hard
// part — live preview, the aim frame, corner dragging with a magnifier,
// perspective warp, exposure handling, and a 2000px q0.95 JPEG out the far
// end. Writing a second camera for this flow would have meant a second set of
// iOS permission quirks to get wrong. All this adds is: run it twice, keep the
// two results apart, and start reading the FRONT while the back is still being
// taken.
//
// ⚠️ THE ORDER IS LOAD-BEARING. Front first, because the front is the only
// side with anything to read — the back carries a barcode, a card number, a
// signature and a fingerprint, and no printed field the consent needs. Firing
// the front's OCR the moment it exists means the read happens during the ten
// to twenty seconds the seller spends framing, shooting and checking the back,
// so the form they arrive at is already filled in. Awaiting it instead would
// put a spinner in front of a stranger for no reason.
// ────────────────────────────────────────────────────────────────────

/**
 * ⚠️ THE SAME DOOR THE LICENCE CENTRE USES, NOT A HARD-WIRED V2.
 *
 * This imported `../scan/document-scanner` by path, so the seller got the OLD
 * scanner however `NEXT_PUBLIC_SCANNER_V3` was set — and it is set to 1 in
 * production. The flag was only ever read by `scan/scan-button.tsx` and
 * `/scan/handoff`, which is how one surface can be on the rebuilt detector
 * while another quietly is not. Operator, 2026-09-08: "why cant we use the same
 * scanner that the license centre uses, that one is far better than this."
 *
 * ⚠️ THE SWITCH IS COPIED, NOT IMPORTED, and that is forced: `dynamic()` needs
 * a literal `import()` per branch for the bundler to split it, so a shared
 * helper returning a promise would defeat the code-splitting the two scanners
 * exist behind. Keep this expression identical to scan-button.tsx's.
 *
 * ⚠️ components/scan-v3 IS A VENDORED COPY — see CLAUDE.md. Import it, never
 * edit it here; the next sync silently reverts anything changed in place.
 */
const SCANNER_V3 = process.env.NEXT_PUBLIC_SCANNER_V3 === '1';
const DocumentScanner = dynamic<DocumentScannerProps>(
  () =>
    SCANNER_V3
      ? import('../scan-v3/document-scanner')
      : import('../scan/document-scanner'),
  { ssr: false },
);

// Re-exported from the pure transition module so there is one definition, not
// two that can drift.
export type { CardSide };

export interface LicenceCardCaptureProps {
  /**
   * Called as soon as a side is captured — the FRONT fires before the back
   * exists. The consent page uses this to start the OCR early; it must not
   * block, and it must not throw.
   */
  onSide: (side: CardSide, file: File) => void;
  /** Both sides done. */
  onDone: (files: { front: File; back: File }) => void;
  onClose: () => void;
}

/** What each pass says on screen. */
const COPY: Record<CardSide, { title: string; lead: string }> = {
  front: {
    title: 'Photograph the FRONT of your licence',
    lead: 'Two pictures in all — this side first, then the back. The side with your photograph, the make and the serial numbers. Fit the card inside the green corners, then take the picture.',
  },
  back: {
    title: 'Now the BACK',
    lead: 'The second and last picture. The side with the barcode and your signature — same again, fit it inside the green corners.',
  },
};

export default function LicenceCardCapture({
  onSide,
  onDone,
  onClose,
}: LicenceCardCaptureProps) {
  const [side, setSide] = useState<CardSide>('front');
  const [front, setFront] = useState<File | null>(null);

  // ⚠️ THE SCANNER TREATS "FINISHED A SHOT" AND "CLOSE THE CAMERA" AS ONE
  // EVENT. Its finish() calls onClose() and THEN onDone(), synchronously —
  // right for its usual single-shot callers, where the file existing and the
  // camera closing are the same moment. This flow runs it TWICE. Passing the
  // parent's onClose straight through meant taking the FRONT closed the whole
  // capture: the parent unmounted this component, and the setSide('back') that
  // would have remounted the scanner for the back ran on a dying tree and did
  // nothing. The back was unreachable — reported from a real phone 2026-08-24.
  //
  // So the parent close is DEFERRED a microtask and handleDone gets to veto
  // it. A real cancel (the ×, Escape, backing out) calls onClose with NO
  // following onDone, nothing vetoes, and the close goes through as before.
  const advancing = useRef(false);
  const closeParent = useRef(onClose);
  closeParent.current = onClose;

  const handleClose = useCallback(() => {
    advancing.current = false;
    // Runs after finish()'s synchronous onClose()+onDone() pair has settled,
    // so handleDone below has already decided whether we are moving to the
    // back. If it did, the flag is set and this close is skipped.
    queueMicrotask(() => {
      if (!advancing.current) closeParent.current();
    });
  }, []);

  /**
   * ⚠️ THE TWO SCANNERS FINISH DIFFERENTLY, AND THIS HANDLES BOTH.
   *
   * V2 treated "finished a shot" and "close the camera" as ONE event: its
   * finish() called onClose() and THEN onDone(), synchronously, one file at a
   * time. Every line of this component was shaped around that, including the
   * deferred-close veto below.
   *
   * V3 does neither. It collects PAGES and hands them over in a single
   * onDone(files) — and it never calls onClose() on the way out at all. So when
   * the consent page moved to V3 on 2026-09-08:
   *
   *   the camera never returned to the form, because nothing closed it;
   *   a member who shot both sides in one pass had the back silently dropped,
   *   because this took files[0] and nothing else;
   *   and `photographed` therefore stayed false, so "Give my consent" was
   *   disabled forever. Operator: "the camera does not automaticly return to
   *   the form once the scan has been sent" and "it won't submit".
   *
   * ⚠️ TWO PAGES, AND THE SECOND ONE ENDS IT. A licence card has a front and a
   * back; a third page is not a third side. Extra pages are dropped rather than
   * queued, because the alternative is a consent naming a document nobody can
   * see. Operator: "it must allow 2 pictures, front and back. no more."
   */
  const handleDone = useCallback(
    (files: File[]) => {
      // ⚠️ NO FILE IS NOT AN ERROR TO SHOW A STRANGER. The scanner can close
      // without producing one (permission withdrawn mid-flow, a cancelled
      // review). Treat it as "they backed out of this side" and leave them
      // where they were rather than throwing a dialog at them.
      if (!files.length) return;

      // The whole card in one pass — V3's usual shape.
      if (!front && files.length >= 2) {
        const [a, b] = files;
        for (const [sideOf, f] of [['front', a], ['back', b]] as const) {
          try {
            onSide(sideOf, f);
          } catch {
            /* the caller's problem, never this component's */
          }
        }
        setFront(a);
        // Nothing to remount for: let the deferred close through and hand the
        // pair over.
        advancing.current = false;
        onDone({ front: a, back: b });
        closeParent.current();
        return;
      }

      const file = files[0];

      // Fire and forget: the FRONT's read runs while they shoot the back, so
      // the form they land on is already filled in. Must not block or throw.
      try {
        onSide(side, file);
      } catch {
        /* the caller's problem, never this component's */
      }
      if (side === 'front') setFront(file);

      const step = advanceCapture(side, front !== null);
      // keepOpen vetoes the close the scanner's finish() just scheduled — we
      // are remounting for the next side, not tearing the surface down.
      advancing.current = step.keepOpen;

      if (step.complete && front) {
        // Both sides done: hand the pair over and close.
        //
        // ⚠️ closeParent EXPLICITLY, because V3 never calls onClose. Under V2
        // finish() had already scheduled the close and the microtask below let
        // it through; under V3 nothing schedules anything and the camera simply
        // stays up over the form the member is trying to fill in.
        onDone({ front, back: file });
        closeParent.current();
        return;
      }
      setSide(step.next);
    },
    [side, front, onSide, onDone],
  );

  return (
    <DocumentScanner
      // Remount between passes: the scanner holds its own phase, pages and
      // stream, and reusing the instance would carry the front's review
      // state into the back's capture.
      key={side}
      shape="card"
      // They tapped a link that says "photograph your firearm licence".
      // Asking what they are holding is a question with one answer.
      skipChoose
      // Operator: "keep it static green."
      staticAim
      title={COPY[side].title}
      // ⚠️ THE LEAD IS NOW THE SCANNER'S SUBTITLE, IN ITS HEADER. It used to
      // be a fixed overlay pinned to the bottom of the screen, which landed
      // straight on the shutter row and the Cancel/Reset/Apply row — reported
      // from a real phone. In the header it is in normal flow, above the
      // camera, and cannot collide with a control.
      subtitle={COPY[side].lead}
      onDone={handleDone}
      onClose={handleClose}
    />
  );
}
