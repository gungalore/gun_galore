'use client';

import { useEffect, useRef, useState } from 'react';
import { BRAND_NAME } from '@/lib/brand';
import { SignInButton } from '@clerk/nextjs';
import { IconSparkles } from './icons';
import { KbHitsRow } from './kb-hits';
import type { AskGgKbHit } from '@/lib/use-ask-gg';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Ask Boet Everywhere — the signed-out panel body.
//
// Zero Claude spend for anonymous visitors: they get instant answers
// from the verified Help Centre (the PUBLIC read-only endpoint added in
// W3 — /ask-gg/public/kb/search) plus a sign-in CTA to unlock the chat.
// "This helped" is hidden (needs an authed endpoint).

export function AskGgSignedOut() {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<AskGgKbHit[]>([]);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced public KB search — mirrors the composer's search-first UX.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 5) {
      setHits([]);
      setSearched(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await fetch(
          `${API_URL}/ask-gg/public/kb/search?q=${encodeURIComponent(q)}`,
          { cache: 'no-store' },
        );
        if (!r.ok) return;
        const rows = (await r.json()) as AskGgKbHit[];
        setHits(Array.isArray(rows) ? rows : []);
        setSearched(true);
      } catch {
        // network blip — quiet; the sign-in CTA is the fallback
      }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ color: 'var(--red)', display: 'inline-flex' }}>
          <IconSparkles />
        </span>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--text-primary)', fontWeight: 600 }}>
          Ask Boet — {BRAND_NAME}&apos;s assistant
        </p>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        Instant answers about buying, selling, fees, shipping and how the
        store works — try a question below. Sign in to chat with Ask Boet
        about anything outdoors: gear advice, live stock and your own orders.
      </p>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="e.g. what fees do sellers pay?"
        aria-label="Search Help Centre"
        style={{
          width: '100%',
          padding: '10px 14px',
          fontSize: 14,
          background: 'var(--bg-input, var(--bg-card))',
          color: 'var(--text-primary)',
          border: '0.5px solid var(--border)',
          borderRadius: 10,
          outline: 'none',
        }}
      />

      {hits.length > 0 && (
        <KbHitsRow
          hits={hits}
          onHelpful={() => {}}
          onDismiss={() => {
            setHits([]);
            setSearched(false);
          }}
          canMarkHelpful={false}
        />
      )}
      {searched && hits.length === 0 && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary)' }}>
          No instant answer for that yet — sign in and ask Ask Boet directly.
        </p>
      )}

      <SignInButton mode="modal">
        <button
          type="button"
          style={{
            marginTop: 4,
            padding: '11px 16px',
            fontSize: 14,
            fontWeight: 600,
            background: 'var(--red)',
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            cursor: 'pointer',
          }}
        >
          Sign in to chat with Ask Boet
        </button>
      </SignInButton>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--text-tertiary)' }}>
        Free to join — 5 assistant questions a month on the free tier, and
        site &amp; account help doesn&apos;t count against it once live.
      </p>
    </div>
  );
}
