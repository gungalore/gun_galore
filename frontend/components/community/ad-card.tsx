'use client';

import { useAuth } from '../../lib/auth';
import { recordAdClick, type FeedAd } from '../../lib/community-api';

/**
 * A featured ad in the feed. This is the ONLY promotional surface in the
 * community — members cannot advertise, so it is admin/official placement.
 * Rendered with a clear "Sponsored" label so it is never mistaken for a post.
 */
export function AdCard({ ad }: { ad: FeedAd }) {
  const { getToken } = useAuth();
  const external = /^https?:\/\//i.test(ad.ctaUrl);

  async function onClick() {
    try {
      const token = await getToken();
      if (token) await recordAdClick(token, ad.id);
    } catch {
      /* click tracking is best-effort */
    }
  }

  return (
    <article
      className="gg-tile rounded-[8px] overflow-hidden"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
    >
      {ad.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={ad.imageUrl}
          alt=""
          className="w-full object-cover"
          style={{ maxHeight: 260, background: 'var(--bg-inset)' }}
        />
      )}
      <div className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="text-[10px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wide"
            style={{ background: 'var(--bg-inset)', color: 'var(--text-tertiary)' }}
          >
            Sponsored
          </span>
          {ad.advertiser && (
            <span className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
              {ad.advertiser}
            </span>
          )}
        </div>
        <h3
          className="text-[16px] font-medium"
          style={{ color: 'var(--text-primary)' }}
        >
          {ad.title}
        </h3>
        {ad.listing && typeof ad.listing.price === 'number' && (
          <div
            className="text-[15px] font-medium mt-1"
            style={{ color: 'var(--red)' }}
          >
            R{(ad.listing.price / 100).toLocaleString('en-ZA')}
          </div>
        )}
        {ad.body && (
          <p
            className="text-[14px] leading-relaxed mt-1"
            style={{ color: 'var(--text-secondary)' }}
          >
            {ad.body}
          </p>
        )}
        <a
          href={ad.ctaUrl}
          onClick={onClick}
          {...(external
            ? { target: '_blank', rel: 'noopener noreferrer sponsored' }
            : {})}
          className="gg-press inline-block mt-3 px-4 py-2 rounded-[6px] text-[13px] font-medium"
          style={{ background: 'var(--red)', color: '#fff' }}
        >
          {ad.ctaLabel ?? 'Learn more'}
        </a>
      </div>
    </article>
  );
}
