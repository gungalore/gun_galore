// One-off — converts the bracket placeholders ([Item Title], [Reference]
// etc) used by the designer mockup HTML email templates into the
// {{varName}} syntax that EmailTemplatesService can render. Run once
// per template; safe to re-run (idempotent — string replacements only
// fire on the original brackets, not the rendered {{}} form).
//
// Run from backend/ as:  node scripts/normalize-email-templates.mjs
//
// IMPORTANT: this script ignores anything that looks like an Outlook
// conditional comment ([if mso], [endif] etc). Those live inside HTML
// comments and are part of the email's MSO compatibility shim, not
// placeholders.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const EMAILS_DIR = path.join(
  __dirname,
  '..',
  'src',
  'modules',
  'notifications',
  'templates',
  'emails',
);

// Active templates — the ones the live NotificationsService methods
// will render through EmailTemplatesService. Other templates in the
// folder remain bracket-placeholder until we wire them up.
const ACTIVE_TEMPLATES = [
  'listing-approved.html',
  'listing-rejected.html',
  'listing-submitted.html',
  'payment-confirmed.html',
  'sale-confirmed-seller.html',
  'sale-shipped.html',
  'item-delivered.html',
  'payout-sent.html',
  'refund-issued.html',
  'kyc-approved.html',
  'kyc-rejected.html',
  'offer-received.html',
  'offer-accepted.html',
  'offer-declined.html',
  'offer-countered.html',
  'offer-expired.html',
];

// Ordered list of literal find/replace. Order matters: URL patterns
// run before [id] so we don't strand bare {{id}}s in href attributes.
const REPLACEMENTS = [
  // ── URLs: collapse every CTA link to {{ctaUrl}} so the service
  //    builds the final URL with APP_URL prefix + correct path.
  ['https://gungalore.co.za/listings/[id]', '{{ctaUrl}}'],
  ['https://gungalore.co.za/sell/edit/[id]', '{{ctaUrl}}'],
  ['https://gungalore.co.za/transactions/[id]', '{{ctaUrl}}'],
  ['https://gungalore.co.za/checkout/[id]', '{{ctaUrl}}'],
  ['https://gungalore.co.za/dashboard/offers', '{{ctaUrl}}'],
  ['https://gungalore.co.za/dashboard?tab=wallet', '{{ctaUrl}}'],
  ['https://gungalore.co.za/verify/kyc', '{{ctaUrl}}'],
  ['https://gungalore.co.za/browse', '{{ctaUrl}}'],

  // ── Standard placeholders. Strings here are matched exactly — no
  //    regex, so trailing punctuation in the templates is unaffected.
  ['[Item Title]', '{{itemTitle}}'],
  ['[Title]', '{{itemTitle}}'],
  ['[Reference]', '{{reference}}'],
  ['[GGS###]', '{{reference}}'],
  ['[Amount]', '{{amount}}'],
  ['[List Price]', '{{listPrice}}'],
  ['[Counter]', '{{counterAmount}}'],
  ['[Date]', '{{date}}'],
  ['[Reason]', '{{reason}}'],
  ['[Buyer]', '{{buyerName}}'],
  ['[Seller]', '{{sellerName}}'],
  ['[First Name]', '{{firstName}}'],
  ['[Attempt #]', '{{attempt}}'],
  ['[Bank]', '{{bank}}'],
  ['[Last 4]', '{{last4}}'],
  ['[Card / Bank]', '{{refundDestination}}'],
  ['[Buy now / Auction / Take a Shot]', '{{listingTypeLabel}}'],
  ['[Dealer / Courier]', '{{shippingMethodLabel}}'],
  ['[TCG / PUDO]', '{{courier}}'],
  ['[Courier]', '{{courier}}'],
  ['[Tracking URL]', '{{trackingUrl}}'],
  ['[Waybill]', '{{waybill}}'],
  ['[n]', '{{retryCount}}'],
];

let changed = 0;
for (const file of ACTIVE_TEMPLATES) {
  const full = path.join(EMAILS_DIR, file);
  if (!fs.existsSync(full)) {
    console.warn(`Skipping ${file} — not found`);
    continue;
  }
  const before = fs.readFileSync(full, 'utf8');
  let after = before;
  for (const [find, replace] of REPLACEMENTS) {
    after = after.split(find).join(replace);
  }
  if (after !== before) {
    fs.writeFileSync(full, after);
    changed += 1;
    console.log(`Updated ${file}`);
  } else {
    console.log(`No-op ${file} (already normalised)`);
  }
}
console.log(`\nDone — ${changed}/${ACTIVE_TEMPLATES.length} templates updated.`);

// Sanity check — list any remaining stray bracket-style placeholders
// in active templates so we know if we missed something. Outlook MSO
// conditional comments ([if mso], [endif]) are inside HTML comments
// so we exclude those.
console.log('\nRemaining bracket tokens in active templates (excluding MSO):');
for (const file of ACTIVE_TEMPLATES) {
  const text = fs.readFileSync(path.join(EMAILS_DIR, file), 'utf8');
  // Strip HTML comments first so we don't false-flag [if mso].
  const stripped = text.replace(/<!--[\s\S]*?-->/g, '');
  const tokens = stripped.match(/\[[A-Za-z][^\]]{0,40}\]/g) ?? [];
  const unique = [...new Set(tokens)];
  if (unique.length > 0) {
    console.log(`  ${file}:`, unique.join(' '));
  }
}
