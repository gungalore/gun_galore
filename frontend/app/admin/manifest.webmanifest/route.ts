import { deskManifest } from '../desk-manifest';

/**
 * Serves the Desk's manifest at /admin/manifest.webmanifest.
 *
 * ⚠️ A ROUTE HANDLER, BECAUSE Next's `manifest.ts` CONVENTION IS ROOT-ONLY.
 * The obvious shape — app/admin/manifest.ts, mirroring app/manifest.ts — looks
 * like it should work and silently does nothing: the build emits
 * /manifest.webmanifest and no /admin/manifest.webmanifest, so the Desk went
 * on linking the shop's manifest with no error anywhere. Verified by building
 * it and reading the route list, not by reasoning about the convention.
 *
 * The `manifest` metadata field in app/admin/desk/layout.tsx points the Desk's
 * pages here; without that link this file is served and never read.
 */
export const dynamic = 'force-static';

export function GET() {
  return new Response(JSON.stringify(deskManifest(), null, 2), {
    headers: {
      'Content-Type': 'application/manifest+json',
      // Same posture as any other static asset: the icons inside it are
      // already cache-busted by asset-version, so the document itself can be
      // revalidated cheaply rather than pinned.
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}
