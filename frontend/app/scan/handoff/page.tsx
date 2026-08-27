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

type Phase = 'ready' | 'sending' | 'sent' | 'error' | 'done';

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
  /**
   * The files a failed batch never got to.
   *
   * ⚠️ WITHOUT THIS, ONE FAILURE DISCARDS THE REST. Uploads run in sequence and
   * the first failure returned out of the loop while the list was a local
   * const — so a member who got three of five up was told only "That did not go
   * through", with the other two gone and "Try again" reopening an empty
   * camera. The honest response to that screen is to re-photograph all five and
   * duplicate the three that landed.
   */
  const [pending, setPending] = useState<File[]>([]);
  /** How many of the batch that just failed did make it. */
  const [batchOk, setBatchOk] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);

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
            // ⚠️ THE ONE STATUS WE MUST NOT PASS THROUGH. An expired or
            // already-finished link answers 401, and the server's body says
            // "Unauthorized" — a word that tells a member holding a phone
            // nothing at all, and sounds like they have done something wrong.
            // It is the single likeliest failure on this screen: the link is on
            // a fifteen-minute clock and the member walked off to find a folder.
            if (res.status === 401 || res.status === 403) {
              throw new Error(
                'This link has expired. Scan the code on your computer screen again to get a fresh one — nothing you already sent is lost.',
              );
            }
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
          setErr(
            (e instanceof Error && e.message) || 'That upload did not go through.',
          );
          // Keep what has not been tried yet, so "Send the rest" is a real
          // option and nobody has to re-photograph what already landed.
          setPending(toSend.slice(ok));
          setBatchOk(ok);
          setBatchTotal(toSend.length);
          setPhase('error');
          setSent((n) => n + ok);
          return;
        }
      }
      setPending([]);
      setBatchOk(0);
      setBatchTotal(0);
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
    setPhase('done');
  }, [token]);

  if (!token) {
    return (
      <Shell>
        <h1 style={h1}>That link is incomplete</h1>
        <p style={p}>Scan the code on your computer screen again.</p>
      </Shell>
    );
  }

  // ⚠️ undefined, NOT 'any', when the hand-off did not name a kind.
  //
  // DocumentScanner derives `picked` from `initialShape !== undefined`, so any
  // concrete shape here arrives on the phone with that row already ticked and
  // ringed in red. Passing 'any' therefore launders "the computer did not say"
  // into "the member said: Something else" — and Something else carries the
  // weakest aim prior we have, on the one screen where the member cannot see
  // what the desktop knew.
  //
  // Two live callers reach this page with no kind: the motivation pack's
  // "Photograph documents" button and the Document Centre's "Work it out for
  // me". Both mean "I don't know yet", which is a question, not an answer.
  const shape: DocShape | undefined = kind ? shapeForKind(kind) : undefined;

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
          // ⚠️ THE PHONE ARRIVES WITH NO CONTEXT AT ALL. A member points a
          // camera at a QR code on a screen and lands on a full-screen
          // viewfinder — with nothing saying which of the documents on the desk
          // it wants, or where the photograph is about to go. Both halves
          // matter: the first so they photograph the right thing, the second
          // because this page deliberately does not ask them to sign in, and a
          // page that asks for your ID without saying where it goes is a page
          // that should worry you.
          //
          // Still nothing about WHO. A QR code on a screen can be photographed
          // by anyone in the room — see this file's header.
          subtitle={
            dest === 'kyc'
              ? 'It goes straight to your verification at your computer.'
              : dest === 'motivation'
                ? 'They go straight to your motivation at your computer.'
                : 'It goes straight to your documents at your computer.'
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
              <h1 style={h1}>
                {batchOk > 0
                  ? `${batchOk} of ${batchTotal} sent`
                  : 'That did not go through'}
              </h1>
              <p style={p}>{err}</p>
              {/* ⚠️ THE REST, NOT THE LOT. Reopening the camera here means
                  re-photographing everything, including what already landed —
                  which is how a five-document pack becomes eight. */}
              {pending.length > 0 && (
                <button
                  type="button"
                  style={btn}
                  onClick={() => void upload(pending)}
                >
                  Send the {pending.length === 1 ? 'last one' : `other ${pending.length}`}
                </button>
              )}
              <button
                type="button"
                style={
                  pending.length > 0
                    ? { ...btn, background: 'var(--bg-inset)', color: 'var(--text-secondary)', border: '0.5px solid var(--border)' }
                    : btn
                }
                onClick={() => setOpen(true)}
              >
                {batchOk > 0 ? 'Scan another' : 'Try again'}
              </button>
              {sent > 0 && (
                <button
                  type="button"
                  style={{
                    ...btn,
                    background: 'var(--bg-inset)',
                    color: 'var(--text-secondary)',
                    border: '0.5px solid var(--border)',
                  }}
                  onClick={() => void finish()}
                >
                  I am finished
                </button>
              )}
            </>
          )}

          {/* ⚠️ "I AM FINISHED" USED TO LAND BACK ON THE SAME SCREEN.
              It consumed the token — the one irreversible act on this page —
              and then rendered the ready/sent screen again, still offering
              "Scan another" against a link that no longer works. The next tap
              produced a raw 401. A finished session now says so and stops
              offering the camera. */}
          {phase === 'done' && (
            <>
              <h1 style={h1}>All done</h1>
              <p style={p}>
                {sent === 1
                  ? 'Your document is on your computer.'
                  : `Your ${sent} documents are on your computer.`}{' '}
                You can put the phone down and carry on at the desk — this link
                is now closed.
              </p>
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
      // ⚠️ EVERY SCREEN ON THIS PAGE IS A STATE CHANGE, AND ALL OF THEM WERE
      // SILENT. Sending, sent, failed and finished all swap the heading and the
      // body in place with no navigation and no announcement — so a member
      // using a screen reader pressed "Open the camera", uploaded, and was told
      // nothing at all about whether it had worked. One region around the whole
      // shell, because exactly one of these screens is on at a time.
      aria-live="polite"
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
