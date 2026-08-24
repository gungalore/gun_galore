'use client';

import { useCallback, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { advanceCapture, type CardSide } from '@/lib/scan/two-side-capture';

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

const DocumentScanner = dynamic(
  () => import('../scan/document-scanner'),
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
    lead: 'The side with your photograph, the make and the serial numbers. Fit the card inside the green corners, then take the picture.',
  },
  back: {
    title: 'Now the BACK',
    lead: 'The side with the barcode and your signature. Same again — fit it inside the green corners.',
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

  const handleDone = useCallback(
    (files: File[]) => {
      const file = files[0];
      // ⚠️ NO FILE IS NOT AN ERROR TO SHOW A STRANGER. The scanner can close
      // without producing one (permission withdrawn mid-flow, a cancelled
      // review). Treat it as "they backed out of this side" and leave them
      // where they were rather than throwing a dialog at them.
      if (!file) return;

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
        // Both sides done: the deferred close proceeds and the parent gets the
        // pair. (onDone and the parent's own onClose both mean "stop
        // capturing"; calling both is harmless.)
        onDone({ front, back: file });
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
