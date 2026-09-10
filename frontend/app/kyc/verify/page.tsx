'use client';

/**
 * Seller identity verification.
 *
 * ONE flow, where there used to be two. The member gives POPIA consent, types
 * their SA ID number and date of birth, and is then handed to Didit's hosted
 * page, which captures the document, runs a passive liveness check and matches
 * the two faces. The verdict comes back to us by webhook, so this screen polls
 * `GET /kyc/status` rather than waiting on a long POST.
 *
 * ⚠️ THE DOCUMENT AND SELFIE STEPS ARE GONE, NOT MISLAID, and roughly 1,700
 * lines went with them: the camera, the crop, the AWS Face Liveness overlay,
 * the RETAKE loop and the two upload doors. We never receive those images now.
 * Do not rebuild any of it here — a second capture path would be a second
 * place for identity photographs to live.
 *
 * ⚠️ THREE SURFACES, THREE DIFFERENT HAND-OFFS, and getting any of them wrong
 * strands the member on a screen that looks fine:
 *
 *   DESKTOP — Didit's free-tier workflow REFUSES to run here
 *     (`is_desktop_allowed: false`), because a laptop webcam cannot resolve a
 *     document; the scanner reached the same conclusion independently. So the
 *     QR and the SMS are the PRIMARY action, not a fallback, and there is
 *     deliberately no "open here" button — it would lead to a page that turns
 *     them away.
 *
 *   MOBILE BROWSER — navigate in the same tab. The member comes back on
 *     Didit's callback.
 *
 *   INSTALLED PWA — ⚠️ NEVER `location.href` TO AN EXTERNAL ORIGIN. A
 *     standalone window has no address bar and no back button, so navigating
 *     away either strands the member in a chromeless view of somebody else's
 *     site or drops them out of the app entirely; the callback then lands in a
 *     browser tab rather than back in the app. Open a separate tab instead and
 *     leave the app where it is — the poll below is what notices the verdict,
 *     which is why it must keep running while they are away.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { useStandalone } from '@/lib/use-standalone';
import { StepRail, type StepRailStep } from '@/components/step-rail';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

/** Mirrors `nextStep` from GET /kyc/status. */
type NextStep =
  | 'consent'
  | 'details'
  | 'verify'
  | 'waiting'
  | 'review'
  | 'done'
  | 'failed';

interface KycStatus {
  kycStatus: string;
  kycAttempts: number;
  nextStep: NextStep;
  steps: { consent: boolean; details: boolean; verification: boolean };
  session: { id: string; status: string } | null;
  phoneMasked: string | null;
}

/** While the member is away on Didit, ask this often. */
const POLL_MS = 5000;

const card: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '0.5px solid var(--border)',
  borderRadius: 8,
};
const field: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 6,
  border: '0.5px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text-primary)',
  fontSize: 15,
};
const primary: React.CSSProperties = {
  width: '100%',
  padding: '11px 14px',
  borderRadius: 6,
  background: 'var(--red)',
  color: '#fff',
  border: 'none',
  fontSize: 15,
};

