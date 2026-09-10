'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  motivationsApi,
  type Colourway,
  type TemplateColourOption,
  type TemplateLayoutKey,
  type TemplateLayoutOption,
  type TokenGetter,
} from '@/lib/motivations-api';

// ────────────────────────────────────────────────────────────────────
// HOW THE DOCUMENT IS SET, AND NOTHING ELSE.
//
// Operator, 2026-09-10: "Can we give them mock ups of each template which costs
// nothing and generate the motivation from there on? ... Call it Design."
//
// ⚠️ THE SAMPLES ARE REAL RENDERS. The server runs the actual document renderer
// and returns page one. Rendering is a pure function over figures already held
// — the expensive half of a motivation is the PROSE — so five genuine covers
// cost nothing but milliseconds.
//
// ⚠️ AND THAT IS THE WHOLE REASON THE OLD PICKER IS NOT COMING BACK. It drew
// its own approximation in the browser, in 511 lines, and drifted: it advertised
// Report as "sans-serif throughout" to members whose packs were all serif, and
// it still promised a spec sheet of barrel length, capacity and mass that was
// deleted in September. A drawing of a document can lie about the document.
//
// ⚠️ IT IS NOT A GATE, AND MUST NEVER BECOME ONE. Operator, repeatedly: "I
// don't want an applicant to sit and read and tick fucking boxes." Banner and
// the house colourway are already chosen, the red button below is still the
// primary action, and somebody who does not care scrolls past without touching
// anything. Same reasoning the sheet footer records for the declaration tick:
// a separate screen for a cosmetic choice is a step we invented.
//
// ⚠️ THE THUMBNAILS ARE CANVASES, NOT PDF IFRAMES, AND THAT COST A SHIPPED
// RELEASE. The first version put each sample in an <iframe src="blob:...pdf">.
// On desktop Chrome it looked perfect. On the operator's phone all five cards
// were empty boxes — iOS Safari and Chrome for iOS do not render a PDF in an
// iframe, and they fail SILENTLY. The pack screen already carries a note
// saying an embed can fail silently and to say so out loud; this reproduced
// that fault five times on one card, on a mobile-first product.
//
// So the page is rasterised here with pdf.js and drawn to a canvas, which
// works on every browser. ⚠️ AND pdf.js IS LOADED LAZILY, ON OPEN. It is a
// third of a megabyte, and the whole point of this card is that it costs
// nothing to somebody who never touches it.
//
// ⚠️ NOTHING HERE CHANGES THE DOCUMENT'S CONTENT. Every layout carries every
// section — pinned by the renderer's own spec — so no choice on this card can
// make an application stronger or weaker. The copy says so plainly rather than
// leaving somebody to wonder whether they picked the wrong one.
// ────────────────────────────────────────────────────────────────────

/**
 * ⚠️ THE API'S OWN TYPES, NEVER A LOCAL COPY. Redeclaring the shape here is how
 * this contract has drifted twice already — `accent` reached the renderer in
 * August and the client type in September. If the server sends a field, the
 * client type is where it must be visible.
 */
export interface DesignPickerProps {
  token: TokenGetter;
  motivationId: string;
  /** What is stored today. Absent means the renderer's own defaults. */
  layout?: string | null;
  colourway?: string | null;
}

