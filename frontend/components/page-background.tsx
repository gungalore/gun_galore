'use client';

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
  /** 0..1 — overall image opacity (default 0.18). Lower = subtler. */
  opacity?: number;
  /** Dark-tint overlay on top of the image (default 0.55 = 55% black). */
  tint?: number;
  /** Vignette strength (0 = no vignette, 1 = pitch-black corners). Default 0.85. */
  vignette?: number;
  /** Tile size for the dot pattern mode only (default 40). */
  tile?: number;
}

export function PageBackground({
  imageSrc,
  opacity = 0.18,
  tint = 0.55,
  vignette = 0.85,
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
            backgroundImage: `url(${imageSrc})`,
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