export default function KycVerifyPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { getToken, isLoaded, isSignedIn } = useAuth();
  // ⚠️ SSR-SAFE, AND THAT MATTERS HERE. Both render false on the server and
  // settle on the client, so nothing branches on them during the first paint —
  // a hand-off that flickered between "scan this" and "continue" would look
  // broken on exactly the surface it is meant to serve.
  const standalone = useStandalone();
  const [handheld, setHandheld] = useState(false);
  useEffect(() => setHandheld(isHandheld()), []);

  // The SMS / QR hand-off authorises with ?t=<token> instead of a session —
  // the whole point is that the phone is not signed in.
  const actionToken = params.get('t');
  const returnTo = params.get('returnTo');

  const [status, setStatus] = useState<KycStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [consented, setConsented] = useState(false);
  const [idNumber, setIdNumber] = useState('');
  const [dob, setDob] = useState('');
  const [hostedUrl, setHostedUrl] = useState<string | null>(null);
  const [smsSent, setSmsSent] = useState(false);
  const [smsCooldown, setSmsCooldown] = useState(0);

  const authHeaders = useCallback(async () => {
    const headers: Record<string, string> = {};
    if (!actionToken) {
      const token = await getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }, [actionToken, getToken]);

  const url = useCallback(
    (path: string) =>
      actionToken
        ? `${API_URL}/kyc/${path}?t=${encodeURIComponent(actionToken)}`
        : `${API_URL}/kyc/${path}`,
    [actionToken],
  );

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(url('status'), {
        credentials: 'include',
        cache: 'no-store',
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error('status');
      setStatus((await res.json()) as KycStatus);
    } catch {
      setError('We could not load your verification. Please refresh.');
    }
  }, [url, authHeaders]);

  useEffect(() => {
    if (!actionToken && (!isLoaded || !isSignedIn)) return;
    void refresh();
  }, [actionToken, isLoaded, isSignedIn, refresh]);

  // ⚠️ POLL ONLY WHILE SOMETHING IS ACTUALLY IN FLIGHT. The verdict arrives by
  // webhook; this is the reconciliation for a member sitting on the page when
  // it lands, and for the one whose webhook was dropped. Polling a settled
  // status forever is a request every five seconds for nothing.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const inFlight = status?.nextStep === 'waiting';
    if (!inFlight) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    pollRef.current = setInterval(() => void refresh(), POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [status?.nextStep, refresh]);

  useEffect(() => {
    if (smsCooldown <= 0) return;
    const t = setTimeout(() => setSmsCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [smsCooldown]);

  // Success bounces back where they came from, after a beat to read it.
  useEffect(() => {
    if (status?.nextStep !== 'done' || !returnTo) return;
    const t = setTimeout(() => router.push(returnTo), 3000);
    return () => clearTimeout(t);
  }, [status?.nextStep, returnTo, router]);

  async function post(path: string, body?: object) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url(path), {
        method: 'POST',
        credentials: 'include',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string | string[];
        url?: string;
      };
      if (!res.ok) {
        setError(
          Array.isArray(data.message)
            ? data.message[0]
            : (data.message ?? 'Something went wrong. Please try again.'),
        );
        return null;
      }
      return data;
    } catch {
      setError('We could not reach the server. Check your connection.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function submitConsent() {
    if (!consented) return;
    if (await post('consent')) await refresh();
  }

  async function submitDetails() {
    if (await post('details', { idNumber: idNumber.trim(), dob })) {
      await refresh();
    }
  }

  async function startVerification() {
    const data = await post('session');
    if (!data?.url) return;
    setHostedUrl(data.url);
    await refresh();
    if (isHandheld()) openHosted(data.url, standalone);
  }

  async function sendHandoffSms() {
    if (smsCooldown > 0) return;
    setSmsCooldown(60);
    if (await post('handoff-sms')) setSmsSent(true);
  }

  const step = status?.nextStep ?? 'consent';

  const rail: StepRailStep[] = [
    { label: 'Consent', complete: !!status?.steps.consent },
    { label: 'Your details', complete: !!status?.steps.details },
    { label: 'Verify', complete: step === 'done' },
  ];
  // ⚠️ StepRail's `current` is ONE-BASED — it reads steps[current - 1] to draw
  // the mobile row. A zero here makes that undefined and the whole rail
  // silently renders nothing on a phone, which is the surface it matters on.
  const railIndex = step === 'consent' ? 1 : step === 'details' ? 2 : 3;

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-8">
      <h1 className="text-xl mb-1" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
        Verify your identity
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
        Sellers verify once. It takes a couple of minutes and needs your ID
        document and your phone.
      </p>

      <StepRail steps={rail} current={railIndex} />

      {error && (
        <div
          role="alert"
          className="text-sm p-3 rounded-[6px] my-4"
          style={{ background: 'var(--red-wash)', color: 'var(--red)' }}
        >
          {error}
        </div>
      )}

      {!status && !error && (
        <p className="text-sm mt-6" style={{ color: 'var(--text-tertiary)' }}>
          Loading…
        </p>
      )}

      {/* ── Consent ─────────────────────────────────────────────────── */}
      {status && step === 'consent' && (
        <section style={card} className="p-4 mt-6">
          <label className="flex gap-3 items-start text-sm" style={{ color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            {/*
              POPIA s72(1)(b) — consent to a cross-border transfer is only valid
              if it is INFORMED, which means naming the actual destination.

              🚨 THIS TEXT IS PART OF THE VERIFICATION PIPELINE, NOT DECORATION.
              It has named the United States (Anthropic) and then AWS Ireland,
              and each time the processor moved this sentence had to move with
              it. It now names Didit, because that is who receives the document
              and the face. A cut-over that moves the data without moving this
              collects consent for a transfer that no longer happens and none
              for the one that does.

              ⚠️ IT NO LONGER CLAIMS AN OFFICIAL-RECORDS CHECK. The previous
              processor checked the ID number against Home Affairs; nothing in
              the current flow does, so saying so would be false.
            */}
            <span>
              I consent to All Outdoor verifying my identity using my SA ID
              number, date of birth, ID document and a live selfie. My ID
              document and selfie are captured and checked by Didit, our
              identity-verification provider, which reads the document, checks
              that the selfie is of a live person and compares the two faces.
              The result is reviewed by our staff where needed — all in
              accordance with POPIA and the{' '}
              <a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--red)' }}
              >
                Privacy Policy
              </a>
              .
            </span>
          </label>
          <button
            type="button"
            onClick={submitConsent}
            disabled={!consented || busy}
            style={{ ...primary, marginTop: 16, opacity: !consented || busy ? 0.5 : 1 }}
          >
            {busy ? 'Saving…' : 'I agree — continue'}
          </button>
        </section>
      )}

      {/* ── Details ─────────────────────────────────────────────────── */}
      {status && step === 'details' && (
        <section style={card} className="p-4 mt-6 flex flex-col gap-3">
          <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            SA ID number
            <input
              inputMode="numeric"
              maxLength={13}
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value.replace(/\D/g, ''))}
              style={{ ...field, marginTop: 4 }}
            />
          </label>
          <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Date of birth
            <input
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              style={{ ...field, marginTop: 4 }}
            />
          </label>
          <button
            type="button"
            onClick={submitDetails}
            disabled={busy || idNumber.length !== 13 || !dob}
            style={{
              ...primary,
              opacity: busy || idNumber.length !== 13 || !dob ? 0.5 : 1,
            }}
          >
            {busy ? 'Checking…' : 'Continue'}
          </button>
        </section>
      )}

      {/* ── Hand off to Didit ───────────────────────────────────────── */}
      {status && step === 'verify' && (
        <section style={card} className="p-4 mt-6">
          <p className="text-sm mb-3" style={{ color: 'var(--text-primary)' }}>
            Now photograph your ID and take a selfie.
          </p>
          <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
            {handheld
              ? 'Have your ID document to hand. It takes about a minute.'
              : 'This part has to happen on a phone — a laptop camera cannot resolve the detail on an ID card.'}
          </p>

          {hostedUrl ? (
            <HandOff
              hostedUrl={hostedUrl}
              onSms={sendHandoffSms}
              smsSent={smsSent}
              cooldown={smsCooldown}
              phoneMasked={status.phoneMasked}
              canSms={!actionToken}
              handheld={handheld}
              standalone={standalone}
            />
          ) : (
            <button type="button" onClick={startVerification} disabled={busy} style={primary}>
              {busy ? 'Starting…' : 'Start'}
            </button>
          )}
        </section>
      )}

      {/* ── Waiting on the verdict ──────────────────────────────────── */}
      {status && step === 'waiting' && (
        <section style={card} className="p-4 mt-6">
          <p className="text-sm mb-2" style={{ color: 'var(--text-primary)' }}>
            Checking your documents…
          </p>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            This usually takes under a minute. You can leave this page — we will
            email you either way.
          </p>
          {hostedUrl && (
            <HandOff
              hostedUrl={hostedUrl}
              onSms={sendHandoffSms}
              smsSent={smsSent}
              cooldown={smsCooldown}
              phoneMasked={status.phoneMasked}
              canSms={!actionToken}
              handheld={handheld}
              standalone={standalone}
            />
          )}
        </section>
      )}

      {/* ── Outcomes ────────────────────────────────────────────────── */}
      {status && step === 'review' && (
        <section style={card} className="p-4 mt-6">
          <p className="text-sm mb-2" style={{ color: 'var(--text-primary)' }}>
            We are reviewing your verification.
          </p>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Somebody is looking at it by hand. You do not need to do anything —
            we will email you when it is done.
          </p>
        </section>
      )}

      {status && step === 'done' && (
        <section style={card} className="p-4 mt-6">
          <p className="text-sm mb-2" style={{ color: 'var(--text-primary)' }}>
            ✓ You are verified.
          </p>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {returnTo ? 'Taking you back…' : 'You can sell on All Outdoor.'}
          </p>
        </section>
      )}

      {status && step === 'failed' && (
        <section style={card} className="p-4 mt-6">
          <p className="text-sm mb-2" style={{ color: 'var(--text-primary)' }}>
            We could not verify your identity.
          </p>
          {/*
            ⚠️ DELIBERATELY GENERIC, AND IT MUST STAY THAT WAY. Naming the check
            that failed tells somebody working through a stolen document exactly
            which field to correct next time.
          */}
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Please contact support and we will help you sort it out.
          </p>
        </section>
      )}
    </main>
  );
}

