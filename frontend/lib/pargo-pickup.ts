// Pargo counter presentation.
//
// Bob Go returns the counter's service name in its own vocabulary — e.g.
// "Pargo Click & Collect – Clicks – Pinehurst". "Click & Collect" is Bob Go's
// product name, not ours: the buyer-facing option is a Pargo store pickup, so
// the label names the store instead. Kept in a plain module (not a client
// component) so the single checkout and the cart picker share ONE parser and
// can't drift.

/** The store part of a Bob Go Pargo service name, without the carrier words. */
export function pargoStoreName(serviceName?: string | null): string {
  let name = (serviceName ?? '').trim();
  if (!name) return '';
  name = name.replace(/\bclick\s*(?:&|and)\s*collect\b/gi, ' ');
  name = name.replace(/\bpickup point\b/gi, ' ');
  name = name.replace(/^\s*pargo\b\s*/i, '');
  name = name.replace(/\s*\(approx\.?\s*[^)]*\)\s*$/i, ' ');
  name = name.replace(/\s*[–—]\s*/g, ' – ');
  name = name.replace(/\s+-\s+/g, ' – ');
  name = name.replace(/^-\s+/, ' ');
  name = name.replace(/^\s*–\s*|\s*–\s*$/g, ' ');
  return name.replace(/\s{2,}/g, ' ').trim();
}

/** "Pargo – Clicks – Pinehurst"; falls back to a plain carrier label. */
export function pargoOptionLabel(serviceName?: string | null): string {
  const store = pargoStoreName(serviceName);
  return store ? `Pargo – ${store}` : 'Pargo pickup point';
}

/** "0.6 km away", or null when the quote carried no distance. */
export function pargoDistanceLabel(km?: number | null): string | null {
  if (km == null || !Number.isFinite(km)) return null;
  if (km < 0.1) return 'Less than 100 m away';
  return `${km.toFixed(1)} km away`;
}
