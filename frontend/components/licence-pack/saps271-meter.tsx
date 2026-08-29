'use client';

// ────────────────────────────────────────────────────────────────────
// THE SAPS 271, COMPLETING BESIDE THE PACK.
//
// ⚠️ COUNTED IN QUESTIONS, NOT IN FORM BOXES. The server settled this
// (saps271-coverage.ts, and the operator on 2026-08-28: "it needs to map per
// question, not per applicable box"). One question can fill six boxes; scoring
// boxes would tell a member they are 40% done when they have answered
// everything they were asked.
//
// ⚠️ `percent: null` IS UNSCORED AND IS NOT ZERO. Section F is the current
// owner's half of the form. Rendering null as an empty bar tells a member they
// are 0% done on work that was never theirs to do, which is the single most
// discouraging thing this panel could say.
// ────────────────────────────────────────────────────────────────────

import type { Saps271Coverage, CoverageSection } from '@/lib/motivations-api';

export default function Saps271Meter({
  coverage,
}: {
  coverage: Saps271Coverage;
}) {
  return (
    <aside className="rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-[.11em] text-[var(--text-tertiary)]">
        Your SAPS 271
      </h3>

      <p className="mt-2 text-[15px] text-[var(--text-primary)]">
        <span className="font-semibold">{coverage.percent}%</span> complete
      </p>
      <p className="text-[13px] text-[var(--text-secondary)]">
        {coverage.answered} of {coverage.applicable} questions answered
      </p>

      <Bar percent={coverage.percent} />

      <ul className="mt-4 space-y-2">
        {coverage.sections.map((s) => (
          <li key={s.id}>
            <SectionRow section={s} />
          </li>
        ))}
      </ul>
    </aside>
  );
}

function SectionRow({ section }: { section: CoverageSection }) {
  // `theirs` and a null percent travel together, but they are separate facts
  // and the panel checks the one it is actually about.
  const unscored = section.percent === null;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] text-[var(--text-primary)]">
          {section.label}
        </span>
        <span
          className="shrink-0 text-[12px]"
          style={{
            color: unscored
              ? 'var(--gold-strong)'
              : section.status === 'complete'
                ? 'var(--success)'
                : 'var(--text-tertiary)',
          }}
        >
          {unscored ? 'Not yours' : `${section.percent}%`}
        </span>
      </div>

      {/* No bar at all for an unscored section — an empty track reads as zero. */}
      {!unscored && <Bar percent={section.percent ?? 0} thin />}

      {section.note && (
        <p className="mt-0.5 text-[12px] leading-snug text-[var(--text-tertiary)]">
          {section.note}
        </p>
      )}

      {/* ⚠️ ONLY WHERE SOMETHING IS ACTUALLY MISSING. A "0 still needed" line
          on every finished section is noise that makes the real ones invisible. */}
      {section.missingRequired > 0 && (
        <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
          {section.missingRequired} still needed
        </p>
      )}
    </div>
  );
}

function Bar({ percent, thin = false }: { percent: number; thin?: boolean }) {
  // Clamped: a percentage outside 0–100 is a server bug, and a bar wider than
  // its track is a layout bug on top of it.
  const width = Math.max(0, Math.min(100, percent));
  return (
    <div
      className={`mt-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-inset)] ${
        thin ? 'h-1' : 'h-2'
      }`}
      role="progressbar"
      aria-valuenow={width}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-[var(--success)] transition-[width] duration-[var(--dur-fast)] ease-[var(--ease-out)]"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
