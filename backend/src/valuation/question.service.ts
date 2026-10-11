import { Injectable } from '@nestjs/common';
import { CategoryConfig } from './valuation.types';
import { IdentifyOutput, RawQuestion } from './schemas';

export interface ServedQuestion {
  id: string;
  text: string;
  type: 'single' | 'multi';
  options: string[];
  allow_custom: boolean;
  allow_unsure: boolean;
  required: boolean;
  /** Optional hint (e.g. the photo reading for q1). Not part of the schema. */
  hint?: string;
  /** Pre-filled answer so the member confirms rather than re-types. */
  default?: string;
}

const MAX_QUESTIONS = 8;
const MIN_USABLE = 3;

// The global banned-topic guard. Kept in code as well as in default.json so a
// category config that replaces the array can never switch it off: legal,
// licensing, transfer, storage and cleaning questions are stripped for every
// item, whatever the config says.
const GLOBAL_BANNED_TOPICS = [
  'licen[cs]e',
  'permit',
  '\\bFCA\\b',
  'section\\s*\\d',
  'transfer\\s+(permit|status|legal)',
  'legal\\s+(status|right)',
  '\\bstor(e|ing|age|ed)\\b',
  'gun\\s*safe',
  'cleaning habit',
  'serial',
];

// A cartridge designation that is a RIFLE round. A rifle can never be a
// shotgun, so a shotgun-specific question is wrong when one of these appears.
const RIFLE_CARTRIDGE =
  /(\.(223|243|25-06|260|270|280|284|30-?06|300|303|308|338|358|375|416|458|22-?250|220|204|17)\b|6\.?5\s*(mm|creedmoor|x55|x47|prc)?|7\s*mm|\b7x57\b|\b9\.3\b)/i;

// The vocabulary of a shotgun question. Used to catch a shotgun assertion the
// model cannot actually support from what it read.
const SHOTGUN_VOCAB = /\b(gauge|choke|bore|shotgun|shot\s*gun|over-?under|side-by-side|\bsxs\b|semi-?auto(?:matic)?\s+shotgun)\b/i;

// A legible gauge is the only thing that lets the model know it is a shotgun.
const GAUGE_LEGIBLE = /\b(12|16|20|28)\s*(ga|gauge)\b|\.410/i;

/**
 * Turns the model's questions into the exact list the wizard serves, in code:
 * banned-topic questions are stripped for every category, the list is capped
 * at 8, q1 is always the key-identifier confirm, model-name options are only
 * allowed when the label is legibly in the photos, and the list is topped up
 * from the category config when the model returns too few usable questions.
 */
@Injectable()
export class QuestionService {
  sanitise(
    identify: IdentifyOutput,
    config: CategoryConfig,
    itemName?: string | null,
  ): ServedQuestion[] {
    const banned = [...GLOBAL_BANNED_TOPICS, ...config.bannedTopicPatterns].map((p) =>
      safeRegex(p),
    );
    const readableText = identify.identification.readable.join(' ').toLowerCase();
    const identificationText = [
      identify.identification.make,
      identify.identification.model,
      identify.identification.keySpec,
      ...identify.identification.readable,
      ...identify.identification.unreadable,
      ...identify.identification.visibleFeatures,
    ]
      .filter(Boolean)
      .join(' ');

    // A rifle is never a shotgun. Drop shotgun-specific questions when either
    // a rifle cartridge is present, or the model claims a shotgun without a
    // single legible gauge to support it (the common misread: a bolt-action
    // rifle with a scope rail read as a break-action double).
    const rifleSignal = RIFLE_CARTRIDGE.test(identificationText);
    const claimsShotgun = SHOTGUN_VOCAB.test(identificationText);
    const gaugeLegible = GAUGE_LEGIBLE.test(readableText);
    const dropShotgunQuestions = rifleSignal || (claimsShotgun && !gaugeLegible);

    const served: ServedQuestion[] = [this.keyIdentifierQuestion(identify, config, itemName)];

    const modelQuestions = (identify.questions ?? [])
      .filter((q) => this.isUsable(q, banned))
      .filter((q) => !(dropShotgunQuestions && this.isShotgunSpecific(q)))
      .map((q) => this.cleanOptions(q, identify, readableText));

    for (const q of modelQuestions) {
      if (served.length >= MAX_QUESTIONS) break;
      served.push({
        id: `q${served.length + 1}`,
        text: q.text,
        type: q.type,
        options: q.options,
        allow_custom: true,
        allow_unsure: true,
        required: q.required,
      });
    }

    if (served.length < MIN_USABLE) {
      for (const seed of config.seedQuestions) {
        if (served.length >= MAX_QUESTIONS) break;
        if (seed.kind === 'CONFIRM_KEY_IDENTIFIERS') continue;
        if (served.some((s) => s.text === seed.text)) continue;
        served.push({
          id: `q${served.length + 1}`,
          text: seed.text,
          type: seed.type,
          options: seed.options,
          allow_custom: true,
          allow_unsure: true,
          required: seed.required,
        });
      }
    }

    return served;
  }

