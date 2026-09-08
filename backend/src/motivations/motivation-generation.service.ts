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
import { encryptJson, encryptText, tryDecryptText } from '../common/blob-crypto';
import { MotivationQuotaService } from './motivation-quota.service';
import { applicationBlockers } from './motivation-eligibility';
import {
  MotivationResearchService,
  type ResearchPack,
} from './motivation-research.service';
import { MotivationModelService } from './motivation-model.service';
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
import {
  CrimeStatsService,
  precinctFactLines,
} from '../crime-stats/crime-stats.service';
import { NewsService, clippingFactLines } from '../news/news.service';
import type { NewsIncident } from '../news/news.types';
import {
  type DangerArea,
  type TravelledArea,
  clippingIdsFor,
  dangerAreas,
  parseTravelledAreas,
} from './motivation-danger-areas';
import { areasOnRoute, decodePolyline } from './motivation-route';
import { geocodeZa, type LatLng } from '../news/news-geo';
import {
  buildAnnexures,
  type GeneratedAnnexureId,
} from './motivation-checklist';
import { FirearmImageService } from './motivation-firearm-image';
import { packConsistency } from './motivation-verify';
import {
  FIREARM_SOURCE_KEY,
  PRESS_CLIPPINGS_KEY,
  PRESS_CLIPPINGS_MAX,
  TRAVELLED_AREAS_KEY,
  SOURCE_DEALER,
  SOURCE_ESTATE,
  SOURCE_PRIVATE,
  missingRequired,
  parsePressClippingIds,
} from './motivation-fields';
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
 * How far out the area list reaches.
 *
 * ⚠️ FIFTY, NOT THE PICKER'S TWENTY-FIVE, AND THE DIFFERENCE IS THE QUESTION.
 * The clippings picker asks about reporting near where the applicant LIVES.
 * This asks about where they DRIVE, and a commute across a metro routinely
 * runs further than twenty-five kilometres — a radius that cannot reach the
 * applicant's workplace cannot offer them the areas in between. Operator,
 * 2026-09-08: "a 50km radius".
 */
const AREA_RADIUS_KM = 50;

/**
 * How many reports the area roll-up reads.
 *
 * ⚠️ MORE THAN THE PICKER TOOK, BECAUSE THEY COLLAPSE. Twelve articles across
 * a metro is four or five areas, and a member asked to tick areas needs enough
 * reports behind them for the list to be worth reading.
 */
const AREA_INCIDENT_TAKE = 60;

/**
 * How many travelled precincts print their figures.
 *
 * ⚠️ THREE. Twelve stations of quarterly tables is not evidence, it is a
 * spreadsheet — and MOTIVATION-CORPUS-LEARNINGS.md's finding about padding
 * applies to a table as much as to manufacturer copy. The ticked order is the
 * member's own, so the three that print are the ones they listed first.
 */
const TRAVELLED_STATS_MAX = 3;

/**
 * How long the commute lookup may take.
 *
 * ⚠️ SHORT, BECAUSE THE MEMBER IS WAITING FOR A LIST THIS DOES NOT GATE. The
 * areas render with or without a route; a slow Directions call must degrade to
 * "nothing pre-ticked", never to a spinner.
 */
