// Trust card — the competitive proof panel that lives on the RIGHT of the
// homepage hero. Four "why All Outdoor" points reveal one after another on a
// gentle loop so the eye is drawn to them. Square-ish card so it sits neatly
// beside the headline on desktop and stacks under it on mobile.
//
// House rules (operator): we present as an online STORE that buys and sells
// new and secondhand goods. Never advertise funds-holding here — this card is
// pure marketing. Where mechanics matter (checkout, order pages), phrase it
// as when the seller is paid, and never the word "escrow" anywhere.

// Store trust only. "ID-verified sellers" was KYC/fintech vocabulary — a
// payments platform verifies counterparties; a shop vets what goes on its
// shelves. And the seller-fee pitch didn't belong on a buyer trust card.
const POINTS = [
  'Secure card checkout',
  'Couriered & tracked, door to door',
  'Every item checked before it goes up',
  'Local support that actually answers',
];

export function TrustCard() {
  return (
    <div
      className="gg-tc w-full md:w-[320px] lg:w-[340px] shrink-0 p-5 sm:p-6"
      style={{
        background:
          'linear-gradient(160deg, rgba(26,22,23,0.92), rgba(16,13,14,0.92))',
        border: '1px solid rgba(200,16,46,0.30)',
        borderRadius: 'var(--r-lg)',
        // No boxShadow: globals.css sets `* { box-shadow: none !important }`
        // (a CLAUDE.md house rule), which outranks even inline styles — the
        // 0 18px 44px shadow that used to be declared here never rendered.
        backdropFilter: 'blur(3px)',
      }}
    >
      {/* Kicker — shield mark + short label (the old scary headline is gone). */}
      <div className="flex items-center gap-2.5 mb-4">
        <span
          className="flex items-center justify-center rounded-full flex-shrink-0"
          style={{
            width: 34,
            height: 34,
            background: 'rgba(200,16,46,0.16)',
            border: '0.5px solid rgba(200,16,46,0.5)',
          }}
          aria-hidden="true"
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--red)"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
        </span>
        <span
          className="text-sm font-semibold"
          style={{ color: 'var(--text-primary)' }}
        >
          Shop with confidence
        </span>
      </div>

      <ul className="flex flex-col gap-3 m-0 p-0" style={{ listStyle: 'none' }}>
        {POINTS.map((point, i) => (
          <li
            key={point}
            className="gg-tc-point flex items-center gap-2.5 text-sm"
            style={
              {
                color: 'var(--text-secondary)',
                ['--i' as string]: String(i),
              } as React.CSSProperties
            }
          >
            <span
              aria-hidden="true"
              className="flex items-center justify-center flex-shrink-0"
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: 'rgba(200,16,46,0.14)',
                color: 'var(--red)',
                fontSize: 11,
                fontWeight: 800,
              }}
            >
              ✓
            </span>
            {point}
          </li>
        ))}
      </ul>

      <style>{`
        .gg-tc-point { opacity: 1; }
        @media (prefers-reduced-motion: no-preference) {
          .gg-tc-point {
            opacity: 0;
            animation: gg-tc-cycle 9s ease-in-out infinite;
            animation-delay: calc(var(--i) * 0.4s);
          }
          /* Long visible plateau (4%–93%) + tighter 0.4s stagger so all four
             points read together for ~85% of the loop — the old timing left
             most of the list invisible for roughly a quarter of every cycle. */
          @keyframes gg-tc-cycle {
            0%   { opacity: 0; transform: translateX(10px); }
            4%   { opacity: 1; transform: translateX(0); }
            93%  { opacity: 1; transform: translateX(0); }
            99%  { opacity: 0; transform: translateX(10px); }
            100% { opacity: 0; transform: translateX(10px); }
          }
        }
      `}</style>
    </div>
  );
}
