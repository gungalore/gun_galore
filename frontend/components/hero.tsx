// Homepage hero. Full-bleed moonlit overlanding scene with the store intro
// set on it. Server component — no JS.
// Focus: outdoor, hunting & sport recreation (firearms stay in the catalogue
// + nav, just not the landing headline).

import Link from 'next/link';
import { av } from '@/lib/asset-version';

export function Hero() {
  return (
    <section
      className="hero-section relative w-full overflow-hidden"
      style={{
        // ⚠️ A DELIBERATELY DARK SURFACE — not `var(--bg-deep)`, and not a
        // leftover from the pre-Winkel dark theme. See the --text-on-dark
        // note in globals.css: the hero is one of the few places that stays
        // dark whatever the page theme, because the copy is set ON a night
        // photograph and has to stay light ink at every breakpoint.
        //
        // The value matches the plate's own foot (sampled: #0E0E0D at the
        // bottom edge, #151514 inside the mobile crop window), so on phones —
        // where the copy sits BELOW the picture rather than over it — the
        // photograph fades into this panel with no visible seam.
        //
        // This used to be var(--bg-deep). That was correct while the theme
        // was near-black; after the Winkel re-theme it resolved to #FFFFFF
        // and the mobile copy — which is light ink — rendered white on white.
        background: '#121211',
      }}
    >
      {/* The frame carries the plate's OWN aspect ratio on desktop, so the
          whole photograph is visible: 2172x724, a 3:1 panorama. On a 1600px
          page that is a 533px band — big without eating the fold.

          Phones get a 4:3 window instead. A 3:1 band is only ~130px tall at
          390px wide, which reads as a letterbox strip rather than a hero, so
          the frame keeps its own ratio there and background-size: cover crops
          the sides. Which slice you get is set by background-position below. */}
      <div className="hero-frame">
        {/* Background plate — WebP for modern browsers (~22 KB) with a JPEG
            fallback (~43 KB). image-set() is the only way to do per-browser
            format selection on a CSS background; <picture> isn't an option
            because the plate combines with the gradient overlay below.

            Preloaded in app/layout.tsx so the browser starts the fetch in
            parallel with the JS bundle. This is the LCP element. */}
        <div className="hero-bg absolute inset-0" aria-hidden />

        {/* Gradient overlay — viewport-aware. See the <style> block for what
            each breakpoint does and why the desktop wash is so light. */}
        <div className="hero-overlay absolute inset-0" aria-hidden />

        {/* Content slides in from the left immediately so the page feels
            instant. Each child has its own `animation-delay` so the eyebrow,
            headline, subhead and CTA arrive in sequence (~120 ms gap). Pure
            CSS keyframe — no client JS. Honours `prefers-reduced-motion`.

            ALSO inside this <style>: the frame ratios, the viewport-aware
            background-position, and the overlay gradients. Inline styles
            can't express @media rules. */}
        <style>{`
        .hero-bg {
          /* Outdoor hero — operator-supplied brand scene, 2026-08-27: a
             moonlit Karoo night, layered mountain ridges, a dirt two-track
             running out of frame and a kitted bakkie with a rooftop tent and
             a campfire on the right-hand rise.

             REPLACED the golden-hour Table Mountain plate (kudu / bakkie /
             acacia) that shipped 2026-08-12. That one was 1672x941; this is
             2172x724, so the frame ratio below changed with it.

             ⚠️ THE PLATE IS ALREADY DARK — that is the whole reason the
             overlay below is so light. Measured on the source: the desktop
             copy column (left 38%) runs 12.3:1 against white at its
             BRIGHTEST tile and 20.5:1 at its darkest, with no scrim at all.
             The old 0.84 black wash existed to rescue white text off a lit
             golden-hour sky; applied here it just crushes the mountains to
             a black rectangle and buys no legibility.

             Versioned to match the <link rel=preload> in layout.tsx. These
             used to be bare paths while the preload carried ?v= — two
             different URLs, so the LCP preload was fetching an image the
             page never requested. Cloudflare also holds /public for 30 days,
             so replacing the plate without a version bump would have served
             the old scene at the edge for a month. */
          background-image: url('${av('/hero-outdoor.jpg')}');
          background-image: image-set(
            url('${av('/hero-outdoor.webp')}') type('image/webp'),
            url('${av('/hero-outdoor.jpg')}') type('image/jpeg')
          );
          background-size: cover;
          background-position: center center;
          background-repeat: no-repeat;
          /* No brightness filter. The previous plate carried brightness(0.95)
             to keep white type crisp over a lit sky; this one is a night
             scene and any further darkening loses the ridge separation that
             makes it read as a photograph at all. */
        }
        .hero-overlay {
          /* Desktop — a soft left-weighted wash, plus the red brand glow in
             the bottom-left corner. The wash is for FOCUS, not contrast (see
             the measurement note above): it settles the copy column and lets
             the red CTA pop without flattening the moonlight. */
          background:
            linear-gradient(90deg, rgba(8,10,14,0.55) 0%, rgba(8,10,14,0.30) 34%, rgba(8,10,14,0.06) 62%, rgba(8,10,14,0) 100%),
            radial-gradient(circle at 0% 100%, rgba(200,16,46,0.10) 0%, transparent 45%);
        }
        @media (max-width: 767.98px) {
          .hero-bg {
            /* A 4:3 window shows only 44% of a 3:1 plate's width, so WHICH
               44% is a real composition decision, not a default. 80% keeps
               the whole story: the moon top-right, the bakkie, the tent and
               its campfire on the rise, the ridges behind, and the two-track
               leading in from the bottom-left.

               Checked against the alternatives rather than guessed — centre
               (50%) drops the camp off the right edge entirely, 72% clips the
               bakkie, and 76% still cuts the tent in half. */
            background-position: 80% center;
          }
          .hero-overlay {
            /* The copy sits BELOW the picture on phones, so this only has to
               blend the foot of the photograph into the panel behind it. The
               end stop is the section background exactly, so there is no
               seam between plate and copy. */
            background:
              linear-gradient(180deg, rgba(18,18,17,0) 45%, rgba(18,18,17,0.55) 80%, #121211 100%);
          }
        }

        /* ── Frame + content placement ───────────────────────────────
           Mobile: the picture is a full-width 4:3 band and the copy sits
           BELOW it, on the section's dark panel.
           Desktop: the copy is absolutely positioned over the frame, in the
           empty left third of the photograph — which is exactly what that
           negative space is for on this plate. */
        .hero-frame {
          position: relative;
          width: 100%;
          aspect-ratio: 2172 / 724;
        }
        @media (max-width: 767.98px) {
          .hero-frame { aspect-ratio: 4 / 3; }
        }
        @media (min-width: 768px) {
          .hero-section { position: relative; }
          .hero-content {
            position: absolute;
            inset: 0;
            z-index: 1;
          }
          /* Guards against an absurd band on an ultrawide monitor; the plate
             fills the cap from the centre, losing only the outer edges. */
          .hero-frame { max-height: 88vh; }
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
      </div>

      {/* ⚠️ EVERY COLOUR IN HERE IS LIGHT INK, AT ALL BREAKPOINTS. On desktop
          it sits over the photograph; on mobile it sits on the section's dark
          panel. Do not reach for --text-primary/--text-secondary here — those
          track the PAGE theme, which is light, and would vanish. */}
      <div className="hero-content relative max-w-[var(--page-max)] mx-auto px-4 sm:px-6 py-10 sm:py-14 flex flex-col justify-center">
        <div className="max-w-[600px]">
          {/* Eyebrow. Warm-white rather than var(--red): the brand red is
              dark enough that it cannot reach 4.5:1 at this size against the
              plate without becoming a pink that isn't the brand. Red stays
              where it still has the contrast to carry — "outdoor gear" at
              display size, and the CTA. */}
          <p
            className="hero-reveal hero-reveal-1 text-xs uppercase mb-4"
            style={{
              color: 'rgba(255, 250, 245, 0.85)',
              letterSpacing: '0.18em',
              fontWeight: 500,
              textShadow: '0 1px 6px rgba(0, 0, 0, 0.6)',
            }}
          >
            South Africa&apos;s outdoor store
          </p>

          {/* Headline. No manual line break — `text-wrap: balance` evens the
              lines at every viewport, and a nowrap guard stops "trip."
              orphaning. text-shadow keeps a crisp edge wherever the plate
              crops behind it. */}
          <h1
            className="hero-reveal hero-reveal-2 text-4xl sm:text-5xl lg:text-[3.4rem] leading-[1.12] mb-5"
            style={{
              color: 'var(--text-on-dark)',
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

          <p
            className="hero-reveal hero-reveal-3 text-base sm:text-lg leading-relaxed mb-8 max-w-[520px]"
            style={{
              color: 'rgba(245, 245, 245, 0.88)',
              textShadow: '0 1px 4px rgba(0, 0, 0, 0.5)',
            }}
          >
            Camping, overlanding, fishing and outdoor clothing —
            new and secondhand, couriered to your door.
          </p>

          {/* ONE call to action. The hero briefly carried a second button
              and flipped its primary to "List your first item" while the
              catalogue was empty; that put the selling flow in the loudest
              position on the site and made the landing page read as a
              recruitment pitch (operator, 2026-08-16). Selling now lives in
              the nav and in the disclosure panel further down. One button,
              buyer-facing, is also simply the cleaner composition. */}
          <Link
            href="/?listingType=BUY_NOW"
            className="hero-reveal hero-reveal-4 inline-flex items-center justify-center px-8 text-sm transition-colors"
            style={{
              background: 'var(--red)',
              color: '#fff',
              fontWeight: 600,
              textDecoration: 'none',
              minHeight: 50,
              borderRadius: 'var(--r-md)',
              letterSpacing: '0.01em',
            }}
          >
            Browse the store
          </Link>
        </div>
      </div>
    </section>
  );
}
