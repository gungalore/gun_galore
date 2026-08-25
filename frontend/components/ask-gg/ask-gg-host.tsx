'use client';

import { useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useStandalone } from '@/lib/use-standalone';
import { useAskGgWidget } from '@/lib/use-ask-gg-widget';
import { AskGgLauncher } from './ask-gg-launcher';
import { isChromelessRoute } from '@/lib/chromeless-routes';

// Ask Boet Everywhere — the always-mounted site-wide host.
//
// Mounted once in app/layout.tsx. Responsibilities:
//   1. Suppression gate — no launcher/panel on focused or self-owned
//      surfaces (admin, checkout, the /ask-gg page itself, auth, etc.).
//   2. The FAB launcher in BROWSER modes (standalone PWA keeps its
//      bottom-tab entry — wired to open this panel in W4).
//   3. Lazy panel: the chat chunk (react-markdown et al.) downloads on
//      FIRST open only (`armed`), then stays mounted so the
//      conversation survives close/reopen. First next/dynamic in the
//      repo — deliberate; keeps the always-loaded cost of Ask Boet
//      Everywhere at a few KB.
//   4. `gg:ask-gg-open` CustomEvent — any chrome (PWA tab in W4, future
//      page CTAs) can open the panel without importing ask-gg code.
//
// Bundle rule: this file + launcher may import only react,
// next/navigation, next/dynamic, the widget context, useStandalone and
// './icons'. Nothing from the panel tree.

const AskGgPanelLazy = dynamic(() => import('./ask-gg-panel'), {
  ssr: false,
  // No loading state — the panel animates in when ready; a spinner would
  // flash for the few hundred ms the chunk takes on first open.
  loading: () => null,
});

// Focused/self-owned routes where the assistant must not float.
const SUPPRESS_PREFIXES = [
  '/admin',
  '/checkout',
  '/ask-gg',
  '/offline',
  '/coming-soon',
  '/sign-in',
  '/sign-up',
  '/sso-callback',
  '/a/', // token-gated single-action pages
  '/kyc',
];

export function isSuppressed(pathname: string | null): boolean {
  if (!pathname) return false;
  // ⚠️ A CARTOON RANGER MUST NOT FLOAT BESIDE A STATUTORY STATEMENT — to a
  // stranger deciding whether an unfamiliar link is legitimate, a mascot
  // waving at them is evidence for the wrong answer.
  if (isChromelessRoute(pathname)) return true;
  return SUPPRESS_PREFIXES.some((p) =>
    p.endsWith('/')
      ? pathname.startsWith(p)
      : pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function AskGgHost() {
  const pathname = usePathname();
  const standalone = useStandalone();
  const { armed, openWith } = useAskGgWidget();

  const suppressed = useMemo(() => isSuppressed(pathname), [pathname]);

  // Open-on-event — decoupled entry point for the PWA tab (W6) and any
  // future "Ask Boet about this" CTAs. detail.prefill stages a question
  // in the composer (W5.5 nudge channel).
  useEffect(() => {
    function onOpen(e: Event) {
      if (isSuppressed(window.location.pathname)) return;
      const prefill = (e as CustomEvent<{ prefill?: string }>).detail?.prefill;
      openWith(typeof prefill === 'string' ? prefill : undefined);
    }
    window.addEventListener('gg:ask-gg-open', onOpen);
    return () => window.removeEventListener('gg:ask-gg-open', onOpen);
  }, [openWith]);

  if (suppressed) return null;

  return (
    <>
      {/* ⚠️ THE FAB IS NOW THE ONLY ENTRY, IN BOTH MODES.
          The installed app used to reach Ask Boet through a bottom tab, which
          cost it one of five slots in the primary navigation — and those five
          slots had no room for the CART, so an installed member could add
          items and then, on any route where the top bar is hidden, have no way
          back to them. A paid assistant does not outrank the basket.

          The launcher is not a demotion: as a floating control it is reachable
          from every shopping screen at once rather than from one tab in five,
          which is more presence per pixel, not less. It already knew how to sit
          in the installed app — DOCK_STACKING_CSS in the launcher lifts it
          clear of the tab bar under html[data-standalone] — it was simply
          never rendered there. */}
      <AskGgLauncher panelArmed={armed} onOpen={openWith} />
      {/* Panel chunk downloads on first open, stays mounted after. */}
      {armed && <AskGgPanelLazy />}
    </>
  );
}
