import Link from 'next/link';

// Homepage trust banner — the competitive headline.
//
// Safari Outdoor's marketplace (and every classifieds board) is a
// contact-exchange model: you swap phone numbers with a stranger and
// wire your money on trust. That's exactly where the community's scam
// stories come from. This banner turns that weakness into our headline:
// on Gun Galore the platform sits in the middle and holds the payment
// until the item actually arrives.
//
// House rule: never the word "escrow" — "payment is held" is correct
// and compliant.
export function TrustBanner() {
  return (
    <section className="max-w-[1280px] mx-auto px-4 pt-2 pb-2">
      <div
        className="relative overflow-hidden rounded-[12px] px-5 py-5 sm:px-7 sm:py-6"
        style={{
          background:
            'linear-gradient(135deg, rgba(200,16,46,0.12) 0%, rgba(26,26,26,0.6) 55%)',
          border: '0.5px solid rgba(200,16,46,0.35)',
        }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5">
          {/* Shield-check safety mark */}
          <div
            className="flex-shrink-0 flex items-center justify-center rounded-full"
            style={{
              width: 52,
              height: 52,
              background: 'rgba(200,16,46,0.16)',
              border: '0.5px solid rgba(200,16,46,0.5)',
            }}
            aria-hidden="true"
          >
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--red)"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </div>

          <div className="min-w-0 flex-1">
            <p
              className="text-base sm:text-lg leading-snug"
              style={{ color: 'var(--text-primary)', fontWeight: 600 }}
            >
              Don&rsquo;t hand your cellphone number and your money to a
              stranger.
            </p>
            <p
              className="text-sm mt-1"
              style={{ color: 'var(--text-secondary)' }}
            >
              On Gun Galore your payment is held until the item arrives —
              ID-verified sellers, couriered and tracked, every transaction
              protected.
            </p>

            {/* Reinforcement chips — the three things a classifieds board
                can't give you. */}
            <div className="flex flex-wrap gap-2 mt-3">
              {[
                'Payment held until delivery',
                'ID-verified sellers',
                'Couriered & tracked',
              ].map((chip) => (
                <span
                  key={chip}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px]"
                  style={{
                    background: 'var(--bg-inset)',
                    border: '0.5px solid var(--border)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <span style={{ color: 'var(--red)', fontWeight: 800 }}>✓</span>
                  {chip}
                </span>
              ))}
            </div>
          </div>

          <Link
            href="/how-selling-works"
            className="flex-shrink-0 self-start sm:self-center text-xs whitespace-nowrap"
            style={{ color: 'var(--red)', fontWeight: 600 }}
          >
            How you&rsquo;re protected →
          </Link>
        </div>
      </div>
    </section>
  );
}
