import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as crypto from 'node:crypto';
import { MotivationLicenceType, MotivationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { encryptText, tryDecryptText } from '../common/blob-crypto';
import { MotivationQuotaService } from './motivation-quota.service';
import { applicationBlockers } from './motivation-eligibility';
import { MotivationClaudeService } from './motivation-claude.service';
import { SettingsService, FLAGS } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  planFor,
  followsPlan,
  fingerprint,
  maxSimilarity,
  SIMILARITY_REGENERATE_THRESHOLD,
} from './motivation-structure';
import { type FactPack } from './motivation-prompts';
import { buildAnnexures } from './motivation-checklist';
import { FirearmImageService } from './motivation-firearm-image';
import { packConsistency } from './motivation-verify';
import {
  FIREARM_SOURCE_KEY,
  SOURCE_DEALER,
  SOURCE_ESTATE,
  SOURCE_PRIVATE,
  missingRequired,
} from './motivation-fields';
import {
  FOLLOW_UP_BATCH,
  fallbackQuestion,
  findGaps,
  gapBrief,
} from './motivation-gaps';
import { readSaId } from './sa-id';
import { overlapFromAnswers } from './motivation-overlap';
import { documentLabel, documentStatus } from './motivation-documents';
import {
  DISCLAIMER_VERSION,
  EDITABLE,
  MotivationSharedService,
  TEMPLATE_VERSION,
  estimateCostUsd,
} from './motivation-shared.service';

// ────────────────────────────────────────────────────────────────────
// GENERATION — the expensive half. Research, write, verify, grade, and the
// follow-up questions a failed gate leaves behind.
// ────────────────────────────────────────────────────────────────────

const SIMILARITY_CORPUS = 200;

/**
 * Statuses a generation may be STARTED from.
 *
 * EDITABLE plus COMPLETED, and the addition is the point: a finished document
 * had no way back. Answering a follow-up, fixing a wrong make, or simply
 * wanting another attempt all left the applicant on a dead end — the button
 * refused with "This document is already being prepared", which was not even
 * true. The only route to a second draft was an admin editing the row by hand.
 *
 * ⚠️ GENERATING IS STILL EXCLUDED, and that is the whole reason this is a CAS.
 * Two clicks must not both call Claude. QUALITY_REVIEW is excluded for the same
 * reason — a pass is still in flight. FAILED and ABANDONED stay out: an admin
 * owns those.
 *
 * ⚠️ REGENERATING SPENDS REAL MONEY — a measured S16 run cost $1.64 — but it
 * does NOT take a second seat: the seat is claimed once per motivation, not
 * once per attempt (see the claim below). The ceiling is the controller's
 * 10-per-hour throttle.
 */
const REGENERABLE: MotivationStatus[] = [
  ...EDITABLE,
  MotivationStatus.COMPLETED,
];

@Injectable()
export class MotivationGenerationService {
  private readonly logger = new Logger(MotivationGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: MotivationQuotaService,
    private readonly settings: SettingsService,
    private readonly claude: MotivationClaudeService,
    private readonly firearmImages: FirearmImageService,
    private readonly notifications: NotificationsService,
    private readonly shared: MotivationSharedService,
  ) {}

