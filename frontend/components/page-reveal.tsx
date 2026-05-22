'use client';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

// useLayoutEffect runs synchronously after DOM mutations but before
// paint — perfect for installing animation CSS before the browser
// paints the elements that use it. On the server it's a no-op, so we
// fall back to useEffect there to avoid the SSR warning.
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// Drop-in wrapper that fades its `data-reveal` descendants in over
// ~2.5s using a scoped CSS keyframe animation. No GSAP, no useEffect
// for the animation itself — pure CSS so it survives React 18
// StrictMode + RSC hydration without the "tween got killed mid-flight"
// failure modes the JS-driven version kept hitting.
//
// IMPORTANT: the CSS lives in a <style> tag that we attach to
// document.head from a useEffect. Earlier this CSS was rendered inline
// as <style>{...}</style> inside the component's JSX, which made React
// remount the tag during StrictMode's setup → cleanup → setup cycle.
// Each remount briefly removed the @keyframes rule; any data-reveal
// element whose animation had already started saw its keyframe-name
// dangle for one frame and got stuck at the 0% state forever. Putting
// the CSS in document.head once per page-load keeps it alive across
// every re-render.

export type PageRevealVariant =
  | 'slide-up'    // y: 20px → 0, opacity 0 → 1
  | 'scale-in'    // scale: 0.92 → 1, opacity 0 → 1
  | 'slide-right' // x: -28px → 0, opacity 0 → 1
  | 'blur-in'     // filter blur(8px) → 0, opacity 0 → 1
  | 'random';     // picks one of the four real variants on mount

interface Props {
  children: ReactNode;
  /** Gap between staggered items (default 0.18). Variant + stagger
   *  are the only knobs left; delay + duration are LOCKED to the
   *  house standard (0.5 + 1.0) so the cadence is identical on
   *  every page. */
  stagger?: number;
  /** Optional className applied to the wrapper div. */
  className?: string;
  /** Which keyframe to use. Default `random` — picks one of the four
   *  real variants per page-load so the seller doesn't see the same
   *  reveal every time they visit. */
  variant?: PageRevealVariant;
}

// House standard reveal cadence — LOCKED. Every page on Gun Galore
// uses these values. Earlier we let pages override delay and duration
// via props; the result was visibly inconsistent animations (homepage
// + competitions delayed 2s, everywhere else 0.5s) which felt
// broken. The props are gone; these constants are the source of truth.
const REVEAL_DELAY_SECONDS = 0.5;
const REVEAL_DURATION_SECONDS = 1.0;

const REAL_VARIANTS: Exclude<PageRevealVariant, 'random'>[] = [
  'slide-up',
  'scale-in',
  'slide-right',
  'blur-in',
];

const VARIANTS: Record<
  Exclude<PageRevealVariant, 'random'>,
  { keyframeName: string; from: string; keyframe: string }
> = {
  'slide-up': {
    keyframeName: 'pgRevealSlideUp',
    from: 'opacity: 0; transform: translateY(20px);',
    keyframe: `
      @keyframes pgRevealSlideUp {
        0%   { opacity: 0; transform: translateY(20px); }
        100% { opacity: 1; transform: translateY(0); }
      }`,
  },
  'scale-in': {
    keyframeName: 'pgRevealScaleIn',
    from: 'opacity: 0; transform: scale(0.92);',
    keyframe: `
      @keyframes pgRevealScaleIn {
        0%   { opacity: 0; transform: scale(0.92); }
        100% { opacity: 1; transform: scale(1); }
      }`,
  },
  'slide-right': {
    keyframeName: 'pgRevealSlideRight',
    from: 'opacity: 0; transform: translateX(-28px);',
    keyframe: `
      @keyframes pgRevealSlideRight {
        0%   { opacity: 0; transform: translateX(-28px); }
        100% { opacity: 1; transform: translateX(0); }
      }`,
  },
  'blur-in': {
    keyframeName: 'pgRevealBlurIn',
    from: 'opacity: 0; filter: blur(8px);',
    keyframe: `
      @keyframes pgRevealBlurIn {
        0%   { opacity: 0; filter: blur(8px); }
        100% { opacity: 1; filter: blur(0); }
      }`,
  },
};

// Module-level cache — once we've installed a CSS rule block into the
// document head, never re-install. Multiple PageReveal instances on
// the same page-load share these.
const INSTALLED_KEYFRAMES = new Set<string>();

// Install the @keyframes for every variant ONCE at module load. Doing
// it here (synchronously, before any component renders) avoids the
// timing trap where a useEffect installs the keyframes AFTER the
// `animation` property has already been applied to an element — once
// CSS resolves `animation-name` against a missing keyframe set, the
// animation is dead even if the keyframes are added later.
if (typeof document !== 'undefined' && !INSTALLED_KEYFRAMES.has('__keyframes')) {
  const styleEl = document.createElement('style');
  styleEl.id = 'page-reveal-keyframes';
  styleEl.dataset.pageReveal = 'keyframes';
  styleEl.textContent = REAL_VARIANTS.map((v) => VARIANTS[v].keyframe).join(
    '\n',
  );
  document.head.appendChild(styleEl);
  INSTALLED_KEYFRAMES.add('__keyframes');
}

export function PageReveal({
  children,
  stagger = 0.18,
  className,
  variant = 'random',
}: Props) {
  // Locked timing — both come from module-level constants so a
  // careless prop can't drift the cadence on a single page.
  const delay = REVEAL_DELAY_SECONDS;
  const duration = REVEAL_DURATION_SECONDS;
  // Resolve `random` to a concrete variant ONCE per mount. useState's
  // lazy initialiser runs on first render and persists across StrictMode.
  const [resolvedVariant] = useState<Exclude<PageRevealVariant, 'random'>>(
    () => {
      if (variant === 'random') {
        return REAL_VARIANTS[Math.floor(Math.random() * REAL_VARIANTS.length)];
      }
      return variant;
    },
  );

  // Per-instance CSS goes to document.head via useLayoutEffect so the
  // rules are in place BEFORE the browser paints the data-reveal
  // elements for the first time. Putting the <style> in JSX produces
  // a brief flicker / animation-restart whenever React reconciles the
  // tree — moving it to head means React can never touch it.
  //
  // We scope the per-instance CSS using a unique attribute selector
  // (`[data-page-reveal="<id>"] [data-reveal]`) so two PageReveal
  // mounts on the same page with different props don't collide.
  const scopeId = useId();
  const css = useMemo(() => {
    const v = VARIANTS[resolvedVariant];
    const scope = `[data-page-reveal="${scopeId}"]`;
    const delays = Array.from({ length: 8 })
      .map(
        (_, i) =>
          `${scope} [data-reveal]:nth-of-type(${i + 1}) { animation-delay: ${delay + i * stagger}s; }`,
      )
      .join('\n');
    return `
      ${scope} [data-reveal] {
        ${v.from}
        animation: ${v.keyframeName} ${duration}s cubic-bezier(0.22, 1, 0.36, 1) both;
      }
      ${delays}
    `;
  }, [resolvedVariant, delay, duration, stagger, scopeId]);

  useIsomorphicLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    const id = `page-reveal-${scopeId}`;
    let styleEl = document.getElementById(id) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = id;
      styleEl.dataset.pageRevealInstance = 'true';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = css;
    return () => {
      // Leave it in document.head — same reason as the keyframes block:
      // if React strict-mode unmounts then remounts us, removing the
      // style would break in-flight animations. Tiny memory cost.
    };
  }, [css, scopeId]);

  return (
    <div className={className} data-page-reveal={scopeId}>
      {children}
    </div>
  );
}
