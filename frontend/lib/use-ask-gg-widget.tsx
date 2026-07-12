'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import { useAskGg, type UseAskGg } from './use-ask-gg';

// ─── Ask GG Everywhere — shared conversation state ───────────────────
//
// ONE useAskGg() instance for the whole app, hosted by <AskGgProvider>
// in app/layout.tsx (WishlistProvider precedent). The /ask-gg page and
// the site-wide panel (W3) consume the SAME instance, so a conversation
// started in the panel continues seamlessly on the full page and
// survives client-side navigation.
//
// Two contexts on purpose:
//   - AskGgUiContext   (COLD): open/close/armed — the always-mounted
//     launcher subscribes here and must NOT re-render per SSE delta.
//   - AskGgChatContext (HOT): the full hook value — only the panel and
//     the /ask-gg page subscribe, so streaming re-renders stay scoped.
//
// Laziness: until the widget has been opened once ("armed") or the user
// is on /ask-gg, the hook runs with enabled:false — zero quota/history
// fetches on ordinary page loads site-wide.

interface AskGgUiValue {
  /** Panel visibility (W3 drives this; unused until the host mounts). */
  open: boolean;
  setOpen: (open: boolean) => void;
  /** True once the panel has ever been opened this session — flips the
   *  shared hook live and keeps the lazy panel mounted thereafter. */
  armed: boolean;
  arm: () => void;
  /** W5.5 — open the panel with an optional composer prefill (Sparkie's
   *  proactive nudges land here: the question is STAGED, never sent —
   *  the user always pulls the trigger). */
  openWith: (prefill?: string) => void;
  /** One-shot consume of the staged prefill (panel calls this on open). */
  takePrefill: () => string | null;
}

const AskGgUiContext = createContext<AskGgUiValue | null>(null);
const AskGgChatContext = createContext<UseAskGg | null>(null);

export function AskGgProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);

  const onAskGgPage = pathname === '/ask-gg' || pathname?.startsWith('/ask-gg/');
  const chat = useAskGg({ enabled: armed || onAskGgPage === true });

  const arm = useCallback(() => setArmed(true), []);

  // Staged composer prefill for openWith() — a ref (not state) so
  // setting it never re-renders the cold subscribers.
  const prefillRef = useRef<string | null>(null);
  const openWith = useCallback((prefill?: string) => {
    if (prefill) prefillRef.current = prefill;
    setArmed(true);
    setOpen(true);
  }, []);
  const takePrefill = useCallback(() => {
    const v = prefillRef.current;
    prefillRef.current = null;
    return v;
  }, []);

  // Cold value: stable identity except on open/armed flips.
  const uiValue = useMemo<AskGgUiValue>(
    () => ({ open, setOpen, armed, arm, openWith, takePrefill }),
    [open, armed, arm, openWith, takePrefill],
  );

  return (
    <AskGgUiContext.Provider value={uiValue}>
      <AskGgChatContext.Provider value={chat}>
        {children}
      </AskGgChatContext.Provider>
    </AskGgUiContext.Provider>
  );
}

/** COLD context — launcher/host controls. Safe for always-mounted chrome. */
export function useAskGgWidget(): AskGgUiValue {
  const v = useContext(AskGgUiContext);
  if (!v) {
    throw new Error('useAskGgWidget must be used inside <AskGgProvider>');
  }
  return v;
}

/** HOT context — the shared chat instance (panel + /ask-gg page only). */
export function useAskGgChat(): UseAskGg {
  const v = useContext(AskGgChatContext);
  if (!v) {
    throw new Error('useAskGgChat must be used inside <AskGgProvider>');
  }
  return v;
}
