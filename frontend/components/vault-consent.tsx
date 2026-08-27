'use client';

import { useEffect, useRef, useState } from 'react';
import { licenceCentreApi, type TokenGetter } from '@/lib/licence-centre-api';
import { useScrollLock } from '@/lib/use-scroll-lock';

// ────────────────────────────────────────────────────────────────────
// MAY WE KEEP YOUR DOCUMENTS?
//
// Operator, 2026-08-22: "we also need to launch a window asking the user for us
// to keep the documents and explain why. Maybe when they first launch the
// Motivation Centre."
//
// ⚠️ NOBODY HAD EVER BEEN ASKED. Documents attached to a licence application
// were already kept past it and already offered back on the next one, and no
// record anywhere said a member had agreed to any of it.
//
// ⚠️ ONE COMPONENT, IMPORTED TWICE, NEVER COPY-PASTED. It renders as an overlay
// on the Motivation Centre and inline in the Document Centre. This codebase
// already carries a written note about what copy-pasting a consent block costs:
// the two copies drift, and then nobody can say which wording somebody agreed
// to. VAULT_CONSENT_VERSION on the server is the other half of that.
// ────────────────────────────────────────────────────────────────────

export type ConsentState =
  | 'never-asked'
  | 'declined'
  | 'given'
  | 'stale'
  | 'withdrawn';

/**
 * How long a document from an application survives WITHOUT this.
 *
 * ⚠️ RENDERED FROM THE SERVER, NEVER HARD-CODED. It is the operator-settable
 * motivation_retention_days, and a window that says "two years" while the
 * setting says something else is a false statement in a consent notice.
 */
function retentionWords(days: number | null): string {
  if (!days) return 'after the application is finished';
  const years = Math.round(days / 365);
  if (years >= 1) {
    return `${years === 1 ? 'a year' : `${years} years`} after that application is finished`;
  }
  return `${days} days after that application is finished`;
}

export function VaultConsentBody({
  retentionDays,
  onAnswer,
  busy,
}: {
  retentionDays: number | null;
  onAnswer: (agreed: boolean) => void;
  busy: boolean;
}) {
  return (
    <div className="text-sm leading-relaxed text-[var(--text-secondary)]">
      <h2 className="text-lg font-semibold text-[var(--text-primary)]">
        May we keep your documents?
      </h2>

      <p className="mt-3">
        Every licence application asks for much the same paperwork. A copy of
        your ID. Proof of your address. Photographs of your safe. Your
        competency certificate. Most of it does not change between one
        application and the next.
      </p>
      <p className="mt-3">
        If you say yes, we keep a copy of the documents you attach to an
        application in your Document Centre, and offer them back to you the next
        time something asks for the same paper.{' '}
        <strong className="text-[var(--text-primary)]">
          You choose each one yourself. We never attach a document for you.
        </strong>
      </p>

      <p className="mt-4 font-medium text-[var(--text-primary)]">
        What we would keep
      </p>
      <p className="mt-1">
        Your ID copy, proof of your address, the photographs of your safe and of
        how it is installed, confirmation of employment, your record of hunts or
        competitions, and your licences and certificates.
      </p>

      <p className="mt-4 font-medium text-[var(--text-primary)]">
        What we never keep, whatever you choose here
      </p>
      <p className="mt-1">
        Anyone else&rsquo;s paperwork — a seller&rsquo;s licence, or a letter
        from the current owner of a firearm. Anything written about one specific
        firearm, such as an association endorsement. Those stay with the
        application they belong to, and are deleted with it.
      </p>

      <p className="mt-4 font-medium text-[var(--text-primary)]">Where they go</p>
      <p className="mt-1">
        The files are stored encrypted on our own server. When a document
        arrives we send the image to Anthropic&rsquo;s Claude service to read
        the dates and numbers printed on it, so the form fills itself in.{' '}
        <strong className="text-[var(--text-primary)]">
          That happens whether or not you say yes here
        </strong>
        , because it is how an application gets filled in. Nothing is sent to
        SAPS. You hand in your own application.
      </p>

      <p className="mt-4 font-medium text-[var(--text-primary)]">
        How long we keep them
      </p>
      <p className="mt-1">
        Until you delete them, or until you close your account. There is no
        timer on the Document Centre. Without this, a document is deleted along
        with the application it belongs to, {retentionWords(retentionDays)}.
      </p>

      <p className="mt-4 font-medium text-[var(--text-primary)]">
        How to remove them
      </p>
      <p className="mt-1">
        Everything we keep is listed in your Document Centre. You can rename or
        delete any of it there, and deleting removes the file from our server.
        You can also switch this off at any time, which stops us keeping
        anything new.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onAnswer(true)}
          className="rounded-[var(--r-md)] bg-[var(--red)] px-4 py-2 text-sm text-white disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Yes, keep my documents'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onAnswer(false)}
          className="rounded-[var(--r-md)] border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-secondary)] disabled:opacity-60"
        >
          No, do not keep them
        </button>
      </div>

      {/* ⚠️ THE LAST LINE IS THE MOST IMPORTANT ONE. A consent notice that
          leaves somebody unsure whether saying no breaks the thing they are
          in the middle of is not a real choice. */}
      <p className="mt-3 text-xs text-[var(--text-tertiary)]">
        You can say no and still finish the application you are busy with.
        Nothing about it changes — you upload documents the same way you do now,
        and you can turn this on later in your Document Centre.
      </p>
    </div>
  );
}

