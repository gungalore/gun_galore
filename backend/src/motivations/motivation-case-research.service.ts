import { Injectable, Logger } from '@nestjs/common';
import { MotivationLicenceType } from '@prisma/client';
import { LlmService } from '../common/llm/llm.service';
import { LlmError } from '../common/llm/llm.types';
import { LegalService } from '../legal/legal.service';
import { withoutRefusedCopy } from './motivation-scope';
import type { ResearchEntry, ResearchSource } from './motivation-research.service';

const TIMEOUT_MS = 45_000;
const MIN_WORDS = 120;

const CASE_SYSTEM = [
  'You are a South African firearms-licence case researcher.',
  'You do not write the motivation letter. You build the evidence-based case',
  'theory for THIS applicant from the facts supplied.',
  '',
  'Be specific. A sentence that could be written about any applicant is not a',
  'case theory and must be left out. Every bullet names the fact it rests on.',
  'The applicant’s facts always win. Where they leave a gap, fill it from the',
  'published research or legal extracts and mark that bullet [researched].',
  'Never invent a statistic, an incident, a personal history, a source or a',
  'provision of the Act. Use only the legal extracts supplied for law.',
  '',
  'No marketing words and no ballistic tables. Plain South African English:',
  'calibre, metre, -ise.',
].join(' ');

/**
 * The per-application half of motivation research.
 *
 * The shared research rows are world facts: a cartridge, a discipline, a class
 * of game. This service is the opposite. It joins those facts to this
 * applicant's calibre, quarry or threat, their battery, their security and
 * their stated routine, and says what the actual case is and where it is thin.
 *
 * It is deliberately not cached: two applicants with the same rifle do not have
 * the same circumstances, and serving one person's case theory to another is
 * worse than serving none.
 */
@Injectable()
export class MotivationCaseResearchService {
  private readonly logger = new Logger(MotivationCaseResearchService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly legal?: LegalService,
  ) {}

  async brief(
    licenceType: MotivationLicenceType,
    answers: Record<string, string>,
    useClass: string,
    sharedResearch: string,
  ): Promise<ResearchEntry | null> {
    if (!this.llm.isConfigured()) return null;

    const legal = await this.legalContext(licenceType, answers);
    const facts = this.caseFacts(licenceType, answers, useClass);
    const prompt = [
      'Build the case brief for the applicant in THE APPLICANT below.',
      '',
      'THE APPLICANT',
      JSON.stringify(facts, null, 2),
      '',
      'PUBLISHED RESEARCH ALREADY GATHERED',
      sharedResearch || '(none)',
      '',
      'LEGAL EXTRACTS',
      legal.block || '(none)',
      '',
      'Use these headings, in this order, with bullets under each:',
      'CASE THEORY',
      'CALIBRE AND FIREARM FIT',
      'INDIVIDUAL CIRCUMSTANCES',
      'BATTERY / NON-DUPLICATION',
      'RISKS AND LIMITS',
      'MISSING FACTS',
      '',
      'Rules:',
      '- Be specific to THIS applicant. No generic statements about crime, hunters, sport shooters or self-defence.',
      '- Every bullet names the fact it rests on. If the applicant left a gap, fill it from the published research or legal extracts and mark the bullet [researched]; put it under MISSING FACTS only when neither supports it.',
      '- Never present a researched fact as something the applicant did, saw, owns or told you.',
      '- Use the legal extracts only for what they actually say; do not quote law that is not in them.',
      '- For hunting, tie the calibre to the named species, terrain and range. For sport, tie it to the named discipline and course of fire. For self-defence, tie it to the named threat, routine, space and carry method.',
      '- Explain what the existing battery cannot do, and why this firearm is the gap. If there is no battery, say so.',
      '- State the honest weakness or over-match; do not oversell.',
      '- 250 to 400 words. Bullets only, each starting with "- ".',
    ].join('\n');

    try {
      const res = await this.llm.complete({
        system: CASE_SYSTEM,
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 8192,
        thinking: { budgetTokens: 4096 },
        purpose: 'motivation.research.case',
        timeoutMs: TIMEOUT_MS,
      });
      const text = res.text.trim();
      if (text.split(/\s+/).filter(Boolean).length < MIN_WORDS) return null;
      return {
        target: 'case',
        cacheKey: 'case|per-application',
        payload: withoutRefusedCopy(text),
        sources: legal.sources,
        usage: {
          promptTokens: res.usage?.inputTokens ?? 0,
          completionTokens: res.usage?.outputTokens ?? 0,
        },
      };
    } catch (err) {
      const code = err instanceof LlmError ? err.code : 'unknown';
      this.logger.warn(
        `Case research failed [${code}] — the document is written without it.`,
      );
      return null;
    }
  }

