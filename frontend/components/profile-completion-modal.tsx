'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  AddressAutocomplete,
  type ParsedAddressComponents,
} from './address-autocomplete';
import {
  ManualAddressFields,
  emptyManualAddress,
  type ManualAddressValue,
} from './manual-address-fields';
import type { Me, Province } from '@/lib/types';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Common SA bank universal branch codes — these go directly into the
// branch code field when the bank is picked, no operator has to look
// them up. Customer can still override if they're on a specific
// branch number for some reason.
// Shared payout-bank list (mirrors the Peach Payouts enum server-side).
import { SA_BANKS } from '@/lib/sa-banks';

// Hard-wall modal shown to the seller after their first listing is
// published successfully. Collects everything we need to pay them
// when their first sale lands:
//   - Identity: name, surname, username (Clerk-synced)
//   - Phone: typed, no OTP (per operator decision)
//   - Address: Google autocomplete + manual fields
//   - SA ID number: stored encrypted at rest, decrypted at KYC time
//   - Banking: verified after save via Peach bank-account verification
//     (account exists + open + SA-ID ownership); until that service is
//     configured, an admin reviews the holder name before first payout
//
// The modal CANNOT be dismissed — no close button, Esc handler is
// suppressed, click-outside does nothing. The seller can keep
// publishing more listings, but their payout is blocked until this
// modal has been submitted successfully (server-side gate in
// AdminService.releaseTransaction).
// 24-hour "snooze" window for the profile-completion gate. While this
// localStorage flag is in the future, the modal stays closed even if
// the seller publishes more listings. Payout is STILL blocked
// server-side until the profile is complete — the flag only changes
// when the modal pops, not what's gated by it. Cleared on successful
// submit so the seller never sees it after they actually finish.
const FINISH_LATER_KEY_PREFIX = 'gg-profile-finish-later-until-';
const FINISH_LATER_MS = 24 * 60 * 60 * 1000; // 24h

export function markProfileFinishLater(userId: string | null | undefined) {
  if (typeof window === 'undefined' || !userId) return;
  try {
    window.localStorage.setItem(
      `${FINISH_LATER_KEY_PREFIX}${userId}`,
      String(Date.now() + FINISH_LATER_MS),
    );
  } catch {
    /* localStorage quota / private mode — silent */
  }
}

/** True when the seller has explicitly chosen "Finish later" within
 * the last 24 hours. Callers should AND this with an in-progress check
 * to decide whether to pop the modal at all. */
export function shouldSuppressProfileModal(userId: string | null | undefined): boolean {
  if (typeof window === 'undefined' || !userId) return false;
  try {
    const raw = window.localStorage.getItem(`${FINISH_LATER_KEY_PREFIX}${userId}`);
    if (!raw) return false;
    const until = parseInt(raw, 10);
    if (!Number.isFinite(until)) return false;
    if (Date.now() < until) return true;
    // Expired — clean up.
    window.localStorage.removeItem(`${FINISH_LATER_KEY_PREFIX}${userId}`);
    return false;
  } catch {
    return false;
  }
}

export function clearProfileFinishLater(userId: string | null | undefined) {
  if (typeof window === 'undefined' || !userId) return;
  try {
    window.localStorage.removeItem(`${FINISH_LATER_KEY_PREFIX}${userId}`);
  } catch {
    /* ignore */
  }
}

