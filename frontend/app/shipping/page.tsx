// /shipping — the account "Shipping" module. One place for a user's
// incoming (bought) + outgoing (sold) shipments: courier status + tracking,
// and firearm hand-off (dealer-transfer dealer details / private-arrangement
// contact). Server component — fetches with the user's token like /account.
// Contact + dealer reveal is gated server-side; this page only renders what
// the API returns.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { PageReveal } from '@/components/page-reveal';

const API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001/api';

export const metadata = {
  title: 'Shipping',
  description: 'Track incoming and outgoing shipments and firearm transfers.',
};

interface Shipment {
  transactionId: string;
  role: 'incoming' | 'outgoing';
  listingId: string;
  listingTitle: string;
  imageUrl: string | null;
  isFirearm: boolean;
  method: 'PUDO' | 'TCG' | 'DEALER_TRANSFER' | 'PRIVATE_ARRANGE' | 'COLLECTION';
  status: string | null;
  trackingReference: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  dropoffPin: string | null;
  counterparty: string;
  dealer: {
    confirmed: boolean;
    name: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    licenceNumber: string | null;
  } | null;
  contact:
    | { revealed: true; name: string; phone: string | null; email: string | null }
    | { revealed: false; reason: string }
    | null;
}

const METHOD_LABEL: Record<Shipment['method'], string> = {
  // Slots, not carriers — a PUDO shipment is a collection point on whichever
  // rail carried it, which since 2026-08-14 is Bob Go, not Pudo.
  PUDO: 'Collection point',
  TCG: 'Door delivery',
  DEALER_TRANSFER: 'Dealer-stocked transfer',
  PRIVATE_ARRANGE: 'Private arrangement',
  COLLECTION: 'Collection in person',
};

