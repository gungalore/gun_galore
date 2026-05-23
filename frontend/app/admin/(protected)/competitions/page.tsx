'use client';

// ─────────────────────────────────────────────────────────────────────
// Admin · Competitions list
//
// Four tabs, each a client-side filter over the same /admin/raffles
// payload:
//   - Active        → currently selling tickets (status === 'ACTIVE')
//   - Awaiting draw → sold out, in 24h cooling window
//   - Drawn         → winner picked, dossier worth looking at
//   - Needs dispatch→ at least one winner has claimed but no admin
//                     has stamped the prize as dispatched yet
//
// Initial-tab is driven by the ?tab= query string so the Command
// Center cards can deep-link straight to the operator's TO-DO.
// ─────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import { AdminRaffleRow } from '@/lib/types';
import { formatPrice } from '@/lib/utils';
import { RefundAllButton } from './refund-all-button';

const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'var(--text-tertiary)',
  ACTIVE: '#22c55e',
  CLOSED_AWAITING_DRAW: '#f59e0b',
  DRAWN: '#3b82f6',
  CLAIMED: '#22c55e',
  CANCELLED_MIN_NOT_MET: '#ef4444',
  CANCELLED_BY_ADMIN: '#ef4444',
  EXPIRED_UNCLAIMED: 'var(--text-tertiary)',
};

