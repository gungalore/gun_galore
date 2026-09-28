'use client';

import { KIND_LABELS } from '@/lib/licence-centre-api';
import { type BatchCard, containerLabel } from './upload-batch';

// ────────────────────────────────────────────────────────────────────
// THE ONE SCREEN — DOCUMENTS SORTED, EVIDENCE SORTED, ONE CONFIRM.
//
// Operator, 2026-09-28: "identified documents gets cropped and all the colour
// and sharpening takes place and the next screen they see is documents sorted
// and evidence sorted, everything is identified and they can just confirm that
// it's right and it goes into the vault."
//
// This replaces the old two-step tail: the "File these" preview AND the
// post-upload date review. It is the ONLY checkpoint between picking files and
// the vault. The documents were already cropped by `autoPolish`; the evidence
// was left exactly as it was taken.
//
// ⚠️ EVIDENCE MUST BE DESCRIBED, AND THE CONFIRM IS DEAD UNTIL IT IS. The
// description is not decoration: the server re-reads the image WITH the words to
// choose the container it will print under (operator: "a text box next to it …
// and send both [image and text] to DeepSeek"). An evidence item with no words
// cannot be placed, so the button that files the batch stays disabled.
//
// ⚠️ THE MAGNIFIER IS ON BOTH GROUPS. The member is checking our work — the
// crop for a document, the photograph itself for evidence — and a thumbnail is
// too small to check anything on.
//
// ⚠️ PRESENTATIONAL. It owns no state: the cards, the descriptions, the bus and
// the confirm all live with the page, which is the only thing that can send a
// file.
// ────────────────────────────────────────────────────────────────────

export interface BatchReviewProps {
  cards: readonly BatchCard[];
  /** True while the batch is being filed — the button says so and cannot re-fire. */
  busy: boolean;
  /** Drop a card before it is filed. */
  onRemove: (id: string) => void;
  /** The member edited the description of an evidence item. */
  onDescriptionChange: (id: string, description: string) => void;
  /** Open a picture full size. The caller owns the URL and the lightbox. */
  onOpen?: (url: string, name: string) => void;
  /** Re-crop / straighten one document it got wrong. */
  onFix?: (id: string) => void;
  /** File every card. */
  onConfirm: () => void;
}

export default function BatchReview({
  cards,
  busy,
  onRemove,
  onDescriptionChange,
  onOpen,
  onFix,
  onConfirm,
}: BatchReviewProps) {
  if (!cards.length) return null;

  const documents = cards.filter((c) => c.verdict.role === 'document');
  const evidence = cards.filter((c) => c.verdict.role !== 'document');

  // ⚠️ THE GATE. Every evidence item must carry words before anything is filed,
  // because the words are what place it. Documents have nothing to type.
  const undescribed = evidence.filter((c) => !c.description.trim());
  const ready = documents.length + evidence.length - undescribed.length;
  // A card still being polished cannot be filed yet.
  const stillWorking = cards.some((c) => c.state === 'working' || c.state === 'waiting');
  const canFile = !busy && !stillWorking && cards.length > 0 && undescribed.length === 0;

  return (
    <section
      className="mt-3 rounded-[10px] border border-[var(--border)] bg-[var(--bg-card)] p-4"
      aria-label="Check your documents"
    >
      <h2 className="m-0 font-[family-name:var(--font-head)] text-[15px] font-medium text-[var(--text-primary)]">
        Check these before we file them
      </h2>
      <p className="m-0 mt-1 text-[13px] leading-[1.4] text-[var(--text-secondary)]">
        Nothing has been saved yet. Check what we made of each one, describe the
        photographs, then file the lot into your Licence Centre.
      </p>

      {documents.length > 0 && (
        <>
          <GroupLabel>Documents</GroupLabel>
          <ul className="flex flex-col gap-3">
            {documents.map((c) => (
              <DocumentRow
                key={c.id}
                card={c}
                busy={busy}
                onRemove={onRemove}
                onOpen={onOpen}
                onFix={onFix}
              />
            ))}
          </ul>
        </>
      )}

      {evidence.length > 0 && (
        <>
          <GroupLabel>Evidence</GroupLabel>
          <ul className="flex flex-col gap-3">
            {evidence.map((c) => (
              <EvidenceRow
                key={c.id}
                card={c}
                busy={busy}
                onRemove={onRemove}
                onOpen={onOpen}
                onDescriptionChange={onDescriptionChange}
              />
            ))}
          </ul>
        </>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!canFile}
          onClick={onConfirm}
          className="min-h-[42px] rounded-[var(--r-sm)] border border-[var(--red)] bg-[var(--red)] px-[14px] text-[13.5px] font-semibold text-white hover:bg-[var(--red-hover)] disabled:opacity-45"
        >
          {busy ? 'Filing…' : 'Confirm and file'}
        </button>
        <span className="text-[12.5px] text-[var(--text-tertiary)]">
          {undescribed.length > 0
            ? undescribed.length === 1
              ? 'Describe the photograph below to continue'
              : `Describe ${undescribed.length} photographs below to continue`
            : ready === 1
              ? '1 item ready'
              : `${ready} items ready`}
        </span>
      </div>
    </section>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 mt-4 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
      {children}
      <span className="h-px flex-1 bg-[var(--border-divider)]" />
    </p>
  );
}

/** The picture, big enough to check, with the magnifier over it. */
function Thumb({
  url,
  name,
  onOpen,
}: {
  url: string | null;
  name: string;
  onOpen?: (url: string, name: string) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`View ${name}`}
      disabled={!url}
      onClick={() => url && onOpen?.(url, name)}
      className="group relative w-full shrink-0 overflow-hidden rounded-[6px] border border-[var(--border)] disabled:cursor-default sm:w-32"
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={name}
          className="aspect-[4/3] w-full object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="flex aspect-[4/3] w-full items-center justify-center bg-[var(--bg-inset)] text-[10px] font-medium tracking-[0.06em] text-[var(--text-tertiary-on-card)]"
        >
          PDF
        </span>
      )}
      {url && (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white"
        >
          <MagnifierGlyph />
        </span>
      )}
    </button>
  );
}

