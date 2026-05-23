import { cookies } from 'next/headers';
import Link from 'next/link';
import Image from 'next/image';
import { FeaturedTabs } from '../tabs';
import { ForceEvictButton } from './force-evict-button';
import { ManualAwardButton } from './manual-award-button';
import { ShiftUntilButton } from './shift-until-button';
import { CloseAuctionEarlyButton } from './close-auction-early-button';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

type SlotStatus = 'VACANT' | 'AUCTION_RUNNING' | 'BIND_WINDOW' | 'OCCUPIED';
type AuctionStatus = 'OPEN' | 'CLOSED_AWARDED' | 'CLOSED_NO_BIDS' | 'CANCELLED_BY_ADMIN';
type AuctionKind = 'SCHEDULED' | 'AD_HOC';

interface AdminSlot {
  id: string;
  slotNumber: number;
  status: SlotStatus;
  featuredUntil: string | null;
  currentListing: null | {
    id: string;
    title: string;
    seller: { username: string | null };
    images: { url: string }[];
    category: { name: string };
  };
  currentAuction: null | {
    id: string;
    kind: AuctionKind;
    status: AuctionStatus;
    openedAt: string;
    closesAt: string;
  };
}

interface AuditEvent {
  id: string;
  slotId: string;
  eventType: string;
  payloadJson: string | null;
  actorUserId: string | null;
  actorAdminId: string | null;
  createdAt: string;
}

