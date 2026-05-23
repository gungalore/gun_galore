// Send a single real SMS via SMSPortal to validate the prod SMS
// pipeline end-to-end. Sends the coming-soon bypass URL so the
// recipient can tap it on their phone to land on the real site —
// useful for verifying that:
//
//   1. SMSPortal LIVE credentials work in production
//   2. The phone receives the SMS within a few seconds
//   3. The URL in the SMS is tappable + opens in the phone's browser
//   4. The phone can actually reach https://gungalore.co.za
//      (DNS, Cloudflare, nginx, Next.js all wired up)
//
// Usage:
//   node scripts/send-prod-sms-test.mjs <phone>
//
// Example:
//   node scripts/send-prod-sms-test.mjs 0743039999
//   node scripts/send-prod-sms-test.mjs +27743039999
//
// Phone is normalised to E.164 (+27...) before sending. The script
// also logs the attempt to SmsLog so it shows up in /admin/health
// alongside production SMS traffic.

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const c = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', cyan: '\x1b[36m',
};

const phoneArg = process.argv[2];
if (!phoneArg) {
  console.error(`${c.red}Missing phone arg.${c.reset}`);
  console.error('Usage: node scripts/send-prod-sms-test.mjs <phone>');
  process.exit(1);
}

function normalise(raw) {
  let n = raw.replace(/[\s\-()]/g, '');
  if (n.startsWith('0')) n = '+27' + n.slice(1);
  else if (n.startsWith('27')) n = '+' + n;
  if (!/^\+27\d{9}$/.test(n)) return null;
  return n;
}

const phone = normalise(phoneArg);
if (!phone) {
  console.error(`${c.red}Invalid SA mobile: "${phoneArg}"${c.reset}`);
  console.error('Expected formats: 0821234567 or +27821234567');
  process.exit(1);
}

const bypassSecret = process.env.COMING_SOON_BYPASS_SECRET;
const frontendUrl = process.env.FRONTEND_URL ?? 'https://gungalore.co.za';

if (!bypassSecret) {
  console.error(`${c.red}COMING_SOON_BYPASS_SECRET missing from env.${c.reset}`);
  console.error(`Add it to backend/.env or use frontend's COMING_SOON_BYPASS_SECRET value.`);
  process.exit(1);
}

const url = `${frontendUrl}/preview?key=${bypassSecret}`;
const message = `Gun Galore preview access: ${url}`;

console.log(`\n${c.bold}${c.cyan}═══════════════════════════════════════════════════════════${c.reset}`);
console.log(`${c.bold}  Sending SMS via SMSPortal LIVE${c.reset}`);
console.log(`    To:       ${phone}`);
console.log(`    Length:   ${message.length} chars (limit 160 = 1 segment)`);
console.log(`    Message:  ${message}`);
console.log(`${c.bold}${c.cyan}═══════════════════════════════════════════════════════════${c.reset}\n`);

const clientId =
  process.env.SMSPORTAL_CLIENT_ID ?? process.env.SMSPORTAL_API_KEY;
const apiSecret = process.env.SMSPORTAL_API_SECRET;
const baseUrl =
  process.env.SMSPORTAL_BASE_URL ?? 'https://rest.smsportal.com/v1';

if (!clientId || !apiSecret) {
  console.error(`${c.red}SMSPortal not configured. Need SMSPORTAL_CLIENT_ID + SMSPORTAL_API_SECRET.${c.reset}`);
  process.exit(1);
}

// Auth — SMSPortal uses Basic <base64(id:secret)> to fetch a bearer.
const basic = Buffer.from(`${clientId}:${apiSecret}`).toString('base64');

console.log(`▶ Authenticating with SMSPortal...`);
const authRes = await fetch(`${baseUrl}/Authentication`, {
  headers: { Authorization: `Basic ${basic}` },
});
if (!authRes.ok) {
  const body = await authRes.text();
  console.error(`${c.red}Auth failed: HTTP ${authRes.status}${c.reset}`);
  console.error(body);
  process.exit(1);
}
const auth = await authRes.json();
const token = auth.token;
if (!token) {
  console.error(`${c.red}No token in auth response.${c.reset}`);
  console.error(JSON.stringify(auth, null, 2));
  process.exit(1);
}
console.log(`  ${c.green}✓${c.reset} got bearer token`);

console.log(`▶ Sending message...`);
const sendRes = await fetch(`${baseUrl}/BulkMessages`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    messages: [{ content: message, destination: phone }],
  }),
});

const sendBody = await sendRes.text();
let parsed;
try { parsed = JSON.parse(sendBody); } catch { parsed = sendBody; }

if (!sendRes.ok) {
  console.error(`${c.red}Send failed: HTTP ${sendRes.status}${c.reset}`);
  console.error(typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2));

  await prisma.smsLog.create({
    data: {
      to: phone,
      message,
      reference: `prod-test-${Date.now()}`,
      status: 'FAILED',
      error: `HTTP ${sendRes.status}: ${typeof parsed === 'string' ? parsed.slice(0, 200) : JSON.stringify(parsed).slice(0, 200)}`,
    },
  });
  await prisma.$disconnect();
  process.exit(1);
}

console.log(`  ${c.green}✓${c.reset} SMS accepted by SMSPortal`);
console.log(`\n  Response:`);
console.log(`  ${c.dim}${JSON.stringify(parsed, null, 2).split('\n').join('\n  ')}${c.reset}\n`);

await prisma.smsLog.create({
  data: {
    to: phone,
    message,
    reference: `prod-test-${Date.now()}`,
    status: 'SENT',
  },
});

console.log(`${c.bold}${c.green}✓ Check your phone — SMS should arrive in 5-15 seconds.${c.reset}`);
console.log(`${c.dim}  Tapping the link will set the gg-preview cookie on your phone${c.reset}`);
console.log(`${c.dim}  so the site stays unlocked from there for 30 days.${c.reset}\n`);

await prisma.$disconnect();
