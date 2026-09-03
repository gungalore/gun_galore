'use client';

/**
 * THE DESK — the money levers on an order.
 *
 * 🚨 EVERY BUTTON HERE MOVES REAL MONEY AND NONE OF THEM UNDOES. The rest of
 * the Desk is optimistic with a ten-second undo window; nothing on this panel
 * is. Each action is a POST the legacy admin already exposes, so this is parity
 * rather than a new money path, and each writes an audit row against the admin
 * who pressed it.
 *
 * ⚠️ THE CONFIRM RESTATES THE ACT IN WORDS BEFORE IT HAPPENS — who is paid or
 * refunded, how much, and what follows. An operator resolving a dispute at
 * speed is exactly the person a bare "Are you sure?" fails.
 *
 * ⚠️ NO AMOUNT IS DERIVED HERE. A refund clears the remaining balance unless
 * the operator types a figure. Nothing infers one from a price or a fee — the
 * platform has one fee presenter and this is not it.
 */
import * as React from 'react';
import { Button, Input } from './primitives';
import { MoneyDialog, Section } from './overlays';
import { formatRand } from './numbers';
import {
  MIN_REASON_CHARS,
  holdPayout,
  reasonIsUsable,
  refundOrder,
  releaseOrder,
  overrideDealerVerification,
  releasePayoutHold,
  resolveDisputeRelease,
} from '@/lib/desk-order';

type Lever =
  | null
  | 'release'
  | 'dispute-release'
  | 'refund'
  | 'hold'
  | 'unhold'
  | 'dealer-approve'
  | 'dealer-reject';

/**
 * The automated verdict, in the words the confirm needs.
 *
 * ⚠️ NULL AND "PENDING" ARE DIFFERENT, and both are different from a refusal.
 * An operator about to override a machine needs to know whether the machine
 * said no, has not finished, or was never asked — "overriding: nothing" is a
 * sentence that should never appear on a firearms decision.
 */
function humanVerdict(status: string | null): string {
  const s = (status ?? '').toUpperCase();
  if (!s) return 'nothing yet — no automated check has run';
  if (s === 'REJECTED') return 'REJECTED';
  if (s === 'PENDING' || s === 'IN_PROGRESS') return 'it is still checking';
  return s.replace(/_/g, ' ').toLowerCase();
}

export interface OrderActionsProps {
  txId: string;
  /** Cents actually owed to the seller, as the server stored it. */
  sellerPayoutCents: number | null;
  /** Cents the buyer actually paid, as the server stored it. */
  buyerTotalCents: number | null;
  /** Already released? Then releasing again is not offered. */
  released: boolean;
  payoutHeld: boolean;
  /** A complaint sits against this order — changes which release is right. */
  disputed: boolean;
  seller: string;
  buyer: string;
  /**
   * The dealer stock-in verdict, when this sale is a firearm going through a
   * dealer. Null on every other sale, and the override is not offered.
   *
   * 🚨 THIS IS WHY A FIREARM PAYOUT CAN BE STUCK WITH NOTHING TO PRESS.
   * releaseTransaction refuses an isFirearm + DEALER_TRANSFER sale until this
   * reads APPROVED, and the verdict is a model reading three uploaded photos.
   * When it says no and it is wrong, the override is the ONLY way the seller
   * is ever paid — and its endpoint had no caller anywhere in this frontend.
   */
  dealerVerificationStatus?: string | null;
  /** Reload the dossier: every lever changes what it says. */
  onDone: () => void;
}

function Labelled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 11, color: 'var(--dk-ink-3)', letterSpacing: '0.03em' }}>
        {label}
      </span>
      {children}
      {hint ? <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>{hint}</span> : null}
    </label>
  );
}

