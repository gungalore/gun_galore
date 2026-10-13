'use client';

// Simple "Report a bug" form. Signed-in members pick a category, describe the
// problem and optionally attach a screenshot. The report is emailed to the
// support mailbox; nothing is stored on the platform.

import Link from 'next/link';
import { useState } from 'react';
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

export default function ReportBugPage() {
  const { getToken, isLoaded, isSignedIn } = useAuth();

  const [category, setCategory] = useState('BUY_NOW');
  const [description, setDescription] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function onPickFile(file: File | null) {
    setError(null);
    if (file && file.size > MAX_SCREENSHOT_BYTES) {
      setScreenshot(null);
      setError('That screenshot is larger than 8 MB. Please attach a smaller image.');
      return;
    }
    if (file && !/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setScreenshot(null);
      setError('Screenshot must be a JPEG, PNG or WebP image.');
      return;
    }
    setScreenshot(file);
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
      await submitBugReport({ category, description: description.trim(), screenshot }, token);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send your report.');
    } finally {
      setBusy(false);
    }
  }

  if (isLoaded && !isSignedIn) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <p className="text-sm text-[var(--text-secondary)]">
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
      </div>
    );
  }

  if (done) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <h1 className="text-lg font-semibold text-[var(--text-primary)] mt-0">
            Report sent ✓
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Thanks — we&apos;ve received your report and will look into it.
          </p>
          <div className="flex gap-2 mt-4">
            <button
              type="button"
              onClick={() => {
                setDone(false);
                setDescription('');
                setScreenshot(null);
                setCategory('BUY_NOW');
              }}
              className="px-4 py-2 rounded-md text-sm border border-[var(--border)] text-[var(--text-secondary)]"
            >
              Report another
            </button>
            <Link
              href="/account"
              className="px-4 py-2 rounded-md text-sm font-medium text-white"
              style={{ background: 'var(--red)' }}
            >
              Back to account
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-xl font-semibold text-[var(--text-primary)]">
        Report a bug
      </h1>
      <p className="text-sm text-[var(--text-secondary)] mt-1 mb-4">
        Found something broken? Tell us what happened and we&apos;ll fix it.
      </p>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
            What is it about?
          </label>
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
          <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
            Describe the problem
          </label>
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
          <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
            Screenshot (optional)
          </label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            className="block w-full text-xs text-[var(--text-secondary)]"
          />
          {screenshot && (
            <p className="text-[11px] text-[var(--text-tertiary)] mt-1">
              Attached: {screenshot.name}
              <button
                type="button"
                className="ml-2 underline"
                onClick={() => setScreenshot(null)}
              >
                Remove
              </button>
            </p>
          )}
        </div>

        {error && <p className="text-sm text-[var(--red)]">{error}</p>}

        <div>
          <button
            type="button"
            onClick={submit}
            disabled={busy || description.trim().length < MIN_DESCRIPTION}
            className="px-5 py-2.5 rounded-md text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--red)' }}
          >
            {busy ? 'Sending…' : 'Send report'}
          </button>
        </div>
      </div>
    </div>
  );
}
