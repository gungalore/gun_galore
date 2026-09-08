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
// ⚠️ THE PAGE SHOWS THE DOCUMENT, NOT THE MANUSCRIPT. It used to render the
// raw draft text — the writer's prose, in body type, with no cover, no
// annexure index, no page furniture and none of the layout. So a member who
// had just paid for a 27-page pack opened "Your pack" and met a wall of
// numbered paragraphs. Operator, 2026-09-09: "why the fuck would I want to see
// the manuscript? Did I ask generate me a manuscript or a fucking motivation?"
//
// The PDF IS the deliverable — masthead, addressed to the Registrar through
// the DFO, contents, the request for prior notice, the press cuttings, the
// seller's consent, the annexure index with its certification levels, the
// take-to-the-station checklist. It is embedded here and read in place.
//
// ⚠️ AND THE DOWNLOAD STAYS. An embedded viewer is not a filing cabinet: some
// browsers refuse to render a PDF inline, and the member needs the file
// itself to take to a station. The fallback below is shown when the embed
// cannot render rather than assumed to be unnecessary.
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
  /**
   * The rendered pack, as a blob URL.
   *
   * ⚠️ A BLOB, NOT A SRC. The PDF is behind a bearer token, so an <iframe src>
   * pointed at the API would 401 — the client fetches it with the token and
   * hands the browser bytes it already holds. Same reason the download does.
   */
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [written, setWritten] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!id) return;
    let live = true;
    void (async () => {
      try {
        const s = await motivationsApi.sheet(getToken, id);
        if (!live) return;
        setSheet(s);

        /**
         * ⚠️ THE DRAFT IS STILL WHAT SAYS WHETHER ANYTHING WAS WRITTEN. The
         * PDF endpoint answers for a motivation that does not exist yet too,
         * and a viewer showing an error page is a worse answer than a sentence
         * saying it has not been written.
         */
        const d = await motivationsApi.draft(getToken, id).catch(() => null);
        if (!live) return;
        if (!d?.text) {
          setWritten(false);
          return;
        }
        const url = await motivationsApi.pdfBlobUrl(getToken, id);
        if (!live) {
          URL.revokeObjectURL(url);
          return;
        }
        setPdfUrl(url);
      } catch (err) {
        if (live) setError((err as Error).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [getToken, id]);

  // ⚠️ THE BLOB IS RELEASED WHEN THE PAGE GOES. Ten megabytes per visit, held
  // by the document until something revokes it.
  useEffect(
    () => () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    },
    [pdfUrl],
  );

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
        {!written ? (
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
        ) : pdfUrl ? (
          /*
            ⚠️ THE DOCUMENT ITSELF, AT THE PAPER'S OWN PROPORTIONS. A4 is
            1:1.414, so the frame is tall rather than square — a viewer letter-
            boxed into a 16:9 box shows a third of a page and makes a 27-page
            pack look like a fragment.
          */
          <div className="print:hidden">
            <iframe
              src={pdfUrl}
              title="Your motivation"
              className="block h-[min(1100px,140vh)] w-full rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-inset)]"
            />
            {/*
              ⚠️ SAID OUT LOUD, BECAUSE AN EMBED CAN FAIL SILENTLY. A browser
              with its PDF viewer disabled renders an empty box and nothing
              explains it — and the member is one tap from the file itself.
            */}
            <p className="m-0 mt-2 text-[12.5px] leading-[1.45] text-[var(--text-tertiary)]">
              Not showing? Use Download PDF above — the file is the same one you
              take to the station.
            </p>
          </div>
        ) : (
          <p className="mt-2 text-[13.5px] text-[var(--text-tertiary)]">
            Preparing your document…
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
