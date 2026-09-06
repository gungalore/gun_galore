// ────────────────────────────────────────────────────────────────────
// THE QR GLYPH, ONCE.
//
// It was drawn identically — same viewBox, same six shapes, same 1.7 stroke —
// in components/licence-pack/capture-cards.tsx and capture-routes.tsx, on two
// screens that sit one click apart and are meant to read as the same product.
// Two copies of an icon are two icons the moment one of them is nudged.
//
// The default size is 22, which is what both call sites drew it at.
// ────────────────────────────────────────────────────────────────────

export default function QrIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3z" />
      <path d="M20 14v3" />
      <path d="M17 20h4" />
    </svg>
  );
}
