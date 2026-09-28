'use client';

import { useRef, useState } from 'react';
import ScanButton from '@/components/scan/scan-button';
import DocumentEnhancer from '@/components/scan-upload/document-enhancer';
import { CredentialKind } from '@/lib/licence-centre-api';

// ────────────────────────────────────────────────────────────────────
// TWO BUTTONS, AND NOTHING IN BETWEEN.
//
// Operator, 2026-08-24: "replace the Add button with two buttons, Upload and
// Scan with phone (Use Icons). If either button is clicked open a dropdown
// menu for the user to select which document they are going to provide..."
//
// Operator, 2026-09-27: "I want this selection dropdown removed from the
// upload and Scan with phone. The AI already decides what document it is.
// Upload button open the file list automatically and the scan button opens the
// QR code."
//
// So the type menu is gone. The two buttons now do exactly what they say:
//
//   UPLOAD  opens the operating system's file picker FROM INSIDE THE CLICK.
//           iOS Safari refuses a programmatic file dialog that is not attached
//           to a user gesture, so the input's click() must stay synchronous
//           here — deferring it behind a state update or an await is the bug
//           this file used to be commented about twice for.
//
//   SCAN    opens the scanner, which decides the surface itself: the QR
//           hand-off to a phone on a desktop, the on-device camera on
//           something held. `autoStart` says "you have already been asked";
//           it does NOT force a surface. See the note in scan-button.tsx for
//           why the choice is not ours to make.
//
// ⚠️ NOTHING DECLARES A TYPE ANY MORE, AND THAT IS THE POINT. Every file is
// handed over with '' — "work it out" — and the server's classifier reads the
// page. The ordering argument the menu used to carry (aim guide, read
// override, destination box) is deliberately spent here: the operator has
// ruled that the AI decides, and the safe photographs that most needed the
// pre-capture advice are now an upload-only path where the classifier places
// them.
//
// ⚠️ THE SCANNER IS DOCUMENTS ONLY, AND IT IS UNTOUCHED. This component calls
// ScanButton; it does not change it. scan-button.tsx, document-scanner.tsx and
// everything under scan-v3 are exactly as they were.
//
// ⚠️ NOTHING IS POLISHED HERE. The scanner treatment runs on the page, AFTER
// identify, and only for the files that came back as documents — an evidence
// photograph must never be cropped or deshadowed. See the note in the page's
// AddPanel and the spec on upload-batch.tsx.
// ────────────────────────────────────────────────────────────────────

const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

export default function DocumentCentreAdd({
  busy,
  onFiles,
  onHandoffArrived,
}: {
  busy: boolean;
  /** The page's existing uploader. `kind` is '' — classify, never declare. */
  onFiles: (files: File[], kind: CredentialKind | '') => void | Promise<void>;
  onHandoffArrived: () => void;
}) {
  /** True while the scanner or its hand-off is open over these buttons. */
  const [scanning, setScanning] = useState(false);
  /*
    ⚠️ THE FILE DIALOG IS OPENED FROM INSIDE THE TAP. `fileRef.current.click()`
    runs synchronously in the Upload button's onClick — iOS Safari refuses a
    programmatic dialog that is not attached to a gesture — so the pick happens
    here, on this component's own hidden input, rather than inside
    DocumentEnhancer, which owns its own trigger.
  */
  const fileRef = useRef<HTMLInputElement | null>(null);

  function handOff(files: File[]) {
    setScanning(false);
    void onFiles(files, '');
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // Cleared first: picking the same file twice in a row fires no
          // change event otherwise, and the second attempt looks like a dead
          // button.
          e.target.value = '';
          if (!files.length) return;
          handOff(files);
        }}
      />

      <button
        type="button"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        className="inline-flex min-h-[38px] items-center gap-2 rounded-[10px] border border-[var(--red)] bg-[var(--red)] px-3.5 text-[13px] font-semibold text-white hover:bg-[var(--red-hover)] disabled:opacity-50"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 16V4M7.5 8.5 12 4l4.5 4.5" />
          <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
        </svg>
        Upload
      </button>

      <button
        type="button"
        disabled={busy}
        aria-expanded={scanning}
        onClick={() => setScanning(true)}
        className="inline-flex min-h-[38px] items-center gap-2 rounded-[10px] border border-[var(--border)] px-3.5 text-[13px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] disabled:opacity-50"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect x="6" y="2" width="12" height="20" rx="2.5" />
          <path d="M11 18.5h2" />
        </svg>
        Scan with phone
      </button>

      {/* ⚠️ WITHOUT onClosed THE SCANNER OUTLIVES THIS STATE. Nothing else
          resets `scanning` on the straight-through path, so a member who shuts
          the QR would find ScanButton's own controls sitting where these two
          buttons belong. */}
      {scanning && (
        <ScanButton
          autoStart
          onClosed={() => setScanning(false)}
          title="Photograph the document"
          handoff={{ dest: 'licence-centre' }}
          onHandoffArrived={onHandoffArrived}
          onFiles={(files) => handOff(files)}
          disabled={busy}
          label="Take a photo"
          fallback={
            <DocumentEnhancer
              accept={ACCEPT}
              multiple
              disabled={busy}
              onFiles={(files) => handOff(files)}
              title="Photograph the document"
            >
              Choose files instead
            </DocumentEnhancer>
          }
        />
      )}
    </div>
  );
}
