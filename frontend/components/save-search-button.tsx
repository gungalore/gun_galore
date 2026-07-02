'use client';

// P5.1 — "Alert me" button. Captures the user's current browse filters into a
// SavedSearch so they get an in-app + push alert when a NEW matching ACTIVE
// listing is published. Renders only when at least one real filter is active
// (saving "everything" would be spam) and hides itself entirely when the whole
// feature endpoint isn't available yet (graceful pre-deploy).

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth, useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// The SearchParams keys that count as a real filter (sort/page don't).
const FILTER_KEYS = [
  'q',
  'categoryId',
  'listingType',
  'condition',
  'province',
  'make',
  'minPrice',
  'maxPrice',
  'attrs',
] as const;

// Structurally matches the homepage SearchParams (all filter keys optional
// strings) so it accepts `params` directly without an index-signature clash.
interface Params {
  q?: string;
  categoryId?: string;
  listingType?: string;
  condition?: string;
  province?: string;
  make?: string;
  minPrice?: string;
  maxPrice?: string;
  sort?: string;
  page?: string;
  attrs?: string;
}

export function SaveSearchButton({ params }: { params: Params }) {
  const { isSignedIn } = useUser();
  const { getToken } = useAuth();
  const router = useRouter();
  const [state, setState] = useState<
    'idle' | 'saving' | 'saved' | 'error' | 'signin'
  >('idle');
  const [message, setMessage] = useState<string>('');

  // Which filters are active — also used to build the POST body.
  const body = useMemo(() => {
    const b: Record<string, string> = {};
    for (const k of FILTER_KEYS) {
      const v = params[k];
      if (v) b[k] = v;
    }
    return b;
  }, [params]);

  // No meaningful filter → don't offer to save "all listings".
  if (Object.keys(body).length === 0) return null;

  async function save() {
    if (!isSignedIn) {
      setState('signin');
      return;
    }
    setState('saving');
    try {
      const token = await getToken();
      if (!token) throw new Error('no-token');
      const r = await fetch(`${API_URL}/saved-searches`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => null)) as {
          message?: string;
        } | null;
        setMessage(data?.message || 'Could not save this search.');
        setState('error');
        return;
      }
      setState('saved');
    } catch {
      setMessage('Could not save this search.');
      setState('error');
    }
  }

  if (state === 'saved') {
    return (
      <div
        className="flex items-center gap-2 text-[13px]"
        style={{ color: 'var(--text-secondary)' }}
      >
        <span aria-hidden>🔔</span>
        <span>
          Saved — we&rsquo;ll alert you when a match lists.{' '}
          <Link
            href="/saved-searches"
            className="underline"
            style={{ color: 'var(--text-primary)' }}
          >
            Manage alerts
          </Link>
        </span>
      </div>
    );
  }

  if (state === 'signin') {
    return (
      <button
        type="button"
        onClick={() => router.push('/sign-in')}
        className="flex items-center gap-1.5 text-[13px] rounded-[6px] px-3 py-1.5"
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-secondary)',
        }}
      >
        Sign in to get alerts for this search →
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={save}
        disabled={state === 'saving'}
        className="flex items-center gap-1.5 text-[13px] rounded-[6px] px-3 py-1.5 transition-opacity"
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-primary)',
          opacity: state === 'saving' ? 0.6 : 1,
          fontWeight: 500,
        }}
        aria-label="Save this search and get alerts for new matches"
      >
        <span aria-hidden>🔔</span>
        {state === 'saving' ? 'Saving…' : 'Alert me on new matches'}
      </button>
      {state === 'error' && (
        <span className="text-[12px]" style={{ color: 'var(--red)' }}>
          {message}
        </span>
      )}
    </div>
  );
}
