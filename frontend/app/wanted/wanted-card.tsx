import Link from 'next/link';
import { WantedAdCard } from '@/lib/types';
import { formatPrice, PROVINCE_LABELS } from '@/lib/utils';
import { timeAgo } from '@/lib/notifications';

/** Budget line: "R 5 000 – R 8 000" / "Up to R 8 000" / "Open to offers". */
export function budgetLabel(ad: {
  budgetMinCents: number | null;
  budgetMaxCents: number | null;
}): string {
  if (ad.budgetMinCents != null && ad.budgetMaxCents != null) {
    return `${formatPrice(ad.budgetMinCents)} – ${formatPrice(ad.budgetMaxCents)}`;
  }
  if (ad.budgetMaxCents != null) return `Up to ${formatPrice(ad.budgetMaxCents)}`;
  if (ad.budgetMinCents != null) return `From ${formatPrice(ad.budgetMinCents)}`;
  return 'Open to offers';
}

export function WantedCard({ ad }: { ad: WantedAdCard }) {
  return (
    <Link
      href={`/wanted/${ad.id}`}
      className="block rounded-[8px] p-4 transition-colors hover:border-[var(--red)]"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide"
          style={{ background: 'rgba(200,16,46,0.14)', color: 'var(--red)' }}
        >
          Wanted
        </span>
        {ad.categoryName && (
          <span
            className="px-2 py-0.5 rounded-full text-[11px]"
            style={{
              background: 'var(--bg-inset)',
              color: 'var(--text-secondary)',
              border: '0.5px solid var(--border)',
            }}
          >
            {ad.categoryName}
          </span>
        )}
      </div>

      <h3
        className="text-sm font-medium mb-1 line-clamp-2"
        style={{ color: 'var(--text-primary)' }}
      >
        {ad.title}
      </h3>
      <p
        className="text-xs mb-3 line-clamp-2"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {ad.description}
      </p>

      <div className="flex items-center justify-between text-xs">
        <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
          {budgetLabel(ad)}
        </span>
        <span style={{ color: 'var(--text-tertiary)' }}>
          {ad.province ? `${PROVINCE_LABELS[ad.province] ?? ad.province} · ` : ''}
          {timeAgo(ad.createdAt)}
        </span>
      </div>

      <div
        className="mt-3 pt-3 flex items-center justify-between text-xs"
        style={{ borderTop: '0.5px solid var(--border)' }}
      >
        <span style={{ color: 'var(--text-tertiary)' }}>
          {ad.responseCount === 0
            ? 'No responses yet'
            : `${ad.responseCount} response${ad.responseCount === 1 ? '' : 's'}`}
        </span>
        <span style={{ color: 'var(--red)', fontWeight: 600 }}>
          I have this →
        </span>
      </div>
    </Link>
  );
}
