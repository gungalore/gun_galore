'use client';

import { useAuth } from '@clerk/nextjs';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { motivationsApi } from '@/lib/motivations-api';
import type { SheetResponse } from '@/components/licence-centre/contract';
import PackSummary from '@/components/licence-centre/pack-summary';

// ────────────────────────────────────────────────────────────────────
// YOUR PACK — after the motivation is written.
//
// ⚠️ THE MOTIVATION IS READABLE ON THE PAGE, NOT ONLY AS A PDF. It is the
// thing the member paid for and the thing they sign; making them download a
// file to find out what it says is the last place to put a step.
//
// ⚠️ NO RED BUTTON ON THIS SCREEN, DELIBERATELY. Print and Download are
// outlined. The one red button in this surface is "Write my motivation" on the
// sheet, and by the time somebody is here the decision has been made — a red
// Download would be the page shouting at somebody who has already arrived.
// ────────────────────────────────────────────────────────────────────

const SOURCE_ROUTE: Record<string, 'dealer' | 'seller' | 'estate' | 'unstated'> =
  {
    'From a dealer': 'dealer',
    'From a private owner': 'seller',
    'Inherited from a deceased estate': 'estate',
  };

export default function PackPage() {
  const { getToken } = useAuth();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const [sheet, setSheet] = useState<SheetResponse | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!id) return;
    let live = true;
    void (async () => {
      try {
        const [s, d] = await Promise.all([
          motivationsApi.sheet(getToken, id),
          // ⚠️ FETCHED SEPARATELY FROM THE SHEET, as it always has been: the
          // sheet is refetched on every save and this is fifteen hundred
          // words.
          motivationsApi.draft(getToken, id).catch(() => null),
        ]);
        if (!live) return;
        setSheet(s);
        setDraft(d?.text ?? null);
      } catch (err) {
        if (live) setError((err as Error).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [getToken, id]);

  const download = useCallback(async () => {
    setDownloading(true);
    try {
      const url = await motivationsApi.pdfBlobUrl(getToken, id);
      // ⚠️ A BLOB URL, NOT A DIRECT LINK. The PDF is behind a bearer token, so
      // an <a href> to the API would 401 — the client fetches it with the
      // token and hands the browser bytes it already holds.
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sheet?.application.referenceNumber ?? 'motivation'}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDownloading(false);
    }
  }, [getToken, id, sheet]);

  if (error && !sheet) {
    return (
      <main className="px-4 py-10 text-[14px] text-[var(--text-secondary)]">
        {error}
      </main>
    );
  }
  if (!sheet) {
    return (
      <main className="px-4 py-10 text-[14px] text-[var(--text-tertiary)]">
        Loading your pack…
      </main>
    );
  }

  const source =
    sheet.items.find((i) => i.key === 'firearm_source')?.value ?? '';

  return (
    <main className="mx-auto w-full max-w-[760px] px-4 pb-10 pt-5">
      <h1 className="m-0 font-[family-name:var(--font-head)] text-[24px] font-medium leading-[1.15] tracking-[-0.01em] text-[var(--text-primary)]">
        Your pack
      </h1>
      <p className="m-0 mt-1 font-mono text-[12px] text-[var(--text-tertiary)]">
        {sheet.application.referenceNumber} ·{' '}
        {sheet.application.licenceTypeLabel}
      </p>

      <div className="mt-4 flex gap-2 print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="min-h-[44px] flex-1 rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-card)] px-4 text-[14px] font-medium text-[var(--text-primary)]"
        >
          Print
        </button>
        <button
          type="button"
          onClick={() => void download()}
          disabled={downloading}
          className="min-h-[44px] flex-1 rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-card)] px-4 text-[14px] font-medium text-[var(--text-primary)] disabled:opacity-50"
        >
          {downloading ? 'Preparing…' : 'Download PDF'}
        </button>
      </div>

      <section className="mt-6">
        <h2 className="m-0 font-[family-name:var(--font-head)] text-[18px] font-medium leading-[1.2] text-[var(--text-primary)]">
          Your motivation
        </h2>
        {draft ? (
          // Pre-wrap rather than a markdown renderer: the writer produces
          // plain prose with no markup by design, and parsing it as markdown
          // would invent emphasis nobody asked for.
          <div className="mt-2 whitespace-pre-wrap text-[13.5px] leading-[1.6] text-[var(--text-secondary)]">
            {draft}
          </div>
        ) : (
          <p className="mt-2 text-[13.5px] text-[var(--text-tertiary)]">
            Your motivation has not been written yet.{' '}
            <Link
              href={`/licence-centre/${id}`}
              className="text-[var(--red)] underline"
            >
              Back to your application
            </Link>
            .
          </p>
        )}
      </section>

      <section className="mt-6">
        <h2 className="m-0 mb-2 font-[family-name:var(--font-head)] text-[18px] font-medium leading-[1.2] text-[var(--text-primary)]">
          What SAPS needs
        </h2>
        <PackSummary
          coverage={sheet.coverage as never}
          licenceType={sheet.application.licenceType}
          sourceRoute={SOURCE_ROUTE[source] ?? 'unstated'}
          needs={sheet.needs.needs}
        />
      </section>
    </main>
  );
}
