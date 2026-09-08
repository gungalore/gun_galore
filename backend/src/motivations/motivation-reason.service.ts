import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MotivationLicenceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { encryptJson } from '../common/blob-crypto';
import { answerValue } from '../common/card-placeholder';
import { parseProvenance, stamp } from '../common/answer-provenance';
import { MotivationSharedService } from './motivation-shared.service';
import { MotivationResearchService } from './motivation-research.service';
import {
  OWNED_ROWS,
  ownedFirearmSerial,
  ownedRowTaken,
} from './motivation-fields';
import {
  REASON_BANKS,
  REASON_SCHEMA,
  countWords,
  proseFirearmName,
  reasonSystemPrompt,
  validateReason,
  type ReasonResult,
} from './motivation-reason';

// ────────────────────────────────────────────────────────────────────
// WRITING "WHY THIS FIREARM", AND PUTTING IT WHERE THE MEMBER CAN CHANGE IT.
//
// From MOTIVATION-REASON-PROMPT.md. What that document specifies and what this
// codebase can actually do differ in three places, all recorded on
// motivation-reason.ts: there is no Anthropic "writer tier" (one adapter, and
// Anthropic is a rollback lever), structured outputs ARE used because the repo
// rule reversed, and `previous_motivations` has no store yet.
//
// ⚠️ IT LANDS ON `firearm_fit_reason`, WHICH IS NOT A NEW FIELD BUT THE ONE
// THIS WAS ALWAYS FOR. That box was `required` until 2026-09-08 and was "the
// largest single reason an application stalled: it asked the applicant to write
// the argument the product exists to write for them". It became optional and
// prefilled. This is the prefill it was waiting for.
//
// ⚠️ AND IT IS STAMPED DERIVED + inferred, WHICH IS WHAT MAKES IT A SUGGESTION.
// The sheet renders an inferred value as `suggested` — gold wash, "check this",
// a Confirm button — and stamp() refuses to overwrite MEMBER, so a paragraph
// somebody has already edited is never silently replaced by a new generation.
// A document the applicant signs is exactly the case for "fill it in, arm it,
// let them change it".
// ────────────────────────────────────────────────────────────────────

/** Everything the model is told, as the spec's user message. */
interface ReasonInput {
  licence_type: MotivationLicenceType;
  applicant: Record<string, unknown>;
  applied_for: Record<string, string>;
  arsenal: Record<string, string>[];
  associations: Record<string, string>[];
  activity: Record<string, unknown>;
  cards_tapped: string[];
  research: string;
  /**
   * ⚠️ ALWAYS EMPTY TODAY, AND DELIBERATELY PRESENT. Nothing stores an approved
   * application's angle, stated purpose or outcome, so the storyline the spec
   * describes cannot be built yet. The field travels empty rather than being
   * omitted so the prompt reads it as "first application" — and so the day a
   * store exists, only the filling changes.
   */
  previous_motivations: Record<string, string>[];
  /**
   * What the endorsing association actually runs, and the equipment rule for
   * each exercise.
   *
   * ⚠️ ALSO ALWAYS EMPTY TODAY, AND ITS EMPTINESS IS ENFORCED. Brief §5.5a
   * builds `association-activities.ts` — per SAPS accreditation number, every
   * exercise with its printed rule ("7m 2x5 shot: only 9mmP pistols and larger",
   * "5m Snubby and Pocket Pistol: barrel not longer than 100mm"). That rule is
   * the whole strength of the `exercise_eligibility` angle, because it is a gap
   * a reviewer can check against an annexure in the same pack.
   *
   * ⚠️ UNTIL IT EXISTS THE MODEL MAY NOT ASSERT ONE. The first generation under
   * the new rules wrote that the applicant's CZ "is restricted to pocket pistol
   * events and cannot meet the chambering and capacity requirements" — which is
   * plausible, is probably true, and is supported by nothing in the pack. An
   * unprovable claim on a signed document is the failure this whole file is
   * about. `validateReason` refuses one while this list is empty.
   */
  association_activities: Record<string, string>[];
  constraints: Record<string, unknown>;
}

@Injectable()
export class MotivationReasonService {
  private readonly logger = new Logger(MotivationReasonService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly shared: MotivationSharedService,
    private readonly research: MotivationResearchService,
  ) {}

