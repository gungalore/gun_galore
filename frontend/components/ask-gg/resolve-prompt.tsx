'use client';

/** Phase C — "Did this solve it?" pill rendered after the latest
 *  assistant turn. Yes triggers a backend RESOLVED → spawns a DRAFT
 *  KB entry the admin can verify, growing the search-first corpus.
 *  No / Skip both dismiss; No marks UNRESOLVED so the analytics
 *  dashboard can spot frequently-failing question patterns. */
export function ResolvePrompt({
  onResolve,
}: {
  onResolve: (outcome: 'RESOLVED' | 'UNRESOLVED' | 'ABANDONED') => void;
}) {
  return (
    <div
      style={{
        marginTop: 4,
        padding: '8px 12px',
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: 999,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 12,
        color: 'var(--text-secondary)',
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontStyle: 'italic' }}>Did that solve it?</span>
      <button
        type="button"
        onClick={() => onResolve('RESOLVED')}
        style={{
          padding: '3px 12px',
          borderRadius: 999,
          background: 'rgba(120,180,90,0.12)',
          border: '0.5px solid rgba(120,180,90,0.40)',
          color: '#7eb45c',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        Yes
      </button>
      <button
        type="button"
        onClick={() => onResolve('UNRESOLVED')}
        style={{
          padding: '3px 12px',
          borderRadius: 999,
          background: 'rgba(200,16,46,0.08)',
          border: '0.5px solid rgba(200,16,46,0.30)',
          color: 'var(--red)',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        No
      </button>
      <button
        type="button"
        onClick={() => onResolve('ABANDONED')}
        style={{
          padding: '3px 12px',
          borderRadius: 999,
          background: 'transparent',
          border: 'none',
          color: 'var(--text-tertiary)',
          fontSize: 11,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        Skip
      </button>
    </div>
  );
}
