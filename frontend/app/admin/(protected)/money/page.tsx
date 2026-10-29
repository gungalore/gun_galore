'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ActionRow,
  EmptyState,
  KpiTile,
  NeonCard,
  Pill,
  SkeletonRows,
  ToggleSwitch,
  useAdminToast,
  type AdminTone,
} from '@/components/admin/admin-ui';
import { ConfirmDialog, ReasonDialog } from '@/components/admin/admin-confirm';
import { RefundDialog } from '@/components/admin/refund-dialog';
import { AdminDrawer } from '@/components/admin/admin-drawer';
import { useAdminSession } from '@/components/admin/admin-session';
import { useAdminPoll } from '@/lib/use-admin-poll';
import {
  adminFetch,
  formatRand,
  formatWhen,
  type HeldFunds,
  type Paginated,
  type PayoutsDue,
  type TransactionRow,
} from '@/lib/admin-api';

const STATUS_TONE: Record<string, AdminTone> = {
  HELD: 'amber',
  RELEASED: 'green',
  DISPUTED: 'red',
  REFUNDED: 'purple',
  PENDING_ADMIN_VERIFICATION: 'amber',
};

/**
 * The queues an operator actually works, each one a (status, filter) pair the
 * backend already supports. They are not decorative: every chip reproduces its
 * rows exactly, which is what makes the Warden deep links land somewhere useful.
 */
const QUEUE_FILTERS: Array<{
  id: string;
  label: string;
  status: 'HELD' | 'ALL' | 'RELEASED' | 'DISPUTED' | 'REFUNDED';
  filter?: string;
}> = [
  { id: 'held', label: 'Held', status: 'HELD' },
  { id: 'disputed', label: 'Disputed', status: 'DISPUTED' },
  { id: 'accept-stalled', label: 'Accept stalled 48h+', status: 'HELD', filter: 'accept-stalled' },
  { id: 'dispatch-overdue', label: 'Dispatch overdue 24h+', status: 'HELD', filter: 'dispatch-overdue' },
  { id: 'dealer-review', label: 'Dealer review', status: 'HELD', filter: 'dealer-review' },
  { id: 'released', label: 'Released', status: 'RELEASED' },
  { id: 'refunded', label: 'Refunded', status: 'REFUNDED' },
  { id: 'all', label: 'All', status: 'ALL' },
];

interface MoneyRow {
  count?: number;
  cents?: number;
  [key: string]: unknown;
}

type MoneyLever =
  | { kind: 'release'; id: string }
  | { kind: 'refund'; id: string }
  | { kind: 'hold'; id: string }
  | { kind: 'release-hold'; id: string }
  | { kind: 'resolve-release'; id: string }
  | { kind: 'dealer'; id: string; decision: 'APPROVE' | 'REJECT' };

