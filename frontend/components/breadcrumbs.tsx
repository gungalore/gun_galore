import Link from 'next/link';

// Breadcrumbs — one component, every surface that has a place in a hierarchy.
//
// The design boards put a breadcrumb bar on listing detail, cart, checkout,
// account, orders, the Document Centre, the Motivation Centre and Sell. The
// build had them on exactly two routes — /category and /brand — each written
// inline, so there was nothing to reuse and every new surface would have meant
// another copy.
//
// ⚠️ THIS IS NOT A BACK BUTTON AND MUST NOT REPLACE ONE. A breadcrumb says
// where a page sits in the structure; back says where the reader came from,
// which is frequently somewhere else entirely — a search, a shared link, a
// notification. The mobile shell header already carries a real back affordance
// on every push route, so this is hidden below md rather than competing with
// it. Two "up" controls on one phone screen is worse than either alone.
//
// The trail is JSON-LD'd as well as rendered: a listing reached from Google
// wants its position in the site's structure stated in a form the crawler
// reads, and doing it here means no page has to remember to.

export type Crumb = {
  label: string;
  /** Omit on the last crumb — the page you are already on is not a link. */
  href?: string;
};

export function Breadcrumbs({
  trail,
  className = '',
}: {
  trail: Crumb[];
  className?: string;
}) {
  // One crumb is just the page's own name, which the heading already says.
  if (trail.length < 2) return null;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.label,
      ...(c.href ? { item: c.href } : {}),
    })),
  };

  return (
    <>
      <nav
        aria-label="Breadcrumb"
        className={`hidden md:flex flex-wrap items-center gap-1.5 text-sm ${className}`}
        style={{ color: 'var(--text-tertiary)' }}
      >
        {trail.map((c, i) => {
          const last = i === trail.length - 1;
          return (
            <span key={`${c.label}-${i}`} className="flex items-center gap-1.5">
              {c.href && !last ? (
                <Link href={c.href} style={{ color: 'var(--text-tertiary)' }}>
                  {c.label}
                </Link>
              ) : (
                // The current page is named, not linked, and carries the
                // aria-current so a screen reader knows where it stopped.
                <span aria-current="page" style={{ color: 'var(--text-secondary)' }}>
                  {c.label}
                </span>
              )}
              {!last && <span aria-hidden>/</span>}
            </span>
          );
        })}
      </nav>
      <script
        type="application/ld+json"
        // The trail is our own strings, not user input — but it can contain a
        // listing title, so it is serialised rather than interpolated.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  );
}
