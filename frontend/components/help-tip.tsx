'use client';

import { useEffect, useRef, useState } from 'react';

// On-demand explainer that pops a short paragraph when the user
// hovers or taps a small ⓘ icon. Use this for jargon labels and
// single-word controls where always-visible help text would clutter
// the layout — Reserve, Proxy bid, AVS, Tier T3, Trust score, KYC.
//
// Behaviour:
//   • Desktop hover → opens; mouse-out → closes after 80ms (gives the
//     pointer time to enter the popover so the user can click links
//     inside it).
//   • Tap on the icon → toggles open and "locks" it (won't auto-close
//     on mouse-out). Click outside or press Escape to dismiss.
//   • Built with the same pattern as <ProfileCompletionRing>'s
//     popover — no Radix, no Floating UI, no new dependencies.
//
// A11y:
//   • Button has aria-label="More info" (or custom title).
//   • Popover has role="tooltip".
//   • Escape key dismisses.

export function HelpTip({
  title,
  children,
  side = 'bottom',
  width = 260,
}: {
  // Optional label shown above the body (e.g. "Reserve price").
  title?: string;
  // The explanation. Keep to 1-3 sentences.
  children: React.ReactNode;
  // Which side of the icon the popover opens on.
  side?: 'top' | 'bottom' | 'left' | 'right';
  // Cap the popover width — keeps mobile sane.
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Outside-click dismiss + ESC dismiss.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setLocked(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        setLocked(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function clearTimer() {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }

  function handleEnter() {
    clearTimer();
    setOpen(true);
  }

  function handleLeave() {
    if (locked) return;
    clearTimer();
    // Short grace so the user can swipe into the popover to click a link.
    hoverTimer.current = setTimeout(() => setOpen(false), 80);
  }

  function handleClick(e: React.MouseEvent) {
    // Prevent any wrapping <Link> / clickable parent from firing — the
    // user pressed the ⓘ icon, not the card it sits inside.
    e.preventDefault();
    e.stopPropagation();
    if (open && locked) {
      setOpen(false);
      setLocked(false);
    } else {
      setOpen(true);
      setLocked(true);
    }
  }

  // Popover position relative to the wrapper. We default to "bottom" —
  // best for icons that sit on the right of a label, since the
  // popover drops into open space below.
  const posStyle: React.CSSProperties = (() => {
    switch (side) {
      case 'top':
        return { bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)' };
      case 'left':
        return { right: 'calc(100% + 6px)', top: '50%', transform: 'translateY(-50%)' };
      case 'right':
        return { left: 'calc(100% + 6px)', top: '50%', transform: 'translateY(-50%)' };
      case 'bottom':
      default:
        return { top: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)' };
    }
  })();

  return (
    <span
      ref={wrapRef}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <button
        type="button"
        onClick={handleClick}
        aria-label={title ? `${title} — more info` : 'More info'}
        aria-expanded={open}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          marginLeft: 5,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-tertiary)',
          lineHeight: 1,
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden
        >
          <circle
            cx="8"
            cy="8"
            r="7"
            stroke="currentColor"
            strokeWidth="1.2"
            fill="none"
          />
          <circle cx="8" cy="4.7" r="0.85" fill="currentColor" />
          <rect x="7.25" y="6.6" width="1.5" height="5.2" rx="0.6" fill="currentColor" />
        </svg>
      </button>

      {open && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            ...posStyle,
            zIndex: 60,
            width,
            maxWidth: 'min(90vw, ' + width + 'px)',
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
            padding: '10px 12px',
            color: 'var(--text-secondary)',
            fontSize: 12,
            lineHeight: 1.55,
            whiteSpace: 'normal',
            // Lift above hover state so the user can read it without
            // it disappearing the moment they move toward it.
            pointerEvents: 'auto',
          }}
        >
          {title && (
            <div
              style={{
                color: 'var(--text-primary)',
                fontWeight: 500,
                fontSize: 12,
                marginBottom: 4,
              }}
            >
              {title}
            </div>
          )}
          {children}
        </div>
      )}
    </span>
  );
}
