'use client';

import type { SheetItem } from './contract';

// ────────────────────────────────────────────────────────────────────
// COMPETENCY — one line per certificate, and nothing else.
//
// ⚠️ THIS REPLACES A DIAGNOSTICS DUMP. The live walkthrough found the
// competency step showing: two scanner blocks, two reuse dropdowns listing
// nine vault credentials, a warning that we could not read the proficiency
// codes, a note that competency would be filled in "as soon as you have said
// which firearm this application is for", and a stray line about a Marlin
// being a duplicate of Firearm 2. All of it true, none of it the member's
// business.
//
// When the vault holds the certificates, this section is one line each and a
// Change link. That is the whole screen.
//
// ⚠️ THE UPLOAD DOOR APPEARS ONLY WHEN THE VAULT HAS NOTHING FOR THIS FIREARM
// TYPE. Offering a scanner to somebody whose competency we have already read
// is asking them to redo work we did for them.
// ────────────────────────────────────────────────────────────────────

export interface CompetencyLinesProps {
  items: SheetItem[];
  /**
   * Does the vault cover the firearm type applied for?
   *
   * ⚠️ NOT COMPUTED HERE. `requiredEndorsement()` on the server decides which
   * endorsement this firearm needs and whether the member holds it; a second
   * implementation on the screen would eventually disagree with the one that
   * blocks generation.
   */
  covered: boolean;
  /** What is needed but missing — "a Semi-auto Rifle certificate". */
  missingEndorsement?: string;
  onAdd: () => void;
  onChange: (key: string, value: string) => void;
}

export default function CompetencyLines({
  items,
  covered,
  missingEndorsement,
  onAdd,
  onChange,
}: CompetencyLinesProps) {
  const known = items.filter(
    (i) => i.state === 'filled' || i.state === 'suggested',
  );

  return (
    <div>
      {known.map((i) => (
        <div
          key={i.key}
          className="flex items-start justify-between gap-3 border-b border-[var(--border-divider)] py-[11px] last:border-b-0"
        >
          <div>
            <div className="text-[12.5px] leading-[1.3] text-[var(--text-secondary)]">
              {i.label}
            </div>
            <div className="mt-[2px] text-[14.5px] font-medium leading-[1.3] text-[var(--text-primary)]">
              {i.value}
            </div>
            {i.provenance ? (
              <div className="mt-1 text-[12px] text-[var(--text-tertiary)]">
                from {i.provenance.from.charAt(0).toLowerCase()}
                {i.provenance.from.slice(1)}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onChange(i.key, i.value)}
            className="min-h-[44px] flex-shrink-0 rounded-[6px] px-2 text-[13px] font-medium text-[var(--red)] hover:underline"
          >
            Change
          </button>
        </div>
      ))}

      {/*
        ⚠️ GREEN WHEN COVERED, GOLD WHEN NOT — never red. A missing endorsement
        is a document to fetch, not a mistake the member has made, and it is
        frequently one they already hold and have not uploaded yet.
      */}
      <p
        className={`m-0 mt-2 text-[12.5px] leading-[1.4] ${
          covered ? 'text-[var(--success)]' : 'text-[var(--gold-strong)]'
        }`}
      >
        {covered
          ? 'Your competency covers the firearm you are applying for.'
          : (missingEndorsement ??
            'We do not yet have a competency certificate covering this type of firearm.')}
      </p>

      {!covered ? (
        <button
          type="button"
          onClick={onAdd}
          className="mt-2 min-h-[44px] w-full rounded-[var(--r-sm)] border border-dashed border-[var(--border-hover)] px-4 text-[13px] font-medium text-[var(--red)]"
        >
          Add your competency certificate
        </button>
      ) : null}
    </div>
  );
}
