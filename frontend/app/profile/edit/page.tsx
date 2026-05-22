'use client';

import { useEffect, useState, FormEvent, ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth, UserProfile, useClerk } from '@clerk/nextjs';
import { Me } from '@/lib/types';
import {
  AddressAutocomplete,
  type ParsedAddressComponents,
} from '@/components/address-autocomplete';
import {
  ManualAddressFields,
  emptyManualAddress,
  type ManualAddressValue,
} from '@/components/manual-address-fields';
import { PageBackground } from '@/components/page-background';
import { PageReveal } from '@/components/page-reveal';
import { HelpTip } from '@/components/help-tip';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// ─── Shared theming primitives (kept inline so this page is self-contained)
//
// SectionCard mirrors the look of every other panel on the site
// (StepAccordion bodies, /profile stat cards, dashboard sections) so
// the page reads as one continuous design.

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  borderRadius: 6,
  padding: '10px 12px',
  fontSize: 14,
  color: 'var(--text-primary)',
  outline: 'none',
};

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section
      data-reveal
      className="rounded-[8px] p-5 sm:p-6"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
      }}
    >
      <header className="mb-5">
        <h2
          className="text-base"
          style={{
            color: 'var(--text-primary)',
            fontWeight: 500,
            letterSpacing: '-0.005em',
          }}
        >
          {title}
        </h2>
        {subtitle && (
          <p
            className="text-xs mt-1"
            style={{ color: 'var(--text-tertiary)', lineHeight: 1.55 }}
          >
            {subtitle}
          </p>
        )}
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label
        className="block text-xs mb-2"
        style={{ color: 'var(--text-secondary)', fontWeight: 500 }}
      >
        {label}
      </label>
      {children}
      {hint && (
        <p className="text-xs mt-1.5" style={{ color: 'var(--text-tertiary)' }}>
          {hint}
        </p>
      )}
    </div>
  );
}

