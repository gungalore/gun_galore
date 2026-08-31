'use client';

import { useState } from 'react';
import type { ScanFilter } from '@/lib/scan/capture';
import type { Quality } from '@/lib/scan/quality';
import Zoomable from '../zoomable';
import { T, primaryBtn, quietBtn } from '../scan-theme';

// ────────────────────────────────────────────────────────────────────
// CHECK IT OVER.
//
// ⚠️ THE OLD REVIEW SCREEN SHOWED A PICTURE AND FOUR BUTTONS. It never said
// whether the scan was any good, never let the page be named, and never let it
// be rotated — so a sideways certificate had to be retaken and a member had no
// way to tell a 500 dpi scan from a 140 dpi one. Every number needed to answer
// that was already being measured and thrown away.
//
// The badge is the headline: one word, its reason underneath, and the detail
// on tap. Everything else on this screen is an action on the page in front of
// them.
// ────────────────────────────────────────────────────────────────────

const GRADE_STYLE = {
  good: { ink: T.good, wash: T.goodWash, line: T.goodLine },
  acceptable: { ink: T.warn, wash: T.warnWash, line: T.warnLine },
  poor: { ink: T.danger, wash: T.redWash, line: 'rgba(200,16,46,0.3)' },
} as const;

function ToolButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        minHeight: T.tap,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        border: 'none',
        background: 'none',
        cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'inherit',
        color: disabled ? T.ink3 : T.ink2,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {icon}
      <span style={{ fontSize: 11, fontWeight: 600 }}>{label}</span>
    </button>
  );
}

const ICON = {
  add: (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
      <path d="M14 3v5h5M12 12v5M9.5 14.5h5" />
    </svg>
  ),
  corners: (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8V5a1 1 0 011-1h3M20 8V5a1 1 0 00-1-1h-3M4 16v3a1 1 0 001 1h3M20 16v3a1 1 0 01-1 1h-3" />
    </svg>
  ),
  rotate: (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 11a8 8 0 10-2.3 5.7" />
      <path d="M20 5v6h-6" />
    </svg>
  ),
  retake: (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8.5A1.5 1.5 0 014.5 7h2.2l1.2-2h6.2l1.2 2h2.2A1.5 1.5 0 0119 8.5v8A1.5 1.5 0 0117.5 18h-13A1.5 1.5 0 013 16.5v-8z" />
      <circle cx="11" cy="12" r="3.2" />
    </svg>
  ),
};

