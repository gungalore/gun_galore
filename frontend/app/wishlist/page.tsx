import Link from 'next/link';

// Wishlist — saved listings the buyer wants to come back to. The backend
// model doesn't exist yet (we'll add a `WishlistEntry` table joining
// User ↔ Listing in a follow-up). For now this page is a placeholder so
// the heart icon in the nav doesn't 404.

export const metadata = {
  title: 'Wishlist — Gun Galore',
};

export default function WishlistPage() {
  return (
    <main className="max-w-[1280px] mx-auto px-4 py-12">
      <header className="mb-8">
        <h1
          className="text-2xl mb-1"
          style={{ color: 'var(--text-primary)', fontWeight: 500 }}
        >
          Wishlist
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Save listings you want to come back to.
        </p>
      </header>

      <div
        className="rounded-[8px] p-10 text-center"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        <p
          className="text-sm mb-2"
          style={{ color: 'var(--text-secondary)' }}
        >
          Wishlist is coming soon.
        </p>
        <p
          className="text-xs"
          style={{ color: 'var(--text-tertiary)' }}
        >
          You&apos;ll be able to save listings from the browse view by
          tapping the heart icon on any card.
        </p>
        <Link
          href="/?listingType=BUY_NOW"
          className="inline-block mt-5 px-4 py-2 rounded-[6px] text-sm"
          style={{
            background: 'var(--red)',
            color: '#fff',
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          Browse the marketplace
        </Link>
      </div>
    </main>
  );
}