function PrimaryButton({
  children,
  disabled,
  onClick,
  type = 'button',
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="px-5 py-2.5 rounded-[6px] text-sm"
      style={{
        background: disabled ? 'var(--bg-inset)' : 'var(--red)',
        color: disabled ? 'var(--text-tertiary)' : '#fff',
        border: 'none',
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-4 py-2 rounded-[6px] text-sm"
      style={{
        background: 'transparent',
        color: 'var(--text-secondary)',
        border: '0.5px solid var(--border)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

// Banner used for save success / errors. Tone-keyed colour ramp matches
// the dashboard + listing-preview-modal palette.
function StatusBanner({
  tone,
  children,
}: {
  tone: 'success' | 'error' | 'info';
  children: ReactNode;
}) {
  const colour =
    tone === 'success' ? '#22c55e' : tone === 'error' ? 'var(--red)' : '#f59e0b';
  return (
    <div
      className="text-xs rounded-[6px] px-3 py-2"
      style={{
        background: `${colour}14`,
        border: `0.5px solid ${colour}`,
        color: colour,
      }}
    >
      {children}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────

export default function EditProfilePage() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { openUserProfile } = useClerk();

  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Personal info form
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [savingPersonal, setSavingPersonal] = useState(false);
  const [personalStatus, setPersonalStatus] = useState<
    { tone: 'success' | 'error'; msg: string } | null
  >(null);

  // Address form — IDENTICAL wiring to the Sell form (Step 3 / Delivery
  // & address). Same components, same state shape, same handlers, so
  // any fix that lands on one surface lands on both. lat/lng come from
  // Google Places when the seller picks a suggestion; null when typed
  // manually.
  const [addr, setAddr] = useState<ManualAddressValue>(emptyManualAddress);
  const [addrLat, setAddrLat] = useState<number | null>(null);
  const [addrLng, setAddrLng] = useState<number | null>(null);
  const [savingAddress, setSavingAddress] = useState(false);
  const [addressStatus, setAddressStatus] = useState<
    { tone: 'success' | 'error'; msg: string } | null
  >(null);

  // Google Places picked — mirror parsed components into our address
  // state. Verbatim from the Sell form's handleAddressComponents.
  function handleAddressComponents(c: ParsedAddressComponents) {
    setAddr((prev) => ({
      ...prev,
      street: c.street ?? prev.street,
      suburb: c.suburb ?? prev.suburb,
      city: c.city ?? prev.city,
      postalCode: c.postalCode ?? prev.postalCode,
      province: c.province
        ? (c.province
            .toUpperCase()
            .replace(/[\s-]+/g, '_') as ManualAddressValue['province'])
        : prev.province,
    }));
    setAddrLat(c.lat ?? null);
    setAddrLng(c.lng ?? null);
  }

  // Phone change flow
  // States: idle (showing current + button) → entering-number → entering-code → done
  type PhoneMode = 'idle' | 'entering-number' | 'entering-code';
  const [phoneMode, setPhoneMode] = useState<PhoneMode>('idle');
  const [newPhone, setNewPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [phoneStatus, setPhoneStatus] = useState<
    { tone: 'success' | 'error' | 'info'; msg: string } | null
  >(null);
  const [phoneBusy, setPhoneBusy] = useState(false);

  // ── Load /users/me ────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_URL}/users/me`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: Me = await res.json();
        if (cancelled) return;
        setMe(data);
        setFirstName(data.firstName ?? '');
        setLastName(data.lastName ?? '');
        setUsername(data.username ?? '');
        // Map our DB column names (addr*) into the ManualAddressValue
        // shape used by the shared form component.
        setAddr({
          building: data.addrBuilding ?? '',
          street: data.addrStreet ?? '',
          address2: data.addrAddress2 ?? '',
          suburb: data.addrSuburb ?? '',
          city: data.addrCity ?? '',
          postalCode: data.addrPostalCode ?? '',
          province: data.addrProvince ?? '',
        });
        setAddrLat(data.addrLat ?? null);
        setAddrLng(data.addrLng ?? null);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, getToken]);

  // ── Save personal info ───────────────────────────────────────────
  async function handleSavePersonal(e: FormEvent) {
    e.preventDefault();
    setSavingPersonal(true);
    setPersonalStatus(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/users/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          firstName: firstName.trim() || null,
          lastName: lastName.trim() || null,
          username: username.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
      setMe(data);
      setPersonalStatus({ tone: 'success', msg: 'Saved.' });
    } catch (err) {
      setPersonalStatus({
        tone: 'error',
        msg: err instanceof Error ? err.message : 'Could not save',
      });
    } finally {
      setSavingPersonal(false);
    }
  }

  // ── Save address ────────────────────────────────────────────────
  async function handleSaveAddress(e: FormEvent) {
    e.preventDefault();
    setSavingAddress(true);
    setAddressStatus(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/users/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          addrBuilding: addr.building.trim() || null,
          addrStreet: addr.street.trim() || null,
          addrAddress2: addr.address2.trim() || null,
          addrSuburb: addr.suburb.trim() || null,
          addrCity: addr.city.trim() || null,
          addrPostalCode: addr.postalCode.trim() || null,
          addrProvince: addr.province || null,
          addrLat,
          addrLng,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
      setMe(data);
      setAddressStatus({ tone: 'success', msg: 'Address saved.' });
    } catch (err) {
      setAddressStatus({
        tone: 'error',
        msg: err instanceof Error ? err.message : 'Could not save',
      });
    } finally {
      setSavingAddress(false);
    }
  }

  // ── Phone OTP: request ──────────────────────────────────────────
  async function handleRequestOtp() {
    if (!newPhone.trim()) {
      setPhoneStatus({ tone: 'error', msg: 'Enter a number first.' });
      return;
    }
    setPhoneBusy(true);
    setPhoneStatus(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/users/me/phone/request-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ phone: newPhone.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
      setPhoneMode('entering-code');
      setPhoneStatus({
        tone: 'info',
        msg: data.stub
          ? 'Code sent (dev stub — check the server log).'
          : 'Code sent. Check your phone.',
      });
    } catch (err) {
      setPhoneStatus({
        tone: 'error',
        msg: err instanceof Error ? err.message : 'Could not send code',
      });
    } finally {
      setPhoneBusy(false);
    }
  }

  // ── Phone OTP: verify ────────────────────────────────────────────
  async function handleVerifyOtp() {
    if (!/^\d{4}$/.test(otp.trim())) {
      setPhoneStatus({ tone: 'error', msg: 'Enter the 4-digit code.' });
      return;
    }
    setPhoneBusy(true);
    setPhoneStatus(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/users/me/phone/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: otp.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
      // Refresh /me so the verified badge re-renders.
      const meRes = await fetch(`${API_URL}/users/me`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (meRes.ok) setMe(await meRes.json());
      setPhoneMode('idle');
      setNewPhone('');
      setOtp('');
      setPhoneStatus({ tone: 'success', msg: 'Phone verified.' });
    } catch (err) {
      setPhoneStatus({
        tone: 'error',
        msg: err instanceof Error ? err.message : 'Could not verify',
      });
    } finally {
      setPhoneBusy(false);
    }
  }

  if (!isLoaded) return null;
  if (!isSignedIn) {
    return (
      <main className="max-w-[600px] mx-auto px-4 py-12">
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Please sign in to edit your profile.
        </p>
      </main>
    );
  }

  return (
    <main
      className="relative max-w-[900px] mx-auto px-4 py-8"
      style={{ zIndex: 1 }}
    >
      {/* Page-wide settings scenery — dimmed photo + vignette so the
          cards stay primary. House standard on every signed-in page;
          swap the imageSrc per route. */}
      {/* setting.jpg is a dark wrenches scene — high opacity + low tint
          so the photo reads through against the page's #0f0f0f surface. */}
      <PageBackground
        imageSrc="/setting.jpg"
        opacity={0.5}
        tint={0.12}
        vignette={0.7}
      />

      {/* Page header — sits OUTSIDE PageReveal so it renders at full
          opacity immediately. Only the body cards animate. */}
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p
            className="text-xs uppercase mb-1"
            style={{
              color: 'var(--red)',
              letterSpacing: '0.12em',
              fontWeight: 500,
            }}
          >
            Account
          </p>
          <h1
            className="text-2xl sm:text-3xl"
            style={{
              color: 'var(--text-primary)',
              fontWeight: 500,
              letterSpacing: '-0.01em',
            }}
          >
            Edit profile
          </h1>
        </div>
        <Link
          href="/profile"
          className="text-sm"
          style={{ color: 'var(--text-tertiary)', textDecoration: 'none' }}
        >
          ← Back to profile
        </Link>
      </header>

      {loadError && (
        <div className="mb-5">
          <StatusBanner tone="error">{loadError}</StatusBanner>
        </div>
      )}

      {/* Reveal — house standard: 0.5s pre-pause, 2.5s per-item, random
          variant per page-load. Only the body cards live inside. */}
      <PageReveal className="space-y-5">
        {/* ── Personal info ───────────────────────────────────────────
            First + last name are NOT editable here — they come from the
            ID document during KYC. We display them read-only with a
            hint explaining where to change them (contact support).
            Username is the only editable identity field. */}
        <SectionCard
          title="Personal info"
          subtitle="Your name is set from your ID document during verification. Your username is the public handle that shows on your listings and reviews."
        >
          <form onSubmit={handleSavePersonal} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="First name"
                hint={
                  me?.kycStatus === 'VERIFIED'
                    ? 'Verified from your ID. Email support to correct.'
                    : 'Editable until your first sale triggers KYC. Locks to the Home Affairs name then.'
                }
              >
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  disabled={me?.kycStatus === 'VERIFIED'}
                  readOnly={me?.kycStatus === 'VERIFIED'}
                  style={{
                    ...inputStyle,
                    background:
                      me?.kycStatus === 'VERIFIED'
                        ? 'var(--bg-deep)'
                        : 'var(--bg-inset)',
                    color:
                      me?.kycStatus === 'VERIFIED'
                        ? 'var(--text-secondary)'
                        : 'var(--text-primary)',
                    cursor:
                      me?.kycStatus === 'VERIFIED' ? 'not-allowed' : 'text',
                  }}
                />
              </Field>
              <Field
                label="Last name"
                hint={
                  me?.kycStatus === 'VERIFIED'
                    ? 'Verified from your ID. Email support to correct.'
                    : 'Editable until your first sale triggers KYC. Locks to the Home Affairs name then.'
                }
              >
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  disabled={me?.kycStatus === 'VERIFIED'}
                  readOnly={me?.kycStatus === 'VERIFIED'}
                  style={{
                    ...inputStyle,
                    background:
                      me?.kycStatus === 'VERIFIED'
                        ? 'var(--bg-deep)'
                        : 'var(--bg-inset)',
                    color:
                      me?.kycStatus === 'VERIFIED'
                        ? 'var(--text-secondary)'
                        : 'var(--text-primary)',
                    cursor:
                      me?.kycStatus === 'VERIFIED' ? 'not-allowed' : 'text',
                  }}
                />
              </Field>
            </div>
            <Field
              label="Username"
              hint="Lowercase letters, numbers, underscores. Must be unique."
            >
              <input
                type="text"
                value={username}
                onChange={(e) =>
                  setUsername(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9_]/g, '')
                      .slice(0, 30),
                  )
                }
                style={inputStyle}
                placeholder="e.g. nathan_g"
              />
            </Field>

            <div className="flex items-center gap-3 pt-2">
              <PrimaryButton type="submit" disabled={savingPersonal}>
                {savingPersonal ? 'Saving…' : 'Save changes'}
              </PrimaryButton>
              {personalStatus && (
                <StatusBanner tone={personalStatus.tone}>
                  {personalStatus.msg}
                </StatusBanner>
              )}
            </div>
          </form>
        </SectionCard>

        {/* ── Phone ─────────────────────────────────────────────────── */}
        <SectionCard
          title="Phone number"
          subtitle="We send a 4-digit verification code via SMS when you change it. Your old number keeps working until you verify the new one."
        >
          {/* Current + status */}
          <div
            className="flex items-baseline justify-between gap-3 pb-4"
            style={{ borderBottom: '0.5px solid var(--border)' }}
          >
            <div>
              <p
                className="text-xs mb-0.5"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Current number
              </p>
              <p
                className="text-sm"
                style={{ color: 'var(--text-primary)', fontWeight: 500 }}
              >
                {me?.phone || 'Not set'}
              </p>
            </div>
            {me?.phone && (
              <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                <span
                  className="text-xs px-2.5 py-1 rounded-full"
                  style={{
                    background: me.phoneVerified
                      ? 'rgba(34,197,94,0.12)'
                      : 'rgba(245,158,11,0.12)',
                    border: `0.5px solid ${me.phoneVerified ? '#22c55e' : '#f59e0b'}`,
                    color: me.phoneVerified ? '#22c55e' : '#f59e0b',
                    fontWeight: 500,
                  }}
                >
                  {me.phoneVerified ? '✓ Verified' : 'Unverified'}
                </span>
                <HelpTip
                  title="Why phone verification matters"
                  side="left"
                  width={300}
                >
                  Verified phones get used for sale notifications,
                  dispatch SMS, and the buyer&apos;s &quot;where&apos;s my
                  parcel&quot; alerts. Unverified phones still receive
                  basic alerts but are blocked from seller-only flows
                  (high-value listings, offer counters, dispatch
                  confirmations).
                </HelpTip>
              </span>
            )}
          </div>

          {/* Idle — show change CTA */}
          {phoneMode === 'idle' && (
            <div className="flex items-center gap-3">
              <SecondaryButton
                onClick={() => {
                  setPhoneMode('entering-number');
                  setPhoneStatus(null);
                  setNewPhone('');
                }}
              >
                {me?.phone ? 'Change number' : 'Add number'}
              </SecondaryButton>
              {phoneStatus && (
                <StatusBanner tone={phoneStatus.tone}>
                  {phoneStatus.msg}
                </StatusBanner>
              )}
            </div>
          )}

          {/* Step 1 — enter new number */}
          {phoneMode === 'entering-number' && (
            <div className="space-y-3">
              <Field
                label="New phone number"
                hint="SA mobile, e.g. 082 000 0000 or +27 82 000 0000."
              >
                <input
                  type="tel"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  style={inputStyle}
                  placeholder="082 000 0000"
                  autoFocus
                />
              </Field>
              <div className="flex items-center gap-3">
                <PrimaryButton
                  onClick={handleRequestOtp}
                  disabled={phoneBusy || newPhone.trim().length === 0}
                >
                  {phoneBusy ? 'Sending…' : 'Send code'}
                </PrimaryButton>
                <SecondaryButton
                  onClick={() => {
                    setPhoneMode('idle');
                    setPhoneStatus(null);
                    setNewPhone('');
                  }}
                >
                  Cancel
                </SecondaryButton>
              </div>
              {phoneStatus && (
                <StatusBanner tone={phoneStatus.tone}>
                  {phoneStatus.msg}
                </StatusBanner>
              )}
            </div>
          )}

          {/* Step 2 — enter OTP. Branded with the Gun Galore logo. */}
          {phoneMode === 'entering-code' && (
            <div className="rounded-[8px] p-5 sm:p-6 text-center"
              style={{
                background: 'var(--bg-inset)',
                border: '0.5px solid var(--border)',
              }}
            >
              <Image
                src="/logo.svg"
                alt="Gun Galore"
                width={180}
                height={36}
                priority
                style={{
                  height: 36,
                  width: 'auto',
                  margin: '0 auto 16px',
                  display: 'block',
                }}
              />
              <p
                className="text-sm mb-1"
                style={{ color: 'var(--text-primary)', fontWeight: 500 }}
              >
                Enter the 4-digit code we sent to
              </p>
              <p
                className="text-sm mb-5"
                style={{ color: 'var(--text-secondary)' }}
              >
                {newPhone || me?.phone}
              </p>
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={otp}
                onChange={(e) =>
                  setOtp(e.target.value.replace(/\D/g, '').slice(0, 4))
                }
                autoFocus
                style={{
                  width: 180,
                  margin: '0 auto',
                  display: 'block',
                  background: 'var(--bg-card)',
                  border: '0.5px solid var(--border)',
                  borderRadius: 6,
                  padding: '14px 16px',
                  fontSize: 28,
                  letterSpacing: '0.5em',
                  textAlign: 'center',
                  color: 'var(--text-primary)',
                  fontWeight: 500,
                  outline: 'none',
                }}
              />
              <div className="flex items-center justify-center gap-3 mt-5">
                <PrimaryButton
                  onClick={handleVerifyOtp}
                  disabled={phoneBusy || otp.length !== 4}
                >
                  {phoneBusy ? 'Verifying…' : 'Verify'}
                </PrimaryButton>
                <SecondaryButton
                  onClick={() => {
                    setPhoneMode('entering-number');
                    setOtp('');
                    setPhoneStatus(null);
                  }}
                >
                  Wrong number?
                </SecondaryButton>
              </div>
              {phoneStatus && (
                <div className="mt-4">
                  <StatusBanner tone={phoneStatus.tone}>
                    {phoneStatus.msg}
                  </StatusBanner>
                </div>
              )}
              <button
                type="button"
                onClick={handleRequestOtp}
                disabled={phoneBusy}
                className="text-xs mt-4"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-tertiary)',
                  cursor: phoneBusy ? 'not-allowed' : 'pointer',
                }}
              >
                Didn&apos;t arrive? Resend code
              </button>
            </div>
          )}
        </SectionCard>

        {/* ── Address ───────────────────────────────────────────────── */}
        <SectionCard
          title="Address"
          subtitle="Search for your address — picking a suggestion fills in the fields below. Edit anything Google got wrong before saving."
        >
          <form onSubmit={handleSaveAddress} className="space-y-3">
            <Field
              label="Pickup address"
              hint="Search for your address, then check the details below."
            >
              {/* Same wiring as the Sell form's Step 3. value is derived
                  from the address fields so the input shows what we have
                  saved on first load; onChange mirrors typing into the
                  street field as a fallback when Google can't match. */}
              <AddressAutocomplete
                value={
                  addr.street
                    ? `${addr.street}${addr.suburb ? `, ${addr.suburb}` : ''}`
                    : ''
                }
                onChange={(v) => {
                  // Manual typing in the autocomplete box mirrors into
                  // street if the seller hasn't filled it yet.
                  if (!addr.street) {
                    setAddr((p) => ({ ...p, street: v }));
                  }
                }}
                onComponents={handleAddressComponents}
              />
              <div className="mt-3">
                <ManualAddressFields
                  value={addr}
                  onChange={setAddr}
                  idPrefix="profile"
                />
              </div>
            </Field>

            <div className="flex items-center gap-3 pt-2">
              <PrimaryButton type="submit" disabled={savingAddress}>
                {savingAddress ? 'Saving…' : 'Save address'}
              </PrimaryButton>
              {addressStatus && (
                <StatusBanner tone={addressStatus.tone}>
                  {addressStatus.msg}
                </StatusBanner>
              )}
            </div>
          </form>
        </SectionCard>

        {/* ── Email + avatar + password ─────────────────────────────── */}
        <SectionCard
          title="Email, photo & security"
          subtitle="Email address, profile photo, password and two-factor are managed by our identity provider. Opens in a modal — close it to come back here."
        >
          <div className="flex items-center gap-3">
            <PrimaryButton onClick={() => openUserProfile()}>
              Open identity settings
            </PrimaryButton>
            <p
              className="text-xs"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {me?.email}
            </p>
          </div>
          {/* Hide the embedded UserProfile component — we use the modal
              opened above instead so the dark theme stays consistent. The
              import is kept because future versions might want to embed
              it inline if we can tame its appearance. */}
          {false && <UserProfile />}
        </SectionCard>
      </PageReveal>
    </main>
  );
}
