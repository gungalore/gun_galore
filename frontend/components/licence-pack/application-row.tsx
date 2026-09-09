'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import {
  motivationsApi,
  type MotivationSummary,
} from '@/lib/motivations-api';
import { licenceLabel } from '@/lib/licence-labels';
import DeleteApplication from '@/components/licence-pack/delete-application';

// ────────────────────────────────────────────────────────────────────
// ONE APPLICATION, WITH ITS FORM AND ITS DELETE.
//
// Operator, 2026-09-09: "add a section for motivations splitting it into In
// progress and completed and give each a deletion option. they must open with
// their corresponding 271 form."
//
// ⚠️ THE SAPS 271 IS NOT AN OPT-IN ANY MORE, so the button is on every row.
// Until 2026-09-08 a member who answered "my dealer will fill it in" was
// turned away with a 409; the 271 now ships with every pack because items D, G
// and H are always ours to complete. The ONE exception is a section 24, which
// is lodged on the SAPS 518(a) — the server refuses that by name, so the row
// says so up front rather than offering a button that cannot work.
//
// ⚠️ THE FORM CANNOT BE AN <a href>. Every motivation endpoint sits behind the
// Clerk guard and a plain anchor carries no Authorization header, so a direct
// link is a guaranteed 401. Fetch with the token, mint a blob: URL, point a
// tab at that — the pattern the pack screen already uses.
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isRenewal = row.licenceType === 'S24_RENEWAL';

  const openForm = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const url = await motivationsApi.saps271BlobUrl(token, row.id);
      /* ⚠️ opener nulled, and the blob revoked on the NEXT tick rather than
         immediately — revoking before the new tab has read it hands the member
         a blank window, which is how "the form does not open" gets reported. */
      const tab = window.open(url, '_blank', 'noopener,noreferrer');
      if (tab) tab.opener = null;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [token, row.id]);

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
              {licenceLabel(row.licenceType)}
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

      <div className="flex items-center gap-3 border-t border-[var(--border-divider)] px-[14px] py-2">
        {isRenewal ? (
          <span className="text-[12px] leading-[1.4] text-[var(--text-tertiary-on-card)]">
            A renewal is lodged on the SAPS 518(a), not the 271.
          </span>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void openForm()}
            className="text-[12.5px] font-medium text-[var(--text-secondary)] underline disabled:opacity-50"
          >
            {busy ? 'Opening…' : 'Open SAPS 271'}
          </button>
        )}
        {error ? (
          <span className="text-[12px] text-[var(--red)]">{error}</span>
        ) : null}
      </div>
    </li>
  );
}
