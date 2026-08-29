'use client';

// ────────────────────────────────────────────────────────────────────
// "WE CAN SEE 119651, BUT NOT 117705."
//
// Operator, 2026-08-28: "the 117705 must always be requested by the system and
// alerted if it's missing", and asked where it should appear: "alert appears
// on both" — the document checklist and the competency step.
//
// ⚠️ ONE COMPONENT, RENDERED TWICE, READING ONE SERVED VALUE. Two surfaces
// each computing "do they have 117705" is how they come to disagree, and a
// member who is told the pack is complete on one screen and incomplete on the
// next stops believing either.
//
// ⚠️ TWO TONES, BECAUSE THERE ARE TWO DIFFERENT THINGS TO SAY.
//   MISSING — we read their statements and 117705 was not on any of them.
//             That is a real gap in the pack, and it is amber.
//   UNREAD  — we could not read any codes at all: a photograph at an angle, a
//             PDF, a document from before we kept the text. We must still ask,
//             but we must not accuse, so it is a quiet grey prompt.
//
// Rendering UNREAD in amber would tell somebody their paperwork is short when
// all that happened is our OCR failed.
// ────────────────────────────────────────────────────────────────────

import type { ProficiencyCover } from '@/lib/motivations-api';

export default function ProficiencyAlert({
  cover,
  className,
}: {
  cover: ProficiencyCover | undefined;
  className?: string;
}) {
  // CONFIRMED, or a response we never got. Nothing to say either way.
  if (!cover?.alert) return null;

  const missing = cover.state === 'MISSING';

  return (
    <div
      // Not role="alert": this renders on load, and an assertive live region
      // fires before the member has read the heading it sits under.
      role="note"
      className={`gg-tile rounded-[10px] px-3.5 py-3 ${className ?? ''}`}
      style={{
        background: missing ? 'var(--gold-wash)' : 'var(--bg-inset)',
        border: `1px solid ${missing ? 'var(--gold-line)' : 'var(--border-divider)'}`,
      }}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="mt-[1px] shrink-0 text-[13px] font-bold leading-none"
          style={{ color: missing ? 'var(--gold-strong)' : 'var(--text-tertiary)' }}
        >
          {missing ? '!' : '?'}
        </span>
        <div className="min-w-0">
          <p
            className="text-[12.5px] font-semibold"
            style={{ color: missing ? 'var(--gold-strong)' : 'var(--text-secondary)' }}
          >
            {missing
              ? 'Unit standard 117705 is not in the pack'
              : 'We could not read your proficiency codes'}
          </p>
          <p className="mt-1 text-[12.5px] leading-[1.5] text-[var(--text-secondary)]">
            {cover.alert}
          </p>

          {/*
            WHAT WE DID SEE. Operator: "So both codes needs to be visible."
            Without this the member is told what is missing and cannot check
            our working — and the commonest cause of the alert is a page they
            already own and did not think to include.
          */}
          {cover.held.length > 0 && (
            <p className="mt-1.5 text-[11.5px] text-[var(--text-tertiary)]">
              Codes we have read so far: {cover.held.join(', ')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
