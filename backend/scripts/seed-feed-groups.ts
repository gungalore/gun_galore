// Idempotently seed the community topic groups. Separate from prisma/seed.ts
// (which builds the catalogue) so it can be run on its own.
//
//   cd backend && npx ts-node --transpile-only --project tsconfig.json -r dotenv/config scripts/seed-feed-groups.ts
//
// Groups are admin-created and members only (join/leave); they mirror the nine
// post types. No weapon-word guard here: groups sit behind the members-only
// gate and are noindex, so the public-URL rule does not apply.

import { PrismaClient, PostType } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL as string),
});

const GROUPS: Array<{
  slug: string;
  name: string;
  description: string;
  type: PostType;
  sortOrder: number;
}> = [
  { slug: 'general', name: 'General & Community', description: 'Anything outdoor that does not fit elsewhere.', type: PostType.GENERAL, sortOrder: 0 },
  { slug: 'hunting', name: 'Hunting', description: 'Trips, field reports, and hunting discussion.', type: PostType.HUNTING, sortOrder: 1 },
  { slug: 'firearms-shooting', name: 'Firearms & Shooting', description: 'Range days, equipment and safe handling.', type: PostType.FIREARMS_SHOOTING, sortOrder: 2 },
  { slug: 'reloading', name: 'Reloading', description: 'Loads, components and benches.', type: PostType.RELOADING, sortOrder: 3 },
  { slug: 'fishing', name: 'Fishing', description: 'Rock and surf, bass, fly and everything in between.', type: PostType.FISHING, sortOrder: 4 },
  { slug: 'overlanding-4x4', name: 'Overlanding & 4x4', description: 'Trails, builds and trip planning.', type: PostType.OVERLANDING_4X4, sortOrder: 5 },
  { slug: 'camping-bushcraft', name: 'Camping & Bushcraft', description: 'Campsites, gear and time outside.', type: PostType.CAMPING_BUSHCRAFT, sortOrder: 6 },
  { slug: 'gear-reviews', name: 'Gear & Reviews', description: 'First-hand reviews of what works.', type: PostType.GEAR_REVIEWS, sortOrder: 7 },
  { slug: 'questions-advice', name: 'Questions & Advice', description: 'Ask the community.', type: PostType.QUESTIONS_ADVICE, sortOrder: 8 },
];

async function main() {
  for (const g of GROUPS) {
    await prisma.group.upsert({
      where: { slug: g.slug },
      create: g,
      update: {
        name: g.name,
        description: g.description,
        type: g.type,
        sortOrder: g.sortOrder,
      },
    });
  }
  console.log(`Seeded ${GROUPS.length} community groups.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
