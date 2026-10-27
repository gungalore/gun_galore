'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface PortalSummary {
  status: string;
  requiresIdentity: boolean;
  dealerEmail: string | null;
  dealerName: string | null;
  listing: {
    title: string;
    make: string | null;
    model: string | null;
    calibre: string | null;
    serialNumber: string | null;
    firearmType: string | null;
  };
}

const labelStyle = {
  display: 'block',
  fontSize: 12,
  color: 'var(--text-tertiary)',
  marginBottom: 4,
} as const;

// `npm run dealer-form:test` links here. It renders the same form with sample
// data and no network call, so the operator can review the template without a
// real transaction or a live dealer token.
const TEST_TOKEN = 'test-preview';
const TEST_SUMMARY: PortalSummary = {
  status: 'SENT',
  requiresIdentity: true,
  dealerEmail: 'test@example.com',
  dealerName: 'Wildman Cape Gate (test dealer)',
  listing: {
    title: 'Example bolt-action rifle (test listing)',
    make: 'Example',
    model: 'Bolt Action',
    calibre: '.308 Win',
    serialNumber: 'TEST-1234',
    firearmType: 'Rifle',
  },
};

const fieldStyle = {
  width: '100%',
  boxSizing: 'border-box' as const,
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  borderRadius: 6,
  padding: '10px 12px',
  fontSize: 14,
  color: 'var(--text-primary)',
  outline: 'none',
} as const;