  private keyIdentifierQuestion(
    identify: IdentifyOutput,
    config: CategoryConfig,
    itemName?: string | null,
  ): ServedQuestion {
    const seed = config.seedQuestions.find((s) => s.kind === 'CONFIRM_KEY_IDENTIFIERS');
    // Never echo a mechanical-action guess or a hedge back to the member; the
    // hint shows only what was actually read.
    const photoReading = [
      identify.identification.make,
      identify.identification.model,
      identify.identification.keySpec,
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\(possible\)/gi, '')
      .replace(
        /\b(over-?under|side-by-side|break-?action|bolt-?action|lever-?action|pump-?action|semi-?automatic|single-?shot|double-?barrel|doublebarrel|configuration|shotgun|gauge)\b/gi,
        '',
      )
      .replace(/\s{2,}/g, ' ')
      .trim();
    // The member already named the item on intake. That name is authoritative,
    // so it pre-fills q1 even when the photos read nothing; the photo reading
    // (if any) is offered as a hint instead.
    const memberName = (itemName ?? '').trim();
    return {
      id: 'q1',
      text: seed?.text ?? 'Confirm the exact make and model, plus the key specification',
      type: 'single',
      options: [],
      allow_custom: true,
      allow_unsure: false,
      required: true,
      hint: photoReading ? `From the photos: ${photoReading}` : undefined,
      // Pre-fill with what we already know (the member's own name, else the
      // photos) so the member confirms instead of being asked twice.
      default: memberName || photoReading || undefined,
    };
  }

  private isShotgunSpecific(q: RawQuestion): boolean {
    return SHOTGUN_VOCAB.test([q.text, ...(q.options ?? [])].join(' '));
  }

  private isUsable(q: RawQuestion, banned: RegExp[]): boolean {
    if (!q || typeof q.text !== 'string' || q.text.trim().length === 0) return false;
    const haystack = [q.text, ...(q.options ?? [])].join(' ');
    if (banned.some((re) => re.test(haystack))) return false;
    if (q.type !== 'single' && q.type !== 'multi') return false;
    if (!Array.isArray(q.options) || q.options.length < 2) return false;
    return true;
  }

  /** Drop specific model-name options unless the label is legibly in readable. */
  private cleanOptions(
    q: RawQuestion,
    identify: IdentifyOutput,
    readableText: string,
  ): RawQuestion {
    const model = (identify.identification.model ?? '').toLowerCase().trim();
    const make = (identify.identification.make ?? '').toLowerCase().trim();
    const options = q.options.filter((opt) => {
      const o = opt.toLowerCase();
      const mentionsModel = model && o.includes(model);
      const mentionsMake = make && make.length > 3 && o.includes(make);
      if (!mentionsModel && !mentionsMake) return true;
      return readableText.includes(model) || readableText.includes(make);
    });
    return { ...q, options: options.length >= 2 ? options : q.options };
  }
}

function safeRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    // A malformed config pattern must never disable the guard; fall back to a
    // literal, case-insensitive match.
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
}
