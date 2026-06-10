import { redirect } from 'next/navigation';

// AUDIT M27 — /listings was a hard 404 (no bare browse page existed
// even though /listings(.*) is in the public-route allowlist). External
// links, bookmarks, and stale search-engine entries hit a 404 instead of
// the marketplace. Browse currently lives at "/", so we redirect there.
// When the marketplace gets a dedicated /browse page this redirect can
// be swapped to that target without breaking any old URL.
export default function ListingsIndexPage() {
  redirect('/');
}
