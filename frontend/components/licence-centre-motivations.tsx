'use client';

import { useCallback, useEffect, useState } from 'react';
import { LICENCE_LABEL } from '@/lib/licence-labels';
import Link from 'next/link';
import {
  motivationsApi,
  type MotivationSummary,
  type TokenGetter,
} from '@/lib/motivations-api';

// ────────────────────────────────────────────────────────────────────
// MOTIVATIONS, IN THE LICENCE CENTRE.
//
// Operator, 2026-08-21: "Make a Motivations category in the licence centre
// where purchased motivation can be retrieved from."
//
// ⚠️ NOT A CredentialKind, AND THAT IS THE WHOLE DESIGN DECISION. The obvious
// route was to file each finished motivation as a Credential row so it lands
// in the existing grouped list for free. It would have been wrong in three
// ways that all bite later:
//
//   A credential EXPIRES. The Centre's entire machinery — the amber/red
//   grouping, the reminder cadence at T-180/120/100/30, the renewal offer — is
//   built on a validity window. A motivation has no expiry; it was written on
//   a date and that is all. It would have sat in every "in date" count as a
//   permanent green row that means nothing.
//
//   A credential is a document the MEMBER holds and we store. A motivation is
//   a document WE produce and re-render on demand: nothing is stored, the PDF
//   is rebuilt from the encrypted text on every download. There is no file to
//   file.
//
//   A credential is EVIDENCE, offered into a motivation's annexures. A
//   motivation offered as evidence for a motivation is a loop.
//
// So this is its own section: read-only, retrieval only. Starting one still
// happens in the Motivations module, which is where the interview lives.
// ────────────────────────────────────────────────────────────────────

const STATUS_COPY: Record<string, string> = {
  DRAFT: 'Not finished',
  INTERVIEW: 'Not finished',
  NEEDS_MORE_INFO: 'Needs more detail',
  GENERATING: 'Being written',
  COMPLETED: 'Ready',
  FAILED: 'Needs another look',
  ABANDONED: 'Set aside',
};

export default function LicenceCentreMotivations({
  token,
}: {
  token: TokenGetter;
}) {
  const [rows, setRows] = useState<MotivationSummary[] | null>(null);
  /**
   * ⚠️ SILENT ON FAILURE, AND ON THE MODULE BEING OFF. This is a panel on
   * somebody else's page. If the motivation module is disabled every call
   * 404s, and a red error box about a feature the member has never used would
   * be noise on the page they came to for their licences. It renders nothing
   * and the Centre is unaffected.
   */
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const status = await motivationsApi.status(token);
      if (!status.enabled) {
        setFailed(true);
        return;
      }
      setRows(await motivationsApi.list(token));
    } catch {
      setFailed(true);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed || !rows || rows.length === 0) return null;

  // Finished first — those are the ones somebody came here to fetch.
  const ready = rows.filter((r) => r.status === 'COMPLETED');
  const rest = rows.filter((r) => r.status !== 'COMPLETED');

  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--text-tertiary-on-card)]">
        Your motivations
      </h2>

      <ul className="mt-2 divide-y divide-[var(--border-divider)] rounded border border-[var(--border)]">
        {[...ready, ...rest].map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-3 p-3"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium">
                {r.referenceNumber}
              </span>
              <span className="block text-xs text-[var(--text-tertiary-on-card)]">
                {LICENCE_LABEL[r.licenceType] ?? r.licenceType}
                {' · '}
                {STATUS_COPY[r.status] ?? r.status}
              </span>
            </span>

            <span className="flex shrink-0 items-center gap-3 text-sm">
              {r.status === 'COMPLETED' ? (
                // ⚠️ A LINK TO THE MOTIVATION, NOT STRAIGHT TO THE PDF. The
                // download needs the member's Clerk token on the request, so a
                // bare <a href> to the API would 401. The motivation's own
                // page already has the download, the reading copy and the
                // template picker on it.
                <Link href={`/motivations/${r.id}`} className="underline">
                  Open and download
                </Link>
              ) : (
                <Link href={`/motivations/${r.id}`} className="underline">
                  Continue
                </Link>
              )}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-xs text-[var(--text-tertiary-on-card)]">
        Your motivation is rebuilt each time you download it, so it is always
        the current version. Nothing is stored as a file.
      </p>
    </section>
  );
}
