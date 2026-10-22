import { isMember } from '@/lib/api-viewer';
import { LiveCatalogRefresh } from './live-catalog-refresh';

/**
 * Server wrapper for the catalogue heartbeat.
 *
 * The access token lives in a 15-minute cookie and is renewed client-side. A
 * hard load after it expired therefore renders the server components
 * ANONYMOUSLY while the browser still holds a valid refresh cookie — on a
 * members-only catalogue that is an empty grid on first paint, which only
 * fills in after the next navigation. Passing the server's verdict to the
 * client lets it re-run the page once the session has been renewed.
 */
export async function CatalogLiveRefresh() {
  const serverSignedIn = await isMember();
  return <LiveCatalogRefresh serverSignedIn={serverSignedIn} />;
}
