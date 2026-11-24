'use client';

// Shared "Report a bug" form. Used by the global sheet (opened from the bottom
// tray tab and the desktop hovering button) and by the /report-a-bug page.
//
// The screenshot is captured by the caller before this renders; here it is
// only previewed and can be removed or replaced with a manual upload. The page
// URL is shown so the member can see exactly what we'll send.

import { useEffect, useState } from 'react';
import { useAuth, useUser } from '@/lib/auth';
import { submitBugReport } from '@/lib/bug-reports-api';

// Keys MUST match BUG_CATEGORIES in backend/src/bugs/bugs.service.ts.
const CATEGORIES = [
  { value: 'BUY_NOW', label: 'Marketplace' },
  { value: 'AUCTION', label: 'Auctions' },
  { value: 'PAYMENT', label: 'Payments' },
  { value: 'OFFERS', label: 'Offers' },
  { value: 'LISTING', label: 'Selling / Listing' },
  { value: 'DELIVERY', label: 'Delivery / Shipping' },
  { value: 'MOTIVATIONS', label: 'Motivations' },
  { value: 'PAPERWORK_VAULT', label: 'Paperwork Vault' },
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
  // The handle is what support searches the activity log by, and the member
  // should see who the report is being sent as.
  const { user } = useUser();

  /**
   * ⚠️ THE DEFAULT CATEGORY FOLLOWS THE PAGE. A report filed from the
   * licence-centre is almost always about the motivation writer, and making
   * the member pick it from ten options is friction at the exact moment they
   * are annoyed. They can still change it.
   */
  const [category, setCategory] = useState(() =>
    /\/licence-centre\//.test(url) ? 'MOTIVATIONS' : 'BUY_NOW',
  );
  const [description, setDescription] = useState('');
  // Public-reporter contact + bot trap. The email is optional; the honeypot
  // must stay empty and the elapsed time must clear the server's floor.
  const [email, setEmail] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [startedAt] = useState(() => Date.now());
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
        {
          category,
          description: description.trim(),
          url,
          screenshot,
          // Signed-in reports carry the account email server-side; the public
          // form offers an optional reply address instead.
          email: isSignedIn ? undefined : email.trim() || undefined,
          honeypot,
          elapsedMs: Date.now() - startedAt,
        },
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
            style={{ background: 'var(--action-primary-bg)' }}
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

      {isLoaded && !isSignedIn && (
        <div>
          <label className={labelClass}>Email (optional — for a reply)</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
            autoComplete="email"
            placeholder="you@example.com"
            className="w-full px-3 py-2 rounded-md text-sm bg-[var(--bg-inset)] border border-[var(--border)] text-[var(--text-primary)]"
          />
        </div>
      )}

      {/* Bot trap. Off-screen and tab-skipped; a human never sees or fills it.
          The server treats a non-empty value as a silent discard. */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: '-10000px',
          width: 1,
          height: 1,
          overflow: 'hidden',
        }}
      >
        <label>
          Leave this field empty
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </label>
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

      {/*
        ⚠️ SAY WHO IS REPORTING. Support finds the activity log by handle, and
        the member should know that is what they are sending — a line here
        saves "which account was this?" in the reply.
      */}
      {user?.username && (
        <p className="text-[11px] text-[var(--text-tertiary)] m-0">
          Reporting as <strong>@{user.username}</strong> — we will attach your
          recent steps on this page so support can see exactly what happened.
        </p>
      )}

      {error && <p className="text-sm text-[var(--red)] m-0">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={busy || description.trim().length < MIN_DESCRIPTION}
          className="px-5 py-2.5 rounded-md text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--action-primary-bg)' }}
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
