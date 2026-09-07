'use client';

import { FullName } from '@/components/full-name';
import { DocSectionId } from '@/components/document-centre/kinds';
import {
  RowNode,
  competencySubline,
  firearmSubline,
  rowName,
} from '@/lib/document-centre-sections';
import {
  CredentialKind,
  CredentialRow,
  KIND_LABELS,
  STATE_TONE,
  formatDate,
} from '@/lib/licence-centre-api';
import { filedUnsure } from '@/lib/document-review-rules';

// ────────────────────────────────────────────────────────────────────
// ONE ROW.
//
// Presentational and deliberately thin: it names the document, says when it
// runs out and what state that puts it in, and nothing else. Everything you
// can DO to a document lives in the detail column, which is CredentialCard.
//
// WHAT IT KNOWS THAT THE OLD ROW DID NOT is which section it is standing in,
// because that is what decides the name. A firearm licence is called by the
// firearm; a training certificate is called by its unit standards; everything
// else is called by its title.
// ────────────────────────────────────────────────────────────────────

/**
 * The one key per kind that holds a licence or competency number, for the
 * monospaced column on the row.
 *
 * ⚠️ NOT "the first value in details". `details` is a flat bag, and one
 * document can carry several numbers that are not interchangeable — a
 * hunting association's letter alone holds a good-standing reference, a
 * membership number AND a dedicated status number (see WANTED in
 * licence-centre-extract.service.ts on the backend, which these keys mirror).
 * Reading the wrong one into this column would put the wrong reference in
 * front of a member who trusts the column enough not to open the document.
 *
 * ⚠️ AN ID COPY, A PROOF OF ADDRESS AND A SAFE PHOTOGRAPH HAVE NO ENTRY HERE
 * AT ALL, deliberately — none of them carries a licence or competency number.
 * An identity document's `id_number` is a different kind of number and does
 * not belong in a column about licences.
 */
const NUMBER_DETAIL_KEYS: Partial<Record<CredentialKind, string[]>> = {
  FIREARM_LICENCE: ['licence_number'],
  COMPETENCY_CERTIFICATE: ['competency_number'],
  DEDICATED_DISCIPLINE: [
    'status_number',
    'membership_number',
    'good_standing_number',
    'registration_number',
  ],
  DEDICATED_STATUS: ['status_number'],
  DEDICATED_HUNTER: ['status_number'],
  PROFESSIONAL_HUNTER: ['registration_number'],
  GOOD_STANDING: ['good_standing_number', 'membership_number', 'status_number'],
  PROFICIENCY: ['certificate_number'],
  OTHER: ['reference_number'],
};

/** Degrades to a dash — never a blank cell — when a document has no number. */
export function docNumber(row: CredentialRow): string {
  for (const key of NUMBER_DETAIL_KEYS[row.kind] ?? []) {
    const v = row.details[key];
    if (v && v.trim()) return v.trim();
  }
  return '—';
}

function subline(row: CredentialRow, section: DocSectionId): string[] {
  if (section === 'firearms') return firearmSubline(row);
  if (section === 'competency') return competencySubline(row);
  return [KIND_LABELS[row.kind] ?? row.kind];
}

export default function DocumentRow({
  node,
  section,
  selectedId,
  onSelect,
}: {
  node: RowNode;
  section: DocSectionId;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const row = node.row;
  /**
   * ⚠️ A TRAINING CERTIFICATE IS NEVER "IN DATE" OR "DATE NOT CONFIRMED".
   * A unit standard passed in 2019 is passed for good — there is no renewal
   * and nothing to remind on — so the chip says the one true thing about it
   * and does so in the neutral tone, because amber reads as an errand.
   */
  const tone =
    section === 'training'
      ? { ...STATE_TONE['no-expiry'], label: 'Kept' }
      : STATE_TONE[row.state];

  /**
   * ⚠️ THREE OUTCOMES, NOT TWO. A document the member has ANSWERED "never
   * expires" for and one nobody has supplied a date for both have a null
   * expiry and are opposites — the first is settled, the second is
   * outstanding.
   */
  const expiry =
    section === 'training' || row.neverExpires
      ? '—'
      : row.expiresOn
        ? formatDate(row.expiresOn)
        : 'Not set';

  const parts = subline(row, section).filter(Boolean);

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(row.id)}
        aria-current={row.id === selectedId ? 'true' : undefined}
        data-name-card
        className="grid w-full min-h-[44px] grid-cols-[minmax(0,1fr)_112px] items-center gap-3 rounded-[6px] px-3 py-2.5 text-left hover:bg-[var(--bg-card-hover)] sm:grid-cols-[minmax(0,1fr)_108px_112px_124px]"
        style={{
          background:
            row.id === selectedId ? 'var(--bg-inset)' : 'transparent',
          border: `1px solid ${row.id === selectedId ? 'var(--border)' : 'transparent'}`,
          outlineOffset: 2,
        }}
      >
        <span className="min-w-0">
          <FullName className="text-[13.5px] font-medium">
            {rowName(row, section)}
          </FullName>
          {row.otherSide && (
            <span className="ml-1.5 rounded-[3px] border border-[var(--border)] px-1.5 py-px text-[10.5px] text-[var(--text-tertiary-on-card)]">
              certificate + results
            </span>
          )}
          {parts.length > 0 && (
            <span className="mt-0.5 block truncate text-[11.5px] text-[var(--text-tertiary-on-card)]">
              {parts.join(' · ')}
            </span>
          )}
          {/* ⚠️ SAYING WE GUESSED, WHERE WE GUESSED. `namedConfident` was
              stored precisely so this survives a refresh, and it was read in
              the review queue and nowhere else — so a document we filed
              without being sure looked, on this list, exactly like one the
              member had filed themselves. A wrong box on a firearm licence is
              a renewal nothing will ever remind on. The row IS the way to
              change it: tapping it opens the card, which carries the type
              control. */}
          {filedUnsure(row) && !row.confirmed && (
            <span className="mt-1 block truncate text-[11px] font-medium text-[var(--warning)]">
              Filed as {KIND_LABELS[row.kind] ?? row.kind} — not sure, tap to
              change
            </span>
          )}
        </span>

        <span className="hidden truncate font-mono text-xs text-[var(--text-secondary)] sm:block">
          {docNumber(row)}
        </span>

        <span className="gg-nums hidden text-xs text-[var(--text-secondary)] sm:block">
          {expiry}
        </span>

        {/* State carries a word, never only a colour. */}
        <span
          className="justify-self-start rounded-full px-2.5 py-1 text-[11px] font-medium"
          style={{
            color: tone.colour,
            background: tone.wash,
            border: `1px solid ${tone.line}`,
          }}
        >
          {tone.label}
        </span>
      </button>

      {/* ⚠️ A COPY IS A LINE, NOT A ROW. The server already knows it is a copy
          of the row above; giving it a full row of its own is how a member
          comes to believe they hold two licences for one firearm. It is still
          reachable — tapping it opens it in the panel, which is where the
          delete lives. */}
      {node.copies.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onSelect(c.id)}
          aria-current={c.id === selectedId ? 'true' : undefined}
          className="ml-9 flex min-h-[44px] w-[calc(100%-2.25rem)] items-center rounded-[6px] border-l-2 border-[var(--border-divider)] px-3 text-left text-[11.5px] text-[var(--text-tertiary-on-card)] hover:bg-[var(--bg-card-hover)]"
          style={{
            background: c.id === selectedId ? 'var(--bg-inset)' : 'transparent',
          }}
        >
          also a copy added {formatDate(c.createdAt.slice(0, 10))}
        </button>
      ))}
    </li>
  );
}
