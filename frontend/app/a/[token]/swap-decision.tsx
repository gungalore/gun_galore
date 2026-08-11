'use client';

/**
 * Swap decision page — one-tap SMS landing for both directions:
 *
 *   SWAP_PROPOSAL_DECISION — owner sees a swap proposal.
 *     Accept / Counter cash / Reject → accept-swap / counter-swap / reject-swap
 *   SWAP_COUNTER_DECISION  — proposer sees the owner's cash counter.
 *     Accept / Reject → accept-swap-counter / reject-swap-counter
 *
 * Mobile-only, no sign-in (token is the credential).
 */

import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

type SwapRole = 'INITIATOR_GIVES' | 'OWNER_GIVES';

export interface SwapDecisionPayload {
  kind: 'SWAP_PROPOSAL_DECISION' | 'SWAP_COUNTER_DECISION';
  expiresAt: string;
  proposalExpiresAt: string | null;
  proposalStatus: string;
  greeting: string;
  wanted: {
    id: string;
    title: string;
    reference: string | null;
    primaryImageUrl: string | null;
  };
  offered: {
    id: string;
    title: string;
    isFirearm?: boolean;
    primaryImageUrl: string | null;
  };
  proposal: {
    id: string;
    proposerUsername: string;
    ownerUsername: string;
    cashAmount: number;
    cashFromProposer: boolean;
    counterCashAmount: number | null;
    counterCashFromProposer: boolean;
    proposerNote: string | null;
    ownerNote: string | null;
  };
}

