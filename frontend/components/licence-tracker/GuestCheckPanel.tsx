'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  kindLabel,
  licenceTrackerApi,
  type GuestCheckView,
  type TrackerKind,
} from '@/lib/licence-tracker-api';

/**
 * The Application Tracker's signed-out half.
 *
 * A visitor who has accepted the 18+ gate but has no account can ask SAPS's
 * public status enquiry about one application ONCE. Nothing is stored: no
 * reference, no history, no reminders. Signing in is what turns this into the
 * saved tracker (polling, change notifications, timeline).
 *
 * ⚠️ The same backend parser/classifier answers the guest path, so the safety
 * precedence is identical — a blocked enquiry is an error, never "SAPS holds
 * nothing".
 */
const KINDS: TrackerKind[] = ['COMPETENCY', 'FIREARM_LICENCE', 'RENEWAL'];

function fmtDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function GuestCheckPanel() {
  const [kind, setKind] = useState<TrackerKind>('FIREARM_LICENCE');
  const [reference, setReference] = useState('');
  const [serial, setSerial] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GuestCheckView | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const out = await licenceTrackerApi.guestCheck({
        kind,
        reference,
        serial: kind === 'COMPETENCY' ? undefined : serial || undefined,
      });
      setResult(out);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--field-bg)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-visible)',
    borderRadius: 6,
    padding: '10px 12px',
    fontSize: 14,
    width: '100%',
  };

  return (
    <div className="mt-5">
      <form
        onSubmit={submit}
        className="gg-tile rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-card)] p-4"
      >
        <p className="m-0 text-[14px] font-medium text-[var(--text-primary)]">
          Check an application status
        </p>
        <p className="m-0 mt-1 text-[13px] leading-[1.5] text-[var(--text-secondary)]">
          One check, no account needed. Sign in if you want us to save it,
          watch for changes and remind you.
        </p>

        <div className="mt-3 grid gap-3">
          <label className="grid gap-1">
            <span className="text-[12px] text-[var(--text-tertiary)]">
              Application type
            </span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as TrackerKind)}
              style={inputStyle}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1">
            <span className="text-[12px] text-[var(--text-tertiary)]">
              Application reference
            </span>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              required
              autoComplete="off"
              placeholder="e.g. 12345678"
              style={inputStyle}
            />
          </label>

          {kind !== 'COMPETENCY' && (
            <label className="grid gap-1">
              <span className="text-[12px] text-[var(--text-tertiary)]">
                Firearm serial (if the application has one)
              </span>
              <input
                value={serial}
                onChange={(e) => setSerial(e.target.value)}
                autoComplete="off"
                style={inputStyle}
              />
            </label>
          )}
        </div>

        <button
          type="submit"
          disabled={busy}
          className="gg-press mt-4 w-full rounded-[6px] py-3 text-[14px] font-medium"
          style={{
            background: 'var(--action-primary-bg)',
            color: '#fff',
            border: 'none',
            opacity: busy ? 0.7 : 1,
            cursor: busy ? 'progress' : 'pointer',
          }}
        >
          {busy ? 'Asking SAPS…' : 'Check status'}
        </button>

        {error && (
          <p role="alert" className="m-0 mt-3 text-[13px] text-[var(--red)]">
            {error}
          </p>
        )}
      </form>

      {result && (
        <div className="gg-tile mt-4 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <p className="m-0 text-[12px] font-medium text-[var(--text-tertiary)]">
            Reference {result.reference}
            {result.serial ? ` · serial ${result.serial}` : ''}
          </p>
          {result.outcome === 'no_records' ? (
            <p className="m-0 mt-2 text-[14px] leading-[1.5] text-[var(--text-secondary)]">
              SAPS&rsquo;s public enquiry holds nothing against this reference
              yet. That is normal for a recently lodged application; follow up
              with your DFO if it stays empty.
            </p>
          ) : (
            <>
              <p className="m-0 mt-2 text-[15px] font-medium text-[var(--text-primary)]">
                {result.status || 'Status not printed'}
              </p>
              {(result.applicationNumber || fmtDate(result.statusDate)) && (
                <p className="m-0 mt-1 text-[13px] text-[var(--text-secondary)]">
                  {[
                    result.applicationNumber,
                    fmtDate(result.statusDate)
                      ? `status date ${fmtDate(result.statusDate)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
              {result.statusDescription && (
                <p className="m-0 mt-2 text-[13.5px] leading-[1.55] text-[var(--text-secondary)]">
                  {result.statusDescription}
                </p>
              )}
              {result.nextStep && (
                <p className="m-0 mt-2 text-[13.5px] leading-[1.55] text-[var(--text-secondary)]">
                  {result.nextStep}
                </p>
              )}
              {fmtDate(result.sapsUpdatedOn) && (
                <p className="m-0 mt-2 text-[11.5px] text-[var(--text-tertiary)]">
                  SAPS page updated {fmtDate(result.sapsUpdatedOn)}
                </p>
              )}
            </>
          )}
          <p className="m-0 mt-3 text-[13px] text-[var(--text-secondary)]">
            Want us to watch it and tell you when it changes?{' '}
            <Link
              href="/sign-in?redirect_url=%2Flicence-centre%2Ftracking"
              style={{ color: 'var(--text-primary)', textDecoration: 'underline' }}
            >
              Sign in to save it
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}
