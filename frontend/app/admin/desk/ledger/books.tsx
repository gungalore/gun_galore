'use client';

/**
 * THE DESK — Books, the Ledger's fourth lens.
 *
 * 🚨 BOTH ENDPOINTS EXISTED AND NEITHER HAD A CALLER. GET held-funds is the
 * client-money position — how much of the bank balance is somebody else's —
 * and GET zoho-failed is every record whose latest Books sync failed. The
 * Ledger could pay sellers and could not tell you what was owed in total, and
 * a commission invoice that never reached Books was invisible unless an
 * operator happened to open that exact sale.
 *
 * ⚠️ THE POSITION IS A POINT IN TIME AND THE RADAR IS A LIST. They share a
 * lens because both are back-office accounting rather than per-order work, and
 * an operator reconciling the account wants both in one place.
 */

import * as React from 'react';
import { Button, Chip, FailedRegion, Label, SkeletonPile, Tag } from '@/components/desk';
import { formatRandCents } from '@/lib/desk-ledger';
import {
  ZOHO_ARMS,
  describeRadarTotal,
  fetchHeldFunds,
  fetchZohoFailed,
  fundsBuckets,
  missingSwapLegs,
  refundsBucketApplies,
  type HeldFunds,
  type ZohoFailed,
} from '@/lib/desk-books';
import { describeFailure } from '@/lib/desk-auth';

const ARM_TONE = {
  actionable: 'warn',
  'manual-only': 'neutral',
  stuck: 'bad',
} as const;

const ARM_LABEL = {
  actionable: 'can be retried',
  'manual-only': 'needs Zoho by hand',
  stuck: 'will not clear itself',
} as const;

