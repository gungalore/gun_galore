'use client';

import { useEffect } from 'react';
import { KIND_LABELS, type IdentifyVerdict } from '@/lib/licence-centre-api';

// ────────────────────────────────────────────────────────────────────
// ONE UPLOADER, ONE AI SORT — THE PER-FILE STRIP.
//
// The Evidence panel is gone. It asked the member to type what a file showed
// BEFORE anything had looked at it, and when the classifier still could not
// decide it drew a "we could not decide" row and left them holding it. The
// operator's model replaces that whole surface with something simpler: pick
// the files, the server sorts them, and every file gets a card saying what we
// made of it — right here, in the upload flow the member is already in.
//
// ⚠️ THE POLISH HAPPENS AROUND THIS STRIP, PER FILE, AND ONLY FOR DOCUMENTS.
// "Polish" is the scanner treatment — crop to the page outline, straighten,
// remove the shadow, make it look scanned. A hunting photograph must NOT be
// polished: the scanned look flatters paper and ruins the picture. So the
// order is fixed and load-bearing —
//
//     pick RAW → identify → (documents only) polish → upload with the id
//
// and a photograph goes up exactly as it was taken. Moving `enhance` back in
// front of identify would quietly start cropping evidence, which nobody would
// notice until a hunt photo looked like a photocopy. See the component spec
// that pins the order.
//
// ⚠️ THE STRIP IS PRESENTATIONAL. It owns no state: the description, the
// verdict and the state of each card live with the caller, which is the only
// thing that can actually resend the words or read the stored row back. A
// component that quietly mutated a card it was handed would be a second source
// of truth for the one thing (the description) the member is editing.
//
// ⚠️ THE ID IS THE SERVER'S. The caller holds `id → file` and sends the id back
// with the upload; the server reads its own verdict out of that record.
// Nothing the client says about a file is trusted, which is why there is no
// container dropdown and no kind control here — the correction for an
// unresolved item is more words, and the words go to the classifier.
// ────────────────────────────────────────────────────────────────────

/** One file, from the picker through to being filed. */
export interface BatchCard {
  /** The id the SERVER minted for this file in identify(). */
  id: string;
  file: File;
  /** Object URL of the picked file, or null for a PDF. The caller revokes it. */
  url: string | null;
  verdict: IdentifyVerdict;
  /**
   * 'waiting' → 'working' → 'ready' → 'done' | 'failed'.
   *
   * ⚠️ 'ready' IS THE PREVIEW'S STATE, NOT THE STRIP'S. It means the file has
   * been identified and, if it is a document, polished — and is now waiting on
   * the member's confirm. Nothing has been stored yet. The strip below only
   * ever sees 'done'/'failed', because the preview replaces it for the whole
   * 'ready' window; the state lives on the shared card so the two surfaces
   * cannot disagree about what has and has not been filed.
   */
  state: 'waiting' | 'working' | 'ready' | 'done' | 'failed';
  /** What went wrong, in the member's words. */
  err: string | null;
  /**
   * The bytes that will actually be uploaded: the enhancer's JPEG for a
   * document, the untouched original for evidence, a PDF or a passed-through
   * file. Null until the enhance step has run for this card.
   */
  prepared: File | null;
  /**
   * Object URL of `prepared`, drawn in the preview. The caller mints and
   * revokes it, as it already does for `url`.
   */
  previewUrl: string | null;
  /**
   * The member's words about the file, for an unresolved evidence item. Held
   * by the caller; this strip only shows and edits it.
   */
  description: string;
  /** The stored vault row, once the file has landed. Null until then. */
  rowId: string | null;
  /** Where the stored evidence prints, read off the upload response. */
  placement: 'annexure' | 'body' | null;
}

/**
 * Where an evidence item will print, in the member's words.
 *
 * ⚠️ IT IS SAID BEFORE THE PACK IS BUILT, NOT AFTER. "Prints on its own page"
 * and "prints on your Activities page" are the two things a member is choosing
 * between when they describe a photograph, and the classifier's answer is the
 * only place they find out which one they got.
 */
