'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { Category } from '@/lib/types';
import { CONDITION_LABELS, PROVINCE_LABELS } from '@/lib/utils';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-primary)',
  borderRadius: '6px',
  padding: '8px 12px',
  fontSize: '14px',
  outline: 'none',
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm mb-1.5" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

export default function NewListingPage() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const router = useRouter();

  const [categories, setCategories] = useState<Category[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<File[]>([]);

  const [form, setForm] = useState({
    title: '',
    description: '',
    price: '',
    listingType: 'BUY_NOW',
    categoryId: '',
    condition: 'GOOD',
    province: 'GAUTENG',
    passFeeToBuyer: false,
    make: '',
    model: '',
    calibre: '',
    autoAcceptThreshold: '',
  });

  useEffect(() => {
    fetch(`${API_URL}/categories`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown) => {
        if (Array.isArray(data)) setCategories(data as Category[]);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.push('/sign-in');
    }
  }, [isLoaded, isSignedIn, router]);

  const selectedCategory = categories.find((c) => c.id === form.categoryId);
  const isFirearm = selectedCategory?.isFirearm ?? false;

  function set(key: string, value: string | boolean) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const token = await getToken();
      const priceInCents = Math.round(parseFloat(form.price) * 100);

      const body: Record<string, unknown> = {
        title: form.title.trim(),
        description: form.description.trim(),
        price: priceInCents,
        listingType: form.listingType,
        categoryId: form.categoryId,
        condition: form.condition,
        province: form.province,
        passFeeToBuyer: form.passFeeToBuyer,
      };

      if (form.make.trim()) body.make = form.make.trim();
      if (form.model.trim()) body.model = form.model.trim();
      if (form.calibre.trim()) body.calibre = form.calibre.trim();
      if (form.autoAcceptThreshold) {
        body.autoAcceptThreshold = Math.round(
          parseFloat(form.autoAcceptThreshold) * 100,
        );
      }

      const res = await fetch(`${API_URL}/listings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = Array.isArray(err.message)
          ? err.message.join(', ')
          : (err.message ?? `Error ${res.status}`);
        throw new Error(msg);
      }

      const listing = await res.json();

      for (const file of images) {
        const fd = new FormData();
        fd.append('file', file);
        await fetch(`${API_URL}/listings/${listing.id}/images`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
      }

      router.push(`/listings/${listing.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  }

  if (!isLoaded || !isSignedIn) return null;

  return (
    <main className="max-w-[640px] mx-auto px-4 py-8">
      <h1
        className="text-xl mb-6"
        style={{ color: 'var(--text-primary)', fontWeight: 500 }}
      >
        Create listing
      </h1>

      {error && (
        <div
          className="mb-4 px-4 py-3 rounded-[6px] text-sm"
          style={{
            background: 'rgba(200,16,46,0.08)',
            border: '0.5px solid var(--red)',
            color: 'var(--red)',
          }}
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Title">
          <input
            type="text"
            required
            minLength={5}
            maxLength={200}
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            style={inputStyle}
            placeholder="e.g. Glock 17 Gen 5 — excellent condition"
          />
        </Field>

        <Field label="Category">
          <select
            required
            value={form.categoryId}
            onChange={(e) => set('categoryId', e.target.value)}
            style={inputStyle}
          >
            <option value="">Select category…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Description">
          <textarea
            required
            minLength={10}
            maxLength={5000}
            rows={5}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            style={{ ...inputStyle, resize: 'vertical' }}
            placeholder="Describe the item honestly. Include wear, modifications, and any included accessories."
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Price (R)">
            <input
              type="number"
              required
              min={1}
              step="0.01"
              value={form.price}
              onChange={(e) => set('price', e.target.value)}
              style={inputStyle}
              placeholder="0.00"
            />
          </Field>

          <Field label="Listing type">
            <select
              value={form.listingType}
              onChange={(e) => set('listingType', e.target.value)}
              style={inputStyle}
            >
              <option value="BUY_NOW">Buy Now</option>
              <option value="TAKE_A_SHOT">Take a Shot</option>
            </select>
          </Field>
        </div>

        {form.listingType === 'TAKE_A_SHOT' && (
          <Field label="Auto-accept threshold (R) — optional">
            <input
              type="number"
              min={1}
              step="0.01"
              value={form.autoAcceptThreshold}
              onChange={(e) => set('autoAcceptThreshold', e.target.value)}
              style={inputStyle}
              placeholder="Auto-accept any offer above this amount"
            />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Condition">
            <select
              value={form.condition}
              onChange={(e) => set('condition', e.target.value)}
              style={inputStyle}
            >
              {Object.entries(CONDITION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Province">
            <select
              value={form.province}
              onChange={(e) => set('province', e.target.value)}
              style={inputStyle}
            >
              {Object.entries(PROVINCE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {isFirearm && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Make">
                <input
                  type="text"
                  value={form.make}
                  onChange={(e) => set('make', e.target.value)}
                  style={inputStyle}
                  placeholder="e.g. Glock"
                />
              </Field>
              <Field label="Model">
                <input
                  type="text"
                  value={form.model}
                  onChange={(e) => set('model', e.target.value)}
                  style={inputStyle}
                  placeholder="e.g. 17 Gen 5"
                />
              </Field>
            </div>
            <Field label="Calibre">
              <input
                type="text"
                value={form.calibre}
                onChange={(e) => set('calibre', e.target.value)}
                style={inputStyle}
                placeholder="e.g. 9mm"
              />
            </Field>
          </>
        )}

        <Field label="Photos (optional)">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(e) => setImages(Array.from(e.target.files ?? []))}
            style={{ ...inputStyle, padding: '6px 12px', cursor: 'pointer' }}
          />
          {images.length > 0 && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              {images.length} file{images.length !== 1 ? 's' : ''} selected
            </p>
          )}
        </Field>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="passFeeToBuyer"
            checked={form.passFeeToBuyer}
            onChange={(e) => set('passFeeToBuyer', e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          <label
            htmlFor="passFeeToBuyer"
            className="text-sm"
            style={{ color: 'var(--text-secondary)', cursor: 'pointer' }}
          >
            Pass payment processing fee to buyer
          </label>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 rounded-[6px] text-sm"
          style={{
            background: submitting ? 'var(--bg-inset)' : 'var(--red)',
            color: submitting ? 'var(--text-tertiary)' : '#fff',
            fontWeight: 500,
            cursor: submitting ? 'not-allowed' : 'pointer',
            border: 'none',
          }}
        >
          {submitting ? 'Creating…' : 'Create listing'}
        </button>
      </form>
    </main>
  );
}
