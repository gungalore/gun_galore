'use client';

// Shared GSAP setup. Lives in one place so the whole app moves at the
// same tempo and uses the same eases — premium feel comes from
// consistency, not from any one fancy tween.

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';

// Default tween config — used by every helper below. Override per-call
// only when you have a reason.
export const ANIM = {
  // Mid-fast: long enough for the eye to track, short enough that the UI
  // never feels like it's waiting on itself.
  duration: 0.32,
  // Smooth deceleration — standard "feels right" curve for UI.
  ease: 'power2.out',
  // For springs (pill clicks, badge pops) we use a slight overshoot.
  bounceEase: 'back.out(1.6)',
  // Stagger between siblings on a list entrance.
  stagger: 0.06,
} as const;

// Configure global GSAP defaults exactly once. Safe to import this side
// effect from anywhere — gsap.defaults is idempotent.
if (typeof window !== 'undefined') {
  gsap.defaults({
    duration: ANIM.duration,
    ease: ANIM.ease,
  });
}

// Fade + lift in. Use on mount for cards, sections, and modal contents.
// `delay` is multiplied by the stagger to make manual lists feel natural.
export function useFadeIn<T extends HTMLElement>(
  delay = 0,
  options?: { y?: number; duration?: number; ease?: string },
) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const tween = gsap.fromTo(
      el,
      { autoAlpha: 0, y: options?.y ?? 12 },
      {
        autoAlpha: 1,
        y: 0,
        duration: options?.duration ?? ANIM.duration,
        ease: options?.ease ?? ANIM.ease,
        delay,
      },
    );
    return () => {
      tween.kill();
    };
  }, [delay, options?.y, options?.duration, options?.ease]);
  return ref;
}

// Animate the children of a container with a small stagger. Pass a
// selector (defaults to direct children).
export function useStagger<T extends HTMLElement>(
  selector = '> *',
  options?: { y?: number; stagger?: number; delay?: number },
) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const targets = el.querySelectorAll(selector);
    if (targets.length === 0) return;
    const tween = gsap.fromTo(
      targets,
      { autoAlpha: 0, y: options?.y ?? 14 },
      {
        autoAlpha: 1,
        y: 0,
        stagger: options?.stagger ?? ANIM.stagger,
        delay: options?.delay ?? 0,
      },
    );
    return () => {
      tween.kill();
    };
  }, [selector, options?.y, options?.stagger, options?.delay]);
  return ref;
}

// Smooth height open/close — replaces the awful `max-height` CSS trick.
// Reads the natural height at tween start, animates to/from 0, then
// clears the inline height so the element stays responsive.
//
// `duration` overrides the global default. The StepAccordion uses a
// noticeably slower value (~0.6s) so the step transitions feel
// deliberate and the seller can track where their eye should go next.
export function animateOpen(el: HTMLElement, duration: number = ANIM.duration) {
  gsap.killTweensOf(el);
  // Set explicit auto so we get a measurable height even from display:none.
  el.style.overflow = 'hidden';
  el.style.height = 'auto';
  const target = el.offsetHeight;
  gsap.fromTo(
    el,
    { height: 0, autoAlpha: 0 },
    {
      height: target,
      autoAlpha: 1,
      duration,
      // Slightly softer curve at the long duration — power3 has a
      // gentler tail than power2 and looks better when it's not over
      // in a flash.
      ease: 'power3.out',
      onComplete: () => {
        el.style.height = '';
        el.style.overflow = '';
      },
    },
  );
}

export function animateClose(el: HTMLElement, duration: number = ANIM.duration) {
  gsap.killTweensOf(el);
  el.style.overflow = 'hidden';
  el.style.height = `${el.offsetHeight}px`;
  gsap.to(el, {
    height: 0,
    autoAlpha: 0,
    duration,
    ease: 'power3.inOut',
  });
}

// Tiny scale pop — use on badges or icons when they go "complete".
export function popIn(el: Element | null) {
  if (!el) return;
  gsap.fromTo(
    el,
    { scale: 0.6, autoAlpha: 0 },
    {
      scale: 1,
      autoAlpha: 1,
      duration: 0.4,
      ease: ANIM.bounceEase,
    },
  );
}

// Micro-bounce on click — used by pills and buttons for tactile feedback.
export function clickPulse(el: Element | null) {
  if (!el) return;
  gsap.fromTo(
    el,
    { scale: 0.92 },
    {
      scale: 1,
      duration: 0.35,
      ease: ANIM.bounceEase,
      overwrite: true,
    },
  );
}

// Modal entrance — fade + scale up from the centre.
export function modalIn(panel: HTMLElement, overlay: HTMLElement) {
  const tl = gsap.timeline();
  tl.fromTo(
    overlay,
    { autoAlpha: 0 },
    { autoAlpha: 1, duration: 0.22, ease: 'power1.out' },
  );
  tl.fromTo(
    panel,
    { autoAlpha: 0, scale: 0.96, y: 20 },
    {
      autoAlpha: 1,
      scale: 1,
      y: 0,
      duration: 0.36,
      ease: 'power3.out',
    },
    '-=0.12',
  );
  return tl;
}
