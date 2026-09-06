'use client';

// ────────────────────────────────────────────────────────────────────
// A YES/NO QUESTION, ANSWERED IN THE OPEN.
//
// The artboard's declarations step draws six rows, each a visible pair of
// pills. Not a dropdown, and not hidden behind a "still needed" chip: these
// are the six questions only the applicant can answer, and burying each one
// behind a click makes a page of six look like a page of nothing.
//
// ⚠️ NOTHING IS PRE-SELECTED, AND THE ARTBOARD IS WRONG ABOUT THIS.
// It draws all six rows with "No" already chosen, because it is a picture of a
// finished application. Shipping that would have the platform putting words
// about somebody's criminal record into their mouth — and these answers are
// signed under section 120(9)(f) of the Firearms Control Act.
//
// The registry's own rule for this section says it in as many words: no chip,
// no offer, no lock, ever. An unanswered question stays unanswered until the
// member touches it.
//
// Measurements off the artboard: row is flex, 14px gap, question at 13.5px
// taking the free space; pills 12.5px, 6px 15px padding, 6px radius; selected
// carries a --red keyline over a 5% red wash at weight 600, unselected a
// --border keyline and --text-tertiary ink.
// ────────────────────────────────────────────────────────────────────

import type { MotivationField } from '@/lib/motivations-api';

export default function YesNoPills({
  field,
  value,
  missing,
  onChange,
}: {
  field: MotivationField;
  value: string;
  /** Required and still empty — the row says so rather than assuming. */
  missing: boolean;
  onChange: (v: string) => void;
}) {
  // ⚠️ THE REGISTRY'S OWN ORDER, AND IT IS DELIBERATE. YES_NO is ['No','Yes']
  // because a wizard should not present "Yes" as the first, easiest tap on a
  // question about a conviction.
  const options = field.choices?.length ? field.choices : ['No', 'Yes'];
  const chosen = (value ?? '').trim();

  return (
    <div className="flex flex-wrap items-center gap-3.5 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] leading-snug text-[var(--text-primary)]">
          {field.label}
        </p>
        {field.help && (
          <p className="mt-0.5 text-[12px] leading-snug text-[var(--text-tertiary)]">
            {field.help}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {options.map((opt) => {
          const on = chosen === opt;
          return (
            <button
              key={opt}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? '' : opt)}
              // ⚠️ 44px, ON THE SIX QUESTIONS SIGNED UNDER s120(9)(f). A pill
              // 12.5px tall with 6px of padding is a 27px target on the one
              // screen where a mis-tap answers a question about somebody's
              // criminal record.
              className="min-h-[44px] rounded-[var(--r-sm)] px-[15px] py-1.5 text-[12.5px]"
              style={
                on
                  ? {
                      border: '1px solid var(--red)',
                      // ⚠️ THE TOKEN, NOT A HAND-MIXED rgba. A literal here is
                      // a fourth definition of the brand red that no theme
                      // change can reach — see globals.css beside --red-wash.
                      background: 'var(--red-wash)',
                      fontWeight: 500,
                      color: 'var(--text-primary)',
                    }
                  : {
                      border: `1px solid ${
                        missing ? 'var(--warning)' : 'var(--border)'
                      }`,
                      color: 'var(--text-tertiary)',
                    }
              }
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
