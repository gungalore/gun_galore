'use client';

import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useViewerFetch } from '@/lib/use-viewer-fetch';

// ────────────────────────────────────────────────────────────────────
// "USE MY PHONE CAMERA."
//
// A laptop webcam points at your face, focuses at half a metre, and cannot
// resolve the serial number on a licence card. Opening it here would spend a
// permission prompt to produce a photograph nobody can read — so on a desktop
// we do not open it at all. We put a code on the screen and let the camera
// already in their hand do the work.
//
// ⚠️ IT CLOSES ITSELF. The member walks away from the keyboard with their
// phone; nobody is watching this dialog to dismiss it. It watches for the
// phone instead — first for the link being opened, then for the first
// document to land — and gets out of the way on its own.
// ────────────────────────────────────────────────────────────────────

// ⚠️ THE SAME LAYER THE SCANNER USES. At 80 the site's own header rendered
// straight through this dialog — the nav is z-50 but sits in its own stacking
// context, so the arithmetic that says 80 wins is not the arithmetic the
// browser does. 130 is the number that is already proven to cover everything.
/**
 * ⚠️ viewerFetch DOES NOT PREFIX ANYTHING. It attaches the Clerk token and
 * forces no-store, and passes the URL through verbatim — so a bare
 * `/scan-handoff` hits the Next app, gets the HTML shell back, and fails as
 * "We could not make a phone link" with nothing in the backend log, because
 * the backend never saw it. Every other caller in the codebase spells the
 * base out; so does this one.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const Z = 130;
/** Big enough to scan from a normal seat, not so big it needs the whole screen. */
const QR_PX = 260;

type State = 'waiting' | 'connected' | 'uploaded' | 'expired';

export interface PhoneHandoffDialogProps {
  dest: 'licence-centre' | 'motivation' | 'kyc';
  motivationId?: string;
  /** The document kind the desktop had selected, if any. */
  kind?: string;
  title?: string;
  onClose: () => void;
  /** Called when documents actually arrived, so the list behind can re-read. */
  onArrived: (count: number) => void;
}

