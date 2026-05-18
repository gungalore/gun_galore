'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const ACCEPTED = 'image/jpeg,image/png,image/webp,application/pdf';

export default function KycForm() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setSubmitting(true);
    setError('');

    try {
      const token = await getToken();
      const fd = new FormData();
      fd.append('document', file);

      const res = await fetch(`${API_URL}/users/kyc`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `Error ${res.status}`);
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm mb-1.5" style={{ color: 'var(--text-secondary)' }}>
          ID document
        </label>
        <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
          Upload a clear photo or scan of your South African ID book, smart ID card, or passport. Max 10 MB. Accepted: JPG, PNG, WebP, PDF.
        </p>
        <input
          type="file"
          accept={ACCEPTED}
          required
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="w-full px-3 py-2 rounded-[6px] text-sm cursor-pointer"
          style={{
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-primary)',
          }}
        />
        {file && (
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
            {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)
          </p>
        )}
      </div>

      {/* Privacy assurance */}
      <div
        className="rounded-[6px] px-4 py-3 text-xs"
        style={{ background: 'var(--bg-inset)', color: 'var(--text-tertiary)', border: '0.5px solid var(--border)' }}
      >
        Your document is encrypted at rest, visible only to our compliance team, and never shared with third parties except as required by law.
      </div>

      {error && (
        <p className="text-xs" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || !file}
        className="w-full py-3 rounded-[6px] text-sm font-medium"
        style={{
          background: submitting || !file ? 'var(--bg-inset)' : 'var(--red)',
          color: submitting || !file ? 'var(--text-tertiary)' : '#fff',
        }}
      >
        {submitting ? 'Uploading…' : 'Submit for verification'}
      </button>
    </form>
  );
}