export function OrderActions({
  txId,
  sellerPayoutCents,
  buyerTotalCents,
  released,
  payoutHeld,
  disputed,
  seller,
  buyer,
  dealerVerificationStatus = null,
  onDone,
}: OrderActionsProps) {
  const [lever, setLever] = React.useState<Lever>(null);
  const [note, setNote] = React.useState('');
  const [partial, setPartial] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);

  function reset() {
    setLever(null);
    setNote('');
    setPartial('');
    setFailed(null);
    setConfirming(false);
  }

  /**
   * ⚠️ BLANK MUST REACH THE CALL AS undefined, NEVER AS 0. Blank means "the
   * whole remaining balance" — the server's rule, not a default invented here —
   * and a 0 would refund nothing while reporting success.
   */
  const partialCents = React.useMemo(() => {
    const t = partial.trim();
    if (!t) return undefined;
    const n = Number(t.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return Math.round(n * 100);
  }, [partial]);

  const amountUnreadable = partial.trim() !== '' && partialCents === undefined;
  const needsReason =
    lever === 'hold' ||
    lever === 'unhold' ||
    lever === 'dealer-approve' ||
    lever === 'dealer-reject';
  const reasonShort = needsReason && note.trim() !== '' && !reasonIsUsable(note);
  const ready = !busy && !amountUnreadable && (!needsReason || reasonIsUsable(note));

  async function run() {
    if (!lever || !ready) return;
    setBusy(true);
    setFailed(null);
    try {
      if (lever === 'release') await releaseOrder(txId, note);
      else if (lever === 'dispute-release') await resolveDisputeRelease(txId, note);
      else if (lever === 'refund') await refundOrder(txId, note, partialCents);
      else if (lever === 'hold') await holdPayout(txId, note);
      else if (lever === 'dealer-approve') await overrideDealerVerification(txId, 'APPROVE', note);
      else if (lever === 'dealer-reject') await overrideDealerVerification(txId, 'REJECT', note);
      else await releasePayoutHold(txId, note);
      reset();
      onDone();
    } catch (err) {
      // The panel stays open on failure. Closing it would leave the operator
      // unsure whether the money moved.
      setFailed(err instanceof Error ? err.message : 'That did not go through.');
      setBusy(false);
      setConfirming(false);
    }
  }

  const payout = sellerPayoutCents === null ? null : formatRand(sellerPayoutCents);
  const paid = buyerTotalCents === null ? null : formatRand(buyerTotalCents);

  function dialogFor(l: Exclude<Lever, null>) {
    if (l === 'refund') {
      const shown =
        partialCents === undefined ? (paid ?? 'the remaining balance') : formatRand(partialCents);
      return {
        title: `Refund ${shown}`,
        amount: shown,
        confirmLabel: 'Refund the buyer',
        rows: [
          { k: 'To', v: buyer },
          {
            k: 'Amount',
            v:
              partialCents === undefined
                ? `${paid ?? 'the remaining balance'} — the full remaining balance`
                : shown,
          },
          { k: 'Then', v: 'The buyer is refunded and the seller is not paid for this line.' },
        ],
      };
    }
    if (l === 'release' || l === 'dispute-release') {
      return {
        title: `Release ${payout ?? 'the payout'}`,
        amount: payout ?? '',
        confirmLabel: l === 'dispute-release' ? 'Release and resolve' : 'Release to the seller',
        rows: [
          { k: 'To', v: seller },
          { k: 'Amount', v: payout ?? 'the stored payout' },
          {
            k: 'Then',
            v:
              l === 'dispute-release'
                ? 'The dispute resolves in the seller’s favour and the payout becomes due.'
                : 'The payout becomes due and the next sweep pays it.',
          },
        ],
      };
    }
    if (l === 'dealer-approve' || l === 'dealer-reject') {
      const approving = l === 'dealer-approve';
      return {
        title: approving ? 'Approve the dealer stock-in' : 'Reject the dealer stock-in',
        // ⚠️ APPROVING SHOWS THE PAYOUT because approving IS one. The server's
        // adminOverride force-releases the held funds and emails the buyer the
        // dealer's details; a confirm that said only "approve the paperwork"
        // would be describing a filing decision while money left the account.
        amount: approving ? (payout ?? '') : '',
        confirmLabel: approving ? 'Approve and release' : 'Reject the stock-in',
        rows: approving
          ? [
              { k: 'To', v: seller },
              { k: 'Amount', v: payout ?? 'the stored payout' },
              {
                k: 'Then',
                v: 'The seller is told the stock-in passed, the held funds are released, and the buyer is sent the dealer’s contact details.',
              },
              {
                k: 'Overriding',
                v: `The automated check said ${humanVerdict(dealerVerificationStatus)}.`,
              },
            ]
          : [
              { k: 'Seller', v: seller },
              {
                k: 'Then',
                v: 'The seller is told the stock-in failed and the payout stays blocked. Nothing moves.',
              },
              {
                k: 'Overriding',
                v: `The automated check said ${humanVerdict(dealerVerificationStatus)}.`,
              },
            ],
      };
    }
    return {
      title: l === 'hold' ? 'Hold this payout' : 'Lift the payout hold',
      amount: payout ?? '',
      confirmLabel: l === 'hold' ? 'Hold the payout' : 'Lift the hold',
      rows: [
        { k: l === 'hold' ? 'Withhold from' : 'Release to', v: seller },
        { k: 'Amount', v: payout ?? 'the stored payout' },
        {
          k: 'Then',
          v:
            l === 'hold'
              ? 'The sweep skips this row until the hold is lifted. Money does not leave.'
              : 'The next sweep picks this row up again and pays it.',
        },
      ],
    };
  }

  const d = lever ? dialogFor(lever) : null;

  return (
    <Section label="Money levers" last>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {!released && (
          <Button
            variant="primary"
            onClick={() => {
              reset();
              setLever(disputed ? 'dispute-release' : 'release');
            }}
          >
            {disputed ? 'Resolve & release…' : 'Release payout…'}
          </Button>
        )}
        <Button
          onClick={() => {
            reset();
            setLever('refund');
          }}
        >
          Refund buyer…
        </Button>
        <Button
          onClick={() => {
            reset();
            setLever(payoutHeld ? 'unhold' : 'hold');
          }}
        >
          {payoutHeld ? 'Lift payout hold…' : 'Hold payout…'}
        </Button>

        {/* ⚠️ ONLY ON A FIREARM SALE GOING THROUGH A DEALER, and only while the
            verdict is not already APPROVED. Offering it everywhere would put a
            firearms control on every second-hand optic; offering it after
            approval would invite a second release on a sale already paid. */}
        {dealerVerificationStatus && dealerVerificationStatus.toUpperCase() !== 'APPROVED' && (
          <>
            <Button
              onClick={() => {
                reset();
                setLever('dealer-approve');
              }}
            >
              Approve stock-in…
            </Button>
            <Button
              onClick={() => {
                reset();
                setLever('dealer-reject');
              }}
            >
              Reject stock-in…
            </Button>
          </>
        )}
      </div>

      {/* ⚠️ COMPOSE FIRST, CONFIRM SECOND. The inputs sit outside the dialog on
          purpose: a confirm that also collects is a confirm people learn to
          click through, and the restatement then describes something the
          operator has not finished typing. */}
      {lever && (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {lever === 'refund' && (
            <Labelled
              label="Amount in rands — leave blank to refund the whole remaining balance"
              hint={
                partialCents === undefined && partial.trim() === ''
                  ? `Blank refunds ${paid ?? 'the remaining balance'}.`
                  : undefined
              }
            >
              <Input
                value={partial}
                onChange={(e) => setPartial(e.target.value)}
                placeholder="blank = full refund"
                inputMode="decimal"
                error={amountUnreadable ? 'That is not an amount I can send.' : undefined}
              />
            </Labelled>
          )}

          <Labelled
            label={
              needsReason
                ? `Reason — recorded in the audit log, at least ${MIN_REASON_CHARS} characters`
                : 'Note for the audit trail'
            }
          >
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              error={
                reasonShort
                  ? `Too short — the server refuses anything under ${MIN_REASON_CHARS} characters.`
                  : undefined
              }
            />
          </Labelled>

          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" disabled={!ready} onClick={() => setConfirming(true)}>
              Review…
            </Button>
            <Button variant="ghost" onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {failed && (
        <p style={{ marginTop: 10, color: 'var(--dk-bad)', fontSize: 12.5 }} role="alert">
          {failed}
        </p>
      )}

      {d && confirming && (
        <MoneyDialog
          open
          onCancel={() => setConfirming(false)}
          onConfirm={run}
          title={d.title}
          rows={d.rows}
          confirmLabel={d.confirmLabel}
          amount={d.amount}
          loading={busy}
        />
      )}
    </Section>
  );
}
