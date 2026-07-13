// Trust card — the competitive proof panel that lives on the RIGHT of the
// homepage hero. Four "why Gun Galore" points reveal one after another on a
// gentle loop so the eye is drawn to them. Square-ish card so it sits neatly
// beside the headline on desktop and stacks under it on mobile.
//
// House rule: never the word "escrow" — "payment is held" is correct.

const POINTS = [
  'Payment held until delivery',
  'ID-verified sellers',
  'Couriered & tracked',
  'No upfront fees to advertise',
];

export function TrustCard() {
  return (
    <div
      className="gg-tc w-full md:w-[320px] lg:w-[340px] shrink-0 rounded-[16px] p-5 sm:p-6"
      style={{
        background:
          'linear-gradient(160deg, rgba(26,22,23,0.92), rgba(16,13,14,0.92))',
        border: '0.5px solid rgba(200,16,46,0.35)',
        boxShadow: '0 18px 44px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(2px)',
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
          Every deal, protected
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
            animation-delay: calc(var(--i) * 0.55s);
          }
          @keyframes gg-tc-cycle {
            0%   { opacity: 0; transform: translateX(10px); }
            7%   { opacity: 1; transform: translateX(0); }
            80%  { opacity: 1; transform: translateX(0); }
            90%  { opacity: 0; transform: translateX(10px); }
            100% { opacity: 0; transform: translateX(10px); }
          }
        }
      `}</style>
    </div>
  );
}
