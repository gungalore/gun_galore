'use client';

import { useAuth } from '../../../../lib/auth';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { motivationsApi } from '@/lib/motivations-api';
import type { SheetResponse } from '@/components/licence-centre/contract';
import PackSummary from '@/components/licence-centre/pack-summary';
import PreparingMotivation from '@/components/licence-centre/preparing-motivation';

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
// ⚠️ NOTHING TO DOWNLOAD UNTIL THERE IS SOMETHING TO DOWNLOAD.
//
// Operator, 2026-09-20: "we need to hide all the download and print options
// for the motivation and 271 and show a big preparing you motivation. Only on
// a successful motivation do they appear."
//
// Generation is detached and takes about a minute and a half (see
// motivation-generation.service.ts), and the PDF endpoint REFUSES with a 409
// until the gate passes. So while it runs this page polls the status and shows
// one thing: the preparing panel, with our logo on it. The controls appear
// only at COMPLETED, and a failure says so and offers the way back to the
// answers rather than a button that cannot work.
//
// ⚠️ ONE DOWNLOAD, TWO DOCUMENTS. Operator, 2026-09-20: "Remove the download
// and print 271... When clicking download, we download the motivation and the
// 271 as two separate documents in one go if possible." The separate SAPS 271
// section is gone; Download fetches both PDFs and saves them back to back.
// A section 24 renewal has no 271 — it is lodged on the SAPS 518(a) — so only
// the motivation comes down.
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

/**
 * The statuses the writer passes through on its way to COMPLETED.
 *
 * ⚠️ NOT A COMPLETE SET OF `MotivationStatus`. Anything not here and not
 * `COMPLETED` is terminal — FAILED, NEEDS_MORE_INFO, ABANDONED, or a DRAFT
 * that never started — and each of those needs the back link, not a spinner.
 */
const PREPARING_STATUSES = new Set(['GENERATING', 'QUALITY_REVIEW']);

/** How long to wait before we stop claiming it is still working. */
const POLL_DEADLINE_MS = 6 * 60_000;
const POLL_INTERVAL_MS = 3_000;

/**
 * ⚠️ MUST BE ATTACHED TO THE DOM AND REVOKED ASYNCHRONOUSLY. Modern browsers
 * (Chrome 80+, Firefox) ignore programmatic .click() on detached anchors for
 * security reasons, and revoking the object URL synchronously on the next line
 * cancels the download before the browser's download manager can read the
 * blob.
 */