// Tab definitions — kept here so the filter and label list cannot
// drift apart.
const TABS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'awaiting-draw', label: 'Awaiting draw' },
  { key: 'drawn', label: 'Drawn' },
  { key: 'dispatch', label: 'Needs dispatch' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export default function AdminCompetitionsPage() {
  const searchParams = useSearchParams();
  // Honour ?tab= from the Command Center deep-link. Falls back to
  // the friendliest default (Active) when nothing matches.
  const initialTab: TabKey = useMemo(() => {
    const raw = searchParams?.get('tab') ?? '';
    return (TABS.find((t) => t.key === raw)?.key ?? 'all');
  }, [searchParams]);

  const [tab, setTab] = useState<TabKey>(initialTab);
  // If the user lands on /admin/competitions then clicks an Attention
  // card with the same href but a different ?tab=, keep state in sync.
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const [raffles, setRaffles] = useState<AdminRaffleRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!requireAdminToken()) return;
    let cancelled = false;
    (async () => {
      const res = await adminFetch('/admin/raffles');
      if (cancelled) return;
      if (res.ok) setRaffles(await res.json());
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Derived per-tab filter. Computed once per (tab, raffles) change so
  // the renders below are cheap — most operators will have <100 raffles
  // total even after years of operation, so client-side filtering is
  // perfectly fine here.
  const filtered = useMemo(() => {
    return raffles.filter((r) => {
      const winner1 = r.winners?.find((w) => w.position === 1);
      switch (tab) {
        case 'all':
          return true;
        case 'active':
          return r.status === 'ACTIVE';
        case 'awaiting-draw':
          return r.status === 'CLOSED_AWAITING_DRAW';
        case 'drawn':
          return (
            r.status === 'DRAWN' ||
            r.status === 'CLAIMED' ||
            r.status === 'EXPIRED_UNCLAIMED'
          );
        case 'dispatch':
          // Primary winner has claimed but no admin has stamped the
          // dispatch yet. Mirrors the AdminCommandCenter query so the
          // count and the list stay perfectly in sync.
          return (
            !!winner1?.claimedAt &&
            !winner1.prizeDispatchedAt &&
            !winner1.forfeitedAt
          );
      }
    });
  }, [raffles, tab]);

  // Per-tab badge counts so the strip itself doubles as a mini status
  // dashboard. Computed in one pass over the same array we already
  // hold in memory.
  const counts = useMemo(() => {
    const c: Record<TabKey, number> = {
      all: raffles.length,
      active: 0,
      'awaiting-draw': 0,
      drawn: 0,
      dispatch: 0,
    };
    for (const r of raffles) {
      const w1 = r.winners?.find((w) => w.position === 1);
      if (r.status === 'ACTIVE') c.active += 1;
      if (r.status === 'CLOSED_AWAITING_DRAW') c['awaiting-draw'] += 1;
      if (
        r.status === 'DRAWN' ||
        r.status === 'CLAIMED' ||
        r.status === 'EXPIRED_UNCLAIMED'
      ) {
        c.drawn += 1;
      }
      if (w1?.claimedAt && !w1.prizeDispatchedAt && !w1.forfeitedAt) {
        c.dispatch += 1;
      }
    }
    return c;
  }, [raffles]);

  // Helper — only the Drawn + Needs-dispatch tabs render the winner
  // / claim / dispatch columns. The Active and Awaiting-draw tabs
  // don't have any winner data to show.
  const showWinnerCols = tab === 'drawn' || tab === 'dispatch';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1
          className="text-xl"
          style={{ color: 'var(--text-primary)', fontWeight: 500 }}
        >
          Competitions
        </h1>
        <Link
          href="/admin/competitions/create"
          className="text-sm px-3 py-2 rounded-[6px]"
          style={{
            background: 'var(--red)',
            color: '#fff',
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          + Create competition
        </Link>
      </div>

      {/* Tab strip — same visual idiom we use on the transactions
          dossier. Active tab gets a coloured underline; others render
          as ghost text. Each tab carries a small pill with its count
          so the operator can see "Needs dispatch: 2" at a glance. */}
      <div
        className="flex flex-wrap gap-1 mb-4"
        style={{ borderBottom: '0.5px solid var(--border)' }}
      >
        {TABS.map((t) => {
          const isActive = t.key === tab;
          const count = counts[t.key];
          const isAlarm = t.key === 'dispatch' && count > 0;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="text-sm px-3 py-2 -mb-px flex items-center gap-2"
              style={{
                color: isActive
                  ? isAlarm
                    ? 'var(--red)'
                    : 'var(--text-primary)'
                  : 'var(--text-tertiary)',
                borderBottom: isActive
                  ? `1.5px solid ${isAlarm ? 'var(--red)' : 'var(--text-primary)'}`
                  : '1.5px solid transparent',
                fontWeight: isActive ? 500 : 400,
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              {t.label}
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full"
                style={{
                  background: isAlarm
                    ? 'rgba(200,16,46,0.15)'
                    : 'var(--bg-inset)',
                  color: isAlarm ? 'var(--red)' : 'var(--text-tertiary)',
                  fontWeight: 500,
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {loaded && filtered.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          {tab === 'dispatch'
            ? 'Nothing to ship right now — all claimed prizes have tracking.'
            : 'No competitions in this view.'}
        </p>
      ) : (
        <div
          className="rounded-[6px] overflow-hidden"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
          }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--bg-inset)' }}>
                <Th>Reference</Th>
                <Th>Title</Th>
                <Th>Status</Th>
                <Th>Sold</Th>
                <Th>Ticket price</Th>
                <Th>Value</Th>
                {showWinnerCols && <Th>Winner</Th>}
                {showWinnerCols && <Th>Claim</Th>}
                {showWinnerCols && <Th>Dispatch</Th>}
                <Th>Created</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const w1 = r.winners?.find((w) => w.position === 1);
                return (
                  <tr key={r.id} style={{ borderTop: '0.5px solid var(--border)' }}>
                    <Td>
                      <span
                        style={{
                          color: 'var(--text-secondary)',
                          fontFamily: 'monospace',
                          fontSize: '12px',
                        }}
                      >
                        {r.referenceNumber ?? '—'}
                      </span>
                    </Td>
                    <Td>
                      {/* Title links to the per-raffle dossier
                          (admin), not the public buyer page. Dossier
                          is the operator's one-stop place for the
                          winner contact details + the dispatch
                          button. */}
                      <Link
                        href={`/admin/competitions/${r.id}`}
                        className="hover:underline"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {r.title}
                      </Link>
                      {r.relistGeneration > 0 && (
                        <span
                          className="ml-1 text-xs"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          (relist #{r.relistGeneration})
                        </span>
                      )}
                    </Td>
                    <Td>
                      <span style={{ color: STATUS_COLOR[r.status] ?? 'var(--text-tertiary)' }}>
                        {r.status.replace(/_/g, ' ')}
                      </span>
                    </Td>
                    <Td>
                      {r.ticketsSoldPaid + r.ticketsSoldPostal} / {r.targetTicketCount}
                    </Td>
                    <Td>{formatPrice(r.ticketPriceCents)}</Td>
                    <Td>{formatPrice(r.itemValueCents)}</Td>

                    {showWinnerCols && (
                      <>
                        <Td>
                          {w1 ? (
                            <span
                              style={{ color: 'var(--text-primary)' }}
                            >
                              {w1.user?.username ?? '(postal)'}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                          )}
                        </Td>
                        <Td>
                          {/* Single-source-of-truth tri-state pill —
                              also reused by the dossier page so the
                              two surfaces stay visually consistent. */}
                          {w1 ? (
                            <StatusPill
                              tone={
                                w1.claimedAt
                                  ? 'success'
                                  : w1.forfeitedAt
                                    ? 'error'
                                    : 'pending'
                              }
                              label={
                                w1.claimedAt
                                  ? 'Claimed'
                                  : w1.forfeitedAt
                                    ? 'Forfeited'
                                    : 'Awaiting'
                              }
                            />
                          ) : (
                            <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                          )}
                        </Td>
                        <Td>
                          {w1?.prizeDispatchedAt ? (
                            <StatusPill tone="success" label="Dispatched" />
                          ) : w1?.claimedAt ? (
                            <StatusPill tone="error" label="To ship" />
                          ) : (
                            <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                          )}
                        </Td>
                      </>
                    )}

                    <Td>
                      <span style={{ color: 'var(--text-tertiary)' }}>
                        {new Date(r.createdAt).toLocaleDateString('en-ZA')}
                      </span>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-2 items-center">
                        <Link
                          href={`/admin/competitions/${r.id}`}
                          className="text-xs hover:underline"
                          style={{ color: 'var(--red)' }}
                        >
                          Dossier
                        </Link>
                        <Link
                          href={`/admin/competitions/${r.id}/audit`}
                          className="text-xs hover:underline"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          Audit
                        </Link>
                        {/* Draw proof link — only shown for drawn /
                            claimed raffles. Opens the public proof
                            page that exposes the seed + hash + winning
                            ticket so anyone can verify the draw was
                            legitimate (matches /api/raffles/:id/proof
                            response). */}
                        {(r.status === 'DRAWN' || r.status === 'CLAIMED' || r.status === 'EXPIRED_UNCLAIMED') && (
                          <Link
                            href={`/competitions/${r.id}/proof`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs hover:underline"
                            style={{ color: '#3b82f6' }}
                          >
                            Proof ↗
                          </Link>
                        )}
                        {r.status !== 'CANCELLED_BY_ADMIN' &&
                          r.status !== 'CANCELLED_MIN_NOT_MET' &&
                          r.status !== 'CLAIMED' &&
                          r.status !== 'EXPIRED_UNCLAIMED' && (
                            <RefundAllButton
                              raffleId={r.id}
                              referenceNumber={r.referenceNumber ?? ''}
                              title={r.title}
                            />
                          )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      className="text-left text-xs uppercase px-3 py-2"
      style={{
        color: 'var(--text-tertiary)',
        letterSpacing: '0.05em',
        fontWeight: 500,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td
      className="px-3 py-2.5"
      style={{ color: 'var(--text-secondary)' }}
    >
      {children}
    </td>
  );
}

// Tri-state status pill reused by the dossier page. Kept inline here
// so a future spinoff into its own component doesn't change the API.
function StatusPill({
  tone,
  label,
}: {
  tone: 'success' | 'pending' | 'error';
  label: string;
}) {
  const palette =
    tone === 'success'
      ? { bg: 'rgba(34,197,94,0.12)', fg: '#22c55e' }
      : tone === 'error'
        ? { bg: 'rgba(200,16,46,0.15)', fg: 'var(--red)' }
        : { bg: 'rgba(245,158,11,0.12)', fg: '#f59e0b' };
  return (
    <span
      className="text-[11px] px-2 py-0.5 rounded-[4px]"
      style={{ background: palette.bg, color: palette.fg, fontWeight: 500 }}
    >
      {label}
    </span>
  );
}
