'use client';

/**
 * THE DESK — the Ledger, and the payout run inside it.
 *
 * ⚠️ WHILE PAYMENTS_LIVE IS OFF, EVERY MONEY CONTROL IS THE GATED VARIANT AND
 * DECLINES. It does not open a dialog, it does not error, and it does not
 * pretend to be disabled: it says which switch is off and what is queued
 * behind it. The balances above it are real — that money genuinely is held
 * and genuinely is owed — so the surface has to be honest about both halves
 * at once, or the operator learns to distrust the numbers.
 *
 * ⚠️ HOLD BACK IS NOT MONEY AND WORKS ANYWAY. It changes no balance; it only
 * decides whether a sale is offered to the next run. That is why it is the
 * one payout lever live today.
 */
import * as React from 'react';
import {
  Button,
  Chip,
  DeskShell,
  Drawer,
  FailedRegion,
  IconBanknote,
  IconCheck,
  IconLock,
  MoneyDialog,
  OrderDrawer,
  ResultBlock,
  Ribbon,
  Section,
  SkeletonPile,
  Tag,
  useIsPhone,
} from '@/components/desk';
import {
  fetchPayoutRun,
  formatRandCents,
  holdPayout,
  includePayout,
  type HeldPayoutRow,
  type PayoutRow,
  type PayoutRun,
} from '@/lib/desk-ledger';
import { describeFailure } from '@/lib/desk-auth';

