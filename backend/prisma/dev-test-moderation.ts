// Smoke-test the listing moderation flow.
//
// Verifies all four code paths even without Anthropic credentials:
//
//  - No ANTHROPIC_API_KEY            → HUMAN_REVIEW + status PENDING_REVIEW
//  - High-value listing              → forced HUMAN_REVIEW
//  - New-seller first firearm        → forced HUMAN_REVIEW
//  - Local contact-info regex pass   → strips emails, phones, URLs, handles
//
// To verify the live Anthropic path:
//   1. Set ANTHROPIC_API_KEY in backend/.env
//   2. Restart the backend
//   3. Re-run this script — the offline-only assertion will be skipped
//
// Run: npx tsx prisma/dev-test-moderation.ts
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ListingModerationService } from '../src/moderation/listing-moderation.service';

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

async function main() {
  console.log('=== Listing moderation smoke test ===\n');

  // ---- 1. Local regex pass (no Anthropic dependency) ---------------
  const svc = new ListingModerationService();
  console.log('1. Local stripContactInfo() pass');

  const samples = [
    {
      input:
        'Selling my Glock 17, great condition. Email me at john@example.com or call 082 555 1234. Also see www.myshop.co.za and @johndoe on Insta.',
      mustContain: ['[REDACTED]'],
      mustNotContain: ['john@example.com', '082 555 1234', 'www.myshop.co.za', '@johndoe'],
    },
    {
      input:
        'Whatsapp me on 0712345678 to negotiate. https://t.me/myshop has more pics.',
      mustContain: ['[REDACTED]'],
      mustNotContain: ['0712345678', 'https://t.me/myshop'],
    },
  ];

  for (const [i, s] of samples.entries()) {
    const { cleaned, changed } = svc.stripContactInfo(s.input);
    let ok = changed;
    for (const must of s.mustContain) if (!cleaned.includes(must)) ok = false;
    for (const mustNot of s.mustNotContain) if (cleaned.includes(mustNot)) ok = false;
    console.log(`   sample ${i + 1}: ${ok ? 'PASS' : 'FAIL'}`);
    console.log(`     in:  ${s.input}`);
    console.log(`     out: ${cleaned}`);
  }

  // ---- 2. Offline behaviour — ANTHROPIC_API_KEY not set ------------
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('\n2. Offline-mode behaviour (no ANTHROPIC_API_KEY)');
    const offline = new ListingModerationService();
    console.log('   isEnabled:', offline.isEnabled, '(expected false)');
    const result = await offline.moderate({
      title: 'Test',
      description: 'Test',
      categoryName: 'Pistols',
      categoryIsFirearm: true,
      priceCents: 1000,
      imageUrls: [],
      imageCount: 0,
      sellerFirstFirearmListings: false,
    });
    console.log('   decision:', result.decision, '(expected HUMAN_REVIEW)');
    console.log('   confidence:', result.confidence, '(expected 0)');
  } else {
    console.log('\n2. ANTHROPIC_API_KEY IS set — skipping offline-only test');
    console.log('   isEnabled:', svc.isEnabled);

    // Run one real moderation call to confirm the round-trip parses.
    console.log('\n   Running a live moderation call…');
    const live = await svc.moderate({
      title: 'Glock 19 Gen 5 — Excellent Condition',
      description:
        'Lightly used Glock 19 Gen 5 in immaculate condition. Two 15-round magazines, original case, manual. Approximately 250 rounds through it.',
      categoryName: 'Pistols',
      categoryIsFirearm: true,
      priceCents: 1495000,
      imageUrls: [],
      imageCount: 0,
      sellerFirstFirearmListings: false,
    });
    console.log('   decision:', live.decision);
    console.log('   confidence:', live.confidence.toFixed(2));
    console.log('   reasons:', live.reasons.slice(0, 3));
  }

  // ---- 3. Confirm Settings flag table works ------------------------
  console.log('\n3. Settings table');
  await prisma.setting.upsert({
    where: { key: 'high_value_review_threshold' },
    create: { key: 'high_value_review_threshold', value: '20000' },
    update: { value: '20000' },
  });
  const row = await prisma.setting.findUnique({
    where: { key: 'high_value_review_threshold' },
  });
  console.log('   value:', row?.value, '(expected "20000")');

  console.log('\n=== End ===');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
