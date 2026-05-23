import { cookies } from 'next/headers';
import Link from 'next/link';
import { FeaturedTabs } from '../tabs';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface AuditEvent {
  id: string;
  slotId: string;
  eventType: string;
  payloadJson: string | null;
  actorUserId: string | null;
  actorAdminId: string | null;
  createdAt: string;
}

// The known event types we surface as filter chips. Other types still
// render fine in the table — they just don't get their own chip.
const EVENT_TYPES = [
  'AUCTION_OPENED',
  'BID_PLACED',
  'AUCTION_CLOSED',
  'LISTING_BOUND',
  'FEATURED_LIVE',
  'FORCE_EVICTED',
  'MANUALLY_AWARDED',
  'REFUND_ISSUED',
  'CONFIG_CHANGED',
  'BIDDER_BANNED',
];

export default async function AdminFeaturedAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ slotId?: string; eventType?: string }>;
}) {
  const { slotId, eventType } = await searchParams;
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value ?? '';

  const qs = new URLSearchParams();
  if (slotId) qs.set('slotId', slotId);
  if (eventType) qs.set('eventType', eventType);
  qs.set('limit', '200');

  const res = await fetch(
    `${API_URL}/admin/featured/audit?${qs.toString()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    },
  );
  const events: AuditEvent[] = res.ok ? await res.json() : [];

  return (
    <div>
      <h1
        className="text-xl mb-4"
        style={{ color: 'var(--text-primary)', fontWeight: 500 }}
      >
        Featured Slots
      </h1>
      <FeaturedTabs current="audit" />

      <div className="mb-4">
        <p
          className="text-xs uppercase mb-2"
          style={{
            color: 'var(--text-tertiary)',
            letterSpacing: '0.05em',
            fontWeight: 500,
          }}
        >
          Filter by event type
        </p>
        <div className="flex flex-wrap gap-2">
          <FilterChip
            label="All"
            href={buildHref({ slotId })}
            active={!eventType}
          />
          {EVENT_TYPES.map((t) => (
            <FilterChip
              key={t}
              label={t}
              href={buildHref({ slotId, eventType: t })}
              active={eventType === t}
            />
          ))}
        </div>
      </div>

      {slotId && (
        <p
          className="text-xs mb-3"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Scoped to slot{' '}
          <span
            style={{
              color: 'var(--text-secondary)',
              fontFamily: 'monospace',
            }}
          >
            {slotId}
          </span>
          {' · '}
          <Link
            href={
              eventType
                ? `/admin/featured/audit?eventType=${encodeURIComponent(eventType)}`
                : '/admin/featured/audit'
            }
            style={{ color: 'var(--red)' }}
          >
            clear slot filter
          </Link>
        </p>
      )}

      <div
        className="rounded-[8px] overflow-hidden"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        {events.length === 0 ? (
          <p
            className="p-4 text-sm"
            style={{ color: 'var(--text-tertiary)' }}
          >
            No events match the current filter.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--bg-inset)' }}>
                <Th>Time</Th>
                <Th>Event</Th>
                <Th>Slot</Th>
                <Th>Actor</Th>
                <Th>Payload</Th>
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
                    {e.slotId ? (
                      <Link
                        href={`/admin/featured/audit?slotId=${e.slotId}${
                          eventType
                            ? `&eventType=${encodeURIComponent(eventType)}`
                            : ''
                        }`}
                        className="text-xs hover:underline"
                        style={{
                          color: 'var(--text-secondary)',
                          fontFamily: 'monospace',
                        }}
                      >
                        {e.slotId.slice(0, 8)}…
                      </Link>
                    ) : (
                      <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                    )}
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
                  <Td>
                    {e.payloadJson ? (
                      <code
                        className="text-xs"
                        style={{
                          color: 'var(--text-tertiary)',
                          fontFamily: 'monospace',
                          wordBreak: 'break-all',
                          display: 'block',
                          maxWidth: 400,
                        }}
                      >
                        {e.payloadJson.length > 200
                          ? e.payloadJson.slice(0, 200) + '…'
                          : e.payloadJson}
                      </code>
                    ) : (
                      <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function buildHref(params: { slotId?: string; eventType?: string }): string {
  const qs = new URLSearchParams();
  if (params.slotId) qs.set('slotId', params.slotId);
  if (params.eventType) qs.set('eventType', params.eventType);
  const s = qs.toString();
  return s ? `/admin/featured/audit?${s}` : '/admin/featured/audit';
}

function FilterChip({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className="text-xs px-2.5 py-1 rounded-full"
      style={{
        background: active ? 'var(--red)' : 'var(--bg-inset)',
        color: active ? '#fff' : 'var(--text-secondary)',
        border: active ? 'none' : '0.5px solid var(--border)',
        textDecoration: 'none',
        fontWeight: active ? 500 : 400,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </Link>
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
