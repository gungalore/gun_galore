import Image from 'next/image';
import Link from 'next/link';

// Catches every unmatched route. Brand-styled, dark theme, no Clerk
// calls (so it renders even for signed-out users hitting bad URLs).

export const metadata = {
  title: 'Page not found — Gun Galore',
};

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: 'calc(100vh - 91px)', // subtract nav + urgent strip
        background: 'var(--bg-deep)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 480, textAlign: 'center' }}>
        <Image
          src="/logo.svg"
          alt="Gun Galore"
          width={200}
          height={40}
          priority
          style={{ height: 40, width: 'auto', margin: '0 auto 32px' }}
        />
        <p
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--red)',
            fontWeight: 600,
            marginBottom: 8,
          }}
        >
          404 — Page not found
        </p>
        <h1
          style={{
            fontSize: 24,
            color: 'var(--text-primary)',
            fontWeight: 500,
            marginBottom: 12,
            letterSpacing: '-0.01em',
          }}
        >
          That page doesn&apos;t exist
        </h1>
        <p
          style={{
            fontSize: 14,
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
            marginBottom: 28,
          }}
        >
          The URL might be mistyped, or the listing might have sold.
          Try one of these:
        </p>
        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Link
            href="/"
            style={{
              background: 'var(--red)',
              color: '#fff',
              padding: '10px 20px',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            Browse marketplace
          </Link>
          <Link
            href="/?listingType=AUCTION"
            style={{
              background: 'var(--bg-card)',
              color: 'var(--text-secondary)',
              padding: '10px 20px',
              borderRadius: 6,
              fontSize: 13,
              border: '0.5px solid var(--border)',
              textDecoration: 'none',
            }}
          >
            Auctions
          </Link>
        </div>
      </div>
    </main>
  );
}
