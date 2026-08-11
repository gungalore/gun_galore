'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';

// P1.4 — held-funds (client money) position.
interface HeldBucket {
  count: number;
  cents: number;
}
interface HeldFunds {
  asOf: string;
  paymentMode: string;
  heldAwaitingRelease: HeldBucket;
  owedToSellers: HeldBucket;
  owedToBuyerRefunds: HeldBucket;
  swapCashHeld: HeldBucket;
  swapFundingInFlight: HeldBucket;
  totalClientFundsCents: number;
}
// P1.3 — Books failed-sync aggregate.
interface ZohoFailedRow {
  id: string;
  orderReference?: string | null;
  zohoSyncError?: string | null;
  errorMessage?: string | null;
}
interface ZohoFailedSwap {
  id: string;
  initiatorFundingRef?: string | null;
  swapFeeInitiator?: number;
  zohoInitiatorFeeReceiptId?: string | null;
  swapFeeOwner?: number;
  zohoOwnerFeeReceiptId?: string | null;
}
interface ZohoFailed {
  transactions: ZohoFailedRow[];
  featuredBids: ZohoFailedRow[];
  subscriptionCharges: ZohoFailedRow[];
  swaps: ZohoFailedSwap[];
  totalFailed: number;
}

// ── Payouts due (GET /admin/manual-payments/payouts-due) ───────────────
// Shape is exactly ManualPaymentsService.getPayoutsDuePreview():
// { ...getPayoutsDue(), skipped } — i.e. the raw Prisma selects for owed
// seller payouts + owed buyer refunds, plus the structured block reasons
// collectDue() produced for the rows a settlement would have to skip.
interface DueParty {
  username: string | null;
  email: string | null;
  phone: string | null;
  bankAccountHolder: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankBranchCode: string | null;
  bankAccountType: string | null;
  // Seller-only (the FLOW-F1 payout hard gate + Peach BANV gate).
  kycStatus?: string | null;
  profileCompletedAt?: string | null;
  bankVerifiedAt?: string | null;
}
interface DuePayoutRow {
  id: string;
  orderReference: string | null;
  sellerPayout: number;
  refundedAmount: number | null;
  // P0.3 — the seller is docked for refund slices actually minted.
  refundChildren: { buyerTotal: number }[];
  releasedAt: string | null;
  seller: DueParty;
}
interface DueRefundRow {
  id: string;
  refundOfId: string | null;
  orderReference: string | null;
  buyerTotal: number;
  refundChildren: { buyerTotal: number }[];
  updatedAt: string | null;
  buyer: DueParty;
}
// collectDue()'s SkippedDueRow — ref is `orderReference ?? id`, which is how
// we match a block reason back to its row below.
interface SkippedDueRow {
  kind: 'PAYOUT' | 'REFUND';
  ref: string;
  reason: string;
}
interface PayoutsDue {
  payouts: DuePayoutRow[];
  refunds: DueRefundRow[];
  skipped: SkippedDueRow[];
}
// POST /admin/manual-payments/run-payouts — runDuePayouts()'s return type.
// NOTE: the API returns COUNTS plus the skipped list; it does NOT return a
// per-row "this seller was paid" array, so the honest way to show what
// actually settled is these counters + re-reading the due queue after.
interface RunPayoutsResult {
  attempted: number;
  accepted: number;
  failed: number;
  totalCents: number;
  skipped: SkippedDueRow[];
}

function rand(cents: number) {
  return `R${(cents / 100).toFixed(2)}`;
}

// Peach payouts have a hard R10 floor (runDuePayouts skips anything below
// 1000c). Mirrored here so the preview doesn't promise money the run will
// refuse to send.
const PEACH_PAYOUT_FLOOR_CENTS = 1000;

// Never print a full bank account number into the admin DOM when the last
// four digits are enough to recognise the account.
function maskAccount(n: string | null | undefined) {
  if (!n) return '—';
  return n.length <= 4 ? n : `••••${n.slice(-4)}`;
}

// The seller nets sellerPayout minus every refund slice actually minted
// against the order — the same arithmetic runDuePayouts pays out on.
function netPayoutCents(r: DuePayoutRow) {
  const covered = (r.refundChildren ?? []).reduce((s, c) => s + c.buyerTotal, 0);
  return Math.max(0, r.sellerPayout - covered);
}