// Courier status timeline steps in order.
const COURIER_STEPS = ['COLLECTED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const;
const STEP_LABEL: Record<string, string> = {
  COLLECTED: 'Collected',
  IN_TRANSIT: 'In transit',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
};

function fmt(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

export default async function ShippingPage() {
  const { userId, getToken } = await auth();
  if (!userId) redirect('/sign-in?redirect_url=/shipping');
  const token = await getToken();

  let data: { incoming: Shipment[]; outgoing: Shipment[] } = { incoming: [], outgoing: [] };
  // Track the failure instead of swallowing it. An empty list and an
  // unreachable API look identical once you catch into `{ incoming: [] }`,
  // and "No incoming shipments right now." told to a buyer tracking a
  // firearm transfer reads as lost data, not as an outage.
  let errored = false;
  try {
    const r = await fetch(`${API_URL}/my-shipments/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (r.ok) data = await r.json();
    else errored = true;
  } catch {
    errored = true;
  }

  return (
    <>
      <main className="max-w-[860px] mx-auto px-4 py-8">
        <h1 className="text-2xl mb-1" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
          Shipping
        </h1>
        <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
          Track parcels coming to you and going out, and coordinate firearm transfers.
        </p>

        <PageReveal>
          <Section
            title="Incoming"
            subtitle="Items you bought, on their way to you"
            shipments={data.incoming}
            emptyMsg="No incoming shipments right now."
            errored={errored}
          />
          <div style={{ height: 24 }} />
          <Section
            title="Outgoing"
            subtitle="Items you sold, to send or hand over"
            shipments={data.outgoing}
            emptyMsg="Nothing to send right now."
            errored={errored}
          />
        </PageReveal>
      </main>
    </>
  );
}

function Section({
  title,
  subtitle,
  shipments,
  emptyMsg,
  errored,
}: {
  title: string;
  subtitle: string;
  shipments: Shipment[];
  emptyMsg: string;
  /** The /my-shipments/me fetch failed — say so instead of claiming zero. */
  errored: boolean;
}) {
  return (
    <section>
      <h2 className="text-sm" style={{ color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {title}{' '}
        {/* "· 0" would be the same lie as the empty-state copy, so the
            count goes to a dash while we don't actually know it. */}
        <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>· {errored ? '—' : shipments.length}</span>
      </h2>
      <p className="text-xs mt-0.5 mb-3" style={{ color: 'var(--text-tertiary)' }}>{subtitle}</p>
      {errored ? (
        <p className="text-sm rounded-[8px] px-4 py-6 text-center" style={{ color: 'var(--text-secondary)', background: 'var(--bg-inset)', border: '0.5px solid var(--red)' }}>
          We couldn&apos;t load your shipments — please refresh. Your orders are safe.
        </p>
      ) : shipments.length === 0 ? (
        <p className="text-sm rounded-[8px] px-4 py-6 text-center" style={{ color: 'var(--text-tertiary)', background: 'var(--bg-inset)', border: '0.5px solid var(--border)' }}>
          {emptyMsg}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {shipments.map((s) => <ShipmentCard key={s.transactionId} s={s} />)}
        </div>
      )}
    </section>
  );
}

function ShipmentCard({ s }: { s: Shipment }) {
  const isCourier = s.method === 'PUDO' || s.method === 'TCG';
  return (
    <div className="rounded-[10px] p-4" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}>
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {s.imageUrl ? (
          <img src={s.imageUrl} alt="" width={52} height={52} style={{ width: 52, height: 52, borderRadius: 8, objectFit: 'cover', flexShrink: 0, background: 'var(--bg-inset)' }} />
        ) : (
          <div style={{ width: 52, height: 52, borderRadius: 8, background: 'var(--bg-inset)', flexShrink: 0 }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{s.listingTitle}</span>
            <span className="text-[11px] px-2 py-0.5 rounded-[4px]" style={{ color: 'var(--text-secondary)', background: 'var(--bg-inset)', border: '0.5px solid var(--border)' }}>
              {METHOD_LABEL[s.method]}
            </span>
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
            {s.role === 'incoming' ? 'Seller' : 'Buyer'}: {s.counterparty}
            {s.trackingReference ? ` · Tracking ${s.trackingReference}` : ''}
          </p>
        </div>
        <Link href={`/transactions/${s.transactionId}`} className="text-xs px-3 py-1.5 rounded-[6px]" style={{ color: 'var(--text-secondary)', background: 'var(--bg-inset)', border: '0.5px solid var(--border)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
          View order
        </Link>
      </div>

      {/* Courier status timeline */}
      {isCourier && <CourierTimeline status={s.status} dispatchedAt={s.dispatchedAt} deliveredAt={s.deliveredAt} />}

      {/* Seller drop-off PIN reminder */}
      {isCourier && s.role === 'outgoing' && s.dropoffPin && (
        <div className="mt-3 rounded-[6px] px-3 py-2 text-xs" style={{ background: 'rgba(200,16,46,0.06)', border: '0.5px solid var(--red)', color: 'var(--text-secondary)' }}>
          Hand-over PIN <strong style={{ color: 'var(--text-primary)', letterSpacing: '0.1em' }}>{s.dropoffPin}</strong> — give this to the courier / locker when dropping off.
        </div>
      )}

      {/* Firearm: dealer-transfer details */}
      {s.method === 'DEALER_TRANSFER' && s.dealer && (
        <div className="mt-3 rounded-[6px] p-3 text-xs" style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)' }}>
          <p className="uppercase mb-1" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em', fontWeight: 600 }}>
            {s.dealer.confirmed ? 'Receiving dealer' : 'Planned dealer (to be confirmed)'}
          </p>
          {s.dealer.name ? (
            <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{s.dealer.name}</div>
              {s.dealer.address && <div>{s.dealer.address}</div>}
              {s.dealer.licenceNumber && <div>Licence: {s.dealer.licenceNumber}</div>}
              {s.dealer.phone && <div>📞 <a href={`tel:${s.dealer.phone}`} style={{ color: 'var(--red)' }}>{s.dealer.phone}</a></div>}
              {s.dealer.email && <div>✉ <a href={`mailto:${s.dealer.email}`} style={{ color: 'var(--red)' }}>{s.dealer.email}</a></div>}
              {!s.dealer.confirmed && (
                <div className="mt-1" style={{ color: 'var(--text-tertiary)' }}>
                  The final receiving dealer is confirmed when the seller stocks it in. You&apos;ll collect from a SAPS-licensed dealer with your licence.
                </div>
              )}
            </div>
          ) : (
            <p style={{ color: 'var(--text-tertiary)' }}>Dealer details will appear once the transfer is arranged.</p>
          )}
        </div>
      )}

      {/* Firearm: private-arrangement contact */}
      {s.method === 'PRIVATE_ARRANGE' && s.contact && (
        <div className="mt-3 rounded-[6px] p-3 text-xs" style={{ background: s.contact.revealed ? 'rgba(200,16,46,0.06)' : 'var(--bg-inset)', border: `0.5px solid ${s.contact.revealed ? 'var(--red)' : 'var(--border)'}` }}>
          <p className="uppercase mb-1" style={{ color: s.contact.revealed ? 'var(--red)' : 'var(--text-tertiary)', letterSpacing: '0.05em', fontWeight: 600 }}>
            {s.role === 'incoming' ? 'Seller contact' : 'Buyer contact'}
          </p>
          {s.contact.revealed ? (
            <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{s.contact.name}</div>
              {s.contact.phone && <div>📞 <a href={`tel:${s.contact.phone}`} style={{ color: 'var(--red)' }}>{s.contact.phone}</a></div>}
              {s.contact.email && <div>✉ <a href={`mailto:${s.contact.email}`} style={{ color: 'var(--red)' }}>{s.contact.email}</a></div>}
              <div className="mt-1" style={{ color: 'var(--text-tertiary)' }}>
                Coordinate a meet at a SAPS-licensed dealer to complete the transfer legally.
              </div>
            </div>
          ) : (
            <p style={{ color: 'var(--text-tertiary)' }}>{s.contact.reason}</p>
          )}
        </div>
      )}
    </div>
  );
}

function CourierTimeline({
  status,
  dispatchedAt,
  deliveredAt,
}: {
  status: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
}) {
  if (status === 'DELIVERY_FAILED' || status === 'RETURNED') {
    return (
      <div className="mt-3 rounded-[6px] px-3 py-2 text-xs" style={{ background: 'rgba(200,16,46,0.08)', border: '0.5px solid var(--red)', color: 'var(--red)' }}>
        {status === 'DELIVERY_FAILED' ? 'Delivery attempt failed — the courier will retry or hold the parcel.' : 'Parcel returned to sender.'}
      </div>
    );
  }
  const activeIdx = status ? COURIER_STEPS.indexOf(status as (typeof COURIER_STEPS)[number]) : -1;
  return (
    <div className="mt-3">
      <div className="flex items-center">
        {COURIER_STEPS.map((step, i) => {
          const done = i <= activeIdx;
          return (
            <div key={step} className="flex items-center" style={{ flex: i < COURIER_STEPS.length - 1 ? 1 : '0 0 auto' }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: done ? 'var(--red)' : 'var(--bg-inset)', border: `1.5px solid ${done ? 'var(--red)' : 'var(--border-hover)'}` }} />
              {i < COURIER_STEPS.length - 1 && (
                <div style={{ flex: 1, height: 2, background: i < activeIdx ? 'var(--red)' : 'var(--border)' }} />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1.5">
        {COURIER_STEPS.map((step, i) => (
          <span key={step} className="text-[10px]" style={{ color: i <= activeIdx ? 'var(--text-secondary)' : 'var(--text-tertiary)', flex: 1, textAlign: i === 0 ? 'left' : i === COURIER_STEPS.length - 1 ? 'right' : 'center' }}>
            {STEP_LABEL[step]}
          </span>
        ))}
      </div>
      {(dispatchedAt || deliveredAt) && (
        <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-tertiary)' }}>
          {deliveredAt ? `Delivered ${fmt(deliveredAt)}` : dispatchedAt ? `Dispatched ${fmt(dispatchedAt)}` : ''}
        </p>
      )}
      {activeIdx < 0 && (
        <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-tertiary)' }}>Awaiting collection by the courier.</p>
      )}
    </div>
  );
}
