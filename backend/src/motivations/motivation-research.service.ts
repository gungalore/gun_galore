import { Injectable, Logger } from '@nestjs/common';
import { MotivationLicenceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { LlmError } from '../common/llm/llm.types';
import { HUNT_GAME_CLASS } from './motivation-cards';
import { disciplineByValue } from './shooting-disciplines';

// ────────────────────────────────────────────────────────────────────
// WHAT THE APPLICANT IS NEVER ASKED, BECAUSE WE LOOK IT UP.
//
// Brief §2.1: "the applicant is never asked what the internet, a document or
// their profile can answer." Firearm capability, calibre role, discipline
// rules, species and ranges are all research — and the Gerstner and Fourie
// packs are roughly 60% exactly this material.
//
// ⚠️ EVERY TARGET IS ABOUT THE WORLD, NEVER ABOUT A PERSON, AND THAT IS WHAT
// MAKES IT CACHEABLE AT ALL. A row is about a firearm model, a cartridge, a
// discipline or a class of game — identical for everyone who applies for the
// same thing — so the second applicant for a Beretta 1301 costs no call.
//
// ⚠️ AND IT IS A PRIVACY IMPROVEMENT, NOT ONLY A COST ONE. The free-text brief
// this replaces carried the applicant's suburb into a web search (redacted to
// area, but still theirs). Precinct figures now come from our own SAPS
// workbook — see crime-stats, and `hasPrecinctFigures` in the brief it
// replaces — so NO APPLICANT DATUM REACHES A SEARCH QUERY AT ALL any more.
// A target keyed on anything personal would be both a privacy regression and
// an uncacheable row; there is no reason to add one.
//
// ⚠️ GROUNDED PROSE, NOT STRUCTURED JSON, AND THE PROVIDER DECIDES THAT.
// `grounding` and `json` cannot be combined on Gemini — the adapter throws
// `bad_request` rather than silently dropping one (see LlmRequest.grounding).
// The documented way to get grounded JSON is two calls, search then extract,
// and that would double the cost of every cache MISS to buy structure the
// writer does not need: it receives this as a brief to argue from, and the
// card ranking that does need structure gets it from classifyCalibre() in
// motivation-overlap.ts, which is exact and free. One call per target.
// ────────────────────────────────────────────────────────────────────

/** What a research row is about. */
export type ResearchTarget = 'firearm' | 'calibre' | 'discipline' | 'game';

export interface ResearchSource {
  uri: string;
  title?: string;
}

export interface ResearchEntry {
  target: ResearchTarget;
  cacheKey: string;
  payload: string;
  sources: ResearchSource[];
  /**
   * What this entry cost, in tokens.
   *
   * ⚠️ PRESENT ONLY ON A CACHE MISS, AND THAT ASYMMETRY IS THE POINT. A hit
   * cost nothing, so it contributes nothing to the motivation's token columns
   * — which is what makes `Motivation.costUsd` mean what it says once the
   * second applicant for a given firearm stops paying for the search.
   * LlmService writes its own AiUsage row per call regardless; this is the
   * per-document roll-up, not the ledger.
   */
  usage?: { promptTokens: number; completionTokens: number };
}

/**
 * What the writer receives under `research{}` in the fact pack.
 *
 * ⚠️ `held` IS A LIST BECAUSE THE COMPARISON NEEDS BOTH SIDES. An applicant
 * who already holds a .308 is arguing why a second rifle is not a duplicate,
 * and rule 1 forbids the writer every figure it was not given — so without
 * published material on the OTHER cartridge, the strongest section in a
 * same-class application can only be written in generalities. Each entry is an
 * ordinary `calibre` row and shares the cache with the applied-for one, so a
 * .308 researched for a comparison is free the next time somebody applies for
 * a .308.
 */
export interface ResearchPack {
  firearm?: ResearchEntry;
  calibre?: ResearchEntry;
  discipline?: ResearchEntry;
  game?: ResearchEntry;
  held?: ResearchEntry[];
}

/**
 * How long a looked-up fact stays good.
 *
 * 180 days, from the brief. A cartridge's character does not change at all; a
 * discipline's published equipment rules do, roughly annually. Half a year is
 * the compromise, and it is the number the operator's own recommendation (§6.5
 * of the intake plan) asked for.
 */
export const RESEARCH_TTL_DAYS = 180;

/**
 * The one place a target is turned into a key.
 *
 * ⚠️ NORMALISED HERE AND NOWHERE ELSE. "Beretta 1301" and "BERETTA  1301" must
 * be one row or the cache never hits and we pay for the same fact twice; and a
 * writer and a later re-read must key the same fact the same way or the second
 * one silently misses. Lower-cased, whitespace collapsed, pipe-separated.
 */
export function cacheKeyFor(
  target: ResearchTarget,
  parts: readonly (string | undefined)[],
): string {
  const norm = parts
    .map((p) => (p ?? '').toLowerCase().replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return [target, ...norm].join('|').slice(0, 400);
}

/**
 * What we are prepared to have researched, worked out from the answers.
 *
 * ⚠️ RETURNS NOTHING RATHER THAN GUESSING. A target with no firm input is
 * simply not asked: a brief about "a rifle" is worth neither the call nor the
 * paragraph it would produce.
 */
export function targetsFor(
  licenceType: MotivationLicenceType,
  answers: Record<string, string>,
): { target: ResearchTarget; cacheKey: string; ask: string }[] {
  const a = (k: string) => (answers[k] ?? '').trim();
  const out: { target: ResearchTarget; cacheKey: string; ask: string }[] = [];

  const make = a('firearm_make');
  const model = a('firearm_model');
  const calibre = a('firearm_calibre');
  const type = a('firearm_type');
  const action = a('firearm_action');
  const useClass = USE_CLASS[licenceType];

  // ── the firearm itself ─────────────────────────────────────────────
  if (make && model) {
    out.push({
      target: 'firearm',
      cacheKey: cacheKeyFor('firearm', [make, model, calibre, useClass]),
      ask: [
        `THE FIREARM: ${[type, action, make, model, calibre].filter(Boolean).join(' ')}.`,
        'Find the manufacturer and model background, its design features,',
        'action and configuration, and what the model is built and used for.',
        `Say what bears on ${useClass} use in South Africa specifically.`,
      ].join(' '),
    });
  }

  // ── the cartridge ──────────────────────────────────────────────────
  if (calibre) {
    out.push({
      target: 'calibre',
      cacheKey: cacheKeyFor('calibre', [calibre, useClass]),
      ask: [
        `THE CARTRIDGE: ${calibre}.`,
        'Find its origin and character — recoil, typical factory loads,',
        'effective range — and what it is commonly used for in South Africa.',
        `Say what it is well matched to for ${useClass}, and what it is over-`,
        'or under-matched to. Figures with sources, never impressions.',
      ].join(' '),
    });
  }

  // ── the discipline ─────────────────────────────────────────────────
  //
  // ⚠️ KEYED TO THE shooting-disciplines ENTRY, NOT TO WHAT WAS TYPED. The
  // registry stores a stable slug for fifty-nine disciplines; keying on the
  // slug means every applicant shooting IPSC Production shares one row, and a
  // free-text "something else" answer is deliberately NOT researched — we have
  // no stable thing to key it to, and one applicant's wording is not a cache.
  const disciplineValue = a('discipline').split(',')[0]?.trim();
  const discipline = disciplineValue
    ? disciplineByValue(disciplineValue)
    : undefined;
  if (discipline) {
    out.push({
      target: 'discipline',
      cacheKey: cacheKeyFor('discipline', [discipline.value]),
      ask: [
        `THE DISCIPLINE: ${discipline.label}, run in South Africa by ${discipline.body}.`,
        'Find what the course of fire involves and what the published rules',
        'require of the firearm — division or class limits, sights, barrel',
        'length, capacity, trigger. Cite the governing body where you can.',
      ].join(' '),
    });
  }

  // ── the game, and the ranges it is taken at ────────────────────────
  const gameKeys = a('hunt_game_class')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (gameKeys.length) {
    const labels = gameKeys
      .map((k) => HUNT_GAME_CLASS.find((c) => c.key === k)?.sentence)
      .filter(Boolean)
      .map((s) => (s as string).replace(/^I /, '').replace(/\.$/, ''));
    if (labels.length) {
      out.push({
        target: 'game',
        cacheKey: cacheKeyFor('game', [gameKeys.sort().join('+')]),
        ask: [
          `THE QUARRY: an applicant who ${labels.join(', and ')}.`,
          'Find which species that covers in South Africa, their typical live',
          'weight, and the ranges at which they are usually taken. Then the',
          'energy commonly accepted as the minimum for a humane kill on each',
          'group. Figures with sources.',
        ].join(' '),
      });
    }
  }

  return out;
}

/**
 * What the firearm is FOR, for the purposes of a lookup.
 *
 * ⚠️ THE LICENCE TYPE, NOT AN ANSWER. It is part of the cache key, so it has
 * to be a small closed set: "hunting" and "sport" are different questions
 * about the same cartridge and must not share a row.
 */
const USE_CLASS: Record<MotivationLicenceType, string> = {
  S13_SELF_DEFENCE: 'self-defence',
  S14_RESTRICTED_SELF_DEFENCE: 'self-defence',
  S15_OCCASIONAL_HUNTER: 'hunting',
  S16_DEDICATED_HUNTER: 'hunting',
  S16_DEDICATED_SPORT: 'sport shooting',
  S24_RENEWAL: 'continued use',
};

const SYSTEM = [
  'You are preparing background notes for a South African firearm licence',
  'motivation. Search the web for what you do not reliably know.',
  '',
  'Write PARAPHRASED plain-text prose. Never copy a manufacturer or a',
  'governing body verbatim beyond a few words — this material is reproduced',
  'in a document somebody signs and files.',
  '',
  'Facts only. No advice, no opinion on any application, and never any',
  'prediction about whether a licence will be granted.',
  '',
  'Cite the publication after each cluster of facts. If a search finds',
  'nothing solid, say nothing on that point — an empty note beats a guessed',
  'one, and you will not be asked again for it.',
].join('\n');

const TIMEOUT_MS = 90_000;

@Injectable()
export class MotivationResearchService {
  private readonly logger = new Logger(MotivationResearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  /**
   * Everything worth knowing about this application's firearm, cartridge,
   * discipline and quarry.
   *
   * ⚠️ FAILS SOFT, ALWAYS. Research is seasoning: a null costs the document
   * colour, never the document. The same posture as the free-text brief it
   * replaces, and the reason that one survived an outage.
   */
  async researchFor(
    licenceType: MotivationLicenceType,
    answers: Record<string, string>,
    opts: {
      /**
       * Cartridges the applicant ALREADY holds that the overlap check matched
       * against this one. Cartridge names only — never a make, a serial or a
       * licence number.
       */
      heldCalibres?: readonly string[];
    } = {},
  ): Promise<ResearchPack> {
    const pack: ResearchPack = {};

    for (const t of targetsFor(licenceType, answers)) {
      const entry = await this.entryFor(t.target, t.cacheKey, t.ask);
      if (entry) pack[t.target] = entry;
    }

    // ⚠️ DEDUPED AND CAPPED AT THREE, and the applied-for cartridge is excluded
    // — the same discipline the brief this replaces used. Three named
    // cartridges is already a wide comparison, and an owned table with six
    // rows in one class would otherwise spend the budget on the sixth.
    const applied = (answers.firearm_calibre ?? '').trim().toLowerCase();
    const held = [
      ...new Set(
        (opts.heldCalibres ?? [])
          .map((c) => c.trim())
          .filter((c) => c && c.toLowerCase() !== applied),
      ),
    ].slice(0, 3);

    const useClass = USE_CLASS[licenceType];
    const entries: ResearchEntry[] = [];
    for (const calibre of held) {
      const entry = await this.entryFor(
        'calibre',
        cacheKeyFor('calibre', [calibre, useClass]),
        [
          `THE CARTRIDGE: ${calibre}.`,
          'Find its origin and character — recoil, typical factory loads,',
          'effective range — and what it is commonly used for in South Africa.',
          `Say what it is well matched to for ${useClass}, and what it is over-`,
          'or under-matched to. Figures with sources, never impressions.',
        ].join(' '),
      );
      if (entry) entries.push(entry);
    }
    if (entries.length) pack.held = entries;

    return pack;
  }

  /**
   * The pack as the writer receives it: prose, with what it may cite.
   *
   * ⚠️ SOURCES ARE NAMED OR THE BLOCK SAYS SO. A grounded call that opened
   * nothing gives us a brief with nothing to attribute, and a writer told to
   * cite will otherwise invent a citation — which is rule 1 applied to a
   * bibliography.
   */
  static toBlock(pack: ResearchPack): string {
    const parts: string[] = [];
    const add = (label: string, entry?: ResearchEntry) => {
      if (!entry?.payload.trim()) return;
      const cites = entry.sources.length
        ? entry.sources
            .map((s) => s.title || s.uri)
            .slice(0, 6)
            .join('; ')
        : 'no source could be opened for this — do not attribute it';
      parts.push(`${label}\n${entry.payload.trim()}\n[sources: ${cites}]`);
    };

    add('THE FIREARM APPLIED FOR:', pack.firearm);
    add('THE CARTRIDGE APPLIED FOR:', pack.calibre);
    add('THE DISCIPLINE:', pack.discipline);
    add('THE QUARRY AND ITS RANGES:', pack.game);
    for (const h of pack.held ?? []) {
      add('A CARTRIDGE THE APPLICANT ALREADY HOLDS:', h);
    }

    return parts.join('\n\n');
  }

  /**
   * What this pack cost, summed over the entries that actually made a call.
   *
   * ⚠️ A FULLY-CACHED PACK RETURNS ZEROS, and that is the honest answer rather
   * than a rounding-down: nothing was spent producing it. These feed the
   * motivation's own token columns; LlmService writes its own AiUsage row per
   * call regardless, so the ledger and this roll-up answer different
   * questions and are both right.
   */
  static usageOf(pack: ResearchPack): {
    promptTokens: number;
    completionTokens: number;
  } {
    return [
      pack.firearm,
      pack.calibre,
      pack.discipline,
      pack.game,
      ...(pack.held ?? []),
    ].reduce(
      (acc, e) => ({
        promptTokens: acc.promptTokens + (e?.usage?.promptTokens ?? 0),
        completionTokens:
          acc.completionTokens + (e?.usage?.completionTokens ?? 0),
      }),
      { promptTokens: 0, completionTokens: 0 },
    );
  }

  /** One target: cache first, then a grounded call, then store. */
  private async entryFor(
    target: ResearchTarget,
    cacheKey: string,
    ask: string,
  ): Promise<ResearchEntry | null> {
    const hit = await this.read(cacheKey);
    if (hit) return hit;

    if (!this.llm.isConfigured()) return null;

    let text = '';
    let sources: ResearchSource[] = [];
    let usage: ResearchEntry['usage'];
    try {
      const res = await this.llm.complete({
        system: SYSTEM,
        messages: [{ role: 'user', content: ask }],
        maxTokens: 1500,
        grounding: { web: true },
        purpose: `motivation.research.${target}`,
        timeoutMs: TIMEOUT_MS,
      });
      text = res.text.trim();
      sources = (res.groundingSources ?? []).map((s) => ({
        uri: s.uri,
        title: s.title,
      }));
      usage = {
        promptTokens: res.usage?.inputTokens ?? 0,
        completionTokens: res.usage?.outputTokens ?? 0,
      };
    } catch (err) {
      // ⚠️ NO QUERY TEXT AND NO PROVIDER NAME IN THE LOG. Nothing personal
      // reaches a query any more, but the habit is the guard: a log line that
      // echoes a prompt is one registry change away from echoing an answer.
      const code = err instanceof LlmError ? err.code : 'unknown';
      this.logger.warn(
        `Research failed for ${target} [${code}] — the document is written without it.`,
      );
      return null;
    }

    if (!text) return null;

    if (!sources.length) {
      // Sourceless is not a failure — the brief itself says to stay silent on
      // a point a search cannot support. A RUN of them means grounding is
      // broken, which is what this line is for.
      this.logger.warn(
        `Research for ${target} came back with no web sources — thin, not wrong.`,
      );
    }

    const entry: ResearchEntry = {
      target,
      cacheKey,
      payload: text,
      sources,
      usage,
    };
    await this.write(entry);
    return entry;
  }

  private async read(cacheKey: string): Promise<ResearchEntry | null> {
    try {
      const row = await this.prisma.motivationResearch.findUnique({
        where: { cacheKey },
        select: {
          target: true,
          cacheKey: true,
          payload: true,
          sources: true,
          expiresAt: true,
        },
      });
      // ⚠️ EXPIRY IS CHECKED HERE, NOT SWEPT. An expired row is ignored and
      // overwritten by the next miss; nothing has to run on a schedule for the
      // cache to stay honest, and a sweep that failed would otherwise serve
      // stale discipline rules into a signed document.
      if (!row || row.expiresAt.getTime() <= Date.now()) return null;
      return {
        target: row.target as ResearchTarget,
        cacheKey: row.cacheKey,
        payload: row.payload,
        sources: (row.sources as ResearchSource[] | null) ?? [],
      };
    } catch (err) {
      // A cache we cannot read is a cache miss, never an error the applicant
      // sees.
      this.logger.warn(`Research cache read failed: ${(err as Error).message}`);
      return null;
    }
  }

  private async write(entry: ResearchEntry): Promise<void> {
    const expiresAt = new Date(
      Date.now() + RESEARCH_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    const data = {
      target: entry.target,
      payload: entry.payload,
      sources: entry.sources as unknown as object,
      fetchedAt: new Date(),
      expiresAt,
    };
    try {
      // Upsert, not create: two applications researching the same cartridge in
      // the same moment would otherwise race the unique index into a 500 on a
      // generation.
      await this.prisma.motivationResearch.upsert({
        where: { cacheKey: entry.cacheKey },
        create: { cacheKey: entry.cacheKey, ...data },
        update: data,
      });
    } catch (err) {
      // We have the answer in hand; failing to cache it costs the NEXT
      // applicant a call, not this one a document.
      this.logger.warn(`Research cache write failed: ${(err as Error).message}`);
    }
  }
}
