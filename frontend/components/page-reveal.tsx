'use client';

import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';

// ─── PageReveal ────────────────────────────────────────────────────
//
// Drop-in wrapper that fades its direct `data-reveal` children in
// using a scoped CSS keyframe animation. Pure CSS — no useEffect,
// no IntersectionObserver, no JS animation library.
//
// The OLD implementation injected the `from`-state CSS into
// document.head from a useLayoutEffect. That left a race: the
// server-rendered HTML carried the `data-reveal` markers but no
// styles, so for one or two frames the browser painted children at
// full opacity. Then the CSS landed and tried to play 0% → 100%,
// either flickering OR (depending on browser repaint timing) just
// skipping the animation entirely. THAT was the "sometimes works,
// sometimes doesn't" symptom.
//
// This rewrite renders the scoped <style> INLINE inside the wrapper
// so it ships as part of the SSR'd HTML. There is no window between
// "element painted" and "rules in place" — the rules are in the same
// document fragment as the element. No race, no flicker, ever.
//
// House-standard cadence (LOCKED): 100 ms delay, 380 ms duration,
// 60 ms per-child stagger. Total settle time for an 8-child page
// is ~580 ms — modern app speed (Linear / Stripe / Vercel cadence).
//
// Stagger uses a CSS custom property (`--pr-i`) auto-assigned to
// each `data-reveal` child by index. The old nth-of-type approach
// capped at 8; this works for any count.
//
// `prefers-reduced-motion: reduce` users get the to-state instantly
// with no animation — WCAG 2.3.3 + good taste.

export type PageRevealVariant =
  | 'slide-up'      // y: 16px → 0
  | 'scale-in'      // scale: 0.96 → 1
  | 'slide-right'   // x: -20px → 0
  | 'blur-in';      // blur(6px) → 0

const DELAY_MS = 100;
const DURATION_MS = 380;
const STAGGER_MS = 60;

const VARIANTS: Record<PageRevealVariant, { from: string; to: string }> = {
  'slide-up': {
    from: 'opacity:0;transform:translateY(16px);',
    to: 'opacity:1;transform:translateY(0);',
  },
  'scale-in': {
    from: 'opacity:0;transform:scale(0.96);',
    to: 'opacity:1;transform:scale(1);',
  },
  'slide-right': {
    from: 'opacity:0;transform:translateX(-20px);',
    to: 'opacity:1;transform:translateX(0);',
  },
  'blur-in': {
    from: 'opacity:0;filter:blur(6px);',
    to: 'opacity:1;filter:blur(0);',
  },
};

interface Props {
  children: ReactNode;
  className?: string;
  /** Which keyframe to use. Default `slide-up` — the universal
   * choice. Callers that want a different feel per surface (homepage
   * landing, listing detail, etc.) can override. */
  variant?: PageRevealVariant;
}

// Stable per-mount scope class. We use useId() so server + client
// agree on the class string (no hydration mismatch warning). Sub
// the colons React uses internally with hyphens so the result is a
// valid CSS identifier.
function makeScope(rawId: string): string {
  return `pr-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
}

// Keyframes are global (one set covers every PageReveal instance on
// the page). Render them once via a stable module-level <style>
// stamp that we inline at the first render. They're tiny so the
// duplication-across-pages cost is negligible vs the simplicity win.
const KEYFRAMES_CSS = (Object.keys(VARIANTS) as PageRevealVariant[])
  .map(
    (v) =>
      `@keyframes pr-${v}{from{${VARIANTS[v].from}}to{${VARIANTS[v].to}}}`,
  )
  .join('');

export function PageReveal({
  children,
  className,
  variant = 'slide-up',
}: Props) {
  const rawId = useId();
  const scope = makeScope(rawId);
  const v = VARIANTS[variant];

  // Scope-local CSS. The `from`-state is the default (so SSR shows
  // the children at the start of the animation, not at full
  // opacity). Inside the no-preference media query we layer on the
  // actual animation — reduced-motion users keep the SSR-rendered
  // to-state via the `prefers-reduced-motion: reduce` branch.
  //
  // Note: the from-state must include the END properties too, or
  // browsers without animation support (very rare today) would paint
  // the from-state forever. We solve this by giving reduced-motion
  // users an explicit override that sets to-state.
  const css =
    `${KEYFRAMES_CSS}` +
    `.${scope}>[data-reveal]{${v.from}}` +
    `@media (prefers-reduced-motion: no-preference){` +
    `.${scope}>[data-reveal]{` +
    `animation:pr-${variant} ${DURATION_MS}ms cubic-bezier(0.22,1,0.36,1) both;` +
    `animation-delay:calc(${DELAY_MS}ms + (var(--pr-i,0) * ${STAGGER_MS}ms));` +
    `}` +
    `}` +
    `@media (prefers-reduced-motion: reduce){` +
    `.${scope}>[data-reveal]{${v.to}animation:none;}` +
    `}`;

  // Auto-stagger: walk direct children, find the ones with
  // `data-reveal`, and inject an incrementing `--pr-i` CSS variable
  // so the CSS calc() picks up the right delay. Children that
  // already specify their own `--pr-i` win. Non-element children
  // (text / fragments) pass through untouched.
  let revealIndex = 0;
  const enhanced = Children.map(children, (child) => {
    if (!isValidElement(child)) return child;
    const props = (child as ReactElement<{
      'data-reveal'?: boolean | string;
      style?: CSSProperties;
    }>).props;
    if (!props['data-reveal']) return child;
    const existing = (props.style ?? {}) as CSSProperties & Record<string, unknown>;
    if (existing['--pr-i'] !== undefined) return child;
    const idx = revealIndex++;
    // Cast — CSSProperties doesn't type custom CSS variables.
    const merged = { ...existing, ['--pr-i']: idx } as CSSProperties;
    return cloneElement(child as ReactElement<{ style?: CSSProperties }>, {
      style: merged,
    });
  });

  return (
    <div className={className ? `${scope} ${className}` : scope}>
      {/* Inline <style> ships with the SSR'd HTML. Browsers accept
          <style> inside <body> since HTML5 (this is the same trick
          framework CSS-in-JS libraries use). */}
      <style dangerouslySetInnerHTML={{ __html: css }} />
      {enhanced}
    </div>
  );
}
