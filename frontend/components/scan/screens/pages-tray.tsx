'use client';

import type { Grade } from '@/lib/scan/quality';
import { T, primaryBtn, quietBtn } from '../scan-theme';

// ────────────────────────────────────────────────────────────────────
// EVERY PAGE TAKEN SO FAR, AND WHICH ONE IS WEAK.
//
// ⚠️ THIS SCREEN DID NOT EXIST, AND ITS ABSENCE IS WHY MULTI-PAGE WAS A LEAP
// OF FAITH. A member scanning a five-page motivation pack saw one page at a
// time and then a count. They could not look back, could not reorder, could
// not tell which page came out badly, and could not remove the one they took
// twice — the only way to fix anything was to start the whole set again.
//
// ⚠️ AND THE GRADE IS PER PAGE, NOT PER SET. A pack is only as good as its
// worst page, and "4 good, 1 poor" is a fixable situation the member should be
// told about while the document is still in front of them — not after SAPS
// asks for it.
// ────────────────────────────────────────────────────────────────────

export interface TrayPage {
  id: string;
  preview: string;
  grade: Grade;
  dpi: number | null;
  /** Why it is not good, when it is not. */
  note?: string;
}

const GRADE_INK: Record<Grade, string> = {
  good: T.good,
  acceptable: T.warn,
  poor: T.danger,
};

const GRADE_WORD: Record<Grade, string> = {
  good: 'Good',
  acceptable: 'Acceptable',
  poor: 'Poor',
};

export default function PagesTray({
  pages,
  onAdd,
  onRetake,
  onRemove,
  onOpen,
  onMove,
  onSave,
  onBack,
}: {
  pages: TrayPage[];
  onAdd: () => void;
  onRetake: (id: string) => void;
  onRemove: (id: string) => void;
  /** Tap the thumbnail: reopen the page for corners, filter or rotation. */
  onOpen?: (id: string) => void;
  /** Move a page one slot earlier (-1) or later (+1). */
  onMove?: (id: string, dir: -1 | 1) => void;
  onSave: () => void;
  onBack: () => void;
}) {
  const worst = pages.reduce<Grade>(
    (g, p) =>
      p.grade === 'poor' || g === 'poor'
        ? 'poor'
        : p.grade === 'acceptable' || g === 'acceptable'
          ? 'acceptable'
          : 'good',
    'good',
  );
  const weak = pages.filter((p) => p.grade !== 'good');

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: T.bg,
        color: T.ink,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: T.font,
      }}
    >
      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '10px 12px',
          background: T.red,
          color: '#fff',
        }}
      >
        <button
          type="button"
          onClick={onBack}
          style={{
            minHeight: T.tap,
            padding: '0 6px',
            border: 'none',
            background: 'none',
            color: '#fff',
            fontSize: 15,
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          Back
        </button>
        <span style={{ fontFamily: T.head, fontSize: 16, fontWeight: 600 }}>
          {pages.length} {pages.length === 1 ? 'page' : 'pages'}
        </span>
        <button
          type="button"
          onClick={onSave}
          style={{
            minHeight: T.tap,
            padding: '0 6px',
            border: 'none',
            background: 'none',
            color: '#fff',
            fontSize: 15,
            fontWeight: 700,
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          Save
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 12,
          }}
        >
          {pages.map((p, i) => (
            <div key={p.id} style={{ position: 'relative' }}>
              {/* ⚠️ THE THUMBNAIL IS A BUTTON. A page on the pile used to be
                  read-only: once it left the review screen its crop, filter
                  and rotation were fixed, and a bad corner on page 2 of 5
                  meant shooting it again. Tapping reopens it. */}
              <button
                type="button"
                onClick={onOpen ? () => onOpen(p.id) : undefined}
                aria-label={`Open page ${i + 1}`}
                style={{
                  display: 'block',
                  width: '100%',
                  aspectRatio: '210 / 297',
                  border: `1px solid ${T.border}`,
                  borderRadius: T.r.sm,
                  background: T.card,
                  overflow: 'hidden',
                  padding: 0,
                  cursor: onOpen ? 'pointer' : 'default',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.preview}
                  alt={`Page ${i + 1}`}
                  // ⚠️ contain, not cover. A card page cropped to A4
                  // proportions shows a strip of its middle, and two similar
                  // licences become indistinguishable on the pile.
                  style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                />
              </button>
              {onMove && pages.length > 1 && (
                <div
                  style={{
                    position: 'absolute',
                    top: 6,
                    right: 6,
                    display: 'flex',
                    gap: 4,
                  }}
                >
                  {([-1, 1] as const).map((dir) => {
                    const can = dir === -1 ? i > 0 : i < pages.length - 1;
                    return (
                      <button
                        key={dir}
                        type="button"
                        disabled={!can}
                        onClick={() => onMove(p.id, dir)}
                        aria-label={dir === -1 ? `Move page ${i + 1} earlier` : `Move page ${i + 1} later`}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 6,
                          border: 'none',
                          background: 'rgba(0,0,0,0.55)',
                          color: '#fff',
                          opacity: can ? 1 : 0.35,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: can ? 'pointer' : 'default',
                          padding: 0,
                        }}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          {dir === -1 ? <path d="M15 5l-7 7 7 7" /> : <path d="M9 5l7 7-7 7" />}
                        </svg>
                      </button>
                    );
                  })}
                </div>
              )}
              <span
                style={{
                  position: 'absolute',
                  top: 6,
                  left: 6,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: GRADE_INK[p.grade],
                  color: '#fff',
                }}
              >
                {i + 1} · {GRADE_WORD[p.grade]}
              </span>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button
                  type="button"
                  onClick={() => onRetake(p.id)}
                  style={{
                    ...quietBtn,
                    flex: 1,
                    minHeight: 38,
                    fontSize: 12.5,
                  }}
                >
                  Retake
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(p.id)}
                  aria-label={`Remove page ${i + 1}`}
                  style={{
                    ...quietBtn,
                    width: 40,
                    minHeight: 38,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: T.danger,
                  }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13" />
                  </svg>
                </button>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={onAdd}
            style={{
              aspectRatio: '210 / 297',
              border: `1px dashed ${T.border}`,
              borderRadius: T.r.md,
              background: T.hover,
              color: T.ink2,
              fontFamily: 'inherit',
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add another
          </button>
        </div>

        {weak.length > 0 && (
          <div
            style={{
              marginTop: 16,
              padding: '12px 14px',
              borderRadius: T.r.md,
              background: worst === 'poor' ? T.redWash : T.warnWash,
              border: `1px solid ${worst === 'poor' ? 'rgba(200,16,46,0.25)' : T.warnLine}`,
            }}
          >
            <div
              style={{
                fontFamily: T.head,
                fontSize: 13,
                fontWeight: 600,
                color: T.ink,
              }}
            >
              {weak.length === 1
                ? `Page ${pages.indexOf(weak[0]) + 1} is worth another go`
                : `${weak.length} pages are worth another go`}
            </div>
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.45,
                marginTop: 2,
                color: T.ink2,
              }}
            >
              {weak[0].note ??
                (weak[0].dpi
                  ? `${Math.round(weak[0].dpi)} dpi. It will still read, but a retake in better light would be sharper.`
                  : 'A retake in better light would be sharper.')}
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          flex: 'none',
          padding: '0 16px max(16px, env(safe-area-inset-bottom))',
        }}
      >
        <button type="button" onClick={onSave} style={{ ...primaryBtn, width: '100%' }}>
          Save {pages.length === 1 ? 'this page' : `all ${pages.length}`}
        </button>
      </div>
    </div>
  );
}
