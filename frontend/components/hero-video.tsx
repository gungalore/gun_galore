'use client';

// The homepage hero's motion plate.
//
// WHY THIS IS A CLIENT COMPONENT AND THE REST OF THE HERO IS NOT
//
// The hero is a server component on purpose (no JS on the landing page). This
// is the one piece that cannot be: the loop has to fade in and out so the cut
// back to the first frame is not visible, and that fade is driven off the
// video's own currentTime. Everything else about the hero — copy, CTA, the
// poster plate — stays server-rendered.
//
// ⚠️ THE POSTER IS THE FALLBACK, NOT A PLACEHOLDER.
//
// .hero-bg (in hero.tsx) sits UNDER this element and carries the same still.
// The video starts at opacity 0 and is only raised once it is actually
// playing, so every failure mode — no JS, autoplay blocked (iOS Low Power
// Mode), reduced motion, data saver, a decode error — lands on the still
// instead of a black rectangle.
//
// ⚠️ THE CLIP IS ALREADY SLOWED TO 0.75x IN THE FILE.
//
// public/hero-video.mp4 is transcoded with `setpts=1.333333*PTS`, so its
// timeline is 13.3s for the original 10s. playbackRate is pinned to 0.75 below
// anyway as a belt-and-braces measure (a swapped file must not suddenly run at
// full speed), but the file itself is the source of truth: Safari and some
// Android browsers ignore playbackRate on looping muted video.

import { useEffect, useRef, useState } from 'react';
import { av } from '@/lib/asset-version';

/** Seconds of fade at the head of the clip. */
export const HERO_VIDEO_FADE_IN_S = 1.4;
/** Seconds of fade at the tail of the clip, before the loop restarts. */
export const HERO_VIDEO_FADE_OUT_S = 1.6;

/**
 * Opacity for a given playhead position, 0..1.
 *
 * Split out and exported so it can be tested without a video element. The
 * window is deliberately generous — a hard cut from the opening scene to the
 * last one is the thing this exists to hide — but never more than a quarter of
 * the clip, so a short replacement file still has a visible middle.
 */
export function heroVideoOpacity(time: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (time <= 0) return 0;

  const fadeIn = Math.min(HERO_VIDEO_FADE_IN_S, duration / 4);
  const fadeOut = Math.min(HERO_VIDEO_FADE_OUT_S, duration / 4);
  const outStart = duration - fadeOut;

  if (time < fadeIn) return time / fadeIn;
  if (time > outStart) return Math.max(0, (duration - time) / fadeOut);
  return 1;
}

function shouldPlay(): boolean {
  if (typeof window === 'undefined') return false;
  // The hero is desktop-only (hero.tsx hides it under 768px), so phones must
  // never fetch a 2.6 MB video they cannot show.
  if (!window.matchMedia('(min-width: 768px)').matches) return false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return false;
  return true;
}

export function HeroVideo() {
  const [enabled, setEnabled] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);
  const rafRef = useRef(0);

  // Mount the element only where it can actually be seen, so phones and
  // reduced-motion visitors download nothing. Re-evaluated on resize and on a
  // settings change rather than read once at mount.
  useEffect(() => {
    const width = window.matchMedia('(min-width: 768px)');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setEnabled(shouldPlay());
    update();
    width.addEventListener('change', update);
    reduce.addEventListener('change', update);
    return () => {
      width.removeEventListener('change', update);
      reduce.removeEventListener('change', update);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const video = ref.current;
    if (!video) return;
    video.playbackRate = 0.75;
    void video.play().catch(() => undefined);
  }, [enabled]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // Opacity is written straight to the element rather than held in React
  // state: this runs once per animation frame, and a setState per frame would
  // re-render the hero sixty times a second for a single number.
  //
  // ⚠️ TWO DRIVERS, ON PURPOSE. requestAnimationFrame is the smooth one, but
  // rAF stops in a backgrounded tab and is throttled in some embedded
  // webviews — and a stopped frame leaves whatever opacity was last painted
  // frozen on screen. timeupdate (about 4 Hz) keeps the value following the
  // playhead even then, so the worst case is a coarser fade, never a video
  // stuck at half transparency.
  const apply = (video: HTMLVideoElement) => {
    video.style.opacity = heroVideoOpacity(video.currentTime, video.duration).toFixed(3);
  };

  const startFade = (video: HTMLVideoElement) => {
    cancelAnimationFrame(rafRef.current);
    const tick = () => {
      apply(video);
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  };

  if (!enabled) return null;

  return (
    <video
      ref={ref}
      className="hero-video absolute inset-0 h-full w-full"
      style={{ opacity: 0 }}
      aria-hidden
      muted
      loop
      autoPlay
      playsInline
      preload="auto"
      disablePictureInPicture
      tabIndex={-1}
      poster={av('/hero-outdoor.webp')}
      onPlaying={(e) => startFade(e.currentTarget)}
      onTimeUpdate={(e) => apply(e.currentTarget)}
    >
      <source src={av('/hero-video.mp4')} type="video/mp4" />
    </video>
  );
}
