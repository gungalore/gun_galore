import { useEffect, useState } from 'react';

// GG site-guide (G2) — fetch the server-driven page guide (curated content +
// live public state). $0 AI: the endpoint is templates + a lean DB read. Works
// signed-out (public). Re-fetches when the page (path / listingId) changes.

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export interface GuideCta {
  label: string;
  href?: string;
  ask?: string;
}

export interface AskGgGuide {
  key: string;
  title: string;
  intro?: string;
  points: string[];
  ctas?: GuideCta[];
}

export function useGuide(
  path: string,
  listingId?: string,
  enabled = true,
): { guide: AskGgGuide | null; loading: boolean } {
  const [guide, setGuide] = useState<AskGgGuide | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams({ path: path || '/' });
    if (listingId) qs.set('listingId', listingId);
    fetch(`${API_URL}/ask-gg/public/guide?${qs.toString()}`)
      .then((r) => (r.ok ? (r.json() as Promise<AskGgGuide>) : null))
      .then((g) => {
        if (!cancelled) setGuide(g);
      })
      .catch(() => {
        if (!cancelled) setGuide(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, listingId, enabled]);

  return { guide, loading };
}
