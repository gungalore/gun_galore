'use client';

import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useFocusTrap } from '@/lib/use-focus-trap';
import { Pill, type AdminTone } from '@/components/admin/admin-ui';

/**
 * The panel's one detail surface.
 *
 * ⚠️ IT RENDERS NOTHING WHILE CLOSED. An earlier version stayed mounted and
 * translated itself below the viewport so the exit animation could play —
 * which left a fully-rendered, off-screen window on every board that owned
 * one. The operator found them in the DOM. Mount-on-open plus a CSS keyframe
 * gives the same spring entrance with no leftovers; `AdminDrawer` closing is
 * instant, and that is the right trade.
 *
 * ⚠️ DRAG-TO-DISMISS IS POINTER EVENTS, NOT touchstart/mousedown. Pointer
 * events cover finger, stylus, trackpad and mouse in one path, so the phone
 * gesture the operator uses in the field and the drag they use on a laptop
 * cannot drift apart. `touch-action: none` on the handle is what stops the
 * browser claiming the gesture as a scroll before the first move arrives.
 */
export function AdminDrawer({
  open,
  onClose,
  title,
  subtitle,
  badge,
  badgeTone = 'muted',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  badgeTone?: AdminTone;
  children: ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const trapRef = useFocusTrap<HTMLDivElement>({ active: open, onClose });
  const drag = useRef<{ startY: number; delta: number; active: boolean }>({
    startY: 0,
    delta: 0,
    active: false,
  });
  const [dragging, setDragging] = useState(false);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    drag.current = { startY: e.clientY, delta: 0, active: true };
    setDragging(true);
    // ⚠️ CAPTURE IS BEST-EFFORT. It can throw `InvalidPointerId` (a synthetic
    // event, an already-released pointer, an odd input device) and an
    // uncaught throw here would abandon the whole drag instead of just losing
    // the capture — the gesture still works because the handlers are on the
    // element, not on the window.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* drag still works without the capture */
    }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current.active) return;
    const delta = e.clientY - drag.current.startY;
    drag.current.delta = delta;
    if (delta <= 0) return;
    sheetRef.current?.style.setProperty('transform', `translateY(${delta}px)`);
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current.active) return;
    drag.current.active = false;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* the capture is already gone */
    }
    const delta = drag.current.delta;
    sheetRef.current?.style.removeProperty('transform');
    if (delta > 110) onClose();
  }

  // ⚠️ NOTHING IS RENDERED WHEN CLOSED — no off-screen window, no inert
  // attribute to remember. The early return is the whole mechanism.
  if (!open) return null;

  return (
    <div
      className="adm-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={(node) => {
          sheetRef.current = node;
          trapRef.current = node;
        }}
        className="adm-sheet"
        data-dragging={dragging}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Detail'}
      >
        {/* The grab surface: the pill AND the title row. See `.adm-grab`. */}
        <div
          className="adm-grab"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="adm-handle" aria-hidden="true" />
          <header className="adm-card-head">
            <div style={{ minWidth: 0 }}>
              <div className="adm-card-title">{title}</div>
              {subtitle ? <div className="adm-sub">{subtitle}</div> : null}
            </div>
            {badge ? <Pill tone={badgeTone}>{badge}</Pill> : null}
          </header>
        </div>
        {children}
      </div>
    </div>
  );
}
