// /ask-gg — placeholder for the upcoming AI assistant.
//
// Public route, no auth gate. Built as a "Coming soon" hero so the
// nav tab the bottom tab bar points at always resolves to a real
// page (not a 404), and so we can deep-link to /ask-gg from any
// future marketing / email blast the day the feature actually
// ships. Replace this file's content with the real chat surface
// when the assistant is wired up.
//
// Layout mirrors the brand voice — dark eyebrow + bold headline +
// concise teaser of what the assistant will do + a soft fallback
// CTA back to the marketplace so visitors don't dead-end.

import Link from 'next/link';
import type { Metadata } from 'next';
import { PageReveal } from '@/components/page-reveal';

export const metadata: Metadata = {
  title: 'Ask GG — coming soon · Gun Galore',
  description:
    'Ask GG — an AI assistant for South Africa\'s firearms marketplace. Coming soon.',
};

function IconBigSparkles() {
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 4 L13.6 9.4 L19 11 L13.6 12.6 L12 18 L10.4 12.6 L5 11 L10.4 9.4 Z" />
      <path d="M18.5 4 L19 5.5 L20.5 6 L19 6.5 L18.5 8 L18 6.5 L16.5 6 L18 5.5 Z" />
      <path d="M18.5 16 L19 17.2 L20.2 17.7 L19 18.2 L18.5 19.4 L18 18.2 L16.8 17.7 L18 17.2 Z" />
    </svg>
  );
}

export default function AskGgPage() {
  return (
    <main
      className="max-w-[760px] mx-auto px-4 py-16 sm:py-24"
      style={{ minHeight: 'calc(100vh - 200px)' }}
    >
      <PageReveal variant="scale-in">
        <div
          data-reveal
          style={{
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          {/* Sparkles emblem — same icon family as the tab so the
              page reads as belonging to its nav entry. Brand red
              gives it the urgency of an upcoming feature. */}
          <div
            aria-hidden
            style={{
              width: 96,
              height: 96,
              borderRadius: '50%',
              background:
                'radial-gradient(circle at center, rgba(200,16,46,0.20), rgba(200,16,46,0) 70%)',
              color: 'var(--red)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 24,
            }}
          >
            <IconBigSparkles />
          </div>

          <p
            style={{
              fontSize: 12,
              textTransform: 'uppercase',
              letterSpacing: '0.18em',
              color: 'var(--red)',
              fontWeight: 600,
              marginBottom: 12,
            }}
          >
            Coming soon
          </p>
        </div>

        <h1
          data-reveal
          style={{
            fontSize: 'clamp(36px, 6vw, 56px)',
            fontWeight: 500,
            letterSpacing: '-0.02em',
            lineHeight: 1.05,
            color: 'var(--text-primary)',
            margin: '0 0 18px',
            textAlign: 'center',
          }}
        >
          Ask <span style={{ color: 'var(--red)' }}>GG</span>
        </h1>

        <p
          data-reveal
          style={{
            fontSize: 17,
            color: 'var(--text-secondary)',
            lineHeight: 1.55,
            margin: '0 0 32px',
            textAlign: 'center',
            maxWidth: 540,
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        >
          An AI assistant built for South African shooters. Find the
          right listing faster, ask price questions about firearms,
          and get help understanding our checkout, dealer-transfer
          and KYC flows — without leaving the app.
        </p>

        <div
          data-reveal
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr',
            gap: 12,
            maxWidth: 560,
            margin: '0 auto 36px',
          }}
        >
          {[
            {
              title: 'Find listings, in plain English',
              body: 'Type "9mm under R8k in Western Cape" and get a curated short-list — no filter juggling.',
            },
            {
              title: 'Understand the rules, not just the tags',
              body: 'Ask why a firearm needs a dealer transfer, how the SAPS 534 works, or what BLOCK LETTERS actually means for your form.',
            },
            {
              title: 'Get unstuck on checkout, KYC and disputes',
              body: 'A real explainer in seconds instead of a 5-paragraph support email.',
            },
          ].map((feature) => (
            <div
              key={feature.title}
              style={{
                background: 'var(--bg-card)',
                border: '0.5px solid var(--border)',
                borderRadius: 10,
                padding: '14px 16px',
                textAlign: 'left',
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  fontWeight: 500,
                  color: 'var(--text-primary)',
                }}
              >
                {feature.title}
              </p>
              <p
                style={{
                  margin: '4px 0 0',
                  fontSize: 13,
                  color: 'var(--text-tertiary)',
                  lineHeight: 1.5,
                }}
              >
                {feature.body}
              </p>
            </div>
          ))}
        </div>

        <div
          data-reveal
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <Link
            href="/?listingType=BUY_NOW"
            style={{
              display: 'inline-block',
              padding: '11px 20px',
              borderRadius: 8,
              background: 'var(--red)',
              color: '#fff',
              fontWeight: 500,
              fontSize: 14,
              textDecoration: 'none',
            }}
          >
            Browse the marketplace
          </Link>
          <Link
            href="/competitions"
            style={{
              display: 'inline-block',
              padding: '11px 20px',
              borderRadius: 8,
              background: 'var(--bg-inset)',
              color: 'var(--text-secondary)',
              border: '0.5px solid var(--border)',
              fontSize: 14,
              textDecoration: 'none',
            }}
          >
            See live competitions
          </Link>
        </div>
      </PageReveal>
    </main>
  );
}
