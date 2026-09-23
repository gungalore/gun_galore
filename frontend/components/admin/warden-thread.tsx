'use client';

import { useState } from 'react';
import {
  Icon,
  Pill,
  useAdminToast,
  type AdminTone,
} from '@/components/admin/admin-ui';
import {
  formatWhen,
  wardenApprove,
  wardenDecline,
  type WardenChatMessage,
  type WardenProposal,
} from '@/lib/admin-api';

/**
 * THE WARDEN THREAD — the daemon's messages and the proposals an operator acts
 * on.
 *
 * ⚠️ `WARDEN_KINDS` IS THE PANEL'S LEG OF A HAND-MIRRORED CONTRACT. The daemon
 * (warden/src/types.ts) and the backend (backend/src/admin/warden.types.ts)
 * each carry the same six literals, and backend/src/admin/warden.spec.ts reads
 * THIS FILE off disk to hold the three in step. A kind added on one side and
 * not here renders an `undefined` tag in the operator's browser with no error
 * on either side of the wire — so change all three or none.
 *
 * ⚠️ A MESSAGE WITH NO KNOWN KIND IS NOT DROPPED HERE EITHER. The backend
 * already drops one it cannot name; if one still arrived it would be a backend
 * bug, and rendering it under a neutral "note" tag would hide exactly the
 * message that mattered. Unknown kinds render as their raw string.
 */
export const WARDEN_KINDS = [
  'finding',
  'fixed',
  'red-gate',
  'proposal',
  'ran',
  'note',
] as const;
export type WardenKind = (typeof WARDEN_KINDS)[number];

const KIND_META: Record<WardenKind, { tag: string; tone: AdminTone }> = {
  finding: { tag: 'FINDING', tone: 'cyan' },
  fixed: { tag: 'FIXED', tone: 'green' },
  'red-gate': { tag: 'RED GATE', tone: 'red' },
  proposal: { tag: 'PROPOSAL', tone: 'purple' },
  ran: { tag: 'RAN', tone: 'muted' },
  note: { tag: 'NOTE', tone: 'muted' },
};

const STATUS_TONE: Record<WardenProposal['status'], AdminTone> = {
  pending: 'amber',
  approved: 'green',
  declined: 'muted',
  acknowledged: 'cyan',
};

function timeOf(iso: string): string {
  return formatWhen(iso).replace(/^\d+ \w+ /, '');
}

export function WardenThread({
  messages,
  onSettled,
}: {
  messages: WardenChatMessage[];
  onSettled: () => void;
}) {
  if (messages.length === 0) {
    return (
      <p className="adm-sub" style={{ margin: 0 }}>
        Warden has written nothing yet. It speaks when a sweep turns something
        up, when it fixes something on its safe list, or when you say something.
      </p>
    );
  }

  return (
    <div className="adm-thread">
      {messages.map((m) => (
        <article key={m.id} className="adm-msg" data-role={m.role}>
          <header className="adm-msg-head">
            <Pill tone={m.role === 'operator' ? 'cyan' : (KIND_META[m.kind]?.tone ?? 'muted')}>
              {m.role === 'operator' ? 'YOU' : (KIND_META[m.kind]?.tag ?? m.kind)}
            </Pill>
            <span className="adm-mono" style={{ fontSize: 10, color: 'var(--adm-ink-3)' }}>
              {timeOf(m.at)}
            </span>
          </header>
          {m.body.map((p, i) => (
            <p key={i} className="adm-msg-body">
              {p}
            </p>
          ))}
          {m.pre ? (
            <div className="adm-terminal" data-label={m.pre.tone === 'ground' ? 'RAN' : 'WOULD RUN'}>
              {m.pre.lines.join('\n')}
            </div>
          ) : null}
          {m.footnote ? <p className="adm-msg-foot">{m.footnote}</p> : null}
        </article>
      ))}
    </div>
  );
}

/**
 * The proposal queue.
 *
 * ⚠️ A RED GATE HAS NO BUTTONS. It has no command, cannot be approved, cannot
 * be declined and cannot be dismissed — it clears only when a human changes the
 * code. An enabled Approve on a red gate would be a lie about the running
 * configuration of a firearms marketplace.
 */
