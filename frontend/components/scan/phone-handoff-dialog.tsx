'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useViewerFetch } from '@/lib/use-viewer-fetch';
import { diagnosticsOn, withDiagnostics } from '@/lib/scan/diag-flag';

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
  /**
   * The card, so focus can be moved into it.
   *
   * ⚠️ THIS IS THE DESKTOP-ONLY SURFACE — the one place in the whole scan flow
   * where keyboard and screen-reader members actually are — and it declared
   * role="dialog" aria-modal="true" while doing no focus work whatsoever.
   * Pressing "Use my phone camera" left focus on the button behind the scrim,
   * so the QR code, the heading and the only exit were all unreachable except
   * by tabbing blind through the page underneath.
   */
  const cardRef = useRef<HTMLDivElement>(null);
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
        // ⚠️ CARRY THE DIAGNOSTIC OPT-IN ACROSS TO THE PHONE. The scanner that
        // most needs explaining is the one on the phone, and it is opened by
        // scanning a QR code — nobody is typing a query string into it. So if
        // this desktop tab is running with ?diag=1, the link it mints gets it
        // too, and the readout is already on when the camera opens.
        //
        // Nothing else changes: without the opt-in this is `data.url`
        // untouched, so a member's hand-off is exactly what it always was.
        setUrl(withDiagnostics(data.url, diagnosticsOn(window.location.search)));
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
  /**
   * ── WHEN THIS DIALOG IS ALLOWED TO GIVE UP ────────────────────
   *
   * ⚠️ IT USED TO TREAT THE FIRST DOCUMENT AS THE END OF THE SESSION. The
   * poll fired the arrival callback the moment `added` went above zero and
   * closed itself 1600ms later — so on a six-document pack the desktop saw
   * document one, stopped watching, and the operator was shown a review
   * screen reading "We read 1". Nothing was lost; the phone had uploaded all
   * six correctly and a later list refresh brought them in. But for the
   * length of that review the site was telling a member that five of their
   * documents had not arrived.
   *
   * It only ever fired once by accident, too: the check was on the LEVEL of
   * `added` rather than on it changing, and it stayed true for the rest of
   * the session. 1600ms simply beat the 3000ms tick.
   *
   * Three things end a session now, and nothing else:
   *   1. the member pressing "I am finished" on the phone — `finished`, which
   *      the server has always known and never said out loud;
   *   2. the token expiring;
   *   3. the member closing this by hand.
   *
   * A phone that locks, or is walked away from, ends none of them —
   * deliberately. Both the phone page and the done endpoint refuse to fake
   * that signal on pagehide, because a locked screen would consume the token
   * and 410 the rest of the pack. The count stays live and the button reads
   * Done.
   */
  const reportedRef = useRef(0);
  const latestRef = useRef(0);
  const finishedAtRef = useRef<number | null>(null);

  /**
   * Tell the caller what has landed — at most once per new document.
   *
   * ⚠️ AN EDGE, NOT A LEVEL. Reporting on the level would re-fire every
   * three seconds for the rest of the session, and on the Document Centre
   * that callback rebuilds the entire review screen from a fresh read of the
   * list — under the hands of somebody who may be typing an expiry date into
   * it.
   */
  const report = useCallback((n: number) => {
    if (n <= reportedRef.current) return;
    reportedRef.current = n;
    arrivedRef.current(n);
  }, []);

  /**
   * Every way out of this dialog, so that none of them loses the count.
   *
   * ⚠️ CANCEL, DONE, ESCAPE AND THE BACKDROP ALL USED TO SKIP THE CALLBACK
   * ENTIRELY. Closing by hand after three documents had landed refreshed
   * nothing at all: the member watched a counter reach three and then saw an
   * unchanged page behind it.
   */
  const finishUp = useCallback(() => {
    report(latestRef.current);
    closeRef.current();
  }, [report]);

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
        const s = (await res.json()) as {
          state: State;
          added: number;
          /** The member pressed "I am finished" on the phone. */
          finished?: boolean;
          /** Landed, but not readable yet. */
          pending?: number;
        };
        if (!alive) return;
        setState(s.state);
        setAdded(s.added);
        latestRef.current = s.added;

        // ⚠️ IDENTITY VERIFICATION IS EXACTLY ONE DOCUMENT, so it keeps the
        // old behaviour on purpose: that upload REPLACES rather than adds,
        // and the very next thing the desktop does is move the member on to
        // the selfie. There is nothing to carry on scanning.
        if (dest === 'kyc') {
          if (s.added > 0) {
            report(s.added);
            // A beat to read "Your ID arrived" — vanishing on the instant
            // reads as a crash.
            window.setTimeout(() => {
              if (alive) closeRef.current();
            }, 1600);
          }
          return;
        }

        // ⚠️ THE MOTIVATION WIZARD WANTS EACH DOCUMENT AS IT LANDS; THE
        // DOCUMENT CENTRE MUST NOT HAVE THEM. The difference is what the
        // callback does at each end: on the wizard it refreshes a list of
        // uploads, which is harmless mid-session, and moving it to
        // fire-once-at-close would make that page worse than it is today.
        // On the Document Centre it BUILDS THE REVIEW SCREEN, and rebuilding
        // that while a member is part-way through it moves the ground under
        // them — an open panel would sprout a back link and relabel its
        // buttons, and somebody who had reached "All filed" would be pulled
        // back into a review. That one gets a single build, after the end.
        if (dest === 'motivation') report(s.added);

        // ⚠️ IT USED TO CLOSE INSTEAD OF EXPLAINING. setState('expired') above
        // and finishUp() here batch into ONE commit under React 19, so the
        // "That code has expired / Close this and press the button again for a
        // fresh one" copy a few lines down has never once painted for a member
        // whose link timed out. What they got was the dialog vanishing on its
        // own — indistinguishable from a crash, and with no hint that the fix
        // is simply to press the button again.
        //
        // The count still has to reach the caller, so report() is kept and only
        // the close is dropped. The member closes it, having read why.
        if (s.state === 'expired') {
          report(latestRef.current);
          return;
        }

        if (s.finished) {
          // Everything read: close, handing over the final count.
          if (!s.pending) {
            finishUp();
            return;
          }
          // Finished, but the last photograph is still inside its reading
          // window. Wait for it — though not forever: one document we can
          // never read must not pin this dialog open in front of a member who
          // has already put their phone down.
          const since = finishedAtRef.current ?? Date.now();
          finishedAtRef.current = since;
          if (Date.now() - since > 60_000) finishUp();
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

  // ⚠️ HELD IN A REF, because the effect below mounts once while finishUp
  // is rebuilt whenever `report` is.
  const finishUpRef = useRef(finishUp);
  finishUpRef.current = finishUp;

  // Escape closes, like every other overlay in here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finishUpRef.current();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  // Take focus on open and hand it back on close — see cardRef.
  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    cardRef.current?.focus({ preventScroll: true });
    return () => {
      if (returnTo && document.contains(returnTo)) {
        returnTo.focus({ preventScroll: true });
      }
    };
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
          : // ⚠️ SAY WHY THERE IS NO WEBCAM. A member sitting at a laptop with
            // a perfectly good camera presses a button and is handed a QR code,
            // with no explanation — which reads as the feature being broken or
            // as us being awkward. The reason is good and is already written
            // down at the top of this very file: a webcam points at your face
            // and focuses at half a metre, so it cannot resolve the serial on a
            // licence card. One sentence turns a refusal into a reason.
            'Your laptop camera focuses too far away to read a serial number, so we use the one in your pocket. Open the camera on your phone and point it at the code — no need to sign in there.';

  return (
    <div
      ref={cardRef}
      tabIndex={-1}
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
        if (e.target === e.currentTarget) finishUp();
      }}
    >
      <div
        style={{
          width: 'min(420px, 100%)',
          borderRadius: 'var(--r-lg)',
          padding: 24,
          textAlign: 'center',
          // ⚠️ --bg-surface WAS NEVER DEFINED. One hit in the whole repo — this
          // line — so the fallback was what actually painted: #14110f, a warm
          // brown-black, on the one scan surface that sits beside the Document
          // Centre's ordinary --bg-card chrome. It also meant defining that
          // token later, for any purpose at all, would silently repaint this
          // dialog.
          background: 'var(--bg-card)',
          border: '1px solid var(--border, rgba(255,255,255,0.15))',
          color: 'var(--text-primary, #fff)',
        }}
      >
        {/* ⚠️ THE LIVE REGION WRAPS BOTH HALVES.
            aria-live sat on the <h2> alone, and every state change here rewrites
            the heading and the body together — so a screen-reader member heard
            "Phone connected" and never the sentence telling them what to do
            next. The instruction is the half that matters.
            One region, so the pair is announced as one thought rather than as
            two competing updates. */}
        <div aria-live="polite">
          <h2 style={{ margin: '0 0 6px', fontSize: 19 }}>{heading}</h2>
          <p
            style={{
              margin: '0 0 18px',
              fontSize: 14,
              color: 'var(--text-secondary, rgba(255,255,255,0.7))',
            }}
          >
            {body}
          </p>
        </div>

        {err && (
          <p role="alert" style={{ margin: '0 0 14px', color: 'var(--red)' }}>
            {err}
          </p>
        )}

        {/* ⚠️ STILL SHOWN AFTER THE FIRST ARRIVAL. It used to disappear on
            `state === 'uploaded'` — which only means the session has produced
            one document — so a member whose phone locked half way through a
            pack had nothing left on screen to scan again. */}
        {url && state !== 'expired' && (
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
            {/* ⚠️ qrcode.react RENDERS role="img" WITH NO NAME. To a screen
                reader the entire centre of this dialog was nothing at all —
                an axe role-img-alt failure, and on the one surface where
                screen-reader members actually are. The library takes a `title`
                for exactly this. */}
            <QRCodeSVG
              value={url}
              size={QR_PX}
              level="M"
              title="QR code linking this document upload to your phone"
            />
          </div>
        )}

        {!url && !err && (
          <p style={{ margin: 0, opacity: 0.7 }}>Making a link…</p>
        )}

        <div style={{ marginTop: 20 }}>
          <button
            type="button"
            onClick={finishUp}
            style={{
              minHeight: 44,
              padding: '0 18px',
              // --r-md is what globals.css maps buttons to, and the sibling
              // scan-button.tsx already uses 10px. Every token here sits on an
              // unconditional :root, so the old fallbacks were dead code.
              borderRadius: 'var(--r-md)',
              // The app's actual secondary-button pattern. A bare 0.5px border
              // on a transparent ground drops this control's only affordance to
              // about 1.3:1 — under WCAG 1.4.11's 3:1 for UI components — so
              // the inset fill does the work instead of the line.
              border: '0.5px solid var(--border)',
              background: 'var(--bg-inset)',
              color: 'var(--text-secondary)',
              fontSize: 15,
            }}
          >
            {/* "Cancel" against an already-dead link reads as though closing
                were what killed it. Now that the expired state actually paints
                (see the poll above), it needs a word that just means "close". */}
            {state === 'uploaded' ? 'Done' : state === 'expired' ? 'Close' : 'Cancel'}
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
