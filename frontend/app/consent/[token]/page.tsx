'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import WitnessSignaturePad from '@/components/witness-signature-pad';
import { reverseGeocodeArea } from '@/lib/reverse-geocode-area';

// ────────────────────────────────────────────────────────────────────
// THE PREVIOUS OWNER'S CONSENT.
//
// Opened from an SMS by somebody who is not a member, has no account, and is
// doing the buyer a favour. Every decision on this page follows from that:
// no sign-in, no jargon, nothing asked twice, and no dead end that a person
// with nobody to phone could get stuck in.
//
// ⚠️ THE ORDER IS PHOTOGRAPHS FIRST. Operator, 2026-08-23: "i think the seller
// must first take the pictures of the front and back of the license." It reads
// as a UX preference and it is also what makes the form fast — the front's OCR
// runs WHILE the back is being photographed, so the fields are already filled
// in by the time anybody is asked to type.
//
// ⚠️ AND NOTHING BLOCKS ON THE READ. If Google is slow, the form opens empty
// with a quiet note and fills in when the answer lands. If it fails, they type
// what the card says — which is what they would have done anyway. A consent
// flow that stalls because an OCR call is pending is a stranger stuck on a
// form they cannot finish.
// ────────────────────────────────────────────────────────────────────

const LicenceCardCapture = dynamic(
  () => import('@/components/consent/licence-card-capture'),
  { ssr: false },
);

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface OpenState {
  status: string;
  invitedName: string;
  phoneHint: string;
  declined: boolean;
  applicantName: string | null;
  firearm: { label: string; value: string }[];
}

/** Read a File as a data URL — what both the OCR route and submit expect. */
function toDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error('read failed'));
    r.readAsDataURL(file);
  });
}

