'use client';

import { useState } from 'react';
import type { DocumentNeed, LibraryItem, UploadRow } from '@/lib/motivations-api';

// ────────────────────────────────────────────────────────────────────
// ONE LIST, ONE BUTTON.
//
// Every requirement used to carry its own camera, its own picker, its own
// library dropdown and its own error line — seven rows of that, and the
// operator's word for it was "long". The information was right and the shape
// was wrong: the member is doing ONE thing at a time, so there is one control
// and the list says what it is pointed at.
//
// Pick the line, press the button. The line then reports what happened:
//
//   GREEN + tick  attached, and the extraction agreed it is what you said
//   AMBER + !     attached, but we could not read what that document carries
//                 — usually the wrong type picked, occasionally a bad photo
//   PLAIN         nothing attached yet
//
// ⚠️ THE SAFE IS ONE LINE AND THREE PHOTOGRAPHS. It does not go green until
// all three are in, and it says which of the three are missing — an applicant
// who reads "photographs of your safe" and sends one has satisfied the phrase
// while the pack is short two shots nobody noticed.
// ────────────────────────────────────────────────────────────────────

export type Tier = 'required' | 'expected' | 'strengthens' | 'extra';

export interface ChecklistRow extends DocumentNeed {
  /** Attached files that answer this line. */
  files: UploadRow[];
  /** Library documents that could answer it without another photograph. */
  reusable: LibraryItem[];
}

export default function DocumentChecklist({
  rows,
  selected,
  onSelect,
  children,
  onView,
  onRemove,
}: {
  rows: ChecklistRow[];
  selected: string;
  onSelect: (kind: string) => void;
  /** The single upload control, rendered under the list. */
  children: React.ReactNode;
  onView: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Which document are you adding?"
      className="rounded border border-[var(--border)]"
    >
      <ul className="divide-y divide-[var(--border-divider)]">
        {rows.map((r) => (
          <Row
            key={r.kind}
            row={r}
            checked={selected === r.kind}
            onSelect={() => onSelect(r.kind)}
            onView={onView}
            onRemove={onRemove}
          />
        ))}
      </ul>
      <div className="border-t border-[var(--border-divider)] bg-[var(--bg-inset)] p-3">
        {children}
      </div>
    </div>
  );
}

function Row({
  row,
  checked,
  onSelect,
  onView,
  onRemove,
}: {
  row: ChecklistRow;
  checked: boolean;
  onSelect: () => void;
  onView: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  // ⚠️ AMBER IS NOT "BROKEN", IT IS "CHECK THIS". The document is attached and
  // will go in the pack either way; what we are saying is that nothing we
  // expected to find on it was there, which usually means the wrong line was
  // selected.
  const suspect = row.have && row.files.some((f) => f.suspect);
  const state: 'done' | 'suspect' | 'todo' = !row.have
    ? 'todo'
    : suspect
      ? 'suspect'
      : 'done';

  const colour =
    state === 'done'
      ? 'var(--success)'
      : state === 'suspect'
        ? 'var(--gold-line)'
        : 'var(--text-tertiary-on-card)';

  const missingParts = row.parts?.filter((p) => !p.have) ?? [];

  return (
    <li
      className="p-3"
      style={{
        background:
          state === 'done'
            ? 'rgba(47,158,107,0.08)'
            : state === 'suspect'
              ? 'var(--gold-wash)'
              : undefined,
      }}
    >
      <label className="flex cursor-pointer gap-3">
        <input
          type="radio"
          name="which-document"
          className="mt-1"
          checked={checked}
          onChange={onSelect}
          aria-label={row.label}
        />
        <span className="flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span aria-hidden style={{ color: colour }}>
              {state === 'done' ? '✓' : state === 'suspect' ? '!' : '○'}
            </span>
            <span
              className="text-sm"
              style={{
                color: state === 'done' ? 'var(--success)' : undefined,
              }}
            >
              {row.label}
            </span>
            {!row.have && row.tier === 'required' && (
              <span className="rounded bg-[var(--gold-wash)] px-1.5 py-0.5 text-xs">
                SAPS needs this
              </span>
            )}
            {/* ⚠️ NOT "OPTIONAL". The endorsement has no statute behind it and
                a DFO will still turn somebody away without it — see
                DocumentTier in motivation-documents.ts. */}
            {!row.have && row.tier === 'expected' && (
              <span className="rounded bg-[var(--gold-wash)] px-1.5 py-0.5 text-xs">
                Your DFO will ask for this
              </span>
            )}
            {!row.have && row.tier === 'strengthens' && (
              <span className="text-xs text-[var(--text-tertiary-on-card)]">
                optional — but it helps
              </span>
            )}
          </span>

          {/* THE SAFE, PART BY PART. Only while it is incomplete: once all
              three are in, naming them again is noise. */}
          {missingParts.length > 0 && (
            <span className="mt-1 block text-xs text-[var(--text-secondary)]">
              Still needed:{' '}
              {missingParts.map((p) => p.label.toLowerCase()).join('; ')}
            </span>
          )}

          {state === 'suspect' && (
            <span className="mt-1 block text-xs" style={{ color: 'var(--text-secondary)' }}>
              Attached — but nothing we expected on this document was readable.
              Check you picked the right line, and that the photograph shows
              the whole page. It stays in your pack either way.
            </span>
          )}

          {!row.have && (
            <button
              type="button"
              className="mt-1 text-xs underline"
              onClick={(e) => {
                e.preventDefault();
                setOpen((o) => !o);
              }}
            >
              {open ? 'Hide' : 'Why this one?'}
            </button>
          )}
          {open && !row.have && (
            <span className="mt-1 block text-xs text-[var(--text-secondary)]">
              {row.why}
            </span>
          )}

          {row.files.length > 0 && (
            <span className="mt-1 flex flex-wrap items-center gap-3 text-xs">
              {row.files.map((f) => (
                <span key={f.id} className="inline-flex items-center gap-2">
                  <span className="text-[var(--text-secondary)]">
                    {f.annexure ? `Annexure ${f.annexure}` : 'Attached'}
                  </span>
                  {f.available && (
                    <button
                      type="button"
                      className="underline"
                      onClick={(e) => {
                        e.preventDefault();
                        void onView(f.id);
                      }}
                    >
                      View
                    </button>
                  )}
                  <button
                    type="button"
                    className="underline"
                    onClick={(e) => {
                      e.preventDefault();
                      void onRemove(f.id);
                    }}
                  >
                    Remove
                  </button>
                </span>
              ))}
            </span>
          )}
        </span>
      </label>
    </li>
  );
}
