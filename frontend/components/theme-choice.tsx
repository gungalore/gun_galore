'use client';

// Appearance control for the phone / installed PWA.
//
// ⚠️ WHY THIS EXISTS AT ALL: the desktop nav's icon-only toggle
// (components/nav.tsx) is `hidden md:flex`, and it is hidden for a measured
// reason — the mobile ROOT header has 8px of slack at 390px once the
// Shop/Community pill, wishlist, cart and avatar are in it. That left the PWA
// with NO theme control anywhere (operator, 2026-09-30: "on the pwa I can't
// find the dark/light mode switcher"). A labelled row on /account is the one
// surface every signed-in member can reach in the PWA, and it costs the
// crowded header nothing.
//
// Three states, because the pre-paint script and the hook both default to
// `system` (follows the OS). Showing only a two-way Light/Dark switch would
// silently destroy that default with no way back.

import { useEffect, useState } from 'react';
import { useTheme, STORAGE_KEY } from '@/lib/use-theme';

type ThemeValue = 'light' | 'dark' | 'system';

const OPTIONS: { value: ThemeValue; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/**
 * The STORED preference, which is not the same as the resolved theme the hook
 * returns: with nothing stored the page may render dark because the OS says
 * so, and the control must still show "System".
 *
 * Read after mount, never during render — localStorage does not exist on the
 * server, and a first render that disagreed with the server's "System" would
 * be a hydration mismatch.
 */
function readPreference(): ThemeValue {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system'
    ? stored
    : 'system';
}

export function ThemeChoice() {
  const { setTheme } = useTheme();
  const [preference, setPreference] = useState<ThemeValue>('system');

  useEffect(() => {
    setPreference(readPreference());
  }, []);

  return (
    <div
      className="rounded-[10px] p-5 mb-6 flex items-center justify-between gap-4 flex-wrap"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <p
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          Appearance
        </p>
        <p
          style={{
            margin: '4px 0 0',
            fontSize: 12.5,
            color: 'var(--text-tertiary)',
          }}
        >
          Follows your device unless you pick one.
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label="Appearance"
        style={{
          display: 'inline-flex',
          padding: 3,
          gap: 3,
          borderRadius: 'var(--r-sm)',
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
        }}
      >
        {OPTIONS.map((option) => {
          const selected = preference === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                // Writes the preference AND resolves it; the hook syncs
                // data-theme. Local state keeps the pill honest immediately
                // without waiting on the mutation observer.
                setTheme(option.value);
                setPreference(option.value);
              }}
              className="gg-press"
              style={{
                minHeight: 34,
                padding: '0 12px',
                borderRadius: 'var(--r-sm)',
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: selected ? 600 : 500,
                fontFamily: 'inherit',
                background: selected ? 'var(--bg-card)' : 'transparent',
                color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
