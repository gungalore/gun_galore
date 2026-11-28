import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { serverAuth as auth } from '@/lib/auth-server';
import { PageReveal } from '@/components/page-reveal';
import { LISTING_STATUS, resolveStatus, toneColor } from '@/lib/status-labels';
import {
  archiveDateLabel,
  archiveImageUrl,
  archiveReason,
  archiveStatusLabel,
  canRelistFromArchive,
  type ArchivedListing,
} from '@/lib/listing-archive';

const API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001/api';

function priceLabel(cents: number | null | undefined): string | null {
  if (cents == null || !Number.isFinite(cents)) return null;
  return `R${(cents / 100).toLocaleString('en-ZA', {
    minimumFractionDigits: 2,
  })}`;
}

export default async function ListingsArchivePage() {
  const { userId, getToken } = await auth();
  if (!userId) redirect('/sign-in?redirect_url=/my/listings/archive');

  const token = await getToken();
  const res = await fetch(`${API_URL}/listings/mine/archive`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  // Same rule as the working list: a backend blip must not read as "your
  // archive is empty". Say it failed and offer a real retry.
  const failed = !res.ok;
  const listings: ArchivedListing[] = failed ? [] : await res.json();

  return (
    <main className="max-w-[var(--page-max)] mx-auto px-4 py-6">
      <PageReveal variant="slide-up">
        <div
          data-reveal
          className="flex items-start justify-between gap-3 mb-2"
        >
          <div>
            <Link
              href="/my/listings"
              className="text-xs"
              style={{ color: 'var(--text-tertiary)' }}
            >
              ← My Listings
            </Link>
            <h1
              className="text-xl font-medium mt-1"
              style={{ color: 'var(--text-primary)' }}
            >
              Listing archive
            </h1>
          </div>
          <Link
            href="/listings/new"
            className="px-3 py-1.5 rounded-[6px] text-sm font-medium shrink-0"
            style={{ background: 'var(--action-primary-bg)', color: '#fff' }}
          >
            + New listing
          </Link>
        </div>

        <p
          data-reveal
          className="text-sm mb-6 max-w-[640px]"
          style={{ color: 'var(--text-secondary)' }}
        >
          Removed and expired listings are kept here for your records. They are
          not visible to buyers, and they no longer crowd your working list.
        </p>

        {failed ? (
          <div
            data-reveal
            className="rounded-[8px] py-12 px-6 text-center"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--red)',
            }}
          >
            <p
              className="text-base mb-2"
              style={{ color: 'var(--text-primary)', fontWeight: 500 }}
            >
              We couldn&apos;t load your archive
            </p>
            <p
              className="text-sm mb-5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              This is a problem on our side — your archive is still intact.
            </p>
            <a
              href="/my/listings/archive"
              className="inline-block py-2.5 px-5 rounded-[6px] text-sm"
              style={{
                background: 'var(--action-primary-bg)',
                color: '#fff',
                fontWeight: 500,
                textDecoration: 'none',
              }}
            >
              Try again
            </a>
          </div>
        ) : listings.length === 0 ? (
          <div
            data-reveal
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
              Your archive is empty
            </p>
            <p
              className="text-sm mb-5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Removed and expired listings will appear here automatically.
            </p>
            <Link
              href="/my/listings"
              className="inline-block py-2.5 px-5 rounded-[6px] text-sm"
              style={{
                background: 'var(--action-primary-bg)',
                color: '#fff',
                fontWeight: 500,
                textDecoration: 'none',
              }}
            >
              Back to My Listings
            </Link>
          </div>
        ) : (
          <div data-reveal className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {listings.map((l) => {
              const status = resolveStatus(LISTING_STATUS, l.status);
              const color = toneColor(status.tone);
              const image = archiveImageUrl(l);
              const price = priceLabel(l.price);
              const date = archiveDateLabel(l);
              const reason = archiveReason(l);
              const relist = canRelistFromArchive(l);
              return (
                <div
                  key={l.id}
                  className="rounded-[8px] p-4 flex gap-3 items-start"
                  style={{
                    background: 'var(--bg-card)',
                    border: '0.5px solid var(--border)',
                  }}
                >
                  {image ? (
                    <Image
                      src={image}
                      alt={l.title}
                      width={64}
                      height={64}
                      sizes="64px"
                      className="w-16 h-16 rounded-[6px] object-cover shrink-0"
                    />
                  ) : (
                    <div
                      className="w-16 h-16 rounded-[6px] shrink-0 flex items-center justify-center text-xs text-center px-1"
                      style={{
                        background: 'var(--bg-inset)',
                        color: 'var(--text-tertiary)',
                        border: '0.5px solid var(--border)',
                      }}
                    >
                      No photo
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p
                        className="font-medium truncate"
                        style={{ color: 'var(--text-primary)' }}
                        title={l.title}
                      >
                        {l.title}
                      </p>
                      <span
                        className="text-xs px-2 py-0.5 rounded-full shrink-0"
                        title={status.hint ?? archiveStatusLabel(l.status)}
                        style={{
                          color,
                          background: `color-mix(in srgb, ${color} 9%, transparent)`,
                          border: `0.5px solid color-mix(in srgb, ${color} 25%, transparent)`,
                        }}
                      >
                        {archiveStatusLabel(l.status)}
                      </span>
                    </div>

                    <p
                      className="text-xs"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      {l.category?.name ?? 'Listing'}
                      {date ? ` · ${date}` : ''}
                      {l.mediaPurgedAt ? ' · photos archived' : ''}
                    </p>

                    <p
                      className="text-xs mt-1"
                      style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}
                    >
                      {reason}
                    </p>

                    <div className="flex items-center justify-between mt-2 gap-2">
                      <span
                        className="text-sm font-medium"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {price ?? '—'}
                      </span>
                      {relist && (
                        <Link
                          href={`/listings/new?relistFrom=${l.id}`}
                          className="text-xs px-2 py-1 rounded-[6px]"
                          style={{
                            background: 'var(--bg-inset)',
                            color: 'var(--red)',
                            border: '0.5px solid var(--red)',
                            textDecoration: 'none',
                            fontWeight: 500,
                          }}
                        >
                          Relist
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PageReveal>
    </main>
  );
}
