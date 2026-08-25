import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  deriveCertificateExpiry,
  type LinkedLicence,
  parseEndorsements,
} from '../common/sa-competency';
import { mayArmDerivedExpiry } from './credential-auto-date';
import { parseIsoDate } from './licence-dates';

// ────────────────────────────────────────────────────────────────────
// A COMPETENCY'S DATE MOVES, SO SOMETHING HAS TO MOVE IT.
//
// Operator, 2026-08-25, from their DFO: the competency "renews with the latest
// firearm license obtained". While the date was recomputed on every page load
// that was free. Now it is STORED — and a stored answer to a moving question
// is wrong from the next renewal onwards unless something recomputes it.
//
// ⚠️ IT MAY ONLY EVER TOUCH ITS OWN WORKING. The row must be a competency, its
// date must carry dateSource 'derived', and the member must not have confirmed
// it. A date somebody typed is theirs; overwriting it with our arithmetic
// would be the worst kind of quiet — they would never know it had changed, and
// the reminder would move with it.
//
// ⚠️ AND A MOVED DATE MUST UNSEND ITS REMINDERS. The five stage stamps are how
// the sweep remembers what it has already said. Roll a date forward without
// clearing them and the row goes permanently silent: every stage is stamped,
// none can fire again, and the new date passes unremarked. confirmExpiry has
// always known this; this is the second and last place that should.
// ────────────────────────────────────────────────────────────────────

const STAGES_CLEARED = {
  remind180SentAt: null,
  remind120SentAt: null,
  remind100SentAt: null,
  remind30SentAt: null,
  remindD0SentAt: null,
} as const;

/**
 * Re-date every competency we dated for this member.
 *
 * Called after anything that could change which licences they hold, or when
 * one is confirmed, renewed or removed. Never throws: a failure here must not
 * take down the upload or the confirmation that triggered it.
 */
export async function recomputeDerivedCompetencies(
  prisma: PrismaService,
  userId: string,
  /**
   * Pull the `covers` line out of a row's encrypted details.
   *
   * ⚠️ PASSED IN, NOT REACHED FOR. Decryption belongs to the service that
   * owns the key; an earlier draft of this file kept the reader in a
   * module-level variable and let the service install it at boot, which is
   * hidden mutable state that a second caller could silently change under the
   * first. A parameter cannot be got wrong by accident.
   */
  readCovers: (blob: string | null) => string,
  logger?: Logger,
): Promise<number> {
  try {
    const [certs, licenceRows] = await Promise.all([
      prisma.credential.findMany({
        where: {
          userId,
          kind: 'COMPETENCY_CERTIFICATE',
          // ⚠️ OUR OWN ARITHMETIC ONLY. Never a row the member confirmed, and
          // never one with no dateSource — that one is still asking them.
          dateSource: 'derived',
          confirmedAt: null,
          purgedAt: null,
        },
        select: {
          id: true,
          expiresOn: true,
          issuedOn: true,
          detailsEncrypted: true,
          extractedFields: true,
        },
      }),
      prisma.credential.findMany({
        where: {
          userId,
          OR: [
            { kind: 'FIREARM_LICENCE' },
            { coversKinds: { has: 'FIREARM_LICENCE' } },
          ],
          firearmCategory: { not: null },
          expiresOn: { not: null },
          purgedAt: null,
        },
        select: { firearmCategory: true, expiresOn: true },
      }),
    ]);
    if (!certs.length) return 0;

    const licences: LinkedLicence[] = licenceRows.map((r) => ({
      category: r.firearmCategory as LinkedLicence['category'],
      expiresOn: r.expiresOn,
    }));

    let changed = 0;
    for (const c of certs) {
      // The endorsements live in the encrypted details; the caller owns the
      // key, so it hands us a reader rather than us reaching for one.
      const covers = readCovers(c.detailsEncrypted);
      const d = deriveCertificateExpiry({
        endorsements: parseEndorsements(covers),
        issuedOn: c.issuedOn ?? parseIsoDate(null),
        licences,
      });
      const ok = mayArmDerivedExpiry(d.basis);

      // ⚠️ THE DERIVATION STOPPED QUALIFYING — the last licence in a category
      // it covers has gone, so the answer is now the five-year assumption we
      // refuse to arm. The row gives its date back and returns to asking,
      // rather than keeping a number whose basis has disappeared.
      if (!d.on || !ok.arm) {
        if (c.expiresOn !== null) {
          await prisma.credential.update({
            where: { id: c.id },
            data: {
              expiresOn: null,
              dateSource: null,
              dateSourceNote: null,
              ...STAGES_CLEARED,
            },
          });
          changed += 1;
        }
        continue;
      }

      const same =
        c.expiresOn !== null && c.expiresOn.getTime() === d.on.getTime();
      if (same) continue;

      await prisma.credential.update({
        where: { id: c.id },
        data: {
          expiresOn: d.on,
          dateSource: 'derived',
          dateSourceNote: d.why,
          // The date moved, so what we have already said about it no longer
          // applies. Without this the row never speaks again.
          ...STAGES_CLEARED,
        },
      });
      changed += 1;
    }
    if (changed) {
      logger?.log(`Re-dated ${changed} competency certificate(s) for ${userId}`);
    }
    return changed;
  } catch (err) {
    // A recompute is a convenience on top of whatever just happened. It must
    // never take that down with it.
    logger?.warn(
      `Could not re-date competencies for ${userId}: ${(err as Error).message}`,
    );
    return 0;
  }
}
