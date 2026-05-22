// Smoke-test the shipping webhook handlers end-to-end via the public API.
//
// What this covers:
//  1. POST /shipping/webhook/tcg with an unknown waybill — should 200 and noop.
//  2. POST /shipping/webhook/pudo with an unknown tracking code — should 200 and noop.
//  3. Create a fake transaction with trackingReference, then POST a TCG event
//     and assert shippingStatus + dispatchedAt updated.
//  4. POST a second TCG event for the same waybill (status DELIVERED) and
//     assert deliveredAt is set.
//  5. POST a third TCG event going BACKWARDS (status COLLECTED) — should be
//     rejected (idempotency / backward-prevention).
//
// Peach webhook HMAC verification is unit-tested separately because it needs
// raw-body wiring.
//
// Run: npx tsx prisma/dev-test-webhooks.ts
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

const API = 'http://localhost:3001/api';

async function main() {
  console.log('=== Webhook smoke test ===\n');

  // ---- 1. Unknown waybill -------------------------------------------
  console.log('1. TCG webhook with unknown waybill');
  const r1 = await fetch(`${API}/shipping/webhook/tcg`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'parcel_tracking_event',
      waybillNumber: 'BOGUS-12345',
      status: 'in transit',
    }),
  });
  console.log(`   status: ${r1.status} (expected 200)`);

  // ---- 2. Unknown Pudo code -----------------------------------------
  console.log('2. Pudo webhook with unknown tracking code');
  const r2 = await fetch(`${API}/shipping/webhook/pudo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      trackingCode: 'BOGUS-PUDO-99',
      status: 'delivered',
    }),
  });
  console.log(`   status: ${r2.status} (expected 200)`);

  // ---- 3. Create test transaction with a real tracking number ------
  console.log('\n3. Setting up a real transaction…');
  const buyer = await prisma.user.upsert({
    where: { clerkId: 'user_webhook_buyer' },
    create: {
      clerkId: 'user_webhook_buyer',
      email: 'webhook-buyer@test.dev',
      firstName: 'Web',
      lastName: 'Hook',
      kycStatus: 'VERIFIED',
    },
    update: {},
  });
  const seller = await prisma.user.findUnique({
    where: { clerkId: 'user_devtour_seller_001' },
  });
  if (!seller) throw new Error('seed first — seller missing');

  const listing = await prisma.listing.findFirst({
    where: { sellerId: seller.id, listingType: 'BUY_NOW', status: 'ACTIVE' },
  });
  if (!listing) throw new Error('seed first — no active BUY_NOW listing');

  // Clean up any prior test transaction so we can re-run
  await prisma.transaction.deleteMany({
    where: { trackingReference: 'WEBHOOK-TEST-001' },
  });

  const tx = await prisma.transaction.create({
    data: {
      listingId: listing.id,
      buyerId: buyer.id,
      sellerId: seller.id,
      listingPrice: listing.price ?? 0,
      commissionZar: 0,
      processingFee: 0,
      passFeeToBuyer: false,
      buyerTotal: listing.price ?? 0,
      sellerPayout: listing.price ?? 0,
      paymentStatus: 'HELD',
      trackingReference: 'WEBHOOK-TEST-001',
      shippingMethod: 'TCG',
      paidAt: new Date(),
    },
  });
  console.log(`   created tx ${tx.id} with tracking WEBHOOK-TEST-001`);

  // ---- 4. TCG OUT_FOR_DELIVERY ---------------------------------------
  console.log('\n4. TCG event: out for delivery');
  const r4 = await fetch(`${API}/shipping/webhook/tcg`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'parcel_tracking_event',
      waybillNumber: 'WEBHOOK-TEST-001',
      status: 'out for delivery',
    }),
  });
  console.log(`   status: ${r4.status}`);
  const after4 = await prisma.transaction.findUnique({ where: { id: tx.id } });
  console.log(`   shippingStatus: ${after4?.shippingStatus} (expected OUT_FOR_DELIVERY)`);
  console.log(`   dispatchedAt set: ${after4?.dispatchedAt !== null}`);

  // ---- 5. TCG DELIVERED ----------------------------------------------
  console.log('\n5. TCG event: delivered');
  const r5 = await fetch(`${API}/shipping/webhook/tcg`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'parcel_tracking_event',
      waybillNumber: 'WEBHOOK-TEST-001',
      status: 'delivered',
    }),
  });
  console.log(`   status: ${r5.status}`);
  const after5 = await prisma.transaction.findUnique({ where: { id: tx.id } });
  console.log(`   shippingStatus: ${after5?.shippingStatus} (expected DELIVERED)`);
  console.log(`   deliveredAt set: ${after5?.deliveredAt !== null}`);

  // ---- 6. Backward transition rejected -------------------------------
  console.log('\n6. TCG backward event: collected (after delivered)');
  const r6 = await fetch(`${API}/shipping/webhook/tcg`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'parcel_tracking_event',
      waybillNumber: 'WEBHOOK-TEST-001',
      status: 'collected',
    }),
  });
  console.log(`   status: ${r6.status}`);
  const after6 = await prisma.transaction.findUnique({ where: { id: tx.id } });
  console.log(`   shippingStatus stayed: ${after6?.shippingStatus} (expected DELIVERED — backward rejected)`);

  // ---- 7. Same event twice (idempotency) -----------------------------
  console.log('\n7. TCG repeat event: delivered (idempotency check)');
  const beforeDelivered = after6?.deliveredAt;
  await fetch(`${API}/shipping/webhook/tcg`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'parcel_tracking_event',
      waybillNumber: 'WEBHOOK-TEST-001',
      status: 'delivered',
    }),
  });
  const after7 = await prisma.transaction.findUnique({ where: { id: tx.id } });
  console.log(
    `   deliveredAt unchanged: ${after7?.deliveredAt?.toISOString() === beforeDelivered?.toISOString()}`,
  );

  // ---- Cleanup -------------------------------------------------------
  await prisma.transaction.delete({ where: { id: tx.id } });
  console.log('\nCleanup done.');
  console.log('\n=== End ===');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