export function WardenProposals({
  proposals,
  onSettled,
}: {
  proposals: WardenProposal[];
  onSettled: () => void;
}) {
  const open = proposals.filter((p) => p.status === 'pending');
  if (open.length === 0) {
    return (
      <p className="adm-sub" style={{ margin: 0 }}>
        Nothing is waiting on a decision.
      </p>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {open.map((p) => (
        <WardenProposalCard key={p.id} proposal={p} onSettled={onSettled} />
      ))}
    </div>
  );
}

function WardenProposalCard({
  proposal,
  onSettled,
}: {
  proposal: WardenProposal;
  onSettled: () => void;
}) {
  const { toast } = useAdminToast();
  const [approving, setApproving] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redGate = proposal.kind === 'red_gate';

  async function approve() {
    if (!proposal.command || busy) return;
    setBusy(true);
    setError(null);
    try {
      await wardenApprove(proposal.id, proposal.command, reason.trim() || undefined);
      toast('Approved — Warden is running it.');
      setApproving(false);
      onSettled();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
      setBusy(false);
    }
  }

  async function decline() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await wardenDecline(proposal.id, reason.trim() || undefined);
      toast('Declined. Warden reads the reason as standing guidance.');
      setDeclining(false);
      onSettled();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Decline failed');
      setBusy(false);
    }
  }

  return (
    <div
      className="adm-card"
      data-tone={redGate ? 'red' : 'purple'}
      style={{ background: '#090e13' }}
    >
      <header className="adm-card-head">
        <span className="adm-card-title" style={{ fontSize: 13 }}>
          {redGate ? (
            <>
              <span style={{ color: 'var(--adm-red)' }}>■</span> {proposal.headline}
            </>
          ) : (
            <>
              <span style={{ color: 'var(--adm-purple)' }}>◈</span> {proposal.headline}
            </>
          )}
        </span>
        <Pill tone={STATUS_TONE[proposal.status]}>{proposal.status.toUpperCase()}</Pill>
      </header>

      <p className="adm-msg-body" style={{ marginTop: 0 }}>
        {proposal.diagnosis}
      </p>

      {redGate ? (
        <p className="adm-sub" style={{ margin: 0 }}>
          A red gate has no fix to run. It clears only when the gate changes in code —
          there is nothing here to approve or decline.
        </p>
      ) : (
        <>
          <div className="adm-terminal" data-label="APPROVE RUNS EXACTLY THIS">
            {proposal.command ?? '(no command)'}
          </div>
          <p className="adm-sub" style={{ margin: '6px 0 0', fontSize: 10.5 }}>
            {proposal.operationName ? (
              <>
                Runs inside Warden&apos;s safe list as{' '}
                <span className="adm-mono">{proposal.operationName}</span>.
              </>
            ) : (
              <>
                ⚠️ Not a safe-list operation — Warden drafted this command free-hand.
                The safe list does not bound its shape.
              </>
            )}{' '}
            {proposal.reversible
              ? 'Reversible.'
              : '⚠️ Cannot be put back once it runs.'}
          </p>

          {approving || declining ? (
            <div style={{ marginTop: 10 }}>
              <textarea
                className="adm-textarea"
                rows={2}
                autoFocus
                disabled={busy}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  approving
                    ? 'Why (optional — recorded against what ran)'
                    : 'Why refuse it (optional — Warden reads this back as guidance)'
                }
              />
              {error ? (
                <p style={{ color: 'var(--adm-red)', fontSize: 12 }}>{error}</p>
              ) : null}
              <div className="adm-grid-2" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="adm-btn"
                  data-tone="ghost"
                  disabled={busy}
                  onClick={() => {
                    setApproving(false);
                    setDeclining(false);
                    setError(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="adm-btn"
                  data-tone={approving ? 'cyan' : 'red'}
                  disabled={busy}
                  onClick={() => void (approving ? approve() : decline())}
                >
                  {busy
                    ? 'Working…'
                    : approving
                      ? 'Approve and run'
                      : 'Decline proposal'}
                </button>
              </div>
            </div>
          ) : (
            <div className="adm-grid-2" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="adm-btn"
                data-tone="ghost"
                onClick={() => {
                  setDeclining(true);
                  setReason('');
                }}
              >
                Decline
              </button>
              <button
                type="button"
                className="adm-btn"
                data-tone="cyan"
                disabled={!proposal.command}
                onClick={() => {
                  setApproving(true);
                  setReason('');
                }}
              >
                <Icon name="bolt" size={14} /> Approve and run
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
