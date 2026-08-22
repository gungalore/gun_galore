'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth, useUser, useClerk } from '@clerk/nextjs';
import Link from 'next/link';
import type { Address } from '@/lib/types';
import { PROVINCE_LABELS } from '@/lib/utils';
import { safeJson } from '@/lib/safe-json';
import { usePush } from '@/lib/use-push';

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
  const { user, isLoaded: userLoaded } = useUser();
  const { openUserProfile } = useClerk();
  const mfaOn = !!user?.twoFactorEnabled;
  const [loading, setLoading] = useState(true);
  const [emailOn, setEmailOn] = useState(true);
  const [smsOn, setSmsOn] = useState(true);
  // WhatsApp is stored per user but not user-settable yet — the switch below
  // is greyed until the operator turns the channel on globally, so this is
  // display-only for now.
  const [whatsappOn, setWhatsappOn] = useState(true);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [form, setForm] = useState<AddrForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Seller default parcel size (Phase 6 P6.3). Strings for forgiving input;
  // weight shown in kg, dims in cm.
  const [ship, setShip] = useState({ weightKg: '', lengthCm: '', widthCm: '', heightCm: '' });
  const [shipSaved, setShipSaved] = useState(false);
  // Push lives on the DEVICE, not on the user record — so it isn't part of
  // the /users/me notification prefs above. Same hook the /notifications
  // banner and the PWA More-sheet toggle use, so all three stay in sync
  // instead of this page growing a second subscribe path.
  const push = usePush();
  const [pushHint, setPushHint] = useState<string | null>(null);

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
        const e = await safeJson<{ message?: string }>(res, {});
        throw new Error(e.message ?? `Error ${res.status}`);
      }
      // Mutations (PATCH/DELETE) legitimately return an empty 200/204 body —
      // a raw res.json() there throws "Unexpected end of JSON input".
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return safeJson<any>(res, {});
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
      setWhatsappOn(me?.notifyWhatsappEnabled !== false);
      setShip({
        weightKg: me?.defaultWeightGrams ? String(me.defaultWeightGrams / 1000) : '',
        lengthCm: me?.defaultLengthCm ? String(me.defaultLengthCm) : '',
        widthCm: me?.defaultWidthCm ? String(me.defaultWidthCm) : '',
        heightCm: me?.defaultHeightCm ? String(me.defaultHeightCm) : '',
      });
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
    // ⚠️ At least one of Email or SMS has to stay on, or we lose every way to
    // reach the user off-site. The server enforces this and answers 400, but
    // we mirror it here so the switch never flicks off and back. WhatsApp is
    // deliberately not counted: it's operator-gated, so allowing it to satisfy
    // the floor would let someone strand themselves on a channel they can't
    // switch back on. Merge onto current state — `next` is a partial.
    if (!(next.emailEnabled ?? emailOn) && !(next.smsEnabled ?? smsOn)) {
      setError(
        'Keep at least one of Email or SMS on so we can reach you about orders and payments.',
      );
      return;
    }
    setError(null);
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

  // Flip web push for this device. enable() prompts for permission and then
  // registers the subscription with the backend; a false return means either
  // the prompt was declined or the POST failed, so we tell the user which.
  // Notification.permission is read live rather than from the hook's state —
  // the value captured in this render is still the pre-prompt one.
  async function togglePush() {
    if (push.busy) return;
    setPushHint(null);
    if (push.enabled) {
      await push.disable();
      return;
    }
    const ok = await push.enable();
    if (!ok) {
      const denied =
        typeof Notification !== 'undefined' && Notification.permission === 'denied';
      setPushHint(
        denied
          ? 'Notifications are blocked for this site in your browser settings — allow them there, then try again.'
          : "Couldn't turn push on right now. Try again in a moment.",
      );
    }
  }

  async function saveShippingDefaults() {
    setBusy(true);
    setError(null);
    setShipSaved(false);
    try {
      const num = (s: string) => {
        const n = parseFloat(s);
        return Number.isFinite(n) && n > 0 ? n : null;
      };
      const kg = num(ship.weightKg);
      await authed('/users/me/shipping-defaults', {
        method: 'PATCH',
        body: JSON.stringify({
          weightGrams: kg != null ? Math.round(kg * 1000) : null,
          lengthCm: num(ship.lengthCm) != null ? Math.round(num(ship.lengthCm)!) : null,
          widthCm: num(ship.widthCm) != null ? Math.round(num(ship.widthCm)!) : null,
          heightCm: num(ship.heightCm) != null ? Math.round(num(ship.heightCm)!) : null,
        }),
      });
      setShipSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save parcel defaults');
    } finally {
      setBusy(false);
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

  // `label` is the accessible name — the visible wording sits in a separate
  // <p> beside the switch, so without it a screen reader announces a bare
  // "switch, on".
  // `disabled` is for a channel that exists but the user can't set yet
  // (WhatsApp, below). It stays a full-size switch with its knob and colour and
  // only dims — a half-drawn or hidden control reads as a rendering bug rather
  // than as "not yet". `onClick` is optional so such a row needn't pass a no-op.
  const Toggle = ({
    on,
    onClick,
    label,
    disabled = false,
  }: {
    on: boolean;
    onClick?: () => void;
    label: string;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      // aria-disabled rather than the `disabled` attribute: a truly disabled
      // button is skipped by some screen readers, so the user would never hear
      // that the channel exists. tabIndex -1 still takes it out of the tab order.
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      onClick={disabled ? undefined : onClick}
      style={{
        width: 44,
        height: 26,
        borderRadius: 13,
        border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
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
            {/* ⚠️ WhatsApp is shown greyed on purpose, not hidden: the channel
                is plumbed but nothing sends over it until the operator turns on
                the global `whatsapp_enabled` flag, and when it does it carries
                shipping updates only. Leaving the switch visible tells the user
                the channel is coming without letting them set a preference we
                can't honour yet. Don't wire this to savePrefs until the flag is
                live — the stored flag is already on by default. */}
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                  WhatsApp
                </p>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Shipping updates. Coming soon.
                </p>
              </div>
              <Toggle
                on={whatsappOn}
                label="WhatsApp notifications (coming soon)"
                disabled
              />
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
              <Toggle
                on={smsOn}
                onClick={() => savePrefs({ smsEnabled: !smsOn })}
                label="SMS notifications"
              />
            </div>
            <div
              className="flex items-center justify-between py-2"
              style={{ borderTop: '0.5px solid var(--border)' }}
            >
              <div>
                <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                  Email
                </p>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Order updates, offers and account emails.
                </p>
              </div>
              <Toggle
                on={emailOn}
                onClick={() => savePrefs({ emailEnabled: !emailOn })}
                label="Email notifications"
              />
            </div>

            {/* Push — the channel that matters most in the installed app,
                previously only reachable from the /notifications banner (which
                self-dismisses for 14 days) or the PWA More sheet, which
                browser and desktop users never see. Device-scoped, hence the
                "(this device)" label. The whole row hides until the probe is
                done and the backend actually has VAPID keys, so we never show
                a switch that can't do anything. */}
            {push.ready && push.vapidReady && (
              <div
                className="flex items-center justify-between gap-3 py-2"
                style={{ borderTop: '0.5px solid var(--border)' }}
              >
                <div style={{ minWidth: 0 }}>
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                    Push notifications (this device)
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    {pushHint ??
                      (!push.supported
                        ? "This browser can't do push. On iPhone, install All Outdoor to your home screen first."
                        : push.permission === 'denied'
                          ? 'Blocked for this site in your browser settings — allow notifications there to switch this on.'
                          : 'Instant alerts on this device for offers, outbids, sales and dispatch.')}
                  </p>
                </div>
                {push.supported && push.permission !== 'denied' ? (
                  <Toggle
                    on={push.enabled}
                    onClick={() => void togglePush()}
                    label="Push notifications on this device"
                  />
                ) : (
                  <span
                    className="text-xs"
                    style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}
                  >
                    Unavailable
                  </span>
                )}
              </div>
            )}
          </section>

          {/* ─── Default parcel size (Phase 6 P6.3) ─── */}
          <section style={card} className="p-4 mb-6">
            <h2 className="text-base mb-1" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
              Default parcel size
            </h2>
            <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
              Selling items of a similar size? Set defaults here and the sell
              form will pre-fill them, so you can get a shipping quote without
              re-typing every time. You can still change them per listing.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <label className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Weight (kg)
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={ship.weightKg}
                  onChange={(e) => { setShip((s) => ({ ...s, weightKg: e.target.value })); setShipSaved(false); }}
                  style={input}
                  className="mt-1"
                />
              </label>
              <label className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Length (cm)
                <input
                  type="number"
                  min="0"
                  value={ship.lengthCm}
                  onChange={(e) => { setShip((s) => ({ ...s, lengthCm: e.target.value })); setShipSaved(false); }}
                  style={input}
                  className="mt-1"
                />
              </label>
              <label className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Width (cm)
                <input
                  type="number"
                  min="0"
                  value={ship.widthCm}
                  onChange={(e) => { setShip((s) => ({ ...s, widthCm: e.target.value })); setShipSaved(false); }}
                  style={input}
                  className="mt-1"
                />
              </label>
              <label className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Height (cm)
                <input
                  type="number"
                  min="0"
                  value={ship.heightCm}
                  onChange={(e) => { setShip((s) => ({ ...s, heightCm: e.target.value })); setShipSaved(false); }}
                  style={input}
                  className="mt-1"
                />
              </label>
            </div>
            <div className="flex items-center gap-3 mt-4">
              <button
                type="button"
                onClick={saveShippingDefaults}
                disabled={busy}
                className="text-sm px-3 py-1.5 rounded-md"
                // House red, not --accent: that variable is defined nowhere in
                // the dark theme, so the fallback made this the only blue
                // primary button in the app. Same for the success green below,
                // which now matches the KYC-verified chips on /account
                // and /profile.
                style={{ background: 'var(--red)', color: '#fff', border: 'none', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}
              >
                {busy ? 'Saving…' : 'Save defaults'}
              </button>
              {shipSaved && (
                <span className="text-xs" style={{ color: '#22c55e' }}>Saved ✓</span>
              )}
            </div>
          </section>

          {/* ─── Security (2FA via Clerk) ─── */}
          <section style={card} className="p-4 mb-6">
            <h2
              className="text-base mb-1"
              style={{ color: 'var(--text-primary)', fontWeight: 500 }}
            >
              Security
            </h2>
            <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
              Two-factor authentication adds a second step at sign-in. Strongly
              recommended for sellers — your account can hold payout details.
            </p>
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                  Two-factor authentication
                </p>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {!userLoaded
                    ? 'Checking…'
                    : mfaOn
                      ? '✓ Enabled — your account has 2FA.'
                      : 'Not enabled.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => openUserProfile()}
                className="text-sm px-3 py-1.5 rounded-[6px] whitespace-nowrap"
                style={
                  mfaOn
                    ? {
                        background: 'var(--bg-inset)',
                        color: 'var(--text-secondary)',
                        border: '0.5px solid var(--border)',
                        cursor: 'pointer',
                      }
                    : {
                        background: 'var(--red)',
                        color: '#fff',
                        border: 'none',
                        cursor: 'pointer',
                      }
                }
              >
                {mfaOn ? 'Manage' : 'Enable 2FA'}
              </button>
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
