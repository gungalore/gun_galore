import Link from 'next/link';
import type { ElementType } from 'react';
import { BRAND_NAME } from '../../lib/brand';

/**
 * The public front door. A shared link from WhatsApp/Facebook lands here when
 * the visitor is signed out — a plain sign-in prompt, not a bare redirect.
 *
 * ⚠️ This is rendered for EVERY anonymous visitor, human or crawler, with
 * identical content. No member content is fetched or leaked here. This is the
 * auth wall, not cloaking.
 *
 * `as` exists so the homepage can embed the gate inside its own <main> without
 * nesting two <main> landmarks; the /community pages keep the default.
 */
export function CommunityGate({ as = 'main' }: { as?: 'main' | 'section' }) {
  const Tag: ElementType = as;
  return (
    <Tag
      className="mx-auto px-4 py-10"
      style={{ maxWidth: 'var(--content-max)' }}
    >
      <div className="max-w-xl mx-auto text-center">
        <span
          className="inline-block text-[12px] font-medium px-3 py-1 rounded-full mb-4"
          style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
        >
          Members only
        </span>
        <h1
          className="text-2xl sm:text-3xl font-medium mb-3"
          style={{ color: 'var(--text-primary)' }}
        >
          Join the {BRAND_NAME} community
        </h1>
        <p
          className="text-[15px] leading-relaxed mb-6"
          style={{ color: 'var(--text-secondary)' }}
        >
          Share hunts, catches, camps and builds. Ask questions, swap advice and
          keep up with the people who love the outdoors as much as you do.
          Sign in to see what members are sharing.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/sign-in?redirect_url=/community"
            className="gg-press px-5 py-3 rounded-[6px] text-[14px] font-medium"
            style={{ background: 'var(--red)', color: '#fff' }}
          >
            Sign in
          </Link>
          <Link
            href="/sign-up?redirect_url=/community"
            className="gg-press px-5 py-3 rounded-[6px] text-[14px] font-medium"
            style={{
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              border: '0.5px solid var(--border)',
            }}
          >
            Create an account
          </Link>
        </div>

        <p className="text-[12px] mt-5" style={{ color: 'var(--text-tertiary)' }}>
          By joining you agree to our{' '}
          <Link href="/community-guidelines" style={{ color: 'var(--red)' }}>
            Community Guidelines
          </Link>
          .
        </p>
      </div>
    </Tag>
  );
}