export function Books({ onOpenSale }: { onOpenSale: (transactionId: string) => void }) {
  const [funds, setFunds] = React.useState<HeldFunds | null>(null);
  const [radar, setRadar] = React.useState<ZohoFailed | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [arm, setArm] = React.useState<'transactions' | 'subscriptionCharges' | 'swaps'>(
    'transactions',
  );
  const ticket = React.useRef(0);

  const load = React.useCallback(async () => {
    const mine = ++ticket.current;
    setFunds(null);
    setRadar(null);
    setFailure(null);
    try {
      const [f, z] = await Promise.all([fetchHeldFunds(), fetchZohoFailed()]);
      if (ticket.current !== mine) return;
      setFunds(f);
      setRadar(z);
    } catch (err) {
      if (ticket.current !== mine) return;
      setFailure(describeFailure(err));
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (failure) {
    return <FailedRegion title="Couldn't read the books" detail={failure} onRetry={() => void load()} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── The position ───────────────────────────────────────────── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, paddingBottom: 8 }}>
          <Label>Client funds</Label>
          <span style={{ flex: 1 }} />
          {funds ? (
            <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>
              {`as at ${new Date(funds.asOf).toLocaleString('en-ZA', {
                timeZone: 'Africa/Johannesburg',
                dateStyle: 'medium',
                timeStyle: 'short',
              })} SAST`}
            </span>
          ) : null}
        </div>

        {!funds ? (
          <SkeletonPile count={2} />
        ) : (
          <div
            style={{
              background: 'var(--dk-surface)',
              border: '1px solid var(--dk-line)',
              borderRadius: 'var(--dk-radius-card)',
              padding: '14px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>
                {formatRandCents(funds.totalClientFundsCents)}
              </span>
              <span style={{ fontSize: 12, color: 'var(--dk-ink-3)' }}>
                of the bank balance is not ours
              </span>
            </div>

            {fundsBuckets(funds).map((b, i, arr) => {
              // 🚨 A BUCKET THAT DOES NOT APPLY RENDERS AS AN EM DASH, NEVER
              // AS R0.00. The refunds query is SKIPPED ENTIRELY unless
              // PAYMENT_MODE is manual, so a zero there was never measured —
              // and a measured-looking zero on a money surface is the exact
              // failure the credits card was rebuilt to stop.
              const applies = b.key !== 'refunds' || refundsBucketApplies(funds.paymentMode);
              return (
                <div
                  key={b.key}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                    padding: '8px 0',
                    borderTop: '1px solid var(--dk-line)',
                    borderBottom: i === arr.length - 1 ? undefined : undefined,
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <span style={{ fontSize: 12.5, color: 'var(--dk-ink)', flex: 1 }}>
                      {b.label}
                    </span>
                    <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>
                      {applies ? `${b.bucket.count} ${b.bucket.count === 1 ? 'row' : 'rows'}` : ''}
                    </span>
                    <span
                      className="dk-mono"
                      style={{
                        fontSize: 12.5,
                        color: applies ? 'var(--dk-ink)' : 'var(--dk-ink-3)',
                        minWidth: 96,
                        textAlign: 'right',
                      }}
                    >
                      {applies ? formatRandCents(b.bucket.cents) : '—'}
                    </span>
                  </span>
                  {b.note ? (
                    <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)', lineHeight: 1.45 }}>
                      {b.note}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── The radar ──────────────────────────────────────────────── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, paddingBottom: 8 }}>
          <Label>Not in Books</Label>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" onClick={() => void load()}>
            Re-read
          </Button>
        </div>

        {!radar ? (
          <SkeletonPile count={2} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* ⚠️ "AT LEAST", WHEN ANY ARM IS AT ITS CAP. Each list is take:50
                server-side, so totalFailed is a floor — 50 failures and 500
                both report 50, and a flat number would say something measured
                about a set nobody counted. */}
            <span style={{ fontSize: 12.5, color: 'var(--dk-ink-2)' }}>
              {describeRadarTotal(radar)}
            </span>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(
                [
                  ['transactions', 'Sales', radar.transactions.length],
                  ['subscriptionCharges', 'Subscriptions', radar.subscriptionCharges.length],
                  ['swaps', 'Swap fees', radar.swaps.length],
                ] as const
              ).map(([key, label, count]) => (
                <Chip key={key} active={arm === key} count={count} onClick={() => setArm(key)}>
                  {label}
                </Chip>
              ))}
            </div>

            {/* 🚨 THE ARMS ARE NOT THE SAME KIND OF THING, so each says what
                can actually be done about a row in it. Two of the three key on
                columns nothing in the backend ever writes, and the swap arm's
                service comment promises a retry cron that does not exist —
                presenting all three identically would send an operator
                chasing lists that cannot be worked. */}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '9px 12px',
                borderRadius: 'var(--dk-radius-control)',
                background: 'var(--dk-inset)',
                border: '1px solid var(--dk-line-2)',
              }}
            >
              <Tag kind={ARM_TONE[ZOHO_ARMS[arm].kind]}>{ARM_LABEL[ZOHO_ARMS[arm].kind]}</Tag>
              <span style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--dk-ink-2)', flex: 1 }}>
                {ZOHO_ARMS[arm].guidance}
              </span>
            </div>

            <div
              style={{
                background: 'var(--dk-surface)',
                border: '1px solid var(--dk-line)',
                borderRadius: 'var(--dk-radius-card)',
                overflow: 'hidden',
              }}
            >
              {arm === 'transactions' ? (
                radar.transactions.length === 0 ? (
                  <Empty>Every commission invoice has reached Books.</Empty>
                ) : (
                  radar.transactions.map((t, i, arr) => (
                    <RadarRow
                      key={t.id}
                      last={i === arr.length - 1}
                      // The one arm with a repair — opens the sale, where the
                      // Books fold and its Retry button live.
                      onOpen={() => onOpenSale(t.id)}
                      reference={t.orderReference ?? t.id.slice(0, 8)}
                      title={t.zohoSyncError ?? 'Failed with no error recorded'}
                      when={t.zohoSyncLastAttemptAt}
                    />
                  ))
                )
              ) : arm === 'subscriptionCharges' ? (
                radar.subscriptionCharges.length === 0 ? (
                  <Empty>No subscription receipt is missing.</Empty>
                ) : (
                  radar.subscriptionCharges.map((c, i, arr) => (
                    <RadarRow
                      key={c.id}
                      last={i === arr.length - 1}
                      reference={c.orderReference ?? c.id.slice(0, 8)}
                      title={c.errorMessage ?? 'No receipt raised'}
                      when={c.chargedAt}
                    />
                  ))
                )
              ) : radar.swaps.length === 0 ? (
                <Empty>No completed swap is missing a fee receipt.</Empty>
              ) : (
                radar.swaps.map((s, i, arr) => (
                  <RadarRow
                    key={s.id}
                    last={i === arr.length - 1}
                    reference={s.initiatorFundingRef ?? s.id.slice(0, 8)}
                    title={`No fee receipt for the ${missingSwapLegs(s).join(' and ')} leg`}
                    when={s.completedAt}
                  />
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12.5, color: 'var(--dk-ink-3)', padding: '18px 16px' }}>{children}</div>
  );
}

/**
 * One radar row. Clickable only where there is somewhere to go — a
 * subscription charge and a swap have no Desk surface, and a row that looks
 * like a door and opens nothing is worse than a row that plainly does not.
 */
function RadarRow({
  reference,
  title,
  when,
  last,
  onOpen,
}: {
  reference: string;
  title: string;
  when: string | null;
  last: boolean;
  onOpen?: () => void;
}) {
  const body = (
    <>
      <span
        className="dk-mono"
        style={{ fontSize: 11, color: 'var(--dk-ink-3)', width: 110, flex: 'none' }}
      >
        {reference}
      </span>
      <span
        style={{
          fontSize: 12.5,
          color: 'var(--dk-ink-2)',
          minWidth: 0,
          flex: 1,
          lineHeight: 1.45,
          textAlign: 'left',
        }}
      >
        {title}
      </span>
      <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>
        {when
          ? new Date(when).toLocaleDateString('en-ZA', {
              timeZone: 'Africa/Johannesburg',
              day: 'numeric',
              month: 'short',
            })
          : '—'}
      </span>
    </>
  );

  const shared: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    minHeight: 48,
    padding: '10px 16px',
    borderBottom: last ? undefined : '1px solid var(--dk-line)',
  };

  if (!onOpen) return <div style={shared}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      style={{
        ...shared,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {body}
    </button>
  );
}
