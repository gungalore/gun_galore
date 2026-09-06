import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MotivationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { decryptJson } from '../common/blob-crypto';

import { expiryFromReading, uploadCaution } from './motivation-upload-row';
import { toIsoDay } from './motivation-credentials';
import { proficiencyCover } from '../common/sa-proficiency-cover';

// ────────────────────────────────────────────────────────────────────
// The pieces MotivationsService and every service split out of it need in
// common: the internal-user lookup, the answer-blob decrypt, the two
// derived readings a document row carries, and the module constants that
// more than one of them stamps.
//
// ⚠️ IT INJECTS NOTHING BUT PRISMA, AND IT MUST STAY THAT WAY. Everything
// else in this folder injects THIS, so anything it reaches for becomes a
// dependency of all of them — and a dependency of this on any of them
// would be a cycle Nest only reports at boot.
// ────────────────────────────────────────────────────────────────────

/**
 * Attorney-reviewed template + disclaimer versions, stamped on every document.
 * BUMP THESE whenever the PDF skeleton or the disclaimer text changes, so a
 * document produced under a reviewed version can be told apart from one
 * produced after an edit.
 */
export const TEMPLATE_VERSION = 'tpl-2026-08-a';
export const DISCLAIMER_VERSION = 'dis-2026-08-a';

/**
 * Rough USD cost per million tokens, by model tier.
 *
 * DELIBERATELY APPROXIMATE and deliberately ours. There is no pricing API, and
 * a stale hardcoded rate that silently under-reports is worse than an obvious
 * estimate — so this is a planning figure for the admin spend card, not an
 * invoice. What matters is that it is RECORDED at all: org-level spend
 * alerting does not work on this box (the admin key is a regular key), so
 * these columns are the only per-document cost signal we have.
 *
 * Unknown models fall back to the flagship rate — over-estimating spend is the
 * safe direction.
 */
const MODEL_RATES_USD_PER_MTOK: Record<string, { in: number; out: number }> = {
  opus: { in: 15, out: 75 },
  sonnet: { in: 3, out: 15 },
  haiku: { in: 0.8, out: 4 },
};

export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const tier = /opus/i.test(model)
    ? 'opus'
    : /sonnet/i.test(model)
      ? 'sonnet'
      : /haiku/i.test(model)
        ? 'haiku'
        : 'opus';
  const rate = MODEL_RATES_USD_PER_MTOK[tier];
  const usd =
    (promptTokens / 1_000_000) * rate.in +
    (completionTokens / 1_000_000) * rate.out;
  // Six decimals, matching the Decimal(10,6) column.
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/**
 * Has this pack been paid for? Nothing else clears the watermark.
 *
 * ⚠️ THIS USED TO BE isSettled(), AND IT ALSO PASSED A FREE-BETA SEAT. The
 * reasoning was that a seat is "how the operator chose to give the first
 * members the product for nothing", so both meant entitled-to-a-clean-copy.
 * Operator, 2026-08-22: "remember to add a watermark as this is not been paid
 * for yet." A seat is a free seat, not a payment — `billedCents` is the only
 * column that records money — so a beta pack is watermarked like any other
 * unpaid one. `betaSeatNo` still governs the beta CAP; it never governs the
 * mark, which is why it is not read here at all.
 *
 * Payments are not live yet, so today this is almost always false and almost
 * every pack carries the mark. That is the correct default: the failure mode
 * of getting it wrong the other way is handing out the finished product for
 * nothing.
 */
export function isPaidFor(row: { billedCents: number }): boolean {
  return row.billedCents > 0;
}

/** Statuses where the applicant may still edit their answers. */
export const EDITABLE: MotivationStatus[] = [
  MotivationStatus.DRAFT,
  MotivationStatus.INTERVIEW,
  MotivationStatus.NEEDS_MORE_INFO,
];