// A refund child pays its own slice; a REFUNDED parent pays the residual its
// children don't carry (collectDue's rule).
function netRefundCents(r: DueRefundRow) {
  const covered = (r.refundChildren ?? []).reduce((s, c) => s + c.buyerTotal, 0);
  return r.refundOfId ? r.buyerTotal : Math.max(0, r.buyerTotal - covered);
}

// Failures must be shown verbatim, never swallowed: pull the Nest error
// message out of the body when there is one, otherwise show the status.
async function errText(res: Response): Promise<string> {
  let body = '';
  try {
    body = await res.text();
  } catch {
    return `HTTP ${res.status}`;
  }
  if (!body) return `HTTP ${res.status}`;
  try {
    const j = JSON.parse(body) as { message?: string | string[]; error?: string };
    const m = Array.isArray(j.message) ? j.message.join(', ') : j.message;
    return `HTTP ${res.status} — ${m ?? j.error ?? body.slice(0, 300)}`;
  } catch {
    return `HTTP ${res.status} — ${body.slice(0, 300)}`;
  }
}

// The manual-EFT pay-in (statement upload / inContact scan / unmatched queue)
// and the FNB payout-batch builder have been removed with the manual-EFT rail.
// What remains are the read-only money-state monitors: the Client-Funds-Payable
// (held funds) position and the Zoho Books failed-sync radar.
export default function HeldFundsAdminPage() {
  const [ready, setReady] = useState(false);
  const [heldFunds, setHeldFunds] = useState<HeldFunds | null>(null);
  const [zohoFailed, setZohoFailed] = useState<ZohoFailed | null>(null);
  // Payouts-due preview + the operator-triggered run.
  const [due, setDue] = useState<PayoutsDue | null>(null);
  const [dueError, setDueError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunPayoutsResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [ranAt, setRanAt] = useState<string | null>(null);

  useEffect(() => {
    setReady(requireAdminToken());
  }, []);

  const load = useCallback(async () => {
    const [h, z, d] = await Promise.all([
      adminFetch('/admin/manual-payments/held-funds'),
      adminFetch('/admin/manual-payments/zoho-failed'),
      adminFetch('/admin/manual-payments/payouts-due'),
    ]);
    if (h.ok) setHeldFunds(await h.json());
    if (z.ok) setZohoFailed(await z.json());
    if (d.ok) {
      setDue(await d.json());
      setDueError(null);
    } else {
      // Money view — a failed read must say so, not render an empty queue
      // that reads as "nothing is owed".
      setDue(null);
      setDueError(await errText(d));
    }
  }, []);

  // THE most dangerous button on the site: it disburses real money to seller
  // banks. Confirm-gated (the modal states the amount + count), single-flight,
  // and everything the API returns — including a total refusal — is rendered
  // verbatim. We never claim a payout happened: `accepted` from the API is the
  // only proof, and the due queue is re-read afterwards so the operator can
  // see which rows actually left it.
  const runPayouts = useCallback(async () => {
    setRunning(true);
    setRunError(null);
    setRunResult(null);
    try {
      const res = await adminFetch('/admin/manual-payments/run-payouts', {
        method: 'POST',
      });
      if (res.ok) {
        setRunResult((await res.json()) as RunPayoutsResult);
      } else {
        setRunError(await errText(res));
      }
    } catch (e) {
      // Network/CORS failure — the request may never have reached the API, so
      // the state of the payout run is UNKNOWN. Say exactly that.
      setRunError(
        `${e instanceof Error ? e.message : 'Network error'} — the request may not have reached the API. Re-read the queue below before running again.`,
      );
    } finally {
      setRanAt(new Date().toISOString());
      setRunning(false);
      setConfirmOpen(false);
      // Re-read: rows that genuinely settled are stamped paidOutAt and drop
      // out of payouts-due. Anything still listed was NOT paid.
      void load();
    }
  }, [load]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  if (!ready) {
    return <div className="p-6 text-sm text-[var(--text-tertiary)]">Admin sign-in required.</div>;
  }

  // ── Derived payout buckets ───────────────────────────────────────────
  // collectDue() keys every block reason by `orderReference ?? id`, so the
  // same expression re-attaches a reason to its row. A row with no reason is
  // one a run would ATTEMPT (subject to the two extra checks runDuePayouts
  // applies at send time: recognised bank name + the R10 floor).
  const rowRef = (r: { orderReference: string | null; id: string }) =>
    r.orderReference ?? r.id;
  const payoutBlockRefs = new Set(
    (due?.skipped ?? []).filter((s) => s.kind === 'PAYOUT').map((s) => s.ref),
  );
  const payoutByRef = new Map<string, DuePayoutRow>(
    (due?.payouts ?? []).map((p) => [rowRef(p), p] as [string, DuePayoutRow]),
  );
  const payablePayouts = (due?.payouts ?? []).filter(
    (p) => !payoutBlockRefs.has(rowRef(p)),
  );
  const blockedPayouts = (due?.skipped ?? [])
    .filter((s) => s.kind === 'PAYOUT')
    .map((s) => ({ ...s, row: payoutByRef.get(s.ref) ?? null }));
  const blockedRefunds = (due?.skipped ?? []).filter((s) => s.kind === 'REFUND');
  const payableCents = payablePayouts.reduce((s, p) => s + netPayoutCents(p), 0);
  const blockedCents = blockedPayouts.reduce(
    (s, b) => s + (b.row ? netPayoutCents(b.row) : 0),
    0,
  );
  // Payable rows the send step will still refuse: below Peach's R10 minimum.
  // (The other send-time skip — an unrecognised bank name — depends on the
  // backend's bank ENUM map, so the bank name is shown per row instead of
  // guessed at here.)
  const belowFloor = payablePayouts.filter(
    (p) => netPayoutCents(p) < PEACH_PAYOUT_FLOOR_CENTS,
  );
  const payableSellers = new Set(
    payablePayouts.map((p) => p.seller.username ?? p.id),
  ).size;
  const dueRefunds = due?.refunds ?? [];

  return (
    <div className="p-6 max-w-[960px]">
      {/* Title still leads with "Held funds" so it matches the sidebar entry
          (sidebar-nav.tsx labels this route "Held Funds"). */}
      <h1 className="text-xl font-medium mb-1">Held funds, payouts &amp; books</h1>
      <p className="text-sm text-[var(--text-tertiary)] mb-6">
        The money desk: what is owed out to sellers right now (and what is
        blocking the rest), how much of the bank balance belongs to members,
        and which accounting syncs need attention. Payments are not being taken
        while the card gateway is offline.
      </p>

      {/* FLOW-F2 — payouts-due preview + the operator payout run.
          Previously curl/SSH-only: the endpoints existed but nothing in the
          admin UI called them. */}
      <section
        className="rounded-[8px] p-5 mb-5"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
      >
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <h2 className="text-base font-medium">Payouts due to sellers</h2>
            <p className="text-xs mt-0.5 text-[var(--text-tertiary)]">
              Released orders whose money is owed to the seller and not yet paid
              out. A run disburses the payable rows to their banks via Peach
              Payouts and stamps them paid (exactly-once).
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={running || payablePayouts.length === 0}
            className="text-xs px-3 py-1.5 rounded-[6px] shrink-0"
            style={{
              background:
                running || payablePayouts.length === 0 ? 'var(--bg-inset)' : 'var(--red)',
              color:
                running || payablePayouts.length === 0 ? 'var(--text-tertiary)' : '#fff',
              border:
                running || payablePayouts.length === 0
                  ? '0.5px solid var(--border)'
                  : 'none',
              cursor:
                running || payablePayouts.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {running ? 'Running…' : 'Run payouts now'}
          </button>
        </div>

        {/* The run is gated on PAYMENTS_LIVE inside the service, and that env
            flag is not readable from the browser — so we never assert the
            payout rail is live or dead, we only report what the API returns. */}
        <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
          Real money. The server gates this on PAYMENTS_LIVE and on Peach payout
          credentials; while payments are inert the API rejects the run and
          nothing moves. Whatever comes back is shown below verbatim — treat the
          returned counts, not this button, as proof of payment.
        </p>

        {dueError ? (
          <p
            className="text-sm rounded-[6px] p-3"
            style={{ color: 'var(--red)', background: 'var(--bg-inset)', border: '0.5px solid var(--border)' }}
          >
            Could not read the payouts-due queue — {dueError}. This is NOT
            &ldquo;nothing is owed&rdquo;; retry before drawing conclusions.
          </p>
        ) : !due ? (
          <p className="text-sm text-[var(--text-tertiary)]">Loading…</p>
        ) : (
          <>
            {/* Money summary first — the two numbers the operator acts on. */}
            <div className="flex flex-wrap gap-3 mb-3">
              {(
                [
                  ['Payable now', payableCents, payablePayouts.length, 'var(--text-primary)'],
                  ['Blocked', blockedCents, blockedPayouts.length, 'var(--red)'],
                ] as Array<[string, number, number, string]>
              ).map(([label, cents, count, colour]) => (
                <div
                  key={label}
                  className="rounded-[6px] px-4 py-2"
                  style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)' }}
                >
                  <p className="text-[11px] text-[var(--text-tertiary)]">{label}</p>
                  <p
                    className="text-sm font-semibold"
                    style={{ fontVariantNumeric: 'tabular-nums', color: colour }}
                  >
                    {rand(cents)}
                  </p>
                  <p className="text-[11px] text-[var(--text-tertiary)]">
                    {count} order{count === 1 ? '' : 's'}
                    {label === 'Payable now' && count > 0
                      ? ` · ${payableSellers} seller${payableSellers === 1 ? '' : 's'}`
                      : ''}
                  </p>
                </div>
              ))}
            </div>

            {belowFloor.length > 0 && (
              <p className="text-xs mb-3" style={{ color: 'var(--warning)' }}>
                {belowFloor.length} payable row{belowFloor.length === 1 ? '' : 's'} sit
                below Peach&rsquo;s R10 payout minimum — the run will skip{' '}
                {belowFloor.length === 1 ? 'it' : 'them'} and report{' '}
                {belowFloor.length === 1 ? 'it' : 'them'} as skipped, held until the
                seller has more money owing.
              </p>
            )}

            {/* Payable rows */}
            {payablePayouts.length === 0 ? (
              <p className="text-sm text-[var(--text-tertiary)] mb-4">
                Nothing payable right now.
              </p>
            ) : (
              <div className="overflow-x-auto mb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[var(--text-tertiary)]">
                      <th className="py-2 pr-4">Order</th>
                      <th className="py-2 pr-4">Seller</th>
                      <th className="py-2 pr-4">Bank</th>
                      <th className="py-2 pr-4">Released</th>
                      <th className="py-2 text-right">Net payout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payablePayouts.map((p) => {
                      const net = netPayoutCents(p);
                      const low = net < PEACH_PAYOUT_FLOOR_CENTS;
                      return (
                        <tr key={p.id} style={{ borderTop: '0.5px solid var(--border)' }}>
                          <td className="py-2 pr-4">
                            <Link
                              href={`/admin/transactions/${p.id}`}
                              style={{ color: 'var(--red)', textDecoration: 'none' }}
                            >
                              {p.orderReference ?? p.id.slice(-8).toUpperCase()} →
                            </Link>
                          </td>
                          <td className="py-2 pr-4">
                            {p.seller.username ?? '—'}
                            {/* Payable ⇒ collectDue found bank details + a
                                VERIFIED KYC + a complete profile (and, once
                                BANV is live, a verified bank account). */}
                            <span className="ml-2 text-[11px] text-[var(--text-tertiary)]">
                              bank ✓ · KYC ✓
                            </span>
                          </td>
                          <td className="py-2 pr-4 text-[var(--text-tertiary)]">
                            {p.seller.bankName ?? '—'} {maskAccount(p.seller.bankAccountNumber)}
                          </td>
                          <td className="py-2 pr-4 text-[var(--text-tertiary)]">
                            {p.releasedAt
                              ? new Date(p.releasedAt).toLocaleDateString('en-ZA')
                              : '—'}
                          </td>
                          <td
                            className="py-2 text-right"
                            style={{
                              fontVariantNumeric: 'tabular-nums',
                              color: low ? 'var(--warning)' : undefined,
                            }}
                          >
                            {rand(net)}
                            {low && <span className="text-[11px]"> · below R10</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Blocked rows, with the backend's own reason text */}
            {blockedPayouts.length > 0 && (
              <div className="overflow-x-auto mb-2">
                <p className="text-xs mb-2" style={{ color: 'var(--red)' }}>
                  {blockedPayouts.length} row{blockedPayouts.length === 1 ? '' : 's'} a run
                  would skip ({rand(blockedCents)}) — reasons come straight from the
                  settlement engine.
                </p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[var(--text-tertiary)]">
                      <th className="py-2 pr-4">Order</th>
                      <th className="py-2 pr-4">Amount</th>
                      <th className="py-2">Why it&rsquo;s blocked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blockedPayouts.map((b) => (
                      <tr key={`blk-${b.ref}`} style={{ borderTop: '0.5px solid var(--border)' }}>
                        <td className="py-2 pr-4">
                          {b.row ? (
                            <Link
                              href={`/admin/transactions/${b.row.id}`}
                              style={{ color: 'var(--red)', textDecoration: 'none' }}
                            >
                              {b.ref} →
                            </Link>
                          ) : (
                            b.ref
                          )}
                        </td>
                        <td
                          className="py-2 pr-4 text-[var(--text-tertiary)]"
                          style={{ fontVariantNumeric: 'tabular-nums' }}
                        >
                          {b.row ? rand(netPayoutCents(b.row)) : '—'}
                        </td>
                        <td className="py-2 text-[var(--text-tertiary)]">{b.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Buyer refunds owed by bank transfer. Only populated in manual
                payment mode — under a card gateway the reversal happens on the
                card, so this list is empty by design and the run never
                touches it. */}
            {(dueRefunds.length > 0 || blockedRefunds.length > 0) && (
              <div className="overflow-x-auto mt-4">
                <p className="text-xs mb-2 text-[var(--text-tertiary)]">
                  Buyer refunds owed ({dueRefunds.length}) — NOT part of the payout
                  run; these are paid on the original card once the gateway is
                  live, or by transfer in manual mode.
                </p>
                <table className="w-full text-sm">
                  <tbody>
                    {dueRefunds.map((r) => (
                      <tr key={r.id} style={{ borderTop: '0.5px solid var(--border)' }}>
                        <td className="py-2 pr-4">
                          <Link
                            href={`/admin/transactions/${r.id}`}
                            style={{ color: 'var(--red)', textDecoration: 'none' }}
                          >
                            {r.orderReference ?? r.id.slice(-8).toUpperCase()} →
                          </Link>
                        </td>
                        <td className="py-2 pr-4 text-[var(--text-tertiary)]">
                          {r.buyer.username ?? '—'}
                        </td>
                        <td
                          className="py-2 text-right"
                          style={{ fontVariantNumeric: 'tabular-nums' }}
                        >
                          {rand(netRefundCents(r))}
                        </td>
                      </tr>
                    ))}
                    {blockedRefunds.map((s) => (
                      <tr key={`rblk-${s.ref}`} style={{ borderTop: '0.5px solid var(--border)' }}>
                        <td className="py-2 pr-4">{s.ref}</td>
                        <td className="py-2 text-[var(--text-tertiary)]" colSpan={2}>
                          {s.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Run outcome — never optimistic. */}
        {runError && (
          <div
            className="mt-4 rounded-[6px] p-3 text-sm"
            style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--red)', color: 'var(--red)' }}
          >
            <p className="font-medium">Payout run rejected — no payouts were confirmed.</p>
            <p className="mt-1 text-xs">{runError}</p>
            <p className="mt-1 text-xs text-[var(--text-tertiary)]">
              A 500 here is what the API returns while payouts are switched off
              (PAYMENTS_LIVE is not true). Nothing was disbursed; the queue above
              has been re-read.
            </p>
          </div>
        )}
        {runResult && (
          <div
            className="mt-4 rounded-[6px] p-3 text-sm"
            style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)' }}
          >
            <p className="font-medium">
              Run finished{ranAt ? ` at ${new Date(ranAt).toLocaleTimeString('en-ZA')}` : ''}:{' '}
              {runResult.accepted} of {runResult.attempted} accepted by the gateway ·{' '}
              {runResult.failed} not accepted ·{' '}
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {rand(runResult.totalCents)}
              </span>{' '}
              stamped as paid.
            </p>
            {runResult.attempted === 0 && (
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                Nothing was sent — every due row was skipped (see the reasons
                below). No money moved.
              </p>
            )}
            {runResult.attempted > 0 && runResult.accepted === 0 && (
              <p className="mt-1 text-xs" style={{ color: 'var(--red)' }}>
                The gateway accepted NOTHING — no money moved. If Peach payout
                credentials are not set the adapter reports every payout as
                &ldquo;not_configured&rdquo;, which lands here exactly like this.
                The failure detail is on the PEACH_PAYOUT_PARTIAL entry in{' '}
                <Link href="/admin/alerts" style={{ color: 'var(--red)' }}>
                  admin alerts
                </Link>
                .
              </p>
            )}
            {runResult.accepted > 0 && (
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                Accepted means the gateway took the instruction; the payout
                webhook confirms settlement later and re-queues anything that
                fails. Accepted rows have left the queue above.
              </p>
            )}
            {runResult.failed > 0 && (
              <p className="mt-1 text-xs" style={{ color: 'var(--red)' }}>
                {runResult.failed} payout{runResult.failed === 1 ? '' : 's'} were sent
                but not accepted — a PEACH_PAYOUT_PARTIAL admin alert carries the
                per-payout error text (the API returns counts, not per-row errors).
              </p>
            )}
            {runResult.skipped.length > 0 && (
              <ul className="mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {runResult.skipped.map((s, i) => (
                  <li key={`${s.ref}-${i}`} className="py-0.5">
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {s.kind === 'REFUND' ? 'Refund' : 'Payout'} {s.ref}
                    </span>{' '}
                    — {s.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* P1.4 — Held funds (client money) position */}
      <section className="rounded-[8px] p-5 mb-5" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}>
        <h2 className="text-base font-medium mb-1">Held funds — client money position</h2>
        <p className="text-xs mb-3 text-[var(--text-tertiary)]">
          How much of the bank balance belongs to members, not Gun Galore. The
          bank balance should always be at least the total below.
        </p>
        {!heldFunds ? (
          <p className="text-sm text-[var(--text-tertiary)]">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {(
                  [
                    ['Buyer money held (awaiting delivery/release)', heldFunds.heldAwaitingRelease],
                    ['Owed to sellers (released, not yet paid out)', heldFunds.owedToSellers],
                    ['Owed to buyers (refunds not yet paid)', heldFunds.owedToBuyerRefunds],
                    ['Swap cash top-ups held (locked swaps)', heldFunds.swapCashHeld],
                    ['Swap funding in flight (one side paid, pre-lock)', heldFunds.swapFundingInFlight],
                  ] as Array<[string, HeldBucket]>
                ).map(([label, bucket]) => (
                  <tr key={label} style={{ borderTop: '0.5px solid var(--border)' }}>
                    <td className="py-2 pr-4">{label}</td>
                    <td className="py-2 pr-4 text-[var(--text-tertiary)]">{bucket.count} item{bucket.count === 1 ? '' : 's'}</td>
                    <td className="py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{rand(bucket.cents)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: '0.5px solid var(--border)' }}>
                  <td className="py-2 pr-4 font-medium">Total client funds</td>
                  <td className="py-2 pr-4" />
                  <td className="py-2 text-right font-semibold" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--red)' }}>
                    {rand(heldFunds.totalClientFundsCents)}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="text-xs mt-2 text-[var(--text-tertiary)]">
              As of {new Date(heldFunds.asOf).toLocaleString('en-ZA')} · payment mode: {heldFunds.paymentMode}
            </p>
          </div>
        )}
      </section>

      {/* P1.3 — Zoho Books failed syncs */}
      <section className="rounded-[8px] p-5" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}>
        <h2 className="text-base font-medium mb-1">Zoho Books — failed syncs</h2>
        {!zohoFailed ? (
          <p className="text-sm text-[var(--text-tertiary)]">Loading…</p>
        ) : zohoFailed.totalFailed === 0 ? (
          <p className="text-sm text-[var(--text-tertiary)]">All Books syncs healthy — nothing failed.</p>
        ) : (
          <div className="overflow-x-auto">
            <p className="text-xs mb-2" style={{ color: 'var(--red)' }}>
              {zohoFailed.totalFailed} entit{zohoFailed.totalFailed === 1 ? 'y' : 'ies'} failed their last Books sync. Transactions &amp; featured bids retry from their dossier; swap leg-fee receipts retry automatically each hour.
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--text-tertiary)]">
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">Reference</th>
                  <th className="py-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['Transaction', zohoFailed.transactions],
                    ['Featured bid', zohoFailed.featuredBids],
                    ['Subscription', zohoFailed.subscriptionCharges],
                  ] as Array<[string, ZohoFailedRow[]]>
                ).flatMap(([type, rows]) =>
                  rows.map((r) => {
                    const label = r.orderReference ?? r.id.slice(-8).toUpperCase();
                    // The copy above tells the admin to retry "from their
                    // dossier", so link them there instead of making them copy
                    // the reference and search for it. Subscription rows self-
                    // heal hourly and have no dossier, so they stay plain text.
                    const href =
                      type === 'Transaction'
                        ? `/admin/transactions/${r.id}`
                        : type === 'Featured bid'
                          ? '/admin/featured'
                          : null;
                    return (
                      <tr key={`${type}-${r.id}`} style={{ borderTop: '0.5px solid var(--border)' }}>
                        <td className="py-2 pr-4">{type}</td>
                        <td className="py-2 pr-4">
                          {href ? (
                            <Link href={href} style={{ color: 'var(--red)', textDecoration: 'none' }}>
                              {label} →
                            </Link>
                          ) : (
                            label
                          )}
                        </td>
                        <td className="py-2 text-[var(--text-tertiary)]">{r.zohoSyncError ?? r.errorMessage ?? '—'}</td>
                      </tr>
                    );
                  }),
                )}
                {/* P1.3 — swap leg-fee receipts (no zohoSync* columns; the
                    signal is a missing receipt id). Auto-retried hourly. */}
                {(zohoFailed.swaps ?? []).map((s) => (
                  <tr key={`Swap-${s.id}`} style={{ borderTop: '0.5px solid var(--border)' }}>
                    <td className="py-2 pr-4">Swap fee</td>
                    <td className="py-2 pr-4">{s.initiatorFundingRef ?? s.id.slice(-8).toUpperCase()}</td>
                    <td className="py-2 text-[var(--text-tertiary)]">Leg-fee Sales Receipt missing — awaiting hourly retry.</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Confirm gate for the payout run. Styled like the shared admin
          reason-modal (which can't be reused here — the endpoint takes no
          reason string), but it states the exact amount, order count and
          seller count before the operator can arm it. z-index 60 clears the
          PWA bottom tab bar (z55). */}
      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm payout run"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !running) setConfirmOpen(false);
          }}
          onClick={(e) => {
            // Click-outside cancels, but never mid-flight (a second POST while
            // the first is in the air is how you double-pay).
            if (e.target === e.currentTarget && !running) setConfirmOpen(false);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            background: 'rgba(0,0,0,0.45)',
            backdropFilter: 'blur(2px)',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 460,
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
              borderRadius: 10,
              padding: 20,
            }}
          >
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Disburse {rand(payableCents)} to {payableSellers} seller
              {payableSellers === 1 ? '' : 's'}?
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              {payablePayouts.length} order{payablePayouts.length === 1 ? '' : 's'} will
              be sent to Peach Payouts and stamped paid on acceptance — this moves
              real money out of the client-funds account and cannot be undone from
              this screen.
              {belowFloor.length > 0 &&
                ` ${belowFloor.length} of them sit below the R10 gateway minimum and will be skipped.`}
              {blockedPayouts.length > 0 &&
                ` ${blockedPayouts.length} blocked order${blockedPayouts.length === 1 ? '' : 's'} (${rand(blockedCents)}) stay in the queue.`}
            </p>
            <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
              If payouts are still switched off server-side the API rejects this
              and nothing moves — the result is shown on the page either way.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                disabled={running}
                onClick={() => setConfirmOpen(false)}
                className="text-xs px-3 py-1.5 rounded-[6px]"
                style={{
                  background: 'transparent',
                  border: '0.5px solid var(--border)',
                  color: 'var(--text-secondary)',
                  cursor: running ? 'not-allowed' : 'pointer',
                  opacity: running ? 0.5 : 1,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={running}
                onClick={() => void runPayouts()}
                className="text-xs px-3 py-1.5 rounded-[6px]"
                style={{
                  background: 'var(--red)',
                  color: '#fff',
                  border: 'none',
                  cursor: running ? 'not-allowed' : 'pointer',
                  opacity: running ? 0.6 : 1,
                }}
              >
                {running ? 'Running…' : `Yes — pay out ${rand(payableCents)}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