  /**
   * Generate the reason and write it onto the application as a suggestion.
   *
   * ⚠️ IT RETURNS THE REJECTIONS RATHER THAN HIDING THEM. A generation thrown
   * away for a good reason — a make the applicant does not hold, a paragraph
   * that argues sport on a self-defence application — is the most interesting
   * thing this service produces, and the operator asked to be able to see which
   * angles survive.
   */
  async writeFor(
    clerkId: string,
    motivationId: string,
  ): Promise<{
    written: boolean;
    angle?: string;
    paragraph?: string;
    warnings?: string[];
    rejections?: string[];
  }> {
    const user = await this.shared.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id: motivationId, userId: user.id },
      select: {
        id: true,
        licenceType: true,
        answersEncrypted: true,
        answerProvenance: true,
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    const answers = this.shared.readAnswers(row.answersEncrypted);
    const provenance = parseProvenance(row.answerProvenance);

    /**
     * ⚠️ A PARAGRAPH THE MEMBER HAS TOUCHED IS NEVER REGENERATED. stamp()
     * would refuse the write anyway, but spending a model call to be refused is
     * a bill for nothing.
     */
    if (provenance.firearm_fit_reason?.source === 'MEMBER') {
      return { written: false, rejections: ['the applicant has written their own'] };
    }

    const input = await this.buildInput(row.licenceType, answers);

    /**
     * ⚠️ NOTHING TO ARGUE FROM IS NOT A FAILURE. Before the firearm is
     * described there is no reason to write — and a paragraph invented from an
     * empty arsenal and an unnamed firearm is exactly what rule 1 forbids.
     */
    if (!input.applied_for.make && !input.applied_for.type) {
      return { written: false, rejections: ['the firearm is not described yet'] };
    }

    const known = [
      [input.applied_for.make, input.applied_for.model, input.applied_for.calibre]
        .filter(Boolean)
        .join(' '),
      ...input.arsenal.map((a) =>
        [a.make, a.model, a.calibre].filter(Boolean).join(' '),
      ),
    ].filter(Boolean);

    const terms = [
      ...input.cards_tapped,
      ...input.associations.flatMap((a) => Object.values(a)),
      ...Object.values(input.activity).flatMap((v) =>
        Array.isArray(v) ? v.map(String) : [String(v)],
      ),
      input.research,
      ...REASON_BANKS.hunting,
      ...REASON_BANKS.sport,
      ...REASON_BANKS.selfDefence,
    ].filter(Boolean) as string[];

    /**
     * The held firearms nothing on file gives a use for.
     *
     * ⚠️ THE HALF THAT MAKES RULE 12 ENFORCEABLE. A live generation off the
     * operator's own vault gave every one of his five firearms a purpose —
     * "dedicated to backup use and close protection", "for precision
     * long-range shooting", "for small-calibre target work" — and not one of
     * them had a primary_use, a previous motivation or an endorsement behind
     * it. Nothing in the paragraph itself can distinguish an invented role
     * from a supplied one; what we handed over can.
     */
    const roleless = input.arsenal
      .filter((a) => !a.primary_use)
      .map((a) => [a.make, a.model, a.calibre].filter(Boolean).join(' '))
      .filter(Boolean);

    /**
     * ⚠️ TWO RETRIES, NOT ONE, AND THE REASON IS WHAT A FAILURE COSTS. The
     * spec says "reject and retry once, then fall back to the templated
     * preview paragraph" — but there is no fallback WRITE: a run that fails
     * twice leaves `firearm_fit_reason` empty, and the frontend latches on
     * `make|type` so it will not try again for the life of that firearm. The
     * applicant is left with the box the whole feature exists to fill.
     *
     * ⚠️ AND THE RULES ARE NOW INDEPENDENT, WHICH IS WHAT CHANGED. Live runs
     * failed on the word floor, then on a rule assertion, then on "platform"
     * and "utilized" — each fixed, each revealing the next. Six independent
     * checks against two attempts is a coin toss; the third costs one model
     * call, once per application, on the paragraph that is the product.
     */
    let last: string[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      /**
       * ⚠️ THE SECOND ATTEMPT IS TOLD WHAT WAS WRONG WITH THE FIRST. A retry
       * that re-sends the identical prompt is a dice roll: the first live
       * generation came back miscounting its own words and offering
       * "collecting" as a reason, and asking again in the same words would
       * have had no reason to produce anything different. The rejections are
       * already written for a person, so they are already the right feedback.
       */
      const result = await this.callModel(row.licenceType, input, last);
      if (!result) {
        last = ['the model call failed'];
        continue;
      }
      const bad = validateReason(result, {
        licenceType: row.licenceType,
        knownFirearms: known,
        knownTerms: terms,
        roleless,
        // Empty until brief §5.5a builds association-activities.ts, and the
        // validator refuses an asserted exercise rule while it is.
        hasActivityRules: input.association_activities.length > 0,
      });
      if (bad.length) {
        last = bad;
        this.logger.warn(
          `Motivation ${row.id}: reason rejected (${result.angle}) — ${bad.join('; ')}`,
        );
        continue;
      }

      await this.persist(row.id, answers, provenance, result);
      this.logger.log(
        `Motivation ${row.id}: reason written, angle=${result.angle} words=${result.wordCount} warnings=${result.warnings.length}`,
      );
      return {
        written: true,
        angle: result.angle,
        paragraph: result.paragraph,
        warnings: result.warnings,
      };
    }

    return { written: false, rejections: last };
  }

