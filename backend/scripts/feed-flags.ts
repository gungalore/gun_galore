// Toggle the community-feed settings in the database.
//
//   cd backend && npm run feed:flags -- on     # enable
//   cd backend && npm run feed:flags -- off    # disable
//
// ⚠️ This writes the live `Setting` rows. Run it against whichever environment
// you mean to change — locally that is the local database; on the box it would
// change production. It exists because the flags ship default-OFF.

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL as string),
});

const KEYS = [
  'feed_enabled',
  'feed_gate_enabled',
  'feed_ads_enabled',
  'feed_awards_enabled',
];

async function main() {
  const mode = (process.argv[2] ?? 'on').toLowerCase();
  const value = mode === 'off' ? 'false' : 'true';
  for (const key of KEYS) {
    await prisma.setting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }
  console.log(`Set ${KEYS.join(', ')} = ${value}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
