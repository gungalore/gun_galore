/**
 * THE DESK — the shell every Desk route renders inside.
 *
 * Three jobs, and it should never grow a fourth:
 *
 *  1. `data-desk` — the attribute the entire token set is scoped under. It
 *     lives here rather than on <html> because the storefront and the admin
 *     share one document root, and a Desk token loose on :root would repaint
 *     the shop.
 *  2. The two Geist variables, so --font-geist and --font-geist-mono resolve
 *     inside the subtree. Same reason: the shop keeps Archivo and Public Sans.
 *  3. tokens.css, imported once here rather than per component.
 *
 * ⚠️ NO TRANSFORM ON THIS ELEMENT OR ANY WRAPPER ABOVE IT — not a scale, not
 * a translate, not a will-change that promotes it. A transformed ancestor
 * becomes the containing block for `position: fixed`, which would silently
 * re-anchor the drawer, both dialogs and the search palette to this div
 * instead of the viewport. The symptom is a drawer that scrolls with the
 * page, and it has cost this repo two afternoons already.
 */
import * as React from 'react';
import { fontDesk, fontDeskMono } from '../../fonts';
import '../../../components/desk/tokens.css';
import { RequireDeskSession } from '../../../components/desk/require-desk-session';

export default function DeskLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-desk=""
      className={`${fontDesk.variable} ${fontDeskMono.variable}`}
      style={{ minHeight: '100vh' }}
    >
      {/* ⚠️ GATED, AND IT WAS NOT. `/admin(.*)` is public in middleware.ts
          because the admin runs its own JWT, so nothing upstream turns a
          signed-out visitor away — and this layout was the desk layout minus
          this line. The gallery renders every component in every state, so an
          ungated copy published the Desk's entire visual vocabulary and
          confirmed the surface exists, to anyone who guessed the path.
          scripts/desk-guard.cjs now asserts this import stays. */}
      <RequireDeskSession>{children}</RequireDeskSession>
    </div>
  );
}
