'use client';

// ────────────────────────────────────────────────────────────────────
// THE STICKY STRIP — reference, licence type, one progress figure, the
// section chips, and the Preview toggle.
//
// ⚠️ THE PROGRESS FIGURE AND THE CHIP DOTS READ ONE LIST. `missing` comes from
// the server and nothing here recomputes it. The screen this replaces carried
// four progress systems that could contradict each other; there are two now —
// this strip and the footer — and both read the same number.
//
// ⚠️ THE CHIPS ARE ANCHOR LINKS, NOT ROUTER PUSHES. Each section carries
// `scroll-margin-top: 120px` so a tap lands the heading under this strip
// rather than behind it.
// ────────────────────────────────────────────────────────────────────

export interface SheetHeaderProps {
  reference: string;
  licenceType: string;
  missingCount: number;
  sections: { id: string; label: string; missing: number }[];
  /** Which section the reader is in. Driven by an IntersectionObserver. */
  active: string;
  /**
   * Tapped a chip.
   *
   * ⚠️ THE ANCHOR STILL DOES THE SCROLLING. This only opens the section it is
   * about to land on — sections fold now, and a chip that scrolls you to a
   * closed heading is worse than the scroll it replaced.
   */
  onJump?: (id: string) => void;
  previewOpen: boolean;
  onTogglePreview: () => void;
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="12"
        cy="12"
        r="2.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export default function SheetHeader({
  reference,
  licenceType,
  missingCount,
  sections,
  active,
  onJump,
  previewOpen,
  onTogglePreview,
}: SheetHeaderProps) {
  const ready = missingCount === 0;

  return (
    <div className="sticky top-[var(--shell-header-h,54px)] z-[4] border-b border-[var(--border-divider)] bg-[var(--bg)] lg:top-0">
      <div className="flex items-center gap-[10px] px-4 pb-[6px] pt-[10px]">
        <span className="flex-shrink-0 font-mono text-[12.5px] text-[var(--text-tertiary)]">
          {reference}
        </span>
        <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[13.5px] font-medium text-[var(--text-primary)]">
          {licenceType}
        </span>
        <span
          className={`ml-auto flex-shrink-0 whitespace-nowrap rounded-full border px-[10px] py-1 text-[11.5px] font-medium ${
            ready
              ? 'border-[var(--success-line)] bg-[var(--success-wash)] text-[var(--success)]'
              : 'border-[color-mix(in_srgb,var(--warning)_38%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] text-[var(--warning)]'
          }`}
        >
          {ready
            ? 'Ready to write'
            : `${missingCount} thing${missingCount === 1 ? '' : 's'} left`}
        </span>
      </div>

      <div className="flex items-center gap-2 px-4 pb-[10px] pt-1">
        <div className="flex min-w-0 flex-1 gap-[6px] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={() => onJump?.(s.id)}
              className={`inline-flex h-[30px] flex-shrink-0 items-center gap-[5px] whitespace-nowrap rounded-full border px-[11px] text-[12px] ${
                s.id === active
                  ? 'border-[var(--red)] bg-[var(--red-wash)] font-medium text-[var(--text-primary)]'
                  : 'border-[var(--border)] bg-[var(--bg)] text-[var(--text-secondary)]'
              }`}
            >
              {/*
                ⚠️ AMBER MEANS THIS SECTION OWNS SOMETHING OUTSTANDING; GREEN
                MEANS IT DOES NOT. Both come from the one `missing` list, split
                by section on the server — so a chip cannot say green while the
                footer counts the same key.
              */}
              <span
                className={`h-[6px] w-[6px] rounded-full ${
                  s.missing > 0
                    ? 'bg-[var(--warning)]'
                    : 'bg-[var(--success)]'
                }`}
              />
              {s.label}
            </a>
          ))}
        </div>
        <button
          type="button"
          onClick={onTogglePreview}
          aria-pressed={previewOpen}
          className={`inline-flex h-[30px] flex-shrink-0 items-center gap-[5px] rounded-[var(--r-sm)] border px-[10px] text-[12px] ${
            previewOpen
              ? 'border-[var(--red)] bg-[var(--red-wash)] font-medium text-[var(--text-primary)]'
              : 'border-[var(--border)] bg-[var(--bg)] text-[var(--text-secondary)]'
          }`}
        >
          <EyeIcon />
          Preview
        </button>
      </div>
    </div>
  );
}
