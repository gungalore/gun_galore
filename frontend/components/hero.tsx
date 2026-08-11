// Homepage hero. Cinematic full-width banner with an outdoor scene photo,
// dark overlay so the headline reads, and two CTAs. Server component — no JS.
// Focus: outdoor, hunting & sport recreation (firearms stay in the catalogue
// + nav, just not the landing headline).

import Link from 'next/link';
import { TrustCard } from './trust-banner';

export function Hero() {
  return (
    <section
      className="relative w-full overflow-hidden"
      style={{
        // The image is very wide (~5:1) so we let it crop top/bottom on
        // narrow viewports. Kept fairly short so the paid Featured strip
        // below is visible when a visitor first lands.
        minHeight: 'clamp(340px, 44vh, 460px)',
        background: 'var(--bg-deep)',
      }}
    >
      {/* Background image — WebP for modern browsers (~29 KB) with PNG
          fallback (~1.2 MB) for ancient ones. Lighthouse mobile audit
          flagged hero.png as the LCP-killer (9.9s). Switching to WebP
          drops the LCP under 2.5s in repeat-visit conditions and well
          under 4s on cold load. image-set() is the only way to do per-
          browser format selection on a CSS background — `<picture>`
          isn't an option because the hero uses a background-image to
          combine with the gradient overlays below.

          Background position is responsive:
            * desktop: `left center` — shows the bullet on the left
              with the suppressor reveal trailing to the right
            * mobile: `70% center` — shifts the brightest area (the
              smoke + bullet) off-screen to the right so the text
              area at the bottom-left sits over a near-uniformly-dark
              section of the photo. Combined with the mobile vertical
              gradient overlay below, this gets the subhead from
              "grey on grey" (failed contrast) to "white on near-
              black" (AAA contrast).

          Preloaded in app/layout.tsx so the browser kicks off the
          fetch in parallel with the JS bundle. */}
      <div className="hero-bg absolute inset-0" aria-hidden />

      {/* Gradient overlay — viewport-aware so the text always has a
          high-contrast backdrop:
            * desktop: horizontal fade — heavy on the LEFT where the
              copy sits, transparent on the right so the bullet +
              suppressor read clearly. Original tuning.
            * mobile: vertical fade — soft on the top (image visible)
              into near-black at the bottom where the headline +
              subhead sit. The text always reads regardless of where
              the smoke trail crops to.
          The red brand-glow radial stays in both modes as a corner
          accent. CSS class + media query live in the <style> block
          below — inline styles can't express @media rules. */}
      <div className="hero-overlay absolute inset-0" aria-hidden />

      {/* Content slides in from the left immediately so the page
          feels instant — the old 1-second wait read as a stuck app.
          Each child has its own `animation-delay` so the eyebrow,
          headline, subhead and CTA arrive in sequence (~120 ms
          gap). Pure CSS keyframe — no client JS. Honours
          `prefers-reduced-motion: reduce` so motion-sensitive users
          get the final state instantly.

          ALSO inside this <style>: the viewport-aware background-
          position + overlay-gradient rules. Default = desktop
          (horizontal dark-left fade); @media (max-width: 768px)
          overrides them with mobile-friendly values so the text
          stops washing out into grey-on-grey when the image crops. */}
      <style>{`
        .hero-bg {
          /* Outdoor hero — a hunter glassing a golden-hour Karoo landscape
             (operator-supplied 2026-06-24). WebP with a JPG fallback; the
             first url() is the fallback for browsers without image-set. */
          background-image: url('/hero-outdoor.jpg');
          background-image: image-set(
            url('/hero-outdoor.webp') type('image/webp'),
            url('/hero-outdoor.jpg') type('image/jpeg')
          );
          background-size: cover;
          background-position: center center;
          background-repeat: no-repeat;
          /* Real golden-hour photo — keep its warm colour (no grayscale).
             A slight darken keeps the white headline crisp over the left of
             the frame, where the overlay gradient below also sits. */
          filter: brightness(0.9);
        }
        .hero-overlay {
          /* Desktop default — horizontal fade with red corner glow. */
          background:
            linear-gradient(90deg, rgba(10,10,10,0.92) 0%, rgba(10,10,10,0.70) 28%, rgba(10,10,10,0.15) 58%, rgba(10,10,10,0) 100%),
            radial-gradient(circle at 0% 100%, rgba(200,16,46,0.18) 0%, transparent 45%);
        }
        @media (max-width: 768px) {
          .hero-bg {
            /* Keep the scene centred on mobile; the vertical gradient
               below carries the text contrast. */
            background-position: center center;
          }
          .hero-overlay {
            /* Vertical fade — soft top, near-black at bottom where
               the headline + subhead live. Layered with the red glow
               so the brand accent still reads in the corner. */
            background:
              linear-gradient(180deg, rgba(10,10,10,0.55) 0%, rgba(10,10,10,0.78) 55%, rgba(10,10,10,0.94) 100%),
              radial-gradient(circle at 0% 100%, rgba(200,16,46,0.22) 0%, transparent 50%);
          }
        }

        .hero-reveal { opacity: 1; transform: translateX(0); }
        @media (prefers-reduced-motion: no-preference) {
          .hero-reveal {
            opacity: 0;
            transform: translateX(-24px);
            animation: heroSlideIn 480ms cubic-bezier(0.22, 1, 0.36, 1) both;
          }
          .hero-reveal-1 { animation-delay: 120ms; }
          .hero-reveal-2 { animation-delay: 240ms; }
          .hero-reveal-3 { animation-delay: 360ms; }
          .hero-reveal-4 { animation-delay: 480ms; }
        }
        @keyframes heroSlideIn {
          0%   { opacity: 0; transform: translateX(-24px); }
          100% { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      <div className="relative max-w-[1280px] mx-auto px-4 sm:px-6 py-12 sm:py-14 flex flex-col md:flex-row md:items-center md:justify-between gap-8 lg:gap-12" style={{ minHeight: 'inherit' }}>
        <div className="max-w-[600px]">
          {/* Eyebrow */}
          <p
            className="hero-reveal hero-reveal-1 text-xs uppercase mb-4"
            style={{
              color: 'var(--red)',
              letterSpacing: '0.18em',
              fontWeight: 500,
            }}
          >
            South Africa&apos;s outdoor store
          </p>

          {/* Headline. text-shadow gives the white letters a crisp
              edge against any backdrop — essential when the photo's
              brightest patch (the smoke trail) crops near the text on
              mobile. Shadow is subtle on desktop where the overlay
              already darkens the left, but it's the difference
              between "readable" and "professional" on mobile. */}
          {/* The old lockup hard-<br>'d after "trade", but at lg:text-6xl the
              first line overflowed the 560px column, so "trade" wrapped onto
              its own stranded line and the break made it a ragged 4-liner.
              Now: no manual break, `text-wrap: balance` for even lines at
              every viewport, a nowrap guard so "gear." can never orphan, and
              one size notch down at lg so the balanced block breathes. */}
          <h1
            className="hero-reveal hero-reveal-2 text-4xl sm:text-5xl lg:text-[3.4rem] leading-[1.12] mb-5"
            style={{
              color: 'var(--text-primary)',
              fontWeight: 500,
              letterSpacing: '-0.02em',
              textShadow: '0 2px 8px rgba(0, 0, 0, 0.55)',
              textWrap: 'balance',
            }}
          >
            New &amp; secondhand{' '}
            <span style={{ color: 'var(--red)' }}>outdoor gear</span>
            {' '}for the{' '}
            <span style={{ whiteSpace: 'nowrap' }}>whole trip.</span>
          </h1>

          {/* Subhead. The previous color (var(--text-secondary) =
              #a0a0a0) washed out into grey-on-grey when the photo
              cropped behind it on mobile (1.4:1 contrast — fail).
              Lifted to near-white at 88% opacity so the headline
              still reads as the dominant element (it's bigger + at
              100%), but the subhead has enough contrast against any
              backdrop (AAA on the post-gradient ~#222 background).
              Same text-shadow as the headline for a crisp edge. */}
          <p
            className="hero-reveal hero-reveal-3 text-base sm:text-lg leading-relaxed mb-8 max-w-[520px]"
            style={{
              color: 'rgba(245, 245, 245, 0.88)',
              textShadow: '0 1px 4px rgba(0, 0, 0, 0.5)',
            }}
          >
            Camping, overlanding, fishing, optics, knives and clothing.
            Verified sellers, payment held until delivery is confirmed.
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
            Browse the store
          </Link>
        </div>

        {/* Trust proof card — right on desktop, stacked under the copy on
            mobile. Points reveal one after another. */}
        <div className="hero-reveal hero-reveal-4 w-full md:w-auto">
          <TrustCard />
        </div>
      </div>
    </section>
  );
}
