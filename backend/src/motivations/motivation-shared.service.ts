import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { costUsdMicros, isPricedModel } from '../common/llm/llm.pricing';
import { MotivationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MemberProfileAnswersService } from './member-profile-answers.service';
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
  // The platform model is priced exactly, in the adapter's one price table.
  // The tiering below is for the Anthropic rollback path only, and it still
  // errs high on an unknown name — the documented safe direction.
  if (isPricedModel(model)) {
    return (
      costUsdMicros({
        model,
        inputTokens: promptTokens,
        outputTokens: completionTokens,
      }) / 1_000_000
    );
  }
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly profileAnswers: MemberProfileAnswersService,
  ) {}

  /**
   * EVERYTHING THIS APPLICATION SAYS — the profile underneath, the application
   * on top.
   *
   * ⚠️ IT EXISTS BECAUSE THE SHEET AND THE GENERATOR DISAGREED ABOUT WHETHER AN
   * APPLICATION WAS FINISHED. A field with `scope: 'profile'` is saved to the
   * member's profile store and NOT into `answersEncrypted` — that is the point
   * of the scope, so a second application inherits it. The review sheet layers
   * the two and reports what the member can see. `generate()` read the
   * application blob alone.
   *
   * So an applicant with every row green was refused with "Some required
   * answers are still missing", naming `marital_status` and `safe_present` —
   * both answered, both on the profile. Operator, 2026-09-08, having ticked the
   * declaration and pressed the button.
   *
   * ⚠️ AND THE COUNT WAS THE SMALL HALF OF IT. The same read feeds
   * `applicationBlockers` and the FACT PACK, so the writer was being handed a
   * section 13 with no premises answers at all — no safe, no alarm, no armed
   * response — and "Security and safe storage" is a section of the document the
   * corpus says every approved pack carries.
   *
   * ⚠️ THE APPLICATION WINS EVERY CONFLICT, and that ordering is the whole
   * meaning of a profile answer: it is an OFFER, and a value on this
   * application is the member having changed it here. Same layering `sheetFor`
   * has always used, in one place now so the two cannot drift again.
   */
  async answersFor(
    userId: string,
    answersEncrypted: string | null,
  ): Promise<Record<string, string>> {
    const profile = await this.profileAnswers.readFor(userId);
    return { ...profile.answers, ...this.readAnswers(answersEncrypted) };
  }

  /**
   * Where the seller's half of a private sale stands.
   *
   * ⚠️ ONE COPY, ON PURPOSE. It lived as a private method on
   * MotivationsService, so the review sheet — a second surface reading the
   * same fact — simply did not call it: `motivation-sheet.service.ts` passed
   * NO context to saps271Coverage, section F was never pushed into the
   * coverage at all, and `sellerSigned` on the sheet was therefore false
   * forever. A seller signed at 12:02 and the page under the panel still read
   * "When they sign, Part F of your SAPS 271 fills in from what they give us"
   * while the panel above it said "The owner has signed".
   *
   * The same rule the checklist already carries: if two screens compute this
   * differently, one says "waiting on Piet" and the next says "not started".
   */
  async sellerState(motivationId: string): Promise<{
    status: 'NONE' | 'INVITED' | 'COMPLETED' | 'DECLINED';
    name?: string;
    openedAt: Date | null;
  }> {
    try {
      const consent = await this.prisma.motivationSellerConsent.findUnique({
        where: { motivationId },
        select: { status: true, invitedName: true, openedAt: true },
      });
      if (!consent) return { status: 'NONE', openedAt: null };
      return {
        status: consent.status as 'INVITED' | 'COMPLETED' | 'DECLINED',
        name: (consent.invitedName ?? '').trim() || undefined,
        openedAt: consent.openedAt,
      };
    } catch (err) {
      // A status we cannot read costs the sentence, not the screen.
      this.logger.warn(
        `Motivation ${motivationId}: seller consent status unreadable — ${(err as Error).message}`,
      );
      return { status: 'NONE', openedAt: null };
    }
  }

  /**
   * Resolve the internal user. Stale dev-era rows have caused this exact
   * lookup to fail in production before, so it is an explicit, readable error
   * rather than a null-deref further down.
   */
  async requireUser(userId: string): Promise<{ id: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
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
  /**
   * Does this member hold 117705, ANYWHERE?
   *
   * ⚠️ IT WAS ONLY LOOKING INSIDE PACKS, AND THAT IS THE WRONG PLACE FOR A
   * QUESTION ABOUT THE MEMBER. This read `motivationUpload` alone — statements
   * already ATTACHED to an application — so a member whose knowledge unit sits
   * on a handgun statement they have not attached to a rifle application looked
   * exactly like somebody who never did the course.
   *
   * Which is the case sa-proficiency-cover.ts was written for, in the
   * operator's own words: "I did my 117705 with my handgun. but i have to
   * supply that statement of results along with the rifle statement of results
   * if I apply for a rifle. So both codes needs to be visible." The module got
   * that right and the wiring handed it half the evidence.
   *
   * Read off MO000075 on 2026-09-09: 117705 sits on the handgun statement of
   * results in their vault, correctly parsed, and the pack carried the two
   * rifle proficiencies. Operator: "it also did not insert the Proficiency
   * with the knowledge of the firearms control act."
   *
   * ⚠️ THE VAULT GIVES CODES, NOT OCR, AND THAT IS BETTER EVIDENCE. A
   * credential carries `details.unit_standard` — "117705, 119649" — already
   * parsed by the reader, where an upload carries the raw page. Both go in:
   * parseUnitStandards reads digits out of either, and a member is CONFIRMED
   * if any document anywhere carries the code.
   *
   * ⚠️ AND AN UNREADABLE COUNT STILL MEANS SOMETHING. A vault row whose
   * `unit_standard` is empty is a statement we could not read, exactly like an
   * upload with no OCR text, and it must go on counting towards `unreadable`
   * rather than being silently dropped — "we have not read it" is not "it is
   * missing", and only one of those is an accusation.
   */
  async proficiencyFor(userId: string) {
    const [statements, vault] = await Promise.all([
      this.prisma.motivationUpload.findMany({
        where: {
          motivation: { userId },
          kind: 'PROFICIENCY_CERTIFICATE',
          ocrTextEncrypted: { not: null },
        },
        select: { ocrTextEncrypted: true },
      }),
      this.prisma.credential.findMany({
        where: { userId, kind: 'PROFICIENCY', purgedAt: null },
        select: { detailsEncrypted: true },
      }),
    ]);
    return proficiencyCover([
      ...statements.map(
        (u) =>
          decryptJson<{ text?: string }>(u.ocrTextEncrypted ?? '')?.text ?? null,
      ),
      /**
       * ⚠️ A ROW WITH NO DETAILS IS UNREADABLE, NOT A THROW. decryptText
       * refuses an empty string by design — "No ciphertext to decrypt" — and a
       * proficiency filed before the reader could see it has exactly that. It
       * counts towards `unreadable`, which is the state that means "we have
       * not read it" rather than "you do not hold it".
       */
      ...vault.map((c) => {
        if (!c.detailsEncrypted) return null;
        try {
          return (
            decryptJson<Record<string, string>>(c.detailsEncrypted)
              ?.unit_standard ?? null
          );
        } catch {
          return null;
        }
      }),
    ]);
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
