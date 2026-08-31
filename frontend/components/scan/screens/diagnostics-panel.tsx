'use client';

import { useMemo, useState } from 'react';
import { type ReportInput, buildReport, copyText } from '@/lib/scan/diagnostic-report';
import { T, primaryBtn, quietBtn } from '../scan-theme';

// ────────────────────────────────────────────────────────────────────
// THE DIAGNOSTICS SCREEN.
//
// ⚠️ A FULL SCREEN, NOT AN OVERLAY, AND THAT IS THE WHOLE FIX. The old readout
// floated over the viewfinder and over the corner editor — so the member was
// asked to drag four dots onto corners hidden behind a wall of numbers, and
// anything past the fold was simply unreachable. Every hard bug in this
// scanner was then diagnosed from a PHOTOGRAPH of that overlay, which loses
// what scrolled off, cannot be searched, and twice produced a confident wrong
// conclusion from a value that was not in the frame.
//
// So: its own screen, scrollable, with one button that puts the entire state
// on the clipboard.
// ────────────────────────────────────────────────────────────────────

export default function DiagnosticsPanel({
  report,
  onClose,
  onCopyLive,
}: {
  report: ReportInput;
  onClose: () => void;
  /**
   * Re-read the live values at the moment Copy is pressed.
   *
   * ⚠️ WITHOUT THIS THE REPORT IS STALE BY A FRAME. Half of what matters here
   * — motion, lock, confidence, guidance — changes ten times a second, and a
   * snapshot taken when the panel OPENED describes a moment the member has
   * already moved past.
   */
  onCopyLive?: () => ReportInput;
}) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  const text = useMemo(() => buildReport(report), [report]);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: '#0F0E0C',
        color: T.onDark,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: T.font,
        zIndex: 60,
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
          borderBottom: `1px solid ${T.onDarkLine}`,
        }}
      >
        <span style={{ fontFamily: T.head, fontSize: 16, fontWeight: 600 }}>
          Scanner diagnostics
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close diagnostics"
          style={{
            width: T.tap,
            height: T.tap,
            border: 'none',
            background: 'none',
            color: T.onDark,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          padding: '12px 14px',
        }}
      >
        <pre
          style={{
            margin: 0,
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
            fontSize: 11.5,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: T.onDark,
          }}
        >
          {text}
        </pre>
      </div>

      <div
        style={{
          flex: 'none',
          padding: '10px 14px max(14px, env(safe-area-inset-bottom))',
          borderTop: `1px solid ${T.onDarkLine}`,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.4,
            color: T.onDarkMuted,
          }}
        >
          Identity numbers, serials and email addresses are masked. Unit
          standard codes are kept — they identify a training course, not a
          person.
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={async () => {
              const fresh = onCopyLive ? buildReport(onCopyLive()) : text;
              const ok = await copyText(fresh);
              setCopied(ok ? 'ok' : 'failed');
              setTimeout(() => setCopied('idle'), 2500);
            }}
            style={{
              ...primaryBtn,
              flex: 1,
              background: copied === 'ok' ? T.good : T.red,
            }}
          >
            {copied === 'ok'
              ? 'Copied'
              : copied === 'failed'
                ? 'Could not copy — select the text above'
                : 'Copy the whole report'}
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              ...quietBtn,
              flex: 'none',
              padding: '0 18px',
              background: 'transparent',
              border: `1px solid ${T.onDarkLine}`,
              color: T.onDark,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
