'use client';

import Link from 'next/link';
import type { MotivationSummary } from '@/lib/motivations-api';
import { licenceLabel } from '@/lib/licence-labels';
import DeleteApplication from '@/components/licence-pack/delete-application';

// ────────────────────────────────────────────────────────────────────
// ONE APPLICATION, WITH A NAME AND A DELETE.
//
// Operator, 2026-09-09: "add a section for motivations splitting it into In
// progress and completed and give each a deletion option. they must open with
// their corresponding 271 form."
//
// ⚠️ THE 271 CONTROL IS GONE, ON PURPOSE. Operator, 2026-09-20: "Remove every
// SAPS 271 control... When clicking download, we download the motivation and
// the 271 as two separate documents in one go." The form is no longer
// something to open from a list; it ships with the pack and comes down with
// the pack's Download. So this row is the name, the reference and where it is.
//
// ⚠️ THE NAME IS THE FIREARM AND THE SECTION NOW. Every row used to read the
// same "Section 16 — Dedicated sport shooter" no matter which firearm it was
// for, so four applications were indistinguishable. `title` is derived on the
// server — the member's own name when they set one, the make, model and
// calibre otherwise — and the section label remains the fallback. See
// backend/src/motivations/motivation-title.ts.
// ────────────────────────────────────────────────────────────────────

const STATUS_WORDS: Record<string, string> = {
  DRAFT: 'In progress',
  GENERATING: 'Being written',
  NEEDS_MORE_INFO: 'Needs more from you',
  COMPLETED: 'Ready',
  FAILED: 'Could not be written',
  ABANDONED: 'Put aside',
};

export default function ApplicationRow({
  row,
  token,
  onChanged,
}: {
  row: MotivationSummary;
  token: () => Promise<string | null>;
  onChanged: () => void;
}) {
  return (
    <li className="gg-tile mb-2 overflow-hidden rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-card)]">
      {/*
        ⚠️ THE DELETE BUTTON IS A SIBLING OF THE LINK, NEVER INSIDE IT. A
        <button> nested in an <a> is invalid HTML, and the browsers that
        tolerate it still follow the link on the way to the click.
      */}
      <div className="flex items-stretch">
        <Link
          href={`/licence-centre/${row.id}`}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 px-[14px] py-3 no-underline"
        >
          <span className="min-w-0">
            <span className="block text-[14.5px] font-medium leading-[1.3] text-[var(--text-primary)]">
              {row.title ?? licenceLabel(row.licenceType)}
            </span>
            <span className="mt-[2px] block font-mono text-[12px] text-[var(--text-tertiary)]">
              {row.referenceNumber}
            </span>
          </span>
          <span className="flex-shrink-0 text-[12px] text-[var(--text-tertiary)]">
            {STATUS_WORDS[row.status] ?? row.status}
          </span>
        </Link>
        <DeleteApplication
          token={token}
          motivationId={row.id}
          reference={row.referenceNumber}
          label="Delete"
          onDeleted={onChanged}
          className="flex min-h-[44px] flex-shrink-0 items-center gap-1.5 border-l border-[var(--border-divider)] px-3.5 text-[12.5px] font-medium text-[var(--red)] hover:bg-[var(--red-wash)]"
        />
      </div>
    </li>
  );
}
