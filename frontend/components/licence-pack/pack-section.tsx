'use client';

// ────────────────────────────────────────────────────────────────────
// A REGISTRY SECTION, ASKED.
//
// Phase 2b: the three areas the pack screen had no home for — the firearms a
// member already owns, the six declaration questions, and the safe details.
//
// ⚠️ ONE COMPONENT, NOT THREE. The handoff spec names OwnedFirearms,
// DeclarationQuestions and SafeDetails as separate components, and they are
// not: the backend registry already groups every field by `section`, and
// `visibleFields()` already applies the same showIf/formOnly rule the server
// uses. Three bespoke components would be three places for that rule to drift
// from the one the server enforces. What genuinely differs between them is the
// repeating-row layout, and only one section has it.
//
// ⚠️ NOTHING HERE IS EVER PREFILLED FROM A DOCUMENT, AND THE DECLARATIONS
// LEAST OF ALL. Convictions, pending cases and unfitness findings are the
// applicant's own statements under section 120(9)(f); a value we suggested
// would be us making a claim about somebody's criminal record. No chip, no
// offer, no lock — ever.
// ────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import FieldInput from '@/components/motivation-field-input';
import { visibleFields, type MotivationField } from '@/lib/motivations-api';
import {
  groupRows,
  rowIndex,
  rowsToShow,
} from '@/lib/owned-firearm-rows';

export default function PackSection({
  title,
  intro,
  section,
  fields,
  answers,
  missing,
  onChange,
}: {
  title: string;
  intro?: string;
  /** The registry's own section name — the join key, not a display string. */
  section: string;
  fields: MotivationField[];
  answers: Record<string, string>;
  /** Keys the server says are required and still empty. */
  missing: Set<string>;
  onChange: (key: string, value: string) => void;
}) {
  const mine = useMemo(
    () =>
      visibleFields(fields, answers).filter((f) => f.section === section),
    [fields, answers, section],
  );

  const rows = useMemo(() => groupRows(mine), [mine]);

  const plain = mine.filter((f) => rowIndex(f.key) === null);

  if (!mine.length) return null;

  return (
    <section>
      {/* The wizard supplies its own step heading, so this one is optional —
          two headings stacked on one panel is the duplicate the flat screen
          shipped with. */}
      {title && (
        <h3 className="text-[11px] font-semibold uppercase tracking-[.11em] text-[var(--text-tertiary)]">
          {title}
        </h3>
      )}
      {intro && (
        <p className="mt-1 text-[13px] leading-snug text-[var(--text-secondary)]">
          {intro}
        </p>
      )}

      {plain.length > 0 && (
        <div className="mt-3 space-y-3">
          {plain.map((f) => (
            <FieldInput
              key={f.key}
              field={f}
              value={answers[f.key] ?? ''}
              missing={missing.has(f.key)}
              onChange={(v) => onChange(f.key, v)}
            />
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <RepeatingRows
          rows={rows}
          answers={answers}
          missing={missing}
          onChange={onChange}
        />
      )}
    </section>
  );
}

/**
 * The firearms a member already owns — six rows of seven columns.
 *
 * ⚠️ EMPTY ROWS ARE HIDDEN BEHIND "ADD ANOTHER", NOT RENDERED BLANK. Six empty
 * rows of seven fields is forty-two empty boxes, and a member who owns one
 * firearm should not be shown a form that implies they are missing five. A row
 * counts as in use the moment ANY of its columns has a value — the vault fills
 * these from the member's own licences, so most are already populated before
 * anybody types.
 */
function RepeatingRows({
  rows,
  answers,
  missing,
  onChange,
}: {
  rows: [number, MotivationField[]][];
  answers: Record<string, string>;
  missing: Set<string>;
  onChange: (key: string, value: string) => void;
}) {
  // ⚠️ THE RULE IS TESTED, NOT INLINE. It was inline and it was WRONG: it
  // counted HOW MANY rows were in use rather than which was the LAST, so a
  // member whose vault had filled rows 1 and 4 was shown three rows and row 4
  // — carrying their own data — silently disappeared. See
  // lib/owned-firearm-rows.ts and its spec.
  const [extra, setExtra] = useState(0);
  const shown = rowsToShow(rows, answers, extra);
  const canAdd = shown.length < rows.length;

  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="mt-3 space-y-2">
      {shown.map(([n, fs]) => {
        // Collapsed, a row is what identifies the firearm; expanded, it is the
        // seven boxes the registry actually asks for.
        const make = answers[`existing_firearm_${n}_make`] ?? '';
        const calibre = answers[`existing_firearm_${n}_calibre`] ?? '';
        const summary = [make, calibre].filter(Boolean).join(' · ');
        const isOpen = open === n;

        return (
          <div
            key={n}
            className="gg-tile rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-card)]"
          >
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : n)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-3 px-[15px] py-[13px] text-left"
            >
              <span className="text-[14px] text-[var(--text-primary)]">
                {summary || `Firearm ${n}`}
              </span>
              <span className="text-[12px] text-[var(--text-tertiary)]">
                {isOpen ? 'Close' : summary ? 'Edit' : 'Add'}
              </span>
            </button>

            {isOpen && (
              <div className="space-y-3 border-t border-[var(--border-divider)] px-[15px] py-[13px]">
                {fs.map((f) => (
                  <FieldInput
                    key={f.key}
                    field={f}
                    value={answers[f.key] ?? ''}
                    missing={missing.has(f.key)}
                    onChange={(v) => onChange(f.key, v)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {canAdd && (
        <button
          type="button"
          onClick={() => {
            setExtra((n) => n + 1);
            setOpen(shown.length + 1);
          }}
          className="text-[13px] text-[var(--text-secondary)] underline"
        >
          Add another firearm
        </button>
      )}
    </div>
  );
}