function formatRand(cents: number): string {
  const r = cents / 100;
  return `R ${r.toLocaleString('en-ZA', {
    minimumFractionDigits: r % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

type ViewState =
  | { kind: 'choice' }
  | { kind: 'countering' }
  | { kind: 'submitting' }
  | { kind: 'done'; outcome: 'accepted' | 'rejected' | 'countered' }
  | { kind: 'error'; message: string };

export function SwapDecisionPage({
  token,
  payload,
}: {
  token: string;
  payload: SwapDecisionPayload;
}) {
  const isOwner = payload.kind === 'SWAP_PROPOSAL_DECISION';
  const [view, setView] = useState<ViewState>({ kind: 'choice' });
  const [cash, setCash] = useState('');
  const [dir, setDir] = useState<SwapRole>('INITIATOR_GIVES');
  const [attested, setAttested] = useState(false);
  // S6 — the owner RECEIVES the offered item; if it's a firearm they must
  // affirm 18+/competency before accept/counter (server re-checks).
  const needsAttest = isOwner && !!payload.offered.isFirearm;
  const attestOk = !needsAttest || attested;

  // Current cash on the table (original for the owner; counter for the proposer).
  const cashOnTable = isOwner
    ? payload.proposal.cashAmount
    : (payload.proposal.counterCashAmount ?? payload.proposal.cashAmount);
  const cashFromProposer = isOwner
    ? payload.proposal.cashFromProposer
    : payload.proposal.counterCashFromProposer;

  async function callAction(endpoint: string, body?: Record<string, unknown>) {
    setView({ kind: 'submitting' });
    try {
      const res = await fetch(`${API_URL}/actions/${token}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string | string[] };
        const message = Array.isArray(b.message) ? b.message.join(', ') : (b.message ?? `Error ${res.status}`);
        setView({ kind: 'error', message });
        return;
      }
      const outcome = endpoint.includes('accept')
        ? 'accepted'
        : endpoint.includes('reject')
          ? 'rejected'
          : 'countered';
      setView({ kind: 'done', outcome });
    } catch (err) {
      setView({
        kind: 'error',
        message: err instanceof Error ? err.message : "Couldn't reach All Outdoor — try again.",
      });
    }
  }

  if (view.kind === 'done') {
    return <SwapDoneScreen outcome={view.outcome} isOwner={isOwner} />;
  }
  if (view.kind === 'error') {
    return <SwapErrorPanel message={view.message} onRetry={() => setView({ kind: 'choice' })} />;
  }

  const submitting = view.kind === 'submitting';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card center>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 4 }}>
          Hi {payload.greeting},
        </p>
        <p style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)' }}>
          {isOwner
            ? `@${payload.proposal.proposerUsername} proposed a swap`
            : `The owner countered your swap`}
        </p>
      </Card>

      {/* The two items */}
      <Card>
        <ItemRow
          label={isOwner ? 'They give' : 'You give'}
          title={payload.offered.title}
          img={payload.offered.primaryImageUrl}
        />
        <div style={{ textAlign: 'center', fontSize: 20, color: 'var(--text-tertiary)', margin: '6px 0' }}>
          ⇅
        </div>
        <ItemRow
          label={isOwner ? 'You give' : 'You get'}
          title={payload.wanted.title}
          img={payload.wanted.primaryImageUrl}
        />
      </Card>

      {/* Cash line */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Cash</span>
          <span style={{ fontSize: 18, fontWeight: 600, color: cashOnTable ? 'var(--red)' : 'var(--text-tertiary)' }}>
            {cashOnTable
              ? `${formatRand(cashOnTable)} ${cashFromProposer ? (isOwner ? '→ you' : 'from you') : (isOwner ? 'from you' : '→ you')}`
              : 'None'}
          </span>
        </div>
        {payload.proposal.proposerNote && (
          <NoteBlock label={`Note from @${payload.proposal.proposerUsername}`} text={payload.proposal.proposerNote} />
        )}
        {payload.proposal.ownerNote && !isOwner && (
          <NoteBlock label="Note from the owner" text={payload.proposal.ownerNote} />
        )}
      </Card>

      {/* S6 — firearm 18+/competency attestation (owner receiving a firearm) */}
      {needsAttest && view.kind !== 'countering' && (
        <FirearmAttestCard checked={attested} onChange={setAttested} />
      )}

      {/* Actions */}
      {view.kind !== 'countering' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SwapButton
            variant="primary"
            disabled={submitting || !attestOk}
            onClick={() =>
              callAction(
                isOwner ? 'accept-swap' : 'accept-swap-counter',
                needsAttest ? { firearmAttestation18Plus: true } : undefined,
              )
            }
          >
            {submitting ? 'Working…' : 'Accept swap'}
          </SwapButton>
          {isOwner && (
            <SwapButton variant="secondary" disabled={submitting} onClick={() => setView({ kind: 'countering' })}>
              Counter the cash
            </SwapButton>
          )}
          <SwapButton
            variant="ghost"
            disabled={submitting}
            onClick={() => callAction(isOwner ? 'reject-swap' : 'reject-swap-counter')}
          >
            Decline
          </SwapButton>
        </div>
      )}

      {/* Owner counter form */}
      {view.kind === 'countering' && (
        <Card>
          <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 8 }}>
            Counter the cash
          </p>
          <input
            type="number"
            min={0}
            step="0.01"
            value={cash}
            onChange={(e) => setCash(e.target.value)}
            placeholder="Cash amount (R) — 0 for none"
            style={fieldStyle}
          />
          <select value={dir} onChange={(e) => setDir(e.target.value as SwapRole)} style={{ ...fieldStyle, marginTop: 8 }}>
            <option value="INITIATOR_GIVES">They pay me the cash</option>
            <option value="OWNER_GIVES">I pay them the cash</option>
          </select>
          {needsAttest && (
            <div style={{ marginTop: 12 }}>
              <FirearmAttestCard checked={attested} onChange={setAttested} />
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <SwapButton
              variant="primary"
              disabled={submitting || !attestOk}
              onClick={() =>
                callAction('counter-swap', {
                  cashAmount: Math.round(parseFloat(cash || '0') * 100),
                  cashDirection: dir,
                  firearmAttestation18Plus: needsAttest ? true : undefined,
                })
              }
            >
              Send counter
            </SwapButton>
            <SwapButton variant="secondary" onClick={() => setView({ kind: 'choice' })}>
              Cancel
            </SwapButton>
          </div>
        </Card>
      )}
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-primary)',
  borderRadius: 8,
  padding: '12px',
  fontSize: 16,
  width: '100%',
};

