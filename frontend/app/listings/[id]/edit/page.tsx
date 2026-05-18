'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { Listing } from '@/lib/types';
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm mb-1.5" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

export default function EditListingPage() {
  const { id } = useParams<{ id: string }>();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const router = useRouter();

  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newImages, setNewImages] = useState<File[]>([]);

  const [form, setForm] = useState({
    title: '',
    description: '',
    price: '',
    condition: 'GOOD',
    province: 'GAUTENG',
    make: '',
    model: '',
    calibre: '',
  });

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) { router.push('/sign-in'); return; }

    async function load() {
      try {
        const token = await getToken();
        const res = await fetch(`${API_URL}/listings/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) { router.push('/my/listings'); return; }
        const l: Listing = await res.json();
        setListing(l);
        setForm({
          title: l.title,
          description: l.description,
          price: String(l.price / 100),
          condition: l.condition,
          province: l.province,
          make: l.make ?? '',
          model: l.model ?? '',
          calibre: l.calibre ?? '',
        });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id, isLoaded, isSignedIn, getToken, router]);

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      const body: Record<string, unknown> = {
        title: form.title.trim(),
        description: form.description.trim(),
        price: Math.round(parseFloat(form.price) * 100),
        condition: form.condition,
        province: form.province,
      };
      if (form.make.trim()) body.make = form.make.trim();
      if (form.model.trim()) body.model = form.model.trim();
      if (form.calibre.trim()) body.calibre = form.calibre.trim();

      const res = await fetch(`${API_URL}/listings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `Error ${res.status}`);
      }

      // Upload any new images
      for (const file of newImages) {
        const fd = new FormData();
        fd.append('image', file);
        await fetch(`${API_URL}/listings/${id}/images`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
      }

      router.push(`/listings/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  }

  if (!isLoaded || loading) {
    return (
      <main className="max-w-[640px] mx-auto px-4 py-8">
        <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--red)', borderTopColor: 'transparent' }} />
      </main>
    );
  }

  if (!listing) return null;

  const isFirearm = listing.category.isFirearm;

  return (
    <main className="max-w-[640px] mx-auto px-4 py-8">
      <h1 className="text-xl mb-6" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
        Edit listing
      </h1>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-[6px] text-sm" style={{ background: 'rgba(200,16,46,0.08)', border: '0.5px solid var(--red)', color: 'var(--red)' }}>
          {error}
        </div>
      )}

      {/* Existing images */}
      {listing.images.length > 0 && (
        <div className="mb-5">
          <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>Current photos</p>
          <div className="flex gap-2 flex-wrap">
            {listing.images.map((img) => (
              <img key={img.id} src={img.url} alt="" className="w-20 h-20 rounded-[4px] object-cover" />
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Title">
          <input type="text" required minLength={5} maxLength={200} value={form.title} onChange={(e) => set('title', e.target.value)} style={inputStyle} />
        </Field>

        <Field label="Description">
          <textarea required minLength={10} maxLength={5000} rows={5} value={form.description} onChange={(e) => set('description', e.target.value)} style={{ ...inputStyle, resize: 'vertical' }} />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Price (R)">
            <input type="number" required min={1} step="0.01" value={form.price} onChange={(e) => set('price', e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Condition">
            <select value={form.condition} onChange={(e) => set('condition', e.target.value)} style={inputStyle}>
              {Object.entries(CONDITION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Province">
          <select value={form.province} onChange={(e) => set('province', e.target.value)} style={inputStyle}>
            {Object.entries(PROVINCE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>

        {isFirearm && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Make">
                <input type="text" value={form.make} onChange={(e) => set('make', e.target.value)} style={inputStyle} placeholder="e.g. Glock" />
              </Field>
              <Field label="Model">
                <input type="text" value={form.model} onChange={(e) => set('model', e.target.value)} style={inputStyle} placeholder="e.g. 17 Gen 5" />
              </Field>
            </div>
            <Field label="Calibre">
              <input type="text" value={form.calibre} onChange={(e) => set('calibre', e.target.value)} style={inputStyle} placeholder="e.g. 9mm" />
            </Field>
          </>
        )}

        <Field label="Add more photos (optional)">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(e) => setNewImages(Array.from(e.target.files ?? []))}
            style={{ ...inputStyle, padding: '6px 12px', cursor: 'pointer' }}
          />
          {newImages.length > 0 && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              {newImages.length} new file{newImages.length !== 1 ? 's' : ''} to upload
            </p>
          )}
        </Field>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 py-3 rounded-[6px] text-sm font-medium"
            style={{ background: submitting ? 'var(--bg-inset)' : 'var(--red)', color: submitting ? 'var(--text-tertiary)' : '#fff' }}
          >
            {submitting ? 'Saving…' : 'Save changes'}
          </button>
          <a
            href={`/listings/${id}`}
            className="px-4 py-3 rounded-[6px] text-sm"
            style={{ border: '0.5px solid var(--border)', color: 'var(--text-secondary)', textDecoration: 'none' }}
          >
            Cancel
          </a>
        </div>
      </form>
    </main>
  );
}
