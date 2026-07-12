'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SignInButton, useAuth, useUser } from '@clerk/nextjs';
import { apiFetch } from '@/lib/api';
import { Category } from '@/lib/types';
import { PROVINCE_LABELS } from '@/lib/utils';
import { PageReveal } from '@/components/page-reveal';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Post a Wanted ad — free, no upfront fees. Sellers respond with their
// own live listings; buying happens through the normal protected checkout.
export default function NewWantedPage() {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useUser();
  const { getToken } = useAuth();

  const [categories, setCategories] = useState<Category[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [province, setProvince] = useState('');
  const [budgetMin, setBudgetMin] = useState(''); // rands, string inputs
  const [budgetMax, setBudgetMax] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<Category[]>('/categories')
      .then((cats) => {
        if (!cancelled) setCategories(cats);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const roots = categories
    .filter((c) => !c.parentId && c.availableSecondhand)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const childrenOf = (id: string) =>
    categories
      .filter((c) => c.parentId === id && c.availableSecondhand)
      .sort((a, b) => a.sortOrder - b.sortOrder);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const minR = budgetMin.trim() ? Number(budgetMin) : null;
    const maxR = budgetMax.trim() ? Number(budgetMax) : null;
    if (minR != null && (!Number.isFinite(minR) || minR < 1)) {
      setError('Budget minimum must be a positive amount in rands.');
      return;
    }
    if (maxR != null && (!Number.isFinite(maxR) || maxR < 1)) {
      setError('Budget maximum must be a positive amount in rands.');
      return;
    }
    if (minR != null && maxR != null && minR > maxR) {
      setError('Budget minimum cannot exceed the maximum.');
      return;
    }

    setSubmitting(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/wanted`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          categoryId: categoryId || undefined,
          province: province || undefined,
          budgetMinCents: minR != null ? Math.round(minR * 100) : undefined,
          budgetMaxCents: maxR != null ? Math.round(maxR * 100) : undefined,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          (body && (body.message?.message ?? body.message)) ||
            'Could not post your wanted ad — please try again.',
        );
        return;
      }
      router.push(`/wanted/${body.id}`);
    } catch {
      setError('Network problem — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-inset)',
    border: '0.5px solid var(--border)',
    color: 'var(--text-primary)',
    borderRadius: 6,
    padding: '10px 12px',
    fontSize: 14,
    width: '100%',
  };
  const labelStyle: React.CSSProperties = {
    color: 'var(--text-secondary)',
    fontSize: 13,
    marginBottom: 6,
    display: 'block',
  };

  return (
    <main className="max-w-[640px] mx-auto px-4 py-8">
      <PageReveal variant="slide-up">
        <header data-reveal className="mb-6">
          <h1
            className="text-2xl mb-1"
            style={{ color: 'var(--text-primary)', fontWeight: 500 }}
          >
            Post a wanted ad
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            Free to post — no upfront fees. Sellers respond with their live
            listings and you buy with{' '}
            <span style={{ color: 'var(--text-secondary)' }}>
              payment protection
            </span>{' '}
            as always.
          </p>
        </header>

        {isLoaded && !isSignedIn ? (
          <div
            data-reveal
            className="rounded-[8px] p-6 text-center"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
            }}
          >
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              Sign in to post what you&rsquo;re looking for — it takes a minute
              and costs nothing.
            </p>
            <SignInButton mode="modal">
              <button
                type="button"
                className="px-4 py-2.5 rounded-[6px] text-sm font-medium"
                style={{ background: 'var(--red)', color: '#fff' }}
              >
                Sign in to continue
              </button>
            </SignInButton>
          </div>
        ) : (
          <form data-reveal onSubmit={onSubmit} className="flex flex-col gap-4">
            <div>
              <label htmlFor="w-title" style={labelStyle}>
                What are you looking for?
              </label>
              <input
                id="w-title"
                type="text"
                required
                minLength={5}
                maxLength={90}
                placeholder="e.g. Leupold VX-5HD 3-15x44 or similar"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <label htmlFor="w-desc" style={labelStyle}>
                Details — condition, specs, anything a seller should know
              </label>
              <textarea
                id="w-desc"
                required
                minLength={10}
                maxLength={2000}
                rows={5}
                placeholder="Condition you'd accept, must-have specs, deal-breakers… (No phone numbers or emails — sellers respond right here.)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="w-cat" style={labelStyle}>
                  Category (optional)
                </label>
                <select
                  id="w-cat"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">Any category</option>
                  {roots.map((root) => (
                    <optgroup key={root.id} label={root.name}>
                      <option value={root.id}>{root.name} (general)</option>
                      {childrenOf(root.id).map((child) => (
                        <option key={child.id} value={child.id}>
                          {child.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="w-prov" style={labelStyle}>
                  Your province (optional)
                </label>
                <select
                  id="w-prov"
                  value={province}
                  onChange={(e) => setProvince(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">Anywhere in SA</option>
                  {Object.entries(PROVINCE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <span style={labelStyle}>Budget in rands (optional)</span>
              <div className="grid grid-cols-2 gap-4">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={1_000_000}
                  placeholder="From (R)"
                  aria-label="Budget minimum in rands"
                  value={budgetMin}
                  onChange={(e) => setBudgetMin(e.target.value)}
                  style={inputStyle}
                />
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={1_000_000}
                  placeholder="Up to (R)"
                  aria-label="Budget maximum in rands"
                  value={budgetMax}
                  onChange={(e) => setBudgetMax(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                Shown to sellers as a guide — nothing is charged on a wanted ad.
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-[6px] px-3 py-2.5 text-sm"
                style={{
                  background: 'rgba(200,16,46,0.10)',
                  border: '0.5px solid var(--red)',
                  color: 'var(--red)',
                }}
              >
                {error}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2.5 rounded-[6px] text-sm font-semibold"
                style={{
                  background: 'var(--red)',
                  color: '#fff',
                  opacity: submitting ? 0.7 : 1,
                  cursor: submitting ? 'wait' : 'pointer',
                }}
              >
                {submitting ? 'Posting…' : 'Post wanted ad — free'}
              </button>
              <Link
                href="/wanted"
                className="text-sm"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Cancel
              </Link>
            </div>

            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Ads run for 60 days. No contact details in the text — sellers
              respond on Gun Galore and every purchase stays protected.
            </p>
          </form>
        )}
      </PageReveal>
    </main>
  );
}