function Card({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: 12,
        padding: 18,
        textAlign: center ? 'center' : 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {children}
    </div>
  );
}

function ItemRow({ label, title, img }: { label: string; title: string; img: string | null }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt={title} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '0.5px solid var(--border)', flexShrink: 0 }} />
      ) : (
        <div style={{ width: 56, height: 56, borderRadius: 8, background: 'var(--bg-inset)', border: '0.5px solid var(--border)', flexShrink: 0 }} />
      )}
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)' }}>{label}</p>
        <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3 }}>{title}</p>
      </div>
    </div>
  );
}

function NoteBlock({ label, text }: { label: string; text: string }) {
  return (
    <div style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)', borderRadius: 8, padding: 10, marginTop: 8 }}>
      <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{text}</p>
    </div>
  );
}

function SwapButton({
  variant,
  onClick,
  disabled,
  children,
}: {
  variant: 'primary' | 'secondary' | 'ghost';
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const styles: Record<typeof variant, React.CSSProperties> = {
    primary: { background: disabled ? 'var(--bg-inset)' : 'var(--red)', color: disabled ? 'var(--text-tertiary)' : '#fff', border: 'none' },
    secondary: { background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)' },
    ghost: { background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)' },
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{ flex: 1, minHeight: 52, borderRadius: 10, fontSize: 16, fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.7 : 1, ...styles[variant] }}
    >
      {children}
    </button>
  );
}

function FirearmAttestCard({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid #f59e0b',
        borderRadius: 12,
        padding: 16,
      }}
    >
      <p style={{ fontSize: 13, fontWeight: 600, color: '#f59e0b', marginBottom: 6 }}>
        Firearm — dealer transfer
      </p>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 10 }}>
        This firearm transfers through a licensed dealer (SAPS 534). You collect
        it from the dealer once it&apos;s stocked in.
      </p>
      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0 }}
        />
        <span style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.45 }}>
          I confirm I am over 18 and (where applicable) hold the relevant SAPS
          competency / licence to acquire this firearm.
        </span>
      </label>
    </div>
  );
}

function SwapDoneScreen({ outcome, isOwner }: { outcome: 'accepted' | 'rejected' | 'countered'; isOwner: boolean }) {
  const copy =
    outcome === 'accepted'
      ? { title: 'Swap agreed!', body: 'Both items are now reserved. We’ll send funding (if any) and shipping details shortly.', emoji: '✓', color: '#22c55e' }
      : outcome === 'rejected'
        ? { title: 'Declined', body: isOwner ? 'You’ve declined this swap proposal.' : 'You’ve declined the owner’s counter.', emoji: '✕', color: 'var(--text-tertiary)' }
        : { title: 'Counter sent', body: 'Your cash counter has been sent. The other member has 24 hours to respond.', emoji: '↔', color: 'var(--red)' };
  return (
    <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 12, padding: 28, textAlign: 'center' }}>
      <div style={{ width: 72, height: 72, borderRadius: '50%', background: copy.color, color: '#fff', fontSize: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
        {copy.emoji}
      </div>
      <p style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>{copy.title}</p>
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{copy.body}</p>
    </div>
  );
}

function SwapErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--red)', borderRadius: 12, padding: 20, textAlign: 'center' }}>
      <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--red)', marginBottom: 8 }}>Couldn&apos;t complete that action</p>
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>{message}</p>
      <SwapButton variant="secondary" onClick={onRetry}>Try again</SwapButton>
    </div>
  );
}