function DocumentRow({
  card,
  busy,
  onRemove,
  onOpen,
  onFix,
}: {
  card: BatchCard;
  busy: boolean;
  onRemove: (id: string) => void;
  onOpen?: (url: string, name: string) => void;
  onFix?: (id: string) => void;
}) {
  const label =
    (KIND_LABELS as Record<string, string>)[card.verdict.kind ?? ''] ??
    card.verdict.kind;
  return (
    <li className="flex flex-col gap-3 rounded-[6px] border border-[var(--border)] p-3 sm:flex-row">
      <Thumb url={card.previewUrl} name={card.file.name} onOpen={onOpen} />
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-[12px] text-[var(--text-tertiary-on-card)]"
          title={card.file.name}
        >
          {card.file.name}
        </p>
        <p className="mt-1 text-[13.5px] text-[var(--text-primary)]">
          {label ? `Filed as ${label}.` : 'We think this is a document.'}
          {!card.verdict.confident && (
            <span className="ml-1 text-[11.5px] text-[var(--warning)]">
              (check this)
            </span>
          )}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {onFix && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onFix(card.id)}
              className="min-h-[36px] px-1 text-[12.5px] text-[var(--text-secondary)] underline disabled:opacity-45"
            >
              Fix crop
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => onRemove(card.id)}
            className="min-h-[36px] px-1 text-[12.5px] text-[var(--text-secondary)] underline disabled:opacity-45"
          >
            Remove
          </button>
        </div>
      </div>
    </li>
  );
}

function EvidenceRow({
  card,
  busy,
  onRemove,
  onOpen,
  onDescriptionChange,
}: {
  card: BatchCard;
  busy: boolean;
  onRemove: (id: string) => void;
  onOpen?: (url: string, name: string) => void;
  onDescriptionChange: (id: string, description: string) => void;
}) {
  const label = containerLabel(card.verdict.container);
  const missing = !card.description.trim();
  return (
    <li className="flex flex-col gap-3 rounded-[6px] border border-[var(--border)] p-3 sm:flex-row">
      <Thumb
        url={card.previewUrl ?? card.url}
        name={card.file.name}
        onOpen={onOpen}
      />
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-[12px] text-[var(--text-tertiary-on-card)]"
          title={card.file.name}
        >
          {card.file.name}
        </p>
        <p className="mt-1 text-[13.5px] text-[var(--text-primary)]">
          {label ? `Evidence — ${label}.` : 'We think this is evidence.'}
        </p>

        <label className="mt-2 block">
          <span className="text-[11.5px] text-[var(--text-secondary)]">
            What does it show?
            {missing && (
              <span className="ml-1 text-[var(--warning)]">(required)</span>
            )}
          </span>
          <textarea
            value={card.description}
            disabled={busy}
            rows={2}
            maxLength={500}
            onChange={(e) => onDescriptionChange(card.id, e.target.value)}
            className="mt-1 w-full rounded-[6px] border border-[var(--border)] bg-[var(--bg-inset)] px-2 py-1.5 text-[13px] text-[var(--text-primary)]"
            placeholder="Me and my son on a hunt in Limpopo, June"
          />
        </label>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => onRemove(card.id)}
            className="min-h-[36px] px-1 text-[12.5px] text-[var(--text-secondary)] underline disabled:opacity-45"
          >
            Remove
          </button>
        </div>
      </div>
    </li>
  );
}

function MagnifierGlyph() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
