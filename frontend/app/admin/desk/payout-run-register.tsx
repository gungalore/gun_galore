'use client';

/**
 * THE DESK — today's payout run, as a drawer over the Now board.
 *
 * 🚨 IT USED TO BE A WHOLE LENS ON A WHOLE PAGE, AND THAT IS WHY A FAILED
 * BATCH COULD REPORT NOTHING. On the Ledger the run had two doors — a
 * board-level "Run payouts" button and a "Review the run" drawer — and the
 * `result` block was rendered only INSIDE the drawer. Drawer returns null when
 * closed (components/desk/overlays.tsx), so a batch started from the board set
 * its outcome into an unmounted subtree: on success the strip refreshed and on
 * FAILURE nothing at all appeared. One door means the outcome is always on
 * screen, because the only place the batch can be started is the place that
 * shows what happened.
 *
 * ⚠️ WHILE PAYMENTS_LIVE IS OFF, EVERY MONEY CONTROL IS THE GATED VARIANT AND
 * DECLINES. It does not open a dialog, it does not error, and it does not
 * pretend to be disabled: it says which switch is off and what is queued
 * behind it. The balances are real — that money genuinely is held and
 * genuinely is owed — so the surface has to be honest about both halves at
 * once, or the operator learns to distrust the numbers.
 *
 * ⚠️ HOLD BACK IS NOT MONEY AND WORKS ANYWAY. It changes no balance; it only
 * decides whether a sale is offered to the next run. That is why it is the one
 * payout lever live today.
 *
 * ⚠️ IT RE-READS ON EVERY OPEN, AND IT HAS TO. The Now board renders only the
 * TOP of its drawer stack — one Drawer mounted means one Escape listener on
 * `document` — so stepping from a run row into that sale's Order drawer
 * unmounts this one entirely. The cost is one extra GET when the operator
 * comes back, and one real loss: a `result` from a batch run just before that
 * step does not survive it. Worth saying out loud rather than discovering.
 */
import * as React from 'react';
import {
  Button,
  Drawer,
  FailedRegion,
  IconBanknote,
  IconCheck,
  IconLock,
  MoneyDialog,
  ResultBlock,
  Section,
  SkeletonPile,
  Tag,
} from '@/components/desk';
import {
  fetchPayoutRun,
  formatRandCents,
  describePayoutRun,
  holdPayout,
  runDuePayouts,
  includePayout,
  type HeldPayoutRow,
  type PayoutRow,
  type PayoutRun,
} from '@/lib/desk-ledger';
import { describeFailure } from '@/lib/desk-auth';

export interface PayoutRunDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Opens the sale's own dossier — a Transaction id, no cart parent. */
  onOpenSale: (transactionId: string) => void;
  /** Called after a hold, an include or a batch, so the board's money line re-reads. */
  onChanged: () => void;
}