export default function ReviewScreen({
  preview,
  quality,
  name,
  onName,
  filter,
  onFilter,
  busy,
  onDiscard,
  onSave,
  onAddPage,
  onCorners,
  onRotate,
  onRetake,
  onSaveToPhone,
  pageCount,
}: {
  preview: string;
  quality: Quality;
  name: string;
  onName: (v: string) => void;
  filter: ScanFilter;
  onFilter: (f: ScanFilter) => void;
  busy?: boolean;
  onDiscard: () => void;
  onSave: () => void;
  onAddPage: () => void;
  onCorners: () => void;
  onRotate: () => void;
  onRetake: () => void;
  /** Diagnostics only. */
  onSaveToPhone?: () => void;
  pageCount: number;
}) {
  const [why, setWhy] = useState(false);
  const g = GRADE_STYLE[quality.grade];

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
          onClick={onDiscard}
          disabled={busy}
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
          Discard
        </button>
        <span style={{ fontFamily: T.head, fontSize: 16, fontWeight: 600 }}>
          Check it over
        </span>
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
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
          {pageCount > 1 ? 'Done' : 'Save'}
        </button>
      </div>

      {/* ⚠️ THE NAME IS EDITABLE HERE AND NOWHERE ELSE. A member who has just
          looked at the page knows what it is; asking them later, in a list of
          twelve identical thumbnails, does not work. */}
      <label
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 14px',
          background: T.inset,
          borderBottom: `1px solid ${T.divider}`,
        }}
      >
        <input
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="Name this document"
          aria-label="Document name"
          style={{
            flex: 1,
            minHeight: T.tap,
            border: 'none',
            background: 'transparent',
            fontSize: 13.5,
            fontFamily: 'inherit',
            color: T.ink,
            outline: 'none',
          }}
        />
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.ink3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
        </svg>
      </label>

      <div
        style={{
          flex: 1,
          position: 'relative',
          background: '#E8E5DE',
          display: 'flex',
          padding: 12,
          minHeight: 0,
        }}
      >
        <button
          type="button"
          onClick={() => setWhy((v) => !v)}
          aria-expanded={why}
          style={{
            position: 'absolute',
            top: 10,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 2,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            minHeight: 34,
            padding: '0 12px',
            borderRadius: 999,
            background: T.card,
            border: `1px solid ${g.line}`,
            fontFamily: 'inherit',
            fontSize: 12.5,
            fontWeight: 600,
            color: T.ink,
            cursor: 'pointer',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: g.ink,
            }}
          />
          {quality.label}
          {quality.dpiLabel}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.ink3} strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" />
          </svg>
        </button>

        {why && (
          <div
            style={{
              position: 'absolute',
              top: 52,
              left: 12,
              right: 12,
              zIndex: 3,
              padding: '12px 14px',
              borderRadius: T.r.md,
              background: g.wash,
              border: `1px solid ${g.line}`,
            }}
          >
            <div style={{ fontSize: 13, lineHeight: 1.45, color: T.ink }}>
              {quality.detail}
            </div>
            {quality.reasons.length > 1 && (
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, color: T.ink2 }}>
                {quality.reasons.slice(1).map((r) => (
                  <li key={r} style={{ marginTop: 2 }}>
                    {r}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <Zoomable src={preview} alt="The document as it will be saved" />
      </div>

      <div
        style={{
          flex: 'none',
          display: 'flex',
          gap: 8,
          justifyContent: 'center',
          flexWrap: 'wrap',
          padding: '10px 14px 4px',
        }}
      >
        {(['shadow', 'none'] as const).map((f) => {
          const on = filter === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => onFilter(f)}
              disabled={busy}
              aria-pressed={on}
              style={{
                minHeight: 40,
                padding: '0 14px',
                borderRadius: T.r.md,
                border: on ? '1px solid transparent' : `1px solid ${T.border}`,
                background: on ? '#E8B53A' : T.card,
                color: on ? '#1A1614' : T.ink,
                fontSize: 13,
                fontWeight: on ? 700 : 400,
                fontFamily: 'inherit',
                cursor: 'pointer',
                opacity: busy ? 0.5 : 1,
              }}
            >
              {f === 'shadow' ? 'Remove shadows' : 'No filter'}
            </button>
          );
        })}
        {onSaveToPhone && (
          <button
            type="button"
            onClick={onSaveToPhone}
            style={{
              minHeight: 40,
              padding: '0 12px',
              borderRadius: T.r.md,
              border: `1px dashed rgba(26,22,19,0.35)`,
              background: 'transparent',
              color: T.ink2,
              fontSize: 13,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            Save to phone
          </button>
        )}
      </div>

      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'stretch',
          gap: 2,
          padding: '4px 6px',
          borderTop: `1px solid ${T.divider}`,
        }}
      >
        <ToolButton label="Add page" icon={ICON.add} onClick={onAddPage} disabled={busy} />
        <ToolButton label="Corners" icon={ICON.corners} onClick={onCorners} disabled={busy} />
        <ToolButton label="Rotate" icon={ICON.rotate} onClick={onRotate} disabled={busy} />
        <ToolButton label="Retake" icon={ICON.retake} onClick={onRetake} disabled={busy} />
      </div>

      <div
        style={{
          flex: 'none',
          padding: '6px 16px max(14px, env(safe-area-inset-bottom))',
        }}
      >
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          style={{ ...primaryBtn, width: '100%', opacity: busy ? 0.6 : 1 }}
        >
          {busy ? 'Working…' : pageCount > 1 ? `Save all ${pageCount}` : 'Save it'}
        </button>
      </div>
    </div>
  );
}
