'use client';

/**
 * THE BENCH — the bench as a bottom sheet, for the phone.
 *
 * Ported from Pwa.dc.html's "My bench sheet". The body is BenchSections, the
 * same component the desktop rail renders: this file is a shell and a dialog,
 * nothing more. If a chip ever needs changing, it changes once, in BenchRail.
 *
 * ⚠️ TOGGLING A CHIP HERE SAVES NOTHING EITHER, AND THE × HERE REMOVES FOR
 * GOOD JUST AS IT DOES ON THE RAIL. Same two acts, same two controls, because
 * they are the same component: `onRemove` reaches BenchSections through the
 * rest spread below, exactly as `onToggle` does. Naming it out of the spread
 * to "make it explicit" is how the phone ends up one prop behind the desktop.
 *
 * ⚠️ THE DIALOG BEHAVIOUR IS OverlayShell's, NOT THIS FILE'S. Backdrop, the
 * bottom-sheet box, the grab handle, the entrance, Escape (top-most overlay
 * ONLY — §9, and the shared stack in primitives.tsx is the only thing that can
 * tell which overlay that is), the focus trap and the return of focus all live
 * there. Hand-rolling them here got the picker that opens ON TOP of this sheet
 * subtly different rules from the sheet underneath it, and a keydown handler
 * bound to this subtree went dead the moment a tap on the sheet's own padding
 * put focus back on <body>.
 */

import { useId } from 'react';
import type { BenchSheetProps } from './contract';
import { BENCH_HINT, BenchSections, SavedBadge } from './BenchRail';
import { Btn, IconX, OverlayShell } from './primitives';

export default function BenchSheet({ open, onClose, ...bench }: BenchSheetProps) {
  const uid = useId();
  const titleId = `${uid}-title`;

  // Mounting IS opening for OverlayShell, so the `open` flag contract.ts gives
  // this sheet is answered the way PowderPicker answers its own: render
  // nothing at all when closed.
  if (!open) return null;

  return (
    <OverlayShell variant="bottom-sheet" labelledBy={titleId} onClose={onClose}>
      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          padding: '4px 4px 4px 16px',
        }}
      >
        {/* OverlayShell puts focus here on open and adds the tabindex it needs
            to receive it, so the reader hears what opened rather than the
            first chip inside it. */}
        <h2 id={titleId} className="head" style={{ flex: 1, margin: 0, fontSize: 18 }}>
          My bench
        </h2>
        <SavedBadge style={{ marginRight: 8 }} />
        <IconX onClick={onClose} label="Close" size="mobile" />
      </div>

      {/* min-height:0 is load-bearing: without it the flex child refuses to
          shrink below its content and the sheet grows past OverlayShell's
          max-height instead of scrolling. */}
      <div className="scroll" style={{ flex: '1 1 auto', minHeight: 0, padding: '0 16px 28px' }}>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-tertiary)' }}>
          {BENCH_HINT}
        </p>

        {/* SPEC §9 tap targets: the phone's 40px chip, from the same primitive
            every other phone surface draws, rather than a breakpoint of this
            sheet's own that would raise the height and leave the padding and
            type at their desktop values. */}
        <BenchSections {...bench} size="mobile" />

        <Btn red size="mobile" style={{ width: '100%', marginTop: 16 }} onClick={onClose}>
          Show loads
        </Btn>
      </div>
    </OverlayShell>
  );
}