export function placementLine(placement: 'annexure' | 'body' | null): string {
  return placement === 'annexure'
    ? 'This will print on its own page in your pack.'
    : 'This will print on your Activities page.';
}

/**
 * How the strip speaks about one verdict, in one line.
 *
 * ⚠️ AN UNRESOLVED EVIDENCE ITEM IS NOT AN ERROR. A missing container is the
 * classifier being cautious — a wrong one moves the file's page and ticks a
 * DFO's checklist row for something that does not answer it — so the strip
 * asks for words rather than apologising.
 */
export function verdictLine(v: IdentifyVerdict): string {
  if (v.role === 'evidence') {
    const label = containerLabel(v.container);
    return label ? `Filed as evidence — ${label}.` : 'We think this is evidence.';
  }
  const label = (KIND_LABELS as Record<string, string>)[v.kind ?? ''] ?? v.kind;
  return label ? `Filed as ${label}.` : 'We think this is a document.';
}

/**
 * A container id in the member's words, or null when there is none.
 *
 * ⚠️ A LAST-RESORT READING, NOT THE LABEL. The server owns the container
 * vocabulary; this just spaces out an id like `FARM_PERMISSION_LETTER` so a
 * card can say something specific without a second round trip for a taxonomy
 * the strip no longer fetches.
 */
