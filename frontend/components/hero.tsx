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
          /* BOTTOM, not centre. Once the band is capped at the design's 330px
             it can only show ~62% of a 3:1 plate, so which 62% is a real
             decision. Anchoring to the bottom keeps the ridge line, the
             two-track, the bakkie, the tent and the campfire — every subject
             that makes this read as overlanding — and gives up only sky, which
             is the emptiest part of the frame. Centre keeps the moon and loses
             the camp; top is almost entirely sky. */
          background-position: center bottom;
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
            /* ⚠️ THE COPY IS OVER THE PICTURE ON PHONES NOW, NOT UNDER IT.
               It used to sit below, on the section's dark panel, and this
               gradient only had to blend the foot of the plate into that
               panel. Stacked that way the hero cost a 390px phone the picture
               PLUS the full height of the copy — around 1250px, so the
               storefront itself never appeared on the first screen. The mobile
               board draws one 260px band with the words on the photograph.

               This wash is therefore doing contrast work, not blending: dark
               at the top so the eyebrow reads, lightest across the middle
               where the ridges are, dark again at the foot under the
               sub-heading. */
            background:
              linear-gradient(180deg, rgba(10,10,10,0.55) 0%, rgba(10,10,10,0.30) 45%, rgba(10,10,10,0.62) 100%);
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
          /* A FIXED BAND, like the desktop rule below, not a ratio.
             4/3 on a 390px phone is 293px of picture BEFORE the copy that sits
             under it, which pushed the storefront itself off the first screen
             entirely -- on the mobile boards the hero is 260px and the two shop
             tiles are visible without scrolling. aspect-ratio has to be cleared
             explicitly or it keeps fighting the height. */
          .hero-frame {
            aspect-ratio: auto;
            height: 260px;
            max-height: none;
          }

          /* Overlay the copy, the same way the desktop rule below does — the
             section is the positioning context and the content covers the
             frame. */
          .hero-section { position: relative; }
          .hero-content {
            position: absolute;
            inset: 0;
            z-index: 1;
            padding-top: 0;
            padding-bottom: 0;
            gap: 11px;
          }

          /* The board's type ramp for this band. The Tailwind classes on these
             elements are mobile-first and set 36px/16px, which was sized for
             copy on its own panel; over a 260px photograph it has to come
             down or there is no photograph left. */
          .hero-reveal-1 {
            font-size: 10.5px;
            letter-spacing: 2px;
          }
          .hero-reveal-2 {
            font-size: 27px;
            line-height: 1.15;
            letter-spacing: -0.6px;
            /* text-shadow, NOT box-shadow. The global box-shadow:none
               !important rule in globals.css kills every box-shadow on the
               site, but it does not touch text-shadow — and white type over a
               moonlit ridge needs the separation.
               (No backticks in this block: it lives inside a JSX template
               literal and a backtick ends the string. See the warning at the
               top of the style tag.) */
            text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
          }
          .hero-reveal-3 {
            font-size: 13.5px;
            line-height: 1.55;
          }

          /* ⚠️ NO CTA BUTTON ON PHONES. The board does not draw one, and there
             is no room for a 46px button inside a 260px band that already
             carries three lines of copy. It is not a lost action: the Buy Now
             and Auctions tiles sit immediately below the hero and are the
             storefront's real entry points, which is exactly the arrangement
             the board shows. */
          .hero-cta {
            display: none;
          }
        }
        @media (min-width: 768px) {
          .hero-section { position: relative; }
          .hero-content {
            position: absolute;
            inset: 0;
            z-index: 1;
          }
          /* A FIXED BAND, not a ratio. Deriving height from the plate's own
             3:1 meant the hero grew with the window — 706px on a wide desktop,
             filling the fold and pushing the entire storefront below it. The
             design is a 330px band and it stays 330px at every desktop width;
             background-size: cover crops the rest. aspect-ratio has to be
             cleared explicitly or it keeps fighting the height. */
          .hero-frame {
            aspect-ratio: auto;
            height: 330px;
            max-height: none;
          }
        }

        /* The primary landing CTA carried a transition-colors class for months
           with nothing to transition TO — no hover, focus or active rule
           existed anywhere, so it was decoration on an inert button. Colour
           only, and gated so it never fires from a touch (a sticky hover after
           a tap is worse than no hover). The press comes from .gg-press.

           ⚠️ NO BACKTICKS IN THIS BLOCK. It lives inside a JSX template
           literal, so a backtick here ends the string and takes the whole
           component out with it. */
        @media (hover: hover) and (pointer: fine) {
          .hero-cta {
            transition: background-color var(--dur-fast) var(--ease-standard);
          }
          .hero-cta:hover { background: var(--red-hover) !important; }
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
      <div className="hero-content relative max-w-[var(--page-max)] mx-auto px-4 sm:px-6 py-10 md:py-0 flex flex-col justify-center">
        {/* The design's copy column: 700px wide, 40px of inset, and a single
            15px gap doing ALL the vertical rhythm — the four children used to
            carry their own mb-4/mb-5/mb-8, which is what made the block ~312px
            tall and impossible to centre in a 330px band. md:py-0 above lets
            justify-center do the centring instead of padding. */}
        <div className="max-w-[600px] md:max-w-[700px] md:px-10 flex flex-col gap-4 md:gap-[15px]">
          {/* Eyebrow. Warm-white rather than var(--red): the brand red is
              dark enough that it cannot reach 4.5:1 at this size against the
              plate without becoming a pink that isn't the brand. Red stays
              where it still has the contrast to carry — "outdoor gear" at
              display size, and the CTA. */}
          <p
            className="hero-reveal hero-reveal-1 text-xs md:text-[11px] uppercase"
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
          {/* 44px at md+, not 54px. The old lg:text-[3.4rem] was sized for a
              706px hero; in a 330px band two lines of it plus the eyebrow,
              subhead and CTA simply do not fit. 44/1.1 is the design's own
              figure and it is what makes the band work. */}
          <h1
            className="hero-reveal hero-reveal-2 text-4xl sm:text-5xl md:text-[44px] leading-[1.12] md:leading-[1.1]"
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
            className="hero-reveal hero-reveal-3 text-base sm:text-lg md:text-[15.5px] leading-relaxed md:leading-[1.6] max-w-[520px]"
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
          {/* self-start matters: the parent is now a flex COLUMN, so a child
              would stretch to full width and the button would run the length
              of the copy block. inline-flex alone does not prevent that —
              flex items stretch on the cross axis by default. */}
          <Link
            href="/?listingType=BUY_NOW"
            className="hero-cta gg-press hero-reveal hero-reveal-4 self-start inline-flex items-center justify-center text-sm"
            style={{
              background: 'var(--red)',
              color: '#fff',
              fontWeight: 600,
              textDecoration: 'none',
              height: 46,
              padding: '0 32px',
              borderRadius: 'var(--r-sm)',
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
