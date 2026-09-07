'use client';

import { useEffect, useRef, useState } from 'react';
import { licenceCentreApi } from '@/lib/licence-centre-api';

// ────────────────────────────────────────────────────────────────────
// DRAWING A DOCUMENT, AND THE QUEUE THAT STOPS IT FLOODING THE API.
//
// Lifted out of review-screen.tsx unchanged when the Document Centre grew a
// second surface that draws documents: the grid of safe photographs. The
// GATE is the reason it had to move rather than be copied — two copies would
// be two queues of two, which is four concurrent decrypting reads and defeats
// the thing entirely.
// ────────────────────────────────────────────────────────────────────

/**
 * Two document fetches at a time, no more.
 *
 * ⚠️ A THUMBNAIL COSTS THE MOST EXPENSIVE REQUEST ON THIS PAGE. There is no
 * thumbnail column and nothing generates one: the only way to draw a document
 * is to fetch and decrypt its whole bytes, which is why the detail panel
 * deliberately shows no preview at all. It is worth it on a triage row, which
 * cannot do its job without a picture, and on a grid of safe photographs,
 * which is nothing but pictures. Twelve rows firing twelve concurrent
 * decrypting reads at a single-process API is not, so they queue.
 */
const THUMB_AT_ONCE = 2;
const thumbGate: { active: number; waiting: (() => void)[] } = {
  active: 0,
  waiting: [],
};

export async function withThumbSlot(
  run: () => Promise<void>,
  /** Checked AFTER the wait: a row that has gone must not spend its turn. */
  cancelled: () => boolean,
): Promise<void> {
  if (thumbGate.active >= THUMB_AT_ONCE) {
    await new Promise<void>((resolve) => thumbGate.waiting.push(resolve));
  }
  thumbGate.active += 1;
  try {
    // ⚠️ THE SLOT IS STILL TAKEN AND RELEASED. Returning before `run` skips
    // the fetch, not the bookkeeping — bailing out without the increment and
    // the finally below would leak a slot and eventually wedge the queue.
    if (cancelled()) return;
    await run();
  } finally {
    thumbGate.active -= 1;
    thumbGate.waiting.shift()?.();
  }
}

export function GlyphThumb({
  label,
  className = 'h-10 w-10 shrink-0 rounded-[6px]',
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-center border border-[var(--border)] bg-[var(--bg-inset)] ${className}`}
      aria-hidden
    >
      {label ? (
        <span className="text-[8.5px] font-medium tracking-[0.06em] text-[var(--text-tertiary-on-card)]">
          {label}
        </span>
      ) : (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--border-hover)"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
        </svg>
      )}
    </div>
  );
}

/**
 * The document itself.
 *
 * ⚠️ THE TYPE IS A HINT, NOT A VERDICT. `mimeType` holds whatever the browser
 * declared when the file was picked, copied verbatim and never re-checked
 * against the bytes — so it decides whether to spend a fetch, and the image's
 * own error decides whether the result can actually be drawn.
 */
export function DocThumb({
  token,
  id,
  mimeType,
  className = 'h-10 w-10 shrink-0 rounded-[6px]',
  alt = '',
}: {
  token: () => Promise<string | null>;
  id: string;
  mimeType: string;
  /** Size and shape. The same box is used for the glyph fallback. */
  className?: string;
  alt?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [broke, setBroke] = useState(false);
  /**
   * ⚠️ THE TOKEN GETTER IS HELD IN A REF, NOT A DEPENDENCY. It comes from
   * Clerk through a useCallback; a re-created identity in the dependency list
   * would re-run this effect, and this effect fetches and decrypts a whole
   * document. A refetch loop here is not a wasted render, it is a wasted
   * request per row per render.
   */
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const isImage = mimeType.startsWith('image/');

  useEffect(() => {
    if (!isImage) return;
    let alive = true;
    let made: string | null = null;
    void withThumbSlot(
      async () => {
        try {
          const u = await licenceCentreApi.fileBlobUrl(tokenRef.current, id);
          if (!alive) {
            URL.revokeObjectURL(u);
            return;
          }
          made = u;
          setUrl(u);
        } catch {
          // The glyph is the fallback and says nothing alarming. A thumbnail
          // that will not load is not a reason to interrupt a member who is
          // trying to file their documents.
          if (alive) setBroke(true);
        }
      },
      () => !alive,
    );
    return () => {
      alive = false;
      // ⚠️ REVOKED, ALWAYS. These are decrypted document bytes sitting in
      // browser memory; a batch of twelve left pinned for the life of the tab
      // is both a leak and the wrong thing to leave lying about.
      if (made) URL.revokeObjectURL(made);
    };
  }, [id, isImage]);

  if (!isImage) {
    return (
      <GlyphThumb
        className={className}
        label={mimeType === 'application/pdf' ? 'PDF' : undefined}
      />
    );
  }
  if (!url || broke) return <GlyphThumb className={className} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      onError={() => setBroke(true)}
      className={`border border-[var(--border)] object-cover ${className}`}
    />
  );
}
