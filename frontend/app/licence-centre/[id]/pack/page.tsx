'use client';

import { useAuth } from '../../../../lib/auth';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  motivationsApi,
  MotivationApiError,
  type DocumentEngineStatus,
} from '@/lib/motivations-api';
import type { SheetResponse } from '@/components/licence-centre/contract';
import PackSummary from '@/components/licence-centre/pack-summary';
import PreparingMotivation from '@/components/licence-centre/preparing-motivation';
import SheetFooter from '@/components/licence-centre/sheet-footer';
import { formatPrice } from '@/lib/utils';

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
// take-to-the-station checklist.
//
// ⚠️ NO IN-PAGE PREVIEW. Operator, 2026-11-21: "remove the preview when done
// generating. Just have a download and view which open the pdf in a new tab."
// The document is a 20-odd page A4 pack; an inline frame shrank it into a
// scroll box and the browser's own viewer was better at it anyway. Two buttons
// remain: Download saves the file, View opens the same blob in a new tab.
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
// only at COMPLETED.
//
// ⚠️ ONE DOWNLOAD, TWO DOCUMENTS. Operator, 2026-09-20: "Remove the download
// and print 271... When clicking download, we download the motivation and the
// 271 as two separate documents in one go if possible." The separate SAPS 271
// section is gone; Download fetches both PDFs and saves them back to back.
// A section 24 renewal has no 271 — it is lodged on the SAPS 518(a) — so only
// the motivation comes down.
//
// ⚠️ NO RED BUTTON ON THIS SCREEN, DELIBERATELY. Download and View are
// outlined. The one red button in this surface is "Write my motivation" on the
// sheet, and by the time somebody is here the decision has been made — a red
// Download would be the page shouting at somebody who has already arrived.
// ────────────────────────────────────────────────────────────────────

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
  const [writing, setWriting] = useState(false);
  const [engine, setEngine] = useState<DocumentEngineStatus | null>(null);
  /** The poll gave up waiting; the run may still be going. */
  const [takingLonger, setTakingLonger] = useState(false);

  // ── The paygate ───────────────────────────────────────────────────
  //
  // ⚠️ THE DECLARATION IS SIGNED BEFORE THE MONEY LEAVES. write() stores it
  // first, then opens the checkout — so the generate that runs when they come
  // back cannot be refused for a declaration they already ticked.
  const [paying, setPaying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  /** Verified paid in this session, before the refreshed sheet catches up. */
  const [paidNow, setPaidNow] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  /** One auto-generate per return from the bank, never per render. */
  const autoGenerated = useRef(false);

  /**
   * ⚠️ CLEAR THE PREVIOUS APPLICATION BEFORE LOADING THIS ONE.
   *
   * MO000030's blob survived a client-side move to MO000032, so Download saved
   * the old motivation under the new reference while the 271 (fetched fresh)
   * carried MO000032. Two reference numbers on one pack. The blob belongs to
   * the id that produced it, so changing id drops it first.
   */
  useEffect(() => {
    setPdfUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    setSheet(null);
    setStatus(null);
    setError(null);
  }, [id]);

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
    // The support timeline: the pack page was opened.
    void motivationsApi
      .activity(getToken, id, 'client_page_view', { path: '/licence-centre/[id]/pack' })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [getToken, id]);

  useEffect(() => {
    if (!id) return;
    let live = true;
    void motivationsApi
      .engineStatus(getToken)
      .then((next) => {
        if (live) setEngine(next);
      })
      .catch(() => {
        if (live) setEngine(null);
      });
    return () => {
      live = false;
    };
  }, [getToken, id]);

  const preparing = status !== null && PREPARING_STATUSES.has(status);
  const ready = status === 'COMPLETED';

  /**
   * ⚠️ A SILENT REBUILD LOOKS LIKE WRITING, NOT LIKE A FAILURE. Operator,
   * 2026-11-21: "We never let the user know it failed ... notify them it has
   * been processed and ready to download." While the service has a rebuild
   * scheduled, this screen keeps showing the preparing panel and polling; the
   * only message the member ever gets is the ready one.
   */
  const retrying = sheet?.application.retrying === true;
  const working = preparing || retrying;
  useEffect(() => {
    if (!working) setTakingLonger(false);
  }, [working]);

  /**
   * The paygate, from the server.
   *
   * ⚠️ `unpaid` IS SERVER STATE, NOT A LOCAL GUESS. If the sheet has not
   * loaded yet there is nothing to charge for and the footer keeps its old
   * label — it must never flash "Pay R 295" at a member who already paid.
   */
  const payment = sheet?.application.payment;
  const unpaid = !!payment?.required && !payment.paid && !paidNow;
  const priceCents = payment?.amountCents;

  /** Send them to the bank. The declaration is already stored by write(). */
  const startCheckout = useCallback(async () => {
    setPaying(true);
    setPaymentError(null);
    try {
      const res = await motivationsApi.startPayment(getToken, id);
      if (res.alreadyPaid) {
        setPaidNow(true);
        setPaying(false);
        return;
      }
      if (!res.redirectUrl) {
        throw new Error('The payment page did not load. Nothing has been charged.');
      }
      // The last thing recorded before the browser leaves for the bank.
      void motivationsApi
        .activity(getToken, id, 'client_pay_clicked', {
          path: '/licence-centre/[id]/pack',
          detail: { amountCents: res.amountCents },
        })
        .catch(() => undefined);
      // Full navigation, not a new tab: the bank returns to THIS page with
      // ?payment=return, which is what runs the verify below.
      window.location.assign(res.redirectUrl);
    } catch (err) {
      setPaymentError((err as Error).message);
      setPaying(false);
    }
  }, [getToken, id]);

  /**
   * Back from the bank: ask the gateway what happened.
   *
   * ⚠️ THREE CHECKS, AND NEVER "FAILED". A capture can land seconds after the
   * browser returns; telling a member their payment failed when it did not is
   * how somebody pays twice. Exactly the posture of app/checkout/complete.
   */
  useEffect(() => {
    if (!id || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') !== 'return') return;
    // Drop the flag so a refresh does not verify — and generate — again.
    params.delete('payment');
    const qs = params.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${qs ? `?${qs}` : ''}`,
    );

    let live = true;
    setConfirming(true);
    void motivationsApi
      .activity(getToken, id, 'client_bank_returned', {
        path: '/licence-centre/[id]/pack?payment=return',
      })
      .catch(() => undefined);
    void (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await motivationsApi.verifyPayment(getToken, id);
          if (!live) return;
          if (res.paid) {
            setPaidNow(true);
            setConfirming(false);
            return;
          }
        } catch {
          /* A check that failed is not a payment that failed. */
        }
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
      if (!live) return;
      setConfirming(false);
      setPaymentError(
        'We have not seen the payment yet. If your bank has debited you, it can take a minute — check again rather than paying twice.',
      );
    })();
    return () => {
      live = false;
    };
  }, [getToken, id]);

  /**
   * Once the money is confirmed, write the document — ONCE.
   *
   * ⚠️ WAITS FOR THE SHEET. The status must be the server's before this
   * decides anything: auto-generating over a COMPLETED document would spend a
   * second generation on a paid application that already has its pack.
   */
  useEffect(() => {
    if (!paidNow || autoGenerated.current) return;
    if (!sheet || status === null) return;
    if (ready || working) return;
    autoGenerated.current = true;
    void (async () => {
      try {
        await motivationsApi.generate(getToken, id);
        setStatus('GENERATING');
      } catch (err) {
        setPaymentError((err as Error).message);
      }
    })();
  }, [paidNow, sheet, status, ready, working, getToken, id]);

  /** The manual re-check after an unconfirmed return. */
  const recheckPayment = useCallback(async () => {
    setConfirming(true);
    setPaymentError(null);
    try {
      const res = await motivationsApi.verifyPayment(getToken, id);
      if (res.paid) {
        setPaidNow(true);
      } else {
        setPaymentError(
          'Still not showing. Give it a minute and check again — nothing is lost.',
        );
      }
    } catch (err) {
      setPaymentError((err as Error).message);
    } finally {
      setConfirming(false);
    }
  }, [getToken, id]);
  useEffect(() => {
    if (!working) setTakingLonger(false);
  }, [working]);

  /**
   * Follow the writer until it stops.
   *
   * ⚠️ A DEADLINE, NOT AN ETERNAL POLL. The generator's own worst case is a
   * quarter of an hour, so this stops at six minutes and says it is taking
   * longer rather than spinning for ever on a tab nobody is watching. A
   * SILENTLY REBUILDING row counts as working, so the page keeps checking
   * through the retry window too.
   */
  useEffect(() => {
    if (!id || !working) return;
    let live = true;
    const deadline = Date.now() + POLL_DEADLINE_MS;
    const timer = setInterval(() => {
      if (Date.now() > deadline) {
        clearInterval(timer);
        // ⚠️ STOPPING QUIETLY LEFT THE SPINNER RUNNING FOR EVER. Nothing changed
        // `status`, so the member waited on a page that had stopped checking.
        if (live) setTakingLonger(true);
        return;
      }
      void (async () => {
        try {
          const d = await motivationsApi.get(getToken, id);
          if (!live) return;
          const moved = d.status !== status;
          if (moved) setStatus(d.status);
          // ⚠️ REFRESH THE SHEET ON EVERY STATUS MOVE, not only COMPLETED. The
          // silent-rebuild flag lives on the sheet, so a retry that has just
          // been picked up (or has run out of attempts) must update the
          // "working" state on this page.
          if (moved) {
            void motivationsApi
              .sheet(getToken, id)
              .then((s) => {
                if (live) setSheet(s);
              })
              .catch(() => undefined);
          }
          if (d.status === 'COMPLETED') setTakingLonger(false);
        } catch {
          /* A poll that fails is not news; keep waiting for the next one. */
        }
      })();
    }, POLL_INTERVAL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [id, working, status, getToken]);

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
   * The pack, one tap.
   *
   * ⚠️ NO SECOND DOCUMENT ANY MORE. The generated SAPS 271 is gone, so the
   * motivation is the whole download; the annexures are already printed inside
   * the PDF rather than saved beside it.
   */
  const download = useCallback(async () => {
    setDownloading(true);
    setError(null);
    void motivationsApi
      .activity(getToken, id, 'client_download_clicked', {
        path: '/licence-centre/[id]/pack',
      })
      .catch(() => undefined);
    try {
      const reference = sheet?.application.referenceNumber ?? 'motivation';
      const reusableMotivation = pdfUrl;
      const motivation =
        reusableMotivation ?? (await motivationsApi.pdfBlobUrl(getToken, id));

      saveBlob(motivation, `${reference}.pdf`);

      if (!reusableMotivation) {
        window.setTimeout(() => URL.revokeObjectURL(motivation), 60_000);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDownloading(false);
    }
  }, [getToken, id, pdfUrl, sheet]);

  /**
   * View, by opening the document itself in a new tab.
   *
   * ⚠️ THE BROWSER'S VIEWER, NOT AN EMBED. The PDF is a 20-odd page A4 pack; an
   * inline frame shrank it into a scroll box, and `window.print()` on THIS page
   * would print the page rather than the pack. A tab hands the member the
   * viewer they already know, complete with its own print button.
   */
  const view = useCallback(() => {
    if (!pdfUrl) return;
    void motivationsApi
      .activity(getToken, id, 'client_view_clicked', {
        path: '/licence-centre/[id]/pack',
      })
      .catch(() => undefined);
    const tab = window.open(pdfUrl, '_blank', 'noopener,noreferrer');
    if (tab) tab.opener = null;
  }, [getToken, id, pdfUrl]);

  const write = useCallback(
    async ({ testimonialConsent }: { testimonialConsent: boolean }) => {
      setWriting(true);
      setError(null);
      try {
        // ⚠️ DECLARATION FIRST, THEN THE MONEY. The generate that runs after
        // the bank refuses without `declarationAcceptedAt`, and asking for it
        // on a screen they have left is a dead end. Stored here, it is already
        // true when the return flow writes the document.
        await motivationsApi.acceptDeclaration(
          getToken,
          id,
          testimonialConsent,
        );
        if (unpaid) {
          await startCheckout();
          return;
        }
        await motivationsApi.generate(getToken, id);
        setStatus('GENERATING');
      } catch (err) {
        // A stale tab (or a payment settled in another tab) can still reach
        // generate unpaid. That is not an error to show as a dead end: the
        // footer's next press must be the Pay button.
        if (err instanceof MotivationApiError && err.code === 'motivation-payment-required') {
          setPaymentError(err.message);
          setPaidNow(false);
          void motivationsApi
            .sheet(getToken, id)
            .then(setSheet)
            .catch(() => undefined);
        } else {
          setError((err as Error).message);
        }
      } finally {
        setWriting(false);
      }
    },
    [getToken, id, unpaid, startCheckout],
  );

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

  const missingDocuments = sheet.needs.needs.filter(
    (need) => need.tier === 'required' && !need.have,
  ).length;
  const missingCount = sheet.missing.length + missingDocuments;

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
        href="/licence-centre/applications"
        className="mb-3 inline-flex min-h-[36px] items-center gap-1.5 text-[13px] font-medium text-[var(--text-secondary)] no-underline"
      >
        <span aria-hidden="true">&#8592;</span> Back to your applications
      </Link>

      <h1 className="m-0 font-[family-name:var(--font-head)] text-[24px] font-medium leading-[1.15] tracking-[-0.01em] text-[var(--text-primary)]">
        Your pack
      </h1>
      <p className="m-0 mt-1 font-mono text-[12px] text-[var(--text-tertiary)]">
        {sheet.application.title ?? sheet.application.licenceTypeLabel} ·{' '}
        {sheet.application.referenceNumber}
      </p>

      {working ? (
        <section className="mt-5">
          <PreparingMotivation />
          {takingLonger ? (
            <p className="mt-3 text-[13px] leading-[1.5] text-[var(--gold-strong)]">
              This is taking longer than usual. Nothing is lost — you can leave
              this page, and we will email you the moment it is ready.
            </p>
          ) : null}
        </section>
      ) : ready ? (
        <>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => void download()}
              disabled={downloading}
              className="min-h-[44px] flex-1 rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-card)] px-4 text-[14px] font-medium text-[var(--text-primary)] disabled:opacity-50"
            >
              {downloading ? 'Preparing…' : 'Download'}
            </button>
            <button
              type="button"
              onClick={() => view()}
              disabled={!pdfUrl}
              className="min-h-[44px] flex-1 rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-card)] px-4 text-[14px] font-medium text-[var(--text-primary)] disabled:opacity-50"
            >
              View
            </button>
          </div>
          {/*
            ⚠️ NO IN-PAGE PREVIEW. Operator, 2026-11-21: "remove the preview when
            done generating. Just have a download and view which open the pdf in
            a new tab." The document is a 20-odd page A4 pack; an embedded frame
            shrank it into a scroll box and its own PDF chrome competed with the
            page. The browser's viewer is better at it, and the print control
            comes with that viewer.
          */}
          <p className="m-0 mt-2 text-[12.5px] leading-[1.5] text-[var(--text-tertiary)]">
            View opens the PDF in a new tab. Download saves the same file — the
            one you take to the station.
          </p>
          {error ? (
            <p className="mt-2 text-[12.5px] text-[var(--red)]">{error}</p>
          ) : null}
        </>
      ) : (
        <section className="mt-5">
          <h2 className="m-0 font-[family-name:var(--font-head)] text-[20px] font-medium leading-[1.2] text-[var(--text-primary)]">
            Ready to write your motivation
          </h2>
          <p className="m-0 mt-2 text-[13.5px] leading-[1.6] text-[var(--text-secondary)]">
            Everything the interview needs is saved. Confirm the declaration and
            we will write the document.
          </p>

          {/*
            ⚠️ THE PRICE IS ON THE PAGE BEFORE THE BUTTON, not only on it. The
            member is one press from a bank redirect; R295 appearing for the
            first time on the hosted payment page is the wrong place to learn it.
          */}
          {unpaid && priceCents !== undefined ? (
            <p
              className="m-0 mt-2 text-[13px] leading-[1.55]"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {formatPrice(priceCents)}, once, for this application. If anything
              needs redoing, we redo it at no extra cost.
            </p>
          ) : null}

          {confirming ? (
            <p
              role="status"
              className="m-0 mt-3 rounded-lg border px-3 py-2 text-[13px] leading-5"
              style={{
                borderColor: 'var(--gold-line)',
                background: 'var(--gold-wash)',
                color: 'var(--text-secondary)',
              }}
            >
              Confirming your payment with the bank…
            </p>
          ) : null}

          {missingCount > 0 ? (
            <div
              className="mt-4 rounded-lg border px-4 py-4"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--bg-inset)',
              }}
            >
              <p className="m-0 text-[13.5px] font-medium text-[var(--text-primary)]">
                {missingCount} thing{missingCount === 1 ? '' : 's'} still needed
              </p>
              <p className="m-0 mt-1 text-[12.5px] leading-5 text-[var(--text-secondary)]">
                Finish the outstanding answers or documents before writing.
              </p>
              <Link
                href={`/licence-centre/${id}`}
                className="mt-3 inline-flex rounded-lg px-3 py-2 text-[13px] font-medium text-white"
                style={{ background: 'var(--red)' }}
              >
                Fix missing details
              </Link>
            </div>
          ) : (
            <div className="mt-4">
              <SheetFooter
                missingCount={0}
                declared={!!sheet.application.declarationAcceptedAt}
                onWrite={write}
                busy={writing}
                maintenance={engine ? !engine.available : false}
                maintenanceMessage={engine?.message}
                priceCents={priceCents}
                paid={!unpaid}
                paying={paying}
                onNotify={() => {
                  void motivationsApi
                    .engineInterest(getToken, 'GENERATE', id)
                    .then(() =>
                      setError('We will email you as soon as it is back.'),
                    )
                    .catch(() =>
                      setError(
                        'We could not save that request. Please try again.',
                      ),
                    );
                }}
              />
              {error ? (
                <p className="mt-3 text-[12.5px] text-[var(--red)]">{error}</p>
              ) : null}
              {paymentError ? (
                <div className="mt-3">
                  <p className="m-0 text-[12.5px] leading-5 text-[var(--red)]">
                    {paymentError}
                  </p>
                  {unpaid && !confirming ? (
                    <button
                      type="button"
                      onClick={() => void recheckPayment()}
                      className="mt-1 text-[12.5px] font-medium text-[var(--red)] underline"
                    >
                      Check again
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </section>
      )}

      <section className="mt-6">
        <h2 className="m-0 mb-2 font-[family-name:var(--font-head)] text-[18px] font-medium leading-[1.2] text-[var(--text-primary)]">
          What SAPS needs
        </h2>
        <PackSummary
          licenceType={sheet.application.licenceType}
          needs={sheet.needs.needs}
        />
      </section>
    </main>
  );
}
