'use client';

import { useEffect, useRef, useState } from 'react';
import ScanButton from '@/components/scan/scan-button';
import FilePickerButton from '@/components/file-picker-button';
import { shapeForKind } from '@/lib/scan/shapes';
import { CredentialKind, KIND_LABELS } from '@/lib/licence-centre-api';

// ────────────────────────────────────────────────────────────────────
// UPLOAD, OR SCAN WITH YOUR PHONE — AND SAY WHAT IT IS FIRST.
//
// Operator, 2026-08-24: "replace the Add button with two buttons, Upload and
// Scan with phone (Use Icons). If either button is clicked open a dropdown
// menu for the user to select which document they are going to provide so it
// can be correctly OCR'd and placed in the correct box."
//
// ⚠️ THE TYPE IS ASKED BEFORE THE CAPTURE, NOT AFTER, and that ordering is the
// whole point. It buys three things that cannot be recovered once the
// photograph exists:
//
//   THE AIM GUIDE. shapeForKind turns "competency certificate" into a card
//   outline and "proof of address" into an A4 one. Asked afterwards, the
//   member has already photographed a card through an A4 box.
//
//   THE READ. The type is sent as an override, so the server stops guessing
//   and reads the page it was told it is holding.
//
//   THE BOX IT LANDS IN, which is what the operator asked for in as many
//   words — a document filed under the wrong kind is one a DFO will not find.
//
// ⚠️ PICKING THE TYPE IS THE LAST TAP, AND THE SURFACE IS STILL NOT OURS TO
// CHOOSE. Operator, 2026-08-25: "Remove this and immediately open the QR
// code" — the type IS the question this menu asks, so answering it opens the
// hand-off rather than a panel offering the same two options again.
//
// It does that through ScanButton's `autoStart`, NOT by forcing a surface. An
// earlier draft added an `autoOpen` prop that set ScanButton's `open` state
// directly, which skips the choice ScanButton exists to make — it offers the
// webcam to NOBODY on a desktop ("an option that never yields a usable
// document is not a fallback, it is a trap") and hands off to the phone
// instead — so a button reading "Scan with phone" opened the laptop webcam.
// `autoStart` says "you have already been asked"; ScanButton still decides
// what that means on this device.
//
// ⚠️ "WORK IT OUT FOR ME" STAYS, AND STAYS FIRST. The classifier is good and
// the confirm step shows its answer either way; a list that forced a choice
// would make the common case slower than it is today.
// ────────────────────────────────────────────────────────────────────

/** Mirrors the page's own grouping so the list reads like the folders do. */
export interface KindGroupSpec {
  label: string;
  kinds: CredentialKind[];
}

const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

/**
 * What a member has to be told BEFORE they photograph this kind.
 *
 * ⚠️ THIS TEXT IS LOAD-BEARING AND WAS ALMOST LOST TWICE. The four safe-photo
 * kinds — closed, ajar, bolts, installation — were collapsed into one menu
 * entry on 2026-08-23, and the comment that did it warned in terms: the naming
 * had been doing real work, so with one entry this line becomes the only place
 * the member is ever told what a DFO actually wants. Rebuilding this panel
 * deleted it anyway, and left behind a comment claiming it had "moved to the
 * confirm step" when it had moved nowhere. A pre-deploy review caught that.
 *
 * ⚠️ AND IT SHOWS BEFORE THE CAPTURE, NOT AFTER. Told at the confirm step, the
 * member has already put the phone down — the second, third and fourth
 * photographs are the ones they will not go back for.
 */
/**
 * ⚠️ AND IT IS WHY ONE KIND STILL GETS A PANEL. Picking a type now opens the
 * hand-off straight away, which is right for a document the member simply
 * holds up — but the safe photographs are the case where WHICH photographs
 * get taken is the whole difficulty, and this is the last screen they read
 * before the phone is in their hand. The QR dialog is on the desktop and the
 * camera is on the phone, so there is nowhere later to say it.
 */
const GUIDANCE: Partial<Record<CredentialKind, string>> = {
  SAFE_PHOTOGRAPHS:
    'Add several: the safe closed, half open with the key in the door, and fully open so the roll bolts show. A DFO looks for all three. A fourth is worth having if you can take it — how the safe is bolted to the wall or floor.',
};

