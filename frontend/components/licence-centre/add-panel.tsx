'use client';

import ScanButton from '@/components/scan/scan-button';
import FilePickerButton from '@/components/file-picker-button';
import BulkCapture from '@/components/licence-pack/bulk-capture';
import type { AddedUpload, PickableKind } from '@/lib/motivations-api';

// ────────────────────────────────────────────────────────────────────
// THE ONE DOOR BEHIND THE SHELF'S "Add" TILE.
//
// ⚠️ THE SCANNER IS THE POINT OF IT, AND IT WAS MISSING. The shelf shipped
// with only the file picker behind the tile, while the empty-shelf tile said
// "Scan with your phone or choose files" — copy promising a capability that
// was not wired. A member on a laptop with a licence card in their hand had no
// way to photograph it.
//
// ⚠️ ScanButton DECIDES THE SURFACE, AND NOTHING HERE MAY. It offers the phone
// hand-off on a desktop and the on-device camera on a handheld, because a
// laptop webcam cannot resolve a licence serial — "an option that never yields
// a usable document is not a fallback, it is a trap". Setting `open` from
// outside is the exact mistake its own docstring records; this passes the
// hand-off destination and lets it choose.
//
// ⚠️ AND THIS DOOR NEVER ASKS WHAT THE DOCUMENT IS. The Document Centre's own
// Add panel asks first, deliberately, so the aim guide matches the card and the
// read gets an override. The sheet does the opposite on purpose — brief §6.1,
// "anything dropped here is classified and read", with no per-section doors —
// so the kind goes up empty and the server classifies. That is the same
// contract bulk-capture already works to (`onAdd('', file)`).
// ────────────────────────────────────────────────────────────────────

const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

export interface AddPanelProps {
  motivationId: string;
  /** Kinds a document may be re-filed under, for bulk-capture's dropdown. */
  kinds: PickableKind[];
  /** Kind is always '' from this door — see the note above. */
  onAdd: (kind: string, file: File) => Promise<AddedUpload | undefined>;
  onRefile: (uploadId: string, kind: string) => Promise<void>;
  /** The phone sent something — re-read the sheet. */
  onHandoffArrived: (count: number) => void;
  onClose: () => void;
  /**
   * Opened from the Scan tile — go straight into the scanner.
   *
   * ⚠️ THROUGH ScanButton's OWN `autoStart`, NEVER BY FORCING A SURFACE. An
   * earlier attempt elsewhere set its `open` state from outside, which skips
   * the choice it exists to make and opened a laptop webcam behind a button
   * reading "Scan with phone". `autoStart` lets it pick: the hand-off on a
   * desktop, the camera on a handheld, neither where neither works.
   */
  autoScan?: boolean;
  busy?: boolean;
}

export default function AddPanel({
  motivationId,
  kinds,
  onAdd,
  onRefile,
  onHandoffArrived,
  onClose,
  autoScan = false,
  busy = false,
}: AddPanelProps) {
  const take = async (files: File[]) => {
    for (const f of files) await onAdd('', f);
  };

  return (
    <div className="border-b border-[var(--border-divider)] px-4 py-3">
      <p className="m-0 mb-3 text-[11px] font-medium uppercase tracking-[0.11em] text-[var(--text-tertiary)]">
        Add a document
      </p>

      <ScanButton
        autoStart={autoScan}
        /* ⚠️ WITHOUT THIS THE STRAY CONTROLS OUTLIVE THE DIALOG. On the
           straight-through path nothing else closes this panel: the member
           would shut the QR and find ScanButton's own two buttons sitting
           where the tiles belong. */
        onClosed={autoScan ? onClose : undefined}
        /*
          ⚠️ `dest: 'motivation'` WITH THE ID. The hand-off token is a WRITE
          CREDENTIAL to this member's vault and is scoped to what it is minted
          for — see the ActionToken note in CLAUDE.md. A token minted for the
          wrong destination either fails or writes somewhere it should not.
        */
        handoff={{ dest: 'motivation', motivationId }}
        /*
          A4 rather than a card outline: this door does not know what is
          coming, so it opens on the shape that crops a card acceptably and a
          page correctly, rather than guessing wrong in the other direction.
        */
        shape="a4"
        title="Photograph your document"
        subtitle="A licence card, your ID, a certificate, an invoice — we read it and fill this page in."
        label="Scan with your phone"
        disabled={busy}
        onFiles={take}
        /*
          ⚠️ RE-READS THE SHEET, AND DOES NOT CLOSE THE PANEL.
          PhoneHandoffDialog reports the arrival and holds itself open for a
          beat so the member sees what came through; tearing it down in the
          same tick replaces that with a flash. ScanButton closes it itself.
        */
        onHandoffArrived={onHandoffArrived}
        /*
          Rendered beside the scanner, and ALONE where there is no camera and
          no hand-off — a desktop with no session to mint against, say.
        */
        fallback={
          <FilePickerButton
            accept={ACCEPT}
            multiple
            disabled={busy}
            onFiles={take}
          >
            Choose files instead
          </FilePickerButton>
        }
      />

      {/*
        The drag-and-drop tray, for somebody with a folder of scans already.
        It owns the multi-file progress and the "we filed this as…" correction
        dropdown, and it is tested where it lives.
      */}
      <div className="mt-3">
        <BulkCapture pickable={kinds} onAdd={onAdd} onRefile={onRefile} />
      </div>

      <button
        type="button"
        onClick={onClose}
        className="mt-2 min-h-[44px] text-[13px] font-medium text-[var(--text-tertiary)]"
      >
        Done adding
      </button>
    </div>
  );
}