  /** The one model call. */
  private async callModel(
    licenceType: MotivationLicenceType,
    input: ReasonInput,
    rejections: readonly string[] = [],
  ): Promise<ReasonResult | null> {
    let text: string;
    try {
      const res = await this.llm.complete({
        // ⚠️ THE SAME FLAG THE VALIDATOR USES. Showing the model an angle it
        // will then be refused for choosing is how two live generations died.
        system: reasonSystemPrompt(
          licenceType,
          input.association_activities.length > 0,
        ),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: JSON.stringify(input) },
              ...(rejections.length
                ? [
                    {
                      type: 'text' as const,
                      text: [
                        'Your previous answer was rejected for these reasons.',
                        'Fix every one of them and return the whole JSON again:',
                        ...rejections.map((r) => `- ${r}`),
                      ].join('\n'),
                    },
                  ]
                : []),
            ],
          },
        ],
        maxTokens: 1600,
        /**
         * ⚠️ THE SHAPE IS THE PROVIDER'S JOB. The spec asked for a fenced JSON
         * block and hand-parsing, citing a repo rule that has since reversed:
         * reads use `json: { schema }` now. No `grounding` here — the research
         * facts arrive already fetched, which is also what keeps this call
         * legal on Gemini, where grounding and json cannot combine.
         */
        json: { schema: REASON_SCHEMA },
        purpose: 'motivation.reason',
        timeoutMs: 60_000,
      });
      text = res.text.trim();
    } catch (err) {
      this.logger.warn(`Reason call failed: ${(err as Error).message}`);
      return null;
    }

    // Same two lines of defence the firearm read keeps: a schema is a provider
    // constraint, not a guarantee we control, and the Anthropic rollback path
    // is more permissive.
    const m = text.match(/\{[\s\S]*\}/);
    try {
      const raw = JSON.parse(m ? m[0] : text) as Record<string, unknown>;
      const paragraph = String(raw.paragraph ?? '').trim();
      if (!paragraph) return null;
      return {
        angle: String(raw.angle ?? ''),
        paragraph,
        examples: Array.isArray(raw.examples)
          ? (raw.examples as ReasonResult['examples'])
          : [],
        existingRoles: Array.isArray(raw.existing_roles)
          ? (raw.existing_roles as ReasonResult['existingRoles'])
          : [],
        continuity: String(raw.continuity ?? ''),
        warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String) : [],
        // A missing count is not a mismatch — count it ourselves and let the
        // validator compare like with like.
        wordCount:
          typeof raw.word_count === 'number'
            ? raw.word_count
            : countWords(paragraph),
      };
    } catch {
      return null;
    }
  }

  /** Write the paragraph as a suggestion the member may confirm or change. */
  private async persist(
    id: string,
    answers: Record<string, string>,
    provenance: ReturnType<typeof parseProvenance>,
    r: ReasonResult,
  ): Promise<void> {
    const merged = { ...answers, firearm_fit_reason: r.paragraph };
    const stamped = stamp(provenance, ['firearm_fit_reason'], {
      source: 'DERIVED',
      from: 'the firearm, your licences and what you told us',
      inferred: true,
    });
    await this.prisma.motivation.update({
      where: { id },
      data: {
        answersEncrypted: encryptJson(merged),
        answerProvenance: stamped as unknown as object,
      },
    });
  }

  /** The spec's user message, built from this application. */
  private async buildInput(
    licenceType: MotivationLicenceType,
    answers: Record<string, string>,
  ): Promise<ReasonInput> {
    const a = (k: string) => answerValue(answers[k] ?? '').trim();

    const arsenal: Record<string, string>[] = [];
    for (let n = 1; n <= OWNED_ROWS; n++) {
      if (!ownedRowTaken(answers, n)) continue;
      const p = `existing_firearm_${n}_`;
      const row: Record<string, string> = {};
      const put = (key: string, v: string) => {
        if (v) row[key] = v;
      };
      /*
        ⚠️ PROSE-CASED HERE AND NOWHERE ELSE. A licence card prints "MAUSER"
        and ".30-06 SPRINGFIELD" and the vault keeps that verbatim on purpose;
        rule 13 then tells the model to spell a make exactly as the input
        spells it, so the first generation under these rules wrote "a NORDISKE
        PRECISION 223 REM rifle licensed under section 16" in the middle of an
        English sentence. Same discipline as answerValue() and the card's
        "NONE": the stored value never changes, and the one reader that renders
        prose does the tidying.
      */
      put('make', proseFirearmName(a(`${p}make`)));
      put('model', proseFirearmName(a(`${p}model`)));
      put('calibre', proseFirearmName(a(`${p}calibre`)));
      put('type', proseFirearmName(a(`${p}type`)));
      put('serial', ownedFirearmSerial(answers, n));
      put('licence_expiry', a(`${p}expiry`));
      // Their own words about the firearm outrank the tapped card, because it
      // is the sentence they would use themselves.
      put('primary_use', a(`${p}use`) || a(`${p}primary_use`));
      if (Object.keys(row).length) arsenal.push(row);
    }

    const applied: Record<string, string> = {};
    for (const [key, from] of [
      ['type', 'firearm_type'],
      ['action', 'firearm_action'],
      ['make', 'firearm_make'],
      ['model', 'firearm_model'],
      ['calibre', 'firearm_calibre'],
    ] as const) {
      // The applied-for firearm comes off the seller's card the same way.
      const v = proseFirearmName(a(from));
      if (v) applied[key] = v;
    }

    const associations: Record<string, string>[] = [];
    const assocName = a('association_name');
    if (assocName) {
      const assoc: Record<string, string> = { name: assocName };
      const since = a('association_member_since');
      const status = a('dedicated_status_since');
      if (since) assoc.since = since;
      if (status) assoc.dedicated_since = status;
      const disciplines = a('discipline');
      if (disciplines) assoc.disciplines_endorsed = disciplines;
      associations.push(assoc);
    }

    /**
     * ⚠️ THE TAPPED SENTENCES, NOT THE SLUGS. The card sets store keys like
     * "night_travel, rented"; handing those over would ask the model to argue
     * from tokens nobody outside this codebase has seen — the same bug
     * renderFacts already fixes for the writer.
     */
    const cards = [
      's13_reasons',
      'hunt_reasons',
      'hunt_game_class',
      'hunt_where',
      'sport_reasons',
      'overlap_angle',
    ]
      .map((k) => a(k))
      .filter(Boolean)
      .join(', ');

    let research = '';
    try {
      const pack = await this.research.researchFor(licenceType, answers);
      research = MotivationResearchService.toBlock(pack);
    } catch {
      // ⚠️ RESEARCH IS AN IMPROVEMENT, NEVER A PRECONDITION. The spec says so
      // — "`research` may be empty; the model then writes without capability
      // facts" — and a reason that cannot be written because a cache missed is
      // worse than one written from the applicant's own facts.
      research = '';
    }

    return {
      licence_type: licenceType,
      applicant: {
        occupation: a('occupation') || undefined,
        residence_type: a('home_type') || undefined,
        reloads: a('reloads_own_ammunition') || undefined,
      },
      applied_for: applied,
      arsenal,
      associations,
      activity: { disciplines: a('discipline') || undefined },
      cards_tapped: cards ? cards.split(',').map((s) => s.trim()) : [],
      research,
      previous_motivations: [],
      association_activities: [],
      constraints: {},
    };
  }
}