export function PayoutRunDrawer({ open, onClose, onOpenSale, onChanged }: PayoutRunDrawerProps) {
  const [run, setRun] = React.useState<PayoutRun | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  /**
   * ⚠️ A SECOND ERROR CHANNEL, BECAUSE ONE WAS DEMONSTRABLY WRONG. On the
   * Ledger, PayoutList's `onError` wrote the SAME state the run's load-failure
   * branch read — so a holdPayout that 400s (the server refuses a reason under
   * five characters) replaced the whole lens with "Couldn't load the run", and
   * its Retry called load(), which succeeded, so the message about the hold
   * vanished unread behind a title that was a claim about the wrong thing.
   */
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  /** A batch is in flight — see the confirm's handler. */
  const [paying, setPaying] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; tag: string; body: string } | null>(
    null,
  );

  /** Only the newest read may write. A close-and-reopen outruns the network. */
  const ticket = React.useRef(0);

  const load = React.useCallback(async () => {
    const mine = ++ticket.current;
    setLoadError(null);
    try {
      const next = await fetchPayoutRun();
      if (ticket.current !== mine) return;
      setRun(next);
    } catch (err) {
      if (ticket.current !== mine) return;
      setLoadError(describeFailure(err));
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    // ⚠️ NOT `if (run) return`. Money held back from a previous visit, or a
    // sale released since, would otherwise be drawn from a stale object the
    // operator is about to act on.
    void load();
  }, [open, load]);

  if (!open) return null;

  const gated = run?.gated ?? true;

  async function act(fn: Promise<unknown>) {
    setActionError(null);
    try {
      await fn;
      await load();
      onChanged();
    } catch (err) {
      setActionError(describeFailure(err));
    }
  }

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        typeLabel="Payout run"
        icon={IconBanknote}
        title={
          run ? (
            <>
              Today&rsquo;s run · <span className="dk-mono">{run.totals.inRunLabel}</span> to{' '}
              {run.totals.sellerCount} {run.totals.sellerCount === 1 ? 'seller' : 'sellers'}
            </>
          ) : (
            <>Today&rsquo;s run</>
          )
        }
        meta="One payout per sale · a held sale sits out until you include it"
        tags={
          run ? (
            <>
              <Tag kind="info">{`${run.totals.saleCount} due`}</Tag>
              {run.held.length ? <Tag kind="neutral">{`${run.held.length} held back`}</Tag> : null}
              {run.blocked.length ? (
                <Tag kind="warn">{`${run.blocked.length} blocked`}</Tag>
              ) : null}
            </>
          ) : null
        }
        note={
          gated
            ? 'Drawn with payments gated. Hold back and Include work now; paying out waits for PAYMENTS_LIVE.'
            : 'Money never undoes. Each sale is a separate payout with its own result.'
        }
        footer={
          <>
            <span style={{ flex: 1 }} />
            {gated ? (
              <Button variant="gated">Payouts are gated</Button>
            ) : (
              <Button
                variant="primary"
                amount={run?.totals.inRunLabel}
                disabled={paying || !run}
                onClick={() => setConfirm(true)}
              >
                {paying ? 'Sending…' : 'Run payouts'}
              </Button>
            )}
          </>
        }
      >
        {loadError ? (
          <FailedRegion
            title="Couldn't load the run"
            detail={loadError}
            onRetry={() => void load()}
          />
        ) : !run ? (
          <SkeletonPile count={2} />
        ) : (
          <>
            {/* An action failure is a strip inside the run, not a region that
                replaces it — the rows it is about are what the operator is
                standing in. */}
            {actionError ? (
              <ResultBlock ok={false} tag="not changed" body={actionError} />
            ) : null}

            <Section label={`In the run · ${run.totals.saleCount} sales`}>
              {run.inRun.length === 0 ? (
                <Empty>Nothing is due.</Empty>
              ) : (
                run.inRun.map((r) => (
                  <SaleRow
                    key={r.id}
                    row={r}
                    gated={gated}
                    onOpen={() => onOpenSale(r.id)}
                    onHold={() => void act(holdPayout(r.id, 'Held from the run drawer'))}
                  />
                ))
              )}
            </Section>

            {run.held.length ? (
              <Section label={`Held back · ${run.held.length}`}>
                {run.held.map((r) => (
                  <HeldRow
                    key={r.id}
                    row={r}
                    onOpen={() => onOpenSale(r.id)}
                    onInclude={() =>
                      void act(includePayout(r.id, 'Included in the run from the Desk'))
                    }
                  />
                ))}
              </Section>
            ) : null}

            {run.blocked.length ? (
              <Section label={`Blocked · ${run.blocked.length}`} last={!result}>
                {run.blocked.map((r) => (
                  <div
                    key={r.id}
                    style={{ padding: '10px 0', borderBottom: '1px solid var(--dk-line)' }}
                  >
                    <RowButton onClick={() => onOpenSale(r.id)}>
                      <RowHead row={r} />
                    </RowButton>
                    {/* ⚠️ NO "OPEN MEMBER" BUTTON. It had no onClick, and it
                        cannot get one yet: a payout row carries the seller's
                        USERNAME, and MemberDrawer opens on a User id. A ghost
                        button that does nothing next to the reason a seller is
                        not being paid is the worst place on this surface to
                        put one. Carry sellerId on the run row, then wire it. */}
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                      <Tag kind="warn" icon={IconLock}>
                        {r.blockedReason ?? 'blocked'}
                      </Tag>
                    </span>
                  </div>
                ))}
              </Section>
            ) : null}

            {result ? (
              <Section label="Result" last>
                <ResultBlock ok={result.ok} tag={result.tag} body={result.body} />
              </Section>
            ) : null}
          </>
        )}
      </Drawer>

      {run ? (
        <MoneyDialog
          open={confirm}
          onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            // 🚨 THIS HANDLER WAS A STUB THAT ALWAYS REPORTED "not sent".
            //
            // runDuePayouts + describePayoutRun were written, tested and
            // imported at the top of the Ledger — and onConfirm still set a
            // hard-coded failure and never touched the network. So the board
            // could say what was owed and to whom, and pressing the button
            // paid nobody, however many times it was pressed.
            //
            // ⚠️ ACCEPTED IS NOT PAID — Peach settles asynchronously and the
            // payout webhook reconciles, which is why describePayoutRun says
            // "accepted by the bank rail" and never "paid". Exactly-once is
            // the server's, via paidOutAt; setPaying only stops a second batch
            // being started while the first is in flight.
            setConfirm(false);
            setPaying(true);
            try {
              const r = await runDuePayouts();
              setResult({
                ok: r.failed === 0,
                tag: r.failed > 0 ? 'partly accepted' : 'accepted',
                body: describePayoutRun(r),
              });
              await load();
              onChanged();
            } catch (err) {
              setResult({ ok: false, tag: 'failed', body: describeFailure(err) });
            } finally {
              setPaying(false);
            }
          }}
          title={
            <>
              Run payouts <span className="dk-mono">{run.totals.inRunLabel}</span>
            </>
          }
          rows={[
            { k: 'Sales', v: `${run.totals.saleCount}, one payout each` },
            { k: 'Sellers', v: String(run.totals.sellerCount) },
            { k: 'Held back', v: `${run.held.length} — not included` },
            { k: 'Then', v: 'Each sale gets its own result, verbatim' },
          ]}
          confirmLabel="Run payouts"
          amount={run.totals.inRunLabel}
        />
      ) : null}
    </>
  );
}