export function ProfileCompletionModal({
  me,
  onComplete,
  onFinishLater,
}: {
  me: Me;
  onComplete: () => void;
  /** Optional escape hatch. When provided, a "Finish later" link
   * renders below the submit button. Tapping it stamps a 24h
   * localStorage flag (callers should re-check via
   * shouldSuppressProfileModal) and invokes this callback so the
   * parent can close the modal + continue whatever flow led here. */
  onFinishLater?: () => void;
}) {
  const { getToken } = useAuth();

  // localStorage draft key — same modal across browser sessions for
  // the same Clerk user (key includes their clerkId so two accounts
  // on the same browser don't trip each other). Cleared on successful
  // submit. Banking quartet is intentionally INCLUDED because losing
  // it on AVS-failure → tab-close was the original trap; localStorage
  // is device-local so the trade-off is acceptable.
  const draftKey = `gg-profile-completion-draft-${me.id ?? 'anon'}`;
  const draft = loadDraft(draftKey);

  // Identity
  const [firstName, setFirstName] = useState(draft?.firstName ?? me.firstName ?? '');
  const [lastName, setLastName] = useState(draft?.lastName ?? me.lastName ?? '');
  const [username, setUsername] = useState(draft?.username ?? me.username ?? '');
  const [phone, setPhone] = useState(draft?.phone ?? me.phone ?? '');

  // Address — Google + manual, mirrored
  const [addr, setAddr] = useState<ManualAddressValue>(
    draft?.addr ?? {
      building: me.addrBuilding ?? '',
      street: me.addrStreet ?? '',
      address2: me.addrAddress2 ?? '',
      suburb: me.addrSuburb ?? '',
      city: me.addrCity ?? '',
      postalCode: me.addrPostalCode ?? '',
      province: me.addrProvince ?? ('' as ManualAddressValue['province']),
    },
  );
  const [lat, setLat] = useState<number | null>(draft?.lat ?? me.addrLat);
  const [lng, setLng] = useState<number | null>(draft?.lng ?? me.addrLng);

  // ID number — 13-digit SA. Stored encrypted on submit.
  const [idNumber, setIdNumber] = useState(draft?.idNumber ?? '');

  // Banking
  const [bankName, setBankName] = useState(draft?.bankName ?? me.bankName ?? '');
  const [bankAccountHolder, setBankAccountHolder] = useState(
    draft?.bankAccountHolder ?? me.bankAccountHolder ?? '',
  );
  const [bankAccountNumber, setBankAccountNumber] = useState(draft?.bankAccountNumber ?? '');
  const [bankBranchCode, setBankBranchCode] = useState(
    draft?.bankBranchCode ?? me.bankBranchCode ?? '',
  );
  const [bankAccountType, setBankAccountType] = useState<
    'cheque' | 'savings' | 'transmission'
  >(draft?.bankAccountType ?? 'cheque');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(!!draft);

  // Save draft on every keystroke. Debouncing isn't worth the
  // complexity — localStorage writes are cheap and this form has at
  // most ~13 fields.
  useEffect(() => {
    saveDraft(draftKey, {
      firstName,
      lastName,
      username,
      phone,
      addr,
      lat,
      lng,
      idNumber,
      bankName,
      bankAccountHolder,
      bankAccountNumber,
      bankBranchCode,
      bankAccountType,
    });
  }, [
    draftKey,
    firstName,
    lastName,
    username,
    phone,
    addr,
    lat,
    lng,
    idNumber,
    bankName,
    bankAccountHolder,
    bankAccountNumber,
    bankBranchCode,
    bankAccountType,
  ]);

  // Body scroll lock so the seller can't scroll behind the modal.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Pre-fill the autocomplete display with the saved address (if any)
  // so the seller sees their current address rather than an empty
  // search box.
  const autocompleteInitial = addr.street
    ? `${addr.street}${addr.suburb ? `, ${addr.suburb}` : ''}`
    : '';

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
    setLat(c.lat ?? null);
    setLng(c.lng ?? null);
  }

  function onBankPick(name: string) {
    setBankName(name);
    const entry = SA_BANKS.find((b) => b.name === name);
    if (entry && entry.universalCode) setBankBranchCode(entry.universalCode);
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    const token = await getToken();
    const body = JSON.stringify({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      username: username.trim().toLowerCase(),
      // Strip whitespace so "+27 82 123 4567" still passes
      // backend validation. Mirrors the readiness check.
      phone: phone.trim().replace(/\s/g, ''),
      addrBuilding: addr.building.trim() || null,
      addrStreet: addr.street.trim(),
      addrAddress2: addr.address2.trim() || null,
      addrSuburb: addr.suburb.trim(),
      addrCity: addr.city.trim(),
      addrPostalCode: addr.postalCode.trim(),
      addrProvince: addr.province as Province,
      addrLat: lat,
      addrLng: lng,
      idNumber: idNumber.replace(/\s/g, ''),
      bankName: bankName.trim(),
      bankAccountHolder: bankAccountHolder.trim(),
      bankAccountNumber: bankAccountNumber.trim(),
      bankBranchCode: bankBranchCode.trim(),
      bankAccountType,
    });

    // Verify-success fallback: if the POST drops mid-flight (iOS Safari
    // surfaces "Load failed" when it cancels a request — common in PWAs
    // when the SW updates, the user backgrounds the app, or the
    // connection blips), check whether the server actually applied the
    // change anyway. We re-fetch /users/me and look at profileCompletedAt.
    // If it's set, treat as success rather than making the user re-submit
    // (which has happened — the operator hit "Load failed" twice while
    // the backend logged two successful Profile completed events).
    async function profileNowComplete(): Promise<boolean> {
      try {
        const r = await fetch(`${API_URL}/users/me`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!r.ok) return false;
        const me = (await r.json()) as { profileCompletedAt?: string | null };
        return Boolean(me.profileCompletedAt);
      } catch {
        return false;
      }
    }

    try {
      const res = await fetch(`${API_URL}/users/me/profile-complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body,
        // keepalive lets iOS Safari hold the request open across short
        // app-backgrounding events that would otherwise cancel it.
        keepalive: true,
      });
      if (!res.ok) {
        // 4xx with a real body — show the server's message verbatim.
        const errBody = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        setError(errBody.message ?? `Save failed (${res.status})`);
        return;
      }
      clearDraft(draftKey);
      clearProfileFinishLater(me.id);
      onComplete();
    } catch (err) {
      // Network error — the POST may have completed server-side even
      // though we never got the response. Verify before showing an
      // error, so the user doesn't see "Load failed" on a save that
      // actually worked.
      const completed = await profileNowComplete();
      if (completed) {
        clearDraft(draftKey);
        onComplete();
        return;
      }
      setError(
        err instanceof Error
          ? `${err.message} — please try again`
          : 'Network error — please try again',
      );
    } finally {
      setSubmitting(false);
    }
  }

  // Client-side readiness mirror — same set of rules the backend
  // enforces. Returned as a list so the UI can show the seller
  // exactly which check is blocking them (a dead "Complete profile"
  // button with no explanation was the failure mode the operator
  // hit on 2026-05-20 — they filled everything and couldn't tell
  // what was wrong).
  const checks: { ok: boolean; label: string }[] = [
    { ok: firstName.trim().length > 1, label: 'First name (2+ characters)' },
    { ok: lastName.trim().length > 1, label: 'Surname (2+ characters)' },
    {
      ok: /^[a-z0-9_]{3,30}$/.test(username.trim().toLowerCase()),
      label: 'Username (3–30 chars, lowercase letters, digits and underscores only)',
    },
    {
      ok: /^\+?\d{9,15}$/.test(phone.trim().replace(/\s/g, '')),
      label: 'Phone number (9–15 digits, optional leading +, no spaces)',
    },
    { ok: !!addr.street.trim(), label: 'Street address' },
    { ok: !!addr.city.trim(), label: 'City' },
    { ok: !!addr.postalCode.trim(), label: 'Postal code' },
    { ok: !!addr.province, label: 'Province' },
    {
      ok: /^\d{13}$/.test(idNumber.replace(/\s/g, '')),
      label: 'SA ID number (exactly 13 digits)',
    },
    { ok: !!bankName.trim(), label: 'Bank' },
    { ok: !!bankAccountHolder.trim(), label: 'Account holder name' },
    {
      ok: /^\d{4,20}$/.test(bankAccountNumber.trim()),
      label: 'Bank account number (4–20 digits, no spaces)',
    },
    {
      ok: /^\d{4,8}$/.test(bankBranchCode.trim()),
      label: 'Branch code (4–8 digits — auto-fills when you pick a bank)',
    },
  ];
  const ready = checks.every((c) => c.ok);
  const missing = checks.filter((c) => !c.ok);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Complete your profile"
      // Hard wall — Esc/click-outside are NOT wired. The only exit
      // is a successful submit.
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.92)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        overflowY: 'auto',
        padding: '40px 20px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 720,
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderRadius: 10,
          padding: 28,
          color: 'var(--text-primary)',
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 500,
            letterSpacing: '-0.01em',
          }}
        >
          Finish setting up your seller profile
        </h1>
        <p
          style={{
            margin: '8px 0 14px',
            fontSize: 13,
            lineHeight: 1.55,
            color: 'var(--text-secondary)',
          }}
        >
          We need these once. They power your payouts when a buyer purchases
          your listing. Your SA ID is stored encrypted and used only for the
          Home Affairs identity check and any firearm-transfer paperwork the
          law requires — kept securely under our Privacy Policy.
        </p>

        {/* Live-identity heads-up. The SA ID + selfie face-match (VerifyNow vs
            Home Affairs) is triggered at the FIRST SALE — not here — to conserve
            verification credits. This callout just warns the seller it's coming
            and is mandatory, so it's never a surprise at sale time. */}
        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            background: 'rgba(200,16,46,0.08)',
            border: '0.5px solid rgba(200,16,46,0.35)',
            borderRadius: 8,
            padding: '11px 13px',
            margin: '0 0 24px',
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--red)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0, marginTop: 1 }}
            aria-hidden
          >
            <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3Z" />
            <path d="M9.5 12l1.8 1.8L15 10" />
          </svg>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              lineHeight: 1.5,
              color: 'var(--text-secondary)',
            }}
          >
            <strong style={{ color: 'var(--text-primary)' }}>
              Heads up — a live identity check is required to sell.
            </strong>{' '}
            When your first sale lands you’ll verify your SA ID against Home
            Affairs and take a quick selfie. It’s mandatory to receive payment
            (and for any firearm transfer). Fill these details in now — the live
            check runs at your first sale.
          </p>
        </div>

        {/* Identity */}
        <Section title="Identity">
          <Row>
            <Field label="First name *">
              <Input value={firstName} onChange={setFirstName} />
            </Field>
            <Field label="Surname *">
              <Input value={lastName} onChange={setLastName} />
            </Field>
          </Row>
          <Row>
            <Field label="Email">
              <Input value={me.email} onChange={() => {}} disabled />
            </Field>
            <Field label="Username *">
              <Input
                value={username}
                onChange={(v) =>
                  setUsername(v.toLowerCase().replace(/[^a-z0-9_]/g, ''))
                }
                placeholder="lowercase letters / numbers / _"
              />
            </Field>
          </Row>
          <Row>
            <Field label="Phone *">
              <Input
                value={phone}
                onChange={setPhone}
                placeholder="0821234567 or +27821234567"
              />
              {/* Type-check note — this modal doesn't OTP the number
                  (that lives on /profile/edit). A typo means SMS
                  notifications go to the wrong person forever, so
                  worth re-reading before saving. Verification flow
                  is one step away after the profile is saved. */}
              <p
                style={{
                  fontSize: 11,
                  color: 'var(--text-tertiary)',
                  marginTop: 4,
                  lineHeight: 1.45,
                }}
              >
                Double-check this — SMS dispatch updates and security
                alerts go here. You can verify it with a one-time code
                later from <em>Profile → Edit</em>.
              </p>
            </Field>
            <Field label="SA ID number *">
              <Input
                value={idNumber}
                onChange={(v) => setIdNumber(v.replace(/[^\d]/g, '').slice(0, 13))}
                placeholder="13 digits"
              />
            </Field>
          </Row>
        </Section>

        {/* Address */}
        <Section title="Address">
          <AddressAutocomplete
            value={autocompleteInitial}
            onChange={(v) => {
              // Free-text typing into the autocomplete only updates the
              // street field initially — the dropdown selection fires
              // onComponents with the rest.
              if (!addr.street) setAddr((p) => ({ ...p, street: v }));
            }}
            onComponents={handleAddressComponents}
          />
          <div style={{ marginTop: 12 }}>
            <ManualAddressFields
              value={addr}
              onChange={setAddr}
              idPrefix="profile-modal"
            />
          </div>
          {(lat == null || lng == null) && (
            <p
              style={{
                marginTop: 8,
                fontSize: 11,
                color: 'var(--text-tertiary)',
              }}
            >
              Tip: pick your address from the autocomplete suggestions so we
              capture coordinates. We need these for shipping quotes.
            </p>
          )}
        </Section>

        {/* Banking */}
        <Section title="Banking">
          <p
            style={{
              fontSize: 12,
              color: 'var(--text-tertiary)',
              marginBottom: 12,
            }}
          >
            Our team reviews your bank details against your verified
            identity before your first payout — make sure the account
            holder name matches your ID.
          </p>
          <Row>
            <Field label="Bank *">
              <select
                value={bankName}
                onChange={(e) => onBankPick(e.target.value)}
                style={selectStyle}
              >
                <option value="">— pick a bank —</option>
                {SA_BANKS.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Account type *">
              <select
                value={bankAccountType}
                onChange={(e) =>
                  setBankAccountType(
                    e.target.value as 'cheque' | 'savings' | 'transmission',
                  )
                }
                style={selectStyle}
              >
                <option value="cheque">Cheque / Current</option>
                <option value="savings">Savings</option>
                <option value="transmission">Transmission</option>
              </select>
            </Field>
          </Row>
          <Row>
            <Field label="Account holder name *">
              <Input
                value={bankAccountHolder}
                onChange={setBankAccountHolder}
                placeholder="As shown on your bank statement"
              />
            </Field>
            <Field label="Branch code *">
              <Input
                value={bankBranchCode}
                onChange={(v) => setBankBranchCode(v.replace(/[^\d]/g, ''))}
                placeholder="Auto-filled when you pick a bank"
              />
            </Field>
          </Row>
          <Row>
            <Field label="Account number *">
              <Input
                value={bankAccountNumber}
                onChange={(v) =>
                  setBankAccountNumber(v.replace(/[^\d]/g, ''))
                }
                placeholder="Digits only"
              />
            </Field>
            <div />
          </Row>
        </Section>

        {/* Draft restored notice — shown once when a previous session's
            unsaved data is loaded from localStorage. Lets the seller
            know we have their back. */}
        {draftRestored && (
          <div
            style={{
              marginTop: 16,
              padding: '10px 12px',
              fontSize: 12,
              color: 'var(--text-secondary)',
              background: 'rgba(47,158,107,0.10)',
              border: '0.5px solid rgba(47,158,107,0.45)',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span>
              <strong style={{ color: '#2f9e6b' }}>Draft restored</strong> —
              we kept your previously typed details for this session.
            </span>
            <button
              type="button"
              onClick={() => {
                clearDraft(draftKey);
                setDraftRestored(false);
                window.location.reload();
              }}
              style={{
                background: 'transparent',
                color: 'var(--text-tertiary)',
                border: 'none',
                padding: '2px 6px',
                fontSize: 11,
                cursor: 'pointer',
                textDecoration: 'underline',
                flexShrink: 0,
              }}
            >
              Start over
            </button>
          </div>
        )}

        {error && (
          <div
            style={{
              marginTop: 16,
              padding: '10px 12px',
              fontSize: 13,
              color: '#fff',
              background: 'rgba(200,16,46,0.12)',
              border: '0.5px solid var(--red)',
              borderRadius: 6,
              lineHeight: 1.5,
            }}
          >
            <p style={{ margin: 0, fontWeight: 500 }}>{error}</p>
            {/* AVS-specific guidance — these failures are the most
                common cause of submit blockers. Plain English fix
                hints help the seller fix it themselves before
                escalating to support. */}
            {/(bank|avs|account|branch)/i.test(error) && (
              <ul
                style={{
                  margin: '8px 0 0',
                  paddingLeft: 18,
                  fontSize: 12,
                  color: 'rgba(255,255,255,0.85)',
                }}
              >
                <li>
                  Account holder name must match your bank statement
                  exactly (initials, no nicknames).
                </li>
                <li>
                  Branch code auto-fills when you pick the bank above —
                  if you overrode it, switch back to the universal code.
                </li>
                <li>
                  Account number has no spaces or dashes — digits only.
                </li>
                <li>
                  Bank account must be in your own name, not a joint or
                  business account.
                </li>
              </ul>
            )}
            <p
              style={{
                margin: '10px 0 0',
                fontSize: 11,
                color: 'rgba(255,255,255,0.7)',
              }}
            >
              Still stuck?{' '}
              <a
                href="mailto:support@gungalore.co.za?subject=Profile%20completion%20help"
                style={{ color: '#fff', textDecoration: 'underline' }}
              >
                Email support
              </a>{' '}
              — we'll set this up manually. Your draft is saved on this
              device until you successfully submit.
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={!ready || submitting}
          style={{
            marginTop: 24,
            width: '100%',
            padding: '12px',
            background: ready && !submitting ? 'var(--red)' : 'var(--bg-inset)',
            color: ready && !submitting ? '#fff' : 'var(--text-tertiary)',
            border: 'none',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
            cursor: ready && !submitting ? 'pointer' : 'not-allowed',
          }}
        >
          {submitting ? 'Saving…' : 'Complete profile'}
        </button>

        {/* "Finish later" escape — only rendered when the parent
            opted in via the onFinishLater prop. Stamps a 24-hour
            localStorage flag so the modal won't re-pop on every
            navigation. Server-side payout gate stays in place —
            this is purely a UX escape valve, not a way around the
            block. Right-aligned below the primary CTA so it doesn't
            compete visually with "Complete profile". */}
        {onFinishLater && (
          <div
            style={{
              marginTop: 10,
              display: 'flex',
              justifyContent: 'flex-end',
            }}
          >
            <button
              type="button"
              onClick={() => {
                markProfileFinishLater(me.id);
                onFinishLater();
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-tertiary)',
                fontSize: 12,
                cursor: 'pointer',
                padding: '4px 0',
              }}
            >
              Finish later — payouts blocked until done →
            </button>
          </div>
        )}

        {/* Show exactly which fields are still blocking the submit so
            the seller doesn't have to guess. Hidden once everything
            passes. */}
        {!ready && missing.length > 0 && (
          <div
            style={{
              marginTop: 12,
              padding: '10px 12px',
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              borderRadius: 6,
              fontSize: 12,
              color: 'var(--text-secondary)',
            }}
          >
            <p
              style={{
                margin: '0 0 6px',
                fontWeight: 500,
                color: 'var(--text-primary)',
              }}
            >
              Still needed before we can save:
            </p>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {missing.map((m) => (
                <li key={m.label} style={{ lineHeight: 1.5 }}>
                  {m.label}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────── small inline subcomponents ──────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 24 }}>
      <p
        style={{
          margin: '0 0 12px',
          fontSize: 11,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: 'var(--text-tertiary)',
          fontWeight: 500,
        }}
      >
        {title}
      </p>
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 12,
        marginBottom: 12,
      }}
    >
      {children}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'block' }}>
      <span
        style={{
          display: 'block',
          fontSize: 12,
          color: 'var(--text-secondary)',
          marginBottom: 4,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      style={{
        width: '100%',
        background: 'var(--bg-inset)',
        border: '0.5px solid var(--border)',
        color: disabled ? 'var(--text-tertiary)' : 'var(--text-primary)',
        borderRadius: 6,
        padding: '8px 10px',
        fontSize: 13,
        outline: 'none',
      }}
    />
  );
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-primary)',
  borderRadius: 6,
  padding: '8px 10px',
  fontSize: 13,
  outline: 'none',
};

// ─── localStorage draft persistence ────────────────────────────────
// The seller's payout-block is severe enough that losing 20 fields of
// typed input to a tab-close / AVS-failure-trap was a real risk. We
// save the entire form on every change (cheap on localStorage) and
// restore on next mount. Cleared only on successful submit.
//
// Saved on device only — never sent over the network beyond the
// normal submit. Banking digits get persisted; the user typed them
// in for the modal anyway, so the marginal device-local risk is
// outweighed by avoiding the data-loss trap.

interface ProfileDraft {
  firstName: string;
  lastName: string;
  username: string;
  phone: string;
  addr: ManualAddressValue;
  lat: number | null;
  lng: number | null;
  idNumber: string;
  bankName: string;
  bankAccountHolder: string;
  bankAccountNumber: string;
  bankBranchCode: string;
  bankAccountType: 'cheque' | 'savings' | 'transmission';
}

function loadDraft(key: string): ProfileDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProfileDraft;
    return parsed;
  } catch {
    return null;
  }
}

function saveDraft(key: string, draft: ProfileDraft): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Quota / private mode — silently ignore. Worst case is no
    // persistence, which is the pre-fix behaviour.
  }
}

function clearDraft(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(key);
  } catch {
    // Same as above.
  }
}
