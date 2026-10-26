import Link from 'next/link';

/**
 * "Good to know" — the quiet link strip that sits near the bottom of the
 * landing page, above the footer.
 *
 * WHY IT IS A STRIP AND NOT AN ACCORDION. It used to fold away three
 * explanations (how selling works, buying and delivery, what it costs). Every
 * one of those answers already has a canonical home — /how-selling-works,
 * /faq, /fees and the binding Terms of Service — and keeping a second copy
 * here meant two documents to keep in step. The strip keeps the useful part
 * (one tap to the canonical page) and drops the duplicate prose.
 *
 * Native links only: no JavaScript, no hydration cost, works with the keyboard
 * and with a screen reader for free.
 */

const LINKS: [string, string][] = [
  ['Full selling guide', '/how-selling-works'],
  ['Help & FAQ', '/faq'],
  ['Fees', '/fees'],
  ['Condition guide', '/condition-guide'],
  ['Contact us', '/contact'],
];

export function HomeInfoPanel() {
  return (
    <section className="mt-20 sm:mt-24" aria-labelledby="good-to-know">
      <div
        className="pt-12 grid gap-8 lg:gap-16 lg:grid-cols-[minmax(260px,1fr)_minmax(0,1.6fr)]"
        style={{ borderTop: '1px solid var(--hairline)' }}
      >
        <div>
          <p
            className="text-[11px] uppercase mb-3"
            style={{
              color: 'var(--text-tertiary)',
              letterSpacing: '0.2em',
              fontWeight: 600,
            }}
          >
            Good to know
          </p>
          <h2
            id="good-to-know"
            className="text-2xl sm:text-3xl m-0"
            style={{ color: 'var(--text-primary)' }}
          >
            Everything you need, one tap away
          </h2>
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-3 lg:items-center">
          {LINKS.map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className="text-sm"
              style={{ color: 'var(--text-tertiary)', textDecoration: 'none' }}
            >
              {label} →
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
