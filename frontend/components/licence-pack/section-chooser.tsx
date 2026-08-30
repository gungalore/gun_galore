'use client';

// ────────────────────────────────────────────────────────────────────
// STEP ONE, WHEN THERE IS NOTHING TO STEP THROUGH YET.
//
// Operator, 2026-08-29: "Motivation centre and Section 1 of an application is
// basically the same thing, why not incorporate them into one?" — then: "On
// motivation centre just have start a new application and the current pending
// applications", and "in section 1 user can select which application they want
// to start with".
//
// So the five section cards left the Centre and became this. The Centre now
// lists what is in flight and offers one door; the choosing happens on step
// one, where it reads as the first question of the application rather than a
// menu standing in front of it.
//
// ⚠️ CHOOSING IS WHAT CREATES THE APPLICATION, AND THAT IS NOT AN
// IMPLEMENTATION DETAIL — IT IS THE WHOLE REASON THIS COMPONENT EXISTS
// SEPARATELY FROM THE STEP-ONE PANEL ON A REAL APPLICATION.
//
// `Motivation.licenceType` is written exactly once, by create(), and there is
// no route anywhere that can change it afterwards. That is deliberate: the
// field registry, the document checklist, the SAPS 271 box mapping, the
// eligibility blockers and the generator's own legal framing are every one of
// them a pure function of it. Creating a row with a placeholder and resolving
// it here would mean the prefill was computed against the wrong registry and
// `sanitiseAnswers` had already dropped anything the placeholder type did not
// recognise — silently, with the member's answers gone and no audit trail.
//
// The Prisma column is non-nullable with no default, the DTO's @IsEnum has no
// @IsOptional, and the enum has no blank member — so the shape below is not a
// workaround, it is the only honest one: ask first, create second.
// ────────────────────────────────────────────────────────────────────

import { LICENCE_TYPES } from '@/lib/licence-labels';

export default function SectionChooser({
  canStart,
  busy,
  error,
  onChoose,
}: {
  /** False when the free beta is full. */
  canStart: boolean;
  /** The value currently being created, or null. */
  busy: string | null;
  error: string | null;
  onChoose: (value: string) => void;
}) {
  return (
    <div className="max-w-[820px]">
      {/* ⚠️ SAY IT BEFORE THEY CLICK, NOT AFTER. The server refuses with a
          perfectly clear 409 — "The free beta is full for now" — and the old
          Centre rendered that message BELOW five cards, well under the fold.
          Clicking the top card therefore looked like nothing happening at all,
          and the explanation was somewhere the member never scrolled to. */}
      {!canStart && (
        <p
          role="status"
          className="mb-3 rounded-[var(--r-sm)] border p-3 text-[13px]"
          style={{
            borderColor: 'var(--gold-line)',
            background: 'var(--gold-wash)',
          }}
        >
          The free beta is full, and paid applications are not open yet. You can
          still finish any application you have already started.
        </p>
      )}

      {/* The error lives ABOVE the list. Wherever they clicked, it is the next
          thing they see rather than the last. */}
      {error && (
        <p role="alert" className="mb-3 text-[13px] text-[var(--red)]">
          {error}
        </p>
      )}

      <ul className="space-y-2">
        {LICENCE_TYPES.map((t) => (
          <li key={t.value}>
            <button
              type="button"
              // ⚠️ EVERY CARD GOES DOWN WHILE ONE IS WORKING, not just the one
              // pressed. Creating allocates an MO number and is throttled at
              // five a minute; a second click on a neighbouring card while the
              // first is in flight spends one of those five on an application
              // the member did not mean to start and cannot delete.
              disabled={busy !== null || !canStart}
              onClick={() => onChoose(t.value)}
              className="gg-tile gg-tile-lift w-full rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-card)] p-3 text-left hover:bg-[var(--bg-card-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="text-[11px] font-semibold uppercase tracking-[.09em] text-[var(--text-tertiary)]">
                {t.section}
              </span>
              <span className="block text-[15px] font-semibold text-[var(--text-primary)]">
                {t.label}
              </span>
              <span className="block text-[13px] text-[var(--text-secondary)]">
                {busy === t.value ? 'Starting…' : t.blurb}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {/* ⚠️ SAY THAT IT IS FIXED, HERE, WHERE IT CAN STILL BE CHANGED FOR FREE.
          A member finds out on step one of a REAL application that the section
          cannot be flipped — and by then they have an MO number. Said at the
          moment of choosing, it costs them nothing to get right. */}
      <p className="mt-4 text-[12.5px] text-[var(--text-tertiary)]">
        Each section asks different questions and needs different documents, so
        this is fixed once the application starts. Applying under two sections
        means two applications.
      </p>
    </div>
  );
}
