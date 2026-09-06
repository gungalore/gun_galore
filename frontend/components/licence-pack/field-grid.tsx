'use client';

// ────────────────────────────────────────────────────────────────────
// THE ARTBOARD'S KEY/VALUE GRID — "About you", and any step that is a
// settled list of facts rather than a document being read.
//
// Two columns on a wide screen, one on a phone. Each cell is a label above its
// value, with a provenance chip where the value came from somewhere, and the
// whole cell is the edit control when clicked.
//
// ⚠️ SENSITIVE VALUES ARE MASKED WHILE COLLAPSED AND SHOWN WHILE EDITING.
// The identity number and the cellphone are on screen so a member can check
// their own record, not so somebody behind them can read it. Masking a field
// while it is being corrected would make it uncorrectable.
// ────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import FieldInput from '@/components/motivation-field-input';
import { maskSensitive } from '@/lib/mask-sensitive';
// ⚠️ THE SHARED TONES, NOT A SECOND LADDER. This file had its own two-branch
// chip — gold when `inferred`, grey otherwise — and it could not tell "we could
// not fill this" from "we filled it, check it": an empty required box and a
// value read cleanly off a licence card both rendered as no chip at all, while
// ReadResult two steps away drew green / gold / grey for the same three cases.
// One vocabulary, one file. See components/motivation/provenance.tsx.
import { Pill, toneFor } from '@/components/motivation/provenance';
import type { MotivationField, ProvenanceMap } from '@/lib/motivations-api';

export default function FieldGrid({
  fields,
  answers,
  provenance,
  missing,
  onChange,
}: {
  fields: MotivationField[];
  answers: Record<string, string>;
  provenance: ProvenanceMap;
  missing: Set<string>;
  onChange: (key: string, value: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  if (!fields.length) return null;

  return (
    <div className="grid max-w-[800px] grid-cols-1 gap-x-7 sm:grid-cols-2">
      {fields.map((f) => {
        const raw = (answers[f.key] ?? '').trim();
        const p = provenance[f.key];
        const open = editing === f.key;
        const shown = f.sensitive && raw ? maskSensitive(raw, f.key) : raw;
        const tone = toneFor(p, Boolean(raw));

        if (open) {
          return (
            <div
              key={f.key}
              className="border-b border-[var(--border-divider)] py-2.5 sm:col-span-2"
            >
              <FieldInput
                field={f}
                value={answers[f.key] ?? ''}
                missing={missing.has(f.key)}
                onChange={(v) => onChange(f.key, v)}
              />
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="mt-2 text-[12px] text-[var(--text-secondary)] underline"
              >
                Done
              </button>
            </div>
          );
        }

        return (
          <button
            key={f.key}
            type="button"
            onClick={() => setEditing(f.key)}
            className="flex min-h-[44px] items-center gap-3 border-b border-[var(--border-divider)] py-2.5 text-left"
          >
            <span className="w-[126px] shrink-0 text-[12.5px] text-[var(--text-tertiary)]">
              {f.label}
            </span>

            <span
              className="min-w-0 flex-1 truncate text-[13.5px]"
              style={
                raw
                  ? { fontWeight: 500, color: 'var(--text-primary)' }
                  : { fontStyle: 'italic', color: 'var(--text-tertiary)' }
              }
            >
              {shown || (missing.has(f.key) ? 'Still needed' : 'Not given')}
            </span>

            {/* The chip is the server's own label, never a table here. */}
            <Pill tone={tone}>
              {tone === 'read'
                ? (p?.from ?? 'Read')
                : tone === 'check'
                  ? 'Check this'
                  : raw
                    ? 'You entered this'
                    : missing.has(f.key)
                      ? 'Still needed'
                      : 'Not given'}
            </Pill>
          </button>
        );
      })}
    </div>
  );
}
