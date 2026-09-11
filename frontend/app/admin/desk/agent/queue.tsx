'use client';

/**
 * AGENT — the approval queue. THE PRIMARY CONTENT OF THIS SURFACE.
 *
 * 🚨 THIS EXISTS BECAUSE A PROPOSAL USED TO BE A MESSAGE IN A SCROLLBACK. On
 * the Site board the only thing on the page that was WORK — an agent asking
 * permission to run a command on the production box — was rendered inside the
 * one thing on the page that was READING. There was no count, no landing
 * position, and nothing that said "two of these are waiting on you" without
 * scrolling a thread to find out. So the queue is now the first thing under
 * the title and the conversation is below it.
 *
 * ⚠️ A RED GATE IS IN THE QUEUE AND CARRIES NO BUTTONS, AND THAT NEEDS SAYING
 * ON THE CARD. `red_gate` is a proposal only in the sense that it arrives on
 * the same thread: it has no command, WardenService refuses approve and
 * decline on it by kind, and the only thing that clears it is the gate
 * changing in code. In a list titled "waiting on you", a card with no controls
 * and no explanation reads as a broken card — so it says what would clear it.
 *
 * ⚠️ A `proposal` WITH NO COMMAND IS ALSO BUTTONLESS, and for a different
 * reason: the approve call is a compare-and-swap on the exact command string,
 * so there is nothing to echo back. That is a daemon that sent half a
 * proposal, not a decision anybody can make, and the card says so rather than
 * offering an Approve that would 409.
 */
import * as React from 'react';
import { Button, IconCheck, IconLock, Tag } from '../../../../components/desk';
import { clock, proposalAuthority, type WardenProposal } from '../../../../lib/desk-site';
import { Card, Pre, Quiet } from '../health/board-bits';

export function ApprovalQueue({
  proposals,
  loading,
  present,
  absence,
  paused,
  onApprove,
  onDecline,
}: {
  /** Every proposal on the thread. This component filters to pending. */
  proposals: WardenProposal[];
  /** True until the first chat read lands — an empty queue and an unread one
   *  are different facts, and only one of them is good news. */
  loading: boolean;
  present: boolean;
  /**
   * WHICH absence, when `present` is false.
   *
   * 🚨 THIS QUEUE USED TO ANSWER TWO OPPOSITE SILENCES WITH ONE SENTENCE. It
   * said "Nothing is waiting on you, because nothing is watching the box"
   * whenever `present` was false — and `present: false` covers both "no
   * daemon is configured" (true: nothing exists to raise a proposal) and "a
   * daemon is configured and did not answer" (NOT true: nothing was read, so
   * this list is empty because the fetch failed, not because the queue is).
   * Reporting an unread list as an empty one is the same class of statement
   * as an audit trail dropping records and leaving `truncated: false`.
   *
   * ⚠️ null WITH `present: false` READS AS UNREACHABLE, not as not-deployed.
   * Unknown must never resolve to the all-clear.
   */
  absence: 'not_deployed' | 'unreachable' | null;
  /** Paused means no NEW proposals arrive; the ones already here still stand. */
  paused: boolean;
  onApprove: (p: WardenProposal) => void;
  onDecline: (p: WardenProposal) => void;
}) {
  const pending = proposals.filter((p) => p.status === 'pending');
  const actionable = pending.filter((p) => p.kind === 'proposal' && p.command);

  return (
    <Card
      label="Waiting on you"
      hint={
        loading
          ? 'reading…'
          : pending.length === 0
            ? 'nothing pending'
            : `${actionable.length} to decide · ${pending.length} pending`
      }
      footer="Approve restates the exact command and echoes it back as a compare-and-swap: the server re-reads the proposal from Warden and refuses on any difference. There is no undo — this runs on the production box."
    >
      {loading ? (
        <Quiet>Reading…</Quiet>
      ) : pending.length === 0 ? (
        <Quiet>
          {present
            ? paused
              ? 'Nothing is waiting on you. Warden is paused, so nothing new will be raised until it resumes — it is still measuring.'
              : 'Nothing is waiting on you.'
            : absence === 'not_deployed'
              ? 'Nothing is waiting on you, because nothing is watching the box. An empty queue under a daemon that was never deployed is not an all-clear.'
              : // ⚠️ NOT "nothing is waiting". The daemon is configured and did
                // not answer, so this queue was never read — it cannot say
                // whether a proposal is pending, and saying so would be a claim
                // about a list nobody fetched.
                'Whether anything is waiting on you is unknown. Warden is configured but did not answer, so nothing below was read from it — this is an empty panel, not an empty queue.'}
        </Quiet>
      ) : (
        pending.map((p, i) => (
          <QueueCard
            key={p.id}
            proposal={p}
            last={i === pending.length - 1}
            onApprove={onApprove}
            onDecline={onDecline}
          />
        ))
      )}
    </Card>
  );
}

