'use client';

// ────────────────────────────────────────────────────────────────────
// THE SAPS 271, ON EVERY STEP. Built to the design mockup's own spec.
//
// The numbers and shapes here are the mockup's, read off Main.dc.html rather
// than approximated: 33px Archivo headline, a monospace section letter in a
// 22px column, a 6px pill bar indented 30px to clear it, an 11px note under
// the bar, and an explanation of the counting rule at the foot.
//
// ⚠️ COUNTED IN QUESTIONS, NOT IN FORM BOXES, and the mockup agrees with the
// server on the substance even though it says "boxes": its own footnote is
// "a section counts only the boxes that apply to you — answering no to a
// history question closes its four follow-ups; an owned-firearm row you never
// use is not an empty box". That is what saps271-coverage.ts computes.
// Counting everything would peg an honest applicant near 40% forever.
//
// ⚠️ `percent: null` IS UNSCORED AND IS NOT ZERO. Section F is the current
// owner's half. The mockup renders it gold with the word "waiting" and a token
// 8% sliver so the row does not read as empty — kept, because a bar at 0% and
// a bar that is absent both say "you are behind" about work that was never
// the member's to do.
// ────────────────────────────────────────────────────────────────────

import type { Saps271Coverage, CoverageSection } from '@/lib/motivations-api';

export default function Saps271Meter({
  coverage,
}: {
  coverage: Saps271Coverage;
}) {
  return (
    <aside className="lg:border-l lg:border-[var(--border)] lg:pl-6">
      <div className="text-[11px] font-medium uppercase tracking-[.11em] text-[var(--text-tertiary)]">
        SAPS 271 — what is filled
      </div>

      <div className="mt-[9px] flex items-baseline gap-2">
        <span className="font-[family-name:var(--font-head)] text-[33px] font-medium leading-none tabular-nums text-[var(--text-primary)]">
          {coverage.percent}%
        </span>
        <span className="text-[12.5px] text-[var(--text-tertiary)]">
          of the boxes that apply to you
        </span>
      </div>

      <div className="mt-[18px] flex flex-col gap-[11px]">
        {coverage.sections.map((s) => (
          <SectionRow key={s.id} section={s} />
        ))}
      </div>

      <p className="mt-[18px] border-t border-[var(--border-divider)] pt-3.5 text-[12px] leading-normal text-[var(--text-tertiary)]">
        A section counts only the boxes that apply to you. Answering
        &ldquo;no&rdquo; to a history question closes its follow-ups; an
        owned-firearm row you never use is not an empty box.
      </p>
    </aside>
  );
}

function SectionRow({ section }: { section: CoverageSection }) {
  // Somebody else's half of the form. Gold, and the word rather than a number.
  const waiting = section.percent === null;
  const pct = section.percent ?? 0;

  // ⚠️ IN PROGRESS IS GOLD, NOT RED — the same rule pack-row.tsx states in
  // capitals ("WAITING IS GOLD, NEVER RED"), and this panel broke it on every
  // step. A section half-filled is work in hand, not a failure: painting it in
  // the one colour this site reserves for errors and primary actions tells a
  // member who has answered six of ten questions that they have done something
  // wrong, and it spends red on the eight rows beside the one thing on screen
  // that might genuinely need it.
  //
  // Green at 100, gold while it is being filled, the plain border colour at
  // zero so an untouched section reads as "not yet" rather than as a failure.
  const fill = waiting
    ? 'var(--gold)'
    : pct === 100
      ? 'var(--success)'
      : pct > 0
        ? 'var(--gold)'
        : 'var(--border)';

  const ink = waiting
    ? 'var(--gold-strong)'
    : pct === 100
      ? 'var(--success)'
      : pct > 0
        ? 'var(--text-primary)'
        : 'var(--text-tertiary)';

  return (
    <div>
      <div className="mb-1 flex items-baseline gap-2">
        {/* The letter the form itself uses, so the panel and the paper agree. */}
        <span className="w-[22px] shrink-0 font-mono text-[11px] text-[var(--text-tertiary)]">
          {section.id}
        </span>
        <span className="min-w-0 flex-1 text-[12.5px] text-[var(--text-primary)]">
          {section.label}
        </span>
        <span
          className="text-[11.5px] font-medium tabular-nums"
          style={{ color: ink }}
        >
          {waiting ? 'waiting' : `${pct}%`}
        </span>
      </div>

      <div className="ml-[30px] h-[6px] overflow-hidden rounded-full bg-[var(--bg-inset)]">
        <div
          className="h-full rounded-full"
          style={{
            // A token sliver while waiting: a bar at 0 reads as failure, and
            // this row is not the member's to fail.
            width: `${waiting ? 8 : Math.max(0, Math.min(100, pct))}%`,
            background: fill,
            transition: 'width .5s var(--ease-out)',
          }}
        />
      </div>

      {(section.note || section.missingRequired > 0) && (
        <div className="ml-[30px] mt-1 text-[11px] text-[var(--text-tertiary)]">
          {section.note ??
            `${section.missingRequired} still needed`}
        </div>
      )}
    </div>
  );
}
