// Smoke test the raffle draw mechanism end-to-end.
// Adds a postal entry + simulated paid tickets, closes the raffle, runs the draw.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateRef(): string {
  let s = '';
  for (let i = 0; i < 8; i += 1) {
    s += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)];
  }
  return s;
}

async function main() {
  const raffle = await prisma.raffle.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
  });
  if (!raffle) throw new Error('No active raffle — run dev-seed first.');
  console.log('Using raffle:', raffle.title, raffle.id);

  // Create 3 test buyers
  const buyers = await Promise.all(
    ['buyerX', 'buyerY', 'buyerZ'].map((c) =>
      prisma.user.upsert({
        where: { clerkId: 'user_' + c },
        create: {
          clerkId: 'user_' + c,
          email: `${c}@test.dev`,
          firstName: c.replace('buyer', ''),
          lastName: 'Test',
          kycStatus: 'VERIFIED',
        },
        update: {},
      }),
    ),
  );

  // Each buyer gets 50 tickets — comfortably above the min-required (125)
  console.log('Creating 150 confirmed tickets across 3 buyers…');
  let ticketNumber = 1;
  for (const b of buyers) {
    for (let i = 0; i < 50; i += 1) {
      await prisma.ticket.create({
        data: {
          raffleId: raffle.id,
          buyerId: b.id,
          ticketNumber: ticketNumber++,
          referenceCode: generateRef(),
          status: 'CONFIRMED',
          amountCents: raffle.ticketPriceCents,
          paidAt: new Date(),
        },
      });
    }
  }

  // Throw in one postal entry too (with 2 tickets)
  console.log('Adding postal entry…');
  const entry = await prisma.postalEntry.create({
    data: {
      raffleId: raffle.id,
      referenceCode: generateRef(),
      firstName: 'Sarah',
      lastName: 'Postal',
      address: 'PO Box 42, Pretoria',
      enteredByAdminId: 'admin-test',
    },
  });
  for (let i = 0; i < 2; i += 1) {
    await prisma.ticket.create({
      data: {
        raffleId: raffle.id,
        ticketNumber: ticketNumber++,
        referenceCode: generateRef(),
        status: 'POSTAL',
        postalEntryId: entry.id,
      },
    });
  }

  // Update the counters
  await prisma.raffle.update({
    where: { id: raffle.id },
    data: {
      ticketsSoldPaid: 150,
      ticketsSoldPostal: 2,
      // Close immediately (skip cooling window for test)
      status: 'CLOSED_AWAITING_DRAW',
      drawAt: new Date(Date.now() - 1000),
    },
  });

  await prisma.raffleAuditEvent.create({
    data: {
      raffleId: raffle.id,
      eventType: 'TICKETS_CONFIRMED',
      payloadJson: JSON.stringify({ count: 150 }),
    },
  });
  await prisma.raffleAuditEvent.create({
    data: {
      raffleId: raffle.id,
      eventType: 'POSTAL_ENTRY_ADDED',
      payloadJson: JSON.stringify({ entryId: entry.id, ticketCount: 2 }),
    },
  });
  await prisma.raffleAuditEvent.create({
    data: {
      raffleId: raffle.id,
      eventType: 'CLOSED',
      payloadJson: null,
    },
  });

  console.log('Triggering draw via API…');
  // We hit the admin endpoint to run the draw.
  const adminToken = await getAdminToken();
  const res = await fetch(
    `http://localhost:3001/api/admin/raffles/${raffle.id}/run-draw`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    },
  );
  console.log('  draw response:', res.status, await res.text());

  const winners = await prisma.raffleWinner.findMany({
    where: { raffleId: raffle.id },
    orderBy: { position: 'asc' },
    include: { user: true },
  });
  console.log(`\nWinners (${winners.length}):`);
  for (const w of winners) {
    console.log(
      `  #${w.position}: ${w.user?.firstName ?? 'POSTAL'} — ticket ${w.ticketId.slice(0, 12)}…`,
    );
  }

  const proof = await prisma.raffle.findUnique({
    where: { id: raffle.id },
    select: { drawSeed: true, drawSeedHash: true, drawnAt: true },
  });
  console.log('\nDraw proof:');
  console.log('  seed:', proof?.drawSeed?.slice(0, 32), '…');
  console.log('  hash:', proof?.drawSeedHash?.slice(0, 32), '…');
  console.log('  drawnAt:', proof?.drawnAt);
}

async function getAdminToken(): Promise<string> {
  const res = await fetch('http://localhost:3001/api/admin/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@gungalore.co.za',
      password: 'Admin@GunGalore1!',
    }),
  });
  const data = await res.json();
  return data.token;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