function QueueCard({
  proposal: p,
  last,
  onApprove,
  onDecline,
}: {
  proposal: WardenProposal;
  last: boolean;
  onApprove: (p: WardenProposal) => void;
  onDecline: (p: WardenProposal) => void;
}) {
  const redGate = p.kind === 'red_gate';
  const decidable = !redGate && Boolean(p.command);
  const authority = proposalAuthority(p);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 0',
        borderBottom: last ? undefined : '1px solid var(--dk-line)',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <Tag kind={redGate ? 'bad' : 'warn'} icon={redGate ? IconLock : undefined}>
          {redGate ? 'red gate' : 'proposal'}
        </Tag>
        <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--dk-ink)', minWidth: 0, flex: 1 }}>
          {p.headline}
        </span>
        <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>
          {clock(p.raisedAt)}
        </span>
      </span>

      {p.diagnosis ? (
        <span style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--dk-ink-2)' }}>
          {p.diagnosis}
        </span>
      ) : null}

      {/* ⚠️ `inset`, NOT `ground`. This command has NOT run — the two grounds
          are how a dry run and a transcript are told apart at a glance, and
          getting it backwards here would show an operator a plan dressed as
          a thing that already happened. */}
      {p.command ? <Pre tone="inset">{p.command}</Pre> : null}

      {/* ⚠️ THE TWO FACTS THE COMMAND STRING DOES NOT CARRY, BEFORE THE DIALOG
          RATHER THAN ONLY INSIDE IT. Whether this is a named safe-list
          operation or a command the model wrote free-hand, and whether it can
          be put back. `cancelLongQuery` and `terminateIdleInTransaction`
          differ by one Postgres function name inside a 354-character
          statement — which is to say the <Pre> above does not tell an
          operator apart at a glance, and the tags do.

          ⚠️ FREE-FORM IS THE DEFAULT READING. A proposal from an API or a
          daemon too old to send `operationName` shows as not-on-the-safe-list,
          which over-warns; the friendlier default would vouch for a command
          nothing validated. */}
      {decidable ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Tag kind={authority.kind === 'safe_list' ? 'neutral' : 'warn'} icon={IconLock}>
            {authority.label}
          </Tag>
          <Tag kind={p.reversible === true ? 'neutral' : 'bad'}>
            {p.reversible === true ? 'reversible' : 'not reversible'}
          </Tag>
        </span>
      ) : null}

      {decidable ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="primary" icon={IconCheck} onClick={() => onApprove(p)}>
            Approve the fix…
          </Button>
          <Button variant="secondary" onClick={() => onDecline(p)}>
            Decline
          </Button>
        </span>
      ) : (
        <span style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--dk-ink-3)' }}>
          {redGate
            ? `Nothing to approve. A red gate is a fact about the configuration${p.gateKey ? ` (${p.gateKey})` : ''} — it clears when the gate changes in code, with a commit and a reason, and it cannot be declined or sunk in the meantime.`
            : 'Warden raised this without a command, so there is nothing to approve: the approve call echoes the exact command back for a compare-and-swap and there is no string to echo. Ask on the thread below what it wants to run.'}
        </span>
      )}
    </div>
  );
}
