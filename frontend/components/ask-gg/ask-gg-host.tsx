'use client';

import { useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useStandalone } from '@/lib/use-standalone';
import { useAskGgWidget } from '@/lib/use-ask-gg-widget';
import { AskGgLauncher } from './ask-gg-launcher';

// Ask GG Everywhere — the always-mounted site-wide host.
//
// Mounted once in app/layout.tsx. Responsibilities:
//   1. Suppression gate — no launcher/panel on focused or self-owned
//      surfaces (admin, checkout, the /ask-gg page itself, auth, etc.).
//   2. The FAB launcher in BROWSER modes (standalone PWA keeps its
//      bottom-tab entry — wired to open this panel in W4).
//   3. Lazy panel: the chat chunk (react-markdown et al.) downloads on
//      FIRST open only (`armed`), then stays mounted so the
//      conversation survives close/reopen. First next/dynamic in the
//      repo — deliberate; keeps the always-loaded cost of Ask GG
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
  // future "Ask GG about this" CTAs. detail.prefill stages a question
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
      {/* FAB — browser modes only; standalone PWA enters via the tab (W6). */}
      {!standalone && (
        <AskGgLauncher panelArmed={armed} onOpen={openWith} />
      )}
      {/* Panel chunk downloads on first open, stays mounted after. */}
      {armed && <AskGgPanelLazy />}
    </>
  );
}