export default function LedgerPage() {
  const [run, setRun] = React.useState<PayoutRun | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [drawer, setDrawer] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; tag: string; body: string } | null>(null);
  const [segment, setSegment] = React.useState('attention');
  /** The sale whose Order drawer is open — a Transaction id. */
  const [orderId, setOrderId] = React.useState<string | null>(null);
  const phone = useIsPhone();

  /**
   * ⚠️ ONE DRAWER AT A TIME. Drawer binds Escape on `document` and defers only
   * to a `.dk-dialog` above it, so two mounted at once both hear one keypress
   * and both close. The run drawer and an order drawer are the same 480px
   * panel in the same place, so stacking them would also look like one drawer
   * that changed its mind. The run closes on the way in.
   */
  const openOrder = React.useCallback((transactionId: string) => {
    setDrawer(false);
    setOrderId(transactionId);
  }, []);

  const load = React.useCallback(async () => {
    try {
      setRun(await fetchPayoutRun());
      setError(null);
    } catch (err) {
      setError(describeFailure(err));
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const gated = run?.gated ?? true;

  const strip = run
    ? [
        { label: 'Payable', value: run.totals.inRunLabel, sub: `${run.totals.saleCount} sales` },
        { label: 'Held back', value: run.totals.heldLabel, sub: `${run.held.length} by you` },
        { label: 'Blocked', value: run.totals.blockedLabel, sub: `${run.blocked.length} by a gate` },
        {
          label: 'Run',
          value: gated ? 'Gated' : 'Ready',
          sub: gated ? 'PAYMENTS_LIVE off' : `${run.totals.sellerCount} sellers`,
          dot: gated ? ('warn' as const) : ('ok' as const),
        },
      ]
    : [];

  return (
    <DeskShell
      active="ledger"
      title="Ledger"
      sub={run ? `${run.totals.saleCount} sales payable` : 'Loading…'}
    >
      {/*
        ⚠️ NO "EXPORT CSV" BUTTON. One used to sit here with no onClick and no
        endpoint behind it — a secondary-variant control that looked exactly
        like Review the run and did nothing at all when pressed. There is no
        export route on the API, so the honest thing is an absent button rather
        than a present one that fails silently. Wire /admin/desk/payouts/export
        first, then put it back.
      */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em' }}>Ledger</span>
      </div>

      {error ? (
        <FailedRegion title="Couldn't load the run" detail={error} onRetry={() => void load()} />
      ) : !run ? (
        <SkeletonPile count={2} />
      ) : (
        <>
          <Ribbon cells={strip} compact={phone} />

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 16px',
              background: 'var(--dk-surface)',
              border: '1px solid var(--dk-line)',
              borderRadius: 'var(--dk-radius-card)',
              flexWrap: 'wrap',
            }}
          >
            {gated ? (
              <Button variant="gated" onClick={() => setDrawer(true)}>
                Payouts are gated
              </Button>
            ) : (
              <Button
                variant="primary"
                icon={IconBanknote}
                amount={run.totals.inRunLabel}
                onClick={() => setConfirm(true)}
              >
                Run payouts
              </Button>
            )}
            <Button variant="ghost" onClick={() => setDrawer(true)}>
              Review the run
            </Button>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 11.5, color: gated ? 'var(--dk-warn)' : 'var(--dk-ink-3)' }}>
              {gated
                ? `PAYMENTS_LIVE is off · ${run.totals.saleCount} sales (${run.totals.inRunLabel}) queued · ${run.held.length} held back`
                : `${run.totals.saleCount} sales · one payout per sale`}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', overflowX: 'auto' }}>
            {[
              ['attention', 'Needs attention', run.blocked.length + run.held.length],
              ['payable', 'Payable', run.totals.saleCount],
              ['held', 'Held back', run.held.length],
              ['blocked', 'Blocked', run.blocked.length],
            ].map(([key, label, count]) => (
              <Chip
                key={key as string}
                active={segment === key}
                count={count as number}
                onClick={() => setSegment(key as string)}
              >
                {label as string}
              </Chip>
            ))}
          </div>

          <PayoutList
            run={run}
            segment={segment}
            gated={gated}
            onChanged={load}
            onError={(m) => setError(m)}
            onOpenOrder={openOrder}
          />
        </>
      )}

      {run ? (
        <Drawer
          open={drawer}
          onClose={() => setDrawer(false)}
          typeLabel="Payout run"
          icon={IconBanknote}
          title={
            <>
              Today&rsquo;s run · <span className="dk-mono">{run.totals.inRunLabel}</span> to{' '}
              {run.totals.sellerCount} {run.totals.sellerCount === 1 ? 'seller' : 'sellers'}
            </>
          }
          meta="One payout per sale · a held sale sits out until you include it"
          tags={
            <>
              <Tag kind="info">{`${run.totals.saleCount} due`}</Tag>
              {run.held.length ? <Tag kind="neutral">{`${run.held.length} held back`}</Tag> : null}
              {run.blocked.length ? <Tag kind="warn">{`${run.blocked.length} blocked`}</Tag> : null}
            </>
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
                  amount={run.totals.inRunLabel}
                  onClick={() => setConfirm(true)}
                >
                  Run payouts
                </Button>
              )}
            </>
          }
        >
          <Section label={`In the run · ${run.totals.saleCount} sales`}>
            {run.inRun.length === 0 ? (
              <Empty>Nothing is due.</Empty>
            ) : (
              run.inRun.map((r) => (
                <SaleRow
                  key={r.id}
                  row={r}
                  gated={gated}
                  onHold={async (reason) => {
                    await holdPayout(r.id, reason);
                    await load();
                  }}
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
                  onInclude={async () => {
                    await includePayout(r.id, 'Included in the run from the Desk');
                    await load();
                  }}
                />
              ))}
            </Section>
          ) : null}

          {run.blocked.length ? (
            <Section label={`Blocked · ${run.blocked.length}`} last>
              {run.blocked.map((r) => (
                <div key={r.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--dk-line)' }}>
                  <RowHead row={r} />
                  {/* ⚠️ NO "OPEN MEMBER" BUTTON. It had no onClick, and it
                      cannot get one yet: a payout row carries the seller's
                      USERNAME, and MemberDrawer opens on a User id. A ghost
                      button that does nothing next to the reason a seller is
                      not being paid is the worst place on this surface to put
                      one. Carry sellerId on the run row, then wire it. */}
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
        </Drawer>
      ) : null}

      {run ? (
        <MoneyDialog
          open={confirm}
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            // The run itself is not wired here — see the handover note. The
            // dialog exists and is correct; the disbursement call is the one
            // piece deliberately left for review.
            setResult({
              ok: false,
              tag: 'not sent',
              body: 'Single-sale and batch disbursement are not wired from the Desk yet.\nSee the Phase 3 handover note.',
            });
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

      {/*
        The sale's dossier, opened over the list. It reads and moves nothing —
        the levers that touch this money are Hold back and Include on the row
        behind it, and the run button above them. See order-drawer.tsx.
      */}
      {orderId ? (
        <OrderDrawer open transactionId={orderId} onClose={() => setOrderId(null)} />
      ) : null}
    </DeskShell>
  );
}

function PayoutList({
  run,
  segment,
  gated,
  onChanged,
  onError,
  onOpenOrder,
}: {
  run: PayoutRun;
  segment: string;
  gated: boolean;
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
  onOpenOrder: (transactionId: string) => void;
}) {
  const rows =
    segment === 'held'
      ? run.held
      : segment === 'blocked'
        ? run.blocked
        : segment === 'payable'
          ? run.inRun
          : [...run.blocked, ...run.held];

  if (rows.length === 0) {
    return (
      <div
        style={{
          padding: '40px 20px',
          textAlign: 'center',
          fontSize: 13,
          color: 'var(--dk-ink-3)',
          background: 'var(--dk-surface)',
          border: '1px solid var(--dk-line)',
          borderRadius: 'var(--dk-radius-card)',
        }}
      >
        {segment === 'attention' ? 'No sales need attention' : 'Nothing here'}
      </div>
    );
  }

  return (
    <div
      style={{
        background: 'var(--dk-surface)',
        border: '1px solid var(--dk-line)',
        borderRadius: 'var(--dk-radius-card)',
        padding: '4px 16px',
      }}
    >
      {rows.map((r) => (
        <div key={r.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--dk-line)' }}>
          {/*
            ⚠️ A ROW IS A BUTTON, NOT A DIV WITH AN onClick. The row is the way
            into the sale's dossier, and it has to be reachable by Tab and
            announced as a control. The Hold back / Include buttons stay
            OUTSIDE it — a button inside a button is invalid markup and the
            inner one stops being operable in some browsers, which on this
            surface means Hold back silently opening a drawer instead.
          */}
          <button
            type="button"
            onClick={() => onOpenOrder(r.id)}
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
            <RowHead row={r} />
          </button>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            {'reason' in r && (r as HeldPayoutRow).reason ? (
              <Tag kind="neutral">{`held · ${(r as HeldPayoutRow).reason}`}</Tag>
            ) : null}
            {r.blockedReason ? (
              <Tag kind="warn" icon={IconLock}>
                {r.blockedReason}
              </Tag>
            ) : null}
            <PayOutButton gated={gated} />
            <Button
              variant="ghost"
              onClick={() => {
                const fn =
                  'reason' in r
                    ? includePayout(r.id, 'Included from the Ledger')
                    : holdPayout(r.id, 'Held from the Ledger');
                void fn.then(onChanged).catch((e) => onError(describeFailure(e)));
              }}
            >
              {'reason' in r ? 'Include' : 'Hold back'}
            </Button>
          </span>
        </div>
      ))}
    </div>
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
      {row.bankVerified ? <Tag kind="ok" icon={IconCheck}>bank</Tag> : null}
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
}: {
  row: PayoutRow;
  gated: boolean;
  onHold: (reason: string) => Promise<void>;
}) {
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--dk-line)' }}>
      <RowHead row={row} />
      <span style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <PayOutButton gated={gated} amount={formatRandCents(row.amountCents)} />
        <Button variant="ghost" onClick={() => void onHold('Held from the run drawer')}>
          Hold back
        </Button>
      </span>
    </div>
  );
}

function HeldRow({ row, onInclude }: { row: HeldPayoutRow; onInclude: () => Promise<void> }) {
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--dk-line)' }}>
      <RowHead row={row} />
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
        <Tag kind="neutral">
          {`by you${row.heldAt ? ` · ${new Date(row.heldAt).toLocaleString('en-ZA', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}` : ''}${row.reason ? ` · ${row.reason}` : ''}`}
        </Tag>
        <Button variant="secondary" onClick={() => void onInclude()}>
          Include
        </Button>
      </span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)' }}>{children}</span>;
}
