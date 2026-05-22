'use client';

// Smart "back to listings" link — uses router.back() when the user
// arrived from anywhere in the app, falls back to / for direct loads.
// Preserves filter context (search query, type, province etc.) that
// the previous hardcoded `href="/"` always stripped.

import { useRouter } from 'next/navigation';

export default function BackLink() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        // history.length > 1 means we have a prior page in this tab.
        // Falls back to / for direct loads (length === 1, or 2 if the
        // browser pre-loaded a blank).
        if (typeof window !== 'undefined' && window.history.length > 1) {
          router.back();
        } else {
          router.push('/');
        }
      }}
      className="text-sm inline-block mb-6"
      style={{
        color: 'var(--text-tertiary)',
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
      }}
    >
      ← Back to listings
    </button>
  );
}
