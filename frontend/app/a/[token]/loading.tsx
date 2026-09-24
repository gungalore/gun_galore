export default function LoadingActionToken() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        background: 'var(--bg)',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
      role="status"
      aria-live="polite"
    >
      <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/emblem-dark-transparent.svg"
          alt="ALL Outdoor"
          width={64}
          height={64}
          style={{ display: 'block', margin: '0 auto 18px' }}
        />
        <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
          Just a moment…
        </p>
        <p style={{ margin: '6px 0 0', fontSize: 13 }}>
          Getting your collection options ready.
        </p>
      </div>
    </main>
  );
}