  /**
   * GENERATE — the whole pipeline.
   *
   * Order matters and every step is defensive:
   *   1. flag, ownership, declaration, completeness
   *   2. CAS into GENERATING so two clicks cannot both spend money
   *   3. claim a beta seat BEFORE any Claude call
   *   4. build the fact pack in code — the model only arranges what we give it
   *   5. draft, then VERIFY the structure plan was actually followed
   *   6. check sameness against previous documents of this type
   *   7. grade; a thin document never becomes a PDF
   */
  /**
   * The cheap half: everything that can refuse, plus the claim on the row.
   *
   * Split out so the expensive half can run OFF the request. Nothing in here
   * calls a model or costs money, so it is safe to run on every attempt.
   */
  private async prepareGeneration(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(clerkId);

    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        // The MO number. Carried through the run because it is the ONLY thing
        // the outcome notification is allowed to name — see notifyOutcome.
        referenceNumber: true,
        licenceType: true,
        status: true,
        answersEncrypted: true,
        declarationAcceptedAt: true,
        variantSeed: true,
        gateCycles: true,
        betaSeatNo: true,
        // Needed so the sameness corpus can exclude this applicant's own
        // earlier documents — see recentFingerprints.
        userId: true,
        promptTokens: true,
        completionTokens: true,
        // Reused across gate cycles — the suburb and the firearm do not
        // change between attempts, so the searches are paid for once.
        researchEncrypted: true,
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    if (!row.declarationAcceptedAt) {
      throw new ConflictException(
        'Please confirm the declaration before we prepare the document.',
      );
    }

    const answers = this.shared.readAnswers(row.answersEncrypted);
    const missing = missingRequired(row.licenceType, answers);
    if (missing.length) {
      throw new ConflictException({
        message: 'Some required answers are still missing.',
        code: 'motivation-incomplete',
        missing,
      });
    }

    // ⚠️ THE HARD CONSTRAINTS, ENFORCED BEFORE WE SPEND A CLAUDE CALL ON A
    // PACK THAT CANNOT BE GRANTED. Operator's routing spec §3: "If the
    // selected firearm violates the selected application type, block the
    // generator with a specific message. Do not silently continue."
    //
    // A self-loading rifle under section 13 is not a weak application, it is
    // an impossible one — the Act does not permit a rifle under section 13 at
    // all. Writing a beautiful motivation for it costs us the generation and
    // costs the applicant the fee, the fingerprints and the wait before the
    // Registrar tells them the same thing.
    //
    // ⚠️ AFTER missingRequired, DELIBERATELY. These rules read the firearm's
    // type and action, so an applicant who has not filled them in yet must
    // hear "you have not finished" rather than a rule about a firearm they
    // have not described.
    const blockers = applicationBlockers(row.licenceType, answers);
    if (blockers.length) {
      throw new ConflictException({
        message: blockers.map((b) => b.message).join(' '),
        code: 'motivation-not-eligible',
        blockers,
      });
    }

    // ⚠️ AND THE DOCUMENTS, WHICH NOTHING HAS EVER CHECKED HERE. H13.
    //
    // Generation refused on a missing ANSWER and on an impossible firearm, and
    // said nothing at all about a missing DOCUMENT — so an applicant with every
    // box filled and no identity document, no proof of address and no
    // competency certificate got a finished, watermarked, PAID-FOR pack that a
    // DFO cannot accept. The checklist knew: `documentStatus().missingRequired`
    // is computed on every load of the documents step and read by nothing that
    // could stop this.
    //
    // ⚠️ AFTER THE ANSWER CHECK, DELIBERATELY, AND FOR THE SAME REASON THE
    // BLOCKERS ARE. The required-document list is CONDITIONAL on the answers —
    // owning a firearm adds CURRENT_LICENCE, a private transfer adds the
    // seller's licence and a consent — so running it against a half-filled form
    // would demand documents for a route the applicant has not chosen, and then
    // stop demanding them when they answer one more question.
    //
    // ⚠️ THE SAME ConflictException SHAPE AS THE OTHER TWO, so the client has
    // one branch rather than three. `missingDocuments` carries KIND NAMES, not
    // labels: the client already owns the label table (it renders the checklist
    // from the same kinds), and a name it can key off survives a copy change.
    const uploads = await this.prisma.motivationUpload.findMany({
      where: { motivationId: row.id },
      select: { kind: true, coversKinds: true },
    });
    const missingDocuments = documentStatus(
      row.licenceType,
      // One entry per FILE and every role it fills — the safe row counts files,
      // and a membership certificate answers two lines. Same expression both
      // other callers use; deduplicating it here would break the safe.
      uploads.flatMap((u) => [u.kind, ...u.coversKinds]),
      answers,
    ).missingRequired;
    if (missingDocuments.length) {
      throw new ConflictException({
        message:
          missingDocuments.length === 1
            ? `One required document is still missing: ${documentLabel(missingDocuments[0])}.`
            : `${missingDocuments.length} required documents are still missing.`,
        code: 'motivation-documents-incomplete',
        missingDocuments,
      });
    }

    // COMPARE-AND-SWAP. Two clicks on Generate must not both call Claude —
    // that is duplicated spend and a race on the row. Only the request that
    // moves the status out of an editable state proceeds.
    const claimed = await this.prisma.motivation.updateMany({
      where: { id: row.id, status: { in: REGENERABLE } },
      data: { status: MotivationStatus.GENERATING },
    });
    if (claimed.count === 0) {
      // ⚠️ SAY WHICH STATE IT IS ACTUALLY IN. This branch fires for EVERY
      // status outside REGENERABLE, but the message only ever described one of
      // them — a finished document was told it was "already being prepared",
      // which sent the operator looking for a generation that had ended
      // minutes earlier. Re-read rather than guess.
      const now = await this.prisma.motivation.findUnique({
        where: { id: row.id },
        select: { status: true },
      });
      throw new ConflictException(
        now?.status === MotivationStatus.GENERATING ||
        now?.status === MotivationStatus.QUALITY_REVIEW
          ? 'This document is already being prepared. Give it a moment.'
          : 'This document cannot be prepared again from here. Contact support.',
      );
    }

    return { row, answers };
  }

