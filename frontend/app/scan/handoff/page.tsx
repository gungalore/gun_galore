'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { DocShape, shapeForKind } from '@/lib/scan/shapes';

// ────────────────────────────────────────────────────────────────────
// THE PHONE'S HALF OF THE HANDOFF.
//
// Reached by pointing a phone camera at a QR code on a desktop screen. The
// member is NOT signed in here and is not asked to be — being asked to log in
// on a phone before you can photograph a card is the exact friction this
// exists to remove. The `?t=` token is the credential, and it authorises
// uploads into the same vault the desktop was going to write to.
//
// ⚠️ IT SAYS NOTHING ABOUT WHO THE MEMBER IS. A QR code on a screen can be
// photographed by anyone in the room, so this page shows what is being
// collected and nothing about whose it is.
// ────────────────────────────────────────────────────────────────────

const DocumentScanner = dynamic(
  () => import('@/components/scan/document-scanner'),
  { ssr: false },
);

// Same fallback every other caller uses — see the note in
// components/scan/phone-handoff-dialog.tsx.
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

type Phase = 'ready' | 'sending' | 'sent' | 'error';

export default function ScanHandoffPage() {
  const params = useSearchParams();
  const token = params.get('t') ?? '';
  const dest = params.get('dest') ?? '';
  const motivationId = params.get('m') ?? '';
  const kind = params.get('kind') ?? '';

  const [open, setOpen] = useState(true);
  const [phase, setPhase] = useState<Phase>('ready');
  const [sent, setSent] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  /** Said out loud when a KYC session photographed more than the one ID. */
  const [trimmed, setTrimmed] = useState(false);

  // Identity verification takes ONE document — the photo side of the card or
  // the photograph page of the book — and the upload REPLACES whatever was
  // there rather than adding to it. A vault session is the opposite: somebody
  // stands at the desk with a whole pack. So the two branch here, and only
  // here.
  const single = dest === 'kyc';

  // Tell the desktop its code was scanned. It is watching for exactly this,
  // and it fires while the member is still holding the phone up — so it must
  // not consume the token, only stamp it.
  useEffect(() => {
    if (!token) return;
    void fetch(`${API}/actions/${encodeURIComponent(token)}/scan-handoff/open`, {
      method: 'POST',
    }).catch(() => undefined);
  }, [token]);

  const upload = useCallback(
    async (files: File[]) => {
      if (!token || files.length === 0) return;
      setPhase('sending');
      setErr(null);
      // ⚠️ THE FIRST ONE, NOT THE LAST. Posting a second ID document would
      // overwrite the first, so a member who ticked "more than one" and
      // photographed both sides of their card would silently end up with the
      // back of it on their identity record. The step asks for the photo side;
      // that is the one they take first, and the screen says what happened.
      const toSend = single ? files.slice(0, 1) : files;
      setTrimmed(single && files.length > 1);
      let ok = 0;
      for (const file of toSend) {
        const body = new FormData();
        body.append('file', file);
        // ⚠️ THE KIND RIDES ON EVERY FILE. It is only meaningful for a single
        // document — a member who scanned three things in one session cannot
        // have them all be the same kind, and the server's own classifier is
        // better than a stale guess. So it is sent only when there is exactly
        // one file, which is the same rule both desktop surfaces use.
        if (kind && toSend.length === 1) body.append('kind', kind);

        const url =
          dest === 'kyc'
            ? // The identity document. Same service the desk route calls, same
              // refusals, same encrypted store — only the way the member proved
              // who they are is different.
              `${API}/kyc/scan?t=${encodeURIComponent(token)}`
            : dest === 'motivation' && motivationId
              ? `${API}/motivations/${encodeURIComponent(motivationId)}/scan-uploads?t=${encodeURIComponent(token)}`
              : `${API}/licence-centre/scan?t=${encodeURIComponent(token)}`;
        try {
          // ⚠️ RAW fetch, NOT apiFetch. The shared helper forces
          // Content-Type: application/json, which strips the multipart
          // boundary and produces a 400 nobody can read.
          const res = await fetch(url, { method: 'POST', body });
          if (!res.ok) {
            const text = await res.text().catch(() => '');
            let msg = 'That upload did not go through.';
            try {
              const parsed = JSON.parse(text) as { message?: string };
              if (parsed.message) msg = parsed.message;
            } catch {
              // A non-JSON body is a proxy error page; the generic line is
              // more use than its HTML.
            }
            throw new Error(msg);
          }
          ok += 1;
        } catch (e) {
          setErr((e as Error).message);
          setPhase('error');
          setSent((n) => n + ok);
          return;
        }
      }
      setSent((n) => n + ok);
      setPhase('sent');
    },
    [token, dest, motivationId, kind, single],
  );

  const finish = useCallback(async () => {
    if (!token) return;
    // The only path that consumes the token. Deliberate press only — never an
    // unload handler, or a phone locking its screen mid-session would kill
    // the rest of the pack.
    await fetch(`${API}/actions/${encodeURIComponent(token)}/scan-handoff/done`, {
      method: 'POST',
    }).catch(() => undefined);
    setOpen(false);
    setPhase('sent');
  }, [token]);

  if (!token) {
    return (
      <Shell>
        <h1 style={h1}>That link is incomplete</h1>
        <p style={p}>Scan the code on your computer screen again.</p>
      </Shell>
    );
  }

  const shape: DocShape = kind ? shapeForKind(kind) : 'any';

  return (
    <>
      {open && (
        <DocumentScanner
          shape={shape}
          // Not for the ID: the step wants one photograph, and starting with
          // "more than one" already ticked would be inviting a pack.
          multiDefault={!single}
          title={
            dest === 'kyc'
              ? 'Photograph your ID'
              : dest === 'motivation'
                ? 'Photograph your documents'
                : 'Photograph the document'
          }
          onDone={(files) => void upload(files)}
          onClose={() => setOpen(false)}
        />
      )}

      {!open && (
        <Shell>
          {phase === 'sending' && (
            <>
              <h1 style={h1}>Sending…</h1>
              <p style={p}>Keep this page open until it finishes.</p>
            </>
          )}
          {phase === 'error' && (
            <>
              <h1 style={h1}>That did not go through</h1>
              <p style={p}>{err}</p>
              <button type="button" style={btn} onClick={() => setOpen(true)}>
                Try again
              </button>
            </>
          )}
          {(phase === 'sent' || phase === 'ready') && (
            <>
              <h1 style={h1}>
                {sent === 0
                  ? 'Nothing sent yet'
                  : // A count is right for a pack and wrong for an ID: only one
                    // ever lands, and a second attempt replaced the first rather
                    // than adding to it, so "2 documents sent" would be untrue.
                    single
                    ? 'Your ID is sent'
                    : `${sent} ${sent === 1 ? 'document' : 'documents'} sent`}
              </h1>
              <p style={p}>
                {sent === 0
                  ? single
                    ? 'Open the camera to photograph your ID.'
                    : 'Open the camera to photograph a document.'
                  : single
                    ? 'Carry on at your computer — it has moved on to the next step. Take it again here if the photo was poor.'
                    : 'They are on your computer screen now. You can scan more, or say you are done.'}
              </p>
              {trimmed && (
                <p style={{ ...p, color: 'var(--red)' }}>
                  Only the first photo was sent. Identity verification takes one
                  ID document — the side with your photograph on it.
                </p>
              )}
              <button type="button" style={btn} onClick={() => setOpen(true)}>
                {sent > 0
                  ? single
                    ? 'Take it again'
                    : 'Scan another'
                  : 'Open the camera'}
              </button>
              {sent > 0 && (
                <button
                  type="button"
                  style={{ ...btn, background: 'transparent', border: '1px solid rgba(255,255,255,0.3)' }}
                  onClick={() => void finish()}
                >
                  I am finished
                </button>
              )}
            </>
          )}
        </Shell>
      )}
    </>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: '24px 20px max(24px, env(safe-area-inset-bottom))',
        textAlign: 'center',
      }}
    >
      {children}
    </main>
  );
}

const h1: React.CSSProperties = { margin: 0, fontSize: 22 };
const p: React.CSSProperties = {
  margin: 0,
  fontSize: 15,
  color: 'var(--text-secondary)',
  maxWidth: 380,
};
const btn: React.CSSProperties = {
  minHeight: 48,
  padding: '0 20px',
  marginTop: 8,
  borderRadius: 10,
  border: 'none',
  background: 'var(--red)',
  color: '#fff',
  fontSize: 16,
};
