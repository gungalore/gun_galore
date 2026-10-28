import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import type { JevQuestion } from '../llm/llm.types';
import type { CaptureFact, DocumentCapture } from '../document-capture/document-capture';
import {
  ALIASES,
  aliasGroupFor,
  hintFor,
  isProjectionDateKey,
  isoDate,
  normaliseLabel,
  type ProjectedValue,
  type ProjectionResult,
} from './document-projection';

const JEVE_FLOOR = 0.6;
const DATE_WORDS =
  /\b(valid until|valid to|expires?|expiry|issue date|date of issue|issued|joined|since|date)\b/;

function labelScore(label: string, aliases: readonly string[]): number {
  let best = 0;
  for (const raw of aliases) {
    const alias = normaliseLabel(raw);
    if (!alias) continue;
    let score = 0;
    if (label === alias) score = 100;
    else if (label.startsWith(`${alias} `)) score = 85;
    else if (label.endsWith(` ${alias}`)) score = 80;
    else if (alias.length >= 4 && label.includes(alias)) score = 60;
    // A two-letter alias like "id" only matches exactly; "identity" must not
    // be swallowed by it.
    if (alias.length < 3 && score < 100) score = 0;
    if (score > best) best = score;
  }
  return best;
}

function confidenceBonus(c: CaptureFact['confidence']): number {
  return c === 'high' ? 10 : c === 'low' ? -20 : 0;
}

/**
 * PROJECT A CAPTURE INTO THE CONTAINER'S KEYS.
 *
 * ⚠️ FIRST BY LABEL, THEN BY JEV, NEVER BY GUESS. A fact is assigned at most
 * once. A date must parse; a key outside `keys` is never written. Anything
 * still empty is returned in `unmatched` so the caller can fall back to the
 * tuned extractor rather than write a thin reading.
 */
@Injectable()
export class DocumentProjectionService {
  private readonly logger = new Logger(DocumentProjectionService.name);

  constructor(private readonly llm: LlmService) {}

