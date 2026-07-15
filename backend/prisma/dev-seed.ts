// Dev-only seed — adds a fake user and a few listings so we can browse the UI.
// Run: npx tsx prisma/dev-seed.ts
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

async function main() {
  console.log('Creating test seller…');
  const seller = await prisma.user.upsert({
    where: { clerkId: 'user_devtour_seller_001' },
    update: {},
    create: {
      clerkId: 'user_devtour_seller_001',
      email: 'tour-seller@gungalore.dev',
      firstName: 'Nathan',
      lastName: 'Tour',
      phone: '0820000000',
      sellerTier: 'TRUSTED',
      trustScore: 87,
      kycStatus: 'VERIFIED',
      kycVerifiedAt: new Date(),
    },
  });
  console.log('  ✓ Seller:', seller.email);

  // Canonical category slugs: Pistols + Centerfire Rifles live UNDER the
  // Firearms parent (firearms--pistols, firearms--centerfire-rifles); rifle
  // scopes are under Optics.
  const pistols = await prisma.category.findUnique({ where: { slug: 'firearms--pistols' } });
  const optics = await prisma.category.findUnique({ where: { slug: 'optics--rifle-scopes' } });
  const rifles = await prisma.category.findUnique({ where: { slug: 'firearms--centerfire-rifles' } });

  if (!pistols || !optics || !rifles) {
    throw new Error('Categories missing — run main prisma/seed.ts first');
  }

  // Clear any prior dev-tour listings to keep things idempotent
  await prisma.listing.deleteMany({ where: { sellerId: seller.id } });

  console.log('Creating BUY_NOW listing…');
  await prisma.listing.create({
    data: {
      sellerId: seller.id,
      categoryId: pistols.id,
      title: 'Glock 19 Gen 5 — Excellent Condition',
      description:
        'Lightly used Glock 19 Gen 5 in immaculate condition. Comes with two 15-round magazines, original case, manual, and cleaning brush. Approximately 250 rounds through it. Always cleaned and stored in a safe. Full transferable papers ready.',
      price: 1495000, // R14,950
      listingType: 'BUY_NOW',
      status: 'ACTIVE',
      condition: 'LIKE_NEW',
      province: 'GAUTENG',
      isFirearm: true,
      make: 'Glock',
      model: '19 Gen 5',
      calibre: '9mm Parabellum',
      passFeeToBuyer: false,
    },
  });

  console.log('Creating AUCTION listing…');
  const startTime = new Date();
  const endTime = new Date(startTime.getTime() + 5 * 24 * 60 * 60 * 1000);
  await prisma.listing.create({
    data: {
      sellerId: seller.id,
      categoryId: rifles.id,
      title: 'CZ 457 Varmint .22LR — Collector Piece',
      description:
        'Beautiful CZ 457 Varmint chambered in .22LR. Heavy barrel, walnut stock, factory adjustable trigger. Has only seen the range a handful of times. Test groups consistently under MOA at 50m with quality ammo.',
      price: 2295000, // R22,950 starting bid
      listingType: 'AUCTION',
      status: 'ACTIVE',
      condition: 'GOOD',
      province: 'WESTERN_CAPE',
      isFirearm: true,
      make: 'CZ',
      model: '457 Varmint',
      calibre: '.22LR',
      passFeeToBuyer: false,
      reservePrice: 2800000, // R28,000 hidden reserve
      buyNowPrice: 3500000, // R35,000 Buy Now (only while 0 bids)
      durationDays: 5,
      startTime,
      endTime,
    },
  });

  console.log('Creating TAKE_A_SHOT listing…');
  await prisma.listing.create({
    data: {
      sellerId: seller.id,
      categoryId: optics.id,
      title: 'Vortex Strike Eagle 1-8x24 — Make Me An Offer',
      description:
        'Vortex Strike Eagle 1-8x24 FFP scope with illuminated AR-BDC3 reticle. Mint condition, less than 100 rounds underneath it. Comes with original Vortex box, lens covers, and sunshade. No reasonable offer refused.',
      price: null, // TAKE_A_SHOT must not have a price
      listingType: 'TAKE_A_SHOT',
      status: 'ACTIVE',
      condition: 'LIKE_NEW',
      province: 'GAUTENG',
      isFirearm: false,
      make: 'Vortex',
      model: 'Strike Eagle 1-8x24',
      calibre: null,
      passFeeToBuyer: false,
      autoAcceptThreshold: 1100000, // R11,000 — hidden from buyers
    },
  });

  // Pending-review listing — gives the admin moderation queue something to
  // demonstrate. Pretend Claude flagged it as ambiguous ammunition.
  console.log('Creating PENDING_REVIEW listing (with Claude metadata)…');
  await prisma.listing.create({
    data: {
      sellerId: seller.id,
      categoryId: pistols.id,
      title: 'CZ 75 SP-01 Shadow 2 — pristine, with extras',
      description:
        'CZ 75 SP-01 Shadow 2 9mm, fired roughly 800 rounds in total. Comes with 3x 19-round magazines, two grip variants (Aluminium + LokGrip), competition trigger spring kit fitted, and a soft case.',
      price: 2895000, // R28,950 — over the R20,000 high-value threshold
      listingType: 'BUY_NOW',
      status: 'PENDING_REVIEW',
      condition: 'GOOD',
      province: 'WESTERN_CAPE',
      isFirearm: true,
      make: 'CZ',
      model: '75 SP-01 Shadow 2',
      calibre: '9mm Parabellum',
      passFeeToBuyer: false,
      claudeDecision: 'HUMAN_REVIEW',
      claudeConfidence: 0.78,
      claudeReasons: [
        'High-value listing (>= R20,000)',
        'Mentions "competition trigger spring kit" — verify legal modification',
        'Approve content otherwise looks legitimate',
      ],
      claudeReviewedAt: new Date(),
      claudeAutoFixApplied: false,
    },
  });

  // Auto-fixed listing — shows the AUTO_FIX_AND_APPROVE badge.
  console.log('Creating AUTO_FIX_AND_APPROVE listing…');
  await prisma.listing.create({
    data: {
      sellerId: seller.id,
      categoryId: optics.id,
      title: 'Bushnell Banner 3-9x40 — perfect entry-level scope',
      description:
        'Bushnell Banner 3-9x40 hunting scope. Multi-coated optics, fully waterproof, fogproof, and shockproof. Comes with the original box and lens covers. WhatsApp me on [REDACTED] for more info.',
      price: 295000, // R2,950
      listingType: 'BUY_NOW',
      status: 'ACTIVE',
      condition: 'GOOD',
      province: 'GAUTENG',
      isFirearm: false,
      make: 'Bushnell',
      model: 'Banner 3-9x40',
      calibre: null,
      passFeeToBuyer: false,
      claudeDecision: 'AUTO_FIX_AND_APPROVE',
      claudeConfidence: 0.92,
      claudeReasons: ['Description contained a phone number — stripped'],
      claudeReviewedAt: new Date(),
      claudeAutoFixApplied: true,
      claudeOriginalDescription:
        'Bushnell Banner 3-9x40 hunting scope. Multi-coated optics, fully waterproof, fogproof, and shockproof. Comes with the original box and lens covers. WhatsApp me on 082 555 1234 for more info.',
    },
  });

  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
