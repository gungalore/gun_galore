'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import TemplatePreview, { type PreviewPage } from './motivation-template-preview';
import type {
  Colourway,
  TemplateCatalogue,
  TemplateColourOption,
  TemplateFormat,
  TemplateFormatOption,
  TemplateLayoutKey,
  TemplateLayoutOption,
} from '@/lib/motivations-api';

// ────────────────────────────────────────────────────────────────────
// THE TEMPLATE PICKER — five colourways x three formats.
//
// Operator, 2026-08-19: "It would be nice if the user could have a visual of
// the templates we offer and could choose one to build their motivation on.
// Let's start with 10 templates. With carousel style selector and when they
// click on it it enlarges." Then: "Let's pick a variety of 5 colors to cover
// most peoples taste and then give them 3 formats of each. That makes 15
// templates instead of 10."
//
// ⚠️ FIFTEEN TEMPLATES, NOT FIFTEEN TILES. Rendering the cross product would
// be fifteen near-identical cards where the only difference between five of
// them is a hue — a wall of noise to scroll through, and no way to see that
// the three formats differ in SECTIONS rather than in colour. So it is two
// controls over one preview: pick how much document, pick which colour, watch
// the same page change. The fifteen are all reachable; none of them is a
// separate thing to compare.
//
// ⚠️ NOTHING HERE OPENS A PDF. That is a standing product constraint, not a
// convenience: "we must never open it in a window with a print option to
// prevent them printing to pdf". The enlargement is a bigger DOM mock — see
// motivation-template-preview.tsx.
//
// ⚠️ THE CHOICE IS NOT AN ANSWER. It changes nothing the document argues, so
// it saves through its own endpoint and stays editable after the motivation is
// written: the body is stored text and the PDF is re-rendered on every
// download, so re-skinning a finished pack costs one query and no Claude call.
// ────────────────────────────────────────────────────────────────────

/**
 * Which mock pages the enlargement shows, per format.
 *
 * ⚠️ THE PAGES ARE THE PRODUCT DIFFERENCE. A member comparing Concise with
 * Comprehensive on a cover alone is comparing two identical pictures — the
 * formats are the same colour and the same cover, and they differ in what
 * comes after. So the enlargement shows what each one actually adds.
 */
function pagesFor(format: TemplateFormatOption): PreviewPage[] {
  const pages: PreviewPage[] = ['cover'];
  if (format.features.contents) pages.push('contents');
  pages.push('body');
  if (format.features.specBlock || format.features.ownedTable) pages.push('spec');
  return pages;
}

