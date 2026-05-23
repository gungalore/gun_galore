import { cookies } from 'next/headers';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Read-only chronological view of every destructive admin action
// recorded by AdminAuditService. Rows can be filtered by adminUserId
// or resourceType via query params; backend pagination via offset.

interface AuditRow {
  id: string;
  adminUserId: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  oldValue: string | null;
  newValue: string | null;
  reason: string;
  createdAt: string;
  adminUser: {
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
}

interface AuditResponse {
  rows: AuditRow[];
  total: number;
  limit: number;
  offset: number;
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string; resourceType?: string }>;
}) {
  const params = await searchParams;
  const offset = params.offset ?? '0';
  const cookieStore = await cookies();
  const token = cookieStore.get('gg_admin_sess')?.value ?? '';

  const qs = new URLSearchParams();
  qs.set('offset', offset);
  qs.set('limit', '50');
  if (params.resourceType) qs.set('resourceType', params.resourceType);

  const res = await fetch(`${API_URL}/admin/audit?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const data: AuditResponse = res.ok
    ? await res.json()
    : { rows: [], total: 0, limit: 50, offset: 0 };

  const currentOffset = parseInt(offset, 10) || 0;
  const hasPrev = currentOffset > 0;
  const hasNext = currentOffset + data.rows.length < data.total;

  return (
    <main className="max-w-[1280px] mx-auto px-6 py-6">
      <h1
        className="text-xl mb-1"
        style={{ color: 'var(--text-primary)', fontWeight: 500 }}
      >
        Admin audit log
      </h1>
      <p
        className="text-sm mb-6"
        style={{ color: 'var(--text-tertiary)' }}
      >
        Every destructive admin action with the reason and the admin
        who made it. Newest first.
      </p>

      {/* Resource type filter pills */}
      <div className="flex gap-1.5 mb-4 flex-wrap">
        <FilterPill
          label="All"
          href="/admin/audit"
          active={!params.resourceType}
        />
        {['User', 'Transaction', 'Listing', 'Raffle', 'FeaturedSlot'].map(
          (rt) => (
            <FilterPill
              key={rt}
              label={rt}
              href={`/admin/audit?resourceType=${rt}`}
              active={params.resourceType === rt}
            />
          ),
        )}
      </div>

      {data.rows.length === 0 ? (
        <div
          className="rounded-[8px] py-12 px-6 text-center"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px dashed var(--border)',
          }}
        >
          <p
            className="text-sm"
            style={{ color: 'var(--text-tertiary)' }}
          >
            No audit events recorded yet
            {params.resourceType ? ` for ${params.resourceType}` : ''}.
          </p>
        </div>
      ) : (
        <div
          className="rounded-[8px] overflow-hidden"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
          }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr
                style={{
                  background: 'var(--bg-inset)',
                  color: 'var(--text-tertiary)',
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                <th className="text-left px-4 py-2 font-medium">When</th>
                <th className="text-left px-4 py-2 font-medium">Admin</th>
                <th className="text-left px-4 py-2 font-medium">Action</th>
                <th className="text-left px-4 py-2 font-medium">Resource</th>
                <th className="text-left px-4 py-2 font-medium">Change</th>
                <th className="text-left px-4 py-2 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr
                  key={r.id}
                  style={{
                    borderTop: '0.5px solid var(--border)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <td
                    className="px-4 py-2 text-xs"
                    style={{ color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}
                  >
                    {new Date(r.createdAt).toLocaleString('en-ZA', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {r.adminUser.email}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className="text-[10px] uppercase px-2 py-0.5 rounded"
                      style={{
                        background: actionTone(r.action).bg,
                        color: actionTone(r.action).fg,
                        border: `0.5px solid ${actionTone(r.action).border}`,
                        letterSpacing: '0.04em',
                        fontWeight: 600,
                      }}
                    >
                      {r.action}
                    </span>
                  </td>
                  <td
                    className="px-4 py-2 text-xs"
                    style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}
                  >
                    {r.resourceType ? (
                      <>
                        {r.resourceType}
                        {r.resourceId && (
                          <span style={{ color: 'var(--text-tertiary)' }}>
                            {' '}· {r.resourceId.slice(-8)}
                          </span>
                        )}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {r.oldValue || r.newValue ? (
                      <>
                        <span style={{ color: 'var(--text-tertiary)' }}>
                          {(r.oldValue ?? '—').replace(/^"|"$/g, '')}
                        </span>
                        <span style={{ color: 'var(--text-tertiary)' }}> → </span>
                        <span style={{ color: 'var(--text-primary)' }}>
                          {(r.newValue ?? '—').replace(/^"|"$/g, '')}
                        </span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td
                    className="px-4 py-2 text-xs"
                    style={{ color: 'var(--text-secondary)', maxWidth: 280 }}
                  >
                    {r.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {(hasPrev || hasNext) && (
        <div className="flex justify-between items-center mt-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
          <span>
            {data.total.toLocaleString()} events · showing{' '}
            {currentOffset + 1}–{currentOffset + data.rows.length}
          </span>
          <div className="flex gap-2">
            {hasPrev && (
              <a
                href={`/admin/audit?${params.resourceType ? `resourceType=${params.resourceType}&` : ''}offset=${Math.max(0, currentOffset - data.limit)}`}
                className="px-3 py-1 rounded text-xs"
                style={{
                  border: '0.5px solid var(--border)',
                  color: 'var(--text-secondary)',
                }}
              >
                ← Newer
              </a>
            )}
            {hasNext && (
              <a
                href={`/admin/audit?${params.resourceType ? `resourceType=${params.resourceType}&` : ''}offset=${currentOffset + data.limit}`}
                className="px-3 py-1 rounded text-xs"
                style={{
                  border: '0.5px solid var(--border)',
                  color: 'var(--text-secondary)',
                }}
              >
                Older →
              </a>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function FilterPill({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <a
      href={href}
      className="px-3 py-1 rounded text-xs"
      style={{
        background: active ? 'var(--red)' : 'var(--bg-card)',
        color: active ? '#fff' : 'var(--text-secondary)',
        border: `0.5px solid ${active ? 'var(--red)' : 'var(--border)'}`,
        fontWeight: 500,
        textDecoration: 'none',
      }}
    >
      {label}
    </a>
  );
}

// Colour-code action verbs by destructiveness — red for bans /
// refunds, amber for KYC overrides, blue for tier changes, grey for
// reversible / mild.
function actionTone(action: string): { bg: string; fg: string; border: string } {
  if (/BAN|REFUND|REJECT|DELETE|FORCE/.test(action)) {
    return {
      bg: 'rgba(200,16,46,0.12)',
      fg: 'var(--red)',
      border: 'rgba(200,16,46,0.45)',
    };
  }
  if (/KYC|OVERRIDE/.test(action)) {
    return {
      bg: 'rgba(245,158,11,0.12)',
      fg: '#f59e0b',
      border: 'rgba(245,158,11,0.45)',
    };
  }
  if (/TIER|UNBAN|APPROVE/.test(action)) {
    return {
      bg: 'rgba(110,168,254,0.14)',
      fg: '#6ea8fe',
      border: 'rgba(110,168,254,0.40)',
    };
  }
  return {
    bg: 'var(--bg-inset)',
    fg: 'var(--text-secondary)',
    border: 'var(--border)',
  };
}