  private caseFacts(
    licenceType: MotivationLicenceType,
    answers: Record<string, string>,
    useClass: string,
  ): Record<string, unknown> {
    const value = (key: string) => (answers[key] ?? '').trim() || undefined;
    const held: Record<string, string>[] = [];
    for (let n = 1; n <= 10; n += 1) {
      const row: Record<string, string> = {};
      for (const column of [
        'make',
        'calibre',
        'type',
        'use',
        'primary_use',
        'section_held',
      ]) {
        const entry = value(`existing_firearm_${n}_${column}`);
        if (entry) row[column] = entry;
      }
      if (Object.keys(row).length) held.push(row);
    }

    return {
      licenceType,
      purpose: useClass,
      firearm: {
        type: value('firearm_type'),
        action: value('firearm_action'),
        make: value('firearm_make'),
        model: value('firearm_model'),
        calibre: value('firearm_calibre'),
      },
      hunting: {
        useKind: value('firearm_use_kind'),
        quarry: value('intended_quarry'),
        gameClass: value('hunt_game_class'),
        terrain: value('hunt_terrain'),
        where: value('hunt_where') ?? value('hunting_locations'),
        history: value('hunting_history'),
      },
      sport: {
        discipline: value('discipline'),
        formats: value('sport_formats'),
        record: value('competition_record') ?? value('activity_record'),
      },
      selfDefence: {
        threat: value('threat_circumstances'),
        movements: value('daily_movements'),
        alternatives: value('alternatives_considered'),
        carry: value('s13_carry_style'),
        residence: value('residence_type'),
      },
      security: {
        enclosure: value('premises_enclosure'),
        access: value('premises_access_control'),
        alarm: value('alarm_present'),
        armedResponse: value('armed_response'),
        safe: value('safe_type'),
        mounted: value('safe_mounted_to'),
        keyHolder: value('safe_key_holder'),
      },
      association: {
        name: value('association_name'),
        dedicatedSince: value('dedicated_since'),
        expiry: value('association_expiry'),
      },
      battery: held,
    };
  }

  private async legalContext(
    licenceType: MotivationLicenceType,
    answers: Record<string, string>,
  ): Promise<{ block: string; sources: ResearchSource[] }> {
    if (!this.legal) return { block: '', sources: [] };
    const section =
      licenceType === 'S13_SELF_DEFENCE'
        ? 'section 13 self-defence'
        : licenceType === 'S14_RESTRICTED_SELF_DEFENCE'
          ? 'section 14 restricted firearm self-defence'
          : licenceType === 'S15_OCCASIONAL_HUNTER'
            ? 'section 15 occasional hunting sport shooting'
            : licenceType === 'S16_DEDICATED_HUNTER'
              ? 'section 16 dedicated hunter sport shooting'
              : 'section 24 renewal';
    const queries = [
      section,
      'safe custody firearm',
      licenceType === 'S16_DEDICATED_HUNTER'
        ? 'dedicated status good standing'
        : '',
      answers.firearm_type === 'Handgun' ? 'handgun competency' : '',
    ].filter(Boolean);

    const hits = [];
    for (const query of queries) {
      try {
        hits.push(...(await this.legal.search(query, { limit: 2 })));
      } catch {
        // The brief is still useful without the statute.
      }
    }

    const seen = new Set<string>();
    const unique = hits.filter((hit) => {
      const key = `${hit.sourceSlug}:${hit.sectionNumber}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      block: unique
        .map(
          (hit) =>
            `${hit.citation} ${hit.heading ?? ''}: ${hit.snippet.replace(/<[^>]+>/g, '')}`,
        )
        .join('\n'),
      sources: unique.map((hit) => ({
        uri: `legal://${hit.sourceSlug}/${hit.sectionNumber}`,
        title: `${hit.citation}${hit.heading ? ` — ${hit.heading}` : ''}`,
      })),
    };
  }
}

