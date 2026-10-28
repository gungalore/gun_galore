import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { CredentialKind } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SecureFileStorageService } from '../src/common/secure-file-storage.service';
import { decryptJson, encryptJson } from '../src/common/blob-crypto';
import { DocumentCaptureService } from '../src/common/document-capture/document-capture.service';
import { DocumentProjectionService } from '../src/common/document-projection/document-projection.service';
import { WANTED } from '../src/licence-centre/licence-centre-extract.service';
import { mayArmReadExpiry } from '../src/licence-centre/credential-auto-date';
import { recomputeDerivedCompetencies } from '../src/licence-centre/credential-derive-recompute';
import { parseIsoDate } from '../src/licence-centre/licence-dates';

// ────────────────────────────────────────────────────────────────────
// BACKFILL THE DOCUMENTS THAT HAVE NO DATE AT ALL.
//
// Operator, 2026-10-28: a licence card prints its issue and expiry as an
// unlabelled range under the section; the old reader returned neither, so six
// licences and three competencies sat with no date and the vault asked the
// member to confirm a date it had never read.
//
// The prompts are fixed for new uploads. This script re-reads the stored bytes
// of the rows that already exist. It NEVER touches a member answer, never
// deletes anything, and defaults to a dry run.
//
//   npx ts-node scripts/backfill-missing-credential-dates.ts --userId <id>
//   npx ts-node scripts/backfill-missing-credential-dates.ts --userId <id> --apply
// ────────────────────────────────────────────────────────────────────

const APPLY = process.argv.includes('--apply');
const userArg = (() => {
  const i = process.argv.indexOf('--userId');
  return i >= 0 ? process.argv[i + 1] : undefined;
})();

function iso(v: string | null | undefined): string | null {
  const d = parseIsoDate(v);
  return d ? d.toISOString().slice(0, 10) : null;
}

function readCovers(blob: string | null): string {
  if (!blob) return '';
  try {
    return decryptJson<Record<string, string>>(blob)?.covers ?? '';
  } catch {
    return '';
  }
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService, { strict: false });
  const files = app.get(SecureFileStorageService, { strict: false });
  const capture = app.get(DocumentCaptureService, { strict: false });
  const projection = app.get(DocumentProjectionService, { strict: false });
  const logger = new Logger('BackfillDates');

  const where = {
    purgedAt: null,
    confirmedAt: null,
    dateSource: null,
    neverExpires: false,
    expiresOn: null,
    storageKey: { not: null },
    OR: [
      { kind: CredentialKind.FIREARM_LICENCE },
      { kind: CredentialKind.COMPETENCY_CERTIFICATE },
    ],
  };

  let userId = userArg;
  if (!userId) {
    const grouped = await prisma.credential.groupBy({
      by: ['userId'],
      where,
      _count: { _all: true },
      orderBy: { _count: { userId: 'desc' } },
      take: 1,
    });
    const first = grouped[0];
    if (!first) {
      console.log('No rows need a date.');
      await app.close();
      return;
    }
    userId = first.userId;
    console.log(
      `No --userId given; using ${userId} (${first._count._all ?? 0} rows).`,
    );
  }

  const rows = await prisma.credential.findMany({
    where: { ...where, userId },
    select: {
      id: true,
      title: true,
      kind: true,
      storageKey: true,
      mimeType: true,
      detailsEncrypted: true,
      extractedFields: true,
      coversKinds: true,
      issuedOn: true,
      expiresOn: true,
    },
    orderBy: [{ kind: 'asc' }, { title: 'asc' }],
  });
  console.log(`${rows.length} row(s) with no date. apply=${APPLY}`);

  let licencesFixed = 0;
  for (const row of rows) {
    if (row.kind === CredentialKind.COMPETENCY_CERTIFICATE) continue;
    let details: Record<string, string> = {};
    try {
      details = decryptJson<Record<string, string>>(row.detailsEncrypted ?? '') ?? {};
    } catch {
      details = {};
    }
    let bytes: Buffer;
    try {
      bytes = await files.read(row.storageKey as string);
    } catch (err) {
      console.log(`${row.title}: cannot read bytes — ${(err as Error).message}`);
      continue;
    }
    const read = await capture.capture({ bytes, mimeType: row.mimeType });
    if (!read) {
      console.log(`${row.title}: capture failed`);
      continue;
    }
    const keys = [...WANTED[row.kind], 'issued_on', 'expires_on'];
    const projected = await projection.project({ capture: read, keys });
    const issuedOn =
      projected.values.issued_on?.value ?? details.issued_on ?? null;
    const expiresOn =
      projected.values.expires_on?.value ?? details.expires_on ?? null;
    if (!issuedOn && !expiresOn) {
      console.log(`${row.title}: still no dates (facts=${read.facts.length})`);
      continue;
    }
    const merged = { ...details };
    const keysOut = new Set(row.extractedFields);
    for (const [key, value] of Object.entries(projected.values)) {
      if (key === 'issued_on' || key === 'expires_on') continue;
      merged[key] = value.value;
      keysOut.add(key);
    }
    const lowConfidence = Object.entries(projected.values)
      .filter(([, v]) => v.confidence === 'low')
      .map(([k]) => k);
    const armed = mayArmReadExpiry({
      kind: row.kind,
      coversKinds: row.coversKinds,
      expiresOn,
      issuedOn,
      section: merged.section ?? null,
      lowConfidence,
      autoFillable: lowConfidence.length === 0,
      now: new Date(),
    });
    console.log(
      `${row.title}: issue=${issuedOn ?? '—'} expiry=${expiresOn ?? '—'} arm=${armed.arm}${armed.reason ? ` (${armed.reason})` : ''}`,
    );
    if (!APPLY) continue;
    await prisma.credential.update({
      where: { id: row.id },
      data: {
        detailsEncrypted: encryptJson(merged),
        extractedFields: [...keysOut],
        issuedOn: parseIsoDate(issuedOn),
        expiresOn: parseIsoDate(expiresOn),
        ...(armed.arm
          ? {
              dateSource: 'read',
              dateSourceNote:
                'We read this date off the document you uploaded. Change it if it is wrong.',
            }
          : {}),
      },
    });
    if (armed.arm) licencesFixed += 1;
  }

  if (APPLY) {
    // Competency expiry is derived from the issue date; copy the stored detail
    // into the column first, then let the normal recompute arm it.
    const comps = await prisma.credential.findMany({
      where: {
        userId,
        kind: CredentialKind.COMPETENCY_CERTIFICATE,
        confirmedAt: null,
        purgedAt: null,
      },
      select: { id: true, detailsEncrypted: true, issuedOn: true },
    });
    for (const c of comps) {
      if (c.issuedOn) continue;
      let d: Record<string, string> = {};
      try {
        d = decryptJson<Record<string, string>>(c.detailsEncrypted ?? '') ?? {};
      } catch {
        continue;
      }
      const issued = iso(d.competency_issued);
      if (!issued) continue;
      await prisma.credential.update({
        where: { id: c.id },
        data: { issuedOn: parseIsoDate(issued) },
      });
      console.log(`competency ${c.id}: issuedOn=${issued}`);
    }
    const dated = await recomputeDerivedCompetencies(
      prisma,
      userId,
      readCovers,
      logger,
    );
    console.log(`competency dates recomputed: ${dated}`);
  }

  console.log(
    APPLY
      ? `Applied. Licences armed: ${licencesFixed}.`
      : 'Dry run only. Add --apply to write.',
  );
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