export default function MoneyPage() {
  const { isGod } = useAdminSession();
  const { toast } = useAdminToast();
  const [queue, setQueue] = useState(QUEUE_FILTERS[0]);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const [lever, setLever] = useState<MoneyLever | null>(null);
  // The requested payout mode while its confirm dialog is open. null = closed.
  const [modeDialog, setModeDialog] = useState<boolean | null>(null);
  const status = queue.status;
  const filter = queue.filter;

  // Deep links from Warden: ?status=DISPUTED or ?filter=dispatch-overdue.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wantedFilter = params.get('filter');
    const wantedStatus = params.get('status');
    const match = wantedFilter
      ? QUEUE_FILTERS.find((q) => q.filter === wantedFilter)
      : wantedStatus
        ? QUEUE_FILTERS.find((q) => !q.filter && q.status === wantedStatus)
        : undefined;
    if (match) setQueue(match);
  }, []);

  function chooseQueue(next: (typeof QUEUE_FILTERS)[number]) {
    setQueue(next);
    setPage(1);
    const url = new URL(window.location.href);
    url.searchParams.delete('filter');
    url.searchParams.delete('status');
    if (next.filter) url.searchParams.set('filter', next.filter);
    else if (next.status !== 'HELD') url.searchParams.set('status', next.status);
    window.history.replaceState({}, '', url);
  }

  const due = useAdminPoll<PayoutsDue>(
    () => adminFetch<PayoutsDue>('/admin/manual-payments/payouts-due'),
    30_000,
  );
  const held = useAdminPoll<HeldFunds>(
    () => adminFetch<HeldFunds>('/admin/manual-payments/held-funds'),
    30_000,
  );
  const zoho = useAdminPoll<unknown>(
    () => adminFetch<unknown>('/admin/manual-payments/zoho-failed'),
    60_000,
  );
  const txns = useAdminPoll<Paginated<TransactionRow>>(
    () =>
      adminFetch<Paginated<TransactionRow>>(
        `/admin/transactions?status=${status}&page=${page}&limit=30${
          filter ? `&filter=${filter}` : ''
        }`,
      ),
    30_000,
    [status, page, filter],
  );

  const payouts = due.data?.payouts ?? [];
  const payoutTotal = payouts.reduce(
    (sum, p) => sum + (typeof p.amountCents === 'number' ? p.amountCents : 0),
    0,
  );

  const heldRows = useMemo(() => {
    if (!held.data) return [];
    const keys: Array<[string, string]> = [
      ['heldAwaitingRelease', 'Held from buyers'],
      ['owedToSellers', 'Owed to sellers'],
      ['owedToBuyerRefunds', 'Owed to buyers (refunds)'],
    ];
    return keys
      .map(([key, label]) => {
        const value = held.data?.[key] as MoneyRow | undefined;
        if (!value || typeof value !== 'object') return null;
        return { label, count: value.count ?? 0, cents: value.cents ?? 0 };
      })
      .filter((v): v is { label: string; count: number; cents: number } => v !== null);
  }, [held.data]);

  const totalClientFunds = held.data?.totalClientFundsCents;

  const rows: TransactionRow[] =
    (txns.data?.transactions as TransactionRow[] | undefined) ??
    txns.data?.rows ??
    [];
  const total = (txns.data?.total as number | undefined) ?? rows.length;

  async function runPayouts() {
    await adminFetch('/admin/manual-payments/run-payouts', { method: 'POST' });
    toast('Payout batch submitted to Ozow. Rows update as the webhook settles.');
    due.refresh();
    txns.refresh();
  }

  const autoPayoutsEnabled = due.data?.autoPayoutsEnabled === true;

  async function setAutoPayouts(enabled: boolean, reason: string) {
    await adminFetch('/admin/settings/auto_payouts_enabled', {
      method: 'PATCH',
      body: JSON.stringify({ value: enabled ? 'true' : 'false', reason }),
    });
    toast(enabled ? 'Auto payouts enabled.' : 'Auto payouts disabled — manual only.');
    due.refresh();
  }

  function leverBody(kind: MoneyLever): {
    title: string;
    body: string;
    confirmLabel: string;
    danger?: boolean;
    minLength?: number;
    run: (reason: string) => Promise<void>;
  } {
    const id = kind.id;
    switch (kind.kind) {
      case 'release':
        return {
          title: 'Release funds to seller?',
          body: 'This moves the held money out of the protected balance and into the seller’s payout queue.',
          confirmLabel: 'Release funds',
          minLength: 3,
          run: async (reason) => {
            await adminFetch(`/admin/transactions/${id}/release`, {
              method: 'POST',
              body: JSON.stringify({ reason }),
            });
            toast('Funds released.');
            txns.refresh();
          },
        };
      case 'refund':
        return {
          title: 'Refund the buyer?',
          body: 'The gateway refund runs FIRST, then the ledger is marked. The amount is the full buyer total unless the dossier says otherwise.',
          confirmLabel: 'Refund buyer',
          danger: true,
          minLength: 3,
          run: async (reason) => {
            await adminFetch(`/admin/transactions/${id}/refund`, {
              method: 'POST',
              body: JSON.stringify({ note: reason }),
            });
            toast('Refund submitted to the gateway.');
            txns.refresh();
            held.refresh();
          },
        };
      case 'hold':
        return {
          title: 'Hold this payout?',
          body: 'Withholds a due payout from the next batch. The seller keeps the money owed; it simply does not move yet.',
          confirmLabel: 'Hold payout',
          minLength: 5,
          run: async (reason) => {
            await adminFetch(`/admin/transactions/${id}/hold-payout`, {
              method: 'POST',
              body: JSON.stringify({ reason }),
            });
            toast('Payout held.');
            txns.refresh();
          },
        };
      case 'release-hold':
        return {
          title: 'Release the payout hold?',
          body: 'The payout returns to the next batch run.',
          confirmLabel: 'Release hold',
          minLength: 3,
          run: async (reason) => {
            await adminFetch(`/admin/transactions/${id}/release-payout-hold`, {
              method: 'POST',
              body: JSON.stringify({ reason }),
            });
            toast('Payout hold released.');
            txns.refresh();
          },
        };
      case 'resolve-release':
        return {
          title: 'Release the funds to the seller?',
          body: 'This resolves a DISPUTED order in the seller’s favour and queues their payout. Refunding the buyer instead is the other lever and closes the dispute the opposite way.',
          confirmLabel: 'Release to seller',
          danger: true,
          minLength: 5,
          run: async (reason) => {
            await adminFetch(`/admin/transactions/${id}/resolve-dispute-release`, {
              method: 'POST',
              body: JSON.stringify({ reason }),
            });
            toast('Dispute resolved in the seller’s favour.');
            txns.refresh();
            due.refresh();
          },
        };
      case 'dealer':
        return {
          title:
            kind.decision === 'APPROVE'
              ? 'Approve dealer verification?'
              : 'Reject dealer verification?',
          body:
            kind.decision === 'APPROVE'
              ? 'Approving releases the seller’s money. Confirm the SAPS 534, the stock register and the serial match in the dossier before you do.'
              : 'A rejection returns the sale to the dispute path.',
          confirmLabel: kind.decision === 'APPROVE' ? 'Approve' : 'Reject',
          danger: kind.decision === 'REJECT',
          minLength: 5,
          run: async (reason) => {
            await adminFetch(
              `/admin/transactions/${id}/dealer-verification/override`,
              {
                method: 'POST',
                body: JSON.stringify({ decision: kind.decision, reason }),
              },
            );
            toast(`Dealer verification ${kind.decision.toLowerCase()}d.`);
            txns.refresh();
          },
        };
    }
  }

  const active = rows.find((r) => r.id === openId) ?? null;

  return (
    <>
      {/* Payout radar */}
      <NeonCard
        tone="cyan"
        title="Disbursement radar"
        action={<Pill tone="cyan">OZOW PAYOUTS</Pill>}
      >
        <div className="adm-spread">
          <div>
            <div className="adm-kpi-label">Due for immediate release</div>
            <div
              className="adm-mono"
              style={{ fontSize: 26, fontWeight: 800 }}
            >
              {formatRand(payoutTotal)}
            </div>
            <div className="adm-sub">
              {payouts.length} {payouts.length === 1 ? 'seller' : 'sellers'} waiting
              {(due.data?.skipped?.length ?? 0) > 0
                ? ` · ${due.data?.skipped?.length} skipped by the KYC gate`
                : ''}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="adm-kpi-label">Client money held</div>
            <div
              className="adm-mono"
              style={{ fontSize: 16, fontWeight: 700, color: 'var(--adm-amber)' }}
            >
              {formatRand(typeof totalClientFunds === 'number' ? totalClientFunds : 0)}
            </div>
          </div>
        </div>
        <div className="adm-toggle-row">
          <span className="adm-toggle-text">
            <span className="adm-toggle-name">
              Payout mode
              <Pill tone={autoPayoutsEnabled ? 'green' : 'amber'}>
                {autoPayoutsEnabled ? 'AUTO' : 'MANUAL'}
              </Pill>
            </span>
            <span className="adm-toggle-hint">
              {autoPayoutsEnabled
                ? 'Due seller payouts are disbursed automatically every 30 minutes. Turn off to return to operator-triggered batches only.'
                : 'Nothing leaves the float until you run the batch below. Turn on to disburse due payouts automatically every 30 minutes.'}
            </span>
          </span>
          <ToggleSwitch
            checked={autoPayoutsEnabled}
            danger
            disabled={!isGod}
            label="Automatic payouts"
            onChange={(next) => setModeDialog(next)}
          />
        </div>
        <button
          type="button"
          className="adm-btn"
          data-tone="green"
          disabled={!isGod || payouts.length === 0}
          title={isGod ? undefined : 'Read-only admin tier'}
          onClick={() => setRunOpen(true)}
        >
          Execute batch payouts ({payouts.length})
        </button>
      </NeonCard>

      {/* Held funds breakdown */}
      <NeonCard title="Client funds position">
        {held.loading && !held.data ? (
          <SkeletonRows rows={3} />
        ) : held.error ? (
          <EmptyState icon="alert" title="Held funds unavailable" caption={held.error} />
        ) : (
          heldRows.map((row) => (
            <div key={row.label} className="adm-row" style={{ cursor: 'default' }}>
              <span className="adm-row-text">
                <span className="adm-row-title">{row.label}</span>
                <span className="adm-row-caption">{row.count} rows</span>
              </span>
              <span className="adm-mono" style={{ fontWeight: 700 }}>
                {formatRand(row.cents)}
              </span>
            </div>
          ))
        )}
        <div className="adm-spread" style={{ paddingTop: 4 }}>
          <span className="adm-label">Total client funds</span>
          <span
            className="adm-mono"
            style={{ color: 'var(--adm-cyan)', fontWeight: 800 }}
          >
            {formatRand(typeof totalClientFunds === 'number' ? totalClientFunds : 0)}
          </span>
        </div>
      </NeonCard>

      {/* Filters */}
      <div className="adm-scroll-x">
        {QUEUE_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className="adm-chip"
            data-active={queue.id === f.id}
            onClick={() => chooseQueue(f)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Transactions */}
      <NeonCard
        title="Transactions"
        action={
          <Pill tone="muted">
            {total} {queue.id === 'all' ? 'TOTAL' : queue.label.toUpperCase()}
          </Pill>
        }
      >
        {txns.loading && !txns.data ? (
          <SkeletonRows rows={5} />
        ) : txns.error ? (
          <EmptyState icon="alert" title="Transactions unavailable" caption={txns.error} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nothing in this queue"
            caption="Change the filter above to widen the view."
          />
        ) : (
          rows.map((tx) => (
            <ActionRow
              key={tx.id}
              icon="wallet"
              tone={STATUS_TONE[tx.paymentStatus ?? ''] ?? 'cyan'}
              title={tx.listing?.title ?? `Transaction ${tx.id.slice(0, 8)}`}
              caption={
                <>
                  @{tx.seller?.username ?? 'unknown'} ·{' '}
                  {formatWhen(tx.createdAt)}
                </>
              }
              trailing={
                <>
                  <span className="adm-mono" style={{ fontWeight: 700 }}>
                    {formatRand(tx.buyerTotal ?? tx.amountCents ?? 0)}
                  </span>
                  <Pill tone={STATUS_TONE[tx.paymentStatus ?? ''] ?? 'muted'}>
                    {tx.paymentStatus ?? '—'}
                  </Pill>
                </>
              }
              onClick={() => setOpenId(tx.id)}
            />
          ))
        )}
        {(txns.data?.total ?? 0) > page * 30 ? (
          <button
            type="button"
            className="adm-btn"
            data-tone="ghost"
            onClick={() => setPage((p) => p + 1)}
          >
            Load more
          </button>
        ) : null}
      </NeonCard>

      {/* Zoho radar */}
      <NeonCard
        title="Zoho sync failures"
        action={
          <Pill tone={Array.isArray(zoho.data) && zoho.data.length > 0 ? 'amber' : 'green'}>
            {Array.isArray(zoho.data) ? zoho.data.length : zoho.error ? '?' : 0}
          </Pill>
        }
      >
        <p className="adm-sub" style={{ margin: 0 }}>
          Anything listed by the accounting sync when it fails. Retry is per
          transaction from its dossier.
        </p>
        {Array.isArray(zoho.data) && zoho.data.length > 0 ? (
          zoho.data.slice(0, 6).map((row, i) => (
            <div
              key={i}
              className="adm-row"
              style={{ cursor: 'default' }}
            >
              <span className="adm-row-text">
                <span className="adm-row-title">
                  {(row as { reference?: string; id?: string }).reference ??
                    (row as { id?: string }).id ??
                    'Failed sync'}
                </span>
              </span>
              <Pill tone="amber">FAILED</Pill>
            </div>
          ))
        ) : (
          <EmptyState title="Accounting is in sync" />
        )}
      </NeonCard>

      {/* Drawer */}
      <TransactionDrawer
        row={active}
        isGod={isGod}
        onClose={() => setOpenId(null)}
        onLever={(l) => setLever(l)}
        onToast={(m) => toast(m)}
        onChanged={() => {
          txns.refresh();
          due.refresh();
        }}
      />

      <ConfirmDialog
        open={runOpen}
        title="Run the seller payout batch?"
        body={`This sends ${formatRand(payoutTotal)} across ${payouts.length} seller${
          payouts.length === 1 ? '' : 's'
        } to their banks through Ozow. Rows Ozow rejects stay queued.`}
        confirmLabel="Run payouts"
        danger
        onClose={() => setRunOpen(false)}
        onConfirm={runPayouts}
      />

      <ReasonDialog
        open={modeDialog !== null}
        title={modeDialog ? 'Turn on automatic payouts?' : 'Return to manual payouts?'}
        body={
          modeDialog
            ? 'Due seller payouts will be sent to their banks automatically every 30 minutes, without an operator pressing the batch button. Real money leaves the float on each run.'
            : 'The automatic sweep stops. Nothing leaves the float until you run the payout batch yourself.'
        }
        confirmLabel={modeDialog ? 'Turn on auto payouts' : 'Go manual'}
        danger
        minLength={15}
        onClose={() => setModeDialog(null)}
        onConfirm={(reason) => setAutoPayouts(modeDialog === true, reason)}
      />

      {lever?.kind === 'refund' ? (
        <RefundDialog
          open
          row={rows.find((r) => r.id === lever.id) ?? null}
          onClose={() => setLever(null)}
          onDone={() => {
            toast('Refund submitted to the gateway.');
            txns.refresh();
            held.refresh();
          }}
        />
      ) : lever ? (
        <ReasonDialog
          open
          title={leverBody(lever).title}
          body={leverBody(lever).body}
          confirmLabel={leverBody(lever).confirmLabel}
          danger={leverBody(lever).danger}
          minLength={leverBody(lever).minLength}
          onClose={() => setLever(null)}
          onConfirm={leverBody(lever).run}
        />
      ) : null}
    </>
  );
}

