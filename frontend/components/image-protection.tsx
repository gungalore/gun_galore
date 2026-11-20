'use client';

// ────────────────────────────────────────────────────────────────────
// IMAGE DETERRENT UI.
//
// This is friction, not security. A screenshot, a DevTools request or a
// direct Cloudinary URL still gets the pixels. What this stops is the
// casual path: right-click → Save image as, drag the image to the desktop,
// and the iOS/Android long-press callout.
//
// ⚠️ SCOPED TO IMAGES, NOT THE PAGE. A global `contextmenu` blocker breaks
// copy/paste, form controls and accessibility. The listener checks the event
// target and only acts when it lands on an image (or a <picture> wrapper).
// Normal text selection, links and card clicks are untouched.
//
// The matching CSS lives in globals.css: -webkit-user-drag, user-select and
// -webkit-touch-callout. Both layers are needed: the CSS stops the native
// drag/callout, the listeners stop the menu and selection on browsers that
// ignore it.
// ────────────────────────────────────────────────────────────────────

import { useEffect } from 'react';

const IMAGE_TARGET = 'img, picture, [data-protect-image]';

function isImageTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(IMAGE_TARGET));
}

export function ImageProtection() {
  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (isImageTarget(event.target)) event.preventDefault();
    };
    const onDragStart = (event: DragEvent) => {
      if (isImageTarget(event.target)) event.preventDefault();
    };
    const onSelectStart = (event: Event) => {
      if (isImageTarget(event.target)) event.preventDefault();
    };

    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('dragstart', onDragStart);
    document.addEventListener('selectstart', onSelectStart);
    return () => {
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('dragstart', onDragStart);
      document.removeEventListener('selectstart', onSelectStart);
    };
  }, []);

  return null;
}