const COMMUTE_TIMEOUT_MS = 6_000;

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
 * Two clicks must not both call the model. QUALITY_REVIEW is excluded for the same
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
    private readonly model: MotivationModelService,
    private readonly firearmImages: FirearmImageService,
    private readonly notifications: NotificationsService,
    private readonly shared: MotivationSharedService,
    private readonly crimeStats: CrimeStatsService,
    private readonly news: NewsService,
    // Structured, cached background — see the note at the research call below.
    private readonly research: MotivationResearchService,
  ) {}

  /**
   * GENERATE — the whole pipeline.
   *
   * Order matters and every step is defensive:
   *   1. flag, ownership, declaration, completeness
   *   2. CAS into GENERATING so two clicks cannot both spend money
   *   3. claim a beta seat BEFORE any model call
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

    /**
     * ⚠️ THE PROFILE UNDERNEATH, WHICH THIS READ WITHOUT FOR ITS WHOLE LIFE.
     * A `scope: 'profile'` answer is saved to the member's profile store and
     * never into `answersEncrypted`, so reading the blob alone made every one
     * of them look unanswered: an applicant with every row green was refused
     * with "Some required answers are still missing" naming `marital_status`
     * and `safe_present`, both of which he had answered.
     *
     * ⚠️ AND THE COUNT WAS THE SMALL HALF. This same `answers` feeds
     * applicationBlockers and the FACT PACK below, so the writer was being
     * handed a section 13 with no premises answers at all — no safe, no alarm,
     * no armed response — and writing "Security and safe storage" out of
     * nothing.
     */
    const answers = await this.shared.answersFor(row.userId, row.answersEncrypted);
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

    // COMPARE-AND-SWAP. Two clicks on Generate must not both call the model —
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

      // ── SAPS precinct crime figures, self-defence only ──────────────
      //
      // Operator, 2026-09-07: "is it possible for us to pull the per police
      // station crime stats from SAPS and keep it updated?" This is the SAME
      // material the professional motivations we studied annex — see
      // researchBrief()'s own note on this — except VERIFIED against our own
      // quarterly copy of the SAPS workbook rather than found by a grounded
      // search. See CrimeStatsService.precinct() and precinctFactLines().
      //
      // ⚠️ FETCHED FRESH ON EVERY ATTEMPT, NOT CACHED LIKE research() BELOW.
      // The lookup is a local read, not a paid model call, so there is
      // nothing to save by caching it — and a member who corrects
      // `police_station` between gate cycles should get THAT station's
      // figures on the retry, not whichever one was true when this motivation
      // was first drafted.
      //
      // ⚠️ A MISS COSTS THE DOCUMENT THESE FIGURES, NEVER THE DOCUMENT. Same
      // fail-soft posture as every other prefill/research source in this
      // file: no station answered, no station known to CrimeStatsService, or
      // the lookup throwing are all the same outcome — write nothing here and
      // let the writer argue from what threat_circumstances and
      // daily_movements actually say.
      let precinctBlock: string | undefined;
      if (row.licenceType === MotivationLicenceType.S13_SELF_DEFENCE) {
        const station = (answers.police_station ?? '').trim();
        if (station) {
          try {
            const figures = await this.crimeStats.precinct(
              station,
              (answers.police_station_province ?? '').trim() || undefined,
            );
            if (figures) {
              precinctBlock = [
                // ⚠️ THIS HEADING IS WHAT RULE 1 IN generationSystemPrompt()
                // NAMES — change one and the other goes stale. It also tells
                // renderResearch's own reader that the lines under it are not
                // the applicant's words and not a web search: precinctFactLines
                // already carries its own period and source on every line.
                'SAPS PRECINCT CRIME FIGURES — supplied fact, not web research:',
                ...precinctFactLines(figures),
              ].join('\n');
            }
          } catch (err) {
            this.logger.warn(
              `Motivation ${row.id}: precinct crime figures skipped — ${(err as Error).message}`,
            );
          }

          /**
           * ── AND THE PRECINCTS THEY DRIVE THROUGH ──────────────────
           *
           * Operator, 2026-09-08: "take the police station areas they travel
           * through and incorporate each of thems stats in there."
           *
           * ⚠️ THE HOME STATION IS WHERE THEY SLEEP; THIS IS WHERE THEY SPEND
           * THE DAY. An applicant living in a quiet precinct and driving
           * through three bad ones every morning has an exposure the home
           * figures do not describe, and until now the pack could not say so.
           *
           * ⚠️ AND EVERY LINE CAME OFF THE MEMBER'S OWN TICK. `travelled_areas`
           * is an answer they gave, not a radius we drew — which is what makes
           * another precinct's numbers admissible about THIS applicant.
           *
           * ⚠️ THREE, NOT ALL OF THEM. Twelve stations of quarterly tables is
           * not evidence, it is a spreadsheet, and the corpus doc's finding
           * about padding applies here as much as to manufacturer copy.
           *
           * ⚠️ AND THE REASON THEY GAVE TRAVELS WITH IT. "My daughter's school
           * is there" is what turns a table into this applicant's own exposure;
           * without it the writer has numbers and no standing to use them.
           */
          const ticked = parseTravelledAreas(answers[TRAVELLED_AREAS_KEY]);
          if (ticked.length) {
            try {
              const offered = await this.travelledPrecincts(answers, ticked);
              if (offered.length) {
                precinctBlock = [
                  precinctBlock ?? '',
                  'PRECINCTS THE APPLICANT TRAVELS THROUGH — supplied fact, from areas they ticked themselves:',
                  ...offered,
                ]
                  .filter(Boolean)
                  .join('\n');
              }
            } catch (err) {
              this.logger.warn(
                `Motivation ${row.id}: travelled-area figures skipped — ${(err as Error).message}`,
              );
            }
          }
        }
      }

      // ── background research, once per motivation ───────────────────
      //
      // The professional motivations are not templates: precinct crime
      // figures behind a self-defence application, pages on the cartridge in
      // a section 16. That material is published, not something to ask the
      // applicant for — so it was gathered here, by a model with web search,
      // and handed to the writer AND the gate (or the gate would fail every
      // researched sentence as ungrounded).
      //
      // ⚠️ IT IS SEARCHED AGAIN as of 2026-09-07 (`grounding: { web: true }`
      // on the shared contract), after a few hours returning null while the
      // provider move landed. Nothing in this branch changed across either
      // direction, and that is the point of it: research is fail-soft and
      // cached, so a null costs colour and never the document — the pipeline
      // never had to know whether a search was available.
      //
      // A stored brief is reused whichever era wrote it, and there are no bad
      // ones to worry about: during the gap research() returned null before
      // reaching the model, so nothing unsearched was ever written to
      // researchEncrypted. Every stored brief was searched when it was made.
      // ⚠️ STRUCTURED AND CACHED SINCE 2026-09-08, not one free-text brief.
      //
      // The old call asked one grounded question built from this applicant's
      // answers — including their suburb, redacted to an area but still
      // theirs — and cached the result on THIS motivation only, so the second
      // applicant for the same firearm paid for the same search again.
      //
      // MotivationResearchService asks four narrower questions instead, each
      // keyed on a fact about the WORLD — the firearm model, the cartridge,
      // the discipline, the class of game — so they are shared across every
      // applicant who asks the same one, and NO APPLICANT DATUM REACHES A
      // SEARCH QUERY AT ALL. Precinct figures come from our own SAPS workbook
      // above, which is where the area ask went.
      //
      // ⚠️ researchEncrypted STAYS, and it is not the same cache. The shared
      // table makes the FETCH free; this column makes the TEXT stable across
      // gate cycles, which is what stops attempt two being graded against a
      // different brief from attempt one.
      let researchIn = 0;
      let researchOut = 0;
      let research = row.researchEncrypted
        ? (tryDecryptText(row.researchEncrypted) ?? undefined)
        : undefined;
      if (!research) {
        const pack = await this.research
          .researchFor(row.licenceType, answers, {
            // Cartridge names only — never a make, a serial or a licence
            // number. See ResearchPack.held for why both sides are needed.
            heldCalibres:
              overlap.verdict.kind === 'overlap'
                ? overlap.verdict.withCalibres
                : [],
          })
          .catch(() => ({}) as ResearchPack);
        const text = MotivationResearchService.toBlock(pack).trim();
        // ⚠️ A CACHE HIT CONTRIBUTES ZERO, WHICH IS THE HONEST NUMBER. These
        // two feed the motivation's own token columns further down; the
        // AiUsage ledger records every call separately either way.
        const spent = MotivationResearchService.usageOf(pack);
        researchIn = spent.promptTokens;
        researchOut = spent.completionTokens;
        if (text) {
          research = text;
          await this.prisma.motivation
            .update({
              where: { id: row.id },
              data: { researchEncrypted: encryptText(text) },
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

      // ── PRESS CLIPPINGS the member chose, self-defence only ──────────
      //
      // Operator, 2026-09-07: "no CFR is going to sit and type in a stupid
      // link" — so the clippings the applicant picked from
      // GET /motivations/:id/incidents are supplied facts, exactly like the
      // precinct figures above, and cited by annexure letter rather than
      // pasted as a URL. See backend/src/news/news.types.ts.
      //
      // ⚠️ FETCHED BEFORE THE ANNEXURE LIST BELOW, NOT AFTER. The writer has
      // to cite the SAME letter the printed pack will actually carry, and
      // that letter depends on whether a PRESS_CLIPPINGS annexure exists at
      // all — buildAnnexures only reserves a letter for it when told to. So
      // "were there any clippings" has to be known before that call, not
      // worked out from it.
      //
      // ⚠️ FAIL-SOFT, SAME POSTURE AS THE PRECINCT LOOKUP. A bad id, a
      // service outage or nothing chosen all collapse to the same outcome:
      // no clippings block, no PRESS_CLIPPINGS annexure, and the document
      // argues from threat_circumstances and daily_movements alone.
      let pressClips: NewsIncident[] = [];
      if (row.licenceType === MotivationLicenceType.S13_SELF_DEFENCE) {
        const ids = parsePressClippingIds(answers[PRESS_CLIPPINGS_KEY]);
        if (ids.length) {
          try {
            pressClips = await this.news.byIds(ids);
          } catch (err) {
            this.logger.warn(
              `Motivation ${row.id}: press clippings lookup skipped — ${(err as Error).message}`,
            );
          }
        }
      }

      // The lettered annexure list — from the SAME function that letters the
      // printed pack, so a citation the writer makes can never point at a tab
      // that will not exist.
      //
      // ⚠️ 'PRIOR_NOTICE_REQUEST' IS ALWAYS PASSED HERE NOW. It is built
      // unconditionally at render time (see motivation-prior-notice.ts — it
      // sits at annexure G in every pack), but this call used to omit it from
      // the generated list, so every letter from H onward in the FactPack
      // disagreed with what actually printed. Adding it here is a genuine
      // correctness fix, not just plumbing for press clippings — it makes the
      // comment two lines up ("the SAME function that letters the printed
      // pack") true for the first time.
      const uploadKinds = (
        await this.prisma.motivationUpload.findMany({
          where: { motivationId: row.id },
          select: { kind: true, coversKinds: true },
        })
      ).map((u) => u.kind);
      const generatedAnnexures: GeneratedAnnexureId[] = pressClips.length
        ? ['PRIOR_NOTICE_REQUEST', 'PRESS_CLIPPINGS']
        : ['PRIOR_NOTICE_REQUEST'];
      const rawAnnexures = buildAnnexures(uploadKinds, generatedAnnexures);
      const annexures = rawAnnexures.map((a) => ({
        letter: a.letter,
        label: a.label,
      }));

      // ⚠️ EACH LINE ENDS WITH ITS ANNEXURE LETTER, so the writer can close
      // an argument with "(Annexure X)" rather than inventing its own
      // reference or leaving the claim uncited. All the clippings share ONE
      // letter — PRESS_CLIPPINGS is one annexure with several pages under
      // it, the same shape as the safe photographs — so every line gets the
      // same letter.
      let pressClippingsBlock: string | undefined;
      if (pressClips.length) {
        const letter = rawAnnexures.find(
          (a) => a.kind === 'PRESS_CLIPPINGS',
        )?.letter;
        if (letter) {
          pressClippingsBlock = [
            'PRESS CLIPPINGS — supplied fact, attached as annexure:',
            ...clippingFactLines(pressClips).map(
              (line) => `${line} (Annexure ${letter})`,
            ),
          ].join('\n');
        }
      }

      const pack: FactPack = {
        licenceType: row.licenceType,
        answers,
        derived: this.deriveFacts(answers),
        // Only when there is genuinely an overlap. Passing a note otherwise
        // would have the document argue against a problem it does not have.
        overlapNote: overlap.writerNote ?? undefined,
        // ⚠️ THE PRECINCT AND CLIPPINGS BLOCKS RIDE INSIDE `research`,
        // DELIBERATELY — NOT NEW FactPack FIELDS. renderResearch() already
        // wraps this in <background-research> untruncated (unlike `derived`,
        // which runs every value through sanitizePromptValue's 200-char,
        // newline-collapsing cap — fine for "43" or one sentence, not for
        // nine lines of crime figures or clippings each carrying its own
        // date and source). Put first so a reader — model or human — meets
        // the verified, supplied facts before the softer, web-searched
        // material, if any.
        research:
          [precinctBlock, pressClippingsBlock, research]
            .filter(Boolean)
            .join('\n\n') || undefined,
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
      let attempt = await this.model.generate(pack, plan);
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
        attempt = await this.model.generate(pack, plan);
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

      const graded = await this.model.grade(pack, attempt.text);
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
        const v = await this.model
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
      // ⚠️ NO FOLLOW-UP QUESTIONS ARE QUEUED — 2026-09-08. `queueFollowUps`
      // stood here and turned the gate's thin-field list into questions for
      // the applicant. No model ever asks the applicant a question now
      // (MOTIVATION-REBUILD-BRIEF.md §2.3): `thinFields` is still computed,
      // still stored on the row and still lowers the score, and the review
      // sheet shows those fields as ordinary empty inputs like any other.
      //
      // The status is unchanged. NEEDS_MORE_INFO still means what it said —
      // we need more from you before this can be written — it is simply no
      // longer accompanied by an interview.
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

      // AND GIVE THE SEAT BACK. The seat is claimed before the first model
      // call so we never spend money we have not accounted for — but that
      // means a provider outage would otherwise consume a free-beta seat
      // and produce nothing. The applicant did not get a document; they must
      // not lose their place in the beta for our failure.
      //
      // Only if THIS call took it: a retry on a motivation that already held
      // a seat must not decrement someone else's.
      if (claimedSeatHere) {
        await this.quota.releaseBetaSeat().catch(() => undefined);
      }

      // ⚠️ AND TELL THEM. THIS is the branch that fired on 2026-08-22 and said
      // nothing: a model timeout, or a document that came back unusable,
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
   * Read-only preview for the wizard's "Your circumstances" step: the SAPS
   * precinct figures that WOULD be annexed for the station currently on the
   * application, so the member sees them before they ever reach Generate
   * rather than discovering them for the first time in a finished document.
   *
   * `null`, never a thrown error, for every reason there might be nothing to
   * show: not a self-defence application, no station answered yet, or
   * CrimeStatsService knows no precinct for it. Ownership-scoped like every
   * other read in this module — a wrong id and someone else's id must be
   * indistinguishable, so this uses the same `findFirst` + `userId` shape as
   * findOne(), never an if-statement after the fetch.
   */
  async precinctFor(clerkId: string, id: string) {
    const user = await this.shared.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: { licenceType: true, answersEncrypted: true },
    });
    if (!row) throw new NotFoundException('Motivation not found');
    if (row.licenceType !== MotivationLicenceType.S13_SELF_DEFENCE) {
      return null;
    }

    const answers = this.shared.readAnswers(row.answersEncrypted);
    const station = (answers.police_station ?? '').trim();
    if (!station) return null;

    try {
      return await this.crimeStats.precinct(
        station,
        (answers.police_station_province ?? '').trim() || undefined,
      );
    } catch (err) {
      // Same fail-soft posture as the fetch inside runGeneration — a broken
      // lookup costs the preview, never a 500 on a step the member is just
      // reading.
      this.logger.warn(
        `Motivation ${id}: precinct preview failed — ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * The crime reporting near THIS application's station, for the "Your
   * circumstances" step's clipping picker — the wizard shows this list, the
   * member chooses up to `PRESS_CLIPPINGS_MAX` and saves the ids through the
   * ordinary answers path (see `press_clippings` in motivation-fields.ts).
   *
   * `{ station: null, incidents: [] }`, never a thrown error, for every
   * reason there might be nothing to offer: not a self-defence application,
   * no station answered yet, or NewsService knows of nothing nearby. Same
   * fail-soft posture as precinctFor() immediately above, and ownership-
   * scoped the same way — a wrong id and someone else's id must be
   * indistinguishable.
   */
  async incidentsFor(
    clerkId: string,
    id: string,
  ): Promise<{ station: string | null; incidents: NewsIncident[] }> {
    const user = await this.shared.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: { licenceType: true, answersEncrypted: true },
    });
    if (!row) throw new NotFoundException('Motivation not found');
    if (row.licenceType !== MotivationLicenceType.S13_SELF_DEFENCE) {
      return { station: null, incidents: [] };
    }

    const answers = this.shared.readAnswers(row.answersEncrypted);
    const station = (answers.police_station ?? '').trim();
    if (!station) return { station: null, incidents: [] };

    try {
      const incidents = await this.news.incidentsNear({
        station: {
          name: station,
          province: (answers.police_station_province ?? '').trim(),
        },
        months: 12,
        limit: 12,
      });
      return { station, incidents };
    } catch (err) {
      // Same fail-soft posture as every other lookup here — a broken feed
      // costs the picker its list, never a 500 on a step the member is just
      // browsing.
      this.logger.warn(
        `Motivation ${id}: nearby incidents lookup failed — ${(err as Error).message}`,
      );
      return { station, incidents: [] };
    }
  }

  /**
   * The dangerous areas around this applicant, for them to tick.
   *
   * Operator, 2026-09-08: "generate a list of dangerous areas around the
   * applicants home in a 50km radius that has articles attached to it and lets
   * them just tick the ones they travel through with a reason thats optional",
   * and "take the police station areas they travel through and incorporate
   * each of thems stats in there".
   *
   * ⚠️ FIFTY KILOMETRES, NOT THE PICKER'S TWENTY-FIVE. `incidentsFor` asks for
   * reporting near the applicant's OWN station, which is a question about
   * where they live. This is a question about where they DRIVE, and a commute
   * across a metro is routinely further than twenty-five kilometres — a radius
   * that cannot reach the applicant's workplace cannot offer the areas between
   * here and it.
   *
   * ⚠️ AND EACH AREA CARRIES ITS OWN PRECINCT. The stats block a section 13
   * already annexes is the applicant's home station; an area they drive
   * through every day has a station of its own, and its figures are the
   * evidence that the drive matters. Resolved by geocoding the area name, one
   * lookup each, and every one of them is allowed to fail on its own — an area
   * we cannot place is still an area they can tick, it simply arrives without
   * numbers.
   */
  async areasFor(
    clerkId: string,
    id: string,
  ): Promise<{
    station: string | null;
    withinKm: number;
    /**
     * Has the member ever answered this question?
     *
     * ⚠️ IT IS WHAT STOPS THE ROUTE UNDOING A DECISION. An area on the commute
     * is pre-ticked, and a member who deliberately UNTICKS one has said
     * something — Maps drew a road they do not take. Without this flag the next
     * load would tick it again, for ever, because `onRoute` is still true: the
     * same failure as "why can't I delete the proof of address?", arriving
     * through a helpful default.
     *
     * True once `travelled_areas` is set, INCLUDING to an empty list — "I
     * travel through none of these" is an answer.
     */
    answered: boolean;
    areas: (DangerArea & {
      station: { name: string; province: string } | null;
      ticked: boolean;
      reason?: string;
    })[];
  }> {
    const user = await this.shared.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: { licenceType: true, answersEncrypted: true },
    });
    if (!row) throw new NotFoundException('Motivation not found');
    if (row.licenceType !== MotivationLicenceType.S13_SELF_DEFENCE) {
      return {
        station: null,
        withinKm: AREA_RADIUS_KM,
        answered: false,
        areas: [],
      };
    }

    const answers = this.shared.readAnswers(row.answersEncrypted);
    const answered = (answers[TRAVELLED_AREAS_KEY] ?? '').trim() !== '';
    const station = (answers.police_station ?? '').trim();
    if (!station) {
      return { station: null, withinKm: AREA_RADIUS_KM, answered, areas: [] };
    }

    let incidents: NewsIncident[] = [];
    try {
      incidents = await this.news.incidentsNear({
        station: {
          name: station,
          province: (answers.police_station_province ?? '').trim(),
        },
        months: 12,
        withinKm: AREA_RADIUS_KM,
        // ⚠️ MORE INCIDENTS THAN THE PICKER TOOK, BECAUSE THEY COLLAPSE. Twelve
        // articles across a metro is four or five areas; the member is asked
        // about areas, and a short list of them needs a long list of reports.
        limit: AREA_INCIDENT_TAKE,
      });
    } catch (err) {
      this.logger.warn(
        `Motivation ${id}: area lookup failed — ${(err as Error).message}`,
      );
      return { station, withinKm: AREA_RADIUS_KM, answered, areas: [] };
    }

    /**
     * ⚠️ THE ROUTE IS WORKED OUT BEFORE THE ROLL-UP, because `dangerAreas`
     * orders by it: an area the applicant demonstrably drives through outranks
     * a busier one across the city, which is the whole reason for asking about
     * routes at all.
     *
     * ⚠️ AND IT NEEDS THE ROLL-UP'S OWN OUTPUT TO KNOW WHAT TO GEOCODE. So the
     * list is built twice: once to learn the names, once ordered and flagged.
     * The second pass is pure and free — the geocodes and the Directions call
     * are the cost, and they happen once.
     */
    const provisional = dangerAreas(incidents);
    let onRoute: string[] = [];
    try {
      const line = await this.commuteLine(answers);
      if (line.length) {
        onRoute = areasOnRoute(await this.placeAreas(provisional), line);
      }
    } catch (err) {
      // A commute lookup must never cost somebody their area list.
      this.logger.warn(
        `Motivation ${id}: commute route skipped — ${(err as Error).message}`,
      );
    }

    const areas = dangerAreas(incidents, { onRoute });
    const ticked = new Map(
      parseTravelledAreas(answers[TRAVELLED_AREAS_KEY]).map((t) => [
        t.key,
        t.reason,
      ]),
    );

    /**
     * ⚠️ ONE STATION LOOKUP PER AREA, IN PARALLEL, AND EACH FAILS ALONE. A
     * geocoder timeout on one suburb must not take the list down: the member
     * can still tick it, the pack simply annexes its cuttings without a stats
     * table beside them.
     *
     * ⚠️ AND THE NAME IS GEOCODED BARE, WITH NO PROVINCE ATTACHED. It was
     * anchored — `"${a.name}, ${province}"` — for one deploy, on the reasoning
     * that place names are not unique in South Africa. That is true and it was
     * still the wrong fix, because anchoring cannot tell "this place is in the
     * Western Cape" from "I told it to answer within the Western Cape".
     *
     * The live case: a Kraaifontein applicant was offered "OR Tambo". Bare, it
     * resolved to Edenvale — a Gauteng precinct, obviously wrong, and the
     * system saying so. Anchored, it resolved to Philippi East and looked
     * entirely plausible. The article was "Man arrested at OR Tambo with
     * suspected cocaine en route to Hong Kong": the Johannesburg airport,
     * carried by a Cape Town community paper. The anchor did not correct the
     * error, it LAUNDERED it — and the operator caught it by reading the name.
     */
    const province = (answers.police_station_province ?? '').trim();
    const stations = await Promise.all(
      areas.map(async (a) => {
        try {
          const found = await this.crimeStats.nearestStation(a.name);
          if (!found?.station) return null;
          /**
           * ⚠️ AN OUT-OF-PROVINCE STATION IS NOT A BAD LOOKUP, IT IS PROOF THE
           * PLACE IS SOMEWHERE ELSE — AND IT IS THE ONLY CHECK IN THIS CHAIN
           * THAT KNOWS. `distanceKm` is measured from the ARTICLE's stored
           * position, which for a syndicated piece is the PAPER's patch and
           * not where the thing happened: an airport arrest in Gauteng,
           * published by a Cape Town community paper, arrives 22.7km from a
           * Kraaifontein applicant's front door.
           *
           * ⚠️ SO IT ALSO DROPS A NAME WE CANNOT PLACE CONFIDENTLY, and that is
           * the right direction to be wrong in. A genuinely local suburb whose
           * name is ambiguous ("Brooklyn") may geocode to another province and
           * be dropped — the member loses one row they could have ticked.
           * Keeping it costs them an annexure about somewhere they have never
           * been, on a document they sign.
           */
          if (
            province &&
            found.station.province &&
            found.station.province.toUpperCase() !== province.toUpperCase()
          ) {
            return 'elsewhere' as const;
          }
          return {
            name: found.station.name,
            province: found.station.province,
          };
        } catch {
          // ⚠️ A FAILED LOOKUP KEEPS THE AREA. Only a station we successfully
          // resolved to another province is evidence; silence is not.
          return null;
        }
      }),
    );

    return {
      station,
      withinKm: AREA_RADIUS_KM,
      answered,
      areas: areas
        .map((a, i) => ({ area: a, found: stations[i] }))
        .filter((x) => x.found !== 'elsewhere')
        .map(({ area: a, found }) => ({
          ...a,
          station: found === 'elsewhere' ? null : found,
          ticked: ticked.has(a.key),
          ...(ticked.get(a.key) ? { reason: ticked.get(a.key) } : {}),
        })),
    };
  }

  /**
   * The ticked areas' own precinct figures, as fact-pack lines.
   *
   * ⚠️ IT RE-RESOLVES THE STATIONS RATHER THAN STORING THEM, and that is the
   * cheaper mistake. Storing a station against a tick would freeze whichever
   * geocode answered on the day; re-resolving costs a lookup per ticked area
   * at generation — three at most — and cannot go stale against a corrected
   * address or a renamed precinct.
   *
   * ⚠️ EACH ONE FAILS ALONE. An area we cannot place, or a station with no
   * release covering it, drops its own lines and nothing else.
   */
  private async travelledPrecincts(
    answers: Record<string, string>,
    ticked: readonly TravelledArea[],
  ): Promise<string[]> {
    const province = (answers.police_station_province ?? '').trim();
    const out: string[] = [];
    for (const t of ticked.slice(0, TRAVELLED_STATS_MAX)) {
      try {
        const found = await this.crimeStats.nearestStation(t.key);
        const station = found?.station;
        if (!station) continue;
        // The same province rule the area list itself applies: a station in
        // another province is proof the place is somewhere else.
        if (
          province &&
          station.province &&
          station.province.toUpperCase() !== province.toUpperCase()
        ) {
          continue;
        }
        const figures = await this.crimeStats.precinct(
          station.name,
          station.province || undefined,
        );
        if (!figures) continue;
        out.push(
          `${t.key} — ${station.name} precinct${
            t.reason ? ` (why the applicant is there: ${t.reason})` : ''
          }:`,
          ...precinctFactLines(figures),
        );
      } catch {
        continue;
      }
    }
    return out;
  }

  /**
   * The line the applicant drives between home and work.
   *
   * Operator, 2026-09-08: "we could also use the work address and google maps
   * routes to see through which areas they travel and link it that way?"
   *
   * ⚠️ EVERY FAILURE HERE IS THE SAME OUTCOME: NO PRE-TICKS. No key, no work
   * address, a quota error, a route Google will not draw — all of them return
   * an empty line and the member is asked about every area instead, which is
   * exactly what they were asked before this existed. A commute lookup must
   * never be able to cost somebody their area list.
   *
   * ⚠️ AND IT IS NOT CACHED, ON PURPOSE. It runs once per area-list load,
   * which is once per application unless the member changes their station —
   * see the `areasFor` effect's own key. Caching a route against an address
   * that the member is still correcting would pre-tick the areas around their
   * old office.
   */
  private async commuteLine(
    answers: Record<string, string>,
  ): Promise<LatLng[]> {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    const home = (answers.residential_address ?? '').trim();
    const work = (answers.employer_address ?? '').trim();
    if (!key || !home || !work) return [];

    try {
      const url =
        'https://maps.googleapis.com/maps/api/directions/json' +
        `?origin=${encodeURIComponent(home)}` +
        `&destination=${encodeURIComponent(work)}` +
        `&region=za&key=${key}`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(COMMUTE_TIMEOUT_MS),
      });
      if (!res.ok) return [];
      const body = (await res.json()) as {
        status?: string;
        routes?: { overview_polyline?: { points?: string } }[];
      };
      if (body.status !== 'OK') return [];
      /**
       * ⚠️ THE FIRST ROUTE ONLY. Google returns alternatives; pre-ticking the
       * union of every way Google can get there would tick areas the applicant
       * has never driven, on a document they sign. The first is the one it
       * recommends, which is the closest thing to "the way they go".
       */
      const points = body.routes?.[0]?.overview_polyline?.points;
      return points ? decodePolyline(points) : [];
    } catch {
      return [];
    }
  }

  /**
   * Where each area actually is, so the route test has something to test.
   *
   * ⚠️ THE AREA'S OWN COORDINATES, NOT THE ARTICLE'S. `distanceKm` on an
   * incident is measured from the ARTICLE's stored position, which for a
   * syndicated piece is the paper's patch — that is how a Gauteng airport
   * arrest arrived 22.7km from a Kraaifontein front door. A pre-tick has to
   * rest on where the PLACE is.
   *
   * ⚠️ EACH GEOCODE FAILS ALONE, AND A FAILURE MEANS "NOT PRE-TICKED" RATHER
   * THAN "NOT ON THE LIST". Failing to place a suburb is our problem; the
   * honest consequence is that we do not answer for the member.
   */
  private async placeAreas(
    names: readonly { key: string; name: string }[],
  ): Promise<{ key: string; at: LatLng }[]> {
    const found = await Promise.all(
      names.map(async (a) => {
        try {
          const at = await geocodeZa(a.name);
          return at ? { key: a.key, at } : null;
        } catch {
          return null;
        }
      }),
    );
    return found.filter((x): x is { key: string; at: LatLng } => x !== null);
  }

  /**
   * Record which areas the applicant travels through.
   *
   * ⚠️ THE SERVER DERIVES THE CLIPPINGS, NEVER THE BROWSER. The member ticks
   * AREAS; which articles that buys is our arithmetic, and a stale bundle
   * deciding it would put an annexure in a pack the ticked areas do not
   * account for. See clippingIdsFor for why the cap is spent area by area.
   */
  async saveAreasFor(
    clerkId: string,
    id: string,
    ticked: TravelledArea[],
  ): Promise<{ areas: number; clippings: number }> {
    const { areas } = await this.areasFor(clerkId, id);
    const user = await this.shared.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: { id: true, licenceType: true, answersEncrypted: true },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    // Only areas we actually offered. A key that is not on the list is either
    // stale or invented, and neither belongs in a signed pack.
    const offered = new Set(areas.map((a) => a.key));
    const clean = ticked
      .filter((t) => offered.has(t.key))
      .map((t) => (t.reason ? { key: t.key, reason: t.reason } : { key: t.key }));

    const ids = clippingIdsFor(areas, clean, PRESS_CLIPPINGS_MAX);
    const answers = this.shared.readAnswers(row.answersEncrypted);
    answers[TRAVELLED_AREAS_KEY] = JSON.stringify(clean);
    answers[PRESS_CLIPPINGS_KEY] = JSON.stringify(ids);

    await this.prisma.motivation.update({
      where: { id: row.id },
      data: { answersEncrypted: encryptJson(answers) },
    });

    return { areas: clean.length, clippings: ids.length };
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
