'use client';

import { useEffect, useState } from 'react';

// First-visit gate: an 18+ / liability disclaimer that must be accepted
// before Ask Boet is usable. Persisted in localStorage so it shows once.
// null = not yet determined (avoids a flash before we read storage).
const DISCLAIMER_KEY = 'askgg:disclaimer:v1';

export function useAskGgDisclaimer(): {
  accepted: boolean | null;
  accept: () => void;
} {
  const [accepted, setAccepted] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      setAccepted(localStorage.getItem(DISCLAIMER_KEY) === 'yes');
    } catch {
      setAccepted(true); // storage blocked — don't hard-block the page
    }
  }, []);
  function accept() {
    try {
      localStorage.setItem(DISCLAIMER_KEY, 'yes');
    } catch {
      /* ignore */
    }
    setAccepted(true);
  }
  return { accepted, accept };
}

/** First-visit modal: 18+ confirmation + liability waiver. Declining
 *  returns the user to the homepage (handled by the parent). */
export function AskGgDisclaimer({
  onAccept,
  onDecline,
}: {
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Before you start"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 460,
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderRadius: 14,
          padding: 22,
          boxShadow: '0 18px 50px rgba(0,0,0,0.35)',
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 700,
            color: 'var(--text-primary)',
          }}
        >
          Before you continue
        </h2>
        <p
          style={{
            margin: '12px 0 0',
            fontSize: 13.5,
            lineHeight: 1.55,
            color: 'var(--text-secondary)',
          }}
        >
          Ask Boet gives <strong>general information only</strong> — it is not
          professional, legal, or safety advice. Firearms, ammunition and
          reloading are inherently dangerous; you alone are responsible for how
          you use anything you read here, and you must verify it against the
          manufacturer&rsquo;s official data and applicable law before acting.
        </p>
        <p
          style={{
            margin: '10px 0 0',
            fontSize: 13.5,
            lineHeight: 1.55,
            color: 'var(--text-secondary)',
          }}
        >
          To the fullest extent permitted by law, <strong>All Outdoor accepts
          no liability</strong> for any loss, injury or damage arising from use
          of Ask Boet. By continuing you confirm that you are{' '}
          <strong>18 years or older</strong> and that you accept these terms.
        </p>
        <div
          style={{
            display: 'flex',
            gap: 10,
            marginTop: 20,
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={onAccept}
            style={{
              flex: '1 1 200px',
              padding: '11px 16px',
              borderRadius: 10,
              border: 'none',
              background: 'var(--red)',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            I&rsquo;m 18+ and I agree
          </button>
          <button
            type="button"
            onClick={onDecline}
            style={{
              flex: '1 1 120px',
              padding: '11px 16px',
              borderRadius: 10,
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-secondary)',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}
