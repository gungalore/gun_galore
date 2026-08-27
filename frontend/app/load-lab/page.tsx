'use client';

/**
 * Load Lab — the published manual-load browser and the powder burn-rate chart.
 *
 * It used to be a tab inside the Ask Boet page. When the assistant was removed
 * (2026-08-26) Load Lab was kept, so it now owns this route and is reached from
 * the account area alongside Document Centre and Motivation Centre rather than
 * from the storefront.
 *
 * Signed-in members get the COMPLETE data: the PRO gate that served everyone
 * else a three-load teaser was removed at the same time. The route is not in
 * middleware's isPublicRoute, so Clerk requires a session before it renders.
 */

import { LoadLabPanel } from './LoadLabPanel';

export default function LoadLabPage() {
  return (
    <main
      className="mx-auto px-4 py-8"
      style={{ maxWidth: 'var(--page-max)' }}
    >
      <header className="mb-6">
        <h1 className="text-3xl mb-2">Load Lab</h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Published manual load data with source and page citations, and the
          cross-manufacturer powder burn-rate chart.
        </p>
      </header>
      <LoadLabPanel />
    </main>
  );
}
