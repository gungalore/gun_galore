import { permanentRedirect, redirect } from 'next/navigation';

// /buyer-protection — RETIRED EXPLAINER.
//
// Nothing on the live site linked here, and every protection it described
// (deferred settlement, verified sellers, dispute freeze, refund on a valid
// claim) plus the exclusions it listed are now set out in the binding Buyer
// protection paragraph of the Terms of Service, paragraph 11.
//
// Kept as a 308 rather than deleted because the URL may be bookmarked or linked
// from older emails.
export default function BuyerProtectionRedirect(): never {
  // permanentRedirect issues a 308 so search engines transfer and then drop the
  // old URL; fall back to a 307 on older Next runtimes.
  if (typeof permanentRedirect === 'function') {
    permanentRedirect('/terms#buyer-protection');
  }
  redirect('/terms#buyer-protection');
}
