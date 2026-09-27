'use client';

import { type BatchCard, verdictLine } from './upload-batch';

// ────────────────────────────────────────────────────────────────────
// THE LOOK-BEFORE-IT-IS-KEPT STEP.
//
// Operator's flow, in their own words: "read files with AI model, sort
// documents from evidence, enhance and correct documents, open preview for
// user to look at documents so they can make sure they have been correctly
// identified." Everything before this screen already happened — identify has
// sorted the pile and the documents have been cropped — and nothing has been
// stored.
//
// ⚠️ NOTHING IS FILED UNTIL "FILE THESE". The upload used to be folded into
// the same loop that polished a file, so the member's first sight of what we
// made of a document was its row in the vault. Here the whole batch is on one
// screen, in the same order, with the ENHANCED image drawn — the crop is the
// thing being confirmed, so the crop is what is shown.
//
// ⚠️ IT CONFIRMS, IT DOES NOT RE-SORT. The kind is the server's: identify()
// decided it and create() reads it back out of the id. A member who disagrees
// removes the file and adds it again under the right type; there is no second
// kind control here, because there is no second kind.
//
// ⚠️ PRESENTATIONAL, LIKE THE STRIP. It owns no state: the cards, the busy
// flag and the confirm all live with the caller, which is the only thing that
// can actually send a file.
// ────────────────────────────────────────────────────────────────────

export interface BatchPreviewProps {
  cards: readonly BatchCard[];
  /** True while the batch is being filed — the button says so and cannot re-fire. */
  busy: boolean;
  /** Drop a card before it is filed. */
  onRemove: (id: string) => void;
  /** File every prepared card. */
  onConfirm: () => void;
  /** Open a picture full size. The caller owns the URL and the lightbox. */
  onOpen?: (url: string, name: string) => void;
}

export default function BatchPreview({
  cards,
  busy,
  onRemove,
  onConfirm,
  onOpen,
}: BatchPreviewProps) {
  // A card still in the overlay has no bytes yet; a card the member closed the
  // overlay on never got any. Neither can be filed, so the count and the
  // button speak for what is actually ready.
  const ready = cards.filter((c) => c.state === 'ready' && c.prepared);
  if (!cards.length) return null;

  return (
    <section
      className="mt-3 rounded-[10px] border border-[var(--border)] bg-[var(--bg-card)] p-4"
      aria-label="Check your documents"
    >
      <h2 className="m-0 font-[family-name:var(--font-head)] text-[15px] font-medium text-[var(--text-primary)]">
        Check these before we file them
      </h2>
      <p className="m-0 mt-1 text-[13px] leading-[1.4] text-[var(--text-secondary)]">
        Nothing has been saved yet. Remove anything that is wrong, then file the
        rest into your Licence Centre.
      </p>

      <ul className="mt-3 flex flex-col gap-3">
        {cards.map((card) => (
          <Row
            key={card.id}
            card={card}
            busy={busy}
            onRemove={onRemove}
            onOpen={onOpen}
          />
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || !ready.length}
          onClick={onConfirm}
          className="min-h-[42px] rounded-[var(--r-sm)] border border-[var(--red)] bg-[var(--red)] px-[14px] text-[13.5px] font-semibold text-white hover:bg-[var(--red-hover)] disabled:opacity-45"
        >
          {busy ? 'Filing…' : 'File these'}
        </button>
        <span className="text-[12.5px] text-[var(--text-tertiary)]">
          {ready.length === 1
            ? '1 document ready'
            : `${ready.length} documents ready`}
        </span>
      </div>
    </section>
  );
}

function Row({
  card,
  busy,
  onRemove,
  onOpen,
}: {
  card: BatchCard;
  busy: boolean;
  onRemove: (id: string) => void;
  onOpen?: (url: string, name: string) => void;
}) {
  const url = card.previewUrl;
  const canFile = card.state === 'ready' && !!card.prepared;
  return (
    <li className="flex flex-col gap-3 rounded-[6px] border border-[var(--border)] p-3 sm:flex-row">
      <button
        type="button"
        aria-label={`View ${card.file.name}`}
        disabled={!url}
        onClick={() => url && onOpen?.(url, card.file.name)}
        className="w-full shrink-0 sm:w-32 disabled:cursor-default"
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={card.file.name}
            className="aspect-[4/3] w-full rounded-[4px] object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="flex aspect-[4/3] w-full items-center justify-center rounded-[4px] bg-[var(--bg-inset)] text-[10px] font-medium tracking-[0.06em] text-[var(--text-tertiary-on-card)]"
          >
            PDF
          </span>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <p
          className="truncate text-[12px] text-[var(--text-tertiary-on-card)]"
          title={card.file.name}
        >
          {card.file.name}
        </p>
        <p className="mt-1 text-[13.5px] text-[var(--text-primary)]">
          {verdictLine(card.verdict)}
        </p>
        {/*
          ⚠️ A CARD WITH NO BYTES SAYS SO RATHER THAN SHOWING A DEAD X. The
          member closed the crop without keeping it; the honest line is that we
          have nothing to file, and Remove is the way out.
        */}
        {!canFile ? (
          <p className="mt-1 text-[12.5px] text-[var(--gold-strong)]">
            We have nothing to file for this one — remove it and add it again.
          </p>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => onRemove(card.id)}
          className="mt-2 min-h-[36px] px-1 text-[12.5px] text-[var(--text-secondary)] underline disabled:opacity-45"
        >
          Remove
        </button>
      </div>
    </li>
  );
}
