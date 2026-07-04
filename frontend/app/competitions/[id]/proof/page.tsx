import { notFound } from 'next/navigation';
import Link from 'next/link';
import { DrawProof } from '@/lib/types';

// Server-side base URL — INTERNAL_API_URL when SSR runs inside the cluster,
// falling back to the public URL. Mirrors the other competition pages.
const API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001/api';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await fetch(`${API_URL}/raffles/${id}/proof`, {
    cache: 'no-store',
  }).catch(() => null);
  if (!res?.ok) return { title: 'Draw proof — Gun Galore Competitions' };
  const p: DrawProof = await res.json();
  return {
    title: `Draw proof — ${p.title} — Gun Galore Competitions`,
    description: `Verifiable draw proof for ${p.title}: seed, SHA-256 hash and winning ticket.`,
  };
}

export default async function ProofPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await fetch(`${API_URL}/raffles/${id}/proof`, {
    cache: 'no-store',
  }).catch(() => null);
  if (!res?.ok) return notFound();
  const p: DrawProof = await res.json();

  const totalEntries = p.ticketsSoldPaid + p.ticketsSoldPostal;

  return (
    <main className="max-w-[720px] mx-auto px-4 py-8">
      <Link
        href={`/competitions/${p.id}`}
        className="text-sm inline-block mb-6"
        style={{ color: 'var(--text-tertiary)' }}
      >
        ← Back to competition
      </Link>

      <div className="flex flex-wrap gap-1.5 mb-3">
        <span
          className="text-xs px-2 py-0.5 rounded-[3px]"
          style={{ background: 'var(--red)', color: '#fff', fontWeight: 500 }}
        >
          Draw proof
        </span>
      </div>

      <h1
        className="text-xl mb-1 leading-snug"
        style={{ color: 'var(--text-primary)', fontWeight: 500 }}
      >
        {p.title}
      </h1>
      {p.referenceNumber && (
        <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
          Reference:{' '}
          <span
            style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}
          >
            {p.referenceNumber}
          </span>
        </p>
      )}

      {!p.drawnAt ? (
        <div
          className="rounded-[6px] px-4 py-8 text-center text-sm"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-tertiary)',
          }}
        >
          This competition has not been drawn yet — the seed will be published
          here after the draw.
        </div>
      ) : (
        <>
          {/* Proof card — same Row idiom as the admin audit page. */}
          <div
            className="rounded-[6px] p-4 mb-6"
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
              }}
            >
              Verifiable draw proof
            </p>
            <Row
              label="Drawn at"
              value={new Date(p.drawnAt).toLocaleString('en-ZA')}
            />
            <Row label="Seed (hex)" value={p.drawSeed ?? '—'} mono />
            <Row label="SHA-256 of seed" value={p.drawSeedHash ?? '—'} mono />
            <Row
              label="Winning ticket"
              value={p.winningTicketId ?? '—'}
              mono
            />
            <Row
              label="Total entries"
              value={`${totalEntries} (paid: ${p.ticketsSoldPaid}, postal: ${p.ticketsSoldPostal})`}
            />
          </div>

          {/* How to verify — plain-language explainer of the commit/reveal
              scheme the backend uses (matches RafflesService.runDraw). */}
          <div
            className="rounded-[6px] p-4 text-sm"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
            }}
          >
            <p
              className="text-xs uppercase mb-2"
              style={{
                color: 'var(--text-tertiary)',
                letterSpacing: '0.05em',
              }}
            >
              How to verify this draw
            </p>
            <ol
              className="list-decimal pl-5 space-y-2 leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              <li>
                Hash the published seed with SHA-256. The result must equal the{' '}
                <span style={{ color: 'var(--text-primary)' }}>
                  SHA-256 of seed
                </span>{' '}
                shown above — proving the seed was fixed before the draw and
                not chosen to pick a favourite.
              </li>
              <li>
                For each winner position <code>i</code> (0 for the winner, then
                the backups), compute{' '}
                <code
                  style={{
                    fontFamily: 'monospace',
                    color: 'var(--text-primary)',
                  }}
                >
                  sha256(seed || &quot;:&quot; || i)
                </code>{' '}
                and take the first 48 bits as a number, modulo the total number
                of entries ({totalEntries}). That index (in ticket-number order)
                selects the winning ticket.
              </li>
              <li>
                Because the seed can only be revealed after the draw and any
                change to it changes the hash, no one — including Gun Galore —
                can steer the outcome after entries close.
              </li>
            </ol>
          </div>
        </>
      )}
    </main>
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
