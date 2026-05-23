'use client';

// ─────────────────────────────────────────────────────────────────────
// Admin · Per-raffle dossier
//
// Single-page operator view for everything they need AFTER a draw:
//   - raffle header (title, status, sold counts, draw timestamp)
//   - winner card per position (1 + up to 2 backups), each with the
//     winner's real name, contact details, shipping address, claim
//     state, and a "Mark as dispatched" CTA when applicable
//   - link out to the audit log + draw-proof
//
// HIGH-PII page — guarded by AdminJwtGuard server-side; the
// adminFetch helper carries the bearer token. We deliberately render
// real names and phone numbers on this page because the operator
// physically needs them to ship the prize. Anywhere else (public
// proof, buyer dashboard) the username remains the only identifier.
// ─────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import {
  AdminRaffleWinnerDossier,
  DrawProof,
} from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Carrier suggestions for the "Mark as dispatched" modal. Freeform
// text is still accepted (the field is just a <input list=>) — these
// are the ones the notification template knows how to deep-link.
const CARRIER_SUGGESTIONS = ['Pudo', 'The Courier Guy', 'Aramex', 'Other'];

export default function AdminCompetitionDossierPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const [dossier, setDossier] = useState<AdminRaffleWinnerDossier | null>(null);
  const [proof, setProof] = useState<DrawProof | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state — which winner row is currently being marked as
  // dispatched. null when the modal is closed.
  const [dispatchingFor, setDispatchingFor] = useState<string | null>(null);

  // Bumped after each successful dispatch so the useEffect re-fetches
  // the dossier without a full page reload. Plain version counter
  // beats lifting all of the modal state up here.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!requireAdminToken()) return;
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [winnersRes, proofRes] = await Promise.all([
          adminFetch(`/admin/raffles/${id}/winners`),
          // Proof endpoint is public — use plain fetch so it doesn't
          // get an auth header it doesn't need.
          fetch(`${API_URL}/raffles/${id}/proof`, { cache: 'no-store' }),
        ]);
        if (cancelled) return;
        if (!winnersRes.ok) {
          const body = await safeJson(winnersRes);
          throw new Error(body?.message ?? `HTTP ${winnersRes.status}`);
        }
        setDossier((await winnersRes.json()) as AdminRaffleWinnerDossier);
        if (proofRes.ok) setProof(await proofRes.json());
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, version]);

  if (loading) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
        Loading dossier…
      </p>
    );
  }
  if (error || !dossier) {
    return (
      <p className="text-sm" style={{ color: 'var(--red)' }}>
        {error ?? 'Could not load this raffle.'}
      </p>
    );
  }

  const { raffle, winners } = dossier;

  return (
    <div>
      <Link
        href="/admin/competitions"
        className="text-sm inline-block mb-4"
        style={{ color: 'var(--text-tertiary)' }}
      >
        ← All competitions
      </Link>

      {/* ─── Header card ──────────────────────────────────────── */}
      <div
        className="rounded-[6px] p-5 mb-5"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1
              className="text-xl"
              style={{ color: 'var(--text-primary)', fontWeight: 500 }}
            >
              {raffle.title}
            </h1>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              {raffle.referenceNumber && (
                <span style={{ fontFamily: 'monospace' }}>
                  {raffle.referenceNumber}
                </span>
              )}
              {raffle.referenceNumber && ' · '}
              {raffle.status.replace(/_/g, ' ')}
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-xs">
            <Link
              href={`/admin/competitions/${raffle.id}/audit`}
              className="hover:underline"
              style={{ color: 'var(--red)' }}
            >
              Audit log →
            </Link>
            {proof?.drawnAt && (
              <Link
                href={`/competitions/${raffle.id}/proof`}
                target="_blank"
                rel="noreferrer"
                className="hover:underline"
                style={{ color: '#3b82f6' }}
              >
                Public draw proof ↗
              </Link>
            )}
            <Link
              href={`/competitions/${raffle.id}`}
              target="_blank"
              rel="noreferrer"
              className="hover:underline"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Buyer view ↗
            </Link>
          </div>
        </div>

        {proof && (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <Stat
              label="Sold"
              value={`${proof.ticketsSoldPaid + proof.ticketsSoldPostal}`}
            />
            <Stat label="Paid" value={`${proof.ticketsSoldPaid}`} />
            <Stat label="Postal" value={`${proof.ticketsSoldPostal}`} />
            <Stat
              label="Drawn at"
              value={
                proof.drawnAt
                  ? new Date(proof.drawnAt).toLocaleString('en-ZA')
                  : '—'
              }
            />
          </div>
        )}
      </div>

      {/* ─── Winner cards (1 + backups) ───────────────────────── */}
      <p
        className="text-xs uppercase tracking-wider mb-2"
        style={{ color: 'var(--text-tertiary)' }}
      >
        Winners
      </p>
      {winners.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          No winners drawn yet.
        </p>
      ) : (
        <div className="space-y-4">
          {winners.map((w) => (
            <WinnerCard
              key={w.id}
              winner={w}
              onDispatch={() => setDispatchingFor(w.id)}
            />
          ))}
        </div>
      )}

      {/* ─── Dispatch modal ─────────────────────────────────────
          Rendered at the page root so the body scroll lock works the
          same for any winner row that opens it. Closes itself on a
          successful POST and triggers a dossier refetch via the
          version counter so the badge flips green immediately. */}
      {dispatchingFor && (
        <DispatchModal
          winner={winners.find((w) => w.id === dispatchingFor)!}
          onClose={() => setDispatchingFor(null)}
          onSuccess={() => {
            setDispatchingFor(null);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}

// ─── Winner card ─────────────────────────────────────────────────────

function WinnerCard({
  winner,
  onDispatch,
}: {
  winner: AdminRaffleWinnerDossier['winners'][number];
  onDispatch: () => void;
}) {
  const { user } = winner;
  // Position 1 = the primary winner. Backups (2, 3) are only relevant
  // for the operator once the primary forfeits, but we render them all
  // up-front because the address info is useful regardless.
  const isPrimary = winner.position === 1;
  const label = isPrimary ? 'Winner' : `Backup #${winner.position - 1}`;

  const claimState: 'CLAIMED' | 'FORFEITED' | 'AWAITING' = winner.claimedAt
    ? 'CLAIMED'
    : winner.forfeitedAt
      ? 'FORFEITED'
      : 'AWAITING';
  const dispatchState: 'DISPATCHED' | 'PENDING' | 'BLOCKED' = winner.prizeDispatchedAt
    ? 'DISPATCHED'
    : claimState === 'CLAIMED'
      ? 'PENDING'
      : 'BLOCKED';

  return (
    <div
      className="rounded-[6px] p-5"
      style={{
        background: 'var(--bg-card)',
        // Highlight the primary winner with a slightly stronger
        // border so the operator's eye lands on it first.
        border: isPrimary
          ? '0.5px solid var(--red)'
          : '0.5px solid var(--border)',
      }}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <p
            className="text-[10px] uppercase tracking-wider"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {label}
          </p>
          <p
            className="text-base mt-0.5"
            style={{ color: 'var(--text-primary)', fontWeight: 500 }}
          >
            {user?.username ?? '(postal entry)'}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* Two-pill cluster — claim state first, dispatch second.
              Together they tell the operator "where is this prize in
              the post-draw pipeline?". */}
          <Pill
            tone={
              claimState === 'CLAIMED'
                ? 'success'
                : claimState === 'FORFEITED'
                  ? 'error'
                  : 'pending'
            }
            label={
              claimState === 'CLAIMED'
                ? `Claimed · ${formatDate(winner.claimedAt!)}`
                : claimState === 'FORFEITED'
                  ? `Forfeited · ${formatDate(winner.forfeitedAt!)}`
                  : `Awaiting claim · deadline ${formatDate(winner.claimDeadline)}`
            }
          />
          <Pill
            tone={
              dispatchState === 'DISPATCHED'
                ? 'success'
                : dispatchState === 'PENDING'
                  ? 'error' // red is intentional — it's a to-do
                  : 'neutral'
            }
            label={
              dispatchState === 'DISPATCHED'
                ? `Dispatched · ${formatDate(winner.prizeDispatchedAt!)}`
                : dispatchState === 'PENDING'
                  ? 'To dispatch'
                  : 'Awaiting claim'
            }
          />
        </div>
      </div>

      {/* Contact + address — only when a user is attached. Postal
          entries have no User row; we show a stub instead so the
          operator knows to look in the postal entries page. */}
      {user ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Field
            label="Real name"
            value={
              [user.firstName, user.lastName].filter(Boolean).join(' ') || '—'
            }
          />
          <Field label="Email" value={user.email} mono />
          <Field label="Phone" value={user.phone ?? '—'} mono />
          <Field
            label="Ticket"
            value={winner.ticketId}
            mono
          />
          <div className="md:col-span-2">
            <Field
              label="Shipping address"
              value={formatAddress(user)}
              multiline
            />
          </div>
        </div>
      ) : (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Postal entry — contact details live on the postal-entries page.
        </p>
      )}

      {/* Dispatch metadata, only when already dispatched. */}
      {winner.prizeDispatchedAt && (
        <div
          className="mt-4 pt-4 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm"
          style={{ borderTop: '0.5px solid var(--border)' }}
        >
          <Field
            label="Tracking ref"
            value={winner.prizeTrackingRef ?? '—'}
            mono
          />
          <Field
            label="Carrier"
            value={winner.prizeCarrierLabel ?? '—'}
          />
          <Field
            label="Dispatched by"
            value={
              winner.prizeDispatchedByAdminId
                ? winner.prizeDispatchedByAdminId.slice(0, 8) + '…'
                : '—'
            }
            mono
          />
          <Field
            label="Dispatched at"
            value={formatDate(winner.prizeDispatchedAt)}
          />
          {winner.prizeDispatchNote && (
            <div className="md:col-span-2">
              <Field
                label="Admin note"
                value={winner.prizeDispatchNote}
                multiline
              />
            </div>
          )}
        </div>
      )}

      {/* Action button — only when the winner has claimed AND the
          prize is not yet dispatched AND they haven't forfeited.
          Forfeited backups can't ship until promoted; primary winners
          who haven't claimed can't either (the operator might ship
          something the winner can't legally receive otherwise). */}
      {dispatchState === 'PENDING' && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={onDispatch}
            className="text-sm px-4 py-2 rounded-[6px]"
            style={{
              background: 'var(--red)',
              color: '#fff',
              border: 'none',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Mark as dispatched
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Dispatch modal ──────────────────────────────────────────────────

function DispatchModal({
  winner,
  onClose,
  onSuccess,
}: {
  winner: AdminRaffleWinnerDossier['winners'][number];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [trackingRef, setTrackingRef] = useState('');
  const [carrierLabel, setCarrierLabel] = useState('Pudo');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!trackingRef.trim()) {
      setError('Tracking reference is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await adminFetch(
        `/admin/raffles/winners/${winner.id}/dispatch`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trackingRef: trackingRef.trim(),
            carrierLabel: carrierLabel.trim() || undefined,
            note: note.trim() || undefined,
          }),
        },
      );
      if (!res.ok) {
        const body = await safeJson(res);
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-[8px] p-5"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        <h2
          className="text-base mb-1"
          style={{ color: 'var(--text-primary)', fontWeight: 500 }}
        >
          Mark prize as dispatched
        </h2>
        <p
          className="text-xs mb-4"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Sends an SMS + email to{' '}
          <span style={{ color: 'var(--text-secondary)' }}>
            {winner.user?.username ?? '(no user)'}
          </span>{' '}
          with the tracking reference below.
        </p>

        <label className="block mb-3">
          <span
            className="text-xs uppercase tracking-wider"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Tracking reference *
          </span>
          <input
            type="text"
            value={trackingRef}
            onChange={(e) => setTrackingRef(e.target.value)}
            placeholder="e.g. PUDO12345678"
            required
            className="w-full mt-1 px-3 py-2 rounded-[6px] text-sm"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
              outline: 'none',
            }}
          />
        </label>

        <label className="block mb-3">
          <span
            className="text-xs uppercase tracking-wider"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Carrier
          </span>
          <input
            type="text"
            list="carrier-suggestions"
            value={carrierLabel}
            onChange={(e) => setCarrierLabel(e.target.value)}
            placeholder="Pudo / The Courier Guy / Aramex"
            className="w-full mt-1 px-3 py-2 rounded-[6px] text-sm"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
              outline: 'none',
            }}
          />
          {/* Datalist gives the operator one-keystroke recall of the
              carriers we already know how to deep-link in the email. */}
          <datalist id="carrier-suggestions">
            {CARRIER_SUGGESTIONS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>

        <label className="block mb-4">
          <span
            className="text-xs uppercase tracking-wider"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Note (optional)
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Waybill #, condition on dispatch, etc."
            rows={3}
            className="w-full mt-1 px-3 py-2 rounded-[6px] text-sm"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
              outline: 'none',
              resize: 'vertical',
            }}
          />
        </label>

        {error && (
          <p className="text-xs mb-3" style={{ color: 'var(--red)' }}>
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-sm px-3 py-2 rounded-[6px]"
            style={{
              background: 'transparent',
              color: 'var(--text-tertiary)',
              border: '0.5px solid var(--border)',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="text-sm px-4 py-2 rounded-[6px]"
            style={{
              background: 'var(--red)',
              color: '#fff',
              border: 'none',
              fontWeight: 500,
              cursor: submitting ? 'wait' : 'pointer',
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? 'Sending…' : 'Confirm dispatch'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Small reusable bits ─────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p
        className="text-[10px] uppercase tracking-wider"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {label}
      </p>
      <p
        className="text-sm mt-0.5"
        style={{ color: 'var(--text-primary)' }}
      >
        {value}
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  multiline,
}: {
  label: string;
  value: string;
  mono?: boolean;
  multiline?: boolean;
}) {
  return (
    <div>
      <p
        className="text-[10px] uppercase tracking-wider mb-0.5"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {label}
      </p>
      <p
        className="text-sm"
        style={{
          color: 'var(--text-primary)',
          fontFamily: mono ? 'monospace' : undefined,
          whiteSpace: multiline ? 'pre-line' : undefined,
          wordBreak: 'break-word',
        }}
      >
        {value}
      </p>
    </div>
  );
}

function Pill({
  tone,
  label,
}: {
  tone: 'success' | 'pending' | 'error' | 'neutral';
  label: string;
}) {
  const palette =
    tone === 'success'
      ? { bg: 'rgba(34,197,94,0.12)', fg: '#22c55e' }
      : tone === 'pending'
        ? { bg: 'rgba(245,158,11,0.12)', fg: '#f59e0b' }
        : tone === 'error'
          ? { bg: 'rgba(200,16,46,0.15)', fg: 'var(--red)' }
          : { bg: 'var(--bg-inset)', fg: 'var(--text-tertiary)' };
  return (
    <span
      className="text-[11px] px-2 py-1 rounded-[4px] whitespace-nowrap"
      style={{ background: palette.bg, color: palette.fg, fontWeight: 500 }}
    >
      {label}
    </span>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Multi-line shipping label rendered into the dossier. Concatenates
// every User.addr* field that's set, separated by newlines. Returns
// an em-dash when no address fields are populated so the operator
// knows the winner hasn't filled out their profile yet.
function formatAddress(u: {
  addrBuilding: string | null;
  addrStreet: string | null;
  addrAddress2: string | null;
  addrSuburb: string | null;
  addrCity: string | null;
  addrProvince: string | null;
  addrPostalCode: string | null;
}): string {
  const lines = [
    u.addrBuilding,
    u.addrStreet,
    u.addrAddress2,
    u.addrSuburb,
    [u.addrCity, u.addrPostalCode].filter(Boolean).join(' '),
    u.addrProvince,
  ]
    .map((s) => (s ?? '').trim())
    .filter((s) => s.length > 0);
  return lines.length > 0 ? lines.join('\n') : '— No address on profile —';
}

async function safeJson(res: Response): Promise<{ message?: string } | null> {
  try {
    return (await res.json()) as { message?: string };
  } catch {
    return null;
  }
}
