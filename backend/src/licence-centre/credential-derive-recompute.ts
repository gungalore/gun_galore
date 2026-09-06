import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  deriveCertificateExpiry,
  type LinkedLicence,
  parseEndorsements,
} from '../common/sa-competency';
import { mayArmDerivedExpiry } from './credential-auto-date';
import {
  competencyCategoriesFrom,
  competencyRenewalNote,
} from './licence-renewal';
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
          // ⚠️ TWO INDEPENDENT CONDITIONS, SO THEY GO IN AN `AND`. Prisma takes
          // one `OR` per object; writing a second silently kept only the last
          // one, which tsc caught here and would not have in a looser shape.
          AND: [
            {
              OR: [
                { kind: 'FIREARM_LICENCE' },
                { coversKinds: { has: 'FIREARM_LICENCE' } },
              ],
            },
            {
              // Settled by the member, or filled in and armed by us.
              OR: [
                { confirmedAt: { not: null } },
                { dateSource: { not: null } },
              ],
            },
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

// ────────────────────────────────────────────────────────────────────
// THE SAME ARITHMETIC, ASKED THE OTHER WAY ROUND.
//
// recomputeDerivedCompetencies asks "given these licences, when does each
// competency expire?". This asks "given THIS licence expiring, does a
// competency expire with it?" — which is the question that decides whether a
// SAPS 517(g) is due alongside the section 24 renewal.
//
// ⚠️ IT LIVES HERE RATHER THAN IN licence-renewal.ts BECAUSE IT TOUCHES THE
// DATABASE. That module is pure by contract — no Nest, no Prisma, no clock —
// and holds the RULE (competencyRenewalNote). This is the gathering, and it is
// here rather than copied into both callers: the reminder sweep and the
// renewal one-tap must never come to different conclusions about the same
// licence, or a member is told two different things about the same form in the
// same week.
// ────────────────────────────────────────────────────────────────────

/**
 * "Renew the competency with it, on a SAPS 517(g)" — or null.
 *
 * ⚠️ NEVER THROWS. Both callers are doing something more important than this:
 * one is sending an expiry warning, the other is opening a renewal. Advice
 * that fails must cost the advice.
 */
export async function competencyRenewalAdvice(
  prisma: PrismaService,
  userId: string,
  licence: {
    id: string;
    kind: string;
    firearmCategory: string | null;
    expiresOn: Date | null;
  },
  /** Pull the `covers` line out of a row's encrypted blob. See above. */
  readCovers: (blob: string | null) => string,
  logger?: Logger,
): Promise<string | null> {
  if (
    licence.kind !== 'FIREARM_LICENCE' ||
    !licence.firearmCategory ||
    !licence.expiresOn
  ) {
    return null;
  }
  try {
    const [others, certs] = await Promise.all([
      prisma.credential.findMany({
        where: {
          userId,
          id: { not: licence.id },
          firearmCategory: licence.firearmCategory,
          expiresOn: { not: null },
          purgedAt: null,
          // ⚠️ SETTLED DATES ONLY, the same predicate the derivation itself
          // uses. A date nobody has settled must not be allowed to vouch for a
          // competency and talk somebody out of filing a form they need.
          OR: [{ confirmedAt: { not: null } }, { dateSource: { not: null } }],
        },
        select: { firearmCategory: true, expiresOn: true },
      }),
      prisma.credential.findMany({
        where: { userId, kind: 'COMPETENCY_CERTIFICATE', purgedAt: null },
        select: { detailsEncrypted: true },
      }),
    ]);

    return competencyRenewalNote({
      // ⚠️ THE COLUMN ALREADY HOLDS A CATEGORY, NOT PRINTED TEXT. It is
      // written by categoryFromText when the licence is read, precisely so the
      // derivation can group licences without decrypting anything.
      category: licence.firearmCategory as LinkedLicence['category'],
      expiresOn: licence.expiresOn,
      otherLicences: others.map((r) => ({
        category: r.firearmCategory as LinkedLicence['category'],
        expiresOn: r.expiresOn,
      })),
      competencyCategories: competencyCategoriesFrom(
        certs.map((r) => readCovers(r.detailsEncrypted)),
      ),
    });
  } catch (err) {
    logger?.warn(
      `Could not work out the 517(g) advice for credential ${licence.id}: ${(err as Error).message}`,
    );
    return null;
  }
}
