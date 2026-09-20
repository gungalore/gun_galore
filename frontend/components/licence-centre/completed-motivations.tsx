'use client';

import Link from 'next/link';
import type { MotivationSummary } from '@/lib/motivations-api';
import { licenceLabel } from '@/lib/licence-labels';

// ────────────────────────────────────────────────────────────────────
// FINISHED MOTIVATIONS, IN THE PLACE THE MEMBER KEEPS THEIR PAPERWORK.
//
// Operator, 2026-09-20: "Need a section inside the Paper work Vault for
// completed motivation."
//
// ⚠️ ONLY WHAT IS FINISHED. An in-progress application is work, not a document
// to file, and mixing it in here would bury the things the member came for
// under four drafts. Everything left over stays on the applications list,
// which the link below this section still reaches.
//
// ⚠️ THE ROW OPENS THE PACK, NOT THE SHEET. A completed motivation's useful
// artefact is the PDF and the SAPS 271 that goes with it, and the pack is
// where the Download lives. Opening the sheet would put the member back in a
// form they have finished.
// ────────────────────────────────────────────────────────────────────

export default function CompletedMotivations({
  rows,
}: {
  rows: MotivationSummary[];
}) {
  if (!rows.length) return null;

  return (
    <section className="mt-8">
      <p className="m-0 mb-2 text-[11px] font-medium uppercase tracking-[0.11em] text-[var(--text-tertiary)]">
        Completed motivations · {rows.length}
      </p>
      <ul className="m-0 list-none p-0">
        {rows.map((r) => (
          <li
            key={r.id}
            className="gg-tile mb-2 overflow-hidden rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-card)]"
          >
            <Link
              href={`/licence-centre/${r.id}/pack`}
              className="flex min-h-[44px] items-center justify-between gap-3 px-[14px] py-3 no-underline"
            >
              <span className="min-w-0">
                <span className="block text-[14.5px] font-medium leading-[1.3] text-[var(--text-primary)]">
                  {r.title ?? licenceLabel(r.licenceType)}
                </span>
                <span className="mt-[2px] block font-mono text-[12px] text-[var(--text-tertiary)]">
                  {r.referenceNumber}
                </span>
              </span>
              <span aria-hidden="true" className="text-[var(--red)]">
                &rarr;
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