export default function SellerConsentPage() {
  const token = String(useParams()?.token ?? '');

  const [state, setState] = useState<OpenState | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [capturing, setCapturing] = useState(false);
  const [front, setFront] = useState<string | null>(null);
  const [back, setBack] = useState<string | null>(null);
  // ⚠️ THE FIREARM AS READ OFF THE CARD — THE SOURCE OF TRUTH. The invite
  // carried whatever the buyer typed; the government card is what SAPS holds,
  // so the OCR of it becomes what the consent declares. The seller checks it
  // and corrects any misread before signing.
  const [cardFields, setCardFields] = useState<Record<string, string>>({});

  /** Whether the OCR is still out. Never gates anything — only informs. */
  const [reading, setReading] = useState(false);
  const readingRan = useRef(false);

  const [fullName, setFullName] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [place, setPlace] = useState('');
  const [locating, setLocating] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'signed' | 'declined' | null>(null);

  // ── Load ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`${API}/seller-consent/${token}`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setFatal(
            (j as { message?: string })?.message ??
              'This link is not valid or has expired.',
          );
          return;
        }
        const j = (await res.json()) as OpenState;
        setState(j);
        if (j.status === 'COMPLETED') setDone('signed');
        else if (j.declined) setDone('declined');
      } catch {
        setFatal('We could not open this link. Check your signal and retry.');
      }
    })();
  }, [token]);

  // ── The front, read in the background ─────────────────────────────
  const onSide = useCallback(
    (side: 'front' | 'back', file: File) => {
      void (async () => {
        const dataUrl = await toDataUrl(file).catch(() => null);
        if (!dataUrl) return;
        if (side === 'back') {
          setBack(dataUrl);
          return;
        }
        setFront(dataUrl);
        // ⚠️ ONE READ PER SESSION. Retaking the front should not spend another
        // Vision call — the seller can correct any field by hand, and the
        // second read would overwrite corrections they had already made.
        if (readingRan.current) return;
        readingRan.current = true;
        setReading(true);
        try {
          const res = await fetch(`${API}/seller-consent/${token}/read-front`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: dataUrl }),
          });
          if (!res.ok) return;
          const j = (await res.json()) as {
            ok: boolean;
            fields: Record<string, string> | null;
            holderIdNumber: string | null;
            holderNameOnCard: string | null;
          };
          // ⚠️ ONLY FILLS WHAT IS STILL EMPTY. If the seller has already typed
          // something while the call was out, their typing wins — a field that
          // rewrites itself under somebody's cursor is the bug this whole
          // codebase has a rule about.
          if (j.holderIdNumber) {
            setIdNumber((cur) => (cur.trim() ? cur : j.holderIdNumber!));
          }
          // The firearm read off the card. Set once (read runs once per
          // session), so a retake never wipes corrections the seller made.
          if (j.fields && Object.keys(j.fields).length) {
            setCardFields((cur) => (Object.keys(cur).length ? cur : j.fields!));
          }
          // ⚠️ NAME IS DELIBERATELY NOT PREFILLED FROM THE CARD — it carries
          // initials only (GJP FOURIE), and the full-names field needs the
          // whole name. Prefilling initials would look filled but be wrong.
        } catch {
          /* fail-soft: they type it */
        } finally {
          setReading(false);
        }
      })();
    },
    [token],
  );

  const useMyLocation = async () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Location is not available on this device — please type it in.');
      return;
    }
    setLocating(true);
    setError(null);
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, {
          enableHighAccuracy: false,
          timeout: 10_000,
          maximumAge: 60_000,
        }),
      );
      // The town, never the coordinates — same rule as the witness statement.
      const area = await reverseGeocodeArea(
        pos.coords.latitude,
        pos.coords.longitude,
      );
      if (area) setPlace(area);
      else setError('We could not name that place — please type it in.');
    } catch {
      setError('We could not read your location — please type it in.');
    } finally {
      setLocating(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/seller-consent/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          idNumber,
          // What the consent will declare the firearm to be — the card, as the
          // seller confirmed it.
          firearm: cardFields,
          signature,
          front,
          back,
          place,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(
          (j as { message?: string })?.message ??
            'That did not go through. Please try again.',
        );
        return;
      }
      setDone('signed');
    } catch {
      setError('That did not go through. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    setBusy(true);
    try {
      await fetch(`${API}/seller-consent/${token}/decline`, { method: 'POST' });
      setDone('declined');
    } catch {
      setError('That did not go through. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // ── Screens ───────────────────────────────────────────────────────
  if (fatal) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold">This link cannot be opened</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{fatal}</p>
        <p className="mt-4 text-sm text-[var(--text-secondary)]">
          Links last 48 hours. Ask the buyer to send you a new one.
        </p>
      </Shell>
    );
  }

  if (done === 'signed') {
    return (
      <Shell>
        <h1 className="text-lg font-semibold">Thank you — that is done</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Your consent has been recorded and sent to the buyer for their
          application. You do not need to do anything else.
        </p>
      </Shell>
    );
  }

  if (done === 'declined') {
    return (
      <Shell>
        <h1 className="text-lg font-semibold">You have declined</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Nothing has been recorded against you, and the buyer has been told
          they will need to sort this out with you directly.
        </p>
      </Shell>
    );
  }

  if (!state) {
    return (
      <Shell>
        <p className="text-sm text-[var(--text-secondary)]">Opening…</p>
      </Shell>
    );
  }

  const photographed = !!front && !!back;
  const ready =
    photographed &&
    fullName.trim().length >= 3 &&
    /^\d{13}$/.test(idNumber.replace(/\s/g, '')) &&
    !!signature;

  return (
    <Shell>
      <h1 className="text-lg font-semibold">
        {state.applicantName ?? 'A buyer'} needs your consent
      </h1>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        They are applying for a licence for the firearm below, and SAPS needs
        the current owner to agree in writing. This takes about two minutes.
      </p>

      {/* What they are consenting to, before anything is asked of them. */}
      {state.firearm.length > 0 && (
        <dl className="mt-4 rounded-[var(--radius)] border border-[var(--border)] p-3 text-sm">
          {state.firearm.map((r) => (
            <div key={r.label} className="flex justify-between gap-3 py-0.5">
              <dt className="text-[var(--text-secondary)]">{r.label}</dt>
              <dd className="text-right font-medium">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* ── 1. The photographs ─────────────────────────────────────── */}
      <h2 className="mt-6 text-sm font-semibold">1. Photograph your licence</h2>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        Both sides of the licence card for this firearm.
      </p>
      <button
        type="button"
        onClick={() => setCapturing(true)}
        className="mt-2 w-full rounded-[var(--radius)] bg-[var(--red)] px-4 py-3 text-sm font-semibold text-white"
      >
        {photographed ? 'Retake the photographs' : 'Open the camera'}
      </button>
      {photographed && (
        <p className="mt-2 text-xs text-[var(--success)]">
          Both sides captured.
        </p>
      )}

      {/* ── The firearm, read off the card ─────────────────────────────
          ⚠️ THIS IS WHAT THE CONSENT WILL SAY, and it comes from the card, not
          from what the buyer typed. The seller checks it against the card in
          their hand and fixes any misread — they are the owner, so they are the
          right person to catch an OCR slip on a document they sign. */}
      {Object.keys(cardFields).length > 0 && (
        <div className="mt-4 rounded-[var(--radius)] border border-[var(--border)] p-3">
          <p className="text-sm font-semibold">Check the firearm details</p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            We read these from your card. They are what the consent will state,
            so please correct anything we got wrong.
          </p>
          {(
            [
              ['make', 'Make'],
              ['model', 'Model'],
              ['type', 'Type'],
              ['calibre', 'Calibre'],
              ['serial', 'Serial number'],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="mt-2 block text-xs text-[var(--text-secondary)]"
            >
              {label}
              <input
                value={cardFields[key] ?? ''}
                onChange={(e) =>
                  setCardFields((cur) => ({ ...cur, [key]: e.target.value }))
                }
                className="mt-1 w-full rounded-[var(--radius)] border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text-primary)]"
              />
            </label>
          ))}
        </div>
      )}

      {/* ── 2. Their details ───────────────────────────────────────── */}
      <h2 className="mt-6 text-sm font-semibold">2. Your details</h2>
      {reading && (
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          Still reading your licence — you can start typing, we will not
          overwrite anything you have entered.
        </p>
      )}
      <label className="mt-2 block text-xs text-[var(--text-secondary)]">
        Your full names
        {/* The card carries initials only, so this genuinely has to be typed. */}
        <input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="As they appear on your identity document"
          className="mt-1 w-full rounded-[var(--radius)] border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text-primary)]"
        />
      </label>
      <label className="mt-3 block text-xs text-[var(--text-secondary)]">
        Your identity number
        <input
          value={idNumber}
          onChange={(e) => setIdNumber(e.target.value)}
          inputMode="numeric"
          placeholder="13 digits"
          className="mt-1 w-full rounded-[var(--radius)] border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text-primary)]"
        />
      </label>

      {/* ── 3. Where and the signature ─────────────────────────────── */}
      <h2 className="mt-6 text-sm font-semibold">3. Sign</h2>
      <label className="mt-2 block text-xs text-[var(--text-secondary)]">
        Where you are signing
        <input
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          placeholder="Town or city"
          className="mt-1 w-full rounded-[var(--radius)] border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text-primary)]"
        />
      </label>
      <button
        type="button"
        onClick={useMyLocation}
        disabled={locating}
        className="mt-2 text-xs underline text-[var(--text-secondary)]"
      >
        {locating ? 'Finding you…' : 'Use my location'}
      </button>

      <div className="mt-3">
        <WitnessSignaturePad onChange={setSignature} />
      </div>

      {error && <p className="mt-3 text-sm text-[var(--red)]">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={!ready || busy}
        className="mt-5 w-full rounded-[var(--radius)] bg-[var(--red)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? 'Sending…' : 'Give my consent'}
      </button>
      {!ready && (
        <p className="mt-2 text-xs text-[var(--text-secondary)]">
          {!photographed
            ? 'Photograph both sides of your licence to continue.'
            : 'Fill in your names and identity number, and sign above.'}
        </p>
      )}

      {/* ⚠️ DECLINING IS A REAL OPTION, PLAINLY OFFERED. Nobody is obliged to
          consent to a transfer, and a page that only has a yes turns a person
          who wants to say no into somebody who abandons the tab — leaving the
          buyer watching a link that never moves. */}
      <button
        type="button"
        onClick={decline}
        disabled={busy}
        className="mt-4 w-full text-xs underline text-[var(--text-tertiary)]"
      >
        I do not consent to this
      </button>

      {capturing && (
        <LicenceCardCapture
          onSide={onSide}
          onDone={() => setCapturing(false)}
          onClose={() => setCapturing(false)}
        />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-8">{children}</main>
  );
}