@Injectable()
export class MotivationSharedService {
  private readonly logger = new Logger(MotivationSharedService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the internal user. Stale dev-era rows have caused this exact
   * lookup to fail in production before, so it is an explicit, readable error
   * rather than a null-deref further down.
   */
  async requireUser(clerkId: string): Promise<{ id: string }> {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /**
   * The three fields every attached document now carries about its own
   * validity.
   *
   * ⚠️ THE VAULT'S COLUMN BEATS THE READING, AND NOT BY A LITTLE. A
   * Credential's `expiresOn` has been through the Document Centre: read,
   * arithmetic-checked by credential-auto-date, possibly corrected by the
   * member, and re-derived when a licence renewal moves it. The reading on the
   * upload row is one vision call's raw opinion of a photograph. Where both
   * exist they are usually the same date and the curated one is the one to
   * show; where they differ, showing the raw one would contradict the reminder
   * the member is already getting from the Centre about the same document.
   *
   * The reading is the fallback for a page photographed straight onto the
   * application, which has no vault row behind it at all.
   *
   * ⚠️ AND NOTHING IS INVENTED. Both sources can be absent — an ID copy and
   * a photograph of a safe have no expiry in any sense — and absent stays
   * absent: null expiry, null caution, no warning at all. See uploadCaution.
   */
  expiryFor(
    u: {
      extractionEncrypted?: string | null;
      sourceCredential?: { expiresOn: Date | null } | null;
      sourceRemovedAt?: Date | null;
    },
    now: Date,
  ): {
    expiresOn: string | null;
    caution: { tone: 'amber' | 'red'; text: string } | null;
    sourceRemovedAt: string | null;
  } {
    let expiresOn: string | null = u.sourceCredential?.expiresOn
      ? toIsoDay(u.sourceCredential.expiresOn)
      : null;

    if (!expiresOn && u.extractionEncrypted) {
      try {
        expiresOn = expiryFromReading(
          decryptJson<Record<string, string>>(u.extractionEncrypted) ?? null,
        );
      } catch {
        // A blob we cannot open costs the date, not the row. The module's rule.
      }
    }

    return {
      expiresOn,
      caution: uploadCaution(expiresOn, now),
      sourceRemovedAt: u.sourceRemovedAt
        ? u.sourceRemovedAt.toISOString()
        : null,
    };
  }

  /**
   * Does this member hold unit standard 117705, anywhere?
   *
   * Operator, 2026-08-28: "the 117705 must always be requested by the system
   * and alerted if it's missing."
   *
   * ⚠️ EVERY MOTIVATION THEY HAVE EVER MADE, NOT ONE. "I did my 117705 with my
   * handgun. but i have to supply that statement of results along with the
   * rifle statement of results if I apply for a rifle." The knowledge unit is
   * on a 2014 handgun statement; the rifle unit is on a 2021 one. Reading only
   * the statements attached to THIS application would alert a member who has
   * held 117705 for eleven years, and would look identical to one who never
   * did the course. Scoped to the USER, so a second application inherits what
   * the first one proved.
   *
   * ⚠️ ONE METHOD, BECAUSE TWO SURFACES SHOW IT. The checklist and the
   * competency step both render this, from two different endpoints. Computing
   * it twice is how they come to disagree, and a member told the pack is
   * complete on one screen and short on the next stops believing either.
   */
  async proficiencyFor(userId: string) {
    const statements = await this.prisma.motivationUpload.findMany({
      where: {
        motivation: { userId },
        kind: 'PROFICIENCY_CERTIFICATE',
        ocrTextEncrypted: { not: null },
      },
      select: { ocrTextEncrypted: true },
    });
    return proficiencyCover(
      statements.map(
        (u) =>
          decryptJson<{ text?: string }>(u.ocrTextEncrypted ?? '')?.text ?? null,
      ),
    );
  }

  /**
   * Decrypt the answer blob, tolerating absence and corruption.
   *
   * A row with no answers yet is normal (a fresh draft). A row whose blob will
   * not decrypt is not, but returning {} lets the applicant see their form and
   * start again rather than meeting a 500 with no way forward.
   */
  readAnswers(encrypted: string | null): Record<string, string> {
    if (!encrypted) return {};
    try {
      return decryptJson<Record<string, string>>(encrypted);
    } catch (err) {
      this.logger.error(
        `Could not decrypt motivation answers: ${(err as Error).message}`,
      );
      return {};
    }
  }
}
