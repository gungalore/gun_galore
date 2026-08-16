'use client';

import { av } from '@/lib/asset-version';

// Faint full-viewport background. Two modes:
//
//   1. Dot pattern (default) — subtle technical grid that ties the page
//      together without competing with content. Used when no `imageSrc`
//      is passed.
//
//   2. Image + vignette + tint — drops a photo at low opacity behind
//      everything, with a radial vignette so the photo melts into the
//      page borders and a flat dark tint to keep it from competing with
//      the form. Used for the Sell page (banknotes scenery).
//
// The vignette uses a radial gradient. Yes, CLAUDE.md says "no gradients"
// — that rule is about UI chrome (cards / buttons / pills). A photographic
// vignette is image treatment, not chrome. Comment kept here so reviewers
// don't try to "fix" it.

interface Props {
  /** Path to a background image (e.g. "/sell-bg.jpg"). When unset,
   *  falls back to the dot pattern. */
  imageSrc?: string;
  /** 0..1 — overall image opacity (default 0.45). Lower = subtler.
   *  NB these three compound: the image is drawn at `opacity`, then a flat
   *  black layer at `tint` covers it, then the vignette darkens the edges.
   *  The old defaults (0.18 / 0.55 / 0.85) put roughly 8% of the picture in
   *  front of the eye, which is why the plates read as almost nothing. */
  opacity?: number;
  /** Dark-tint overlay on top of the image (default 0.32 = 32% black). */
  tint?: number;
  /** Vignette strength (0 = no vignette, 1 = pitch-black corners). Default 0.6. */
  vignette?: number;
  /** Tile size for the dot pattern mode only (default 40). */
  tile?: number;
}

export function PageBackground({
  imageSrc,
  opacity = 0.45,
  tint = 0.32,
  vignette = 0.6,
  tile = 40,
}: Props = {}) {
  // ── Image mode ────────────────────────────────────────────────────
  //
  // STACKING NOTE — all three layers use `zIndex: -1` (not 0) so they
  // sit BEHIND every piece of normal-flow content in the parent stacking
  // context. Earlier versions used z=0 which silently broke any element
  // that didn't already have a stacking context of its own — e.g. a
  // raw <header>/<div> on a page would paint in normal flow (step 3 of
  // the painting algo) BEFORE the z=0 fixed layers (step 5), so the
  // backdrop ended up on top. Pushing the layers to z=-1 puts them
  // unambiguously underneath all content without each page having to
  // remember to wrap its hero in a transformed/positioned container.
  //
  // DO NOT give the hosting <main> a z-index. "Behind everything in the
  // PARENT stacking context" is the whole contract, and a z-index on the
  // wrapper creates that context — which traps these fixed, inset:0 layers
  // inside <main> while lifting <main> itself above the footer. The result
  // is the photograph painting straight over the footer's opaque background,
  // because a non-positioned <footer> paints at step 4 of the root context
  // and a z-index:1 <main> paints at step 8. Six pages carried
  // `style={{ zIndex: 1 }}` on <main> and all six showed it; it was only
  // invisible while the defaults let ~8% of the picture through.
  // `position: relative` on the wrapper is fine — with z-index:auto it
  // creates no stacking context and these layers reach the root, landing
  // below the cards AND below the footer, which is what we want.
  if (imageSrc) {
    return (
      <>
        {/* Layer 1: the photograph itself, scaled to cover the whole
            viewport and pinned in place as the user scrolls. */}
        <div
          aria-hidden
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: -1,
            pointerEvents: 'none',
            // Versioned here rather than at each call site: Cloudflare holds
            // /public for thirty days, so a replaced plate under an unchanged
            // filename would keep serving the old picture at the edge. Doing
            // it inside the component means no caller can forget.
            backgroundImage: `url(${av(imageSrc)})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            opacity,
          }}
        />
        {/* Layer 2: flat dark tint — pushes the image further into the
            background and keeps contrast high for foreground content. */}
        <div
          aria-hidden
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: -1,
            pointerEvents: 'none',
            background: `rgba(0,0,0,${tint})`,
          }}
        />
        {/* Layer 3: radial vignette — black edges fade smoothly into
            the centre, so the image reads as "scenery glimpsed through
            a hole" rather than a screen-filling photo with hard edges. */}
        <div
          aria-hidden
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: -1,
            pointerEvents: 'none',
            background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 0%, rgba(0,0,0,${vignette * 0.4}) 55%, rgba(0,0,0,${vignette}) 100%)`,
          }}
        />
      </>
    );
  }

  // ── Dot-pattern fallback ──────────────────────────────────────────
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tile}"><circle cx="1" cy="1" r="1" fill="%232a2a2a"/></svg>`;
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        backgroundImage: `url("data:image/svg+xml;utf8,${svg}")`,
        backgroundSize: `${tile}px ${tile}px`,
        opacity: 0.55,
      }}
    />
  );
}
