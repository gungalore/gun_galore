import { cookies } from 'next/headers';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface Rejection {
  id: string;
  channel: string;
  category: string;
  sampleText: string;
  createdAt: string;
  user: { id: string; username: string | null; email: string } | null;
}

interface RepeatOffender {
  userId: string;
  username: string | null;
  email: string;
  rejectionCount: number;
  lastRejectionAt: string;
}

interface ReportedQuestion {
  id: string;
  question: string;
  reportedCount: number;
  status: string;
  createdAt: string;
  listing: { id: string; title: string };
  asker: { username: string | null };
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const CATEGORY_COLOR: Record<string, string> = {
  phone: 'var(--red)',
  email: '#f59e0b',
  url: '#3b82f6',
  'social-platform': '#a855f7',
  'off-platform-coordination': 'var(--red)',
  address: '#f59e0b',
};

async function fetchJson<T>(path: string, token: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default async function TrustSafetyPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value ?? '';
  const [rejections, repeats, reports] = await Promise.all([
    fetchJson<Rejection[]>('/admin/trust-safety/rejections', token),
    fetchJson<RepeatOffender[]>('/admin/trust-safety/repeat-offenders', token),
    fetchJson<ReportedQuestion[]>('/admin/trust-safety/reported-questions', token),
  ]);

  return (
    <div>
      <div className="flex items-baseline justify-between flex-wrap gap-3 mb-5">
        <h1 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
          Trust &amp; Safety
        </h1>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Last 7 days · contact-detail blocks + reported content
        </p>
      </div>

      {/* ─── Repeat offenders — ban candidates ─────────────────── */}
      <Section
        title={`Repeat offenders (${repeats?.length ?? 0})`}
        subtitle="Users with 3+ contact-detail rejections in the last 7 days. Strong ban signal."
      >
        {!repeats || repeats.length === 0 ? (
          <Empty message="No repeat offenders in the last 7 days." />
        ) : (
          <div
            className="rounded-[8px] overflow-hidden"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--red)' }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                  <Th>User</Th>
                  <Th align="right">Rejections (7d)</Th>
                  <Th>Last hit</Th>
                  <Th align="right" />
                </tr>
              </thead>
              <tbody>
                {repeats.map((r, i) => (
                  <tr
                    key={r.userId}
                    style={
                      i < repeats.length - 1
                        ? { borderBottom: '0.5px solid var(--border)' }
                        : undefined
                    }
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/users/${r.userId}`}
                        style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
                      >
                        @{r.username ?? '(no username)'}
                      </Link>
                      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        {r.email}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{ background: 'var(--red)18', color: 'var(--red)', fontWeight: 500 }}
                      >
                        {r.rejectionCount}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {formatDateTime(r.lastRejectionAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/users/${r.userId}`}
                        className="text-xs"
                        style={{ color: 'var(--red)', textDecoration: 'underline' }}
                      >
                        Review →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ─── Reported Q&A ─────────────────────────────────────── */}
      <Section
        title={`Reported Q&A (${reports?.length ?? 0})`}
        subtitle="Questions / answers flagged by a buyer or seller."
      >
        {!reports || reports.length === 0 ? (
          <Empty message="No reported Q&A right now." />
        ) : (
          <div
            className="rounded-[8px] overflow-hidden"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                  <Th>Question</Th>
                  <Th>Listing</Th>
                  <Th>Asker</Th>
                  <Th align="right">Reports</Th>
                </tr>
              </thead>
              <tbody>
                {reports.map((q, i) => (
                  <tr
                    key={q.id}
                    style={
                      i < reports.length - 1
                        ? { borderBottom: '0.5px solid var(--border)' }
                        : undefined
                    }
                  >
                    <td className="px-4 py-3" style={{ maxWidth: 380 }}>
                      <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                        {q.question}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        {q.status.replace(/_/g, ' ')} · {formatDate(q.createdAt)}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <Link
                        href={`/admin/listings/${q.listing.id}`}
                        style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
                      >
                        {q.listing.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      @{q.asker.username ?? 'anon'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{ background: 'var(--red)18', color: 'var(--red)' }}
                      >
                        {q.reportedCount}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ─── Recent rejections — raw feed ─────────────────────── */}
      <Section
        title={`Contact-detail rejections (${rejections?.length ?? 0})`}
        subtitle="Every block from the contact-detail filter in the last 7 days, newest first."
      >
        {!rejections || rejections.length === 0 ? (
          <Empty message="No contact-detail rejections in the last 7 days — the filter has been quiet." />
        ) : (
          <div
            className="rounded-[8px] overflow-hidden"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                  <Th>When</Th>
                  <Th>User</Th>
                  <Th>Channel</Th>
                  <Th>Category</Th>
                  <Th>Sample (capped 200 chars)</Th>
                </tr>
              </thead>
              <tbody>
                {rejections.map((r, i) => (
                  <tr
                    key={r.id}
                    style={
                      i < rejections.length - 1
                        ? { borderBottom: '0.5px solid var(--border)' }
                        : undefined
                    }
                  >
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {formatDateTime(r.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {r.user ? (
                        <Link
                          href={`/admin/users/${r.user.id}`}
                          style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
                        >
                          @{r.user.username ?? 'anon'}
                        </Link>
                      ) : (
                        <span style={{ color: 'var(--text-tertiary)' }}>
                          (anonymous)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {r.channel}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{
                          background: `${CATEGORY_COLOR[r.category] ?? 'var(--text-tertiary)'}18`,
                          color: CATEGORY_COLOR[r.category] ?? 'var(--text-tertiary)',
                        }}
                      >
                        {r.category.replace(/-/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)', maxWidth: 420 }}>
                      <code
                        style={{
                          fontFamily: 'monospace',
                          fontSize: 11,
                          wordBreak: 'break-word',
                          display: 'block',
                        }}
                      >
                        {r.sampleText}
                      </code>
                    </td>
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

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="mb-2">
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {title}
        </p>
        {subtitle && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

function Th({
  children,
  align = 'left',
}: {
  children?: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <th
      className="text-xs uppercase px-4 py-2"
      style={{
        color: 'var(--text-tertiary)',
        fontWeight: 500,
        textAlign: align,
      }}
    >
      {children}
    </th>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div
      className="rounded-[8px] p-6 text-center"
      style={{ background: 'var(--bg-card)', border: '0.5px dashed var(--border)' }}
    >
      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        {message}
      </p>
    </div>
  );
}
