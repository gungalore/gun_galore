import Link from 'next/link';
import { redirect } from 'next/navigation';
import { serverAuth as auth } from '../../../lib/auth-server';
import {
  complaintCategoryLabel,
  complaintHistoryLine,
  complaintStatusTone,
} from '@/lib/complaint-status';

const API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001/api';

/**
 * A member's own complaint cases.
 *
 * ⚠️ THE DESTINATION DID NOT EXIST. Complaint-status notifications and the
 * account menu both pointed at `/complaints` — the public PROCEDURE page, which
 * lists no cases at all — so a member told "your case moved" had nowhere to see
 * the case. `/complaints/new` could lodge one, and then it vanished from their
 * view until an admin answered.
 *
 * Data comes from GET /complaints/mine (ComplaintsController.mine →
 * ComplaintsService.listMine): newest first, already scoped to the signed-in
 * user, with evidence photos and a thin linked-order summary. It deliberately
 * does NOT include the assigned admin or internal notes.
 *
 * Member-only: `/account` is classified member-only in lib/route-gate.ts, so
 * this route inherits the session wall (the middleware bounces a signed-out
 * visitor to sign-in with a return path). The page still checks for the session
 * itself because it renders from an API call that needs a Bearer token.
 */
export const metadata = {
  title: 'My complaints — ALL Outdoor',
  description:
    'The complaints and dispute cases you have lodged, their status and outcome, and the reference number for each.',
};

interface MyComplaint {
  id: string;
  referenceNumber: string;
  category: string;
  subject: string;
  status: string;
  outcome?: string | null;
  drovePayoutHold?: boolean;
  createdAt: string;
  resolvedAt?: string | null;
  photos?: { id: string; url: string; mediaType?: string }[];
  transaction?: {
    id: string;
    listing?: { title: string; referenceNumber?: string | null } | null;
  } | null;
}

/** "12 Nov 2026" in SA time — the server's locale, not the device's. */
function formatDay(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default async function MyComplaintsPage() {
  const { userId, getToken } = await auth();
  if (!userId) redirect('/sign-in?redirect_url=/account/complaints');

  const token = await getToken();
  const res = await fetch(`${API_URL}/complaints/mine`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  // A failed read must NOT render as "you have no complaints" — that is a
  // false statement on a surface a payout hold depends on. Say it failed.
  const failed = !res.ok;
  const complaints: MyComplaint[] = failed ? [] : await res.json();

  return (
    <main className="max-w-[760px] mx-auto px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
        <h1
          className="text-xl font-medium"
          style={{ color: 'var(--text-primary)' }}
        >
          My complaints
        </h1>
        <Link
          href="/complaints/new"
          className="py-2 px-4 rounded-[6px] text-sm"
          style={{
            background: 'var(--action-primary-bg)',
            color: '#fff',
            fontWeight: 500,
            textDecoration: 'none',
          }}
        >
          Lodge a complaint
        </Link>
      </div>
      <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)', lineHeight: 1.55 }}>
        Every complaint gets a case reference (CO…). We aim to acknowledge
        within 2 business days and resolve within 14 —{' '}
        <Link href="/complaints" style={{ color: 'var(--red)' }}>
          how we handle complaints
        </Link>
        .
      </p>

      {failed ? (
        <div
          className="rounded-[8px] p-5 text-sm"
          style={{ background: 'var(--red-wash)', border: '0.5px solid var(--red)' }}
        >
          <p style={{ color: 'var(--red)', fontWeight: 600, marginBottom: 4 }}>
            Could not load your complaints
          </p>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            This is usually temporary. Reload the page; if it keeps failing,
            email support with the date and time you tried.
          </p>
        </div>
      ) : complaints.length === 0 ? (
        <div
          className="rounded-[8px] py-12 px-6 text-center"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px dashed var(--border)',
          }}
        >
          <p
            className="text-base mb-2"
            style={{ color: 'var(--text-primary)', fontWeight: 500 }}
          >
            No complaints lodged
          </p>
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            If something goes wrong with an order, use the complaint form —
            you&apos;ll get a case reference you can track here.
          </p>
        </div>
      ) : (
        <ul className="space-y-3 list-none p-0 m-0">
          {complaints.map((complaint) => (
            <ComplaintCard key={complaint.id} complaint={complaint} />
          ))}
        </ul>
      )}
    </main>
  );
}

function ComplaintCard({ complaint }: { complaint: MyComplaint }) {
  const tone = complaintStatusTone(complaint.status);
  const photoCount = complaint.photos?.length ?? 0;
  const order = complaint.transaction?.listing;

  return (
    <li
      className="rounded-[8px] p-4"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className="text-sm font-medium leading-snug"
            style={{ color: 'var(--text-primary)' }}
          >
            {complaint.subject}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
            {complaint.referenceNumber} · {complaintCategoryLabel(complaint.category)}
          </p>
        </div>
        <span
          className="text-[10px] uppercase px-2 py-0.5 rounded-full whitespace-nowrap"
          style={{
            background: tone.background,
            color: tone.color,
            border: `0.5px solid ${tone.color}`,
            fontWeight: 600,
            letterSpacing: '0.06em',
          }}
        >
          {tone.label}
        </span>
      </div>

      <p className="text-xs mt-3" style={{ color: 'var(--text-secondary)' }}>
        {complaintHistoryLine(
          { createdAt: complaint.createdAt, resolvedAt: complaint.resolvedAt },
          formatDay,
        )}
      </p>

      {order ? (
        <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
          Order:{' '}
          <Link
            href={`/transactions/${complaint.transaction?.id}`}
            style={{ color: 'var(--red)' }}
          >
            {order.title}
            {order.referenceNumber ? ` (${order.referenceNumber})` : ''}
          </Link>
        </p>
      ) : null}

      {complaint.drovePayoutHold ? (
        <p className="text-xs mt-1" style={{ color: 'var(--warning)' }}>
          The seller&apos;s payout for this order is held while the case is open.
        </p>
      ) : null}

      {complaint.outcome ? (
        <div
          className="mt-3 pt-3 text-sm"
          style={{ borderTop: '0.5px solid var(--border)' }}
        >
          <p
            className="text-xs uppercase mb-1"
            style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}
          >
            Outcome
          </p>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            {complaint.outcome}
          </p>
        </div>
      ) : null}

      {photoCount > 0 ? (
        <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
          {photoCount} piece{photoCount === 1 ? '' : 's'} of evidence attached
        </p>
      ) : null}
    </li>
  );
}