export default function DesignPicker({
  token,
  motivationId,
  layout,
  colourway,
}: DesignPickerProps) {
  const [layouts, setLayouts] = useState<TemplateLayoutOption[]>([]);
  const [colours, setColours] = useState<TemplateColourOption[]>([]);
  const [pickedLayout, setPickedLayout] = useState<TemplateLayoutKey>(
    (layout as TemplateLayoutKey) ?? 'banner',
  );
  const [pickedColour, setPickedColour] = useState<Colourway>(
    (colourway as Colourway) ?? 'alloutdoor',
  );
  const [samples, setSamples] = useState<Record<string, string>>({});
  const [drawing, setDrawing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);


  useEffect(() => {
    let cancelled = false;
    motivationsApi
      .templates(token)
      .then((cat) => {
        if (cancelled) return;
        setLayouts(cat.layouts ?? []);
        setColours(cat.colours ?? []);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [token]);

  /**
   * ⚠️ ONLY WHILE THE CARD IS OPEN, AND DEBOUNCED. Rendering is cheap but it is
   * not free, and a member dragging along thirteen swatches would otherwise ask
   * the box for sixty-five documents. Closed, it costs nothing at all — which
   * is what lets this sit on a sheet everybody loads.
   */
  useEffect(() => {
    if (!open || !layouts.length) return;
    let cancelled = false;
    setDrawing(true);
    const timer = setTimeout(() => {
      void (async () => {
        /**
         * ⚠️ THE WORKER IS OFF ON PURPOSE. Wiring pdf.js's worker through
         * Next and past the service worker is a build problem for no gain here:
         * one A4 page at thumbnail size rasterises in well under a frame, and a
         * worker that fails to resolve renders nothing at all - which is the
         * failure this whole change exists to stop repeating.
         */
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        (pdfjs.GlobalWorkerOptions as { workerSrc: string }).workerSrc = '';

        const drawn: Record<string, string> = {};
        await Promise.all(
          layouts.map(async (l) => {
            try {
              const bytes = await motivationsApi.designSampleBytes(
                token,
                motivationId,
                { layout: l.key, colourway: pickedColour },
              );
              const doc = await pdfjs.getDocument({
                data: bytes,
                disableWorker: true,
              } as never).promise;
              const page = await doc.getPage(1);
              const base = page.getViewport({ scale: 1 });
              const viewport = page.getViewport({ scale: 420 / base.width });
              const canvas = document.createElement('canvas');
              canvas.width = Math.ceil(viewport.width);
              canvas.height = Math.ceil(viewport.height);
              const ctx = canvas.getContext('2d');
              if (!ctx) return;
              await page.render({ canvas, canvasContext: ctx, viewport } as never)
                .promise;
              drawn[l.key] = canvas.toDataURL('image/png');
            } catch {
              /* one card that will not draw must not take the other four */
            }
          }),
        );
        if (cancelled) return;
        setSamples(drawn);
        setDrawing(false);
        if (!Object.keys(drawn).length) setFailed(true);
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, layouts, pickedColour, token, motivationId]);

  /**
   * ⚠️ SAVED, BUT NEVER BLOCKING. A failed PATCH leaves the member looking at a
   * selection their document does not have, so the choice is applied to the UI
   * first and the save is fire-and-forget — the renderer falls back to the
   * stored value, and the stored value is whatever last succeeded.
   */
  const save = useCallback(
    (next: { layout?: TemplateLayoutKey; colourway?: Colourway }) => {
      void motivationsApi.setTemplate(token, motivationId, next).catch(() => {});
    },
    [token, motivationId],
  );

  if (failed && !open) return null;

  return (
    <section className="border-t border-[var(--border-divider)] px-4 py-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-[8px] border-0 bg-transparent p-0 text-left"
      >
        <span>
          <span className="block text-[15px] font-medium text-[var(--text-primary)]">
            Design
          </span>
          <span className="mt-0.5 block text-[13px] leading-[1.45] text-[var(--text-tertiary)]">
            How your document is set. It changes nothing about what it says.
          </span>
        </span>
        <span className="shrink-0 text-[13px] text-[var(--red)]">
          {open ? 'Done' : 'Change'}
        </span>
      </button>

      {open ? (
        <div className="mt-4">
          <div className="flex flex-wrap gap-2">
            {colours.map((c) => (
              <button
                key={c.key}
                type="button"
                aria-label={c.name}
                aria-pressed={c.key === pickedColour}
                title={c.name}
                onClick={() => {
                  setPickedColour(c.key);
                  save({ colourway: c.key });
                }}
                className={`h-8 w-8 rounded-full border p-0 ${
                  c.key === pickedColour
                    ? 'border-[var(--text-primary)] border-2'
                    : 'border-[var(--border)]'
                }`}
                style={{ background: c.bannerTo }}
              >
                <span
                  className="mx-auto block h-2 w-2 rounded-full"
                  style={{ background: c.accent }}
                />
              </button>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {layouts.map((l) => (
              <button
                key={l.key}
                type="button"
                aria-pressed={l.key === pickedLayout}
                onClick={() => {
                  setPickedLayout(l.key);
                  save({ layout: l.key });
                }}
                className={`overflow-hidden rounded-[8px] border p-0 text-left ${
                  l.key === pickedLayout
                    ? 'border-2 border-[var(--red)]'
                    : 'border-[var(--border)]'
                }`}
              >
                {/*
                  ⚠️ A4 IS 1:1.414, AND THE FRAME HAS TO BE. Letterboxed into a
                  square the cover shows its banner and nothing else, which is
                  the half that is already obvious from the swatch.
                */}
                <span className="block aspect-[1/1.414] w-full bg-[var(--bg-inset)]">
                  {samples[l.key] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={samples[l.key]}
                      alt={`${l.name} sample cover`}
                      className="block h-full w-full object-contain"
                    />
                  ) : null}
                </span>
                <span className="block px-2 py-1.5">
                  <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                    {l.name}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-[1.4] text-[var(--text-tertiary)]">
                    {l.blurb}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {failed ? (
            <p className="m-0 mt-3 text-[13px] text-[var(--text-tertiary)]">
              We could not draw the samples just now. Your document is
              unaffected — it will be set in {pickedLayout}.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