  /**
   * The expensive half: two flagship calls and a grading pass.
   *
   * ⚠️ THIS MUST NOT RUN INSIDE AN HTTP REQUEST. Measured on a live section 16
   * pack: 88 seconds, 14k prompt and 12k completion tokens over two gate
   * cycles. nginx gives an upstream 60 seconds and Cloudflare cuts the origin
   * at 100 whatever nginx is told, so the applicant got a 504 for a document
   * that had been written and paid for — and clicking again spent it twice.
   *
   * The row is already claimed (GENERATING) before this is called, so a second
   * click cannot start a second run; the caller decides whether to await.
   */
  private async runGeneration(
    prepared: Awaited<
      ReturnType<MotivationGenerationService['prepareGeneration']>
    >,
  ) {
    const { row, answers } = prepared;

    // Whether THIS call took a seat. If generation then fails, the seat has to
    // go back — see the catch block.
    let claimedSeatHere = false;

    try {
      // A seat is claimed once per motivation, not once per attempt: a gate
      // retry is our cost to carry, not another seat off the applicant.
      let seat = row.betaSeatNo;
      if (seat === null) {
        const cap = await this.settings.get(FLAGS.motivationBetaFreeCap);
        seat = await this.quota.claimBetaSeat(cap);
        claimedSeatHere = seat !== null;
        // ⚠️ WRITE THE SEAT TO THE ROW THE MOMENT IT IS TAKEN, not at the end
        // of the run. The counter has already been incremented; if the process
        // dies before the terminal update — a deploy, an OOM kill, and the
        // generation now runs detached where that is likelier — the seat is
        // spent with nothing on the row to show for it, and no sweep can tell
        // whose it was. Persisted here, the row owns it: the retry reads
        // row.betaSeatNo above and reuses it, which is also what makes "one
        // seat per motivation, not per attempt" survive a restart.
        if (seat !== null) {
          await this.prisma.motivation
            .update({ where: { id: row.id }, data: { betaSeatNo: seat } })
            .catch(() => undefined);
        }
        if (seat === null) {
          await this.prisma.motivation.update({
            where: { id: row.id },
            data: { status: MotivationStatus.NEEDS_MORE_INFO },
          });
          throw new ConflictException({
            message:
              'The free beta filled up while you were working. We will open paid motivations shortly.',
            code: 'motivation-beta-cap-reached',
          });
        }
      }

      // DOES THIS APPLICANT ALREADY HOLD SOMETHING THAT DOES THIS JOB?
      //
      // The question that gets a second medium-game rifle refused, and one the
      // Registrar asks whether or not we do. Computed once here and used in
      // both directions: the note tells the writer to meet the objection head
      // on, and needsJustification promotes the "why both" question in the
      // follow-up ranking if the gate sends this back.
      const overlap = overlapFromAnswers(row.licenceType, answers);

      // ── background research, once per motivation ───────────────────
      //
      // The professional motivations are not templates: precinct crime
      // figures behind a self-defence application, pages on the cartridge in
      // a section 16. That material is published, not something to ask the
      // applicant for — so it is gathered here, by a cheaper model with web
      // search, and handed to the writer AND the gate (or the gate would
      // fail every researched sentence as ungrounded).
      //
      // Fail-soft and cached: a research failure costs colour, never the
      // document, and a retry re-reads the stored brief instead of paying
      // for the searches again.
      let researchIn = 0;
      let researchOut = 0;
      let research = row.researchEncrypted
        ? (tryDecryptText(row.researchEncrypted) ?? undefined)
        : undefined;
      if (!research) {
        const r = await this.claude
          .research({
            licenceType: row.licenceType,
            answers,
            // ⚠️ THE OTHER FIREARM IS PART OF THE BRIEF NOW. The writer has to
            // argue the comparison itself rather than wait for the applicant
            // to hand it over, and rule 1 forbids it any figure it was not
            // given — so without published material on the held cartridge the
            // strongest section in a same-class application could only be
            // written in generalities.
            heldForComparison:
              overlap.verdict.kind === 'overlap'
                ? [
                    ...overlap.verdict.withCalibres,
                    ...overlap.verdict.withTypes,
                  ]
                : [],
          })
          .catch(() => null);
        if (r) {
          research = r.text;
          researchIn = r.usage.promptTokens;
          researchOut = r.usage.completionTokens;
          await this.prisma.motivation
            .update({
              where: { id: row.id },
              data: { researchEncrypted: encryptText(r.text) },
            })
            .catch(() => undefined);
        }
      }

      // ── the cover photograph ──────────────────────────────────────
      //
      // Fetched HERE and nowhere else. It belongs beside the research pass for
      // the same three reasons: it is background work, it is cached on disk so
      // the second applicant with a CZ 75 pays nothing, and it is fail-soft —
      // a miss costs the cover a picture, never the document.
      //
      // ⚠️ NOT IN THE DOWNLOAD PATH. The pack is re-rendered on every
      // download, and an outbound call to somebody else's server there would
      // sit inside our 60-second nginx ceiling on a request the applicant is
      // waiting on. renderPdf only ever reads what is already on disk.
      if (answers.firearm_make) {
        await this.firearmImages
          .fetchAndStore(
            answers.firearm_make,
            answers.firearm_model ?? '',
            answers.firearm_type,
          )
          .catch(() => null);
      }

      // The lettered annexure list — from the SAME function that letters the
      // printed pack, so a citation the writer makes can never point at a tab
      // that will not exist.
      const uploadKinds = (
        await this.prisma.motivationUpload.findMany({
          where: { motivationId: row.id },
          select: { kind: true, coversKinds: true },
        })
      ).map((u) => u.kind);
      const annexures = buildAnnexures(uploadKinds).map((a) => ({
        letter: a.letter,
        label: a.label,
      }));

      const pack: FactPack = {
        licenceType: row.licenceType,
        answers,
        derived: this.deriveFacts(answers),
        // Only when there is genuinely an overlap. Passing a note otherwise
        // would have the document argue against a problem it does not have.
        overlapNote: overlap.writerNote ?? undefined,
        research,
        annexures,
      };

      // Draft, verify the plan landed, and check it does not look like
      // everything else we have produced. ONE retry with a fresh seed covers
      // both failures — a second identical result means the variation engine
      // is broken, which is an admin problem rather than a user one.
      //
      // ⚠️ THE PLAN NEEDS THE OVERLAP, not just the seed. The comparison
      // section is only in the plan when the applicant actually holds a
      // same-class firearm — the same condition that puts `overlapNote` in the
      // pack. Both are read off THIS check so the writer can never be handed a
      // section with no instruction behind it, or an instruction with no
      // section to put it in.
      const planOpts = { hasOverlap: !!overlap.writerNote };
      let seed = row.variantSeed;
      let plan = planFor(row.licenceType, seed, planOpts);
      let attempt = await this.claude.generate(pack, plan);
      let tokensIn = attempt.usage.promptTokens + researchIn;
      let tokensOut = attempt.usage.completionTokens + researchOut;

      const previous = await this.recentFingerprints(
        row.licenceType,
        row.id,
        row.userId,
      );
      let structureOk = followsPlan(attempt.text, plan).ok;
      let sameness = maxSimilarity(fingerprint(attempt.text), previous);
      // The FIRST verifier, in code and for free: serial, ID, calibre and
      // annexure citations checked deterministically. A failure here rides
      // the same single retry as a broken structure — same cost, same cap.
      let mechanics = packConsistency(attempt.text, answers, annexures);

      if (
        !structureOk ||
        sameness > SIMILARITY_REGENERATE_THRESHOLD ||
        mechanics.length
      ) {
        this.logger.warn(
          `Motivation ${row.id}: regenerating (structureOk=${structureOk}, sameness=${sameness.toFixed(2)}, mechanics=${mechanics.length})`,
        );
        seed = crypto.randomInt(0, 2 ** 31 - 1);
        plan = planFor(row.licenceType, seed, planOpts);
        attempt = await this.claude.generate(pack, plan);
        tokensIn += attempt.usage.promptTokens;
        tokensOut += attempt.usage.completionTokens;
        structureOk = followsPlan(attempt.text, plan).ok;
        sameness = maxSimilarity(fingerprint(attempt.text), previous);
        mechanics = packConsistency(attempt.text, answers, annexures);
      }

      // ⚠️ A DOCUMENT THAT FAILS THE MECHANICAL CHECKS TWICE IS NEVER FILED.
      // A wrong serial or a citation to a tab that does not exist is not a
      // quality problem the applicant can fix with a better answer — it is
      // the writer corrupting identity data, our defect, an admin's problem.
      if (mechanics.length) {
        await this.prisma.motivation.update({
          where: { id: row.id },
          data: {
            status: MotivationStatus.FAILED,
            failedAt: new Date(),
            failureReason: mechanics.slice(0, 3).join('; ').slice(0, 500),
          },
        });
        void this.prisma.adminAlert
          .create({
            data: {
              type: 'motivation-verify-failed',
              urgent: true,
              context: `Motivation ${row.id} failed mechanical verification twice: ${mechanics[0]}`,
            },
          })
          .catch(() => undefined);
        await this.notifyOutcome(row, 'failed');
        return { status: MotivationStatus.FAILED, score: 0 };
      }

      const graded = await this.claude.grade(pack, attempt.text);
      tokensIn += graded.usage.promptTokens;
      tokensOut += graded.usage.completionTokens;

      const maxCycles = await this.settings.get(FLAGS.motivationMaxGateCycles);
      const nextCycles = row.gateCycles + 1;

      const common = {
        variantSeed: seed,
        structurePlan: plan as unknown as object,
        structureFingerprint: fingerprint(attempt.text),
        // ⚠️ KEEP THE DRAFT EVEN WHEN THE GATE SENDS IT BACK. It used to be
        // written only on a pass, so an applicant whose document was held for
        // more detail could never SEE the document — they paid for it, it was
        // written, and all they got was a score and a list of questions. That
        // makes the gate impossible to argue with and impossible to learn
        // from: neither the applicant nor the operator can tell a fair
        // knock-back from an over-strict one without reading the text.
        //
        // Only the PASSED branch sets documentVersion, completedAt and
        // qualityPassedAt, so "finished" still means finished — the PDF stays
        // gated on COMPLETED (see renderPdf) and this is a draft to read, not
        // a document to file.
        documentTextEncrypted: encryptText(attempt.text),
        qualityScore: graded.verdict.overall,
        qualityFindings: graded.verdict as unknown as object,
        thinFields: graded.verdict.thinFields,
        modelUsed: attempt.usage.model,
        promptTokens: (row.promptTokens ?? 0) + tokensIn,
        completionTokens: (row.completionTokens ?? 0) + tokensOut,
        costUsd: estimateCostUsd(attempt.usage.model, tokensIn, tokensOut),
        betaSeatNo: seat,
        generatedAt: new Date(),
      };

      // Read once for BOTH terminal branches. A document that failed the gate
      // needs a retention date every bit as much as one that passed — its
      // uploads are the same identity documents.
      const retentionDays = await this.settings.get(
        FLAGS.motivationRetentionDays,
      );

      // THE SECOND VERIFIER — a fresh model reading the finished document the
      // way a suspicious DFO would, once, only on text that passed the gate.
      // Advisory: its findings are stored beside the verdict for the operator
      // and the applicant, but a broken verifier must not un-pass a passed
      // document. Two verifiers per document — this and the mechanical checks
      // above — and not more, per the operator.
      let verification: string[] | undefined;
      if (graded.verdict.passed) {
        const v = await this.claude
          .verifyDocument({ pack, documentText: attempt.text, annexures })
          .catch(() => null);
        if (v) {
          verification = v.issues;
          tokensIn += v.usage.promptTokens;
          tokensOut += v.usage.completionTokens;
          if (v.issues.length) {
            this.logger.warn(
              `Motivation ${row.id}: verifier noted ${v.issues.length} issue(s) — stored with the verdict`,
            );
          }
        }
      }

      if (graded.verdict.passed) {
        await this.prisma.motivation.update({
          where: { id: row.id },
          data: {
            ...common,
            qualityFindings: {
              ...(graded.verdict as unknown as Record<string, unknown>),
              ...(verification ? { verification } : {}),
            } as unknown as object,
            status: MotivationStatus.COMPLETED,
            // (the text itself comes from `common` now — see the note there)
            documentVersion: { increment: 1 },
            templateVersion: TEMPLATE_VERSION,
            disclaimerVersion: DISCLAIMER_VERSION,
            qualityPassedAt: new Date(),
            completedAt: new Date(),
            retentionPurgeAt: new Date(
              Date.now() + retentionDays * 24 * 60 * 60 * 1000,
            ),
          },
        });
        await this.notifyOutcome(row, 'ready');
        return {
          status: MotivationStatus.COMPLETED,
          score: graded.verdict.overall,
        };
      }

      // Out of retries — an admin owns it from here, rather than sending the
      // applicant round the loop forever.
      if (nextCycles > maxCycles) {
        await this.prisma.motivation.update({
          where: { id: row.id },
          data: {
            ...common,
            status: MotivationStatus.FAILED,
            gateCycles: nextCycles,
            failedAt: new Date(),
            // Same reason as abandon(): a terminal state with no retention date
            // is a document nothing ever comes back for.
            retentionPurgeAt: new Date(
              Date.now() + retentionDays * 24 * 60 * 60 * 1000,
            ),
            failureReason:
              graded.verdict.issues.slice(0, 3).join('; ') ||
              'Quality gate not met',
          },
        });
        void this.prisma.adminAlert
          .create({
            data: {
              type: 'motivation-gate-exhausted',
              urgent: false,
              context: `Motivation ${row.id} failed the quality gate ${nextCycles} times and needs a human look.`,
            },
          })
          .catch(() => undefined);
        await this.notifyOutcome(row, 'failed');
        return { status: MotivationStatus.FAILED, score: graded.verdict.overall };
      }

      // Back to the applicant, for the specific fields the gate found thin.
      await this.prisma.motivation.update({
        where: { id: row.id },
        data: {
          ...common,
          status: MotivationStatus.NEEDS_MORE_INFO,
          gateCycles: nextCycles,
        },
      });
      await this.queueFollowUps(
        row.id,
        row.licenceType,
        graded.verdict.thinFields,
        answers,
      );
      // ⚠️ AFTER queueFollowUps, NEVER BEFORE. The message tells the applicant
      // the questions are waiting for them; sending it first would race an
      // applicant who taps the SMS straight away onto a page with none on it.
      await this.notifyOutcome(row, 'held');
      return {
        status: MotivationStatus.NEEDS_MORE_INFO,
        score: graded.verdict.overall,
        thinFields: graded.verdict.thinFields,
      };
    } catch (err) {
      // Release the CAS so the applicant can try again. Without this a failed
      // generation strands the row in GENERATING forever — uneditable and
      // un-regenerable, the worst possible end state.
      await this.prisma.motivation
        .updateMany({
          where: { id: row.id, status: MotivationStatus.GENERATING },
          data: { status: MotivationStatus.NEEDS_MORE_INFO },
        })
        .catch(() => undefined);

      // AND GIVE THE SEAT BACK. The seat is claimed before the first Claude
      // call so we never spend money we have not accounted for — but that
      // means an Anthropic outage would otherwise consume a free-beta seat
      // and produce nothing. The applicant did not get a document; they must
      // not lose their place in the beta for our failure.
      //
      // Only if THIS call took it: a retry on a motivation that already held
      // a seat must not decrement someone else's.
      if (claimedSeatHere) {
        await this.quota.releaseBetaSeat().catch(() => undefined);
      }

      // ⚠️ AND TELL THEM. THIS is the branch that fired on 2026-08-22 and said
      // nothing: an Anthropic timeout, or a document that came back unusable,
      // put the row back to NEEDS_MORE_INFO and returned the seat — correctly
      // — and then simply rethrew into startGeneration's catch, which logs.
      // The applicant, who is holding a phone waiting for the message we
      // promised them, got a button that went grey and came back.
      //
      // Ordered AFTER the row is restored so the link in the message opens a
      // page they can actually press Prepare on, and awaited so a process that
      // dies immediately after has still sent it.
      await this.notifyOutcome(row, 'failed');
      throw err;
    }
  }