export default function MotivationTemplatePicker({
  catalogue,
  format,
  colourway,
  layout,
  watermarked,
  onChange,
  saving,
  error,
}: {
  catalogue: TemplateCatalogue;
  format: TemplateFormat;
  colourway: Colourway;
  layout: TemplateLayoutKey;
  watermarked: boolean;
  /** Sends ONLY what changed — see the api client's setTemplate. */
  onChange: (choice: {
    format?: TemplateFormat;
    colourway?: Colourway;
    layout?: TemplateLayoutKey;
  }) => void;
  saving: boolean;
  error: string | null;
}) {
  const [enlarged, setEnlarged] = useState(false);

  /**
   * Bring the chosen card into view on the narrow-screen rail.
   *
   * ⚠️ ON MOUNT ONLY, AND ONLY IF IT IS OFF-SCREEN. The rail is a horizontal
   * scroller on a phone and the selection is often the second or third card,
   * so a member coming back to their application saw "Concise" sitting in the
   * viewport and no sign that they had chosen Standard.
   *
   * `inline: 'nearest'` is doing real work: it makes the call a no-op when the
   * card is already visible, so this never yanks the rail under somebody who
   * has just scrolled it. And the ref guard stops it re-running on every
   * selection — scrolling the card you just tapped is at best pointless.
   */
  const activeCard = useRef<HTMLButtonElement>(null);
  const centred = useRef(false);
  useEffect(() => {
    if (centred.current) return;
    centred.current = true;
    activeCard.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, []);

  const chosenFormat =
    catalogue.formats.find((f) => f.key === format) ?? catalogue.formats[0];
  const chosenColour =
    catalogue.colours.find((c) => c.key === colourway) ?? catalogue.colours[0];
  const chosenLayout =
    catalogue.layouts.find((l) => l.key === layout) ?? catalogue.layouts[0];

  // The catalogue is served, so an empty one means the request failed. Say so
  // rather than rendering an empty rail that looks like "no templates exist".
  if (!chosenFormat || !chosenColour) {
    return (
      <p className="text-sm text-[var(--text-secondary)]">
        We could not load the templates just now. Your document will be prepared
        in the standard format — refresh the page to choose a different one.
      </p>
    );
  }

  return (
    <section aria-labelledby="tpl-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="tpl-h" className="text-base font-semibold">
          How your document looks
        </h3>
        <p className="text-xs text-[var(--text-secondary)]">
          {saving ? 'Saving…' : 'Change this any time, even after it is written'}
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--danger,#b3261e)]">
          {error}
        </p>
      )}

      {/* ── Format: the carousel ──────────────────────────────────────
          Horizontal scroll with snap on a narrow screen, three abreast on a
          wide one. Not a JS carousel with arrows: a native scroller keeps
          keyboard, trackpad, touch momentum and the scrollbar for free, and
          there is nothing here that a pair of chevrons would do better. */}
      <div
        role="radiogroup"
        aria-label="How much document"
        className="mt-3 -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0"
      >
        {catalogue.formats.map((f) => {
          const active = f.key === chosenFormat.key;
          return (
            <button
              key={f.key}
              ref={active ? activeCard : undefined}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange({ format: f.key })}
              className="min-w-[74%] shrink-0 snap-start rounded p-3 text-left transition-colors sm:min-w-0"
              // ⚠️ `rule`, NOT `ink`, FOR THE SELECTION — AND THE REASON IS THE
              // DARK THEME. The five inks are PRINT colours, chosen to sit on
              // white paper: slate is #37474F. Used as a 1.5px border on a
              // near-black card it is invisible, so on prod the selected
              // format was marked by a border nobody could see and a dot the
              // same colour. `rule` is the light member of each triple
              // (#9AA7AD for slate) and reads on both grounds while keeping
              // the colour identity.
              style={{
                background: active ? 'var(--bg-inset)' : 'var(--bg-card)',
                border: `${active ? '1.5px' : '0.5px'} solid ${
                  active ? chosenColour.mut : 'var(--border)'
                }`,
              }}
            >
              {/* ⚠️ A STACK, NOT ONE PAGE, AND THE COUNT IS THE MESSAGE. The
                  first version showed a single page per tile — a different
                  page for each format, so the member was comparing three
                  pictures of three different things and could not see what
                  actually changed. The formats differ in HOW MUCH DOCUMENT,
                  so the honest thumbnail is the pack: two sheets, three, four.
                  You can count them without reading a word. */}
              <PageStack
                format={f}
                colour={chosenColour}
                layout={chosenLayout}
                watermarked={watermarked}
              />
              <p className="mt-3 flex items-center gap-2 text-sm font-semibold">
                {f.name}
                {active && (
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: chosenColour.mut }}
                  />
                )}
              </p>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{f.blurb}</p>
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                {f.lengthHint}
              </p>
            </button>
          );
        })}
      </div>

      {/* ── Style ────────────────────────────────────────────────────── */}
      {/* ⚠️ ABOVE COLOUR, AND SEPARATE FROM IT. Fifty combinations, two
          independent questions: this one decides where the ink goes and the
          row below decides which ink. Presenting them as one list of fifty
          would be unreadable, and presenting the layout as a sub-choice of a
          colour would imply a colour restricts it. Neither restricts the
          other. */}
      {catalogue.layouts.length > 0 && (
        <div
          role="radiogroup"
          aria-label="Document style"
          className="mt-4 flex flex-wrap items-center gap-2"
        >
          {catalogue.layouts.map((l) => {
            const active = l.key === chosenLayout?.key;
            return (
              <button
                key={l.key}
                type="button"
                role="radio"
                aria-checked={active}
                title={l.blurb}
                onClick={() => onChange({ layout: l.key })}
                className="rounded-full px-3 py-1 text-xs transition-colors"
                style={{
                  background: active ? 'var(--bg-inset)' : 'transparent',
                  border: `${active ? '1.5px' : '0.5px'} solid ${
                    active ? chosenColour.mut : 'var(--border)'
                  }`,
                }}
              >
                {l.name}
              </button>
            );
          })}
        </div>
      )}
      {chosenLayout && (
        <p className="mt-2 text-xs text-[var(--text-secondary)]">
          {chosenLayout.blurb}
        </p>
      )}

      {/* ── Colour ───────────────────────────────────────────────────── */}
      <div
        role="radiogroup"
        aria-label="Colour"
        className="mt-4 flex flex-wrap items-center gap-2"
      >
        {catalogue.colours.map((c) => {
          const active = c.key === chosenColour.key;
          return (
            <button
              key={c.key}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={c.name}
              title={c.name}
              onClick={() => onChange({ colourway: c.key })}
              className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-xs transition-colors"
              style={{
                background: active ? 'var(--bg-inset)' : 'transparent',
                border: `${active ? '1.5px' : '0.5px'} solid ${
                  active ? c.mut : 'var(--border)'
                }`,
              }}
            >
              <span
                aria-hidden
                // The circle stays the INK, because it is a sample of what
                // actually prints — showing the lighter rule here would
                // promise a colour the document does not use. The rule serves
                // as its ring, which is what makes a dark ink legible against
                // a dark card.
                className="inline-block h-5 w-5 rounded-full"
                style={{ background: c.deep, border: `1.5px solid ${c.mut}` }}
              />
              {c.name}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setEnlarged(true)}
        className="mt-3 text-sm underline"
      >
        See it larger
      </button>

      {watermarked && (
        // Said once, plainly, near the preview that carries the mark — not as
        // a badge on every tile. ⚠️ No outcome language and no urgency: it
        // states what the mark is and when it comes off, nothing else.
        <p className="mt-2 text-xs text-[var(--text-secondary)]">
          Your preview and download carry a PREVIEW mark until the motivation is
          paid for. The final document is issued without it.
        </p>
      )}

      {enlarged && (
        <EnlargedPreview
          format={chosenFormat}
          colour={chosenColour}
          layout={chosenLayout}
          watermarked={watermarked}
          onClose={() => setEnlarged(false)}
        />
      )}
    </section>
  );
}

/**
 * The pages a format contains, drawn as an overlapping pack.
 *
 * Fanned right and down by a fixed offset rather than a rotation: a rotated
 * stack looks like a stock photograph of paperwork, and this has to read as a
 * DOCUMENT — square, filed, the way it will come out of a printer.
 */
function PageStack({
  format,
  colour,
  layout,
  watermarked,
}: {
  format: TemplateFormatOption;
  colour: TemplateColourOption;
  layout?: TemplateLayoutOption;
  watermarked: boolean;
}) {
  const pages = pagesFor(format);
  const w = 104;
  const step = 13;
  return (
    <div
      className="relative mx-auto"
      style={{
        width: w + step * (pages.length - 1),
        height: w * (841.89 / 595.28) + step * (pages.length - 1),
      }}
    >
      {/* Drawn back to front so the FIRST page sits on top — a pack you are
          looking at the cover of, not the back of. */}
      {pages
        .map((p, i) => ({ p, i }))
        .reverse()
        .map(({ p, i }) => (
          <div
            key={p}
            className="absolute"
            style={{ left: (pages.length - 1 - i) * step, top: (pages.length - 1 - i) * step }}
          >
            <TemplatePreview
              page={p}
              colour={colour}
              format={format}
              layout={layout}
              width={w}
              watermarked={watermarked && i === 0}
            />
          </div>
        ))}
    </div>
  );
}

/**
 * The enlargement.
 *
 * ⚠️ z-[60] AND data-blocking-overlay, both load-bearing. The bottom tab bar
 * is z-55 and would otherwise sit over this; and Boet's dock is z-60 too and,
 * being last in <body>, wins the tie on DOM order — the attribute stands him
 * down for the overlay's lifetime. Every full-screen overlay in this codebase
 * needs both.
 */
function EnlargedPreview({
  format,
  colour,
  layout,
  watermarked,
  onClose,
}: {
  format: TemplateFormatOption;
  colour: TemplateColourOption;
  layout?: TemplateLayoutOption;
  watermarked: boolean;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const pages = pagesFor(format);

  // Escape closes, and focus moves into the panel so a screen reader lands on
  // the dialog rather than staying behind it.
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    // The page behind must not scroll under the overlay on iOS.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onKey]);

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={`${format.name} template, ${colour.name}`}
      data-blocking-overlay="true"
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      style={{ background: 'rgba(0,0,0,0.72)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-full max-w-[920px] rounded-[12px] outline-none"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
      >
        <header
          className="flex items-start justify-between gap-4 px-5 py-4"
          style={{
            background: 'var(--bg-inset)',
            borderBottom: '0.5px solid var(--border)',
          }}
        >
          <div>
            <h4 className="text-sm font-semibold">
              {format.name} · {colour.name}
            </h4>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              {format.lengthHint}. Annexures are added after these pages.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded px-3 py-1.5 text-sm underline"
          >
            Close
          </button>
        </header>

        <div className="px-5 py-5">
          {/* ⚠️ 200px, NOT 214. A comprehensive pack is four pages and at 214
              they came to 944px inside a 920px panel — so the fourth wrapped
              onto a row of its own and read as an afterthought rather than as
              the page the format is chosen for. 4x200 + gaps + padding = 888. */}
          <div className="flex flex-wrap justify-center gap-4">
            {pages.map((p) => (
              <TemplatePreview
                key={p}
                page={p}
                colour={colour}
                format={format}
                layout={layout}
                width={200}
                watermarked={watermarked}
              />
            ))}
          </div>

          <ul className="mx-auto mt-5 max-w-[520px] space-y-1.5 text-sm">
            {format.includes.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden style={{ color: colour.ink }}>
                  ✓
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>

          {/* ⚠️ SAYS WHAT IT IS. A member looking at grey bars deserves to be
              told they are looking at a layout rather than at their own
              words — and this is also where the no-PDF constraint stops being
              a limitation and starts being an explanation. */}
          <p className="mx-auto mt-4 max-w-[520px] text-xs text-[var(--text-secondary)]">
            This shows the layout, not your text — the writing is set once your
            answers are in. Your own document is prepared as a PDF you can
            download when it is ready.
          </p>
        </div>
      </div>
    </div>
  );
}
