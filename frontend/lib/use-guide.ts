import { useEffect, useRef, useState } from 'react';

// GG site-guide (G2/G3/G4) — fetch the server-driven page guide (curated
// content + live state). $0 AI: the endpoint is templates + a lean DB read.
//
// Signed-out → the PUBLIC guide (no auth). Signed-in → the AUTHED guide, which
// adds a `personal` overlay of the user's OWN top-of-mind state for this page
// (KYC/payout gates, auction win/outbid, offers awaiting action…), composed
// server-side from the PII-gated account shapers. Either way ZERO Claude.
// On any authed-fetch hiccup we fall back to the public guide so a stale token
// never blanks the guide.

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export interface GuideCta {
  label: string;
  href?: string;
  ask?: string;
}

export type GuidePersonalTone = 'action' | 'info' | 'good';

export interface GuidePersonalItem {
  label: string;
  href?: string;
  tone?: GuidePersonalTone;
}

export interface GuidePersonal {
  headline: string;
  items: GuidePersonalItem[];
}

export interface AskGgGuide {
  key: string;
  title: string;
  intro?: string;
  points: string[];
  ctas?: GuideCta[];
  /** G4 — the authed personal overlay (present only when signed in and there
   *  is something worth surfacing). */
  personal?: GuidePersonal;
}

export function useGuide(
  path: string,
  listingId: string | undefined,
  enabled: boolean,
  auth?: { signedIn?: boolean; getToken?: () => Promise<string | null> },
): { guide: AskGgGuide | null; loading: boolean } {
  const [guide, setGuide] = useState<AskGgGuide | null>(null);
  const [loading, setLoading] = useState(false);

  // getToken's identity is stable across renders (Clerk memoizes it), but keep
  // it in a ref so the effect doesn't need it as a dependency.
  const signedIn = !!auth?.signedIn;
  const getTokenRef = useRef(auth?.getToken);
  getTokenRef.current = auth?.getToken;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);

    const qs = new URLSearchParams({ path: path || '/' });
    if (listingId) qs.set('listingId', listingId);

    const run = async () => {
      let g: AskGgGuide | null = null;

      // Signed in → try the authed guide (adds the personal overlay).
      const getToken = getTokenRef.current;
      if (signedIn && getToken) {
        try {
          const token = await getToken();
          if (token) {
            const r = await fetch(`${API_URL}/ask-gg/guide?${qs.toString()}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (r.ok) g = (await r.json()) as AskGgGuide;
          }
        } catch {
          /* fall through to the public guide */
        }
      }

      // Fallback (or signed-out) → the public guide.
      if (!g) {
        try {
          const r = await fetch(
            `${API_URL}/ask-gg/public/guide?${qs.toString()}`,
          );
          if (r.ok) g = (await r.json()) as AskGgGuide;
        } catch {
          g = null;
        }
      }

      if (!cancelled) {
        setGuide(g);
        setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [path, listingId, enabled, signedIn]);

  return { guide, loading };
}