/**
 * The overlay form, for the Motivation Centre.
 *
 * ⚠️ DISMISSAL IS NOT A DECLINE. Escape and a backdrop click write nothing and
 * snooze for 30 days under a PER-USER key. A storage preference must be
 * declinable by walking away; the hard-wall pattern in this codebase exists for
 * a payout gate, and this is not one.
 *
 * The rule the rest of the app follows: localStorage decides whether it pops,
 * a column decides what is allowed.
 */
export default function VaultConsentModal({
  token,
  userId,
  retentionDays,
  onDone,
}: {
  token: TokenGetter;
  userId: string;
  retentionDays: number | null;
  onDone: (agreed: boolean | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const snoozeKey = `gg-vault-consent-later-until-${userId}`;

  // Mounted only while this overlay is shown, so the lock runs for its
  // whole life — see lib/use-scroll-lock.ts.
  useScrollLock(true);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(
        snoozeKey,
        String(Date.now() + 30 * 24 * 60 * 60 * 1000),
      );
    } catch {
      // A blocked localStorage costs the snooze, not the dismissal.
    }
    onDone(null);
  }

  async function answer(agreed: boolean) {
    setBusy(true);
    try {
      await licenceCentreApi.answerConsent(token, agreed);
      onDone(agreed);
    } catch {
      // ⚠️ NEVER TRAP THEM IN IT. A failed write must not leave the window up
      // with no way out; the server will simply ask again next time.
      onDone(null);
    }
  }

  return (
    <div
      // ⚠️ z-[60] AND data-blocking-overlay, both load-bearing. The bottom tab
      // bar is z-55 and would otherwise sit over this; Boet's dock is z-60 too
      // and, being last in <body>, wins the tie on DOM order — the attribute
      // stands him down for the overlay's lifetime.
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      data-blocking-overlay="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="May we keep your documents?"
        tabIndex={-1}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-[var(--r-lg)] bg-[var(--bg-card)] p-5 outline-none sm:rounded-[var(--r-lg)]"
      >
        <VaultConsentBody
          retentionDays={retentionDays}
          onAnswer={answer}
          busy={busy}
        />
        <button
          type="button"
          onClick={dismiss}
          className="mt-3 text-xs text-[var(--text-tertiary)] underline"
        >
          Ask me another time
        </button>
      </div>
    </div>
  );
}

/** Has the member snoozed this window, and is the snooze still running? */
export function snoozed(userId: string): boolean {
  try {
    const until = Number(
      localStorage.getItem(`gg-vault-consent-later-until-${userId}`),
    );
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}
