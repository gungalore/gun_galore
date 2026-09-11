/**
 * Shown when a browse request FAILED, as opposed to returning nothing.
 *
 * ⚠️ THE DISTINCTION IS THE WHOLE POINT. Both public browse pages used to
 * swallow a failed `/listings` fetch into `{ listings: [], total: 0 }`, so a
 * backend that did not answer rendered "No listings in this category yet.
 * Check back soon." — a factual claim about our own inventory, made at the
 * one moment we had no idea what the inventory was.
 *
 * Three things made that worse than the usual version of this mistake:
 *
 *   * These pages are PUBLIC. No login stands between a stranger and the lie.
 *   * They are server-rendered, so a blip during SSR bakes it into the HTML.
 *   * Crawlers read them. `sitemap.ts` is deliberately anonymous and uncached,
 *     so these paths are fetched often by things that remember what they saw.
 *     "No listings in this category yet" indexed against a full category is a
 *     commercial problem, not a cosmetic one.
 *
 * No retry button: this renders inside a server component, so there is no
 * client state to re-run. A plain reload link is honest about what it does.
 */
export function BrowseUnavailable({ scopeName }: { scopeName?: string }) {
  return (
    <div
      className="mt-8 rounded-[8px] p-8 text-center"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        color: 'var(--text-secondary)',
      }}
      // Tells crawlers and screen readers this is a failure notice rather
      // than page content. A crawler that honours it will not treat the
      // absence of listings here as a fact about the catalogue.
      role="alert"
      data-browse-error="true"
    >
      <p>
        We could not load
        {scopeName ? ` the ${scopeName} listings` : ' these listings'} just
        now. This is a problem on our side, not an empty shelf.
      </p>
      <p className="mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
        Refresh the page to try again.
      </p>
    </div>
  );
}
