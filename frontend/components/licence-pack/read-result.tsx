'use client';

// ────────────────────────────────────────────────────────────────────
// "WE READ 11 OF THE 15 BOXES SECTION E ASKS FOR."
//
// The heart of the design, and the part that was missing entirely: a step is
// not a form, it is a REVIEW of what we read off the member's own document.
// Every line carries where its value came from, and every line is editable in
// place.
//
// Measurements read off the artboard: an 8px card with a --border keyline; an
// 11px uppercase .11em eyebrow; rows at 13.5px separated by --border-divider;
// the label column --text-tertiary at 12.5px; the value 13.5px, 500 weight
// when filled and italic --text-tertiary when not; a pill on the right at
// 10.5px/600 with a 999px radius.
//
// ⚠️ THE PILL IS THE POINT, AND ITS COLOUR MEANS SOMETHING.
//   green  — we read this off your document and it is unambiguous
//   gold   — we read it but you should check it, or somebody else owes it
//   grey   — the document says nothing here, or only you know it
// Gold is never red: a value that needs checking is not an error.
//
// ⚠️ AND THE CHIP TEXT IS THE SERVER'S. Every provenance entry carries its own
// `from` string, and SOURCE_LABELS lives in the backend precisely so the API,
// the printed pack and this panel cannot drift.
// ────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import FieldInput from '@/components/motivation-field-input';
// ⚠️ SHARED, NOT LOCAL. `toneFor` and `Pill` used to live in this file and the
// live wizard therefore had no way to say where a value came from — see
// components/motivation/provenance.tsx.
import { Pill, toneFor } from '@/components/motivation/provenance';
import type {
  MotivationField,
  ProvenanceMap,
} from '@/lib/motivations-api';

export default function ReadResult({
  stepKey,
  section,
  fields,
  answers,
  provenance,
  missing,
  onChange,
}: {
  /**
   * Which step is being reviewed.
   *
   * ⚠️ ONLY SO THE FOOTNOTE CAN BE TRUE. "We took nothing about the person …
   * this step is about the firearm" is the right thing to say under a licence
   * card read for its make and serials, and a false one under the competency
   * certificate, the association card or the safe photographs — where the
   * panel rendered it anyway, on every step it drew. A promise about what we
   * kept off somebody's document is not a decoration to repeat.
   */
  stepKey: string;
  /** The registry section this panel is reviewing. */
  section: string;
  fields: MotivationField[];
  answers: Record<string, string>;
  provenance: ProvenanceMap;
  missing: Set<string>;
  onChange: (key: string, value: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);

  if (!fields.length) return null;

  const filled = fields.filter((f) => (answers[f.key] ?? '').trim());

  return (
    <div className="max-w-[800px] rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-card)]">
      <div className="border-b border-[var(--border-divider)] px-4 py-3 text-[11px] font-medium uppercase tracking-[.11em] text-[var(--text-tertiary)]">
        {/* ⚠️ COUNTED, NOT WRITTEN. The mockup's "11 of the 15" is a caption on
            a picture; here it is what this member actually has. */}
        We have {filled.length} of the {fields.length} answers this section asks
        for
      </div>

      <div>
        {fields.map((f) => {
          const value = (answers[f.key] ?? '').trim();
          const p = provenance[f.key];
          const tone = toneFor(p, Boolean(value));
          const open = editing === f.key;

          return (
            <div
              key={f.key}
              className="border-b border-[var(--border-divider)] px-4 py-2.5 last:border-b-0"
            >
              {open ? (
                <FieldInput
                  field={f}
                  value={answers[f.key] ?? ''}
                  missing={missing.has(f.key)}
                  onChange={(v) => onChange(f.key, v)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditing(f.key)}
                  className="flex w-full items-center gap-3 text-left"
                >
                  <span className="w-[130px] shrink-0 text-[12.5px] text-[var(--text-tertiary)]">
                    {f.label}
                  </span>

                  <span
                    className="min-w-0 flex-1 truncate text-[13.5px]"
                    style={
                      value
                        ? { fontWeight: 500, color: 'var(--text-primary)' }
                        : {
                            fontStyle: 'italic',
                            color: 'var(--text-tertiary)',
                          }
                    }
                  >
                    {/* ⚠️ AN EMPTY BOX SAYS WHOSE IT IS. "Not read" on a line
                        only the member can answer would be blaming the
                        document for a question it was never asked. */}
                    {value || (f.docSourced ? 'Not on the document' : 'You may know it')}
                  </span>

                  {/* The server's own words — never a label table here. */}
                  <Pill tone={tone}>
                    {tone === 'read'
                      ? (p?.from ?? 'Read')
                      : tone === 'check'
                        ? 'Check this'
                        : value
                          ? 'You entered this'
                          : 'Still needed'}
                  </Pill>
                </button>
              )}

              {open && (
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="mt-2 text-[12px] text-[var(--text-secondary)] underline"
                >
                  Done
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* ⚠️ SAY WHAT WE DID NOT TAKE. A licence card carries a name, an
          identity number and a photograph, and a member handing one over is
          entitled to know none of that was kept. The mockup puts this at the
          foot of the panel and it is not decoration — which is exactly why it
          may only appear where it is TRUE. See stepKey. */}
      {stepKey === 'firearm' && (
        <p
          className="rounded-b-[var(--r-md)] border-t px-4 py-3 text-[12.5px] leading-snug"
          style={{
            borderColor: 'var(--gold-line)',
            background: 'var(--gold-wash)',
            color: 'var(--text-secondary)',
          }}
        >
          <span className="font-medium text-[var(--gold-strong)]">
            We took nothing about the person.
          </span>{' '}
          A card carries a name, an identity number and a photograph. None of
          it was asked for and none of it was kept — this step is about the
          firearm.
        </p>
      )}
    </div>
  );
}
