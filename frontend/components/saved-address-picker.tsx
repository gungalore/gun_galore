'use client';

// UX-3 — saved-address picker for checkout (address book, P2.3).
//
// Fetches the buyer's address book (GET /users/me/addresses). Renders NOTHING
// unless they have `minToShow`+ saved addresses (default 2), so first-time /
// single-address buyers see exactly today's flow — the picker never blocks
// them. With 2+ addresses it shows Takealot-style radio cards and, on select,
// calls onSelect(address). The HOST form maps the picked Address into the same
// state it already submits, so the checkout POST payload is byte-identical to a
// typed address (no contract change). It auto-selects the default once so the
// form is pre-populated without a required click.
//
// Presentation + read only — it never writes to the address book or the order.

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import type { Address } from '@/lib/types';
import { PROVINCE_LABELS } from '@/lib/utils';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export function SavedAddressPicker({
  onSelect,
  onAddNew,
  minToShow = 2,
}: {
  onSelect: (a: Address) => void;
  /** Optional — reveal the host form's "enter a different address" capture. */
  onAddNew?: () => void;
  minToShow?: number;
}) {
  const { getToken, isSignedIn } = useAuth();
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const autoSelected = useRef(false);

  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const r = await fetch(`${API_URL}/users/me/addresses`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!r.ok) return; // non-fatal — host keeps its existing address flow
        const data = (await r.json()) as Address[];
        if (!cancelled) setAddresses(Array.isArray(data) ? data : []);
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, isSignedIn]);

  // Auto-select the default (or first) address once, so the payload is ready
  // without a required click.
  useEffect(() => {
    if (autoSelected.current) return;
    if (!addresses || addresses.length < minToShow) return;
    const def = addresses.find((a) => a.isDefault) ?? addresses[0];
    if (def) {
      autoSelected.current = true;
      setSelectedId(def.id);
      onSelect(def);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addresses, minToShow]);

  if (!addresses || addresses.length < minToShow) return null;

  return (
    <div className="space-y-2 mb-3">
      {addresses.map((a) => {
        const active = selectedId === a.id;
        return (
          <label
            key={a.id}
            className="flex items-start gap-3 rounded-[6px] p-3 cursor-pointer"
            style={{
              background: active ? 'rgba(200,16,46,0.06)' : 'var(--bg-inset)',
              border: `0.5px solid ${active ? 'var(--red)' : 'var(--border)'}`,
            }}
          >
            <input
              type="radio"
              name="saved-address"
              checked={active}
              onChange={() => {
                setSelectedId(a.id);
                onSelect(a);
              }}
              style={{ marginTop: 2, accentColor: 'var(--red)' }}
            />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="flex items-center gap-2 flex-wrap">
                {a.label && (
                  <span
                    className="text-xs px-1.5 py-0.5 rounded-[3px]"
                    style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '0.5px solid var(--border)' }}
                  >
                    {a.label}
                  </span>
                )}
                {a.isDefault && (
                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    Default
                  </span>
                )}
              </span>
              <span className="block text-sm mt-1" style={{ color: 'var(--text-primary)' }}>
                {[a.building, a.street].filter(Boolean).join(', ')}
              </span>
              <span className="block text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {[a.suburb, a.city, a.postalCode].filter(Boolean).join(', ')} ·{' '}
                {PROVINCE_LABELS[a.province] ?? a.province}
              </span>
            </span>
          </label>
        );
      })}
      {onAddNew && (
        <button
          type="button"
          onClick={onAddNew}
          className="text-xs"
          style={{
            color: 'var(--text-secondary)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            textDecoration: 'underline',
            padding: '2px 0',
          }}
        >
          + Enter a different address
        </button>
      )}
    </div>
  );
}
