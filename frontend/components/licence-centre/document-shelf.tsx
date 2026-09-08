'use client';

import type { SheetDocument } from './contract';

// ────────────────────────────────────────────────────────────────────
// THE DOCUMENT SHELF — everything attached, across the top, once.
//
// ⚠️ ONE DOOR, NOT ONE PER SECTION, AND THAT IS THE POINT. The screen this
// replaces put a full scanner-plus-upload-plus-reuse block on every step —
// two-thirds of each screen, in brand red, ten times in a row — and then
// showed the SAME block again underneath a document that was already
// attached. Here there is one shelf, one Add tile, and anything dropped on it
// is classified and read wherever it belongs.
//
// ⚠️ THE ANNEXURE LETTER IS THE POINT OF THE THUMBNAIL. It is what a DFO uses
// to find the page, so it is what the member should recognise the document by.
// It comes from the server's own annexure index, so the shelf, the preview and
// the printed pack cannot letter the same document differently.
// ────────────────────────────────────────────────────────────────────

function QrIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 3h3v3h-3v-3zm3-3h3v3h-3v-3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * ⚠️ AN UPLOAD ICON, NOT A "+". Operator, 2026-08-24, about the Document
 * Centre's equivalent and repeated here on 2026-09-08: "replace the Add button
 * with two buttons, Upload and Scan with phone (Use Icons)." A bare plus says
 * "something can be added" and leaves which route to guess at; the tray-and-
 * arrow says the file is already on the device.
 */
function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M12 16V4m0 0L8 8m4-4l4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Where the page came from, as a mark inside its own tile.
 *
 * ⚠️ A LETTER IN A BOX, NOT A COLOUR. The shelf already spends colour on the
 * READ state — green for read cleanly, gold for check this — and a second
 * colour code on the same 72px tile would be two things to learn and one to
 * confuse. Origin is not a state and must not compete with one.
 *
 * Operator, 2026-09-08: "Just a small indicator inside each file box", with a
 * legend beneath.
 */
