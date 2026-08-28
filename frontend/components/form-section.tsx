// A plain, always-open section of a long form.
//
// Operator, 2026-08-28, looking at the Sell page: "remove these steps and keep
// only the step rail on top."
//
// This replaces StepAccordion on the Sell form. That component numbered each
// section, collapsed all but one, locked the ones ahead behind a Continue
// button, and drew its own ▾ chevron — a second, vertical progress system
// sitting directly under the horizontal rail that already says the same thing.
// The rail is now the only step display on the page, and the form below it is
// simply a form: every field visible, scroll to reach any of it, fill it in
// whatever order you like.
//
// ⚠️ StepAccordion IS STILL IN USE — /profile/edit renders it. Do not delete it.
//
// scroll-margin-top is load-bearing rather than cosmetic: the rail's step
// buttons scroll a section to the top of the viewport, and without the margin
// the section's heading lands underneath the site header.

import type { ReactNode } from 'react';

interface Props {
  /** Anchor id — the step rail scrolls to this. */
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}

export function FormSection({ id, title, description, children }: Props) {
  return (
    <section
      id={id}
      className="gg-tile rounded-[8px] px-5 sm:px-6 py-5 sm:py-6"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        scrollMarginTop: 88,
      }}
    >
      <h2
        className="text-base sm:text-lg"
        style={{
          color: 'var(--text-primary)',
          fontWeight: 500,
          letterSpacing: '-0.01em',
        }}
      >
        {title}
      </h2>
      {description && (
        <p
          className="text-sm mt-1.5"
          style={{ color: 'var(--text-tertiary)', lineHeight: 1.55 }}
        >
          {description}
        </p>
      )}
      <div className="space-y-4 mt-5">{children}</div>
    </section>
  );
}