export function containerLabel(container: string | null): string | null {
  if (!container) return null;
  const words = container.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default function UploadBatch({
  cards,
  busy,
  onDescribe,
  onRemove,
  onDescriptionChange,
  onOpen,
}: {
  cards: readonly BatchCard[];
  /** True while any card is being filed — the describe buttons stand down. */
  busy: boolean;
  /**
   * The member typed a few more words about an unresolved item. The caller
   * sorts the stored file again and updates the card with what came back.
   */
  onDescribe: (id: string, description: string) => void | Promise<void>;
  /** Drop a card the member no longer wants filed. */
  onRemove: (id: string) => void;
  /** The member edited the words about a card. */
  onDescriptionChange: (id: string, description: string) => void;
  /** Open a picture full size. The caller owns the URL and the lightbox. */
  onOpen?: (url: string, name: string) => void;
}) {
  /**
   * ⚠️ THE FALLBACK REVOCATION. The caller owns these object URLs and revokes
   * them as cards leave, but a strip that unmounts still holding cards must
   * not leave photographs of somebody's property pinned in memory for the life
   * of the tab.
   */
  useEffect(
    () => () => {
      for (const c of cards) if (c.url) URL.revokeObjectURL(c.url);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (!cards.length) return null;

  return (
    <ul className="mt-3 flex flex-col gap-3">
      {cards.map((c) => (
        <Card
          key={c.id}
          card={c}
          busy={busy}
          onDescribe={onDescribe}
          onRemove={onRemove}
          onDescriptionChange={onDescriptionChange}
          onOpen={onOpen}
        />
      ))}
    </ul>
  );
}

function Card({
  card,
  busy,
  onDescribe,
  onRemove,
  onDescriptionChange,
  onOpen,
}: {
  card: BatchCard;
  busy: boolean;
  onDescribe: (id: string, description: string) => void | Promise<void>;
  onRemove: (id: string) => void;
  onDescriptionChange: (id: string, description: string) => void;
  onOpen?: (url: string, name: string) => void;
}) {
  const working = card.state === 'working';
  /**
   * ⚠️ THE ONE QUESTION THIS STRIP ASKS, AND IT IS ASKED OF THE FILE, NOT OF
   * THE MEMBER'S MEMORY. An evidence item the classifier could not place is
   * already stored — the bytes never move again — and the answer to "what does
   * it show" only ever changes the container. That is why the words are asked
   * for HERE, on the card, and not on a separate panel.
   */
  const needsWords = card.verdict.role === 'evidence' && !card.verdict.container;

  return (
    <li className="flex flex-col gap-3 rounded-[6px] border border-[var(--border)] p-3 sm:flex-row">
      <button
        type="button"
        aria-label={`View ${card.file.name}`}
        disabled={!card.url}
        onClick={() => card.url && onOpen?.(card.url, card.file.name)}
        className="w-full shrink-0 sm:w-32 disabled:cursor-default"
      >
        {card.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.url}
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

        {card.state === 'failed' ? (
          <span className="mt-1 flex flex-wrap items-center gap-3">
            <span className="text-xs text-[var(--red)]">
              {card.err || 'It did not upload.'}
            </span>
            <button
              type="button"
              onClick={() => onRemove(card.id)}
              className="min-h-[38px] px-1 text-[12.5px] text-[var(--text-secondary)] underline"
            >
              Remove
            </button>
          </span>
        ) : (
          <>
            <p className="mt-1 text-[13px] text-[var(--text-primary)]">
              {verdictLine(card.verdict)}
            </p>

            {needsWords ? (
              /* ── the one place the member's words are asked for ─────── */
              <span className="mt-2 block">
                <label className="block text-[11.5px] text-[var(--text-secondary)]">
                  What does it show?
                  <textarea
                    value={card.description}
                    disabled={working || card.rowId === null}
                    rows={2}
                    maxLength={500}
                    onChange={(e) =>
                      onDescriptionChange(card.id, e.target.value)
                    }
                    className="mt-1 w-full rounded-[6px] border border-[var(--border)] bg-[var(--bg-inset)] px-2 py-1.5 text-[13px] text-[var(--text-primary)]"
                    placeholder="Me and my son on a hunt in Limpopo, June"
                  />
                </label>
                <span className="mt-2 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={
                      working ||
                      busy ||
                      !card.rowId ||
                      !card.description.trim()
                    }
                    onClick={() =>
                      void onDescribe(card.id, card.description.trim())
                    }
                    className="min-h-[38px] rounded-[6px] border border-[var(--red)] bg-[var(--red)] px-3 text-[13px] font-semibold text-white hover:bg-[var(--red-hover)] disabled:opacity-50"
                  >
                    {working ? 'Filing…' : 'File it'}
                  </button>
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => onRemove(card.id)}
                    className="min-h-[38px] px-1 text-[12.5px] text-[var(--text-secondary)] underline"
                  >
                    Remove
                  </button>
                </span>
              </span>
            ) : card.state === 'done' ? (
              <span className="mt-1 block text-xs text-[var(--text-secondary)]">
                {card.verdict.role === 'evidence' && card.placement
                  ? `${placementLine(card.placement)} `
                  : ''}
                <button
                  type="button"
                  onClick={() => onRemove(card.id)}
                  className="underline text-[var(--text-tertiary)]"
                >
                  Done
                </button>
              </span>
            ) : (
              /* ⚠️ A WAITING CARD STILL GETS AN ACTION. A card we have not
                 started filing yet — a file an earlier one is still queued
                 behind — used to render as a bare sentence with no control at
                 all, so a member whose batch had stalled was stuck looking at
                 a card they could neither finish nor dismiss. The photo is the
                 most private thing on this page; being unable to drop one is
                 the wrong answer, however the card got there. */
              <span className="mt-1 flex flex-wrap items-center gap-3">
                <span className="text-[11.5px] text-[var(--text-tertiary-on-card)]">
                  {working ? 'Filing…' : 'Waiting to be filed.'}
                </span>
                {!working && (
                  <button
                    type="button"
                    onClick={() => onRemove(card.id)}
                    className="min-h-[38px] px-1 text-[12.5px] text-[var(--text-secondary)] underline"
                  >
                    Remove
                  </button>
                )}
              </span>
            )}
          </>
        )}
      </div>
    </li>
  );
}
