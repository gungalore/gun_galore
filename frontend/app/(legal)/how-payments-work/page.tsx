import { permanentRedirect, redirect } from 'next/navigation';

// /how-payments-work — RETIRED EXPLAINER.
//
// The substance of this page (payment collected at checkout, deferred
// settlement, the manual bank-detail review before a first payout, the fee
// direction and the refund/dispute route) is the binding text in the Terms of
// Service, paragraphs 7, 8, 9 and 11. Keeping a second copy here meant two
// documents to keep in step, and the copy had already drifted from the Terms.
//
// Kept as a 308 rather than deleted because the URL is in the footer of older
// deployments, in outbound emails and in the sitemap history.
export default function HowPaymentsWorkRedirect(): never {
  // permanentRedirect issues a 308 so search engines transfer and then drop the
  // old URL; fall back to a 307 on older Next runtimes.
  if (typeof permanentRedirect === 'function') {
    permanentRedirect('/terms#payments');
  }
  redirect('/terms#payments');
}