export default function DocumentCentreAdd({
  groups,
  busy,
  onFiles,
  onHandoffArrived,
}: {
  groups: readonly KindGroupSpec[];
  busy: boolean;
  /** The page's existing uploader. `kind` is an override, '' means classify. */
  onFiles: (files: File[], kind: CredentialKind | '') => void | Promise<void>;
  onHandoffArrived: () => void;
}) {
  /** Which button opened the list — and therefore what a pick does. */
  const [mode, setMode] = useState<'upload' | 'scan' | null>(null);
  /** Set once a type is picked and a second step is needed. */
  const [chosen, setChosen] = useState<CredentialKind | '' | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pickedKind = useRef<CredentialKind | ''>('');
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const uploadRef = useRef<HTMLButtonElement | null>(null);
  const scanRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!mode) return;

    const back = mode === 'upload' ? uploadRef.current : scanRef.current;
    const shut = (restoreFocus: boolean) => {
      setMode(null);
      setChosen(null);
      // Focus was sitting on a button inside the panel; leaving it on a
      // removed node drops a keyboard user back at the top of the document.
      if (restoreFocus) back?.focus();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') shut(true);
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      // ⚠️ THE SCANNER IS A PORTAL, SO "OUTSIDE" IS A LIE. DocumentScanner
      // renders through createPortal(body, document.body), which puts every
      // one of its controls outside this wrapper in the real DOM — and
      // `contains` tests DOM containment, not React containment. Without this
      // guard the FIRST tap inside the scanner (its chooser's Start button,
      // before the camera even runs) counted as "outside": the panel closed,
      // ScanButton unmounted, and the capture died with no error and no
      // photograph. Both the scanner and the phone hand-off tag themselves,
      // and other surfaces in this repo already stand down on the same marker.
      if (t?.closest?.('[data-blocking-overlay="true"]')) return;
      if (!wrapRef.current?.contains(t as Node)) shut(false);
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [mode]);

  function pick(kind: CredentialKind | '') {
    // A kind that has something to say gets a second step even on the upload
    // path — otherwise the file dialog opens over the very advice that was
    // meant to change which photographs get taken.
    if (mode === 'scan' || (kind && GUIDANCE[kind])) {
      setChosen(kind);
      return;
    }
    // ⚠️ THE DIALOG IS OPENED FROM INSIDE THE CLICK. Browsers only honour a
    // programmatic file dialog while a user gesture is still on the stack, so
    // this cannot be deferred behind a state update or an await.
    pickedKind.current = kind;
    setMode(null);
    fileRef.current?.click();
  }

  function handOff(files: File[], kind: CredentialKind | '') {
    setMode(null);
    setChosen(null);
    void onFiles(files, kind);
  }

  /*
    Deliberately NOT role="menu". That role promises arrow-key navigation this
    does not implement, and admits only menuitem children — where this has a
    heading and a group label per folder. A labelled group of buttons is what
    it actually is, and is what a screen reader should be told it is.
  */
  const panelClass =
    'absolute right-0 top-full z-[60] mt-2 w-[300px] rounded-[10px] border border-[var(--border)] bg-[var(--bg-card)]';

  const list = (
    <div
      className={`${panelClass} max-h-[min(420px,60vh)] overflow-y-auto p-1.5`}
      aria-label="What are you adding?"
    >
      <p className="px-2.5 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
        What are you adding?
      </p>
      <button
        type="button"
        onClick={() => pick('')}
        className="flex w-full items-start gap-2 rounded-[6px] px-2.5 py-2 text-left text-sm hover:bg-[var(--bg-card-hover)]"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--red)"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="mt-0.5 shrink-0"
        >
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
        </svg>
        <span className="flex-1">
          <span className="block font-medium">Work it out for me</span>
          <span className="block text-[11.5px] text-[var(--text-tertiary-on-card)]">
            We read the document and tell you what we made of it
          </span>
        </span>
      </button>

      {groups.map((g) => (
        <div key={g.label} role="group" aria-label={g.label}>
          <p className="mt-1 px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
            {g.label}
          </p>
          {g.kinds.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => pick(k)}
              className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-left text-sm hover:bg-[var(--bg-card-hover)]"
            >
              <span
                aria-hidden
                className="h-1 w-1 shrink-0 rounded-full"
                style={{ background: 'var(--border-hover)' }}
              />
              {KIND_LABELS[k] ?? k}
            </button>
          ))}
        </div>
      ))}
    </div>
  );

  const guidance = chosen ? GUIDANCE[chosen] : undefined;

  /*
    Keyed on the type so a second document gets a scanner aimed for it rather
    than the last one's guide. ScanButton picks the phone hand-off or the
    on-device camera itself — see the note at the top of this file for why
    that choice is not ours to make.
  */
  const scanControl = (auto: boolean) => (
    <ScanButton
      key={chosen || 'auto'}
      autoStart={auto}
      /* ⚠️ WITHOUT THIS THE STRAY CONTROLS OUTLIVE THE DIALOG. Nothing else
         closes this menu on the straight-through path: the member would shut
         the QR and find ScanButton's own two buttons sitting in the toolbar
         where the Upload and Scan buttons belong. */
      onClosed={
        auto
          ? () => {
              setMode(null);
              setChosen(null);
            }
          : undefined
      }
      shape={chosen ? shapeForKind(chosen) : 'a4'}
      title="Photograph the document"
      kind={chosen || undefined}
      handoff={{ dest: 'licence-centre' }}
      /* ⚠️ THIS DOES NOT ALSO CLOSE THE PANEL. PhoneHandoffDialog reports the
         arrival and then holds itself open for a beat so the member sees what
         came through; tearing it down in the same tick replaced that with a
         flash. ScanButton closes it on its own. */
      onHandoffArrived={onHandoffArrived}
      onFiles={(files) => handOff(files, chosen ?? '')}
      disabled={busy}
      label="Take a photo"
      fallback={
        <FilePickerButton
          accept={ACCEPT}
          multiple
          disabled={busy}
          onFiles={(files) => handOff(files, chosen ?? '')}
        >
          Choose files instead
        </FilePickerButton>
      }
    />
  );

  /**
   * A scan of a kind with nothing to be told first — straight to the hand-off.
   *
   * Renders ScanButton and nothing else: under `autoStart` it draws no
   * controls of its own while the hand-off opens over it, and falls back to
   * the picker only if the hand-off turns out not to be available at all.
   */
  const straightToScan = mode === 'scan' && chosen !== null && !guidance;

  const step2 = (
    <div
      className={`${panelClass} p-4`}
      aria-label="How would you like to add it?"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
        {mode === 'scan' ? 'Photographing' : 'Adding'}
      </p>
      <p className="mt-1 text-sm font-medium">
        {chosen ? (KIND_LABELS[chosen] ?? chosen) : 'A document'}
      </p>

      {guidance ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--text-secondary)]">
          {guidance}
        </p>
      ) : (
        <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--text-tertiary-on-card)]">
          We will aim the guide for this document and read it as one.
        </p>
      )}

      <div className="mt-3">
        {mode === 'scan' ? (
          scanControl(false)
        ) : (
          <FilePickerButton
            accept={ACCEPT}
            multiple
            disabled={busy}
            onFiles={(files) => handOff(files, chosen ?? '')}
          >
            Choose files
          </FilePickerButton>
        )}
      </div>

      <button
        type="button"
        onClick={() => setChosen(null)}
        className="mt-3 text-[11.5px] text-[var(--text-secondary)] underline"
      >
        Pick a different document type
      </button>
    </div>
  );

  return (
    <div ref={wrapRef} className="relative flex items-center gap-2">
      {/* The picker's own input, so a choice can open the dialog in the same
          gesture. FilePickerButton owns its trigger and cannot be fired from
          outside it. */}
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
          if (files.length) void onFiles(files, pickedKind.current);
        }}
      />

      <button
        ref={uploadRef}
        type="button"
        disabled={busy}
        aria-haspopup="true"
        aria-expanded={mode === 'upload'}
        onClick={() => {
          setChosen(null);
          setMode((m) => (m === 'upload' ? null : 'upload'));
        }}
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
        ref={scanRef}
        type="button"
        disabled={busy}
        aria-haspopup="true"
        aria-expanded={mode === 'scan'}
        onClick={() => {
          setChosen(null);
          setMode((m) => (m === 'scan' ? null : 'scan'));
        }}
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

      {mode &&
        (chosen === null ? list : straightToScan ? scanControl(true) : step2)}
    </div>
  );
}