/**
 * The per-sale pay-out control, and why it never becomes a live button here.
 *
 * 🚨 TWO SEPARATE THINGS STOP A PAYOUT AND ONLY ONE OF THEM IS THE GATE.
 * PAYMENTS_LIVE being off is the first. The second is that single-sale
 * disbursement is not wired from the Desk at all — the same gap the run
 * dialog already admits to in words. The rows used to branch on `gated`
 * alone, which meant the day PAYMENTS_LIVE flips on, every row would grow a
 * confident secondary "Pay out… R3,150" with no onClick behind it: a money
 * button that no-ops, discovered by an operator who thinks they have paid a
 * seller. So the control is gated either way and says which of the two is in
 * the way. Delete this component when the disbursement call lands.
 */
function PayOutButton({ gated, amount }: { gated: boolean; amount?: string }) {
  return (
    <Button variant="gated" amount={gated ? undefined : amount}>
      {gated ? 'Pay out is gated' : 'Pay out not wired'}
    </Button>
  );
}

/**
 * ⚠️ A ROW IS A BUTTON, NOT A DIV WITH AN onClick. The row is the way into the
 * sale's dossier, and it has to be reachable by Tab and announced as a
 * control. The Hold back / Include buttons stay OUTSIDE it — a button inside a
 * button is invalid markup and the inner one stops being operable in some
 * browsers, which on this surface means Hold back silently opening a drawer
 * instead.
 */
function RowButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      style={{
        display: 'block',
        width: '100%',
        padding: 0,
        background: 'transparent',
        border: 'none',
        textAlign: 'left',
        font: 'inherit',
        color: 'inherit',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function RowHead({ row }: { row: PayoutRow }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <span className="dk-mono" style={{ fontSize: 12, color: 'var(--dk-ink-2)', flex: 'none' }}>
        {row.reference}
      </span>
      <span
        style={{
          fontSize: 13,
          color: 'var(--dk-ink)',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {row.item}
      </span>
      {row.seller ? (
        <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)', flex: 'none' }}>@{row.seller}</span>
      ) : null}
      {row.bankVerified ? (
        <Tag kind="ok" icon={IconCheck}>
          bank
        </Tag>
      ) : null}
      <span style={{ flex: 1 }} />
      <span
        className="dk-mono"
        style={{ fontSize: 13, fontWeight: 500, color: 'var(--dk-ink)', flex: 'none' }}
      >
        {formatRandCents(row.amountCents)}
      </span>
    </span>
  );
}

function SaleRow({
  row,
  gated,
  onHold,
  onOpen,
}: {
  row: PayoutRow;
  gated: boolean;
  onHold: () => void;
  onOpen: () => void;
}) {
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--dk-line)' }}>
      <RowButton onClick={onOpen}>
        <RowHead row={row} />
      </RowButton>
      <span style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <PayOutButton gated={gated} amount={formatRandCents(row.amountCents)} />
        <Button variant="ghost" onClick={onHold}>
          Hold back
        </Button>
      </span>
    </div>
  );
}

function HeldRow({
  row,
  onInclude,
  onOpen,
}: {
  row: HeldPayoutRow;
  onInclude: () => void;
  onOpen: () => void;
}) {
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--dk-line)' }}>
      <RowButton onClick={onOpen}>
        <RowHead row={row} />
      </RowButton>
      <span
        style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}
      >
        <Tag kind="neutral">
          {`by you${row.heldAt ? ` · ${new Date(row.heldAt).toLocaleString('en-ZA', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}` : ''}${row.reason ? ` · ${row.reason}` : ''}`}
        </Tag>
        <Button variant="secondary" onClick={onInclude}>
          Include
        </Button>
      </span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)' }}>{children}</span>;
}
