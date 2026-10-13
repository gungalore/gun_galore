'use client';

// Shared "Report a bug" form. Used by the global sheet (opened from the bottom
// tray tab and the desktop hovering button) and by the /report-a-bug page.
//
// The screenshot is captured by the caller before this renders; here it is
// only previewed and can be removed or replaced with a manual upload. The page
// URL is shown so the member can see exactly what we'll send.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { SUPPORT_EMAIL } from '@/lib/brand';
import { submitBugReport } from '@/lib/bug-reports-api';

// Keys MUST match BUG_CATEGORIES in backend/src/bugs/bugs.service.ts.
const CATEGORIES = [
  { value: 'BUY_NOW', label: 'Buy Now' },
  { value: 'AUCTION', label: 'Auctions' },
  { value: 'PAYMENT', label: 'Payments' },
  { value: 'OFFERS', label: 'Offers' },
  { value: 'LISTING', label: 'Selling / Listing' },
  { value: 'DELIVERY', label: 'Delivery / Shipping' },
  { value: 'ACCOUNT', label: 'Account & Login' },
  { value: 'OTHER', label: 'Other' },
];

const MIN_DESCRIPTION = 10;
const MAX_DESCRIPTION = 2000;
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

export function BugReportForm({
  url,
  screenshot,
  capturing,
  onScreenshotChange,
  onClose,
}: {
  url: string;
  screenshot: File | null;
  capturing: boolean;
  onScreenshotChange: (file: File | null) => void;
  onClose?: () => void;
}) {
  const { getToken, isLoaded, isSignedIn } = useAuth();

  const [category, setCategory] = useState('BUY_NOW');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!screenshot) {
      setPreview(null);
      return;
    }
    const objectUrl = URL.createObjectURL(screenshot);
    setPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [screenshot]);

  function onPickFile(file: File | null) {
    setError(null);
    if (!file) {
      onScreenshotChange(null);
      return;
    }
    if (file.size > MAX_SCREENSHOT_BYTES) {
      setError('That image is larger than 8 MB. Please attach a smaller one.');
      return;
    }
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setError('Screenshot must be a JPEG, PNG or WebP image.');
      return;
    }
    onScreenshotChange(file);
  }

  async function submit() {
    setError(null);
    if (description.trim().length < MIN_DESCRIPTION) {
      setError('Please describe the problem in a bit more detail.');
      return;
    }
    setBusy(true);
    try {
      const token = await getToken();
      await submitBugReport(
        { category, description: description.trim(), url, screenshot },
        token,
      );
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send your report.');
    } finally {
      setBusy(false);
    }
  }

  const labelClass =
    'block text-xs font-semibold mb-1 text-[var(--text-secondary)]';

  if (isLoaded && !isSignedIn) {
    return (
      <p className="text-sm text-[var(--text-secondary)] m-0">
        Please{' '}
        <Link href="/sign-in" className="text-[var(--red)]">
          sign in
        </Link>{' '}
        to report a bug, so we can tie it to your account. You can also email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[var(--red)]">
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
    );
  }

  if (done) {
    return (
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mt-0 mb-1">
          Report sent ✓
        </h2>
        <p className="text-sm text-[var(--text-secondary)] m-0">
          Thanks — we&apos;ve received your report and will look into it.
        </p>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="mt-4 px-4 py-2 rounded-md text-sm font-medium text-white"
            style={{ background: 'var(--red)' }}
          >
            Close
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label className={labelClass}>What is it about?</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full px-3 py-2 rounded-md text-sm bg-[var(--bg-inset)] border border-[var(--border)] text-[var(--text-primary)]"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass}>Describe the problem</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          maxLength={MAX_DESCRIPTION}
          placeholder="What did you do, what did you expect, and what happened instead?"
          className="w-full px-3 py-2 rounded-md text-sm bg-[var(--bg-inset)] border border-[var(--border)] text-[var(--text-primary)] outline-none resize-y"
        />
        <p className="text-[11px] text-[var(--text-tertiary)] mt-1">
          {description.trim().length}/{MAX_DESCRIPTION}
        </p>
      </div>

      <div>
        <label className={labelClass}>Screenshot</label>
        {capturing ? (
          <p className="text-[12px] text-[var(--text-tertiary)] m-0">
            Capturing this page…
          </p>
        ) : screenshot ? (
          <div className="flex items-start gap-3">
            {preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt="Page screenshot"
                className="rounded-md border border-[var(--border)]"
                style={{ width: 96, height: 72, objectFit: 'cover' }}
              />
            )}
            <div className="text-[12px] text-[var(--text-tertiary)]">
              <p className="m-0">Attached: {screenshot.name}</p>
              <button
                type="button"
                className="underline mt-1"
                onClick={() => onScreenshotChange(null)}
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <p className="text-[12px] text-[var(--text-tertiary)] m-0">
            No screenshot captured. You can attach one below.
          </p>
        )}
        <label className="block text-[12px] text-[var(--text-tertiary)] mt-2">
          {screenshot ? 'Replace with a file' : 'Attach an image (optional)'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-xs"
          />
        </label>
      </div>

      {url && (
        <p className="text-[11px] text-[var(--text-tertiary)] m-0 break-all">
          Reported from: {url}
        </p>
      )}

      {error && <p className="text-sm text-[var(--red)] m-0">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={busy || description.trim().length < MIN_DESCRIPTION}
          className="px-5 py-2.5 rounded-md text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--red)' }}
        >
          {busy ? 'Sending…' : 'Send report'}
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-md text-sm border border-[var(--border)] text-[var(--text-secondary)]"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