export default function DealerPortalPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const isPreview = token === TEST_TOKEN;
  const [summary, setSummary] = useState<PortalSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serial, setSerial] = useState('');
  const [dealerName, setDealerName] = useState('');
  const [stamp, setStamp] = useState<File | null>(null);
  const [saps350, setSaps350] = useState<File | null>(null);
  const [ack, setAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<
    { status: string; confidence?: number } | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    if (token === TEST_TOKEN) {
      setSummary(TEST_SUMMARY);
      setSerial(TEST_SUMMARY.listing.serialNumber ?? '');
      setDealerName(TEST_SUMMARY.dealerName ?? '');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/dealer-portal/${token}`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as {
            message?: string;
          };
          if (!cancelled) {
            setLoadError(j.message ?? 'This dealer link is not available.');
          }
          return;
        }
        const data = (await res.json()) as PortalSummary;
        if (cancelled) return;
        setSummary(data);
        setSerial(data.listing.serialNumber ?? '');
        setDealerName(data.dealerName ?? '');
        if (data.status === 'APPROVED') {
          setResult({ status: 'APPROVED' });
        }
      } catch {
        if (!cancelled) setLoadError('Network error — try again shortly.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function submit() {
    if (!token || !summary) return;
    if (token === TEST_TOKEN) return;
    setError(null);
    setSubmitting(true);
    try {
      const form = new FormData();
      form.set('serialNumber', serial);
      form.set('dealerName', dealerName);
      form.set('acknowledgement', ack ? 'true' : 'false');
      if (stamp) form.set('stamp', stamp);
      if (saps350) form.set('saps350', saps350);
      const res = await fetch(`${API_URL}/dealer-portal/${token}`, {
        method: 'POST',
        body: form,
      });
      const j = (await res.json().catch(() => ({}))) as {
        message?: string;
        status?: string;
        confidence?: number;
      };
      if (!res.ok) {
        setError(j.message ?? `Could not submit (HTTP ${res.status}).`);
        return;
      }
      setResult({ status: j.status ?? 'PENDING_ADMIN_REVIEW', confidence: j.confidence });
    } catch {
      setError('Network error — try again shortly.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <main className="max-w-lg mx-auto px-4 py-16">
        <h1 className="text-xl font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
          Dealer link unavailable
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {loadError}
        </p>
      </main>
    );
  }

  if (!summary) {
    return (
      <main className="max-w-lg mx-auto px-4 py-16">
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Loading the dealer form…
        </p>
      </main>
    );
  }

  if (result) {
    const approved = result.status === 'APPROVED';
    return (
      <main className="max-w-lg mx-auto px-4 py-16">
        <h1 className="text-xl font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
          {approved ? 'Dealership confirmed' : 'Submitted for review'}
        </h1>
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {approved
            ? 'Thank you. Your dealership is verified and the firearm is recorded as stocked with you. We have notified the seller and buyer.'
            : 'Thank you. Your submission is with our team for a quick review. You do not need to resubmit.'}
        </p>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Reference: {summary.listing.title}
        </p>
      </main>
    );
  }

  return (
    <main className="max-w-lg mx-auto px-4 py-12">
      <p
        className="text-xs uppercase mb-2"
        style={{ color: 'var(--red)', letterSpacing: '0.06em', fontWeight: 600 }}
      >
        Dealer stock confirmation
      </p>
      <h1 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
        {summary.listing.title}
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        The seller has nominated you as the stocking dealer for this firearm.
        Confirm the details below and acknowledge that it is in your stock.
      </p>

      {isPreview && (
        <div
          className="rounded-[8px] p-3 mb-5 text-xs"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--red)',
            color: 'var(--text-secondary)',
            lineHeight: 1.55,
          }}
        >
          <strong style={{ color: 'var(--red)' }}>Test preview.</strong>{' '}
          This is the dealer form template with sample data. It is not connected
          to a sale and nothing can be submitted from this page.
        </div>
      )}

      <div
        className="rounded-[8px] p-4 mb-5 text-sm"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', lineHeight: 1.6 }}
      >
        <div style={{ color: 'var(--text-tertiary)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Firearm
        </div>
        <div style={{ color: 'var(--text-primary)' }}>
          {[summary.listing.firearmType, summary.listing.make, summary.listing.model, summary.listing.calibre]
            .filter(Boolean)
            .join(' ') || '—'}
        </div>
      </div>

      <label className="block mb-3">
        <span style={labelStyle}>Serial number</span>
        <input
          value={serial}
          onChange={(e) => setSerial(e.target.value)}
          style={fieldStyle}
          placeholder="Serial number on the firearm"
        />
      </label>

      <label className="block mb-3">
        <span style={labelStyle}>Dealer / business name</span>
        <input
          value={dealerName}
          onChange={(e) => setDealerName(e.target.value)}
          style={fieldStyle}
          placeholder="Trading name"
        />
      </label>

      <label className="block mb-3">
        <span style={labelStyle}>
          Dealer stamp — must show your business name, company registration
          number, address, contact number and SAPS dealer licence number
        </span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          onChange={(e) => setStamp(e.target.files?.[0] ?? null)}
          className="block w-full text-sm"
          style={{ color: 'var(--text-secondary)' }}
        />
      </label>

      <label className="block mb-3">
        <span style={labelStyle}>
          SAPS 350(a) — Dealer&rsquo;s Return: Stock Received, filled in with
          this firearm&rsquo;s make, model, calibre and serial number
        </span>
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
          onChange={(e) => setSaps350(e.target.files?.[0] ?? null)}
          className="block w-full text-sm"
          style={{ color: 'var(--text-secondary)' }}
        />
      </label>

      <label className="flex items-start gap-2 mb-4 cursor-pointer">
        <input
          type="checkbox"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          I confirm that this firearm is in my possession and dealer-stocked
          with me, and that the details above match the firearm.
        </span>
      </label>

      {error && (
        <p
          className="text-xs mb-3 p-2 rounded-[6px]"
          style={{ background: 'rgba(227,6,19,0.10)', border: '0.5px solid var(--red)', color: 'var(--red)' }}
        >
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={
          submitting ||
          isPreview ||
          !ack ||
          !serial.trim() ||
          !stamp ||
          !saps350
        }
        className="w-full py-3 rounded-[8px] text-sm"
        style={{
          background:
            submitting || isPreview || !ack
              ? 'var(--bg-inset)'
              : 'var(--red)',
          color:
            submitting || isPreview || !ack
              ? 'var(--text-tertiary)'
              : '#fff',
          border: 'none',
          fontWeight: 500,
          cursor: submitting ? 'wait' : 'pointer',
        }}
      >
        {isPreview
          ? 'Preview only — submission disabled'
          : submitting
            ? 'Submitting…'
            : 'Confirm dealership and stock'}
      </button>
    </main>
  );
}
