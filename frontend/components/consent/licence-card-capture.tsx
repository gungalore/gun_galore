'use client';

import { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';

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

export type CardSide = 'front' | 'back';

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

  const handleDone = useCallback(
    (files: File[]) => {
      const file = files[0];
      // ⚠️ NO FILE IS NOT AN ERROR TO SHOW A STRANGER. The scanner can close
      // without producing one (permission withdrawn mid-flow, a cancelled
      // review). Treat it as "they backed out of this side" and leave them
      // where they were rather than throwing a dialog at them.
      if (!file) return;

      if (side === 'front') {
        setFront(file);
        // Fire and forget: the read runs while they shoot the back.
        try {
          onSide('front', file);
        } catch {
          /* the caller's problem, never this component's */
        }
        setSide('back');
        return;
      }

      try {
        onSide('back', file);
      } catch {
        /* as above */
      }
      // ⚠️ GUARD THE PAIR. `front` cannot normally be null here — the flow
      // only reaches 'back' after a front exists — but a remount would make
      // it so, and handing the parent a half-pair is worse than restarting.
      if (!front) {
        setSide('front');
        return;
      }
      onDone({ front, back: file });
    },
    [side, front, onSide, onDone],
  );

  return (
    <>
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
        onDone={handleDone}
        onClose={onClose}
      />
      {/*
        ⚠️ THE LEAD TEXT LIVES OUTSIDE THE SCANNER because the scanner owns a
        full-screen surface and takes only a title. Rendering it here keeps the
        scanner untouched for every other caller — this flow is the unusual
        one, and it should carry its own weight rather than adding a prop that
        four other surfaces would have to ignore.
      */}
      <p
        aria-live="polite"
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 'calc(env(safe-area-inset-bottom) + 8px)',
          zIndex: 1002,
          margin: 0,
          padding: '0 20px',
          textAlign: 'center',
          fontSize: 12.5,
          lineHeight: 1.45,
          color: 'rgba(255,255,255,0.82)',
          pointerEvents: 'none',
          textShadow: '0 1px 3px rgba(0,0,0,0.9)',
        }}
      >
        {COPY[side].lead}
      </p>
    </>
  );
}
