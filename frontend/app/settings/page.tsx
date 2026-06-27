'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import type { Address } from '@/lib/types';
import { PROVINCE_LABELS } from '@/lib/utils';

const API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001/api';

type AddrForm = {
  id?: string;
  label: string;
  building: string;
  street: string;
  address2: string;
  suburb: string;
  city: string;
  postalCode: string;
  province: string;
};

const EMPTY: AddrForm = {
  label: '',
  building: '',
  street: '',
  address2: '',
  suburb: '',
  city: '',
  postalCode: '',
  province: '',
};

const card: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '0.5px solid var(--border)',
  borderRadius: 10,
};
const input: React.CSSProperties = {
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-primary)',
  borderRadius: 6,
  padding: '8px 10px',
  fontSize: 14,
  outline: 'none',
  width: '100%',
};

export default function SettingsPage() {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [emailOn, setEmailOn] = useState(true);
  const [smsOn, setSmsOn] = useState(true);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [form, setForm] = useState<AddrForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authed = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getToken();
      const res = await fetch(`${API_URL}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.message ?? `Error ${res.status}`);
      }
      return res.json();
    },
    [getToken],
  );

  const load = useCallback(async () => {
    try {
      const [me, addrs] = await Promise.all([
        authed('/users/me'),
        authed('/users/me/addresses'),
      ]);
      setEmailOn(me?.notifyEmailEnabled !== false);
      setSmsOn(me?.notifySmsEnabled !== false);
      setAddresses(Array.isArray(addrs) ? addrs : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [authed]);

  useEffect(() => {
    void load();
  }, [load]);

  async function savePrefs(next: { emailEnabled?: boolean; smsEnabled?: boolean }) {
    // Optimistic; revert on failure.
    const prevEmail = emailOn;
    const prevSms = smsOn;
    if (next.emailEnabled !== undefined) setEmailOn(next.emailEnabled);
    if (next.smsEnabled !== undefined) setSmsOn(next.smsEnabled);
    try {
      await authed('/users/me/notification-prefs', {
        method: 'PATCH',
        body: JSON.stringify(next),
      });
    } catch (e) {
      setEmailOn(prevEmail);
      setSmsOn(prevSms);
      setError(e instanceof Error ? e.message : 'Could not save preference');
    }
  }

  async function submitAddress() {
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      const body = JSON.stringify({
        label: form.label || null,
        building: form.building || null,
        street: form.street,
        address2: form.address2 || null,
        suburb: form.suburb || null,
        city: form.city,
        postalCode: form.postalCode,
        province: form.province,
      });
      if (form.id) {
        await authed(`/users/me/addresses/${form.id}`, { method: 'PATCH', body });
      } else {
        await authed('/users/me/addresses', { method: 'POST', body });
      }
      setForm(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save address');
    } finally {
      setBusy(false);
    }
  }

  async function setDefault(id: string) {
    try {
      await authed(`/users/me/addresses/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isDefault: true }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not set default');
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this address?')) return;
    try {
      await authed(`/users/me/addresses/${id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete address');
    }
  }

  const Toggle = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      style={{
        width: 44,
        height: 26,
        borderRadius: 13,
        border: 'none',
        cursor: 'pointer',
        background: on ? '#00a03c' : 'var(--border-hover)',
        position: 'relative',
        transition: 'background 0.15s',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: on ? 21 : 3,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.15s',
        }}
      />
    </button>
  );

  return (
    <main className="max-w-[640px] mx-auto px-4 py-8">
      <h1
        className="text-2xl"
        style={{ color: 'var(--text-primary)', fontWeight: 500 }}
      >
        Account settings
      </h1>
      <p className="text-sm mt-1 mb-6" style={{ color: 'var(--text-tertiary)' }}>
        Manage how we reach you and your saved delivery addresses.{' '}
        <Link href="/profile/edit" style={{ color: 'var(--red)' }}>
          Edit profile →
        </Link>
      </p>

      {error && (
        <p className="text-sm mb-4" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Loading…
        </p>
      ) : (
        <>
          {/* ─── Notification preferences ─── */}
          <section style={card} className="p-4 mb-6">
            <h2
              className="text-base mb-1"
              style={{ color: 'var(--text-primary)', fontWeight: 500 }}
            >
              Notifications
            </h2>
            <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
              Important account and order alerts always appear in your in-app
              inbox. Choose which extra channels you want.
            </p>
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                  Email
                </p>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Order updates, offers and account emails.
                </p>
              </div>
              <Toggle on={emailOn} onClick={() => savePrefs({ emailEnabled: !emailOn })} />
            </div>
            <div
              className="flex items-center justify-between py-2"
              style={{ borderTop: '0.5px solid var(--border)' }}
            >
              <div>
                <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                  SMS
                </p>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Time-sensitive texts (sale, dispatch, payment).
                </p>
              </div>
              <Toggle on={smsOn} onClick={() => savePrefs({ smsEnabled: !smsOn })} />
            </div>
          </section>

          {/* ─── Address book ─── */}
          <section style={card} className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h2
                className="text-base"
                style={{ color: 'var(--text-primary)', fontWeight: 500 }}
              >
                Saved addresses
              </h2>
              {!form && (
                <button
                  type="button"
                  onClick={() => setForm({ ...EMPTY })}
                  className="text-sm px-3 py-1.5 rounded-[6px]"
                  style={{ background: 'var(--red)', color: '#fff', border: 'none', cursor: 'pointer' }}
                >
                  + Add
                </button>
              )}
            </div>

            {addresses.length === 0 && !form && (
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                No saved addresses yet. Add one to speed up checkout.
              </p>
            )}

            <div className="flex flex-col gap-2">
              {addresses.map((a) => (
                <div
                  key={a.id}
                  className="p-3 rounded-[8px] flex items-start justify-between gap-3"
                  style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)' }}
                >
                  <div className="min-w-0">
                    <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                      {a.label || a.street}
                      {a.isDefault && (
                        <span
                          className="ml-2 text-xs px-1.5 py-0.5 rounded"
                          style={{ background: '#00a03c', color: '#fff' }}
                        >
                          Default
                        </span>
                      )}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                      {[a.building, a.street, a.address2, a.suburb, a.city, a.postalCode, PROVINCE_LABELS[a.province]]
                        .filter(Boolean)
                        .join(', ')}
                    </p>
                    <div className="flex gap-3 mt-2">
                      {!a.isDefault && (
                        <button
                          type="button"
                          onClick={() => setDefault(a.id)}
                          className="text-xs"
                          style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', textDecoration: 'underline' }}
                        >
                          Set default
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setForm({
                            id: a.id,
                            label: a.label ?? '',
                            building: a.building ?? '',
                            street: a.street,
                            address2: a.address2 ?? '',
                            suburb: a.suburb ?? '',
                            city: a.city,
                            postalCode: a.postalCode,
                            province: a.province,
                          })
                        }
                        className="text-xs"
                        style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', textDecoration: 'underline' }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(a.id)}
                        className="text-xs"
                        style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', textDecoration: 'underline' }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Add / edit form */}
            {form && (
              <div className="mt-4 flex flex-col gap-2">
                <input
                  style={input}
                  placeholder="Label (e.g. Home, Work)"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                />
                <input
                  style={input}
                  placeholder="Complex / building (optional)"
                  value={form.building}
                  onChange={(e) => setForm({ ...form, building: e.target.value })}
                />
                <input
                  style={input}
                  placeholder="Street address *"
                  value={form.street}
                  onChange={(e) => setForm({ ...form, street: e.target.value })}
                />
                <input
                  style={input}
                  placeholder="Address line 2 (optional)"
                  value={form.address2}
                  onChange={(e) => setForm({ ...form, address2: e.target.value })}
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    style={input}
                    placeholder="Suburb"
                    value={form.suburb}
                    onChange={(e) => setForm({ ...form, suburb: e.target.value })}
                  />
                  <input
                    style={input}
                    placeholder="City *"
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    style={input}
                    placeholder="Postal code *"
                    value={form.postalCode}
                    onChange={(e) => setForm({ ...form, postalCode: e.target.value })}
                  />
                  <select
                    style={input}
                    value={form.province}
                    onChange={(e) => setForm({ ...form, province: e.target.value })}
                  >
                    <option value="">Province *</option>
                    {Object.entries(PROVINCE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setForm(null)}
                    disabled={busy}
                    className="flex-1 py-2 rounded-[6px] text-sm"
                    style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)', border: '0.5px solid var(--border)', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submitAddress}
                    disabled={busy || !form.street || !form.city || !form.postalCode || !form.province}
                    className="flex-1 py-2 rounded-[6px] text-sm font-medium"
                    style={{
                      background:
                        busy || !form.street || !form.city || !form.postalCode || !form.province
                          ? 'var(--bg-inset)'
                          : 'var(--red)',
                      color:
                        busy || !form.street || !form.city || !form.postalCode || !form.province
                          ? 'var(--text-tertiary)'
                          : '#fff',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    {busy ? 'Saving…' : form.id ? 'Save changes' : 'Add address'}
                  </button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
