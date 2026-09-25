'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

// Fully-verified sellers get a pulsing green glow around their avatar on the
// listing detail page. Holding the pointer still over the avatar or the glow
// for 0.75s pops a small "Seller fully verified" note next to the cursor.
// The glow is a full circle touching the avatar edge: 70% at the inner edge,
// fading to 10% at the 7px outer edge.

const DWELL_MS = 750;
const TIP_W = 160;

export function SellerVerificationRing({
  verification,
  children,
}: {
  verification?:
    | {
        phoneVerified: boolean;
        emailVerified: boolean;
        idVerified: boolean;
      }
    | null;
  children: ReactNode;
}) {
  const verified =
    !!verification &&
    verification.phoneVerified &&
    verification.emailVerified &&
    verification.idVerified;

  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setMounted(true), []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLSpanElement>) => {
      const x = e.clientX;
      const y = e.clientY;
      clearTimer();
      setTip(null);
      timerRef.current = setTimeout(() => {
        const pad = 8;
        setTip({
          x: Math.max(pad, Math.min(x + 14, window.innerWidth - TIP_W - pad)),
          y: Math.max(pad, Math.min(y + 14, window.innerHeight - 40)),
        });
      }, DWELL_MS);
    },
    [clearTimer],
  );

  const onPointerLeave = useCallback(() => {
    clearTimer();
    setTip(null);
  }, [clearTimer]);

  // Not fully verified — the avatar renders on its own (no ring, no tooltip).
  if (!verified) return <>{children}</>;

  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      aria-label="Fully verified seller"
    >
      <span aria-hidden className="gg-verify-glow ao-verify-pulse" />
      <span style={{ position: 'relative', zIndex: 1, display: 'inline-flex' }}>
        {children}
      </span>
      {/* Portalled to <body>: PageReveal ancestors carry a transform, which
          would otherwise contain `position: fixed` and misplace the tip. */}
      {mounted &&
        tip &&
        createPortal(
          <span
            className="gg-verify-tip"
            role="tooltip"
            style={{ left: tip.x, top: tip.y }}
          >
            Seller fully verified
          </span>,
          document.body,
        )}
    </span>
  );
}
