import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { HELP_CENTRE_ENTRIES } from './seed-data/help-centre';

// ─── Ask GG Help-Centre seeder ───────────────────────────────────────
// Idempotently upserts the ~50 VERIFIED platform Q&A entries that ground
// Ask GG's searchHelpCentre tool (and the composer's search-first UX).
//
//   npm run seed:help
//
// - Upserts on AskGgKbEntry.sourceKey — rerunning after editing
//   prisma/seed-data/help-centre.ts OVERWRITES the seeded copies (the
//   seed file is the single source of truth for platform copy).
// - Conversation-derived KB entries (sourceKey = null) are never touched.
// - Entries land status=VERIFIED so they surface immediately.
//
// authorId is a required FK — resolved from ASK_GG_KB_SEED_AUTHOR_EMAIL
// (falls back to the operator account) and hard-fails if no such user
// exists, so a typo can't seed entries onto the wrong account.

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

const AUTHOR_EMAIL =
  process.env.ASK_GG_KB_SEED_AUTHOR_EMAIL ?? 'gjpfourie@gmail.com';

async function main() {
  // Duplicate-sourceKey guard — a copy/paste slip in the seed data would
  // otherwise silently overwrite a sibling entry.
  const keys = new Set<string>();
  for (const e of HELP_CENTRE_ENTRIES) {
    if (keys.has(e.sourceKey)) {
      throw new Error(`Duplicate sourceKey in help-centre seed: ${e.sourceKey}`);
    }
    keys.add(e.sourceKey);
  }

  const author = await prisma.user.findFirst({
    where: { email: AUTHOR_EMAIL },
    select: { id: true, email: true },
  });
  if (!author) {
    throw new Error(
      `Help-centre seed author not found: no user with email "${AUTHOR_EMAIL}". ` +
        `Set ASK_GG_KB_SEED_AUTHOR_EMAIL to an existing account's email.`,
    );
  }

  const now = new Date();
  let created = 0;
  let updated = 0;
  for (const e of HELP_CENTRE_ENTRIES) {
    const existing = await prisma.askGgKbEntry.findUnique({
      where: { sourceKey: e.sourceKey },
      select: { id: true },
    });
    await prisma.askGgKbEntry.upsert({
      where: { sourceKey: e.sourceKey },
      create: {
        sourceKey: e.sourceKey,
        authorId: author.id,
        title: e.title,
        question: e.question,
        answer: e.answer,
        category: 'platform',
        tags: e.tags,
        status: 'VERIFIED',
        verifiedAt: now,
      },
      update: {
        title: e.title,
        question: e.question,
        answer: e.answer,
        category: 'platform',
        tags: e.tags,
        status: 'VERIFIED',
        verifiedAt: now,
      },
    });
    if (existing) updated++;
    else created++;
  }

  console.log(
    `Help-centre seed complete: ${created} created, ${updated} updated ` +
      `(${HELP_CENTRE_ENTRIES.length} total), author=${author.email}.`,
  );
}

main()
  .catch((e) => {
    console.error('[seed:help] FAILED:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
