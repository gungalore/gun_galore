import Link from 'next/link';
import type { Me } from '@/lib/types';

// Dashboard header identity block: greets the user by name and — while the
// profile isn't finished — shows a clickable completeness bar that opens
// the unified profile form (/profile/edit, "every part that has to be
// filled out"). Server-rendered (no client JS): the bar is a Link and the
// percent comes from the profileCompleteness that GET /users/me already
// computes (buyer = name/phone/address; seller adds banking/identity/
// verification). Hides the bar at 100% and just greets by name.
function fillColour(p: number): string {
  if (p >= 67) return '#22c55e';
  if (p >= 34) return '#f59e0b';
  return 'var(--red)';
}

export function DashboardProfileProgress({ me }: { me: Me | null }) {
  const name = me?.firstName?.trim() || me?.username || null;
  const percent = me?.profileCompleteness?.percent ?? 0;
  const missingCount = me?.profileCompleteness?.missing?.length ?? 0;

  return (
    <div style={{ flex: 1, minWidth: 240 }}>
      <h1
        className="text-xl font-medium"
        style={{ color: 'var(--text-primary)', margin: 0 }}
      >
        {name ? `Hi, ${name}` : 'My Dashboard'}
      </h1>

      {me && percent < 100 ? (
        <Link
          href="/profile/edit"
          aria-label={`Profile ${percent}% complete — click to finish setting up`}
          style={{
            display: 'block',
            textDecoration: 'none',
            marginTop: 10,
            maxWidth: 440,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 5,
            }}
          >
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Complete your profile
              {missingCount ? ` — ${missingCount} thing${missingCount === 1 ? '' : 's'} left` : ''}
            </span>
            <span
              className="text-xs"
              style={{
                color: 'var(--text-primary)',
                fontWeight: 500,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {percent}% →
            </span>
          </div>
          <div
            style={{
              height: 8,
              borderRadius: 999,
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.max(3, percent)}%`,
                background: fillColour(percent),
                borderRadius: 999,
                transition: 'width 0.3s',
              }}
            />
          </div>
        </Link>
      ) : me && percent >= 100 ? (
        <p className="text-xs" style={{ color: '#22c55e', marginTop: 6 }}>
          Profile complete ✓
        </p>
      ) : null}
    </div>
  );
}