  /**
   * Tell the applicant their document is finished — ready, or held back.
   *
   * ⚠️ THE RUN IS DETACHED, SO NOTHING ELSE EVER TELLS THEM. startGeneration
   * returns immediately and the wizard settles on "Writing it — about a
   * minute…"; a minute and a half later the row changes and the page does not,
   * because the applicant has long since locked their phone. Both terminal
   * gate branches call this, because a document held back for more detail is
   * just as FINISHED from where they are standing — and a knock-back nobody
   * is told about is the one outcome with no way back into the flow.
   *
   * ⚠️ AND SO DOES EVERY FAILURE BRANCH, WHICH IS NEW. Only the two success
   * paths called this, so the outcome where somebody is MOST certainly still
   * waiting — the one where nothing was written at all — was the one that said
   * nothing. Operator, 2026-08-22: "Pressed the Prepare my motivation and it
   * greyed out. It is back to prepare my motivation again and did not receive
   * any notifications." The button returning is the only signal there was, and
   * only if you happened to be looking at the page.
   *
   * ⚠️ IT NEVER THROWS. The row is already in its terminal state by the time
   * this runs and the document is written and (in time) paid for; a Resend
   * outage, a missing phone number or a stale user row must cost a message,
   * never the document. Every failure is a warning in the log.
   *
   * The MO reference is the only identifier passed on. NotificationsService
   * owns the rule about what may reach a lock screen — see motivationFinished
   * — but nothing here hands it a firearm, a calibre or a section to leak.
   */
  private async notifyOutcome(
    row: { id: string; userId: string; referenceNumber: string },
    outcome: 'ready' | 'held' | 'failed',
  ): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: row.userId },
        select: { email: true, phone: true, firstName: true },
      });
      // No address, no message. Stale dev-era rows have made this exact lookup
      // come back empty in production before (see requireUser), and a null
      // deref here would be an unhandled rejection on a detached promise.
      if (!user?.email) {
        this.logger.warn(
          `Motivation ${row.id}: finished (${outcome}) but the applicant has no email on file — not notified`,
        );
        return;
      }
      await this.notifications.motivationFinished({
        userId: row.userId,
        email: user.email,
        phone: user.phone,
        name: user.firstName ?? 'there',
        motivationId: row.id,
        referenceNumber: row.referenceNumber,
        outcome,
      });
    } catch (err) {
      this.logger.warn(
        `Motivation ${row.id}: could not tell the applicant it finished (${outcome}) — ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Generate and wait for the outcome.
   *
   * Kept for callers that genuinely want the result in hand — the tests, and
   * anything server-side that is not answering an HTTP request. NOT the route:
   * see startGeneration and the timing note on runGeneration.
   */
  async generate(clerkId: string, id: string) {
    const prepared = await this.prepareGeneration(clerkId, id);
    return this.runGeneration(prepared);
  }

  /**
   * Start generating and return at once. What the route calls.
   *
   * Every refusal the applicant can act on — not found, declaration not
   * accepted, answers missing, already running — still happens before this
   * returns, so the wizard gets a real error rather than a hopeful "started"
   * followed by silence. Only the part that cannot fail fast runs detached.
   *
   * ⚠️ THE PROMISE IS DELIBERATELY NOT AWAITED, and its rejection is swallowed
   * here rather than left to crash the process. runGeneration's own catch has
   * already restored the row and returned the beta seat by the time it
   * rethrows; there is no caller left to tell, and the applicant learns the
   * outcome from the row's status.
   */
  async startGeneration(clerkId: string, id: string) {
    const prepared = await this.prepareGeneration(clerkId, id);
    void this.runGeneration(prepared).catch((err) => {
      this.logger.error(
        `Motivation ${prepared.row.id}: background generation failed — ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
    return { status: MotivationStatus.GENERATING };
  }

  /**
   * Free rows left claimed by a process that died mid-generation.
   *
   * ⚠️ THE ONE FAILURE runGeneration's catch CANNOT COVER. It restores the row
   * on a thrown error, but a deploy, an OOM kill or a pm2 restart takes the
   * process with the promise still in flight — and GENERATING is not editable
   * and not re-generable, so the applicant is stranded on a document that
   * looks permanently busy with nothing to click.
   *
   * ⚠️ TWENTY-FIVE MINUTES, AND THE FIGURE IS DERIVED, NOT CHOSEN. It must
   * stay clear of the worst realistic run, which GENERATE_TIMEOUT_MS's comment
   * computes: research 180s + write 300s + one local retry 300s + verify 60s +
   * grade 60s = 15 minutes. It was 15 when the writer's clock was 180s and the
   * sum was 11; raising the writer's token ceiling raised both, and a sweep
   * that fires at the same moment a legitimate run is still writing would take
   * the row out from under it. Change either timeout and redo the sum here.
   *
   * It moves the row to NEEDS_MORE_INFO rather than an editable draft, because
   * tokens may well have been spent and the applicant should see the state as
   * it is.
   */
  @Cron('*/5 * * * *')
  async sweepStuckGenerations() {
    const cutoff = new Date(Date.now() - 25 * 60 * 1000);
    const stuck = await this.prisma.motivation.updateMany({
      where: { status: MotivationStatus.GENERATING, updatedAt: { lt: cutoff } },
      data: { status: MotivationStatus.NEEDS_MORE_INFO },
    });
    if (stuck.count > 0) {
      this.logger.error(
        `Released ${stuck.count} motivation(s) stuck in GENERATING — a generation was interrupted, most likely by a restart.`,
      );
    }
    return { released: stuck.count };
  }

  /** Fingerprints of recent same-type documents, for the sameness check. */
  private async recentFingerprints(
    licenceType: MotivationLicenceType,
    excludeId: string,
    excludeUserId: string,
  ): Promise<string[][]> {
    const rows = await this.prisma.motivation.findMany({
      where: {
        licenceType,
        id: { not: excludeId },
        // THE APPLICANT'S OWN EARLIER DOCUMENTS ARE NOT COMPETITION.
        //
        // The sameness engine exists for one reason: so the CFR never sees a
        // flood of near-identical documents from DIFFERENT people. Two
        // motivations by the SAME person are a different case entirely — they
        // describe one life, so they SHOULD share circumstances, and forcing
        // them apart is actively harmful. A second application whose account of
        // the same commute, the same premises and the same history reads
        // differently from the first is the exact contradiction a DFO looks
        // for, and we would have manufactured it ourselves.
        //
        // Operator, 2026-08-18: keep the earlier motivations so a repeat
        // applicant gets the same storyline. This is the half of that which
        // stops us fighting it.
        userId: { not: excludeUserId },
        status: MotivationStatus.COMPLETED,
      },
      orderBy: { createdAt: 'desc' },
      take: SIMILARITY_CORPUS,
      select: { structureFingerprint: true },
    });
    return rows.map((r) => r.structureFingerprint).filter((f) => f.length > 0);
  }

  /**
   * Turn the gate's thin-field list into questions. WE pick the fields; Claude
   * only phrases them. If it cannot, the field's own help text is the fallback
   * — a plain question beats no question.
   */
  private async queueFollowUps(
    motivationId: string,
    licenceType: MotivationLicenceType,
    thinFields: string[],
    answers: Record<string, string>,
  ): Promise<void> {
    // WHAT to ask is worked out in code, for nothing — it is arithmetic over
    // the field registry. Claude is asked only to WORD the questions, which is
    // the one part it is genuinely better at.
    // ⚠️ NEVER ASK A QUESTION THAT IS ALREADY ON SCREEN UNANSWERED. Every
    // gate cycle used to queue its follow-ups blind, so three attempts put
    // THREE copies of "could you tell me a bit more about your competition
    // record" in front of the applicant — who read it, reasonably, as the
    // system falling apart. A question counts as open until a user message
    // with the same fieldKey arrives after it, which is the same rule the
    // wizard renders by.
    const history = await this.prisma.motivationMessage.findMany({
      where: { motivationId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, fieldKey: true },
    });
    const open = new Set<string>();
    for (const m of history) {
      if (!m.fieldKey) continue;
      if (m.role === 'assistant') open.add(m.fieldKey);
      else open.delete(m.fieldKey);
    }

    const gaps = findGaps(licenceType, answers, { thinFields })
      .filter((g) => !open.has(g.key))
      .slice(0, FOLLOW_UP_BATCH);
    if (!gaps.length) return;

    // ONE request for the batch. This used to be one per field, which meant a
    // failed gate sent the whole system prompt three times to produce three
    // sentences.
    let phrased: Record<string, string> = {};
    try {
      const res = await this.claude.askFollowUpBatch({
        licenceType,
        gaps: gapBrief(gaps),
      });
      phrased = res.questions;
    } catch {
      // Every gap has a free fallback, so a failure here costs wording, not
      // the interview.
      phrased = {};
    }

    for (const gap of gaps) {
      await this.prisma.motivationMessage
        .create({
          data: {
            motivationId,
            role: 'assistant',
            fieldKey: gap.key,
            contentEncrypted: encryptText(
              phrased[gap.key] ?? fallbackQuestion(gap),
            ),
          },
        })
        .catch(() => undefined);
    }
  }

  /**
   * Facts WE compute rather than ask for. Keeping this in code is what stops
   * the model doing arithmetic on someone's licence application.
   */
  private deriveFacts(
    answers: Record<string, string>,
    asAt = new Date(),
  ): Record<string, string> {
    const derived: Record<string, string> = {};

    // AGE ONLY, deliberately. readSaId also yields date of birth, gender and
    // citizenship — those are SAPS 271 box-fillers, not argument material, and
    // there is no reason to put someone's date of birth in a prompt. Age is
    // here because a motivation may legitimately reason about it.
    const { age } = readSaId(answers.id_number ?? '', asAt);
    if (age !== null && age >= 18) derived.applicant_age = String(age);

    const since = (answers.dedicated_since ?? '').trim();
    const yearMatch = /^([0-9]{4})/.exec(since);
    if (yearMatch) {
      const years = asAt.getUTCFullYear() - Number(yearMatch[1]);
      if (years >= 0 && years < 80) derived.years_dedicated = String(years);
    }

    // WHERE THE FIREARM IS UNTIL THE APPLICATION IS DECIDED.
    //
    // Operator, item 3 of twelve, 2026-08-24, on the dealer route: put the
    // invoice in "as proof of purchase and also where the fire arm is
    // currently stored until the application has reached it's outcome."
    //
    // It is a question every DFO has and almost no motivation answers: an
    // applicant cannot lawfully hold the firearm before the licence is
    // granted, so somebody else is holding it, and saying who closes the loop.
    //
    // ⚠️ NEVER "IN MY POSSESSION", AND NEVER "COLLECTED PRIVATELY". A firearm
    // always moves through a licensed dealer; on the private route the seller
    // keeps lawful possession until that transfer happens. Deriving this in
    // code rather than asking is what stops the writer inventing a custody
    // arrangement that would be an offence if true.
    const source = (answers[FIREARM_SOURCE_KEY] ?? '').trim();
    if (source === SOURCE_DEALER) {
      derived.custody_pending_outcome =
        'The dealer holds the firearm in their stock until the licence is granted; the applicant takes possession only after that.';
    } else if (source === SOURCE_PRIVATE) {
      derived.custody_pending_outcome =
        'The current licensed owner keeps the firearm until the licence is granted, and the transfer is then done through a licensed dealer.';
    } else if (source === SOURCE_ESTATE) {
      // ⚠️ THE ESTATE HOLDS IT, AND SAYING SO MATTERS MORE HERE THAN ANYWHERE.
      // An heir living in the deceased's house is the person most likely to
      // have the firearm in the same building already, and a motivation that
      // implied they were keeping it would describe an offence on a document
      // they sign. An estate firearm is held by the executor, in a licensed
      // dealer's safe or with SAPS, until the licence is decided.
      derived.custody_pending_outcome =
        'The firearm is held by the estate — with a licensed dealer or SAPS — until the licence is granted and it is transferred through a dealer.';
    }

    return derived;
  }
}
