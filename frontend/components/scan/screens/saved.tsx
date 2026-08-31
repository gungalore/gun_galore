'use client';

import { av } from '@/lib/asset-version';
import { T, primaryBtn, quietBtn } from '../scan-theme';

// ────────────────────────────────────────────────────────────────────
// WHERE IT WENT.
//
// ⚠️ THE SCANNER USED TO CLOSE AND SAY NOTHING. A member photographed a
// statutory document, the sheet vanished, and they were back where they
// started with no confirmation that anything had been kept. On a document
// somebody may not look at again for a year, "did that work?" is not a
// question to leave them holding.
//
// ⚠️ AND IT SAYS WHERE, NOT JUST THAT. "Saved" is only half an answer on a
// phone; the whole point of this flow is that the file turns up on a computer
// later, and that is the sentence worth spending a line on.
// ────────────────────────────────────────────────────────────────────

export default function Saved({
  count,
  name,
  onAnother,
  onDone,
  followOn,
}: {
  count: number;
  /** What it was called, so the member can find it again. */
  name?: string;
  onAnother: () => void;
  onDone: () => void;
  /**
   * An optional next step, when the caller genuinely knows of one.
   *
   * ⚠️ SUPPLIED, NEVER ASSUMED. The scanner does not know what a document is
   * for — it was opened from somewhere, and only that somewhere knows whether
   * this competency certificate belongs to a motivation, a listing or nothing
   * at all. Inventing a follow-on here would put a confident claim about the
   * member's paperwork in front of them on no evidence.
   */
  followOn?: { title: string; body: string };
}) {
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
          gap: 10,
          padding: '14px 16px',
          borderBottom: `1px solid ${T.divider}`,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={av('/logo-mark-dark.svg')}
          alt=""
          aria-hidden="true"
          style={{ height: 26, width: 'auto' }}
        />
        <span style={{ fontFamily: T.head, fontSize: 15, fontWeight: 600 }}>
          Document Centre
        </span>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '30px 20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        <span
          style={{
            width: 62,
            height: 62,
            borderRadius: '50%',
            background: T.goodWash,
            border: `1px solid ${T.goodLine}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg
            width="30"
            height="30"
            viewBox="0 0 24 24"
            fill="none"
            stroke={T.good}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </span>

        <h2
          style={{
            margin: '16px 0 0',
            fontFamily: T.head,
            fontSize: 21,
            fontWeight: 700,
            textWrap: 'balance',
          }}
        >
          Saved — {count} {count === 1 ? 'page' : 'pages'}
        </h2>
        <p
          style={{
            margin: '8px 0 0',
            fontSize: 14,
            lineHeight: 1.5,
            color: T.ink2,
            maxWidth: 290,
          }}
        >
          {name ? `Your ${name} is` : 'It is'} in your documents. Open it on
          your computer whenever you need it.
        </p>

        {followOn ? (
          <div
            style={{
              width: '100%',
              marginTop: 22,
              textAlign: 'left',
              padding: '14px 16px',
              border: `1px solid ${T.border}`,
              borderRadius: T.r.md,
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
              {followOn.title}
            </div>
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.45,
                marginTop: 3,
                color: T.ink2,
              }}
            >
              {followOn.body}
            </div>
          </div>
        ) : null}
      </div>

      <div
        style={{
          flex: 'none',
          padding: '0 16px max(16px, env(safe-area-inset-bottom))',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <button type="button" onClick={onAnother} style={{ ...primaryBtn, width: '100%' }}>
          Scan another document
        </button>
        <button type="button" onClick={onDone} style={{ ...quietBtn, width: '100%' }}>
          Done
        </button>
      </div>
    </div>
  );
}
