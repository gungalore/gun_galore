'use client';

import { useGuide, type GuidePersonalTone } from '@/lib/use-guide';
import { AskGgMascot } from './ask-gg-mascot';

// GG site-guide (G2/G4) — the "Guide" tab body inside the panel. Renders the
// server-driven, page-specific playbook ("how this page works / how to do well
// here") with live state. $0 AI. When the user is signed in it also shows the
// `personal` overlay — their OWN top-of-mind state for this page (composed
// server-side from the PII-gated account shapers). CTAs either stage a question
// into the composer (onAsk — nothing sends until the user does) or deep-link
// (onNavigate).

const TONE_ACCENT: Record<GuidePersonalTone, string> = {
  action: 'var(--red)',
  good: '#1a9e4b',
  info: 'var(--text-tertiary)',
};

export function GuideView({
  path,
  listingId,
  active,
  signedIn,
  getToken,
  onAsk,
  onNavigate,
}: {
  path: string;
  listingId?: string;
  active: boolean;
  /** When signed in, the guide fetch uses the authed endpoint → personal overlay. */
  signedIn?: boolean;
  getToken?: () => Promise<string | null>;
  onAsk: (prompt: string) => void;
  onNavigate: (href: string) => void;
}) {
  // Only fetch while the tab is actually shown.
  const { guide, loading } = useGuide(path, listingId, active, {
    signedIn,
    getToken,
  });

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

          {/* G4 — personal overlay (signed-in only, only when there's something). */}
          {guide.personal && guide.personal.items.length > 0 && (
            <div
              style={{
                margin: '0 0 16px',
                padding: '12px',
                borderRadius: 12,
                background: 'var(--bg-subtle, rgba(127,127,127,0.08))',
                border: '0.5px solid var(--border)',
              }}
            >
              <p
                style={{
                  margin: '0 0 8px',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: 'var(--text-tertiary)',
                }}
              >
                {guide.personal.headline}
              </p>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
                {guide.personal.items.map((it, i) => {
                  const accent = TONE_ACCENT[it.tone ?? 'info'];
                  const isLink = typeof it.href === 'string' && it.href.startsWith('/');
                  const inner = (
                    <span style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <span
                        aria-hidden
                        style={{
                          flexShrink: 0,
                          marginTop: 5,
                          width: 7,
                          height: 7,
                          borderRadius: 999,
                          background: accent,
                        }}
                      />
                      <span style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--text-primary)' }}>
                        {it.label}
                        {isLink && (
                          <span style={{ color: accent, fontWeight: 600 }}> →</span>
                        )}
                      </span>
                    </span>
                  );
                  return (
                    <li key={i}>
                      {isLink ? (
                        <button
                          type="button"
                          onClick={() => onNavigate(it.href as string)}
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                          }}
                        >
                          {inner}
                        </button>
                      ) : (
                        inner
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
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