function TransactionDrawer({
  row,
  isGod,
  onClose,
  onLever,
  onToast,
  onChanged,
}: {
  row: TransactionRow | null;
  isGod: boolean;
  onClose: () => void;
  onLever: (lever: MoneyLever) => void;
  onToast: (message: string) => void;
  onChanged: () => void;
}) {
  const open = row !== null;
  const id = row?.id ?? '';
  const status = row?.paymentStatus ?? '';
  const dealerPending =
    (row as { dealerVerificationStatus?: string } | null)
      ?.dealerVerificationStatus === 'PENDING_ADMIN_REVIEW';

  // ⚠️ NOTHING RENDERS WHILE CLOSED, and the drawer is the SHARED component so
  // this board gets the same drag-to-dismiss, Escape and focus trap as every
  // other board. It used to be hand-rolled here, which is how Money ended up
  // with a window parked below the viewport and no keyboard exit.
  if (!open) return null;

  return (
    <AdminDrawer
      open
      onClose={onClose}
      title={row?.listing?.title ?? 'Transaction'}
      subtitle={`#${id.slice(0, 10)} · ${formatWhen(row?.createdAt)}`}
      badge={status || '—'}
      badgeTone={STATUS_TONE[status] ?? 'muted'}
    >
      <div className="adm-card" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <div className="adm-spread">
            <span className="adm-sub">Buyer paid</span>
            <span className="adm-mono" style={{ fontWeight: 700 }}>
              {formatRand(row?.buyerTotal ?? 0)}
            </span>
          </div>
          <div className="adm-spread">
            <span className="adm-sub">Seller</span>
            <span className="adm-mono">@{row?.seller?.username ?? '—'}</span>
          </div>
          <div className="adm-spread">
            <span className="adm-sub">Buyer</span>
            <span className="adm-mono">@{row?.buyer?.username ?? '—'}</span>
          </div>
        </div>

        {dealerPending ? (
          <NeonCard tone="red" title="Dealer verification waiting">
            <p className="adm-sub" style={{ margin: 0 }}>
              A human must check the SAPS 534, the stock register and the serial
              match. The buyer’s money stays held until then.
            </p>
          </NeonCard>
        ) : null}

        <div
          className="adm-label"
          style={{ color: isGod ? 'var(--adm-cyan)' : 'var(--adm-ink-2)' }}
        >
          {isGod ? 'Disbursement levers' : 'Read-only admin tier — no levers'}
        </div>

        <div className="adm-grid-2">
          <button
            type="button"
            className="adm-btn"
            data-tone="green"
            disabled={!isGod || status !== 'HELD'}
            onClick={() => onLever({ kind: 'release', id })}
          >
            Release funds
          </button>
          <button
            type="button"
            className="adm-btn"
            data-tone="red"
            disabled={!isGod || !['HELD', 'DISPUTED'].includes(status)}
            onClick={() => onLever({ kind: 'refund', id })}
          >
            Refund buyer
          </button>
          {status === 'DISPUTED' ? (
            <button
              type="button"
              className="adm-btn"
              data-tone="green"
              disabled={!isGod}
              onClick={() => onLever({ kind: 'resolve-release', id })}
            >
              Release to seller
            </button>
          ) : null}
          <button
            type="button"
            className="adm-btn"
            data-tone="ghost"
            disabled={!isGod}
            onClick={() => onLever({ kind: 'hold', id })}
          >
            Freeze payout
          </button>
          <button
            type="button"
            className="adm-btn"
            data-tone="ghost"
            disabled={!isGod}
            onClick={() => onLever({ kind: 'release-hold', id })}
          >
            Release hold
          </button>
        </div>

        {dealerPending ? (
          <div className="adm-grid-2">
            <button
              type="button"
              className="adm-btn"
              data-tone="green"
              disabled={!isGod}
              onClick={() => onLever({ kind: 'dealer', id, decision: 'APPROVE' })}
            >
              Approve dealer
            </button>
            <button
              type="button"
              className="adm-btn"
              data-tone="red"
              disabled={!isGod}
              onClick={() => onLever({ kind: 'dealer', id, decision: 'REJECT' })}
            >
              Reject dealer
            </button>
          </div>
        ) : null}

        <button
          type="button"
          className="adm-btn"
          data-tone="ghost"
          disabled={!isGod}
          onClick={() => {
            void adminFetch(`/admin/transactions/${id}/zoho-retry`, {
              method: 'POST',
            })
              .then(() => {
                onToast('Zoho sync re-fired.');
                onChanged();
              })
              .catch((err: unknown) =>
                onToast(err instanceof Error ? err.message : 'Retry failed'),
              );
          }}
        >
          Re-sync Zoho Books
        </button>
    </AdminDrawer>
  );
}
