'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { Transaction } from '@/lib/types';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

function formatRand(cents: number) {
  return `R ${(cents / 100).toLocaleString('en-ZA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// P5.2: when the platform has booked the courier (shipmentBookedAt set), the
// seller no longer types a tracking number — they get the tracking reference
// (plus a collection PIN if the carrier issued one) here, write it on the
// parcel, hand it over, and confirm. The legacy manual-entry form is kept as a
// FALLBACK for the rare case where booking failed (carrier outage) so dispatch
// never blocks.
//
// ONE THING IS NOT KNOWABLE FROM HERE, and guessing it costs the seller a
// wasted trip:
//
//   • WHETHER A PRINTABLE WAYBILL EXISTS. Bob Go has no printable label, so
//     GET /transactions/:id/waybill answers 400, which is "there is no label",
//     not an error — we drop the button and keep the "write the reference on
//     the parcel" guidance instead.
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

  // Firearm DEALER_TRANSFER is not a courier parcel: the seller physically
  // hands the firearm to their SAPS-licensed dealer, and payout releases when
  // the dealer stock-in verification passes — not on a buyer confirm-delivery.
  // Every courier phrase below (handed to the courier, 7-day delivery clock,
  // tracking reference) is therefore wrong on this path.
  const isDealerTransfer = tx.shippingMethod === 'DEALER_TRANSFER';

  // What the seller actually has to do, worded the same way the booking
  // notification words it. Bob Go collects from the seller's address.
  const handoverCopy =
    'A courier collects the parcel from your address between 08:00 and 17:00 — have it packed and ready. You don’t drop it anywhere.';

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

  const requiresTracking = tx.shippingMethod === 'COURIER';
  const trackingOk = !requiresTracking || trackingRef.trim().length >= 3;
  const canSubmit = trackingOk && !loading;
  // The seller copies the number off their own booking, so the placeholder
  // stays generic.
  const trackingPlaceholder = 'Waybill / tracking number';

  async function handleSubmit() {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const body: Record<string, string> = {};
      if (trackingRef) body.trackingReference = trackingRef.trim();

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
      style={{ background: 'rgba(227,6,19,0.08)', border: '0.5px solid var(--red)' }}
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
  // ("main item") line owns the booking, and dispatching it mirrors
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
        style={{ background: 'rgba(0,160,60,0.10)', color: 'var(--success)', border: '0.5px solid rgba(0,160,60,0.2)' }}
      >
        {isDealerTransfer
          ? 'Marked as transferred. The buyer has been notified — now upload the SAPS 534 + stock-in photos so we can verify the dealer stock-in and release your payout.'
          : 'Marked as handed over. The buyer has been notified and tracking will update automatically.'}
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
              The old waybill is dead. Booking again gets a fresh collection —
              have the parcel packed and someone at the collection address
              between 08:00 and 17:00.
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

          {/* A carrier PIN is the collection PIN the courier asks for on
              pickup. Carriers that issue none simply have nothing here. */}
          {tx.carrierDropoffPin && (
            <div
              className="rounded-[6px] px-3 py-2 mb-2 flex items-center justify-between gap-3"
              style={{ background: 'rgba(0,160,60,0.08)', border: '0.5px solid rgba(0,160,60,0.25)' }}
            >
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Collection PIN
              </span>
              <code className="text-base" style={{ fontFamily: 'monospace', color: 'var(--success)', fontWeight: 700, letterSpacing: '0.05em' }}>
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
            style={{ background: 'rgba(227,6,19,0.08)', border: '0.5px solid var(--red)', color: 'var(--red)' }}
          >
            {error}
          </div>
        )}

        <button
          onClick={() => setConfirmOpen(true)}
          className="w-full py-2.5 rounded-[6px] text-sm"
          style={{ background: 'var(--bg-inset)', color: 'var(--text-primary)', border: '0.5px solid var(--border)', cursor: 'pointer', fontWeight: 500 }}
        >
          I’ve handed it to the courier
        </button>
        <p className="text-xs text-center" style={{ color: 'var(--text-tertiary)' }}>
          Optional — tracking updates on its own once the courier scans it.
        </p>

        {confirmOpen && (
          <ConfirmModal
            loading={loading}
            trackingRef={tx.trackingReference ?? ''}
            isDealerTransfer={isDealerTransfer}
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
          {isDealerTransfer ? 'Confirm transfer to dealer' : 'Confirm dispatch'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {failureNotice}
      <p className="text-xs" style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
        {isDealerTransfer
          ? 'Confirm that you have physically transferred the firearm to the receiving dealer.'
          : 'Automatic booking isn\u2019t available for this order \u2014 enter the tracking reference from your own courier booking below.'}
      </p>
      {error && (
        <div
          className="px-3 py-2 rounded-[6px] text-sm"
          style={{ background: 'rgba(227,6,19,0.08)', border: '0.5px solid var(--red)', color: 'var(--red)' }}
        >
          {error}
        </div>
      )}

      {/* No locker drop-off anywhere — Bob Go collects from the address.
          A firearm DEALER_TRANSFER has no tracking reference: the seller hands
          the firearm to the dealer, so the field is hidden entirely. */}
      {!isDealerTransfer && (
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
              The buyer uses this to track their parcel — required for courier
              dispatch.
            </p>
          )}
        </div>
      )}

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
          {isDealerTransfer ? 'Confirm transfer to dealer' : 'Confirm dispatch'}
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
          isDealerTransfer={isDealerTransfer}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={handleSubmit}
        />
      )}
    </div>
  );
}

// Shared confirmation modal — the consequence of dispatch (clock starts,
// buyer notified, SLA strike if the parcel doesn't move) is the thing
// sellers most often misunderstand, so we state it plainly. On a firearm
// DEALER_TRANSFER none of that is true: the release is driven by the dealer
// stock-in verification, so the modal says so instead.
function ConfirmModal({
  loading,
  trackingRef,
  isDealerTransfer,
  onCancel,
  onConfirm,
}: {
  loading: boolean;
  trackingRef: string;
  isDealerTransfer?: boolean;
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
          {isDealerTransfer
            ? 'This tells the buyer the firearm has been transferred to the dealer. Only confirm once you have actually handed it to the SAPS-licensed dealer — you then upload the SAPS 534 + stock-in photos so we can verify the stock-in and release your payout.'
            : "The buyer's 7-day delivery clock starts now and they'll be notified the parcel is on its way. Only confirm once you've actually handed it to the courier."}
        </p>
        {!isDealerTransfer && (
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
          </div>
        )}

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
            {loading
              ? 'Confirming…'
              : isDealerTransfer
                ? 'Yes, transferred'
                : 'Yes, handed over'}
          </button>
        </div>
      </div>
    </div>
  );
}