function OriginMark({ origin }: { origin: 'vault' | 'member' }) {
  const vault = origin === 'vault';
  return (
    <span
      aria-label={vault ? 'Added by the Licence Centre' : 'You added this'}
      title={vault ? 'Added by the Licence Centre' : 'You added this'}
      className={`absolute bottom-[5px] right-[5px] flex h-[15px] w-[15px] items-center justify-center rounded-[3px] border text-[9px] font-medium leading-none ${
        vault
          ? 'border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-secondary)]'
          : 'border-[var(--red-line)] bg-[var(--red-wash)] text-[var(--red)]'
      }`}
    >
      {vault ? 'LC' : 'U'}
    </span>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M14 3v5h5M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** What the picker will take. Matches the server's accepted upload types. */
const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

export interface DocumentShelfProps {
  documents: SheetDocument[];
  /**
   * Files chosen from this device.
   *
   * ⚠️ THE SHELF OWNS THE PICKER NOW, AND THAT IS THE POINT. It used to open
   * the Add panel, which mounted a ScanButton of its own — so the member got
   * "Add your ID…" and "Upload from this device" on the shelf and then "Use my
   * phone camera" and "Choose files instead" underneath it. Two scanners and
   * two pickers on one screen, one of each too many. Operator, 2026-09-08:
   * "this is double. two scan with phone options."
   */
  onUpload: (files: File[]) => void;
  /**
   * Straight into the scanner — the phone hand-off on a desktop, the camera on
   * a handheld.
   *
   * ⚠️ ITS OWN TILE, NOT A SECOND CLICK. Operator, 2026-08-24, about the
   * Document Centre's equivalent: "replace the Add button with two buttons,
   * Upload and Scan with phone (Use Icons)." A member holding a licence card
   * should see the camera without opening anything first — and behind one
   * generic "+" they did not: the shelf shipped with only the picker wired
   * while its own empty-state copy promised scanning.
   */
  onScan: () => void;
}

export default function DocumentShelf({
  documents,
  onUpload,
  onScan,
}: DocumentShelfProps) {
  const empty = documents.length === 0;

  /**
   * The upload control, as a label wrapping a hidden input.
   *
   * ⚠️ IT OPENS THE OPERATING SYSTEM'S PICKER, NOT A PANEL. "Upload from this
   * device" that opens a screen offering to scan with your phone is not an
   * upload button; it is a menu pretending to be one.
   */
  const picker = (className: string, children: React.ReactNode) => (
    <label className={className}>
      {children}
      <input
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // Reset first: picking the same file twice in a row fires no change
          // event otherwise, and the second attempt looks like a dead button.
          e.target.value = '';
          if (files.length) onUpload(files);
        }}
      />
    </label>
  );

  // ── the first-timer: one wide tile, and no apology ──────────────────
  //
  // ⚠️ AN EMPTY SHELF IS NOT AN ERROR STATE. It is what somebody's first
  // application correctly looks like, and the page is otherwise identical —
  // more rows are `needs_you`, and that is all. There is no separate
  // onboarding wizard and there must not be one.
  if (empty) {
    // ⚠️ TWO BOXES, SAME STYLE, SIDE BY SIDE — and NOTHING behind either of
    // them that offers the choice a second time. Operator, 2026-09-08: "remove
    // the scan with my phone and upload files here, then add the upload files
    // next to the Add your ID, licences and certificates in the same style of
    // box."
    const box =
      'flex w-full cursor-pointer items-center gap-[14px] rounded-[6px] border border-dashed border-[var(--border-hover)] bg-[var(--bg)] px-4 py-[18px] text-left text-[var(--red)]';
    return (
      <div className="grid gap-2 border-b border-[var(--border-divider)] px-4 pb-[14px] pt-3 sm:grid-cols-2">
        <button type="button" onClick={onScan} className={box}>
          <QrIcon />
          <span>
            <span className="block text-[14px] font-medium text-[var(--text-primary)]">
              Add your ID, licences and certificates
            </span>
            {/*
              ⚠️ THIS COPY NO LONGER PROMISES THE PICKER. It used to read "Scan
              with your phone or choose files", which was one box offering two
              routes and then opening a panel that offered them again. There is
              a box for each now, so each says only what it does.
            */}
            <span className="mt-[2px] block text-[12.5px] font-normal text-[var(--text-tertiary)]">
              Scan with your phone. We read them and fill this page in.
            </span>
          </span>
        </button>

        {picker(
          box,
          <span className="flex items-center gap-[14px]">
            <UploadIcon />
            <span>
              <span className="block text-[14px] font-medium text-[var(--text-primary)]">
                Upload from this device
              </span>
              <span className="mt-[2px] block text-[12.5px] font-normal text-[var(--text-tertiary)]">
                Photographs or PDFs you already have saved.
              </span>
            </span>
          </span>,
        )}
      </div>
    );
  }

  return (
    <div className="border-b border-[var(--border-divider)] py-3 pl-4">
      <p className="m-0 mb-2 text-[11px] font-medium uppercase tracking-[0.11em] text-[var(--text-tertiary)]">
        Your documents
      </p>
      <div className="flex gap-[10px] overflow-x-auto pb-2 pr-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {documents.map((d) => (
          <div key={d.id} className="w-[72px] flex-shrink-0">
            <div className="relative flex h-[92px] w-[72px] items-center justify-center overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--bg-inset)] text-[var(--text-tertiary)]">
              <FileIcon />
              {d.letter ? (
                <span className="absolute bottom-[5px] left-[5px] rounded-[4px] bg-[var(--text-primary)] px-[5px] py-[3px] font-mono text-[10.5px] font-medium leading-none text-white">
                  {d.letter}
                </span>
              ) : null}
              {/*
                ⚠️ GOLD, NEVER RED. A document we could not read is still
                attached and still goes in the pack — it is a "look at this",
                not a failure. Colouring it as one teaches members to
                re-upload things that were fine.
              */}
              <span
                aria-label={d.state === 'read' ? 'Read' : 'Check this'}
                className={`absolute right-[5px] top-[5px] h-2 w-2 rounded-full border-[1.5px] border-white ${
                  d.state === 'read'
                    ? 'bg-[var(--success)]'
                    : 'bg-[var(--gold-strong)]'
                }`}
              />
              <OriginMark origin={d.origin} />
            </div>
            <div className="mt-[5px] line-clamp-2 text-[11px] leading-[1.25] text-[var(--text-secondary)]">
              {d.label}
            </div>
          </div>
        ))}

        {/*
          ⚠️ TWO TILES, AND THE SCANNER IS THE FIRST OF THEM. Most of what
          belongs on this shelf is a card or a certificate the member is
          holding, and the fastest route to it is the camera in their pocket.
          Behind a single "+" it was invisible.
        */}
        <div className="w-[72px] flex-shrink-0">
          <button
            type="button"
            onClick={onScan}
            aria-label="Scan a document with your phone"
            className="flex h-[92px] w-[72px] flex-col items-center justify-center gap-1 rounded-[6px] border border-dashed border-[var(--border-hover)] bg-[var(--bg)] text-[11.5px] font-medium text-[var(--red)]"
          >
            <QrIcon />
            Scan
          </button>
        </div>
        <div className="w-[72px] flex-shrink-0">
          {picker(
            'flex h-[92px] w-[72px] cursor-pointer flex-col items-center justify-center gap-1 rounded-[6px] border border-dashed border-[var(--border-hover)] bg-[var(--bg)] text-[11.5px] font-medium text-[var(--red)]',
            <>
              <UploadIcon />
              Upload
            </>,
          )}
        </div>
      </div>

      {/*
        ⚠️ A LEGEND, BECAUSE TWO LETTERS ARE NOT SELF-EXPLANATORY. The marks are
        deliberately small enough to need one; the alternative was a word on
        every tile, which does not fit in 72px and would push the name out.
        It renders only when there is something to explain.
      */}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 pr-4 text-[11px] text-[var(--text-tertiary)]">
        {documents.some((d) => d.origin === 'vault') ? (
          <span className="inline-flex items-center gap-[6px]">
            <span className="flex h-[15px] w-[15px] items-center justify-center rounded-[3px] border border-[var(--border)] bg-[var(--bg-card)] text-[9px] font-medium leading-none text-[var(--text-secondary)]">
              LC
            </span>
            Added by the Licence Centre
          </span>
        ) : null}
        {documents.some((d) => d.origin === 'member') ? (
          <span className="inline-flex items-center gap-[6px]">
            <span className="flex h-[15px] w-[15px] items-center justify-center rounded-[3px] border border-[var(--red-line)] bg-[var(--red-wash)] text-[9px] font-medium leading-none text-[var(--red)]">
              U
            </span>
            You added this
          </span>
        ) : null}
      </div>
    </div>
  );
}
