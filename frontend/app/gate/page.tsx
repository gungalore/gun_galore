import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { BRAND_NAME } from '@/lib/brand';
import { safeGateNext } from '@/lib/gate-next';
import { GateConsent } from '@/components/gate/gate-consent';

/**
 * The 18+ gate — the site's front door, now a full-screen welcome.
 *
 * ⚠️ THIS PAGE IS THE ONLY THING A CRAWLER EVER SEES. Every content route
 * redirects here for a visitor without a declaration, so the copy must stay
 * neutral: no listing titles, no category vocabulary, no regulated-goods
 * wording. It says "age-restricted items" and nothing more. The HTML/image is
 * the SAME for a crawler and for a human — never branch on user-agent.
 *
 * The collage is the backdrop; the white pop-up window carries the welcome,
 * the age declaration and the only control (Enter). Enter POSTs the existing
 * declaration, the backend mints the HttpOnly `ao_cat` cookie for 30 days, and
 * the page full-navigates to the validated `next` path.
 *
 * The redirect target is validated to a relative, same-origin path — never an
 * open redirect.
 */

export const metadata: Metadata = {
  title: `Welcome — ${BRAND_NAME}`,
  description: `Welcome to ${BRAND_NAME}. This site lists age-restricted items — confirm you are 18 or older to enter.`,
  robots: { index: false, follow: false },
  alternates: { canonical: '/gate' },
  openGraph: {
    title: `Welcome — ${BRAND_NAME}`,
    description: `Confirm you are 18 or older to enter ${BRAND_NAME}.`,
    url: '/gate',
    type: 'website',
    // Keep the neutral brand OG image: the gate page must not use a
    // content-bearing preview that a crawler could index.
    images: ['/og-default.jpg'],
  },
};

export default async function GatePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = safeGateNext(params?.next);
  const signUpHref = `/sign-up?redirect_url=${encodeURIComponent(next)}`;
  const signInHref = `/sign-in?redirect_url=${encodeURIComponent(next)}`;

  return (
    <main className="relative min-h-[100dvh] w-full overflow-hidden flex items-center justify-center px-4 py-8 sm:px-6">
      {/* Full-screen collage backdrop + readable scrim. The image carries the
          brand logo, so the pop-up does not add a second one. `priority` is
          deliberate: this is the first meaningful paint of the site. */}
      <div aria-hidden="true" className="absolute inset-0">
        <Image
          src="/gate/all-outdoor-welcome.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
          style={{ filter: 'blur(2px) brightness(0.72)' }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(6,8,11,0.50) 0%, rgba(6,8,11,0.72) 52%, rgba(6,8,11,0.86) 100%)',
          }}
        />
      </div>

      {/* The pop-up window. No close button and no backdrop dismissal: this is
          the age gate, and Enter is the only way through. */}
      <section
        aria-labelledby="gate-title"
        aria-describedby="gate-age"
        className="relative w-full max-w-[640px] max-h-[92dvh] overflow-y-auto rounded-[14px] p-6 sm:p-9"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-primary)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
        }}
      >
        <p
          className="text-[11px] uppercase tracking-[0.14em] mb-2"
          style={{ color: 'var(--red)', fontWeight: 600 }}
        >
          Welcome to ALL Outdoor
        </p>

        <h1
          id="gate-title"
          className="text-[26px] sm:text-[34px] leading-[1.1] mb-3"
          style={{
            fontFamily: 'var(--font-head)',
            fontWeight: 700,
            letterSpacing: '-0.02em',
          }}
        >
          Welcome to the all-new ALL Outdoor marketplace.
        </h1>

        <p
          className="text-[15px] leading-relaxed mb-6"
          style={{ color: 'var(--text-secondary)' }}
        >
          Sign up and list for free — or take a look around.
        </p>

        <p
          id="gate-age"
          className="text-[12px] leading-relaxed mb-5"
          style={{ color: 'var(--text-tertiary)' }}
        >
          By entering, you confirm you are 18 or older, that viewing
          age-restricted items is lawful where you are, and that you accept our{' '}
          <Link
            href="/terms"
            style={{ color: 'var(--text-secondary)', textDecoration: 'underline' }}
          >
            Terms of Service
          </Link>
          . This confirmation lasts 30 days on this device.
        </p>

        <GateConsent next={next} describedBy="gate-age" />

        <div
          className="mt-6 pt-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
          style={{ borderTop: '0.5px solid var(--border)' }}
        >
          <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
            New here?{' '}
            <Link
              href={signUpHref}
              style={{ color: 'var(--text-primary)', textDecoration: 'underline' }}
            >
              Create a free account
            </Link>
          </p>
          <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
            Already have an account?{' '}
            <Link
              href={signInHref}
              style={{ color: 'var(--text-primary)', textDecoration: 'underline' }}
            >
              Sign in
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
