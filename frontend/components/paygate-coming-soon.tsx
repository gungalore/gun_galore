// Placeholder for the upcoming payment gateway (card + instant EFT). Shown on
// checkout surfaces while payments run on manual bank transfer (EFT). Drops
// away once the new paygate is wired (Phase 8e). Purely informational.
export function PaygateComingSoon() {
  return (
    <div
      className="rounded-[8px] p-3 mb-3 flex items-center gap-3"
      style={{ background: 'var(--bg-card)', border: '0.5px dashed var(--border)' }}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}
        aria-hidden="true"
      >
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <line x1="2" y1="10" x2="22" y2="10" />
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-sm" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
          Card &amp; instant payment
        </p>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Coming soon — for now, pay securely by bank transfer (EFT).
        </p>
      </div>
      <span
        className="text-xs px-2 py-1 rounded-full whitespace-nowrap"
        style={{ background: 'var(--bg-inset)', color: 'var(--text-tertiary)', fontWeight: 500 }}
      >
        Coming soon
      </span>
    </div>
  );
}
