'use client';

import ScanButton from '@/components/scan/scan-button';
import FilePickerButton from '@/components/file-picker-button';
import type { AddedUpload } from '@/lib/motivations-api';

// ────────────────────────────────────────────────────────────────────
// THE SCANNER, AND NOTHING ELSE.
//
// ⚠️ THIS PANEL USED TO OFFER THE WHOLE CHOICE A SECOND TIME. The shelf above
// it already shows two boxes — "Add your ID, licences and certificates" and
// "Upload from this device" — and tapping either opened this, which mounted a
// ScanButton with its own pair of controls underneath: "Use my phone camera"
// and "Choose files instead". Two scanners and two pickers on one screen.
// Operator, 2026-09-08: "this is double. two scan with phone options."
//
// So the shelf owns both doors now. The picker lives on the shelf's Upload
// box, which opens the operating system's file dialog directly; this renders
// only when the SCAN box was tapped, and it renders nothing a member can see.
//
// ⚠️ `autoStart` IS WHAT MAKES IT INVISIBLE, and it is also what keeps the
// surface choice where it belongs. ScanButton hides its own controls while it
// probes and opens — the phone hand-off on a desktop, the camera on a
// handheld, because a laptop webcam cannot resolve a licence serial. Setting
// its `open` from outside is the exact mistake its docstring records.
//
// ⚠️ THE FALLBACK IS NOT A SECOND PICKER. It renders only in the case where
// nothing opened at all — no camera and no hand-off — which is the one case
// where the member genuinely has nowhere else to go.
//
// ⚠️ AND THIS DOOR NEVER ASKS WHAT THE DOCUMENT IS. Brief §6.1: "anything
// dropped here is classified and read", with no per-section doors — so the
// kind goes up empty and the server classifies.
// ────────────────────────────────────────────────────────────────────

const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

export interface AddPanelProps {
  motivationId: string;
  /** Kind is always '' from this door — see the note above. */
  onAdd: (kind: string, file: File) => Promise<AddedUpload | undefined>;
  /** The phone sent something — re-read the sheet. */
  onHandoffArrived: (count: number) => void;
  /** The scanner or the hand-off closed, however it was closed. */
  onClose: () => void;
  busy?: boolean;
}

export default function AddPanel({
  motivationId,
  onAdd,
  onHandoffArrived,
  onClose,
  busy = false,
}: AddPanelProps) {
  const take = async (files: File[]) => {
    for (const f of files) await onAdd('', f);
  };

  return (
    <ScanButton
      autoStart
      onClosed={onClose}
      /*
        ⚠️ `dest: 'motivation'` WITH THE ID. The hand-off token is a WRITE
        CREDENTIAL to this member's vault and is scoped to what it is minted
        for — see the ActionToken note in CLAUDE.md.
      */
      handoff={{ dest: 'motivation', motivationId }}
      /*
        A4 rather than a card outline: this door does not know what is coming,
        so it opens on the shape that crops a card acceptably and a page
        correctly, rather than guessing wrong in the other direction.
      */
      shape="a4"
      title="Photograph your document"
      subtitle="A licence card, your ID, a certificate, an invoice — we read it and fill this page in."
      label="Scan with your phone"
      disabled={busy}
      onFiles={take}
      /*
        ⚠️ RE-READS THE SHEET, AND DOES NOT CLOSE ANYTHING. PhoneHandoffDialog
        reports the arrival and holds itself open for a beat so the member sees
        what came through; tearing it down in the same tick replaces that with
        a flash. ScanButton closes it itself, and `onClosed` fires then.
      */
      onHandoffArrived={onHandoffArrived}
      fallback={
        <FilePickerButton accept={ACCEPT} multiple disabled={busy} onFiles={take}>
          Choose files instead
        </FilePickerButton>
      }
    />
  );
}
