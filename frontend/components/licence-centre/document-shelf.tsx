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

export interface DocumentShelfProps {
  documents: SheetDocument[];
  onAdd: () => void;
}

export default function DocumentShelf({
  documents,
  onAdd,
}: DocumentShelfProps) {
  const empty = documents.length === 0;

  // ── the first-timer: one wide tile, and no apology ──────────────────
  //
  // ⚠️ AN EMPTY SHELF IS NOT AN ERROR STATE. It is what somebody's first
  // application correctly looks like, and the page is otherwise identical —
  // more rows are `needs_you`, and that is all. There is no separate
  // onboarding wizard and there must not be one.
  if (empty) {
    return (
      <div className="border-b border-[var(--border-divider)] px-4 pb-[14px] pt-3">
        <button
          type="button"
          onClick={onAdd}
          className="flex w-full items-center gap-[14px] rounded-[6px] border border-dashed border-[var(--border-hover)] bg-[var(--bg)] px-4 py-[18px] text-left text-[var(--red)]"
        >
          <QrIcon />
          <span>
            <span className="block text-[14px] font-medium text-[var(--text-primary)]">
              Add your ID, licences and certificates
            </span>
            <span className="mt-[2px] block text-[12.5px] font-normal text-[var(--text-tertiary)]">
              Scan with your phone or choose files. We read them and fill this
              page in.
            </span>
          </span>
        </button>
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
            </div>
            <div className="mt-[5px] line-clamp-2 text-[11px] leading-[1.25] text-[var(--text-secondary)]">
              {d.label}
            </div>
          </div>
        ))}

        <div className="w-[72px] flex-shrink-0">
          <button
            type="button"
            onClick={onAdd}
            className="flex h-[92px] w-[72px] flex-col items-center justify-center gap-1 rounded-[6px] border border-dashed border-[var(--border-hover)] bg-[var(--bg)] text-[11.5px] font-medium text-[var(--red)]"
          >
            <span aria-hidden="true" className="text-[18px] leading-none">
              +
            </span>
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
