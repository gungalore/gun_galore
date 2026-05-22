// Homepage hero. Cinematic full-width banner with the bullet-trail photo,
// dark overlay so headline reads, and two CTAs. Server component — no JS.

import Link from 'next/link';

export function Hero() {
  return (
    <section
      className="relative w-full overflow-hidden"
      style={{
        // The image is very wide (~5:1) so we let it crop top/bottom on
        // narrow viewports. Min height keeps the hero feeling substantial
        // on desktop without dominating mobile.
        minHeight: 'clamp(360px, 50vh, 560px)',
        background: 'var(--bg-deep)',
      }}
    >
      {/* Background image */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'url(/hero.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'left center',
          backgroundRepeat: 'no-repeat',
          // Desaturate to pure B&W and lift brightness so the bullet +
          // smoke detail reads through. Higher contrast keeps it from
          // looking washed out at the higher brightness.
          filter: 'grayscale(1) brightness(0.85) contrast(1.15)',
        }}
        aria-hidden
      />

      {/* Gradient overlay — heavy on the left (where the copy sits) fading
          to fully transparent on the right so the bullet + suppressor read
          clearly. The red glow on the bottom-left is the brand accent. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(90deg, rgba(10,10,10,0.92) 0%, rgba(10,10,10,0.70) 28%, rgba(10,10,10,0.15) 58%, rgba(10,10,10,0) 100%), radial-gradient(circle at 0% 100%, rgba(200,16,46,0.18) 0%, transparent 45%)',
        }}
        aria-hidden
      />

      {/* Content. Slides in from the left after a 1s beat so the seller
          gets a moment to see the bullet + suppressor photo before the
          copy lands. Pure CSS keyframe — no client JS. Each child has
          its own `animation-delay` so the eyebrow, headline, subhead
          and CTA arrive in sequence (~0.18s gap). */}
      <style>{`
        .hero-reveal { opacity: 0; transform: translateX(-32px); animation: heroSlideIn 0.8s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .hero-reveal-1 { animation-delay: 1s; }
        .hero-reveal-2 { animation-delay: 1.18s; }
        .hero-reveal-3 { animation-delay: 1.36s; }
        .hero-reveal-4 { animation-delay: 1.54s; }
        @keyframes heroSlideIn {
          0%   { opacity: 0; transform: translateX(-32px); }
          100% { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      <div className="relative max-w-[1280px] mx-auto px-4 sm:px-6 py-16 sm:py-20 lg:py-24 flex flex-col justify-center" style={{ minHeight: 'inherit' }}>
        <div className="max-w-[640px]">
          {/* Eyebrow */}
          <p
            className="hero-reveal hero-reveal-1 text-xs uppercase mb-4"
            style={{
              color: 'var(--red)',
              letterSpacing: '0.18em',
              fontWeight: 500,
            }}
          >
            South Africa&apos;s firearms marketplace
          </p>

          {/* Headline */}
          <h1
            className="hero-reveal hero-reveal-2 text-4xl sm:text-5xl lg:text-6xl leading-[1.05] mb-5"
            style={{
              color: 'var(--text-primary)',
              fontWeight: 500,
              letterSpacing: '-0.02em',
            }}
          >
            Buy, sell, bid and{' '}
            <span style={{ color: 'var(--red)' }}>win</span>
            <br />
            firearms and gear.
          </h1>

          {/* Subhead */}
          <p
            className="hero-reveal hero-reveal-3 text-base sm:text-lg leading-relaxed mb-8 max-w-[520px]"
            style={{ color: 'var(--text-secondary)' }}
          >
            Verified sellers. Payment protection on every transaction.
            Dealer-routed transfers for firearms. Run by South Africans,
            for South African shooters.
          </p>

          {/* Primary CTA — drops the user straight into the Marketplace
              surface (BUY_NOW listings) since that's the largest catalogue. */}
          <Link
            href="/?listingType=BUY_NOW"
            className="hero-reveal hero-reveal-4 inline-block px-6 py-3 rounded-[6px] text-sm transition-all"
            style={{
              background: 'var(--red)',
              color: '#fff',
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            Browse marketplace
          </Link>
        </div>
      </div>
    </section>
  );
}
