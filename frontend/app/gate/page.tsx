import type { Metadata } from 'next';
import Link from 'next/link';
import { BRAND_NAME } from '@/lib/brand';
import { GateConsent } from '@/components/gate/gate-consent';

/**
 * The 18+ gate — the site's front door.
 *
 * ⚠️ THIS PAGE IS THE ONLY THING A CRAWLER EVER SEES. Every content route
 * redirects here for a visitor without a declaration, so the copy must stay
 * neutral: no listing titles, no category vocabulary, no regulated-goods
 * wording. It says "age-restricted items" and nothing more, because this HTML
 * is what Meta's fetcher (and any other crawler) receives.
 *
 * The redirect target (`next`) is validated to a relative, same-origin path —
 * never an open redirect. The declaration itself is minted by the backend and
 * lives in an HttpOnly cookie for 30 days.
 */

function safeNext(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.length > 2000) {
    return '/';
  }
  return raw;
}

export const metadata: Metadata = {
  title: `Age verification — ${BRAND_NAME}`,
  description: `${BRAND_NAME} lists age-restricted items. Confirm you are 18 or older to browse.`,
  robots: { index: false, follow: false },
  alternates: { canonical: '/gate' },
  openGraph: {
    title: `Age verification — ${BRAND_NAME}`,
    description: `Confirm you are 18 or older to browse ${BRAND_NAME}.`,
    url: '/gate',
    type: 'website',
    images: ['/og-default.jpg'],
  },
};

export default async function GatePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = safeNext(params?.next);

  return (
    <main
      className="mx-auto px-5 py-14 flex flex-col items-center"
      style={{ maxWidth: 460, minHeight: '70vh' }}
    >
      <Link
        href="/gate"
        aria-label={BRAND_NAME}
        className="mb-8 inline-flex"
        style={{ textDecoration: 'none' }}
      >
        <span
          className="text-[20px]"
          style={{
            fontFamily: 'var(--font-head)',
            fontWeight: 700,
            color: 'var(--text-primary)',
            letterSpacing: '0.01em',
          }}
        >
          {BRAND_NAME}
        </span>
      </Link>

      <h1
        className="text-[24px] sm:text-[28px] text-center mb-3"
        style={{ color: 'var(--text-primary)', fontWeight: 600 }}
      >
        Age-restricted catalogue
      </h1>

      <p
        className="text-[15px] leading-relaxed text-center mb-7"
        style={{ color: 'var(--text-secondary)' }}
      >
        This site lists age-restricted items. To continue, confirm that you are
        18 years or older and that viewing these items is lawful where you are.
        You do not need an account to browse.
      </p>

      <div className="w-full">
        <GateConsent next={next} />
      </div>

      <p
        className="text-[12px] leading-relaxed text-center mt-5"
        style={{ color: 'var(--text-tertiary)' }}
      >
        By continuing you confirm your age and accept our{' '}
        <Link
          href="/terms"
          style={{ color: 'var(--text-secondary)', textDecoration: 'underline' }}
        >
          Terms of Service
        </Link>
        . The confirmation lasts 30 days on this device.
      </p>

      <div
        className="mt-8 pt-6 w-full text-center"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
          Already have an account?{' '}
          <Link
            href="/sign-in"
            style={{ color: 'var(--text-primary)', textDecoration: 'underline' }}
          >
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
