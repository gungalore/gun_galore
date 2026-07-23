'use client';

import { useEffect, useRef, useState, FormEvent, ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth, useUser } from '@clerk/nextjs';
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
import { StepAccordion, type StepStatus } from '@/components/step-accordion';
import { HelpTip } from '@/components/help-tip';
import { SA_BANKS } from '@/lib/sa-banks';
import { safeJson } from '@/lib/safe-json';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// ─── Shared theming primitives (kept inline so this page is self-contained)
//
// The page's section chrome is the Sell form's StepAccordion (imported
// above) so /profile/edit and /listings/new read as the same design;
// only the small field/button primitives live here.

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

// Clerk SDK errors carry a user-worded `errors[].longMessage` (e.g.
// "Incorrect password. Please try again."). Surface that instead of a
// generic failure so the inline photo / password / email-verify forms
// give the same quality of feedback Clerk's own modal did.
function clerkErrorMsg(err: unknown): string {
  const e = err as { errors?: { longMessage?: string; message?: string }[] };
  return (
    e?.errors?.[0]?.longMessage ??
    e?.errors?.[0]?.message ??
    (err instanceof Error ? err.message : 'Something went wrong — try again.')
  );
}

// ─── Page ─────────────────────────────────────────────────────────────

export default function EditProfilePage() {
  const { isLoaded, isSignedIn, getToken } = useAuth();

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

  // FLOW-F2 — banking details. Buyer refunds AND seller payouts are paid to
  // this account by the daily FNB EFT batch; refund SMS/email link buyers here
  // when there's nothing on file. Saves via PATCH /users/me/bank-details.
  const [bankName, setBankName] = useState('');
  const [bankAccountHolder, setBankAccountHolder] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankBranchCode, setBankBranchCode] = useState('');
  const [bankAccountType, setBankAccountType] =
    useState<'cheque' | 'savings' | 'transmission'>('cheque');
  const [savingBank, setSavingBank] = useState(false);
  const [bankStatus, setBankStatus] = useState<
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
        const data = await safeJson<Me | null>(res, null);
        if (cancelled) return;
        if (!data) throw new Error('Empty profile response');
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
        setBankName(data.bankName ?? '');
        setBankAccountHolder(data.bankAccountHolder ?? '');
        setBankAccountNumber(data.bankAccountNumber ?? '');
        setBankBranchCode(data.bankBranchCode ?? '');
        if (
          data.bankAccountType === 'savings' ||
          data.bankAccountType === 'transmission'
        ) {
          setBankAccountType(data.bankAccountType);
        }
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await safeJson<any>(res, {});
      if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
      if (data?.id) setMe(data);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await safeJson<any>(res, {});
      if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
      if (data?.id) setMe(data);
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

  // ── Save banking details ────────────────────────────────────────
  async function handleSaveBank(e: FormEvent) {
    e.preventDefault();
    setSavingBank(true);
    setBankStatus(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/users/me/bank-details`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          bankName: bankName.trim(),
          bankAccountHolder: bankAccountHolder.trim(),
          bankAccountNumber: bankAccountNumber.trim(),
          bankBranchCode: bankBranchCode.trim(),
          bankAccountType,
        }),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await safeJson<any>(res, {});
      if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
      if (data?.id) setMe(data);
      setBankStatus({ tone: 'success', msg: 'Banking details saved.' });
    } catch (err) {
      setBankStatus({
        tone: 'error',
        msg: err instanceof Error ? err.message : 'Could not save',
      });
    } finally {
      setSavingBank(false);
    }
  }

  const bankReady =
    bankName.trim() &&
    bankAccountHolder.trim() &&
    bankAccountNumber.trim() &&
    bankBranchCode.trim();

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await safeJson<any>(res, {});
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await safeJson<any>(res, {});
      if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
      // Refresh /me so the verified badge re-renders.
      const meRes = await fetch(`${API_URL}/users/me`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (meRes.ok) {
        const m = await safeJson<Me | null>(meRes, null);
        if (m) setMe(m);
      }
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

  // Email + identity state for the Verification section. Email + its
  // verified flag come from Clerk (system of record for email); ID
  // verification status comes from our KYC pipeline via /users/me.
  const { user: clerkUser } = useUser();
  const emailAddr =
    clerkUser?.primaryEmailAddress?.emailAddress ?? me?.email ?? null;
  const emailVerified =
    clerkUser?.primaryEmailAddress?.verification?.status === 'verified';
  const kyc = me?.kycStatus ?? 'NONE';

  // ── Clerk-managed bits, edited INLINE (no identity modal) ──────────
  // Photo, password and email-verification live in Clerk, not our DB —
  // but Clerk's frontend SDK exposes each one (setProfileImage,
  // updatePassword, prepare/attemptVerification), so we render our own
  // controls in the house style instead of opening Clerk's UserProfile
  // modal. clerkUser updates reactively after each call, so badges and
  // avatars refresh without a reload.
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoStatus, setPhotoStatus] = useState<
    { tone: 'success' | 'error'; msg: string } | null
  >(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [curPassword, setCurPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwStatus, setPwStatus] = useState<
    { tone: 'success' | 'error'; msg: string } | null
  >(null);
  const [emailMode, setEmailMode] = useState<'idle' | 'code'>('idle');
  const [emailCode, setEmailCode] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailStatus, setEmailStatus] = useState<
    { tone: 'success' | 'error'; msg: string } | null
  >(null);

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset so picking the same file twice still fires onChange.
    e.target.value = '';
    if (!file || !clerkUser) return;
    if (file.size > 10 * 1024 * 1024) {
      setPhotoStatus({ tone: 'error', msg: 'Photo must be under 10 MB.' });
      return;
    }
    setPhotoBusy(true);
    setPhotoStatus(null);
    try {
      await clerkUser.setProfileImage({ file });
      setPhotoStatus({ tone: 'success', msg: 'Photo updated.' });
    } catch (err) {
      setPhotoStatus({ tone: 'error', msg: clerkErrorMsg(err) });
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handleRemovePhoto() {
    if (!clerkUser) return;
    setPhotoBusy(true);
    setPhotoStatus(null);
    try {
      await clerkUser.setProfileImage({ file: null });
      setPhotoStatus({ tone: 'success', msg: 'Photo removed.' });
    } catch (err) {
      setPhotoStatus({ tone: 'error', msg: clerkErrorMsg(err) });
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    if (!clerkUser) return;
    if (newPassword.length < 8) {
      setPwStatus({
        tone: 'error',
        msg: 'New password must be at least 8 characters.',
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwStatus({ tone: 'error', msg: 'The two passwords don’t match.' });
      return;
    }
    setPwBusy(true);
    setPwStatus(null);
    try {
      // currentPassword is required when one exists; an OAuth-only
      // account (passwordEnabled=false) sets its first password instead.
      await clerkUser.updatePassword({
        newPassword,
        ...(clerkUser.passwordEnabled ? { currentPassword: curPassword } : {}),
      });
      setPwOpen(false);
      setCurPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwStatus({ tone: 'success', msg: 'Password changed.' });
    } catch (err) {
      setPwStatus({ tone: 'error', msg: clerkErrorMsg(err) });
    } finally {
      setPwBusy(false);
    }
  }

  async function handleSendEmailCode() {
    const email = clerkUser?.primaryEmailAddress;
    if (!email) return;
    setEmailBusy(true);
    setEmailStatus(null);
    try {
      await email.prepareVerification({ strategy: 'email_code' });
      setEmailMode('code');
      setEmailCode('');
      setEmailStatus({
        tone: 'success',
        msg: `Code sent to ${email.emailAddress}.`,
      });
    } catch (err) {
      setEmailStatus({ tone: 'error', msg: clerkErrorMsg(err) });
    } finally {
      setEmailBusy(false);
    }
  }

  async function handleVerifyEmailCode() {
    const email = clerkUser?.primaryEmailAddress;
    if (!email) return;
    setEmailBusy(true);
    setEmailStatus(null);
    try {
      await email.attemptVerification({ code: emailCode.trim() });
      // clerkUser refreshes reactively → the badge flips to ✓ Verified
      // and this whole block unmounts (it only renders while unverified).
      setEmailMode('idle');
    } catch (err) {
      setEmailStatus({ tone: 'error', msg: clerkErrorMsg(err) });
    } finally {
      setEmailBusy(false);
    }
  }

  // ── Step accordion (sell-form chrome) ──────────────────────────────
  // Same StepAccordion the Sell form uses, but as an EDIT surface: no
  // step is ever locked, one open at a time, and each step's colour is
  // an honest three-way state:
  //   green ✓   — the data is ACTUALLY filled in / verified
  //   red       — required (per profileCompleteness.missing) and missing
  //   neutral   — empty but not required yet ("· Optional", e.g. banking
  //               before you sell, or the profile photo)
  // Green-when-empty would lie; red-when-optional would nag. The
  // required set stays shape-aware via the same missing[] the nav ring
  // and dashboard bar use, so every surface agrees.
  const missing = me?.profileCompleteness?.missing ?? [];
  const isSeller = me?.profileCompleteness?.shape === 'seller';

  // Data truth — what's actually on file, independent of shape rules.
  const nameFilled = !!(me?.firstName && me?.lastName);
  const emailPhoneDone = emailVerified && !!me?.phoneVerified;
  const idDone = kyc === 'VERIFIED' || kyc === 'UNDER_REVIEW';
  const addressFilled = !!me && !missing.includes('address');
  const bankingFilled = !!me?.bankAccountNumber;
  const photoFilled = !!clerkUser?.hasImage;

  const statusOf = (filled: boolean, required: boolean): StepStatus =>
    filled ? 'complete' : required ? 'active' : 'idle';

  const step1Status = statusOf(nameFilled, true);
  // Email + phone are required for everyone; the ID leg only gates the
  // green once the profile is seller-shaped (has a listing / KYC due).
  const step2Status = statusOf(emailPhoneDone && (idDone || !isSeller), true);
  const step3Status = statusOf(addressFilled, true);
  const step4Status = statusOf(bankingFilled, missing.includes('banking'));
  const step5Status = statusOf(photoFilled, false);

  const [openStep, setOpenStep] = useState<number | null>(null);
  const openInitDone = useRef(false);
  // Once the profile arrives, open the FIRST step that's genuinely
  // outstanding (red). Optional-empty steps don't auto-open; if nothing
  // is red the page loads fully collapsed.
  useEffect(() => {
    if (!me || openInitDone.current) return;
    openInitDone.current = true;
    const statuses = [
      step1Status,
      step2Status,
      step3Status,
      step4Status,
      step5Status,
    ];
    const firstActive = statuses.findIndex((s) => s === 'active');
    setOpenStep(firstActive === -1 ? null : firstActive + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  function toggleStep(n: number) {
    setOpenStep((v) => (v === n ? null : n));
  }

  // Collapsed-row summaries, sell-form style ("what's in this step").
  const step1Summary = nameFilled
    ? [[firstName, lastName].filter(Boolean).join(' '), username]
        .filter(Boolean)
        .join(' · ')
    : 'Add your name';
  const step2Summary = [
    `Email ${emailVerified ? '✓' : '—'}`,
    `Phone ${me?.phoneVerified ? '✓' : '—'}`,
    kyc === 'VERIFIED'
      ? 'ID ✓'
      : kyc === 'UNDER_REVIEW'
        ? 'ID in review'
        : isSeller
          ? 'ID not verified'
          : 'ID optional until you sell',
  ].join(' · ');
  const step3Summary = addr.street
    ? [addr.street, addr.city].filter(Boolean).join(', ')
    : 'No address yet';
  const step4Summary = bankingFilled
    ? `${bankName || 'Bank'} ···${bankAccountNumber.slice(-4)}`
    : missing.includes('banking')
      ? 'No banking details yet'
      : 'Optional — needed before your first payout';
  const step5Summary = photoFilled ? 'Photo uploaded' : 'No photo yet';

  const percent = me?.profileCompleteness?.percent ?? 0;

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
      className="relative max-w-[1280px] mx-auto px-4 py-8 sm:py-12"
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
      <header className="mb-8 flex items-start justify-between gap-4 flex-wrap max-w-[820px]">
        <div>
          <p
            className="text-xs uppercase mb-2"
            style={{
              color: 'var(--red)',
              letterSpacing: '0.12em',
              fontWeight: 500,
            }}
          >
            Account
          </p>
          <h1
            className="text-3xl sm:text-4xl mb-2"
            style={{
              color: 'var(--text-primary)',
              fontWeight: 500,
              letterSpacing: '-0.02em',
            }}
          >
            Edit profile
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Work through the steps below — green means done. Each step saves
            on its own.
          </p>
        </div>
        <Link
          href="/profile"
          className="text-sm"
          style={{ color: 'var(--text-tertiary)', textDecoration: 'none', paddingTop: 4 }}
        >
          ← Back to profile
        </Link>
      </header>

      {loadError && (
        <div className="mb-5">
          <StatusBanner tone="error">{loadError}</StatusBanner>
        </div>
      )}

      {/* Reveal — house standard. Sell-form layout: steps column + a
          sticky completeness sidebar on desktop. */}
      <PageReveal className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
        <div data-reveal className="space-y-3 max-w-[820px]">
        {/* ── Personal info ───────────────────────────────────────────
            First + last name are NOT editable here — they come from the
            ID document during KYC. We display them read-only with a
            hint explaining where to change them (contact support).
            Username is the only editable identity field. */}
        <StepAccordion
          number={1}
          title="Contact"
          description="Your name is set from your ID during verification; your username is the public handle shown on your listings and reviews. Your phone, email and ID all live under Verification below."
          status={step1Status}
          expanded={openStep === 1}
          onToggle={() => toggleStep(1)}
          summary={step1Summary}
          hideContinue
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
        </StepAccordion>

        {/* ── Verification (email + phone + ID, all in one place) ────── */}
        <StepAccordion
          number={2}
          title="Verification"
          description="Everything that needs verifying, in one place — your email, your phone, and your ID. Verifying your ID here means you're ready to sell the moment you list, no waiting."
          status={step2Status}
          expanded={openStep === 2}
          onToggle={() => toggleStep(2)}
          summary={step2Summary}
          hideContinue
        >
          {/* ── Email ── */}
          <div
            className="flex items-baseline justify-between gap-3 pb-4 mb-4"
            style={{ borderBottom: '0.5px solid var(--border)' }}
          >
            <div style={{ minWidth: 0 }}>
              <p
                className="text-xs mb-0.5"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Email
              </p>
              <p
                className="text-sm"
                style={{
                  color: 'var(--text-primary)',
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {emailAddr || 'Not set'}
              </p>
            </div>
            {emailAddr && (
              <span
                className="text-xs px-2.5 py-1 rounded-full"
                style={{
                  background: emailVerified
                    ? 'rgba(34,197,94,0.12)'
                    : 'rgba(245,158,11,0.12)',
                  border: `0.5px solid ${emailVerified ? '#22c55e' : '#f59e0b'}`,
                  color: emailVerified ? '#22c55e' : '#f59e0b',
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                }}
              >
                {emailVerified ? '✓ Verified' : 'Unverified'}
              </span>
            )}
          </div>
          {emailAddr && !emailVerified && (
            <div className="mb-5">
              {emailMode === 'idle' ? (
                <div className="flex items-center gap-3 flex-wrap">
                  <SecondaryButton
                    onClick={handleSendEmailCode}
                    disabled={emailBusy}
                  >
                    {emailBusy ? 'Sending…' : 'Verify email'}
                  </SecondaryButton>
                  {emailStatus && (
                    <StatusBanner tone={emailStatus.tone}>
                      {emailStatus.msg}
                    </StatusBanner>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <Field
                    label="Verification code"
                    hint={`Enter the 6-digit code we emailed to ${emailAddr}.`}
                  >
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={emailCode}
                      onChange={(e) =>
                        setEmailCode(e.target.value.replace(/\D/g, ''))
                      }
                      style={{
                        ...inputStyle,
                        maxWidth: 220,
                        letterSpacing: '0.2em',
                      }}
                      placeholder="000000"
                      autoFocus
                    />
                  </Field>
                  <div className="flex items-center gap-3 flex-wrap">
                    <PrimaryButton
                      onClick={handleVerifyEmailCode}
                      disabled={emailBusy || emailCode.length !== 6}
                    >
                      {emailBusy ? 'Checking…' : 'Confirm'}
                    </PrimaryButton>
                    <SecondaryButton
                      onClick={handleSendEmailCode}
                      disabled={emailBusy}
                    >
                      Resend code
                    </SecondaryButton>
                    <SecondaryButton
                      onClick={() => {
                        setEmailMode('idle');
                        setEmailStatus(null);
                      }}
                      disabled={emailBusy}
                    >
                      Cancel
                    </SecondaryButton>
                    {emailStatus && (
                      <StatusBanner tone={emailStatus.tone}>
                        {emailStatus.msg}
                      </StatusBanner>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Phone ── */}
          <p
            className="text-xs uppercase mb-2"
            style={{
              color: 'var(--text-tertiary)',
              letterSpacing: '0.06em',
              fontWeight: 600,
            }}
          >
            Phone
          </p>
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

          {/* ── Identity / ID ── */}
          <div
            className="pt-5 mt-4"
            style={{ borderTop: '0.5px solid var(--border)' }}
          >
            <p
              className="text-xs uppercase mb-2"
              style={{
                color: 'var(--text-tertiary)',
                letterSpacing: '0.06em',
                fontWeight: 600,
              }}
            >
              ID verification
            </p>
            <div className="flex items-baseline justify-between gap-3">
              <p
                className="text-sm"
                style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}
              >
                {kyc === 'VERIFIED'
                  ? 'Your identity is verified.'
                  : kyc === 'UNDER_REVIEW'
                    ? 'Being reviewed — nothing more needed from you right now.'
                    : kyc === 'REJECTED'
                      ? 'Your last verification didn’t pass. You can try again.'
                      : 'Verify your SA ID with a quick photo + selfie. Do it now and you’re ready to sell the moment you list.'}
              </p>
              <span
                className="text-xs px-2.5 py-1 rounded-full"
                style={{
                  whiteSpace: 'nowrap',
                  background:
                    kyc === 'VERIFIED'
                      ? 'rgba(34,197,94,0.12)'
                      : kyc === 'UNDER_REVIEW'
                        ? 'rgba(245,158,11,0.12)'
                        : 'var(--bg-inset)',
                  border: `0.5px solid ${
                    kyc === 'VERIFIED'
                      ? '#22c55e'
                      : kyc === 'UNDER_REVIEW'
                        ? '#f59e0b'
                        : 'var(--border)'
                  }`,
                  color:
                    kyc === 'VERIFIED'
                      ? '#22c55e'
                      : kyc === 'UNDER_REVIEW'
                        ? '#f59e0b'
                        : 'var(--text-tertiary)',
                  fontWeight: 500,
                }}
              >
                {kyc === 'VERIFIED'
                  ? '✓ Verified'
                  : kyc === 'UNDER_REVIEW'
                    ? 'In review'
                    : 'Not verified'}
              </span>
            </div>
            {kyc !== 'VERIFIED' && kyc !== 'UNDER_REVIEW' && (
              <div className="mt-3">
                <Link
                  href="/kyc/verify?returnTo=/profile/edit"
                  style={{
                    display: 'inline-block',
                    background: 'var(--red)',
                    color: '#fff',
                    borderRadius: 8,
                    padding: '10px 18px',
                    fontSize: 14,
                    fontWeight: 500,
                    textDecoration: 'none',
                  }}
                >
                  Verify my ID now →
                </Link>
              </div>
            )}
          </div>
        </StepAccordion>

        {/* ── Address ───────────────────────────────────────────────── */}
        <StepAccordion
          number={3}
          title="Address"
          description="Search for your address — picking a suggestion fills in the fields below. Edit anything Google got wrong before saving."
          status={step3Status}
          expanded={openStep === 3}
          onToggle={() => toggleStep(3)}
          summary={step3Summary}
          hideContinue
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
        </StepAccordion>

        {/* ── Banking details ───────────────────────────────────────
            FLOW-F2 — the account refunds AND seller payouts are EFT'd to.
            Refund SMS/email deep-link here when a buyer who's owed a
            refund has nothing on file. */}
        <StepAccordion
          number={4}
          title="Banking details"
          description="Refunds owed to you and any sales payouts are paid to this account by EFT. Make sure the account holder name matches your ID — we check it before the first payout."
          status={step4Status}
          expanded={openStep === 4}
          onToggle={() => toggleStep(4)}
          summary={step4Summary}
          hideContinue
        >
          <form onSubmit={handleSaveBank} className="space-y-4">
            {me?.bankVerifiedAt && (
              <StatusBanner tone="success">
                ✓ Bank account on file. Editing it here resets verification —
                we&apos;ll re-check the holder name before your next payout.
              </StatusBanner>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Account holder" hint="Exactly as it appears on your bank account / ID.">
                <input
                  type="text"
                  value={bankAccountHolder}
                  onChange={(e) => setBankAccountHolder(e.target.value)}
                  style={inputStyle}
                  placeholder="e.g. N Gerber"
                />
              </Field>
              <Field label="Bank">
                {/* Picker (not free text): payouts go out via Peach, whose
                    bank list is a fixed enum — picking here guarantees the
                    payout maps. Picking also pre-fills the universal branch
                    code below (still editable). */}
                <select
                  value={bankName}
                  onChange={(e) => {
                    const name = e.target.value;
                    setBankName(name);
                    const entry = SA_BANKS.find((b) => b.name === name);
                    if (entry?.universalCode) setBankBranchCode(entry.universalCode);
                  }}
                  style={inputStyle}
                >
                  <option value="">— pick your bank —</option>
                  {/* Keep a legacy free-text value selectable so an existing
                      saved bank name doesn't silently vanish from the form. */}
                  {bankName && !SA_BANKS.some((b) => b.name === bankName) && (
                    <option value={bankName}>{bankName}</option>
                  )}
                  {SA_BANKS.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Account number">
                <input
                  type="text"
                  inputMode="numeric"
                  value={bankAccountNumber}
                  onChange={(e) =>
                    setBankAccountNumber(e.target.value.replace(/[^0-9]/g, '').slice(0, 20))
                  }
                  style={inputStyle}
                  placeholder="Account number"
                />
              </Field>
              <Field label="Branch code" hint="6-digit universal branch code.">
                <input
                  type="text"
                  inputMode="numeric"
                  value={bankBranchCode}
                  onChange={(e) =>
                    setBankBranchCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))
                  }
                  style={inputStyle}
                  placeholder="e.g. 250655"
                />
              </Field>
              <Field label="Account type">
                <select
                  value={bankAccountType}
                  onChange={(e) =>
                    setBankAccountType(
                      e.target.value as 'cheque' | 'savings' | 'transmission',
                    )
                  }
                  style={inputStyle}
                >
                  <option value="cheque">Cheque / current</option>
                  <option value="savings">Savings</option>
                  <option value="transmission">Transmission</option>
                </select>
              </Field>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <PrimaryButton type="submit" disabled={savingBank || !bankReady}>
                {savingBank ? 'Saving…' : 'Save banking details'}
              </PrimaryButton>
              {bankStatus && (
                <StatusBanner tone={bankStatus.tone}>{bankStatus.msg}</StatusBanner>
              )}
            </div>
          </form>
        </StepAccordion>

        {/* ── Photo & password ──────────────────────────────────────────
            These live in Clerk (the identity provider), not our DB — but
            we edit them INLINE via the Clerk frontend SDK so the page
            stays one consistent surface. No modal, no separate page.
            (2FA isn't enabled on the instance, so there's nothing else
            left that needs Clerk's own UI.) */}
        <StepAccordion
          number={5}
          title="Photo & password"
          description="Your public profile photo and the password you sign in with."
          status={step5Status}
          expanded={openStep === 5}
          onToggle={() => toggleStep(5)}
          summary={step5Summary}
          hideContinue
        >
          {/* Photo — preview + upload/remove, saved straight to Clerk.
              The nav avatar follows automatically (it reads the same
              Clerk image). */}
          <div className="flex items-center gap-4 flex-wrap">
            <span
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                overflow: 'hidden',
                flexShrink: 0,
                background: 'var(--red)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
                fontWeight: 500,
              }}
            >
              {clerkUser?.hasImage && clerkUser?.imageUrl ? (
                <Image
                  src={clerkUser.imageUrl}
                  alt=""
                  width={56}
                  height={56}
                  style={{ objectFit: 'cover' }}
                />
              ) : (
                (clerkUser?.username || username || 'G')
                  .charAt(0)
                  .toUpperCase()
              )}
            </span>
            <div className="flex items-center gap-3 flex-wrap">
              <SecondaryButton
                onClick={() => photoInputRef.current?.click()}
                disabled={photoBusy}
              >
                {photoBusy
                  ? 'Uploading…'
                  : clerkUser?.hasImage
                    ? 'Change photo'
                    : 'Upload photo'}
              </SecondaryButton>
              {clerkUser?.hasImage && (
                <SecondaryButton onClick={handleRemovePhoto} disabled={photoBusy}>
                  Remove
                </SecondaryButton>
              )}
            </div>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              style={{ display: 'none' }}
              onChange={handlePhotoChange}
            />
          </div>
          {photoStatus && (
            <StatusBanner tone={photoStatus.tone}>
              {photoStatus.msg}
            </StatusBanner>
          )}

          {/* Password — inline change form, same house widgets as the
              rest of the page. Clerk enforces its own strength rules;
              its message is surfaced verbatim on failure. */}
          <div
            className="pt-4"
            style={{ borderTop: '0.5px solid var(--border)' }}
          >
            <p
              className="text-xs uppercase mb-2"
              style={{
                color: 'var(--text-tertiary)',
                letterSpacing: '0.06em',
                fontWeight: 600,
              }}
            >
              Password
            </p>
            {!pwOpen ? (
              <div className="flex items-center gap-3 flex-wrap">
                <SecondaryButton
                  onClick={() => {
                    setPwOpen(true);
                    setPwStatus(null);
                  }}
                >
                  {clerkUser?.passwordEnabled
                    ? 'Change password'
                    : 'Set a password'}
                </SecondaryButton>
                {pwStatus && (
                  <StatusBanner tone={pwStatus.tone}>
                    {pwStatus.msg}
                  </StatusBanner>
                )}
              </div>
            ) : (
              <form onSubmit={handleChangePassword} className="space-y-3">
                {clerkUser?.passwordEnabled && (
                  <Field label="Current password">
                    <input
                      type="password"
                      value={curPassword}
                      onChange={(e) => setCurPassword(e.target.value)}
                      style={{ ...inputStyle, maxWidth: 340 }}
                      autoComplete="current-password"
                      autoFocus
                    />
                  </Field>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="New password" hint="At least 8 characters.">
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      style={inputStyle}
                      autoComplete="new-password"
                    />
                  </Field>
                  <Field label="Confirm new password">
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      style={inputStyle}
                      autoComplete="new-password"
                    />
                  </Field>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <PrimaryButton type="submit" disabled={pwBusy}>
                    {pwBusy ? 'Saving…' : 'Save password'}
                  </PrimaryButton>
                  <SecondaryButton
                    onClick={() => {
                      setPwOpen(false);
                      setCurPassword('');
                      setNewPassword('');
                      setConfirmPassword('');
                      setPwStatus(null);
                    }}
                    disabled={pwBusy}
                  >
                    Cancel
                  </SecondaryButton>
                  {pwStatus && (
                    <StatusBanner tone={pwStatus.tone}>
                      {pwStatus.msg}
                    </StatusBanner>
                  )}
                </div>
              </form>
            )}
          </div>
        </StepAccordion>
        </div>

        {/* ── Sticky completeness sidebar (desktop) — the sell form's
            sidebar slot, repurposed: live percent + a per-step checklist
            that jumps to (and opens) the step you click. Mirrors the nav
            ring / dashboard bar exactly (same /users/me source). */}
        <aside data-reveal className="hidden lg:block">
          <div
            className="sticky top-20 rounded-[8px] p-5 space-y-4"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
            }}
          >
            <p
              className="text-xs uppercase"
              style={{
                color: 'var(--text-tertiary)',
                letterSpacing: '0.08em',
                fontWeight: 500,
              }}
            >
              Profile completeness
            </p>
            <div className="flex items-baseline gap-2">
              <span
                className="text-3xl"
                style={{ color: 'var(--text-primary)', fontWeight: 500 }}
              >
                {percent}%
              </span>
              {percent >= 100 && (
                <span
                  className="text-xs"
                  style={{ color: '#22c55e', fontWeight: 500 }}
                >
                  Complete ✓
                </span>
              )}
            </div>
            <div
              className="h-1.5 rounded-full overflow-hidden"
              style={{ background: 'var(--bg-inset)' }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${percent}%`,
                  background:
                    percent >= 67
                      ? '#22c55e'
                      : percent >= 34
                        ? '#f59e0b'
                        : 'var(--red)',
                  transition: 'width 0.3s',
                }}
              />
            </div>
            <div className="space-y-1 pt-1">
              {/* Mark mirrors the step status exactly: ✓ filled, red ○
                  required-and-missing, neutral – optional-and-empty. */}
              {[
                { n: 1, label: 'Contact', status: step1Status },
                { n: 2, label: 'Verification', status: step2Status },
                { n: 3, label: 'Address', status: step3Status },
                { n: 4, label: 'Banking details', status: step4Status },
                { n: 5, label: 'Photo & password', status: step5Status },
              ].map((s) => (
                <button
                  key={s.n}
                  type="button"
                  onClick={() => setOpenStep(s.n)}
                  className="w-full flex items-center justify-between gap-2 text-left text-sm rounded-[6px] px-2 py-1.5"
                  style={{
                    background:
                      openStep === s.n ? 'var(--bg-inset)' : 'transparent',
                    border: 'none',
                    color:
                      s.status === 'active'
                        ? 'var(--text-primary)'
                        : 'var(--text-tertiary)',
                    cursor: 'pointer',
                  }}
                >
                  <span>{s.label}</span>
                  <span
                    className="text-xs"
                    style={{
                      color:
                        s.status === 'complete'
                          ? '#22c55e'
                          : s.status === 'active'
                            ? 'var(--red)'
                            : 'var(--text-tertiary)',
                      fontWeight: 500,
                    }}
                  >
                    {s.status === 'complete'
                      ? '✓'
                      : s.status === 'active'
                        ? '○'
                        : '–'}
                  </span>
                </button>
              ))}
            </div>
            <p
              className="text-xs"
              style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}
            >
              A complete profile means faster checkout, selling without
              hold-ups, and payouts that clear first time.
            </p>
          </div>
        </aside>
      </PageReveal>
    </main>
  );
}