/** The QR + SMS hand-off. Primary on a desktop, a convenience on a phone. */
function HandOff({
  hostedUrl,
  onSms,
  smsSent,
  cooldown,
  phoneMasked,
  canSms,
  handheld,
  standalone,
}: {
  hostedUrl: string;
  onSms: () => void;
  smsSent: boolean;
  cooldown: number;
  phoneMasked: string | null;
  canSms: boolean;
  handheld: boolean;
  standalone: boolean;
}) {
  return (
    <div className="mt-4 flex flex-col gap-3">
      {handheld && (
        <>
          <button
            type="button"
            onClick={() => openHosted(hostedUrl, standalone)}
            style={primary}
          >
            {standalone ? 'Continue in your browser' : 'Continue'}
          </button>
          {standalone && (
            // Saying so beats a member wondering why the app "left".
            <p
              className="text-xs text-center -mt-1"
              style={{ color: 'var(--text-tertiary)' }}
            >
              This opens a browser tab. Come back here when you are done — this
              screen updates on its own.
            </p>
          )}
        </>
      )}

      <div className="flex flex-col items-center gap-2 pt-2">
        <p className="text-xs text-center" style={{ color: 'var(--text-tertiary)' }}>
          {handheld
            ? 'Or scan this with another phone'
            : 'Scan this with your phone to carry on there'}
        </p>
        {/*
          A plain <img> against a QR renderer rather than a bundled library:
          this is the only QR in the app and the URL is short-lived.

          ⚠️ It is also the ONE thing on this page that needs the network to
          render. If it ever has to work offline, or api.qrserver.com has to
          come off the image allowlist, this becomes a local renderer — not a
          silently broken box.
        */}
        <img
          src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(hostedUrl)}`}
          alt="Scan to continue on your phone"
          width={180}
          height={180}
          style={{ background: '#fff', padding: 8, borderRadius: 6 }}
        />
      </div>

      {canSms && (
        <button
          type="button"
          onClick={onSms}
          disabled={cooldown > 0}
          className="text-xs py-2"
          style={{
            background: 'none',
            border: '0.5px solid var(--border)',
            borderRadius: 6,
            color: cooldown > 0 ? 'var(--text-faint)' : 'var(--text-secondary)',
          }}
        >
          {smsSent
            ? `Sent to ${phoneMasked ?? 'your phone'}`
            : cooldown > 0
              ? `Send me the link (${cooldown}s)`
              : 'Send me the link by SMS'}
        </button>
      )}
    </div>
  );
}

/**
 * Open Didit's hosted page.
 *
 * ⚠️ A NEW TAB FROM A STANDALONE PWA, THE SAME TAB OTHERWISE. An installed app
 * has no address bar and no back button: `location.href` to another origin
 * strands the member in a chromeless view of somebody else's site, and the
 * callback then returns them to a browser tab instead of the app they started
 * in. `window.open` keeps the app running behind it, which is also what lets
 * the status poll notice the verdict while they are away.
 */
function openHosted(hostedUrl: string, standalone: boolean) {
  if (standalone) {
    window.open(hostedUrl, '_blank', 'noopener,noreferrer');
    return;
  }
  window.location.href = hostedUrl;
}

/**
 * Is this a handheld?
 *
 * ⚠️ `pointer: coarse` AND a touch point, not a user-agent string and not a
 * width. A narrow desktop window is still a desktop, and a user-agent test is
 * the thing this codebase refuses to do anywhere else.
 */
function isHandheld(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(pointer: coarse)').matches === true &&
    navigator.maxTouchPoints > 0
  );
}
