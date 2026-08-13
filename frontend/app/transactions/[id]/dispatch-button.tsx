'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { Transaction } from '@/lib/types';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

function formatRand(cents: number) {
  return `R${(cents / 100).toLocaleString('en-ZA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// P5.2: when the platform has booked the courier (shipmentBookedAt set), the
// seller no longer types a tracking number — they get the waybill (plus a PIN
// if the carrier issued one) here, print the label (or write the waybill on the
// parcel), hand it over, and confirm. The legacy manual-entry form is kept as a
// FALLBACK for the rare case where booking failed (carrier outage) so dispatch
// never blocks.
//
// TWO THINGS ARE NOT KNOWABLE FROM HERE, and guessing either one costs the
// seller a wasted trip or a wasted print:
//
//   • WHAT THE SELLER HAS TO DO. shippingMethod names the SHAPE of the delivery
//     (PUDO = collection point, TCG = door), not the company carrying it, so
//     "drop it at a Pudo locker" is only true where the seller arranges their
//     own hand-over. GET /shipping/seller-courier-model answers that
//     server-side — `sellerPicksOption: false` means a courier collects from
//     the seller's ADDRESS for BOTH delivery shapes and the buyer's choice of
//     door vs collection point changes nothing on the seller's side. There is
//     no feature flag for this page to read, by design.
//
//   • WHETHER A PRINTABLE WAYBILL EXISTS. Not every carrier serves a label, and
//     a booking still awaiting the courier's acceptance has no label yet.
//     GET /transactions/:id/waybill answers 400 for both, which is "there is no
//     label", not an error — we drop the button and keep the "write the waybill
//     number on the package" guidance instead.
//
// A booked shipment can also FAIL (parcel didn't fit, nobody home at
// collection). GET /transactions/:id/shipment/failure is the seller's side of
// that — what happened, what it cost them, and whether the listing's
// measurements must be corrected before POST .../shipment/rebook will book
// again.

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-primary)',
  borderRadius: '6px',
  padding: '8px 12px',
  fontSize: '14px',
  outline: 'none',
};

// Shape of GET /transactions/:id/shipment/failure (mirrors
// TransactionsService.shipmentFailureForSeller). The endpoint answers null when
// nothing has failed, so every field here only exists once one has.
interface ShipmentFailure {
  reason: string | null;
  label: string | null;
  note: string | null;
  failedAt: string | null;
  chargedCents: number;
  mustRemeasure: boolean;
  rebookCount: number;
}

export function DispatchButton({ tx }: { tx: Transaction }) {
  const router = useRouter();
  const { getToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [trackingRef, setTrackingRef] = useState(tx.trackingReference ?? '');
  const [pudoId, setPudoId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printErr, setPrintErr] = useState<string | null>(null);
  // Set when the waybill endpoint says there is no label to print (see the
  // header note). Not an error state — the button just goes away.
  const [noWaybill, setNoWaybill] = useState(false);
  const [failure, setFailure] = useState<ShipmentFailure | null>(null);
  const [rebooking, setRebooking] = useState(false);
  const [rebookErr, setRebookErr] = useState<string | null>(null);
  // Whether the seller still arranges their own hand-over, answered by the
  // server. Seeded with today's rail so a slow or failed lookup leaves this
  // panel exactly as it is now.
  const [sellerPicksOption, setSellerPicksOption] = useState(true);

  // Mirror the server's seller-courier model. One-shot on mount; a missing,
  // failed or malformed response leaves the seller-picks default in place.
  useEffect(() => {
    fetch(`${API_URL}/shipping/seller-courier-model`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m: { sellerPicksOption?: unknown } | null) => {
        if (m && typeof m.sellerPicksOption === 'boolean') {
          setSellerPicksOption(m.sellerPicksOption);
        }
      })
      .catch(() => {});
  }, []);

  // The failed-shipment record, if there is one. Re-read when the booking stamp
  // changes so a re-book refreshes it. Nothing here surfaces an error: a seller
  // who can't reach this endpoint must still be able to ship.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(
          `${API_URL}/transactions/${tx.id}/shipment/failure`,
          { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
        );
        if (!res.ok) return;
        // "No failure" comes back as an EMPTY body, which json() throws on.
        const data = (await res.json().catch(() => null)) as ShipmentFailure | null;
        if (!cancelled) setFailure(data?.failedAt ? data : null);
      } catch {
        // Leave the panel as-is.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tx.id, tx.shipmentBookedAt, getToken]);

  // A real shipment has been booked by the platform → show the booked panel.
  const booked = Boolean(tx.shipmentBookedAt && tx.trackingReference);
  const isPudo = tx.shippingMethod === 'PUDO';
  // The ONLY shape where the seller takes the parcel somewhere themselves. When
  // the server says they no longer pick the option, a courier collects from
  // their address for both shapes — telling them to visit a locker would send
  // them on a wasted trip AND make them miss the collection.
  const sellerDropsOff = sellerPicksOption && isPudo;

  // What the seller actually has to do, worded the same way the booking
  // notification words it. Never names a carrier the parcel may not be with.
  const handoverCopy = sellerDropsOff
    ? 'We’ve booked your Pudo shipment. Drop the parcel at any Pudo locker using the PIN below.'
    : sellerPicksOption
      ? 'We’ve booked The Courier Guy to collect from your pickup address.'
      : 'A courier collects the parcel from your address between 08:00 and 17:00 — have it packed and ready. You don’t drop it anywhere, whether the buyer chose their door or a collection point.';

  // The failure record deliberately SURVIVES a re-book — it's the record of
  // what happened and why the payout is short — so "a failure exists" is not
  // "this sale still needs re-booking". A booking stamped after the failure, or
  // one sitting with the courier awaiting acceptance (a shipment id but no
  // stamp yet), means the re-book already happened.
  const failedAtMs = failure?.failedAt ? Date.parse(failure.failedAt) : null;
  const bookedAtMs = tx.shipmentBookedAt ? Date.parse(tx.shipmentBookedAt) : null;
  const reBooked =
    failure !== null &&
    ((bookedAtMs !== null && failedAtMs !== null && bookedAtMs > failedAtMs) ||
      (failure.rebookCount > 0 && bookedAtMs === null && !!tx.carrierShipmentId));
  const needsRebook = failure !== null && !reBooked;

  const requiresTracking =
    tx.shippingMethod === 'PUDO' || tx.shippingMethod === 'TCG';
  const trackingOk = !requiresTracking || trackingRef.trim().length >= 3;
  const canSubmit = trackingOk && !loading;
  // A carrier-specific example is wrong the moment the parcel isn't with that
  // carrier, and the seller is copying the number off their own booking anyway.
  const trackingPlaceholder = !sellerPicksOption
    ? 'Waybill / tracking number'
    : tx.shippingMethod === 'TCG'
      ? 'TCG waybill number'
      : 'e.g. PUD-12345';

  async function handleSubmit() {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const body: Record<string, string> = {};
      if (trackingRef) body.trackingReference = trackingRef.trim();
      if (sellerDropsOff && pudoId) body.pudoDropoffLockerId = pudoId.trim();

      const res = await fetch(`${API_URL}/transactions/${tx.id}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `Error ${res.status}`);
      }
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setLoading(false);
      setConfirmOpen(false);
    }
  }

  // Print the waybill — fetched through our own auth-checked proxy so the
  // carrier api_key never reaches the browser. We get the PDF as a blob and
  // open it in a new tab for printing.
  async function printWaybill() {
    setPrinting(true);
    setPrintErr(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/transactions/${tx.id}/waybill`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        // 400 is the endpoint saying there is no label for this shipment —
        // either the carrier serves none, or the courier hasn't accepted the
        // booking yet. That's not a failure the seller can act on, so we hide
        // the button and let the write-it-on-the-parcel guidance take over.
        if (res.status === 400) {
          setNoWaybill(true);
          return;
        }
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `Error ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setPrintErr(e instanceof Error ? e.message : 'Could not load the waybill.');
    } finally {
      setPrinting(false);
    }
  }

  // Book a fresh collection after a failed one. The endpoint refuses (200 with
  // rebooked:false) when the seller hasn't fixed what broke it — the `reason`
  // it hands back is written for the seller, so it is shown verbatim rather
  // than replaced with a guess at what went wrong.
  async function rebookShipment() {
    setRebooking(true);
    setRebookErr(null);
    try {
      const token = await getToken();
      const res = await fetch(
        `${API_URL}/transactions/${tx.id}/shipment/rebook`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
      );
      const data = (await res.json().catch(() => ({}))) as {
        rebooked?: boolean;
        reason?: string;
        message?: string;
      };
      if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
      if (!data.rebooked) {
        setRebookErr(data.reason ?? 'The courier could not be booked. Try again shortly.');
        return;
      }
      // The new waybill (and PIN, if there is one) live on the server. Whether
      // the previous booking had a printable label says nothing about this
      // one's, so that answer is discarded with it.
      setNoWaybill(false);
      router.refresh();
    } catch (e) {
      setRebookErr(
        e instanceof Error ? e.message : 'Could not book the courier again.',
      );
    } finally {
      setRebooking(false);
    }
  }

  // The failed-shipment record. Shown wherever this panel lands — including
  // after a successful re-book, because the charge is still coming off the
  // payout and a seller who first learns that from their statement is a
  // support ticket.
  const failureNotice = failure && (
    <div
      className="rounded-[8px] p-4"
      style={{ background: 'rgba(200,16,46,0.08)', border: '0.5px solid var(--red)' }}
    >
      <p className="text-sm mb-1" style={{ color: 'var(--red)', fontWeight: 600 }}>
        This shipment failed
      </p>
      <p className="text-sm" style={{ color: 'var(--text-primary)', lineHeight: 1.55 }}>
        {failure.label ?? 'The courier couldn’t complete this shipment.'}
      </p>
      {failure.note && (
        <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {failure.note}
        </p>
      )}
      {failure.chargedCents > 0 && (
        <p className="text-sm mt-2" style={{ color: 'var(--text-primary)', lineHeight: 1.55 }}>
          <strong>{formatRand(failure.chargedCents)}</strong> — the courier
          charge for the booking that carried nothing — will be deducted from
          your payout on this sale.
        </p>
      )}
      {reBooked && (
        <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          You&apos;ve booked the courier again since — this is the record of the
          attempt that failed.
        </p>
      )}
    </div>
  );

  // P6.2 — a consolidated SIBLING never dispatches on its own. The carrier
  // ("main item") line owns the waybill + Pudo PIN, and dispatching it mirrors
  // dispatch onto this line automatically. The order page already hides this
  // panel for siblings; this guard is defence-in-depth (and keeps a stray
  // sibling from showing the manual-entry fallback) — point the seller at the
  // main item instead.
  if (tx.shipsWithId) {
    return (
      <div
        className="rounded-[6px] px-4 py-3 text-sm"
        style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)', color: 'var(--text-secondary)', lineHeight: 1.55 }}
      >
        This item ships in one parcel with the rest of this order. Print the
        waybill and mark it dispatched from the{' '}
        <a
          href={`/transactions/${tx.shipsWithId}`}
          style={{ color: 'var(--red)', textDecoration: 'underline' }}
        >
          main item
        </a>{' '}
        — this line moves with it automatically.
      </div>
    );
  }

  if (done) {
    return (
      <div
        className="rounded-[6px] px-4 py-3 text-sm"
        style={{ background: 'rgba(0,160,60,0.10)', color: '#00a03c', border: '0.5px solid rgba(0,160,60,0.2)' }}
      >
        Marked as handed over. The buyer has been notified and tracking will
        update automatically.
      </div>
    );
  }

  // ── Failed shipment — nothing to print, nothing to hand over ────────
  // Deliberately replaces the booked panel rather than sitting above it: the
  // waybill from the failed booking is dead, and a seller who tapes it to the
  // box is waiting for a collection nobody is coming to.
  if (needsRebook) {
    return (
      <div className="space-y-3">
        {failureNotice}
        <div
          className="rounded-[8px] p-4"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        >
          <p className="text-sm mb-1" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
            Book the courier again
          </p>
          {failure?.mustRemeasure ? (
            <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              Correct the parcel size and weight on the listing FIRST — the same
              measurements will fail the same way, and the re-booking is refused
              until they&apos;ve been updated.{' '}
              <a
                href={`/listings/${tx.listingId}/edit`}
                style={{ color: 'var(--red)', textDecoration: 'underline' }}
              >
                Edit the listing
              </a>
              , then come back here.
            </p>
          ) : (
            <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              {sellerDropsOff
                ? 'The old waybill is dead. Booking again issues a new waybill and a new drop-off PIN.'
                : 'The old waybill is dead. Booking again gets a fresh collection — have the parcel packed and someone at the collection address between 08:00 and 17:00.'}
            </p>
          )}

          <button
            onClick={rebookShipment}
            disabled={rebooking}
            className="w-full py-2.5 rounded-[6px] text-sm"
            style={{
              background: rebooking ? 'var(--bg-inset)' : 'var(--red)',
              color: rebooking ? 'var(--text-tertiary)' : '#fff',
              border: 'none',
              cursor: rebooking ? 'not-allowed' : 'pointer',
              fontWeight: 500,
            }}
          >
            {rebooking ? 'Booking…' : 'Book the courier again'}
          </button>
          {rebookErr && (
            <p className="text-xs mt-2" style={{ color: 'var(--red)', lineHeight: 1.5 }}>
              {rebookErr}
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Booked panel — everything the seller needs to ship ──────────────
  if (booked) {
    return (
      <div className="space-y-3">
        {failureNotice}
        <div
          className="rounded-[8px] p-4"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        >
          <p className="text-sm mb-1" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
            Ready to ship
          </p>
          <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
            {handoverCopy}
          </p>

          <div
            className="rounded-[6px] px-3 py-2 mb-2 flex items-center justify-between gap-3"
            style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)' }}
          >
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Waybill / tracking</span>
            <code className="text-sm" style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>
              {tx.trackingReference}
            </code>
          </div>

          {/* Only a seller who walks the parcel to a locker has a DROP-OFF PIN.
              Any other PIN belongs to the collection, so it's labelled as one
              rather than sending someone to a locker screen. Carriers that
              issue no PIN simply have nothing here — the legacy door slot never
              had one either, so this renders exactly as before. */}
          {tx.carrierDropoffPin && (
            <div
              className="rounded-[6px] px-3 py-2 mb-2 flex items-center justify-between gap-3"
              style={{ background: 'rgba(0,160,60,0.08)', border: '0.5px solid rgba(0,160,60,0.25)' }}
            >
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {sellerDropsOff ? 'Locker drop-off PIN' : 'Collection PIN'}
              </span>
              <code className="text-base" style={{ fontFamily: 'monospace', color: '#00a03c', fontWeight: 700, letterSpacing: '0.05em' }}>
                {tx.carrierDropoffPin}
              </code>
            </div>
          )}

          {!noWaybill && (
            <button
              onClick={printWaybill}
              disabled={printing}
              className="w-full py-2.5 rounded-[6px] text-sm mt-1"
              style={{
                background: printing ? 'var(--bg-inset)' : 'var(--red)',
                color: printing ? 'var(--text-tertiary)' : '#fff',
                border: 'none',
                cursor: printing ? 'not-allowed' : 'pointer',
                fontWeight: 500,
              }}
            >
              {printing ? 'Loading waybill…' : 'Print waybill'}
            </button>
          )}
          {printErr && (
            <p className="text-xs mt-2" style={{ color: 'var(--red)' }}>{printErr}</p>
          )}

          <p
            className="text-xs mt-3 px-3 py-2 rounded-[6px]"
            style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)', lineHeight: 1.5 }}
          >
            <strong style={{ color: 'var(--text-primary)' }}>
              {noWaybill ? 'No label to print' : 'Can’t print?'}
            </strong>{' '}
            Write the waybill number{' '}
            <code style={{ fontFamily: 'monospace' }}>{tx.trackingReference}</code>{' '}
            clearly on the package so the courier can match it.
          </p>
        </div>

        {error && (
          <div
            className="px-3 py-2 rounded-[6px] text-sm"
            style={{ background: 'rgba(200,16,46,0.08)', border: '0.5px solid var(--red)', color: 'var(--red)' }}
          >
            {error}
          </div>
        )}

        <button
          onClick={() => setConfirmOpen(true)}
          className="w-full py-2.5 rounded-[6px] text-sm"
          style={{ background: 'var(--bg-inset)', color: 'var(--text-primary)', border: '0.5px solid var(--border)', cursor: 'pointer', fontWeight: 500 }}
        >
          {sellerDropsOff ? 'I’ve dropped it off' : 'I’ve handed it to the courier'}
        </button>
        <p className="text-xs text-center" style={{ color: 'var(--text-tertiary)' }}>
          Optional — tracking updates on its own once the courier scans it.
        </p>

        {confirmOpen && (
          <ConfirmModal
            loading={loading}
            trackingRef={tx.trackingReference ?? ''}
            pudoId={null}
            onCancel={() => setConfirmOpen(false)}
            onConfirm={handleSubmit}
          />
        )}
      </div>
    );
  }

  // ── Fallback: manual tracking entry (booking unavailable) ───────────
  if (!open) {
    return (
      <div className="space-y-3">
        {failureNotice}
        <button
          onClick={() => setOpen(true)}
          className="w-full py-2.5 rounded-[6px] text-sm"
          style={{ background: 'var(--red)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 500 }}
        >
          Confirm dispatch
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {failureNotice}
      <p className="text-xs" style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
        Automatic booking isn&apos;t available for this order — enter the
        tracking reference from your own courier booking below.
      </p>
      {error && (
        <div
          className="px-3 py-2 rounded-[6px] text-sm"
          style={{ background: 'rgba(200,16,46,0.08)', border: '0.5px solid var(--red)', color: 'var(--red)' }}
        >
          {error}
        </div>
      )}

      {/* Only asked where the seller genuinely drops the parcel at a locker —
          elsewhere there is no drop-off, so there is no locker id to give. */}
      {sellerDropsOff && (
        <div>
          <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
            Pudo drop-off locker ID (optional)
          </label>
          <input
            type="text"
            value={pudoId}
            onChange={(e) => setPudoId(e.target.value)}
            placeholder="e.g. PUD-12345"
            style={inputStyle}
          />
        </div>
      )}

      <div>
        <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
          Tracking reference {requiresTracking ? '(required)' : '(optional)'}
        </label>
        <input
          type="text"
          value={trackingRef}
          onChange={(e) => setTrackingRef(e.target.value)}
          placeholder={trackingPlaceholder}
          style={{
            ...inputStyle,
            border: `0.5px solid ${
              requiresTracking && trackingRef.length > 0 && !trackingOk
                ? 'var(--red)'
                : 'var(--border)'
            }`,
          }}
        />
        {requiresTracking && (
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
            The buyer uses this to track their parcel — required for
            {sellerDropsOff ? ' Pudo' : ' courier'} dispatch.
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => canSubmit && setConfirmOpen(true)}
          disabled={!canSubmit}
          className="flex-1 py-2.5 rounded-[6px] text-sm"
          style={{
            background: canSubmit ? 'var(--red)' : 'var(--bg-inset)',
            color: canSubmit ? '#fff' : 'var(--text-tertiary)',
            border: 'none',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            fontWeight: 500,
          }}
          title={!trackingOk ? 'Enter the tracking reference first' : undefined}
        >
          Confirm dispatch
        </button>
        <button
          onClick={() => setOpen(false)}
          className="px-4 py-2.5 rounded-[6px] text-sm"
          style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)', border: '0.5px solid var(--border)', cursor: 'pointer' }}
        >
          Cancel
        </button>
      </div>

      {confirmOpen && (
        <ConfirmModal
          loading={loading}
          trackingRef={trackingRef.trim()}
          pudoId={sellerDropsOff && pudoId ? pudoId.trim() : null}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={handleSubmit}
        />
      )}
    </div>
  );
}

// Shared confirmation modal — the consequence of dispatch (clock starts,
// buyer notified, SLA strike if the parcel doesn't move) is the thing
// sellers most often misunderstand, so we state it plainly.
function ConfirmModal({
  loading,
  trackingRef,
  pudoId,
  onCancel,
  onConfirm,
}: {
  loading: boolean;
  trackingRef: string;
  pudoId: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      onClick={() => !loading && onCancel()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 480,
          width: '100%',
          padding: 24,
          borderRadius: 10,
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        <p className="text-base mb-2" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
          Confirm hand-over — this can&apos;t be undone
        </p>
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          The buyer&apos;s 7-day delivery clock starts now and they&apos;ll be
          notified the parcel is on its way. Only confirm once you&apos;ve
          actually dropped it off / handed it to the courier.
        </p>
        <div
          style={{
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            borderRadius: 6,
            padding: 12,
            marginBottom: 16,
            fontSize: 13,
            color: 'var(--text-secondary)',
          }}
        >
          <p>
            <strong style={{ color: 'var(--text-primary)' }}>Tracking ref:</strong>{' '}
            <code style={{ fontFamily: 'monospace' }}>{trackingRef || '(none)'}</code>
          </p>
          {pudoId && (
            <p style={{ marginTop: 4 }}>
              <strong style={{ color: 'var(--text-primary)' }}>Pudo locker:</strong>{' '}
              <code style={{ fontFamily: 'monospace' }}>{pudoId}</code>
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2 rounded text-sm"
            style={{
              background: 'var(--bg-inset)',
              color: 'var(--text-secondary)',
              border: '0.5px solid var(--border)',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-2 rounded text-sm font-medium"
            style={{
              background: loading ? 'var(--bg-inset)' : 'var(--red)',
              color: loading ? 'var(--text-tertiary)' : '#fff',
              border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Confirming…' : 'Yes, handed over'}
          </button>
        </div>
      </div>
    </div>
  );
}