export default function PhoneHandoffDialog({
  dest,
  motivationId,
  kind,
  title,
  onClose,
  onArrived,
}: PhoneHandoffDialogProps) {
  const { viewerFetch } = useViewerFetch();
  const [url, setUrl] = useState<string | null>(null);
  const [handoffId, setHandoffId] = useState<string | null>(null);
  const [state, setState] = useState<State>('waiting');
  const [added, setAdded] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  // Refs so the polling effect never re-subscribes — restarting the interval
  // on every tick would make the poll rate a function of the render count.
  const closeRef = useRef(onClose);
  const arrivedRef = useRef(onArrived);
  closeRef.current = onClose;
  arrivedRef.current = onArrived;

  // ── mint the link ────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await viewerFetch(`${API_URL}/scan-handoff`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dest, motivationId, kind, title }),
        });
        if (!res?.ok) {
          const body = (await res?.json().catch(() => null)) as
            | { message?: string }
            | null;
          throw new Error(body?.message ?? 'We could not make a phone link.');
        }
        const data = (await res.json()) as { url: string; handoffId: string };
        if (!alive) return;
        setUrl(data.url);
        setHandoffId(data.handoffId);
      } catch (e) {
        if (alive) setErr((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
    // Deliberately once: a re-mint on every prop tick would burn the
    // ten-an-hour allowance and change the QR under a phone mid-scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── watch for the phone ──────────────────────────────────────────
  useEffect(() => {
    if (!handoffId) return;
    let alive = true;
    const tick = async () => {
      // ⚠️ NOT WHILE THE TAB IS HIDDEN. The member has picked up their phone;
      // whatever this learns cannot be seen, and the API allows 60 requests a
      // minute per IP — a poll nobody is watching is budget taken from the
      // upload the phone is about to make. The visibilitychange listener
      // below catches up the moment they look back.
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await viewerFetch(`${API_URL}/scan-handoff/${handoffId}`);
        if (!res?.ok || !alive) return;
        const s = (await res.json()) as { state: State; added: number };
        if (!alive) return;
        setState(s.state);
        setAdded(s.added);
        if (s.added > 0) {
          // ⚠️ NOT INSTANTLY. The member is still standing there holding a
          // phone; a dialog that vanishes the moment the first page lands
          // looks like a crash, and they have no way to tell whether the
          // rest of the pack went anywhere. A beat to read "1 document
          // arrived" is the difference.
          arrivedRef.current(s.added);
          window.setTimeout(() => {
            if (alive) closeRef.current();
          }, 1600);
        }
      } catch {
        // A dropped poll is not worth a message — the next one is 2s away.
      }
    };
    void tick();
    // ⚠️ THREE SECONDS, NOT TWO. At 2s this alone was 30 requests a minute
    // against a 60-a-minute ceiling — half the budget, while the wizard
    // behind it polled too and the phone still had to upload through the same
    // limit. The member sees no difference; the difference is whether their
    // scan gets through.
    const id = window.setInterval(() => void tick(), 3000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoffId]);

  // Escape closes, like every other overlay in here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  // ⚠️ THE KYC WORDING IS NOT DECORATION. A count is honest for a vault, where
  // the member may still be holding three more things; identity verification
  // takes exactly one ID document and the very next thing that happens is the
  // desktop moving them on to the selfie. Telling them to "carry on scanning"
  // there would be telling them to do something with no effect.
  const heading =
    state === 'uploaded'
      ? dest === 'kyc'
        ? 'Your ID arrived'
        : `${added} ${added === 1 ? 'document' : 'documents'} arrived`
      : state === 'connected'
        ? 'Phone connected'
        : state === 'expired'
          ? 'That code has expired'
          : 'Scan this with your phone';

  const body =
    state === 'uploaded'
      ? dest === 'kyc'
        ? 'Carry on here — you can put the phone down.'
        : 'Carry on scanning on your phone, or close this.'
      : state === 'connected'
        ? 'Carry on there — what you photograph will appear here.'
        : state === 'expired'
          ? 'Close this and press the button again for a fresh one.'
          : 'Open the camera on your phone and point it at the code. No need to sign in there.';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Use your phone camera"
      data-blocking-overlay="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: Z,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: 'rgba(0,0,0,0.72)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 'min(420px, 100%)',
          borderRadius: 14,
          padding: 24,
          textAlign: 'center',
          background: 'var(--bg-surface, #14110f)',
          border: '1px solid var(--border, rgba(255,255,255,0.15))',
          color: 'var(--text-primary, #fff)',
        }}
      >
        <h2 style={{ margin: '0 0 6px', fontSize: 19 }} aria-live="polite">
          {heading}
        </h2>
        <p
          style={{
            margin: '0 0 18px',
            fontSize: 14,
            color: 'var(--text-secondary, rgba(255,255,255,0.7))',
          }}
        >
          {body}
        </p>

        {err && (
          <p role="alert" style={{ margin: '0 0 14px', color: 'var(--red)' }}>
            {err}
          </p>
        )}

        {url && state !== 'expired' && state !== 'uploaded' && (
          // ⚠️ FORCED WHITE, ALWAYS. A QR code drawn in theme tokens is a QR
          // code that stops scanning the moment somebody's OS flips to dark
          // — the reader needs light modules on a dark ground, or the
          // reverse, and it must not depend on which.
          <div
            style={{
              display: 'inline-block',
              padding: 16,
              borderRadius: 10,
              background: '#fff',
            }}
          >
            <QRCodeSVG value={url} size={QR_PX} level="M" />
          </div>
        )}

        {!url && !err && (
          <p style={{ margin: 0, opacity: 0.7 }}>Making a link…</p>
        )}

        <div style={{ marginTop: 20 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              minHeight: 44,
              padding: '0 18px',
              borderRadius: 8,
              border: '1px solid var(--border, rgba(255,255,255,0.3))',
              background: 'transparent',
              color: 'inherit',
              fontSize: 15,
            }}
          >
            {state === 'uploaded' ? 'Done' : 'Cancel'}
          </button>
        </div>

        <p
          style={{
            margin: '14px 0 0',
            fontSize: 12,
            color: 'var(--text-secondary, rgba(255,255,255,0.55))',
          }}
        >
          The code works for 15 minutes and only for your own documents.
        </p>
      </div>
    </div>
  );
}
