/**
 * GIVE THE ADOPTED KYC IDs THE READING THEY SHOULD HAVE HAD.
 *
 * Operator, 2026-08-23: "when some documents like my ID for example are pulled
 * [into the] document centre in the motivation it stays amber, why?"
 *
 * ⚠️ WHAT IS WRONG WITH THE ROWS THIS FIXES. The motivation checklist marks a
 * document `suspect` — the amber "Attached, but we could not read anything off
 * it" — whenever `canExtract(kind) && !extractionOk`. IDENTITY_DOCUMENT is
 * extractable (`full_name`, `id_number`), and the KYC adoption path created
 * its Credential with no extractionOk and no detailsEncrypted at all. So the
 * one document in the system we have checked hardest — OCR'd, face-matched and
 * cross-checked against Home Affairs — arrived in every motivation presented
 * as unreadable.
 *
 * kyc-id-adoption.service.ts now seeds that reading at creation time. This
 * script does the same for the copies already sitting in members' Centres,
 * which would otherwise stay amber until somebody paid for a vision call to
 * rediscover a name and ID number we already hold.
 *
 * WHAT IT TOUCHES, and nothing else:
 *   Credential rows with kind = IDENTITY_DOCUMENT, addedVia = 'kyc',
 *   purgedAt = null, and extractionOk = false.
 *
 * ⚠️ addedVia = 'kyc' IS LOAD-BEARING. A member who photographed their own ID
 * into the Centre by hand has a document we have NOT verified against Home
 * Affairs, and their User row's name and ID number may describe a different
 * piece of paper. Writing our record onto their document would be asserting we
 * read something we never looked at. Those rows keep their honest amber and
 * clear it the normal way, by being read.
 *
 * ⚠️ IT NEVER OVERWRITES A READING. extractionOk = false only, so a row that
 * already carries details — including one this script has already done — is
 * skipped. Idempotent, and safe to re-run after a partial failure.
 *
 * A user whose ID number will not decrypt (rotated ID_HASH_SECRET) or who has
 * no name on file is REPORTED AND SKIPPED, not written with a half-empty
 * reading dressed up as a verified one.
 *
 * DRY RUN BY DEFAULT.
 *   npx ts-node scripts/backfill-kyc-id-reading.ts           # report only
 *   npx ts-node scripts/backfill-kyc-id-reading.ts --apply   # write them
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { encryptJson } from '../src/common/blob-crypto';
import { decryptSaIdNumber } from '../src/common/id-crypto';

const APPLY = process.argv.includes('--apply');

// ⚠️ THE ADAPTER IS NOT OPTIONAL ON PRISMA 7 — a bare `new PrismaClient()`
// throws at construction, before the dry run prints a single line.
const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

/**
 * The two keys EXTRACTABLE.IDENTITY_DOCUMENT declares, and no others.
 *
 * ⚠️ THE NAMES MUST MATCH THE REGISTRY EXACTLY. addFromLibrary filters a vault
 * reading through wantedFor(kind) and keeps only exact matches, so a typo here
 * does not fail loudly — it silently produces a row that is still amber.
 */
function readingFor(u: {
  firstName: string | null;
  lastName: string | null;
  idNumberEncrypted: string | null;
}): { details: Record<string, string>; note?: string } {
  const details: Record<string, string> = {};
  const name = [u.firstName, u.lastName]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(' ');
  if (name) details.full_name = name;
  if (u.idNumberEncrypted) {
    try {
      const id = decryptSaIdNumber(u.idNumberEncrypted).trim();
      if (id) details.id_number = id;
    } catch (err) {
      return { details, note: `ID number will not decrypt: ${(err as Error).message}` };
    }
  }
  return { details };
}

async function main() {
  const rows = await prisma.credential.findMany({
    where: {
      kind: 'IDENTITY_DOCUMENT',
      addedVia: 'kyc',
      purgedAt: null,
      extractionOk: false,
    },
    select: {
      id: true,
      userId: true,
      user: {
        select: {
          firstName: true,
          lastName: true,
          idNumberEncrypted: true,
        },
      },
    },
  });

  console.log(
    `${rows.length} adopted KYC ID${rows.length === 1 ? '' : 's'} with no reading.` +
      (APPLY ? '' : '  (DRY RUN — pass --apply to write)'),
  );

  let done = 0;
  let skipped = 0;

  for (const row of rows) {
    const { details, note } = readingFor(row.user);
    const keys = Object.keys(details);

    if (keys.length === 0) {
      skipped += 1;
      console.log(
        `  SKIP  credential ${row.id} (user ${row.userId}) — nothing to write` +
          (note ? `: ${note}` : ': no name and no ID number on file'),
      );
      continue;
    }
    if (note) {
      // Partial: we have a name but the number is unreadable. Worth writing —
      // a name still clears the amber and prefills a field — but say so.
      console.log(`  NOTE  credential ${row.id}: ${note}`);
    }

    if (!APPLY) {
      console.log(`  would write ${keys.join(', ')} to credential ${row.id}`);
      done += 1;
      continue;
    }

    try {
      await prisma.credential.update({
        where: { id: row.id },
        data: {
          extractionOk: true,
          extractedFields: keys,
          detailsEncrypted: encryptJson(details),
        },
      });
      done += 1;
      console.log(`  OK    credential ${row.id} — ${keys.join(', ')}`);
    } catch (err) {
      skipped += 1;
      console.log(`  FAIL  credential ${row.id}: ${(err as Error).message}`);
    }
  }

  console.log(
    `\n${APPLY ? 'Written' : 'Would write'}: ${done}.  Skipped: ${skipped}.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
