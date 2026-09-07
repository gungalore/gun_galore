'use client';

import { ReactNode } from 'react';
import { SectionView } from '@/lib/document-centre-sections';

// ────────────────────────────────────────────────────────────────────
// ONE SECTION OF THE DOCUMENT CENTRE.
//
// ⚠️ A REAL BUTTON, NOT A <details>/<summary>. The header carries a title, a
// summary line and a count, and Safari's default summary marker plus its
// display rules make that layout a fight; a button with `aria-expanded` says
// the same thing to a screen reader and lays out as a grid.
//
// ⚠️ AND THE SUMMARY IS THE POINT OF COLLAPSING AT ALL. "Is anything wrong in
// here" has to be answerable without opening the section, or a member on a
// phone is opening six of them to find out — which is the scrolling the
// folder rail this replaces was already costing them.
// ────────────────────────────────────────────────────────────────────

export default function DocumentSection({
  view,
  open,
  onToggle,
  onAdd,
  children,
}: {
  view: SectionView;
  open: boolean;
  onToggle: () => void;
  /** Opens the add controls. Null where the section offers nothing to add. */
  onAdd: (() => void) | null;
  children: ReactNode;
}) {
  const { section, count, summary, emptied } = view;
  // ⚠️ FORCED SHUT WHEN A FILTER EMPTIED IT. Its summary already says "None
  // of these here"; opening it would show that sentence twice, once as a
  // heading and once as an empty state.
  const shown = open && !emptied;

  return (
    <section className="gg-tile mt-2 overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--bg-card)]">
      <h3>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={shown}
          disabled={emptied}
          className="grid w-full min-h-[44px] grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2.5 px-3.5 py-3 text-left hover:bg-[var(--bg-card-hover)] disabled:cursor-default disabled:hover:bg-transparent"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--text-tertiary)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className="shrink-0 transition-transform"
            style={{ transform: shown ? 'rotate(90deg)' : 'none' }}
          >
            <path d="m9 5 7 7-7 7" />
          </svg>
          <span className="min-w-0">
            <span className="block text-[14.5px] font-medium text-[var(--text-primary)]">
              {section.title}
            </span>
            <span className="mt-0.5 block truncate text-[12px] text-[var(--text-tertiary-on-card)]">
              {summary}
            </span>
          </span>
          <span className="gg-nums shrink-0 text-[12.5px] text-[var(--text-tertiary)]">
            {count}
          </span>
        </button>
      </h3>

      {shown && (
        <div className="border-t border-[var(--border-divider)] p-1.5">
          {count === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 px-2.5 py-2.5">
              <span className="min-w-0 text-[12.5px] text-[var(--text-tertiary-on-card)]">
                {section.emptyLine}
              </span>
              {onAdd && (
                <button
                  type="button"
                  onClick={onAdd}
                  className="min-h-[44px] rounded-[6px] px-2 text-[13px] font-medium text-[var(--red)] hover:underline"
                >
                  Add
                </button>
              )}
            </div>
          ) : (
            children
          )}
        </div>
      )}
    </section>
  );
}
