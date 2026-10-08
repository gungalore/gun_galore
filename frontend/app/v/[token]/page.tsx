'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  CaptureState,
  deleteCapturePhoto,
  fetchCaptureState,
  uploadCapturePhoto,
} from '../../../lib/valuation-api';
import { PhotoGrid } from '../../../components/valuation/photo-grid';

/**
 * Phone capture. No login: the URL token is the capability. Opens the camera,
 * compresses on-device, uploads, and shows the same 8-slot grid as the
 * desktop. Polls the session so a desktop delete is reflected here.
 */
export default function PhoneCapturePage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? '';
  const [state, setState] = useState<CaptureState | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchCaptureState(token);
      setState(next);
    } catch {
      setInvalid(true);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => void refresh(), 3000);
    return () => clearInterval(poll);
  }, [refresh]);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const compressed = await compress(file);
      await uploadCapturePhoto(token, compressed);
      await refresh();
    } catch {
      setError('That photo could not be uploaded. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(photoId: string) {
    setBusyId(photoId);
    try {
      await deleteCapturePhoto(token, photoId);
      await refresh();
    } catch {
      setError('Could not remove that photo.');
    } finally {
      setBusyId(null);
    }
  }

  if (invalid) {
    return (
      <main className="min-h-dvh flex items-center justify-center px-6 text-center">
        <div>
          <h1 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            This link has expired
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Ask the desktop to show a new code.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh px-4 py-6" style={{ maxWidth: 520, margin: '0 auto' }}>
      <h1 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
        Add photos
      </h1>
      <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
        Photos appear on your computer instantly.
      </p>

      {error && (
        <div className="rounded-[8px] px-3 py-2 text-sm mb-3" style={{ background: 'rgba(227,6,19,0.08)', color: 'var(--red)' }}>
          {error}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void handleFile(file);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy || (state?.slotsRemaining ?? 0) <= 0}
        className="w-full rounded-[10px] py-4 text-sm font-semibold mb-4"
        style={{
          background: (state?.slotsRemaining ?? 0) <= 0 ? 'var(--bg-inset)' : 'var(--red)',
          color: (state?.slotsRemaining ?? 0) <= 0 ? 'var(--text-tertiary)' : '#fff',
          border: 'none',
          cursor: busy ? 'wait' : 'pointer',
        }}
      >
        {busy ? 'Uploading...' : 'Take or choose a photo'}
      </button>

      <div className="flex items-center justify-between mb-2">
        <span className="text-sm" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Photos</span>
        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {state?.photoCount ?? 0} of 8
        </span>
      </div>
      <PhotoGrid
        images={state?.images ?? []}
        maxPhotos={8}
        onDelete={handleDelete}
        busyId={busyId}
      />
    </main>
  );
}

async function compress(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const max = 2048;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.8),
    );
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