function saveBlob(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function PackPage() {
  const { getToken } = useAuth();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const [sheet, setSheet] = useState<SheetResponse | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  /**
   * The rendered pack, as a blob URL.
   *
   * ⚠️ A BLOB, NOT A SRC. The PDF is behind a bearer token, so an <iframe src>
   * pointed at the API would 401 — the client fetches it with the token and
   * hands the browser bytes it already holds. Same reason the download does.
   */
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
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
        // ⚠️ THE SERVER'S OWN STATUS, NOT AN INFERENCE FROM THE DRAFT. A held
        // or failed run already has document text, so "there is text" is not
        // "it is ready". See the type's note on `hasDocument`.
        setStatus(s.application.status);
      } catch (err) {
        if (live) setError((err as Error).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [getToken, id]);

  const preparing = status !== null && PREPARING_STATUSES.has(status);
  const ready = status === 'COMPLETED';

  /**
   * Follow the writer until it stops.
   *
   * ⚠️ A DEADLINE, NOT AN ETERNAL POLL. The generator's own worst case is a
   * quarter of an hour, so this stops at six minutes and says it is taking
   * longer rather than spinning for ever on a tab nobody is watching.
   */
  useEffect(() => {
    if (!id || !preparing) return;
    let live = true;
    const deadline = Date.now() + POLL_DEADLINE_MS;
    const timer = setInterval(() => {
      if (Date.now() > deadline) {
        clearInterval(timer);
        return;
      }
      void (async () => {
        try {
          const d = await motivationsApi.get(getToken, id);
          if (live && d.status !== status) setStatus(d.status);
        } catch {
          /* A poll that fails is not news; keep waiting for the next one. */
        }
      })();
    }, POLL_INTERVAL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [id, preparing, status, getToken]);

  /** Fetch the pack once the writer is done, and only then. */
  useEffect(() => {
    if (!id || !ready || pdfUrl) return;
    let live = true;
    void (async () => {
      try {
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
  }, [id, ready, pdfUrl, getToken]);

  // ⚠️ THE BLOB IS RELEASED WHEN THE PAGE GOES. Ten megabytes per visit, held
  // by the document until something revokes it.
  useEffect(
    () => () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    },
    [pdfUrl],
  );

  /**
   * Both documents, one tap.
   *
   * ⚠️ THE TWO SAVES FIRE IN THE SAME TICK, AFTER BOTH FETCHES. A download
   * triggered after an `await` has lost the user gesture that allowed it; both
   * bytes are held first and then the anchors are clicked back to back. The
   * 271 is skipped on a renewal, where there is no 271 to fetch.
   */
  const download = useCallback(async () => {
    setDownloading(true);
    setError(null);
    try {
      const reference = sheet?.application.referenceNumber ?? 'motivation';
      const isRenewal = sheet?.application.licenceType === 'S24_RENEWAL';
      const reusableMotivation = pdfUrl;
      const motivation =
        reusableMotivation ?? (await motivationsApi.pdfBlobUrl(getToken, id));

      let form: string | null = null;
      let formError: string | null = null;
      if (!isRenewal) {
        try {
          form = await motivationsApi.saps271BlobUrl(getToken, id);
        } catch (err) {
          // ⚠️ THE MOTIVATION STILL DOWNLOADS. A refusal on the form — a
          // section 24 by name, a form the map cannot fill — must not take the
          // document the member actually came for down with it.
          formError = (err as Error).message;
        }
      }

      saveBlob(motivation, `${reference}.pdf`);
      if (form) saveBlob(form, `${reference}-saps271.pdf`);

      if (!reusableMotivation) {
        window.setTimeout(() => URL.revokeObjectURL(motivation), 60_000);
      }
      if (form) window.setTimeout(() => URL.revokeObjectURL(form), 60_000);
      if (formError) setError(formError);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDownloading(false);
    }
  }, [getToken, id, pdfUrl, sheet]);

  /**
   * Print, by opening the document itself.
   *
   * ⚠️ `window.print()` ON THIS PAGE PRINTS THE PAGE, NOT THE PACK. The PDF is
   * embedded behind `print:hidden` precisely because an embedded viewer prints
   * its own chrome, not the document. Opening the blob in a tab hands the
   * member the browser's PDF viewer, which is where its print button lives.
   */
  const print = useCallback(() => {
    if (!pdfUrl) return;
    const tab = window.open(pdfUrl, '_blank', 'noopener,noreferrer');
    if (tab) tab.opener = null;
  }, [pdfUrl]);

  if (error && !sheet) {
    return (
      <main className="px-4 py-10 text-[14px] text-[var(--text-secondary)]">
        {error}
      </main>
    );
  }
  if (!sheet || status === null) {
    return (
      <main className="px-4 py-10 text-[14px] text-[var(--text-tertiary)]">
        Loading your pack…
      </main>
    );
  }

  const source =
    sheet.items.find((i) => i.key === 'firearm_source')?.value ?? '';
  // A renewal has no 271: it is lodged on the SAPS 518(a), which we do not fill.
  const isRenewal = sheet.application.licenceType === 'S24_RENEWAL';

  return (
    <main className="mx-auto w-full max-w-[760px] px-4 pb-10 pt-5">
      {/*
        ⚠️ A BACK TO THE ANSWERS, NOT `router.back()`. Somebody who arrives on
        this page from a notification has no history, and "edit your answers"
        is the one thing they may need when the document reads wrong. Operator,
        2026-09-20: "we need a back button if the user want to edit any
        information."
      */}
      <Link
        href={`/licence-centre/${id}`}
        className="mb-3 inline-flex min-h-[36px] items-center gap-1.5 text-[13px] font-medium text-[var(--text-secondary)] no-underline"
      >
        <span aria-hidden="true">&#8592;</span> Edit your answers
      </Link>

      <h1 className="m-0 font-[family-name:var(--font-head)] text-[24px] font-medium leading-[1.15] tracking-[-0.01em] text-[var(--text-primary)]">
        Your pack
      </h1>
      <p className="m-0 mt-1 font-mono text-[12px] text-[var(--text-tertiary)]">
        {sheet.application.title ?? sheet.application.licenceTypeLabel} ·{' '}
        {sheet.application.referenceNumber}
      </p>

      {preparing ? (
        <section className="mt-5">
          <PreparingMotivation />
        </section>
      ) : ready ? (
        <>
          <div className="mt-4 flex gap-2 print:hidden">
            <button
              type="button"
              onClick={() => print()}
              disabled={!pdfUrl}
              className="min-h-[44px] flex-1 rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-card)] px-4 text-[14px] font-medium text-[var(--text-primary)] disabled:opacity-50"
            >
              Print
            </button>
            <button
              type="button"
              onClick={() => void download()}
              disabled={downloading}
              className="min-h-[44px] flex-1 rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-card)] px-4 text-[14px] font-medium text-[var(--text-primary)] disabled:opacity-50"
            >
              {downloading
                ? 'Preparing…'
                : isRenewal
                  ? 'Download PDF'
                  : 'Download the pack'}
            </button>
          </div>
          {error ? (
            <p className="mt-2 text-[12.5px] text-[var(--red)] print:hidden">
              {error}
            </p>
          ) : null}

          <section className="mt-6">
            {pdfUrl ? (
              /*
                ⚠️ THE DOCUMENT ITSELF, AT THE PAPER'S OWN PROPORTIONS. A4 is
                1:1.414, so the frame is tall rather than square — a viewer
                letter-boxed into a 16:9 box shows a third of a page and makes
                a 27-page pack look like a fragment.
              */
              <div className="print:hidden">
                <iframe
                  src={pdfUrl}
                  title="Your motivation"
                  className="block h-[min(1100px,140vh)] w-full rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-inset)]"
                />
                {/*
                  ⚠️ SAID OUT LOUD, BECAUSE AN EMBED CAN FAIL SILENTLY. A
                  browser with its PDF viewer disabled renders an empty box and
                  nothing explains it — and the member is one tap from the file
                  itself.
                */}
                <p className="m-0 mt-2 text-[12.5px] leading-[1.45] text-[var(--text-tertiary)]">
                  Not showing? Use Download above — the file is the same one
                  you take to the station.
                </p>
              </div>
            ) : (
              <p className="mt-2 text-[13.5px] text-[var(--text-tertiary)]">
                Preparing your document…
              </p>
            )}
          </section>
        </>
      ) : (
        <section className="mt-5 rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--bg-card)] px-5 py-6">
          <p className="m-0 text-[14px] leading-[1.5] text-[var(--text-primary)]">
            {status === 'DRAFT' || status === 'INTERVIEW'
              ? 'Your motivation has not been written yet.'
              : status === 'NEEDS_MORE_INFO'
                ? 'We need a little more from you before this can be written.'
                : 'We could not write this one.'}
          </p>
          <p className="m-0 mt-2 text-[13px] leading-[1.5] text-[var(--text-secondary)]">
            Open your answers, check them, and write it again.
          </p>
        </section>
      )}

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
