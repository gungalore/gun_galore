/**
 * READ THE VAULT DOCUMENTS THAT WERE NEVER ASKED ANYTHING.
 *
 * Operator, 2026-08-23: "when some documents like my ID for example are pulled
 * [into the] document centre in the motivation it stays amber, why?"
 *
 * ⚠️ WHAT WAS WRONG. WANTED — the per-kind list in licence-centre-extract —
 * is both the question the vision call asks and the filter its answer is
 * passed through. IDENTITY_DOCUMENT, ADDRESS_CONFIRMATION and
 * EMPLOYMENT_CONFIRMATION were all `[]`, swept in by association with the safe
 * photographs, so those documents were read with an empty ask and everything
 * they volunteered was discarded. extractionOk could never become true.
 *
 * Meanwhile the MOTIVATION registry declares all three readable, and a
 * checklist row is amber on `canExtract(kind) && !extractionOk`. Between them
 * the two registries guaranteed a permanent amber on documents that are
 * perfectly legible — an ID card with a name and a number printed on it.
 *
 * The lists are fixed, so NEW uploads read properly. This reads the documents
 * already sitting in members' Centres, which would otherwise stay amber
 * forever with no way for anyone to clear them: the Centre has no re-read
 * button, unlike a motivation upload.
 *
 * ⚠️ THIS ONE SPENDS MONEY. Every document it touches is a Claude vision call.
 * It is DRY RUN by default and prints exactly what it would read and what that
 * will cost in calls. Use --limit to do a few first.
 *
 * ⚠️ IT NEVER TOUCHES A DATE. The Centre's create() writes a proposed
 * expiresOn from a reading, with confirmedAt left null so the reminder sweep
 * cannot see it. These rows are older and a member may have CONFIRMED a date
 * by hand; overwriting that with a fresh guess would silently change a date
 * somebody checked, and could start an expiry reminder against it. Only the
 * reading is written — extractionOk, extractedFields, detailsEncrypted.
 *
 * Idempotent: only rows with extractionOk = false are considered, so a
 * document this has already read is skipped on a second run. A document that
 * genuinely yields nothing stays false and will be retried by a later run —
 * which is correct, since "we looked and found nothing" is exactly what the
 * amber is for.
 *
 *   npx ts-node scripts/backfill-credential-readings.ts              # report
 *   npx ts-node scripts/backfill-credential-readings.ts --apply
 *   npx ts-node scripts/backfill-credential-readings.ts --apply --limit 3
 */
import { PrismaClient, CredentialKind } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { encryptJson } from '../src/common/blob-crypto';
import { SecureFileStorageService } from '../src/common/secure-file-storage.service';
import {
  LicenceCentreExtractService,
  WANTED,
} from '../src/licence-centre/licence-centre-extract.service';

const APPLY = process.argv.includes('--apply');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  if (i === -1) return Infinity;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
})();

// ⚠️ THE ADAPTER IS NOT OPTIONAL ON PRISMA 7.
const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});
const files = new SecureFileStorageService();
const extract = new LicenceCentreExtractService();

/** Kinds the vault now actually asks something of. */
function readable(kind: CredentialKind): boolean {
  return ((WANTED as Record<string, string[]>)[kind] ?? []).length > 0;
}

async function main() {
  const rows = await prisma.credential.findMany({
    where: { extractionOk: false, purgedAt: null, storageKey: { not: null } },
    select: {
      id: true,
      userId: true,
      kind: true,
      title: true,
      storageKey: true,
      mimeType: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const targets = rows.filter((r) => readable(r.kind)).slice(0, LIMIT);
  const ignored = rows.length - rows.filter((r) => readable(r.kind)).length;

  console.log(
    `${rows.length} unread document${rows.length === 1 ? '' : 's'} in the vault; ` +
      `${targets.length} of a readable kind` +
      (ignored ? ` (${ignored} skipped — nothing to read on them)` : '') +
      '.',
  );
  if (!APPLY) {
    console.log(
      `DRY RUN — pass --apply to read them. That will make ${targets.length} ` +
        `vision call${targets.length === 1 ? '' : 's'}.`,
    );
  }

  let read = 0;
  let empty = 0;
  let failed = 0;

  for (const row of targets) {
    const label = `${row.kind} "${row.title}" (${row.id})`;
    if (!APPLY) {
      console.log(
        `  would read ${label} — asking for ` +
          `${JSON.stringify((WANTED as Record<string, string[]>)[row.kind])}`,
      );
      continue;
    }

    try {
      const bytes = await files.read(row.storageKey!);
      const reading = await extract.read({
        kind: row.kind,
        bytes,
        mimeType: row.mimeType,
      });
      const keys = Object.keys(reading.details);
      if (keys.length === 0) {
        empty += 1;
        console.log(`  NONE  ${label} — nothing legible; left as it was`);
        continue;
      }
      await prisma.credential.update({
        where: { id: row.id },
        data: {
          extractionOk: true,
          extractedFields: keys,
          detailsEncrypted: encryptJson(reading.details),
          // ⚠️ NO expiresOn / issuedOn. See the header — a member may have
          // confirmed those by hand and this must not overwrite them.
        },
      });
      read += 1;
      console.log(`  OK    ${label} — ${keys.join(', ')}`);
    } catch (err) {
      failed += 1;
      console.log(`  FAIL  ${label}: ${(err as Error).message}`);
    }
  }

  if (APPLY) {
    console.log(
      `\nRead: ${read}.  Nothing legible: ${empty}.  Failed: ${failed}.`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
