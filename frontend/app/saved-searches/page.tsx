'use client';

// P5.1 — Saved-search management. Lists the signed-in user's saved searches
// with a link to re-run each, a pause/resume alert toggle, and delete.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth, useUser } from '@clerk/nextjs';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface SavedSearch {
  id: string;
  label: string;
  href: string;
  notifyEnabled: boolean;
  createdAt: string;
}

export default function SavedSearchesPage() {
  const { isSignedIn, isLoaded } = useUser();
  const { getToken } = useAuth();
  const [rows, setRows] = useState<SavedSearch[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) {
        setRows([]);
        return;
      }
      const r = await fetch(`${API_URL}/saved-searches`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      setRows(r.ok ? ((await r.json()) as SavedSearch[]) : []);
    } catch {
      setRows([]);
    }
  }, [getToken]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setRows([]);
      return;
    }
    void load();
  }, [isLoaded, isSignedIn, load]);

  async function toggle(s: SavedSearch) {
    setBusy(s.id);
    // Optimistic.
    setRows(
      (prev) =>
        prev?.map((r) =>
          r.id === s.id ? { ...r, notifyEnabled: !r.notifyEnabled } : r,
        ) ?? prev,
    );
    try {
      const token = await getToken();
      await fetch(`${API_URL}/saved-searches/${s.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ notifyEnabled: !s.notifyEnabled }),
      });
    } catch {
      // Roll back on failure.
      setRows(
        (prev) =>
          prev?.map((r) =>
            r.id === s.id ? { ...r, notifyEnabled: s.notifyEnabled } : r,
          ) ?? prev,
      );
    } finally {
      setBusy(null);
    }
  }

  async function remove(s: SavedSearch) {
    setBusy(s.id);
    const prevRows = rows;
    setRows((prev) => prev?.filter((r) => r.id !== s.id) ?? prev);
    try {
      const token = await getToken();
      await fetch(`${API_URL}/saved-searches/${s.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      setRows(prevRows ?? null);
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1
        className="text-xl mb-1"
        style={{ color: 'var(--text-primary)', fontWeight: 600 }}
      >
        Saved searches
      </h1>
      <p className="text-sm mb-5" style={{ color: 'var(--text-tertiary)' }}>
        We&rsquo;ll alert you the moment a new listing matches — so you never
        miss the gear you&rsquo;re hunting for.
      </p>

      {!isLoaded || rows === null ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Loading…
        </p>
      ) : !isSignedIn ? (
        <div
          className="rounded-[8px] py-10 px-6 text-center"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px dashed var(--border)',
          }}
        >
          <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
            Sign in to save searches and get new-listing alerts.
          </p>
          <Link
            href="/sign-in"
            className="inline-block rounded-[6px] px-4 py-2 text-sm"
            style={{ background: 'var(--red)', color: '#fff', fontWeight: 500 }}
          >
            Sign in
          </Link>
        </div>
      ) : rows.length === 0 ? (
        <div
          className="rounded-[8px] py-10 px-6 text-center"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px dashed var(--border)',
          }}
        >
          <p className="text-sm mb-2" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
            No saved searches yet
          </p>
          <p className="text-sm mb-4" style={{ color: 'var(--text-tertiary)' }}>
            Filter the marketplace to what you&rsquo;re after, then tap
            &ldquo;Alert me on new matches&rdquo;.
          </p>
          <Link
            href="/"
            className="inline-block rounded-[6px] px-4 py-2 text-sm"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
              fontWeight: 500,
            }}
          >
            Browse the marketplace
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((s) => (
            <li
              key={s.id}
              className="rounded-[8px] p-4 flex items-start justify-between gap-3"
              style={{
                background: 'var(--bg-card)',
                border: '0.5px solid var(--border)',
              }}
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={s.href}
                  className="text-[15px] block truncate hover:underline"
                  style={{ color: 'var(--text-primary)', fontWeight: 500 }}
                >
                  {s.label}
                </Link>
                <p
                  className="text-[12px] mt-0.5"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {s.notifyEnabled ? 'Alerts on' : 'Alerts paused'}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => toggle(s)}
                  disabled={busy === s.id}
                  className="text-[12px] rounded-[6px] px-2.5 py-1"
                  style={{
                    background: 'var(--bg-inset)',
                    border: '0.5px solid var(--border)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {s.notifyEnabled ? 'Pause' : 'Resume'}
                </button>
                <button
                  type="button"
                  onClick={() => remove(s)}
                  disabled={busy === s.id}
                  aria-label="Delete saved search"
                  className="text-[12px] rounded-[6px] px-2.5 py-1"
                  style={{
                    background: 'transparent',
                    border: '0.5px solid var(--border)',
                    color: 'var(--red)',
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
