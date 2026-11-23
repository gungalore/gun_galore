import type { Metadata } from 'next';
import Link from 'next/link';
import { BRAND_NAME } from '@/lib/brand';
import { Logo } from '@/components/brand/Logo';
import { ActionBox } from '@/components/action-box';
import { ActionBoxLink } from '@/components/action-box-link';

// ⚠️ PUBLIC, META-SAFE SURFACE. This is the only licence-application page a
// crawler or a WhatsApp link-preview should ever see. It deliberately avoids
// restricted product vocabulary and imagery; the detailed application lives
// behind auth at /licence-centre/applications. Do not add a crawler/user-agent
// branch here — the page is genuinely neutral for every visitor.
export const metadata: Metadata = {
  title: 'SAPS licence application motivation',
  description:
    'Prepare the supporting motivation document for your SAPS licence application. Sign in to use your profile and documents, then review and submit.',
  alternates: { canonical: '/motivation' },
  openGraph: {
    title: `SAPS licence application motivation | ${BRAND_NAME}`,
    description:
      'Prepare the supporting motivation document for your SAPS licence application in one guided place.',
    type: 'website',
    url: '/motivation',
  },
};

const STEPS = [
  {
    title: 'Sign in',
    body: 'Use your account so the application can draw on the profile and documents you already have.',
  },
  {
    title: 'Work through the application',
    body: 'Answer the guided questions and add the supporting documents the application needs.',
  },
  {
    title: 'Review and submit',
    body: 'Check the prepared document, then choose how you want to receive the finished pack.',
  },
];

export default function MotivationPage() {
  return (
    <>
      <header
        className="mx-auto flex items-center px-4 py-4 sm:px-6"
        style={{ maxWidth: 'var(--content-max)' }}
      >
        <Link href="/" aria-label={BRAND_NAME} style={{ display: 'inline-flex' }}>
          <Logo height={34} priority />
        </Link>
      </header>
      <main
        className="mx-auto px-4 py-8 sm:px-6 sm:py-12"
        style={{ maxWidth: 'var(--content-max)' }}
      >
      <p
        className="text-[11px] font-semibold uppercase tracking-[0.18em]"
        style={{ color: 'var(--text-tertiary)' }}
      >
        Licence applications
      </p>
      <h1
        className="mt-2 max-w-[720px] text-2xl font-medium sm:text-3xl"
        style={{ color: 'var(--text-primary)' }}
      >
        Prepare the supporting motivation for your SAPS licence application.
      </h1>
      <p
        className="mt-3 max-w-[680px] text-[15px] leading-relaxed"
        style={{ color: 'var(--text-secondary)' }}
      >
        One guided place for the application document, your supporting papers
        and the final pack. Sign in when you start so the application can use
        your profile and the documents already in your account.
      </p>

      <div className="mt-6 max-w-[560px]">
        <ActionBox
          title="Start your application"
          description="You will be asked to sign in or create an account. New accounts start with a short profile; returning members continue with their saved details."
          action={
            <ActionBoxLink href="/licence-centre/applications">
              Start my application
            </ActionBoxLink>
          }
        />
      </div>

      <section className="mt-10" aria-labelledby="how-it-works">
        <h2
          id="how-it-works"
          className="text-[15px] font-semibold"
          style={{ color: 'var(--text-primary)' }}
        >
          How it works
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <div
              key={step.title}
              style={{
                background: 'var(--bg-card)',
                border: '0.5px solid var(--border)',
                borderRadius: 8,
                padding: '13px 14px',
              }}
            >
              <p
                className="text-[11px] font-semibold uppercase tracking-[0.12em]"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Step {index + 1}
              </p>
              <h3
                className="mt-1 text-[14px] font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                {step.title}
              </h3>
              <p
                className="mt-1 text-[13px] leading-relaxed"
                style={{ color: 'var(--text-secondary)' }}
              >
                {step.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <p className="mt-8 text-[12px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
        Your profile and documents stay in your account. The application
        document is prepared for you to review; it is not a guarantee of any
        outcome and is not legal advice.
      </p>
      </main>
    </>
  );
}
