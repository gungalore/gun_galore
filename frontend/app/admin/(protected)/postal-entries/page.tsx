'use client';

import { useEffect, useState, FormEvent } from 'react';
import { Raffle } from '@/lib/types';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

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

function getAdminToken(): string | null {
  if (typeof document === 'undefined') return null;
  return (
    document.cookie
      .split('; ')
      .find((c) => c.startsWith('admin_token='))
      ?.split('=')[1] ?? null
  );
}

export default function PostalEntriesPage() {
  const [raffles, setRaffles] = useState<Raffle[]>([]);
  const [form, setForm] = useState({
    raffleId: '',
    referenceCode: '',
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    address: '',
    ticketCount: '1',
  });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    // We list all admin raffles via the admin endpoint
    const token = getAdminToken();
    fetch(`${API_URL}/admin/raffles`, {
      headers: { Authorization: `Bearer ${token ?? ''}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setRaffles(Array.isArray(data) ? data : []))
      .catch(() => setRaffles([]));
  }, []);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const token = getAdminToken();
      const res = await fetch(`${API_URL}/admin/raffles/postal-entries`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token ?? ''}`,
        },
        body: JSON.stringify({
          raffleId: form.raffleId,
          referenceCode: form.referenceCode.toUpperCase(),
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          address: form.address.trim() || undefined,
          ticketCount: parseInt(form.ticketCount, 10),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
      setMessage({
        type: 'ok',
        text: `Entry recorded — ${data.tickets.length} ticket(s) credited.`,
      });
      setForm((f) => ({
        ...f,
        referenceCode: '',
        firstName: '',
        lastName: '',
        phone: '',
        email: '',
        address: '',
        ticketCount: '1',
      }));
    } catch (err) {
      setMessage({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to record entry',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-[720px]">
      <h1
        className="text-xl mb-2"
        style={{ color: 'var(--text-primary)', fontWeight: 500 }}
      >
        Postal entries
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
        Record a free-entry route postal submission (CPA Section 36).
      </p>

      {message && (
        <div
          className="mb-4 px-4 py-3 rounded-[6px] text-sm"
          style={{
            background:
              message.type === 'ok'
                ? 'rgba(34,197,94,0.08)'
                : 'rgba(200,16,46,0.08)',
            border: `0.5px solid ${message.type === 'ok' ? '#22c55e' : 'var(--red)'}`,
            color: message.type === 'ok' ? '#22c55e' : 'var(--red)',
          }}
        >
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            className="block text-sm mb-1.5"
            style={{ color: 'var(--text-secondary)' }}
          >
            Competition
          </label>
          <select
            required
            value={form.raffleId}
            onChange={(e) => set('raffleId', e.target.value)}
            style={inputStyle}
          >
            <option value="">Select competition…</option>
            {raffles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              className="block text-sm mb-1.5"
              style={{ color: 'var(--text-secondary)' }}
            >
              Reference code (8 chars)
            </label>
            <input
              type="text"
              required
              maxLength={8}
              minLength={8}
              value={form.referenceCode}
              onChange={(e) =>
                set('referenceCode', e.target.value.toUpperCase())
              }
              style={{ ...inputStyle, fontFamily: 'monospace' }}
              placeholder="ABCD2345"
            />
          </div>
          <div>
            <label
              className="block text-sm mb-1.5"
              style={{ color: 'var(--text-secondary)' }}
            >
              Ticket count
            </label>
            <input
              type="number"
              required
              min="1"
              max="10"
              value={form.ticketCount}
              onChange={(e) => set('ticketCount', e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              className="block text-sm mb-1.5"
              style={{ color: 'var(--text-secondary)' }}
            >
              First name
            </label>
            <input
              type="text"
              required
              value={form.firstName}
              onChange={(e) => set('firstName', e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label
              className="block text-sm mb-1.5"
              style={{ color: 'var(--text-secondary)' }}
            >
              Last name
            </label>
            <input
              type="text"
              required
              value={form.lastName}
              onChange={(e) => set('lastName', e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              className="block text-sm mb-1.5"
              style={{ color: 'var(--text-secondary)' }}
            >
              Phone (optional)
            </label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              style={inputStyle}
              placeholder="0820000000"
            />
          </div>
          <div>
            <label
              className="block text-sm mb-1.5"
              style={{ color: 'var(--text-secondary)' }}
            >
              Email (optional)
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>

        <div>
          <label
            className="block text-sm mb-1.5"
            style={{ color: 'var(--text-secondary)' }}
          >
            Postal address (optional)
          </label>
          <textarea
            rows={2}
            value={form.address}
            onChange={(e) => set('address', e.target.value)}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 rounded-[6px] text-sm font-medium"
          style={{
            background: submitting ? 'var(--bg-inset)' : 'var(--red)',
            color: submitting ? 'var(--text-tertiary)' : '#fff',
            border: 'none',
            cursor: submitting ? 'not-allowed' : 'pointer',
          }}
        >
          {submitting ? 'Recording…' : 'Record entry'}
        </button>
      </form>
    </div>
  );
}
