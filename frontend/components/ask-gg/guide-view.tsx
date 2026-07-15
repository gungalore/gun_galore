'use client';

import { useGuide } from '@/lib/use-guide';
import { AskGgMascot } from './ask-gg-mascot';

// GG site-guide (G2) — the "Guide" tab body inside the panel. Renders the
// server-driven, page-specific playbook ("how this page works / how to do well
// here") with live public state. $0 AI. CTAs either stage a question into the
// composer (onAsk — nothing sends until the user does) or deep-link (onNavigate).

export function GuideView({
  path,
  listingId,
  active,
  onAsk,
  onNavigate,
}: {
  path: string;
  listingId?: string;
  active: boolean;
  onAsk: (prompt: string) => void;
  onNavigate: (href: string) => void;
}) {
  // Only fetch while the tab is actually shown.
  const { guide, loading } = useGuide(path, listingId, active);

  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px 16px 24px',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {!guide && loading && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-tertiary)' }}>
          Getting your guide for this page…
        </p>
      )}

      {guide && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ color: 'var(--red)', display: 'inline-flex', flexShrink: 0 }}>
              <AskGgMascot size={26} mood="happy" />
            </span>
            <h2
              style={{
                margin: 0,
                fontSize: 15,
                fontWeight: 700,
                color: 'var(--text-primary)',
                lineHeight: 1.25,
              }}
            >
              {guide.title}
            </h2>
          </div>

          {guide.intro && (
            <p
              style={{
                margin: '0 0 12px',
                fontSize: 12.5,
                lineHeight: 1.5,
                color: 'var(--text-secondary)',
              }}
            >
              {guide.intro}
            </p>
          )}

          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {guide.points.map((p, i) => (
              <li
                key={i}
                style={{
                  display: 'flex',
                  gap: 9,
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: 'var(--text-primary)',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    flexShrink: 0,
                    marginTop: 6,
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: 'var(--red)',
                  }}
                />
                <span>{p}</span>
              </li>
            ))}
          </ul>

          {guide.ctas && guide.ctas.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 16 }}>
              {guide.ctas.map((c) => {
                const isLink = typeof c.href === 'string' && c.href.startsWith('/');
                return (
                  <button
                    key={c.label}
                    type="button"
                    onClick={() => {
                      if (isLink) onNavigate(c.href as string);
                      else onAsk(c.ask ?? '');
                    }}
                    style={{
                      padding: '8px 13px',
                      fontSize: 12.5,
                      fontWeight: 600,
                      background: isLink ? 'var(--red)' : 'var(--bg-card)',
                      color: isLink ? '#fff' : 'var(--text-secondary)',
                      border: isLink ? 'none' : '0.5px solid var(--border)',
                      borderRadius: 999,
                      cursor: 'pointer',
                    }}
                  >
                    {c.label}
                    {!isLink && ' →'}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
