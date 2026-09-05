'use client';

import { T, primaryBtn, quietBtn } from '../scan-theme';

// ────────────────────────────────────────────────────────────────────
// THE ACKNOWLEDGEMENT SHEET — a poor page is stopped at the door.
//
// ⚠️ NOT A BADGE. The review screen already showed a red "Poor" chip, and a
// member in a hurry tapped straight past it; the Document Centre then held a
// blurred licence whose serial no reader could recover. Scanbot's ready-made
// flow puts an acknowledgement screen between capture and review for exactly
// this: the three defects nothing downstream repairs — blur, clipping, too
// few pixels — are worth one deliberate tap while the document is still on
// the desk in front of them.
//
// It asks once, for THIS capture. "Keep anyway" is a real choice, not a
// nag: a member who knows the page is legible enough for their purpose must
// not be refused. It never appears for a reopened tray page — that one has
// already been acknowledged.
// ────────────────────────────────────────────────────────────────────

export default function QualityGate({
  reason,
  onRetake,
  onKeep,
}: {
  /** The one sentence gradeScan gave for the poor grade. */
  reason: string;
  onRetake: () => void;
  onKeep: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="gg-gate-head"
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'flex-end',
        fontFamily: T.font,
        zIndex: 5,
      }}
    >
      <div
        style={{
          width: '100%',
          background: T.bg,
          color: T.ink,
          borderRadius: `${T.r.md}px ${T.r.md}px 0 0`,
          padding: '18px 16px max(16px, env(safe-area-inset-bottom))',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 6,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: T.danger,
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
              fontWeight: 700,
              flex: 'none',
            }}
          >
            !
          </span>
          <h2
            id="gg-gate-head"
            style={{
              margin: 0,
              fontFamily: T.head,
              fontSize: 17,
              fontWeight: 600,
            }}
          >
            This one came out poor
          </h2>
        </div>
        <p style={{ margin: '0 0 14px', fontSize: 14, lineHeight: 1.45, color: T.ink2 }}>
          {reason}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button type="button" onClick={onRetake} style={{ ...primaryBtn, width: '100%' }}>
            Take it again
          </button>
          <button type="button" onClick={onKeep} style={{ ...quietBtn, width: '100%' }}>
            Keep it anyway
          </button>
        </div>
      </div>
    </div>
  );
}
