// Render-test every active email template with sample data and write
// the output to data/email-previews/. Lets us eyeball the result + see
// any missing placeholders without sending real emails.
//
// Run from backend/ as:  node scripts/render-email-templates.mjs
// Output:                data/email-previews/*.html

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(
  __dirname,
  '..',
  'src',
  'modules',
  'notifications',
  'templates',
  'emails',
);
const OUT_DIR = path.join(__dirname, '..', 'data', 'email-previews');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// Sample data per template — should be a superset of every placeholder
// any active template might use.
const SAMPLE = {
  itemTitle: 'Bergara B14 HMR .308 Win',
  amount: 'R 18,500.00',
  listPrice: 'R 19,500.00',
  counterAmount: 'R 19,000.00',
  reference: 'AB12CD34',
  date: '20 May 2026',
  reason: 'Photos include a phone number sticker on the rifle case.',
  retryCount: 1,
  buyerName: 'Pieter van der Merwe',
  sellerName: 'Jaco Botha',
  firstName: 'Jaco',
  attempt: 2,
  bank: 'FNB',
  last4: '4421',
  refundDestination: 'Visa ending 4421',
  listingTypeLabel: 'Buy now',
  shippingMethodLabel: 'Pudo Locker',
  courier: 'Pudo',
  trackingUrl: 'https://gungalore.co.za/transactions/abc123',
  waybill: 'PUD-7788-XYZ',
  ctaUrl: 'https://gungalore.co.za/preview-cta',
};

// Minimal Handlebars-style renderer that mirrors EmailTemplatesService.
function render(tpl, vars) {
  let out = tpl;
  for (let p = 0; p < 2; p++) {
    out = out.replace(
      /\{\{#if\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g,
      (_, k, body) => (truthy(vars[k]) ? body : ''),
    );
    out = out.replace(
      /\{\{#unless\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/unless\}\}/g,
      (_, k, body) => (truthy(vars[k]) ? '' : body),
    );
  }
  out = out.replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_, k) =>
    vars[k] == null ? '' : String(vars[k]),
  );
  out = out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) =>
    vars[k] == null ? '' : escapeHtml(String(vars[k])),
  );
  return out;
}
function truthy(v) {
  if (v == null) return false;
  if (typeof v === 'string') return v.length > 0;
  if (typeof v === 'number') return v !== 0;
  return Boolean(v);
}
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const ACTIVE = [
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

let warnings = 0;
for (const file of ACTIVE) {
  const tpl = fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf8');
  const html = render(tpl, SAMPLE);
  fs.writeFileSync(path.join(OUT_DIR, file), html);

  // Surface any placeholders that survived the render — usually
  // means our SAMPLE map is missing the var name.
  const stragglers = html.match(/\{\{[^}]+\}\}/g) ?? [];
  if (stragglers.length > 0) {
    warnings += 1;
    console.warn(`  ${file}: unresolved →`, [...new Set(stragglers)].join(' '));
  } else {
    console.log(`  ${file}: ok`);
  }
}
console.log(
  `\nRendered ${ACTIVE.length} templates to ${OUT_DIR}` +
    (warnings ? ` (${warnings} with unresolved vars)` : ''),
);
