import { applyRepairs, repairTargets } from './motivation-repair';
import { withoutRefusedCopy } from './motivation-scope';
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
import {
  decryptJson,
  encryptJson,
  encryptText,
  tryDecryptText,
} from '../common/blob-crypto';
import { MotivationQuotaService } from './motivation-quota.service';
import { applicationBlockers } from './motivation-eligibility';
import {
  MotivationResearchService,
  RESEARCH_ASK_VERSION,
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
import { cartridgeFacts, findCartridge } from './motivation-cartridge';
import { arsenalRows, type ArsenalRow } from './motivation-arsenal';
import { documentScope, southAfricanise } from './motivation-scope';
import {
  hasDeclaredRecord,
  holdsFirearms,
  isAssociationMember,
  isSelfDefence,
  s15Purpose,
} from './motivation-fields';
import { packableIncidents } from './motivation-incident-filter';
import { displayCalibre } from './saps-vocabulary';
import {
  ownedFirearmCardTypes,
  ownedFirearmSections,
} from './owned-firearm-sections';
import {
  actionFromCardType,
  FirearmUsesService,
  useClassKey,
  type CandidateUses,
  type UseSlice,
} from './firearm-uses.service';

/**
 * The section the application itself is lodged under, as a licence card writes
 * it, and which discipline it asks for.
 *
 * ⚠️ `appliedSectionNumber` COULD NOT ANSWER EITHER QUESTION. It returns a
 * bare number, has no case for S14 (which falls through to ''), and it cannot
 * say that S16_DEDICATED_HUNTER means hunting and not sport — which is the
 * whole point of asking here.
 *
 * ⚠️ A RENEWAL IS ABSENT FROM BOTH, deliberately. Section 24 does not record
 * the section of the licence being renewed.
 */
const APPLIED_SECTION: Partial<Record<MotivationLicenceType, string>> = {
  [MotivationLicenceType.S13_SELF_DEFENCE]: 'section 13',
  [MotivationLicenceType.S14_RESTRICTED_SELF_DEFENCE]: 'section 14',
  [MotivationLicenceType.S15_OCCASIONAL_HUNTER]: 'section 15',
  [MotivationLicenceType.S16_DEDICATED_HUNTER]: 'section 16',
  [MotivationLicenceType.S16_DEDICATED_SPORT]: 'section 16',
};

const APPLIED_SLICES: Partial<Record<MotivationLicenceType, UseSlice[]>> = {
  [MotivationLicenceType.S13_SELF_DEFENCE]: ['s13'],
  [MotivationLicenceType.S14_RESTRICTED_SELF_DEFENCE]: ['s14'],
  // ⚠️ ONE ENUM VALUE COVERS BOTH. Section 15 is the occasional hunter OR the
  // occasional sports shooter and the product does not split them.
  [MotivationLicenceType.S15_OCCASIONAL_HUNTER]: ['s15_hunt', 's15_sport'],
  [MotivationLicenceType.S16_DEDICATED_HUNTER]: ['s16_hunt', 's16_sport'],
  [MotivationLicenceType.S16_DEDICATED_SPORT]: ['s16_hunt', 's16_sport'],
};

/**
 * Which pool the applicant asked for, out of the ones the section admits.
 *
 * ⚠️ THE MEMBER'S ONE TICK DECIDES THIS. Operator, 2026-09-09: "we just need
 * to ask if the applicant will be using it for hunting or Sport shooting or
 * both … and that will decide from which pool of reasons we are going to
 * motivate that firearm." `firearm_use_kind` is the only tick-box left in the
 * Experience section and this is the whole of what it does.
 *
 * ⚠️ THE LICENCE TYPE STILL BOUNDS IT. A section 13 application has no
 * sporting pool to choose from whatever anybody ticks, so the tick filters
 * what the section already admits rather than replacing it. And an unanswered
 * tick takes everything the section admits — the field is required, but a
 * draft written before it existed is not broken by it.
 */
function slicesWanted(
  licenceType: MotivationLicenceType,
  answers: Record<string, string>,
): UseSlice[] {
  const admits = APPLIED_SLICES[licenceType] ?? [];
  const tick = (answers.firearm_use_kind ?? '').trim();
  if (!tick || tick === 'both') return admits;
  if (tick === 'hunting') {
    return admits.filter((s) => !s.endsWith('_sport'));
  }
  if (tick === 'sport') {
    return admits.filter((s) => !s.endsWith('_hunt'));
  }
  return admits;
}
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
 * reason — a pass is still in flight. ABANDONED stays out: that is somebody
 * deliberately walking away.
 *
 * ⚠️ FAILED IS IN, AND LEAVING IT OUT MADE THE PRODUCT CONTRADICT ITS OWN SMS.
 * The note here used to read "FAILED and ABANDONED stay out: an admin owns
 * those." Meanwhile notifyOutcome sends the applicant: "we could not finish
 * document MO000074. Nothing is lost and nothing was charged. Open it and try
 * again" — with a link. They open it, the button is enabled, they press it, and
 * the server answers 409 "This document cannot be prepared again from here.
 * Contact support." Measured on MO000074 on 2026-09-09, through the real page.
 *
 * A FAILED row is OUR writer failing its own mechanical checks twice — a wrong
 * calibre string, an Americanism. There is nothing for an admin to adjudicate
 * and nothing the applicant did wrong; they are the one person who cannot fix
 * it and the only one we sent to fix it.
 *
 * The two things that made FAILED look dangerous are both already handled: the
 * seat is claimed once per motivation and not once per attempt, so a retry
 * takes no second seat, and the controller's 10-per-hour throttle is what
 * bounds the spend.
 *
 * ⚠️ REGENERATING SPENDS REAL MONEY — a measured S16 run cost $1.64 — but it
 * does NOT take a second seat: the seat is claimed once per motivation, not
 * once per attempt (see the claim below). The ceiling is the controller's
 * 10-per-hour throttle.
 */
export const REGENERABLE: MotivationStatus[] = [
  ...EDITABLE,
  MotivationStatus.COMPLETED,
  MotivationStatus.FAILED,
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
    // What a firearm of a given CLASS is used for, generated once per class
    // and shared by everyone who holds one. See firearm-uses.service.ts.
    private readonly firearmUses: FirearmUsesService,
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
        researchAskVersion: true,
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
      // ⚠️ SECTION 14 TOO. s14(4) asks the applicant to show a section 13
      // firearm is not enough WHERE THEY LIVE, so the precinct figures and
      // the cuttings are more load-bearing here than on a section 13.
      if (isSelfDefence(row.licenceType)) {
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
      /**
       * ⚠️ SCRUBBED ON THE WAY OUT, NOT ONLY ON THE WAY IN. The shared
       * table is cleaned when it is written, and that does nothing for a
       * document holding its own frozen copy from before the rule existed —
       * which is every document written so far. MO000075 still carried
       * "platform" and "receiver" in `researchEncrypted` two fixes after the
       * shared cache was cleaned, and the writer was still being handed them.
       *
       * ⚠️ SO THE GUARANTEE BELONGS AT THE POINT OF USE. Wherever the text
       * came from — a fresh call, the shared row, or a column frozen weeks ago
       * — the writer is never shown a sentence it would be refused for
       * repeating. A cache is not a way round a rule.
       */
      /**
       * ⚠️ AND A BLOCK GATHERED UNDER AN OLDER ASK IS NOT REUSED.
       *
       * RESEARCH_ASK_VERSION lives in the SHARED cache key, so rewording an
       * ask re-asks for everybody who has not been researched yet. It did
       * nothing for anybody who had: this column is written once and read
       * forever after, and the render slices the cartridge feature straight
       * out of it. MO000075 printed "1,000 to 1,300 yards" beside a drawing
       * dimensioned in millimetres for a whole day after the ask gained
       * METRIC ONLY, because its block was frozen the day before.
       *
       * A miss here costs one research pass, and the shared cache means it is
       * paid once per distinct cartridge rather than once per applicant.
       */
      const researchIsCurrent = row.researchAskVersion === RESEARCH_ASK_VERSION;
      let research =
        row.researchEncrypted && researchIsCurrent
          ? (withoutRefusedCopy(tryDecryptText(row.researchEncrypted) ?? '') ||
            undefined)
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
              data: {
                researchEncrypted: encryptText(text),
                researchAskVersion: RESEARCH_ASK_VERSION,
              },
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
      // ⚠️ SECTION 14 TOO. s14(4) asks the applicant to show a section 13
      // firearm is not enough WHERE THEY LIVE, so the precinct figures and
      // the cuttings are more load-bearing here than on a section 13.
      if (isSelfDefence(row.licenceType)) {
        const ids = parsePressClippingIds(answers[PRESS_CLIPPINGS_KEY]);
        if (ids.length) {
          try {
            /**
             * ⚠️ FILTERED AGAIN ON THE WAY OUT, NOT ONLY ON THE WAY IN. The
             * ids are stored on the application and an older draft can hold
             * one chosen before the filter existed; nothing that reaches an
             * annexure gets there on the strength of when it was picked.
             */
            pressClips = packableIncidents(await this.news.byIds(ids));
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
      const rawAnnexures = buildAnnexures(uploadKinds);
      const annexures = rawAnnexures.map((a) => ({
        letter: a.letter,
        label: a.label,
      }));

      /**
       * ⚠️ NO ANNEXURE LETTER ANY MORE, AND THAT IS THE POINT. Operator,
       * 2026-09-09: "only paperwork required by the dfo are attached as
       * annexures. all other things like the cartridge specs and clippings and
       * those things must be in the body of the document itself and form part
       * of the flow, it must not be just placed there because it has to be
       * there."
       *
       * A cutting is published material we assembled; the applicant holds no
       * original of it and no DFO will ask to see one. So it is cited the way
       * a person cites a newspaper in a letter — by paper and date, in the
       * sentence that uses it — and the cutting itself prints in the exposure
       * section beside the argument it supports.
       */
      let pressClippingsBlock: string | undefined;
      if (pressClips.length) {
        pressClippingsBlock = [
          'PRESS CLIPPINGS — supplied fact, printed in the body of this',
          'document beside the paragraph that uses them. Cite each one by its',
          'PAPER and its DATE inside the sentence that relies on it — never by',
          'an annexure letter, because they are not annexures.',
          ...clippingFactLines(pressClips),
        ].join('\n');
      }

      /**
       * ⚠️ THE ARSENAL, IN ROWS. Until now the writer was given
       * `<derived name="firearms already held">5</derived>` and nothing else —
       * no makes, calibres, types, sections or serials — and then INSTRUCTED
       * by `overlapNote` to "meet that head on: say what this one does that
       * the one held does not". It was ordered to compare against five
       * firearms it had never been shown, so it invented all five, including
       * two licence sections. A DFO holding the licence copies in Annexure G
       * sees the contradiction on the page.
       *
       * ⚠️ THE SAME ARRAY THE 271 AND THE TABLE USE. Item 2.1 of the form, the
       * owned-firearms table in the pack and this block must agree serial for
       * serial, and the only way that holds is one source.
       */
      const arsenal = await this.arsenalFor(row.userId, answers);

      /**
       * ⚠️ AND THE FIREARM BEING APPLIED FOR, IN THE OTHER TENSE. Operator,
       * 2026-09-09, on why the basket exists at all: "lets say I have a
       * section 16 300 winmag. Now I want a 300 prc, they both can do the
       * exact same thing, so this is why the basket of reasons exists. so it
       * can pick one for the 300 winmag I already own and state another reason
       * why I would want the 300 prc."
       *
       * ⚠️ WHICH ONLY WORKS IF THE TENSES DIFFER. "I use it for plains game"
       * is true of the Win Mag in the safe and false of the PRC on the form —
       * and worse than false: "if I state that I already, the obvious question
       * will be why do you need a firearm for it if you already do."
       */
      const intendedUses = await this.intendedUsesFor(row.licenceType, answers);

      /**
       * ⚠️ THE CARTRIDGE, MEASURED RATHER THAN RECALLED. Operator, 2026-09-09:
       * "why arent we pulling in the dimension sheet of the cartridge its
       * using from The Bench?" MO000071 spent two sections on "115 to 147
       * grains" and "3 to 5 foot-pounds" — figures nothing supplied and a
       * Registrar can correct. The Bench holds 215 dimension sheets; this
       * hands over the one for the calibre applied for, and the block itself
       * forbids every figure it does not carry.
       */
      const cartridge = await this.cartridgeFor(answers);

      const pack: FactPack = {
        licenceType: row.licenceType,
        /**
         * ⚠️ THE CALIBRE IS TIDIED ON THE WAY TO THE WRITER, AND NOWHERE ELSE.
         * "9MM PAR ( 9X19MM )" is how the string sits on the operator's licence
         * card — screaming case, a space inside each bracket, an abbreviation
         * nobody writes out — and it printed into MO000071 three times exactly
         * as read. A card is a source, not a house style.
         *
         * ⚠️ THE STORED ANSWER IS UNTOUCHED. It is what the card says and what
         * the 271 boxes take; only the copy handed to the model is normalised,
         * so nothing downstream of the vault sees a value the member did not
         * give. `packConsistency` knows about both forms.
         */
        answers: {
          ...answers,
          firearm_calibre: displayCalibre(answers.firearm_calibre),
        },
        arsenal,
        intendedUses,
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
          [precinctBlock, pressClippingsBlock, cartridge, research]
            .filter(Boolean)
            .join('\n\n') || undefined,
        annexures,
      };

      // Draft, verify the plan landed, and check it does not look like
      // everything else we have produced. ONE retry with a fresh seed covers
      // both failures — a second identical result means the variation engine
      // is broken, which is an admin problem rather than a user one.
      //
      /**
       * ⚠️ THE PLAN NEEDS FOUR FACTS ABOUT THE APPLICANT, not just the seed.
       * Three of the twelve fixed headings are omitted on the applicant's own
       * answers rather than on the licence type — the battery table where
       * nothing is held, the record where nothing is declared, the association
       * where there is none — and a section 15 chooses between two purpose
       * headings. Each is a pure read of the answers; see motivation-fields.ts.
       *
       * ⚠️ `hasOverlap` IS GONE FROM HERE AND THAT IS THE CHANGE, NOT AN
       * OMISSION. Heading 6 used to appear only where the applicant held a
       * SAME-CLASS firearm. Book Part 5.1 brief 6 and Part 6.5 make it the
       * battery section: every held firearm gets a row and a sentence, because
       * the DFO reads the licence record against the request whether or not two
       * entries happen to be the same class. The overlap still decides the
       * writer's DIRECTION — `overlapNote` below — it no longer decides whether
       * there is a section to put it in.
       */
      const planOpts = {
        holdsFirearms: holdsFirearms(answers),
        hasRecord: hasDeclaredRecord(answers),
        isAssociationMember: isAssociationMember(answers),
        purpose: s15Purpose(answers),
      };
      let seed = row.variantSeed;
      let plan = planFor(row.licenceType, seed, planOpts);
      /**
       * ⚠️ SPELLING IS FOLDED BEFORE ANYTHING IS CHECKED, AND MO000074 IS WHY.
       *
       * The scope check is right that "organization" and "specialized" do not
       * belong in a document filed in South African English — but it is a
       * MECHANICAL check, and a mechanical failure costs the applicant the
       * whole pack: one regeneration, the same two words, then FAILED and an
       * SMS reading "we could not finish document MO000074". Two spellings are
       * not a reason to refuse somebody their licence application.
       *
       * `southAfricanise` changes spelling and nothing else — the -ise/-ize
       * alternation and four nouns. No fact moves and no sentence is rewritten,
       * which is what makes it safe to do silently and the only kind of edit
       * that would be. The check stays and now fires only on something this
       * could not fix, which is the signal worth having.
       */
      const write = async (retryIssues?: readonly string[]) => {
        const r = await this.model.generate(pack, plan, retryIssues);
        return { ...r, text: southAfricanise(r.text) };
      };
      let attempt = await write();
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
      /**
       * ⚠️ AND THE SCOPE CHECK RIDES WITH IT, for the same reason and on the
       * same retry. A wrong licence section, a role nothing supplied, or
       * "terminal ballistics" in a self-defence application are all faults the
       * APPLICANT cannot fix by answering another question — they are the
       * writer's, so they take the mechanical path (one regeneration, then an
       * admin alert) rather than the quality gate's path back to the member.
       */
      const scopeOf = (t: string) =>
        documentScope(t, { licenceType: row.licenceType, arsenal });
      let mechanics = [
        ...packConsistency(attempt.text, answers, annexures),
        ...scopeOf(attempt.text),
      ];

      /**
       * ⚠️ SAMENESS IS NO LONGER A REASON TO REGENERATE, and taking it out is
       * the point rather than an oversight.
       *
       * The skeleton is fixed now (book Part 4.2), so a fresh seed produces
       * the SAME plan — a second call to arrive at the same twelve headings,
       * paid for, on a document whose structure is supposed to match every
       * other document of its type. Two motivations of one section scoring
       * alike is now the design working.
       *
       * It is still MEASURED and still stored, because a score at the ceiling
       * says something else entirely: that the facts stopped reaching the
       * writer and two different applicants got the same prose. That is an
       * admin's problem to look at, so it raises a card and does not spend the
       * applicant's generation on it.
       */
      if (sameness > SIMILARITY_REGENERATE_THRESHOLD) {
        this.logger.warn(
          `Motivation ${row.id}: sameness ${sameness.toFixed(2)} over ${SIMILARITY_REGENERATE_THRESHOLD}`,
        );
        void this.prisma.adminAlert
          .create({
            data: {
              type: 'motivation-sameness-high',
              urgent: false,
              context: `Motivation ${row.id} scored ${sameness.toFixed(2)} against recent ${row.licenceType} documents. The skeleton is fixed, so structural overlap is expected; a score this high means the PROSE is repeating and the applicant's own facts may not be reaching the writer.`,
            },
          })
          .catch(() => undefined);
      }

      /**
       * ⚠️ TWO RETRIES, NOT ONE, BECAUSE THE RETRY STOPPED BEING BLIND.
       *
       * The single retry was set when a second attempt was a fresh seed and
       * the IDENTICAL prompt: "a second identical result means the variation
       * engine is broken", which was true of a rerun that had learnt nothing.
       * It carries the previous draft's own failures now, and attempts
       * CONVERGE — measured on MO000074, 2026-09-09: nine mechanical issues on
       * the first attempt, three on the second, the same three each run.
       *
       * Stopping at two therefore threw away a document that was two words and
       * one sentence from filing, and told the applicant we could not finish
       * it. A third attempt is one more model call against a failure that
       * currently costs them the entire pack.
       *
       * ⚠️ AND IT STOPS EARLY WHEN IT IS NOT CONVERGING. A round that fixes
       * nothing — the same count or worse — is a writer that cannot see the
       * problem, and paying for a fourth read of the same instruction is how a
       * retry budget turns into a bill. That is a different failure from a
       * near miss and it should not cost the same.
       */
      /**
       * ⚠️ THE BEST ATTEMPT IS KEPT, NOT THE LAST ONE, AND A RETRY CAN MAKE IT
       * WORSE.
       *
       * Measured on MO000074, 2026-09-09: one run's first attempt carried a
       * SINGLE mechanical issue; its retry — told exactly what that issue was
       * — came back with three, including two the first draft had not had. The
       * loop then failed the application on the retry's three, having thrown
       * away a document that was one sentence from filing.
       *
       * Feedback makes a retry better ON AVERAGE, not monotonically. Nothing
       * about "here is what you got wrong" stops a model rewriting a clean
       * paragraph badly while it fixes the one that was flagged. So every
       * attempt is scored and the cleanest is what proceeds or what is
       * reported — bookkeeping, not another model call.
       */
      let best = { text: attempt.text, mechanics, structureOk };
      const keepIfBetter = () => {
        if (
          (structureOk ? 0 : 1) + mechanics.length <
          (best.structureOk ? 0 : 1) + best.mechanics.length
        ) {
          best = { text: attempt.text, mechanics, structureOk };
        }
      };

      const MAX_ATTEMPTS = 3;
      for (
        let attemptNo = 2;
        attemptNo <= MAX_ATTEMPTS && (!structureOk || mechanics.length);
        attemptNo++
      ) {
        const before = mechanics.length;
        this.logger.warn(
          `Motivation ${row.id}: regenerating ${attemptNo}/${MAX_ATTEMPTS} (structureOk=${structureOk}, sameness=${sameness.toFixed(2)}, mechanics=${before})`,
        );
        seed = crypto.randomInt(0, 2 ** 31 - 1);
        plan = planFor(row.licenceType, seed, planOpts);
        /**
         * ⚠️ THE RETRY IS TOLD WHAT IT GOT WRONG, WHICH IT NEVER USED TO BE.
         * A fresh seed and the identical prompt gave the model no reason to
         * avoid the mistake it had just made — MO000074 was refused twice for
         * the same two Americanisms. `mechanics` is our own words about the
         * previous draft and names nothing about the applicant, so it can add
         * no fact; see renderRetry.
         */
        attempt = await write(mechanics);
        tokensIn += attempt.usage.promptTokens;
        tokensOut += attempt.usage.completionTokens;
        structureOk = followsPlan(attempt.text, plan).ok;
        sameness = maxSimilarity(fingerprint(attempt.text), previous);
        mechanics = [
          ...packConsistency(attempt.text, answers, annexures),
          ...scopeOf(attempt.text),
        ];
        keepIfBetter();
        /**
         * ⚠️ THE EARLY BREAK IS GONE, AND IT WAS COSTING US THE THIRD
         * ATTEMPT EVERY TIME.
         *
         * It stopped as soon as an attempt was no better than the one before,
         * reasoning that "the next round would read the same instruction and
         * produce the same draft". That was true when the failures were
         * SYSTEMATIC — a brief that invited catalogue copy, a marker that was
         * being suppressed — and every one of those is now fixed at its source.
         *
         * What is left is variance. Across nine hundred words and forty-odd
         * refused phrases, each draft trips something different: platform, then
         * terminal ballistic, then engage targets, then two mistyped digits in
         * a date the facts state plainly. Under that, "attempt two was no
         * better than attempt one" is ONE SAMPLE, not evidence about attempt
         * three — and MO000075 never reached attempt three once, in five days
         * of failing. Every log reads `regenerating 2/3` and then stops.
         *
         * An attempt is five seconds and about a cent. Take all three, keep the
         * cleanest, and let the repair pass mend what is only a word.
         */
      }

      // ⚠️ WHATEVER PROCEEDS OR IS REPORTED IS THE CLEANEST DRAFT, not the last
      // one written. See `best` above.
      attempt = { ...attempt, text: best.text };
      mechanics = best.mechanics;
      structureOk = best.structureOk;

      /**
       * ⚠️ MEND THE SENTENCE BEFORE BINNING THE DOCUMENT.
       *
       * The gate is all-or-nothing over nine hundred words, and MO000075 spent
       * two days failing it — "platform", then "terminal ballistic", then
       * "engage targets". A DIFFERENT word each time, on a draft that was
       * structurally clean every time. That is variance, not a bug still to
       * find: across forty-odd refused phrases a model will occasionally reach
       * for one, and regenerating the whole document to fix two words both pays
       * to rewrite fifteen hundred of them and rolls the dice again on every
       * phrase that was already fine.
       *
       * ⚠️ ONLY WHERE EVERY COMPLAINT IS ABOUT A WORD. repairTargets
       * returns null for anything else — a wrong section, a missing annexure, a
       * purpose nobody stated — because those are the writer corrupting facts,
       * and a pass that "mended" a wrong serial by rephrasing it would be the
       * worst thing in this file.
       *
       * ⚠️ AND THE FULL GATE RUNS AGAIN OVER THE RESULT. The repair is not
       * trusted: packConsistency and documentScope both re-run, so a rewrite
       * that introduced a fact or traded one refused word for another fails
       * exactly as the draft would have.
       */
      const targets = repairTargets(best.text, mechanics);
      if (targets) {
        const fixed = await this.model.repairSentences(targets);
        if (fixed) {
          const mended = applyRepairs(best.text, fixed.sentences);
          const after = [
            ...packConsistency(mended, answers, annexures),
            ...scopeOf(mended),
          ];
          if (
            mended !== best.text &&
            !after.length &&
            followsPlan(mended, plan).ok
          ) {
            this.logger.log(
              `Motivation ${row.id}: mended ${targets.length} sentence(s) rather than regenerating`,
            );
            attempt = { ...attempt, text: mended };
            tokensIn += fixed.usage.promptTokens;
            tokensOut += fixed.usage.completionTokens;
            mechanics = [];
            structureOk = true;
          } else if (after.length) {
            this.logger.warn(
              `Motivation ${row.id}: repair did not clear the gate (${after[0]})`,
            );
          }
        }
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
            /**
             * ⚠️ KEEP THE REJECTED DRAFT. A mechanical failure discarded the
             * text, so the one artefact that could explain the refusal was
             * gone: `failureReason` names the WORD it tripped on and never the
             * sentence, and nobody — operator or engineer — could see what the
             * document actually said. Diagnosing MO000074 meant reasoning about
             * a document that no longer existed anywhere.
             *
             * It is stored exactly as every other draft is, encrypted at rest
             * in the same column, and it is not shown to the member: the status
             * is FAILED, so no download path will render it.
             */
            documentTextEncrypted: encryptText(attempt.text),
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
    if (!isSelfDefence(row.licenceType)) {
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
    if (!isSelfDefence(row.licenceType)) {
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
        // ⚠️ ASK FOR MORE THAN WE SHOW, BECAUSE THE FILTER TAKES SOME. Twelve
        // in and twelve out meant a precinct whose last quarter was mostly
        // court reporting offered the member three cuttings.
        limit: 24,
      });
      /**
       * ⚠️ THE PICKER OFFERED A CHILD-RAPE CASE AND A COURT POSTPONEMENT. See
       * motivation-incident-filter: a report the applicant would not want in
       * their own pack must never be offered to them in the first place, and a
       * court diary entry is a report about a case rather than about a
       * neighbourhood.
       */
      return { station, incidents: packableIncidents(incidents).slice(0, 12) };
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
    if (!isSelfDefence(row.licenceType)) {
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
      // ⚠️ AND THE AREAS ARE BUILT ONLY FROM REPORTS THAT COULD BE ANNEXED.
      // An area whose entire evidence is a court diary entry is an area we
      // would ask the member to tick and then have nothing to print for.
      incidents = packableIncidents(incidents);
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
   * Every firearm the applicant holds, as rows the writer may name.
   *
   * ⚠️ THE SECTION COMES OFF THE LICENCE CARD, BY SERIAL, OR IT IS ABSENT.
   * `ownedFirearmSections` matches an owned row to its vault credential and
   * refuses a make-and-calibre match — two of a battery can share both, and
   * the wrong section on a signed document is the fault this exists to stop. A
   * row we cannot place carries no section, and the prompt then forbids the
   * writer from naming one.
   */
  private async arsenalFor(
    userId: string,
    answers: Record<string, string>,
  ): Promise<ArsenalRow[]> {
    let sections: Record<number, string> = {};
    let cardTypes: Record<number, string> = {};
    try {
      const rows = await this.prisma.credential.findMany({
        where: { userId, kind: 'FIREARM_LICENCE', purgedAt: null },
        select: { detailsEncrypted: true },
      });
      const licences = rows.map((r) => ({
        details:
          decryptJson<Record<string, string>>(r.detailsEncrypted ?? '') ?? {},
      }));
      sections = ownedFirearmSections(answers, licences);
      cardTypes = ownedFirearmCardTypes(answers, licences);
    } catch {
      // A vault read that throws costs the sections, never the rows.
      sections = {};
      cardTypes = {};
    }

    /**
     * ⚠️ TWO PASSES, BECAUSE THE CLASS IS READ OFF THE ROW. The first builds
     * the rows so each one's calibre, type and section are settled — the
     * member's own correction of a bad OCR included — and the second attaches
     * what a firearm of that class is used for. Generating from the raw
     * answers instead would ask about a section the member had already fixed.
     *
     * ⚠️ ONE LOOKUP PER CLASS, NOT PER FIREARM. A battery of four 9mm
     * handguns under section 13 is ONE class: resolved per row they would all
     * miss the cache together and buy four generations of the same answer,
     * with the upsert deciding which one survived. The corpus's own example
     * battery is exactly that shape.
     *
     * ⚠️ IN PARALLEL AND NEVER FATAL. `forClass` returns [] rather than
     * throwing (a model outage must not fail somebody's application), so a
     * row that comes back empty is the state this feature replaces, not an
     * error.
     */
    const rows = arsenalRows(answers, sections);
    const classes = new Map<
      string,
      { calibre: string; type: string; action: string; section: string }
    >();
    const classOf = new Map<number, string>();
    const seeds = new Map<string, string>();
    for (const r of rows) {
      const c = {
        calibre: r.calibre,
        type: r.type,
        // ⚠️ THE ONE BIT THE FORM'S FOUR CHOICES CANNOT HOLD, and the only
        // thing taken off the card's free-text Type row. Keeping the card's
        // words out of the class key is deliberate: "S/L RIFLE" and
        // "SELF-LOADING RIFLE" are the same firearm and must not each buy
        // their own generation.
        action: actionFromCardType(cardTypes[r.index] ?? ''),
        // Not part of the class key — it chooses which slices are read back.
        section: r.section,
      };
      const key = `${useClassKey(c, 's13')}|${c.section}`;
      classes.set(key, c);
      classOf.set(r.index, key);
      // First row of a class fixes the window for all of them.
      if (!seeds.has(key)) seeds.set(key, r.serial || r.make || key);
    }

    const keys = [...classes.keys()];
    const resolved = await Promise.all(
      /**
       * ⚠️ SEEDED ON THE SERIAL, so two members holding the same calibre are
       * not offered the same ten sentences in the same order — the table holds
       * up to forty per list and the writer sees a window into it. Stable for
       * one firearm across regenerations, which is what keeps a retry a second
       * attempt at the same document rather than a different one.
       */
      keys.map((k) =>
        this.firearmUses.forClass(classes.get(k)!, seeds.get(k) ?? k),
      ),
    );
    const byClass = new Map(keys.map((k, i) => [k, resolved[i]]));

    const uses: Record<number, CandidateUses[]> = {};
    for (const r of rows) {
      const found = byClass.get(classOf.get(r.index) ?? '') ?? [];
      if (found.length) uses[r.index] = found;
    }
    return arsenalRows(answers, sections, uses);
  }

  /**
   * What the applicant might do with the firearm they are APPLYING for.
   *
   * ⚠️ ONLY WHERE THEY HAVE STATED NOTHING THEMSELVES, which is the same rule
   * `licensedFor` follows on a held row and for the same reason. The wizard
   * asks what they hunt, where, why they shoot and in what formats; where any
   * of that is answered it IS the purpose, it is theirs, and offering the
   * writer a generated alternative beside it invites a nicer sentence than the
   * truth. Rule 12 is enforced by absence, not by hope.
   *
   * ⚠️ THE APPLICATION NARROWS THE DISCIPLINE WHERE A CARD CANNOT. A held
   * section 16 firearm is offered both hunting and sport reasons because the
   * card does not say which; an S16_DEDICATED_HUNTER application says exactly
   * which, so only that list is asked for.
   *
   * ⚠️ AND A RENEWAL GETS NOTHING. Section 24 does not record the section of
   * the licence being renewed, so there is no discipline to ask under — and a
   * renewal argues continuity rather than a new purpose anyway.
   */
  private async intendedUsesFor(
    licenceType: MotivationLicenceType,
    answers: Record<string, string>,
  ): Promise<CandidateUses[]> {
    /**
     * ⚠️ ONLY `intended_quarry` IS LEFT OF THIS GATE, and that is the point.
     * It used to test five keys, four of which were the card grids the
     * generated uses replaced on 2026-09-09 — asking whether the applicant had
     * described their own purpose. `firearm_use_kind` is NOT such a key: it
     * says which pool to draw from, not what the applicant does, so ticking it
     * must not suppress the pool it just chose.
     *
     * What survives is the one box where somebody types a purpose in their own
     * words. Where they have, it is theirs and it wins outright — the same rule
     * `licensedFor` follows on a held row, enforced by absence rather than by
     * hope.
     */
    if ((answers.intended_quarry ?? '').trim() !== '') return [];

    const wanted = slicesWanted(licenceType, answers);
    if (!wanted.length) return [];

    return this.firearmUses.forClass(
      {
        calibre: answers.firearm_calibre ?? '',
        type: answers.firearm_type ?? '',
        action:
          answers.firearm_action === 'Semi-automatic (self-loading)'
            ? 'Self-loading'
            : (answers.firearm_action ?? '').trim()
              ? 'Manual'
              : '',
        section: APPLIED_SECTION[licenceType] ?? '',
      },
      answers.firearm_serial || answers.firearm_calibre || '',
      'applying',
      wanted,
    );
  }

  /**
   * The dimension sheet for the calibre applied for, or nothing.
   *
   * ⚠️ FAILS SOFT AND SILENT, like every other supplied-fact lookup here. A
   * cartridge we hold no sheet for simply arrives without a block, and the
   * prompt's rule against recalled ballistics still stands — so the absence
   * costs a paragraph its measurements, never the document.
   */
  private async cartridgeFor(
    answers: Record<string, string>,
  ): Promise<string | undefined> {
    const printed = (answers.firearm_calibre ?? '').trim();
    if (!printed) return undefined;
    try {
      /**
       * ⚠️ MATCHED IN MEMORY, NOT IN SQL. The key is a reduction — case,
       * spaces and punctuation removed on BOTH sides — and there is no index
       * on a reduction. 232 cartridges and their aliases is a page, not a
       * scan, and the alternative is a LIKE that cannot express "9 mm Luger"
       * matching "9MMLUGER".
       */
      const all = await this.prisma.benchCartridge.findMany({
        select: {
          name: true,
          slug: true,
          type: true,
          origin: true,
          year: true,
          caseLengthMm: true,
          maxLengthMm: true,
          pmaxBar: true,
          pmaxPsi: true,
          aliases: { select: { printed: true } },
          dims: {
            select: {
              L3: true,
              L6: true,
              bF: true,
              bZ: true,
              bN: true,
              pmaxBar: true,
            },
          },
        },
      });

      // ⚠️ THE SAME MATCHER THE DRAWING USES. A pack that argues about one
      // round and prints the dimensions of another is worse than one that
      // prints no dimensions at all.
      return cartridgeFacts(findCartridge(all, printed)) ?? undefined;
    } catch (err) {
      this.logger.warn(
        `Cartridge sheet lookup failed for "${printed}": ${(err as Error).message}`,
      );
      return undefined;
    }
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
