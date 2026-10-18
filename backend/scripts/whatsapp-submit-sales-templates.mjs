// Submit the sales + document WhatsApp templates to Meta.
//
// These are the templates added when WhatsApp was re-scoped away from shipping
// (Bob Go owns shipping) and onto sales/document notifications:
//   dealer collection, offers, outbid, auction won, and the three motivation
//   outcomes.
//
// ⚠️ Meta blocks NEW English templates for ~6 days after any English template
// is deleted (error subcode 2388023). If a create fails with that subcode, do
// NOT delete/retry in a loop — wait for the lock to clear, then rerun this
// script. It is idempotent and will create only what is missing.
//
// The bodies mirror backend/src/whatsapp/whatsapp-templates.ts exactly. They
// carry NO listing title, price or firearm detail — only the MO reference where
// one exists. The five offer/auction templates use a fully STATIC URL button
// (…/t/r, /t/y, /t/w); the code sends no button parameter for those. The
// motivation templates use …/t/{{1}} and the code sends m<motivationId>.
//
// Usage (from backend/):
//   node scripts/whatsapp-submit-sales-templates.mjs --list
//   node scripts/whatsapp-submit-sales-templates.mjs
//
// Idempotent: an existing template name is skipped, never edited. Editing an
// approved template resets it to PENDING and pauses live sends.
// Never prints secrets. Reads WHATSAPP_WABA_ID + WHATSAPP_TOKEN from backend/.env.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ENV_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env');
const GRAPH = 'https://graph.facebook.com/v21.0';
const SITE = 'https://alloutdoor.co.za';

if (!existsSync(ENV_PATH)) {
  console.error('backend/.env not found');
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(ENV_PATH, 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);
const WABA = env.WHATSAPP_WABA_ID;
const TOKEN = env.WHATSAPP_TOKEN;
if (!WABA || !TOKEN) {
  console.error('WHATSAPP_WABA_ID / WHATSAPP_TOKEN missing in backend/.env');
  process.exit(1);
}

/**
 * @type {Array<{
 *   name: string;
 *   body: string;
 *   example?: string;
 *   button: { text: string; code: string; dynamic?: boolean };
 * }>}
 */
const TEMPLATES = [
  {
    name: 'dealer_collection_ready_buyer',
    body: 'Order {{1}} is ready for collection at your chosen dealer. Bring your identity document and your licence paperwork.',
    example: 'AOABCDEF1234',
    button: { text: 'View order', code: 't{{1}}', dynamic: true },
  },
  {
    name: 'offer_received_seller',
    body: 'You have a new offer on one of your listings. Open it to accept, reject or counter.',
    button: { text: 'View offer', code: 'r' },
  },
  {
    name: 'offer_accepted_buyer',
    body: 'An offer you made was accepted. Pay within 24 hours to secure the item.',
    button: { text: 'View offers', code: 'y' },
  },
  {
    name: 'offer_countered_buyer',
    body: 'The seller countered your offer. Review it and respond within 24 hours.',
    button: { text: 'Review counter', code: 'y' },
  },
  {
    name: 'bid_outbid_buyer',
    body: 'You have been outbid on an auction. Bid again before it closes.',
    button: { text: 'View bids', code: 'w' },
  },
  {
    name: 'auction_won_buyer',
    body: 'You won an auction. Pay within 24 hours to secure it.',
    button: { text: 'View bids', code: 'w' },
  },
  {
    name: 'motivation_ready_applicant',
    body: 'Document {{1}} is ready. Open it to read it through and download the pack.',
    example: 'MO000123',
    button: { text: 'Open document', code: 'm{{1}}', dynamic: true },
  },
  {
    name: 'motivation_needs_info_applicant',
    body: 'Document {{1}} needs a bit more detail. Open it to add what is missing.',
    example: 'MO000123',
    button: { text: 'Open document', code: 'm{{1}}', dynamic: true },
  },
  {
    name: 'motivation_failed_applicant',
    body: 'We could not finish document {{1}}. Nothing is lost and nothing has been charged. Open it and try again.',
    example: 'MO000123',
    button: { text: 'Open document', code: 'm{{1}}', dynamic: true },
  },
];

function payload(t) {
  const components = [
    {
      type: 'BODY',
      text: t.body,
      ...(t.example ? { example: { body_text: [[t.example]] } } : {}),
    },
  ];
  if (t.button.dynamic) {
    // The approved template's URL is the /t/ base + ONE variable; the code
    // sends the whole short code (t<txId> / m<motivationId>) as that variable.
    // So the URL must be /t/{{1}}, NOT /t/m{{1}} — the prefix lives in the
    // parameter, exactly as it does on the already-approved templates.
    const exampleCode = t.button.code.replace(
      '{{1}}',
      'clhq3v9m0000abc123defg',
    );
    components.push({
      type: 'BUTTONS',
      buttons: [
        {
          type: 'URL',
          text: t.button.text,
          url: `${SITE}/t/{{1}}`,
          example: [`${SITE}/t/${exampleCode}`],
        },
      ],
    });
  } else {
    components.push({
      type: 'BUTTONS',
      buttons: [
        {
          type: 'URL',
          text: t.button.text,
          url: `${SITE}/t/${t.button.code}`,
        },
      ],
    });
  }
  return {
    name: t.name,
    language: 'en',
    category: 'UTILITY',
    components,
  };
}

async function listAll() {
  const res = await fetch(
    `${GRAPH}/${WABA}/message_templates?limit=200&fields=name,status,category,language`,
    { headers: { Authorization: `Bearer ${TOKEN}` } },
  );
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`list failed: ${res.status} ${JSON.stringify(json.error ?? json)}`);
  }
  return json.data ?? [];
}

async function create(t) {
  const res = await fetch(`${GRAPH}/${WABA}/message_templates`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload(t)),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      `create ${t.name} failed: ${res.status} ${JSON.stringify(json.error ?? json)}`,
    );
  }
  return json;
}

async function main() {
  const all = await listAll();
  const byName = new Map(all.map((t) => [t.name, t]));

  if (process.argv.includes('--list')) {
    for (const t of all) {
      console.log(`[${t.status ?? '?'}]  ${t.name}  (${t.language ?? '?'})`);
    }
    console.log('\nManaged by this script:');
    for (const t of TEMPLATES) {
      const now = byName.get(t.name);
      console.log(`  ${now ? `[${now.status}]` : '[missing]'}  ${t.name}`);
    }
    return;
  }

  for (const t of TEMPLATES) {
    const now = byName.get(t.name);
    if (now) {
      console.log(`[skip]     ${t.name} already exists (${now.status})`);
      continue;
    }
    const created = await create(t);
    console.log(
      `[created]  ${t.name}  id=${created.id ?? '?'}  status=${created.status ?? 'PENDING'}`,
    );
  }
  console.log('\nDone. New templates sit PENDING until Meta approves them.');
}

main().catch((err) => {
  console.error(`\n${err.message}\n`);
  process.exit(1);
});
