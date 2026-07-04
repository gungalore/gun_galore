import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Raffle } from '@/lib/types';
import { formatPrice } from '@/lib/utils';
import EnterPanel from './enter-panel';
import FreeEntryButton from './free-entry-button';
// Reuse the listing detail gallery — it already does hero swap on
// thumbnail click, fullscreen lightbox, ← → keyboard nav, ESC to
// close, and 2× zoom toggle. No reason to reinvent it for raffles.
import { ImageGallery } from '@/app/listings/[id]/image-gallery';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await fetch(`${API_URL}/raffles/${id}`, { cache: 'no-store' }).catch(() => null);
  if (!res?.ok) return { title: 'Competition not found — Gun Galore' };
  const r: Raffle = await res.json();
  return {
    title: `${r.title} — Gun Galore Competitions`,
    description: r.description.slice(0, 160),
  };
}

export default async function CompetitionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await fetch(`${API_URL}/raffles/${id}`, { cache: 'no-store' }).catch(() => null);
  if (!res?.ok) return notFound();
  const r: Raffle = await res.json();

  const ticketsSold = r.ticketsSoldPaid + r.ticketsSoldPostal;
  const ticketsRemaining = Math.max(0, r.targetTicketCount - ticketsSold);
  const progress = Math.min(100, Math.round((ticketsSold / r.targetTicketCount) * 100));

  // Sort uploaded images by their stored `order` field (admins drag
  // to reorder when creating the raffle). If the raffle pre-dates the
  // images table and only has the legacy single `imageUrl`, synthesise
  // a one-item array so the gallery still works.
  const galleryImages = (() => {
    if (r.images && r.images.length > 0) {
      return [...r.images]
        .sort((a, b) => a.order - b.order)
        .map((img) => ({ id: img.id, url: img.url }));
    }
    if (r.imageUrl) {
      return [{ id: 'legacy', url: r.imageUrl }];
    }
    return [];
  })();

  return (
    <main className="max-w-[1280px] mx-auto px-4 py-6">
      <Link
        href="/competitions"
        className="text-sm inline-block mb-6"
        style={{ color: 'var(--text-tertiary)' }}
      >
        ← All competitions
      </Link>

      {/* Mirror the listing detail layout: gallery alone in the left
          column, ALL textual content (badge, title, stats, CTA,
          description) in the right column. Grid widths match so the
          image area on a competition reads identical in proportion to
          an auction listing. */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8">
        {/* LEFT: gallery only */}
        <div>
          {galleryImages.length > 0 ? (
            <ImageGallery images={galleryImages} title={r.title} />
          ) : (
            <div
              className="relative rounded-[6px] overflow-hidden flex items-center justify-center text-sm"
              style={{
                paddingBottom: '75%',
                background: 'var(--bg-inset)',
                color: 'var(--text-tertiary)',
              }}
            >
              <span className="absolute inset-0 flex items-center justify-center">
                No image
              </span>
            </div>
          )}
        </div>

        {/* RIGHT: badge, title, stats, enter panel, description —
            same vertical stack pattern as a listing detail's right
            column. */}
        <div>
          {/* Type badge — same chip pattern as listing detail's
              category / condition / type strip. */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            <span
              className="text-xs px-2 py-0.5 rounded-[3px]"
              style={{
                background: 'var(--red)',
                color: '#fff',
                fontWeight: 500,
              }}
            >
              Competition
            </span>
          </div>

          <h1
            className="text-xl mb-3 leading-snug"
            style={{ color: 'var(--text-primary)', fontWeight: 500 }}
          >
            {r.title}
          </h1>

          {/* Stats card */}
          <div
            className="rounded-[6px] p-4 mb-4"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
            }}
          >
            <div className="flex items-baseline justify-between mb-2">
              <span
                className="text-xs uppercase"
                style={{
                  color: 'var(--text-tertiary)',
                  letterSpacing: '0.05em',
                }}
              >
                Ticket price
              </span>
              <span
                className="text-xs"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Prize value {formatPrice(r.itemValueCents)}
              </span>
            </div>
            <div
              className="text-2xl mb-3"
              style={{ color: 'var(--red)', fontWeight: 500 }}
            >
              {formatPrice(r.ticketPriceCents)}
            </div>

            {/* Sold progress */}
            <div className="mb-2">
              <div className="flex justify-between text-xs mb-1">
                <span style={{ color: 'var(--text-tertiary)' }}>
                  {ticketsSold} / {r.targetTicketCount} sold
                </span>
                <span style={{ color: 'var(--text-tertiary)' }}>
                  {progress}%
                </span>
              </div>
              <div
                className="h-1.5 rounded-full overflow-hidden"
                style={{ background: 'var(--bg-inset)' }}
              >
                <div
                  className="h-full"
                  style={{ background: 'var(--red)', width: `${progress}%` }}
                />
              </div>
            </div>

            {r.referenceNumber && (
              <p
                className="text-xs mt-2"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Reference: <span style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{r.referenceNumber}</span>
              </p>
            )}
          </div>

          {/* Enter panel */}
          {r.status === 'ACTIVE' ? (
            <EnterPanel
              raffleId={r.id}
              ticketPrice={r.ticketPriceCents}
              question={r.question}
              options={{
                A: r.optionA,
                B: r.optionB,
                C: r.optionC,
                D: r.optionD,
              }}
              ticketsRemaining={ticketsRemaining}
            />
          ) : (
            <div
              className="rounded-[6px] px-4 py-3 text-sm text-center"
              style={{
                background: 'var(--bg-inset)',
                border: '0.5px solid var(--border)',
                color: 'var(--text-tertiary)',
              }}
            >
              {r.status === 'CLOSED_AWAITING_DRAW' ? 'Closed — draw pending' :
               r.status === 'DRAWN' ? 'Winner drawn' :
               r.status === 'CLAIMED' ? 'Prize claimed' :
               r.status === 'CANCELLED_BY_ADMIN' ? 'Cancelled — refunds in progress' :
               'Not accepting entries'}
            </div>
          )}

          {/* Free postal entry — single button that downloads the PDF
              and opens an instructions modal. CPA Section 36 free-entry
              route; no purchase necessary. */}
          <div className="mt-4 mb-5">
            <FreeEntryButton raffleId={r.id} raffleTitle={r.title} />
          </div>

          {/* Description — same place a listing detail's description
              sits, below the CTA. */}
          <div
            className="rounded-[6px] p-3 text-sm"
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
              About this prize
            </p>
            <p
              className="leading-relaxed whitespace-pre-wrap"
              style={{ color: 'var(--text-primary)' }}
            >
              {r.description}
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
