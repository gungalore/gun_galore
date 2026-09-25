import { Logo } from '@/components/brand/Logo';

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
        <Logo variant="emblem" height={64} className="mx-auto mb-4 block" />
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
