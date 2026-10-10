// Create the Private Arrangement handover WhatsApp templates at Meta.
//
// These are the W2 templates for the held-funds handover: the seller taps
// "Item delivered", the buyer taps "Item received" (releases the payout) or
// "Dispute". They are QUICK_REPLY buttons handled by WhatsappWebhookController
// (message.button.text). Bodies carry ONLY the order reference — never an item
// title (see whatsapp-templates.ts HARD RULE).
//
// Usage (from backend/):
//   node scripts/whatsapp-create-private-arrange-templates.mjs
//   node scripts/whatsapp-create-private-arrange-templates.mjs --list
//
// Idempotent: a template whose name already exists is skipped. Never prints
// secrets. Reads WHATSAPP_WABA_ID + WHATSAPP_TOKEN from backend/.env.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ENV_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env');
const GRAPH = 'https://graph.facebook.com/v21.0';

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

const TEMPLATES = [
  {
    name: 'private_arrange_seller_handover',
    category: 'UTILITY',
    body: "Order {{1}}. If you've handed the item to the buyer, tap Item delivered. If there's a problem, tap Dispute.",
    example: 'AOABCDEF1234',
    buttons: ['Item delivered', 'Dispute'],
  },
  {
    name: 'private_arrange_buyer_confirm',
    category: 'UTILITY',
    body: "Order {{1}}. Once you've received your item, tap Item received to release the seller's payment. If there's a problem, tap Dispute.",
    example: 'AOABCDEF1234',
    buttons: ['Item received', 'Dispute'],
  },
  {
    name: 'private_arrange_buyer_reminder',
    category: 'UTILITY',
    body: 'Reminder for order {{1}}. Please confirm you received your item, or tap Dispute. Payment auto-releases to the seller 5 days after payment.',
    example: 'AOABCDEF1234',
    buttons: ['Item received', 'Dispute'],
  },
];

function payload(t) {
  return {
    name: t.name,
    language: 'en',
    category: t.category,
    components: [
      {
        type: 'BODY',
        text: t.body,
        example: { body_text: [[t.example]] },
      },
      {
        type: 'BUTTONS',
        buttons: t.buttons.map((text) => ({ type: 'QUICK_REPLY', text })),
      },
    ],
  };
}

async function listExisting() {
  const res = await fetch(
    `${GRAPH}/${WABA}/message_templates?limit=200&fields=name,status,language`,
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
  const args = process.argv.slice(2);
  const existing = await listExisting();
  const byName = new Map(existing.map((t) => [t.name, t]));

  if (args.includes('--list')) {
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
      `[created]  ${t.name}  id=${created.id ?? '?'}  status=${created.status ?? created.category ?? 'PENDING'}`,
    );
  }
  console.log('\nDone. New templates sit PENDING until Meta approves them.');
}

main().catch((err) => {
  console.error(`\n${err.message}\n`);
  process.exit(1);
});