  async project(args: {
    capture: DocumentCapture;
    keys: readonly string[];
    hints?: Record<string, string>;
  }): Promise<ProjectionResult> {
    let facts: CaptureFact[] = [...args.capture.facts];
    /**
     * ⚠️ A LETTERHEAD IS A FACT TOO. The capture may put the issuer in
     * document.issuer rather than a labelled row; without this a membership
     * certificate with no "Association:" label leaves the association empty.
     * Jev may still reject it — these are candidates, not answers.
     */
    if (args.capture.document.issuer?.trim()) {
      facts.push({
        label: 'Issuer',
        value: args.capture.document.issuer.trim(),
        valueType: 'text',
        confidence: 'high',
      });
    }
    if (args.capture.document.title?.trim()) {
      facts.push({
        label: 'Document title',
        value: args.capture.document.title.trim(),
        valueType: 'text',
        confidence: 'high',
      });
    }
    facts = facts.filter((f) => f.label && f.value);
    const keys = [...new Set(args.keys)];
    const values: Record<string, ProjectedValue> = {};
    const used = new Set<number>();
    const hints = args.hints ?? {};

    type Candidate = {
      key: string;
      index: number;
      score: number;
      value: string;
    };
    const candidates: Candidate[] = [];
    for (const key of keys) {
      const group = aliasGroupFor(key);
      const aliases = ALIASES[group] ?? [group.replace(/_/g, ' ')];
      for (let i = 0; i < facts.length; i++) {
        const fact = facts[i];
        const label = normaliseLabel(fact.label);
        if (!isProjectionDateKey(key) && DATE_WORDS.test(label)) continue;
        const score = labelScore(label, aliases);
        if (!score) continue;
        let value = (fact.normalized ?? fact.value).trim();
        // "Good standing" is a yes/no claim; a reference printed under it
        // belongs in good_standing_number, not here.
        if (
          key === 'good_standing' &&
          !/^(yes|no|true|false|in good standing|good standing)$/i.test(value)
        ) {
          continue;
        }
        /**
         * ⚠️ THE SIDE IS A LAYOUT FACT, NOT A TRANSCRIPTION. Pairing reads
         * exactly front/back; "Statement of Results" is the back page.
         */
        if (key === 'document_side') {
          const side = value.toLowerCase();
          if (side === 'front' || side === 'back') {
            value = side;
          } else if (side.includes('statement of results')) {
            value = 'back';
          } else if (side.includes('certificate')) {
            value = 'front';
          } else {
            continue;
          }
        }
        if (isProjectionDateKey(key)) {
          const parsed = isoDate(fact.normalized ?? '') ?? isoDate(fact.value);
          if (!parsed) continue;
          value = parsed;
        }
        candidates.push({
          key,
          index: i,
          score: score + confidenceBonus(fact.confidence),
          value,
        });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    for (const c of candidates) {
      if (values[c.key] || used.has(c.index)) continue;
      values[c.key] = {
        value: c.value,
        confidence: facts[c.index].confidence,
        fact: facts[c.index],
        via: 'label',
      };
      used.add(c.index);
    }

    let unmatched = keys.filter((k) => !values[k]);
    if (unmatched.length && facts.length && process.env.JEV_API_KEY) {
      const open = facts
        .map((fact, index) => ({ fact, index }))
        .filter(({ index }) => !used.has(index));
      if (open.length) {
        const questions: Record<string, JevQuestion> = {};
        for (const key of unmatched) {
          const criteria: Record<string, string> = {
            none: 'no printed fact on the page answers this',
          };
          for (const { fact, index } of open) {
            criteria[`f${index}`] =
              `${fact.label}: ${fact.value}${fact.normalized ? ` (${fact.normalized})` : ''}`;
          }
          questions[key] = {
            type: 'choice',
            instructions: `The document was read in one pass. Which printed fact answers "${hints[key] ?? hintFor(key)}" (${key})? Pick exactly one fact id, or none. Only pick a fact whose label and value genuinely answer it.`,
            criteria,
          };
        }

        try {
          const res = await this.llm.decide({
            state: {
              text: args.capture.pageText.slice(0, 12_000),
              document: {
                family: args.capture.document.family,
                title: args.capture.document.title,
                issuer: args.capture.document.issuer,
                keys: unmatched.map((key) => ({
                  key,
                  hint: hints[key] ?? hintFor(key),
                })),
              },
              facts: open.map(({ fact, index }) => ({
                id: `f${index}`,
                label: fact.label,
                value: fact.value,
                normalized: fact.normalized,
                valueType: fact.valueType,
                confidence: fact.confidence,
              })),
            },
            questions,
            purpose: 'document.project',
            timeoutMs: 15_000,
          });

          for (const key of unmatched) {
            const answer = res.answers[key];
            if (!answer || answer.type !== 'choice') continue;
            if (answer.choice === 'none' || answer.confidence < JEVE_FLOOR) continue;
            const m = /^f(\d+)$/.exec(answer.choice);
            if (!m) continue;
            const index = Number(m[1]);
            if (used.has(index) || !facts[index]) continue;
            const fact = facts[index];
            let value = (fact.normalized ?? fact.value).trim();
            if (key === 'document_side') {
              const side = value.toLowerCase();
              if (side === 'front' || side === 'back') value = side;
              else if (side.includes('statement of results')) value = 'back';
              else if (side.includes('certificate')) value = 'front';
              else continue;
            }
            if (isProjectionDateKey(key)) {
              const parsed =
                isoDate(fact.normalized ?? '') ?? isoDate(fact.value);
              if (!parsed) continue;
              value = parsed;
            }
            values[key] = {
              value,
              confidence:
                answer.confidence >= 0.85
                  ? 'high'
                  : answer.confidence >= 0.7
                    ? 'medium'
                    : 'low',
              fact,
              via: 'jev',
            };
            used.add(index);
          }
        } catch (err) {
          this.logger.warn(
            `Projection routing failed, keeping label matches only: ${(err as Error).message}`,
          );
        }
      }
    }

    unmatched = keys.filter((k) => !values[k]);
    return { values, unmatched };
  }
}