export default async function AdminFeaturedSlotDetailPage({
  params,
}: {
  params: Promise<{ slotId: string }>;
}) {
  const { slotId } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get('gg_admin_sess')?.value ?? '';

  // Fetch all slots + filter to find ours — the backend's slots endpoint
  // returns the whole rail, and there's no per-slot GET. Cheaper than
  // another round-trip and keeps the page on one endpoint.
  const [slotsRes, auditRes] = await Promise.all([
    fetch(`${API_URL}/admin/featured/slots`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    }),
    fetch(`${API_URL}/admin/featured/audit?slotId=${slotId}&limit=200`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    }),
  ]);
  const slots: AdminSlot[] = slotsRes.ok ? await slotsRes.json() : [];
  const slot = slots.find((s) => s.id === slotId);
  const events: AuditEvent[] = auditRes.ok ? await auditRes.json() : [];

  if (!slot) {
    return (
      <div>
        <h1
          className="text-xl mb-4"
          style={{ color: 'var(--text-primary)', fontWeight: 500 }}
        >
          Featured Slots
        </h1>
        <FeaturedTabs current="slots" />
        <Link
          href="/admin/featured"
          className="text-sm inline-block mb-4"
          style={{ color: 'var(--text-tertiary)' }}
        >
          ← All slots
        </Link>
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Slot not found.
        </p>
      </div>
    );
  }

  // Bid placements get their own table — the audit log includes far more
  // event types than just BID_PLACED, so we split them visually.
  const bidEvents = events.filter((e) => e.eventType === 'BID_PLACED');

  return (
    <div>
      <h1
        className="text-xl mb-4"
        style={{ color: 'var(--text-primary)', fontWeight: 500 }}
      >
        Featured Slots
      </h1>
      <FeaturedTabs current="slots" />

      <Link
        href="/admin/featured"
        className="text-sm inline-block mb-4"
        style={{ color: 'var(--text-tertiary)' }}
      >
        ← All slots
      </Link>

      <div className="flex items-baseline justify-between mb-6 flex-wrap gap-3">
        <div>
          <h2
            className="text-2xl"
            style={{
              color: 'var(--text-primary)',
              fontWeight: 500,
              letterSpacing: '-0.01em',
            }}
          >
            Slot #{slot.slotNumber}
          </h2>
          <p
            className="text-xs mt-1"
            style={{
              color: 'var(--text-tertiary)',
              fontFamily: 'monospace',
            }}
          >
            {slot.id}
          </p>
        </div>
        <SlotStatusPill status={slot.status} kind={slot.currentAuction?.kind} />
      </div>

      {/* Admin actions */}
      <div
        className="rounded-[8px] p-4 mb-6"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        <p
          className="text-xs uppercase mb-3"
          style={{
            color: 'var(--text-tertiary)',
            letterSpacing: '0.05em',
            fontWeight: 500,
          }}
        >
          Admin actions
        </p>
        <div className="flex flex-wrap gap-2">
          {slot.status === 'OCCUPIED' && (
            <>
              <ForceEvictButton
                slotId={slot.id}
                slotNumber={slot.slotNumber}
                listingTitle={slot.currentListing?.title ?? ''}
              />
              <ShiftUntilButton
                slotId={slot.id}
                slotNumber={slot.slotNumber}
                featuredUntil={slot.featuredUntil}
              />
            </>
          )}
          {(slot.status === 'VACANT' || slot.status === 'AUCTION_RUNNING') && (
            <ManualAwardButton
              slotId={slot.id}
              slotNumber={slot.slotNumber}
            />
          )}
          {slot.status === 'AUCTION_RUNNING' && (
            <CloseAuctionEarlyButton
              slotId={slot.id}
              slotNumber={slot.slotNumber}
            />
          )}
        </div>
      </div>

      {/* Current occupant */}
      {slot.status === 'OCCUPIED' && slot.currentListing && (
        <Section title="Current occupant">
          <div className="flex gap-4">
            {slot.currentListing.images[0]?.url && (
              <div
                className="relative shrink-0 rounded-[6px] overflow-hidden"
                style={{
                  width: 96,
                  height: 96,
                  background: 'var(--bg-inset)',
                }}
              >
                <Image
                  src={slot.currentListing.images[0].url}
                  alt=""
                  fill
                  className="object-cover"
                  sizes="96px"
                />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <Link
                href={`/listings/${slot.currentListing.id}`}
                className="text-base hover:underline"
                style={{ color: 'var(--text-primary)', fontWeight: 500 }}
              >
                {slot.currentListing.title}
              </Link>
              <Row label="Listing ID" value={slot.currentListing.id} mono />
              <Row
                label="Seller"
                value={
                  slot.currentListing.seller.username
                    ? '@' + slot.currentListing.seller.username
                    : '—'
                }
              />
              <Row label="Category" value={slot.currentListing.category.name} />
              <Row
                label="Featured until"
                value={
                  slot.featuredUntil
                    ? new Date(slot.featuredUntil).toLocaleString('en-ZA')
                    : '—'
                }
              />
              <Row
                label="Time remaining"
                value={formatRemaining(slot.featuredUntil)}
              />
            </div>
          </div>
        </Section>
      )}

      {/* Current auction */}
      {slot.currentAuction && (
        <Section title="Current auction">
          <Row label="Auction ID" value={slot.currentAuction.id} mono />
          <Row label="Kind" value={slot.currentAuction.kind} />
          <Row label="Status" value={slot.currentAuction.status} />
          <Row
            label="Opened at"
            value={new Date(slot.currentAuction.openedAt).toLocaleString('en-ZA')}
          />
          <Row
            label="Closes at"
            value={new Date(slot.currentAuction.closesAt).toLocaleString('en-ZA')}
          />
          {slot.currentAuction.status === 'OPEN' && (
            <Row
              label="Time remaining"
              value={formatRemaining(slot.currentAuction.closesAt)}
            />
          )}
        </Section>
      )}

      {/* Bids (filtered audit BID_PLACED events) */}
      <Section title={`Bids on current/last auction (${bidEvents.length})`}>
        {bidEvents.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            No bid events recorded for this slot yet.
          </p>
        ) : (
          <div
            className="rounded-[6px] overflow-hidden"
            style={{ border: '0.5px solid var(--border)' }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-inset)' }}>
                  <Th>Time</Th>
                  <Th>Bidder</Th>
                  <Th>Payload</Th>
                </tr>
              </thead>
              <tbody>
                {bidEvents.map((e) => (
                  <tr
                    key={e.id}
                    style={{ borderTop: '0.5px solid var(--border)' }}
                  >
                    <Td>
                      <span style={{ color: 'var(--text-tertiary)' }}>
                        {new Date(e.createdAt).toLocaleString('en-ZA')}
                      </span>
                    </Td>
                    <Td>
                      <span
                        className="text-xs"
                        style={{
                          color: 'var(--text-secondary)',
                          fontFamily: 'monospace',
                        }}
                      >
                        {e.actorUserId
                          ? e.actorUserId.slice(0, 8) + '…'
                          : '—'}
                      </span>
                    </Td>
                    <Td>
                      <code
                        className="text-xs"
                        style={{
                          color: 'var(--text-tertiary)',
                          fontFamily: 'monospace',
                          wordBreak: 'break-all',
                        }}
                      >
                        {e.payloadJson ?? '—'}
                      </code>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Full audit log scoped to this slot */}
      <Section title={`Audit log (${events.length})`}>
        {events.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            No events recorded for this slot yet.
          </p>
        ) : (
          <div
            className="rounded-[6px] overflow-hidden"
            style={{ border: '0.5px solid var(--border)' }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-inset)' }}>
                  <Th>Time</Th>
                  <Th>Event</Th>
                  <Th>Payload</Th>
                  <Th>Actor</Th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr
                    key={e.id}
                    style={{ borderTop: '0.5px solid var(--border)' }}
                  >
                    <Td>
                      <span style={{ color: 'var(--text-tertiary)' }}>
                        {new Date(e.createdAt).toLocaleString('en-ZA')}
                      </span>
                    </Td>
                    <Td>
                      <span
                        style={{
                          color: 'var(--text-primary)',
                          fontWeight: 500,
                        }}
                      >
                        {e.eventType}
                      </span>
                    </Td>
                    <Td>
                      <code
                        className="text-xs"
                        style={{
                          color: 'var(--text-tertiary)',
                          fontFamily: 'monospace',
                          wordBreak: 'break-all',
                        }}
                      >
                        {e.payloadJson ?? '—'}
                      </code>
                    </Td>
                    <Td>
                      <span
                        className="text-xs"
                        style={{
                          color: 'var(--text-tertiary)',
                          fontFamily: 'monospace',
                        }}
                      >
                        {e.actorAdminId
                          ? 'admin: ' + e.actorAdminId.slice(0, 8) + '…'
                          : e.actorUserId
                            ? 'user: ' + e.actorUserId.slice(0, 8) + '…'
                            : 'system'}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

function SlotStatusPill({
  status,
  kind,
}: {
  status: SlotStatus;
  kind?: AuctionKind;
}) {
  const { bg, fg, label } = (() => {
    switch (status) {
      case 'OCCUPIED':
        return { bg: 'rgba(47,158,107,0.12)', fg: '#2f9e6b', label: 'Featured' };
      case 'AUCTION_RUNNING':
        return {
          bg: 'rgba(245,158,11,0.12)',
          fg: '#f59e0b',
          label: kind === 'AD_HOC' ? 'Just opened' : 'Pre-auction',
        };
      case 'BIND_WINDOW':
        return { bg: 'rgba(245,158,11,0.12)', fg: '#f59e0b', label: 'Bind window' };
      default:
        return { bg: 'var(--bg-inset)', fg: 'var(--text-tertiary)', label: 'Vacant' };
    }
  })();
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full"
      style={{
        background: bg,
        color: fg,
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-[8px] p-4 mb-6"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
      }}
    >
      <p
        className="text-xs uppercase mb-3"
        style={{
          color: 'var(--text-tertiary)',
          letterSpacing: '0.05em',
          fontWeight: 500,
        }}
      >
        {title}
      </p>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between text-xs py-1 gap-4">
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span
        style={{
          color: 'var(--text-primary)',
          fontFamily: mono ? 'monospace' : undefined,
          textAlign: 'right',
          wordBreak: 'break-all',
        }}
      >
        {value}
      </span>
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
      className="px-3 py-2.5 align-top"
      style={{ color: 'var(--text-secondary)' }}
    >
      {children}
    </td>
  );
}

function formatRemaining(target: string | null): string {
  if (!target) return '—';
  const ms = new Date(target).getTime() - Date.now();
  if (ms <= 0) return 'now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
