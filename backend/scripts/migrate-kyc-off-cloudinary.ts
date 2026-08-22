/**
 * MOVE IDENTITY DOCUMENTS AND SELFIES OFF THE PUBLIC CDN.
 *
 * Operator, 2026-08-22: "remove the ID from cloudinary and save it in the
 * document centre."
 *
 * ⚠️ WHAT IS WRONG WITH THE ROWS THIS FIXES. kycIdDocumentUrl and
 * kycSelfieUrl are Cloudinary secure_urls uploaded with the service's
 * defaults — no `type: 'private'`, no access_mode. They are world-readable:
 * anybody holding the link can fetch a South African identity document and
 * the matching selfie, with no login and no audit trail. The operator's own
 * decision to RETAIN them after verification (FICA-style audit trail) turned
 * a momentary exposure into a permanent one, and the erasure path's comment
 * called the URLs "unguessable" — which is not the same as private.
 *
 * WHAT IT DOES, per user, in this order and no other:
 *   1. fetch the bytes from Cloudinary
 *   2. write them into the encrypted `kyc` namespace
 *   3. point the row at the new key and NULL the URL
 *   4. only then delete the Cloudinary asset
 *
 * ⚠️ THE ORDER IS THE WHOLE SAFETY ARGUMENT. Deleting first, or nulling the
 * column before the new key is committed, loses the document — and for a
 * VERIFIED seller that document is the evidence the verification happened.
 * Every step is checked before the next runs, and a user that fails any step
 * is left EXACTLY as it was, still readable from the old URL.
 *
 * Idempotent: a row that already has a storage key is skipped, so it can be
 * run again after a partial failure.
 *
 * DRY RUN BY DEFAULT.
 *   npx ts-node scripts/migrate-kyc-off-cloudinary.ts            # report only
 *   npx ts-node scripts/migrate-kyc-off-cloudinary.ts --apply    # move them
 *   npx ts-node scripts/migrate-kyc-off-cloudinary.ts --apply --keep-cdn
 *        ↑ move and repoint, but leave the Cloudinary assets in place. Use for
 *          a first pass if you want the originals recoverable for a day.
 */
import { PrismaClient } from '@prisma/client';
import { v2 as cloudinary } from 'cloudinary';
import { SecureFileStorageService } from '../src/common/secure-file-storage.service';
import { sniffMime } from '../src/common/sniff-mime';

const APPLY = process.argv.includes('--apply');
const KEEP_CDN = process.argv.includes('--keep-cdn');

const prisma = new PrismaClient();
const files = new SecureFileStorageService();

/** Cloudinary's public_id is the URL path after the version segment. */
function publicIdFrom(url: string): string | null {
  const m = /\/v\d+\/(.+)$/.exec(url);
  if (!m) return null;
  // Images keep an extension in the URL and drop it from the public_id; raw
  // assets keep theirs. Only strip a known image extension.
  return m[1].replace(/\.(jpg|jpeg|png|webp|gif)$/i, '');
}

async function fetchBytes(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const b = Buffer.from(await res.arrayBuffer());
  if (b.length === 0) throw new Error('empty body');
  return b;
}

async function main() {
  if (APPLY && !process.env.ID_HASH_SECRET) {
    throw new Error(
      'ID_HASH_SECRET is not set — the encrypted store cannot be written to.',
    );
  }
  if (APPLY && !KEEP_CDN) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  const rows = await prisma.user.findMany({
    where: {
      OR: [
        { kycIdDocumentUrl: { not: null }, kycIdStorageKey: null },
        { kycSelfieUrl: { not: null }, kycSelfieStorageKey: null },
      ],
    },
    select: {
      id: true,
      kycIdDocumentUrl: true,
      kycIdStorageKey: true,
      kycSelfieUrl: true,
      kycSelfieStorageKey: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(
    `${rows.length} user(s) with a KYC file still on the CDN.` +
      (APPLY ? (KEEP_CDN ? ' APPLYING (CDN copies kept).' : ' APPLYING.') : ' DRY RUN.'),
  );

  let moved = 0;
  let failed = 0;
  let cdnDeleted = 0;

  for (const u of rows) {
    const work: { which: 'id' | 'selfie'; url: string }[] = [];
    if (u.kycIdDocumentUrl && !u.kycIdStorageKey) {
      work.push({ which: 'id', url: u.kycIdDocumentUrl });
    }
    if (u.kycSelfieUrl && !u.kycSelfieStorageKey) {
      work.push({ which: 'selfie', url: u.kycSelfieUrl });
    }

    for (const w of work) {
      if (!APPLY) {
        console.log(`  would move ${u.id} ${w.which}`);
        moved += 1;
        continue;
      }
      try {
        // 1. bytes
        const bytes = await fetchBytes(w.url);
        const mime = sniffMime(bytes);
        // 2. encrypted store
        const stored = await files.write('kyc', bytes, new Date());
        // 3. repoint, and only now drop the URL
        try {
          await prisma.user.update({
            where: { id: u.id },
            data:
              w.which === 'id'
                ? {
                    kycIdStorageKey: stored.storageKey,
                    kycIdMimeType: mime,
                    kycIdDocumentUrl: null,
                  }
                : {
                    kycSelfieStorageKey: stored.storageKey,
                    kycSelfieUrl: null,
                  },
          });
        } catch (err) {
          // The bytes must not outlive a failed repoint, or the store fills
          // with files nothing points at.
          await files.remove(stored.storageKey).catch(() => undefined);
          throw err;
        }
        moved += 1;
        console.log(`  moved ${u.id} ${w.which} -> ${stored.storageKey} (${mime})`);

        // 4. and only now the CDN copy
        if (!KEEP_CDN) {
          const pid = publicIdFrom(w.url);
          if (!pid) {
            console.warn(
              `  ⚠️  ${u.id} ${w.which}: could not read a public_id from the URL — delete by hand: ${w.url}`,
            );
          } else {
            try {
              await cloudinary.uploader.destroy(pid, {
                resource_type: w.url.includes('/raw/upload/') ? 'raw' : 'image',
                invalidate: true,
              });
              cdnDeleted += 1;
            } catch (err) {
              console.warn(
                `  ⚠️  ${u.id} ${w.which}: stored safely but the CDN copy is STILL PUBLIC — ${(err as Error).message}`,
              );
            }
          }
        }
      } catch (err) {
        failed += 1;
        console.error(`  ✗ ${u.id} ${w.which}: ${(err as Error).message}`);
      }
    }
  }

  console.log(
    `\n${moved} file(s) ${APPLY ? 'moved' : 'to move'}, ${failed} failed, ${cdnDeleted} CDN copy/copies deleted.`,
  );
  if (!APPLY) console.log('Nothing was changed. Re-run with --apply.');
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
