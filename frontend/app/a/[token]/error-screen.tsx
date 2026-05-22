import Link from 'next/link';

/**
 * Friendly error screen for the four expected failure modes when a
 * user taps an SMS link:
 *
 *   404 — link not recognised at all (truncated SMS, typo)
 *   410 — link expired OR already used (one-time consume)
 *   403 — link locked from too many invalid attempts
 *   other — generic "something went wrong" with a sign-in fallback
 */
export function ActionTokenError({ status }: { status: number }) {
  const copy = pickCopy(status);
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: 12,
        padding: 24,
        textAlign: 'center',
      }}
    >
      <p
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 8,
        }}
      >
        {copy.title}
      </p>
      <p
        style={{
          fontSize: 14,
          color: 'var(--text-secondary)',
          lineHeight: 1.55,
          marginBottom: 20,
        }}
      >
        {copy.body}
      </p>
      <Link
        href="/sign-in"
        style={{
          display: 'inline-block',
          background: 'var(--red)',
          color: '#fff',
          textDecoration: 'none',
          padding: '12px 24px',
          borderRadius: 8,
          fontWeight: 500,
          fontSize: 14,
          minHeight: 44,
          minWidth: 200,
        }}
      >
        Sign in to Gun Galore
      </Link>
    </div>
  );
}

function pickCopy(status: number): { title: string; body: string } {
  if (status === 404) {
    return {
      title: 'Link not recognised',
      body: "The link you tapped doesn't match anything in our system. It may have been mistyped, or this is an old link from a previous notification. Sign in to your account to see the current state.",
    };
  }
  if (status === 410) {
    return {
      title: 'Link no longer valid',
      body: "This link has either expired or already been used. Sign in to your account to see the current state of the item.",
    };
  }
  if (status === 403) {
    return {
      title: 'Link locked',
      body: 'Too many invalid attempts were made with this link. For your security, sign in to your account to take this action instead.',
    };
  }
  return {
    title: "Couldn't load this link",
    body: "Something went wrong loading this page. Try again in a moment, or sign in to your account to handle this action directly.",
  };
}
