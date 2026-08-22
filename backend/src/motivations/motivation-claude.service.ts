import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { MotivationLicenceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { sanitizePromptValue } from '../common/prompt-sanitize';
import {
  FactPack,
  gateSystemPrompt,
  gateUserPrompt,
  generationSystemPrompt,
  generationUserPrompt,
  followUpBatchSystemPrompt,
  followUpBatchUserPrompt,
  followUpSystemPrompt,
  followUpUserPrompt,
} from './motivation-prompts';
import type { StructurePlan } from './motivation-structure';

// ────────────────────────────────────────────────────────────────────
// Every Anthropic call the motivation writer makes.
//
// Its own client, like every other AI surface here — there is no shared
// Anthropic module in this codebase, and each service picks its own model and
// timeout for its own reasons.
//
// THE FAIL DIRECTIONS ARE DELIBERATELY OPPOSITE, and getting them the wrong way
// round is the expensive mistake:
//   • GENERATION fails SOFT. An outage means "try again in a minute", not a
//     dead motivation — and critically it must not burn the applicant's free
//     beta seat.
//   • THE GATE fails CLOSED. A malformed, refused or unparseable verdict must
//     never read as "passed". A thin motivation reaching the Registrar is
//     worse than an annoyed applicant.
// ────────────────────────────────────────────────────────────────────

// Long-form output needs a longer timeout than the 60s the vision verifiers
// use. Still well inside nginx's 90s and Cloudflare's ~100s — a call that
// outlives those returns a gateway error the user cannot act on.
// ⚠️ 85_000 UNTIL 2026-08-22, AND IT WAS STALE. That number was sized when
// generation was SYNCHRONOUS — the comment above still reasons about nginx's
// 90s and Cloudflare's ~100s. Generation moved to 202 + polling; the HTTP
// request returns before the writer starts, so no proxy is waiting on this
// call and those ceilings stopped applying. RESEARCH_TIMEOUT_MS below already
// says exactly that about itself; this constant simply never followed.
//
// It went from theoretical to live the day the corpus sections landed. An S16
// with an overlap now writes the_discipline, the_firearm, the_calibre,
// comparison AND statutory_application, and three consecutive real attempts
// on MO000017 died with "Request timed out" at 85s — the applicant getting
// "we could not draft the document just now" for work that was progressing
// fine.
//
// 180s matches research, on the same reasoning: off the request, so the cap is
// only "do not hang forever". The real ceiling is sweepStuckGenerations(),
// which releases a row after 15 minutes — the worst realistic path (research
// 180 + write 180 + one local retry 180 + verify 60 + grade 60 = 11 min) still
// lands inside it. Raise this and check that sum again.
const GENERATE_TIMEOUT_MS = 180_000;
const GRADE_TIMEOUT_MS = 60_000;
// Research runs a handful of web searches before writing. It only ever runs
// OFF the request (generation is async now), so the proxy ceilings that cap
// the others do not apply — the cap here is just "do not hang forever".
const RESEARCH_TIMEOUT_MS = 180_000;

// MODEL CHOICE — operator: "whatever produces the best possible document."
//
// Cost is genuinely not the constraint. At R199 a motivation, flagship tokens
// are low single-digit percent of revenue, and the whole free beta costs less
// than one document from a fly-by-night writer. The cost columns on the row
// will report the real figure per document rather than anyone's estimate.
//
// WRITER — Opus, the strongest reasoning tier. The hard part of this job is
// not prose flourish, it is obeying a constraint while writing persuasively:
// "make the best possible case AND never add a fact the applicant did not
// give you." That is instruction-following under pressure, which is exactly
// where the flagship earns its keep.
//
// GATE — DELIBERATELY A DIFFERENT MODEL, and this is the important one. A
// model grading its own output shares its own blind spots: if the writer
// invents a detail that feels plausible, the same model is the one most likely
// to wave it through on review. Groundedness is the score that vetoes
// everything, so the checker must fail differently from the writer. Sonnet 5
// at temperature 0 is an independent judge, not a rubber stamp.
//
// FOLLOW-UPS — Haiku. One short question in Boet's voice; the flagship would
// be paying Rolls-Royce prices to ask "which association are you with?".
//
// All three are env-overridable. To A/B a writer model over the beta, set
// ANTHROPIC_MODEL_MOTIVATION and restart — the gate scores and the sameness
// detector then answer the question with measurements instead of opinions.
const MODEL_WRITE = process.env.ANTHROPIC_MODEL_MOTIVATION ?? 'claude-opus-5';
const MODEL_GATE =
  process.env.ANTHROPIC_MODEL_MOTIVATION_GATE ?? 'claude-sonnet-5';
const MODEL_FOLLOWUP =
  process.env.ANTHROPIC_MODEL_MOTIVATION_FOLLOWUP ??
  'claude-haiku-4-5-20251001';

/** Below this the document goes back for more detail. */
export const QUALITY_FLOOR = 65;
/**
 * Groundedness is judged separately and harder. A beautifully written document
 * containing a fact the applicant never supplied is the worst thing we can
 * produce — they would be signing it.
 */
export const GROUNDEDNESS_FLOOR = 70;

export interface GateVerdict {
  completeness: number;
  specificity: number;
  consistency: number;
  groundedness: number;
  overall: number;
  thinFields: string[];
  issues: string[];
  passed: boolean;
}

export interface ClaudeUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface GenerationResult {
  text: string;
  usage: ClaudeUsage;
}

@Injectable()
export class MotivationClaudeService {
  private readonly logger = new Logger(MotivationClaudeService.name);
  private readonly client: Anthropic | null;

  // One alert per window, not one per affected applicant. A silently broken
  // writer during a free beta is exactly the failure that goes unnoticed for a
  // week.
  private lastOutageAlertAt = 0;
  private static readonly OUTAGE_ALERT_GAP_MS = 6 * 60 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {
    const key = process.env.ANTHROPIC_API_KEY;
    this.client = key
      ? new Anthropic({ apiKey: key, timeout: GENERATE_TIMEOUT_MS, maxRetries: 1 })
      : null;
    if (!key) {
      this.logger.warn(
        'ANTHROPIC_API_KEY not set — the motivation writer cannot generate anything',
      );
    }
  }

  get configured(): boolean {
    return !!this.client;
  }

  private raiseOutageAlert(detail: string): void {
    const now = Date.now();
    if (
      now - this.lastOutageAlertAt <
      MotivationClaudeService.OUTAGE_ALERT_GAP_MS
    ) {
      return;
    }
    this.lastOutageAlertAt = now;
    void this.prisma.adminAlert
      .create({
        data: {
          type: 'motivation-writer-down',
          urgent: true,
          context:
            `The licence motivation writer is failing (${detail.slice(0, 200)}). ` +
            `Applicants cannot generate documents. Check the Anthropic key/status on /admin/health.`,
        },
      })
      .catch(() => undefined);
  }

  private usageOf(msg: {
    usage?: { input_tokens?: number; output_tokens?: number };
  }, model: string): ClaudeUsage {
    return {
      model,
      promptTokens: msg.usage?.input_tokens ?? 0,
      completionTokens: msg.usage?.output_tokens ?? 0,
    };
  }

  /**
   * Draft the document.
   *
   * The system prompt is split so the licence-type rules — byte-identical for
   * every applicant of that type — can be cached, while the applicant's facts
   * and structure plan go in the uncached user turn.
   *
   * Default temperature: variation is wanted here, and the structure plan
   * already constrains the shape.
   */
  async generate(
    pack: FactPack,
    plan: StructurePlan,
  ): Promise<GenerationResult> {
    if (!this.client) {
      throw new Error('Document generation is not available right now.');
    }
    try {
      const msg = await this.client.messages.create({
        model: MODEL_WRITE,
        // 4000 was sized for the 2-4 page document the plan originally assumed.
        // The operator's real samples run 11-40 pages of compiled submission
        // (MOTIVATION-DOCUMENT-STRUCTURE.md), so 4000 would truncate mid-
        // argument — and a motivation that stops halfway is worse than none.
        //
        // NOT raised further without measurement: output tokens are the wall
        // clock, and this route is synchronous under an 85s client timeout,
        // nginx 90s and Cloudflare ~100s. If beta timings show generations
        // running close to that, the answer is async generation with polling,
        // not a bigger number here.
        max_tokens: 8000,
        system: [
          {
            type: 'text',
            text: generationSystemPrompt(pack.licenceType),
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          { role: 'user', content: generationUserPrompt(pack, plan) },
        ],
      });

      const block = msg.content.find((b) => b.type === 'text');
      const text = ((block as { text?: string } | undefined)?.text ?? '').trim();

      // WATCH FOR A DOCUMENT THAT RAN OUT OF ROOM.
      //
      // The gate call has checked this since the day a truncated verdict failed
      // every document; the WRITER never did, and it cost us a live one. The
      // MO000017 regeneration on 2026-08-22 came back scored and COMPLETED with
      // the gate's own finding reading "Document cuts off mid-sentence at the
      // end (paragraph 6)" — the applicant would have downloaded a pack whose
      // argument stops halfway.
      //
      // ⚠️ IT IS ONLY A LOG, DELIBERATELY. A short document is a failed attempt
      // (below), but a truncated one is a nearly-complete document, and throwing
      // it away costs the applicant a full regeneration for something the gate
      // is about to score honestly anyway. What was missing was VISIBILITY: the
      // symptom looked like a writing fault rather than a token ceiling. If this
      // starts firing regularly, max_tokens is the fix — and note that output
      // tokens are wall-clock, so raise GENERATE_TIMEOUT_MS with it.
      if (msg.stop_reason === 'max_tokens') {
        this.logger.error(
          `Motivation document hit max_tokens (${msg.usage?.output_tokens ?? '?'} out) ` +
            `— the document is truncated and will read as unfinished. Raise max_tokens.`,
        );
      }

      if (text.length < 200) {
        // Too short to be a motivation. Treat as a failed attempt rather than
        // storing something the applicant would have to throw away.
        throw new Error('Generated document was too short to be usable');
      }
      return { text, usage: this.usageOf(msg, MODEL_WRITE) };
    } catch (err) {
      const detail = (err as Error).message;
      this.logger.error(`Motivation generation failed: ${detail}`);
      this.raiseOutageAlert(detail);
      // SOFT failure — the caller must not consume a beta seat for this.
      throw new Error(
        'We could not draft the document just now. Please try again in a minute.',
      );
    }
  }

  /**
   * Research the case before writing it.
   *
   * The professional motivations we studied are not templates: the
   * self-defence one annexes the precinct's own police-station crime figures,
   * and every section 16 carries pages on the firearm's design and the
   * cartridge's history. That material is PUBLISHED — it is not something to
   * ask the applicant for, and not something a writer should recall from
   * training data and hope. So a cheaper model with web search gathers it
   * once per motivation, and the writer is handed the brief.
   *
   * ⚠️ PRIVACY IS THE HARD CONSTRAINT HERE. Search queries leave Anthropic
   * for a search engine, so nothing identifying may appear in one: the
   * street address is stripped in CODE before the model sees anything (only
   * suburb/town/province survive), and the prompt forbids searching any
   * name or number besides. The applicant's answers do NOT travel here —
   * only the firearm's make and model, the calibre, the discipline and the
   * redacted area, which is the whole reason this is a separate call rather
   * than a tool on the writer.
   *
   * FAIL-SOFT: research is seasoning. A null return costs colour, never the
   * document.
   */
  async research(args: {
    licenceType: MotivationLicenceType;
    answers: Record<string, string>;
    /**
     * Held firearms the overlap check matched against the one applied for,
     * as the applicant described them (".308 Win Tikka").
     *
     * ⚠️ WITHOUT THIS THE COMPARISON SECTION HAS NOTHING TO ARGUE WITH. The
     * writer must now build the distinction itself rather than wait for the
     * applicant to supply it (operator, 2026-08-22), and rule 1 forbids it
     * every figure it was not given — so a comparison with no researched
     * material on the OTHER cartridge can only be written in generalities.
     * Researching both is what makes the distinction concrete and checkable.
     *
     * Cartridge and make only, never a serial or a licence number; the same
     * privacy rule that governs the rest of this brief.
     */
    heldForComparison?: string[];
  }): Promise<{ text: string; usage: ClaudeUsage } | null> {
    if (!this.client) return null;
    const a = args.answers;
    const firearm = ['firearm_type', 'firearm_action', 'firearm_make', 'firearm_model', 'firearm_calibre']
      .map((k) => (a[k] ?? '').trim())
      .filter(Boolean)
      .join(' ');
    const area = redactToArea(a.residential_address ?? '');
    const discipline = (a.discipline_other || a.discipline || '').trim();
    // Deduped and capped: three named cartridges is already a wide brief, and
    // an owned-firearms table with six rows in the same class would otherwise
    // spend the search budget on the sixth.
    const held = [
      ...new Set((args.heldForComparison ?? []).map((h) => h.trim()).filter(Boolean)),
    ]
      .slice(0, 3)
      .map((h) => sanitizePromptValue(h, 60))
      .join('; ');
    if (!firearm && !area) return null;

    const wantArea = args.licenceType === 'S13_SELF_DEFENCE';
    const brief = [
      'Prepare a short research brief for a South African firearm licence',
      'motivation. Search the web for what you do not reliably know. Cite the',
      'source (publication and URL) after each cluster of facts.',
      '',
      "⚠️ PRIVACY, ABSOLUTE: never put a person's name, an ID number, a",
      'street or a serial number into any search query. Search only the',
      'firearm, the cartridge, the discipline, and the AREA below as given.',
      '',
      firearm ? `THE FIREARM: ${firearm}.` : '',
      firearm
        ? 'Find: the manufacturer and model background, its design features,' +
          ' action and configuration, and what the model is built and used' +
          ' for. Then the CARTRIDGE: its origin, character (recoil, typical' +
          ' loads, effective use), and what it is commonly used for in South' +
          ' Africa.'
        : '',
      discipline ? `THE DISCIPLINE: ${discipline}. Find what it involves and what it asks of the firearm.` : '',
      held
        ? `ALREADY HELD, AND IT COVERS SIMILAR GROUND: ${held}. The applicant` +
          ' already holds this, so the motivation has to say what the firearm' +
          ' applied for does that this one does not. Find the same kind of' +
          ' detail for THIS cartridge — its character, effective use and what' +
          ' it is commonly used for here — and then set the two against each' +
          ' other: where each one is at its best, where each is over- or' +
          ' under-matched, what one does that the other does not. Report the' +
          ' comparison as published fact, and take no view on the application.'
        : '',
      wantArea && area
        ? `THE AREA: ${area}. Find the recent crime picture for this area and` +
          ' its policing precinct — categories like house robbery, home' +
          ' invasion, hijacking — from SAPS statistics or reputable press.' +
          ' Figures with periods attached, never vibes.'
        : '',
      '',
      'Write the brief as titled plain-text sections. Facts only, no advice,',
      'no opinion on the application. If a search finds nothing solid, say',
      'nothing on that point — an empty section beats a guessed one.',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const msg = await this.client.messages.create(
        {
          model: MODEL_GATE,
          max_tokens: 4000,
          tools: [
            {
              type: 'web_search_20260209' as never,
              name: 'web_search',
              max_uses: 8,
            } as never,
          ],
          messages: [{ role: 'user', content: brief }],
        },
        { timeout: RESEARCH_TIMEOUT_MS },
      );
      // Search-tool turns interleave text blocks with results; the brief is
      // the concatenation of every text block, not just the first.
      const text = msg.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('\n')
        .trim();
      if (text.length < 100) return null;
      return { text, usage: this.usageOf(msg, MODEL_GATE) };
    } catch (err) {
      // A model without the tool, an org with search disabled, a timeout —
      // all cost colour, never the document.
      this.logger.warn(`Motivation research failed: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * THE SECOND VERIFIER — a fresh pair of eyes on the BUILT document.
   *
   * The pipeline verifies every document twice and not more (operator's cap):
   * grade() scores the writing against the facts, and THIS reads the finished
   * document the way a suspicious DFO would — do the numbers agree with each
   * other, does every annexure citation point at a real tab, is anything
   * promised or implied that the pack cannot back. It runs once, after the
   * gate has passed, on the text that will actually be filed.
   *
   * Deterministic identity checks (serial, ID, annexure letters) are NOT its
   * job — motivation-verify.ts does those in code, for free. This catches
   * what regexes cannot: a joined date that contradicts a "member since"
   * sentence, an annexure cited for the wrong kind of fact, a paragraph that
   * quietly promises an outcome.
   *
   * ADVISORY BY DESIGN: the gate has already passed this text, so a broken
   * verifier must not un-pass it. Findings are stored with the quality
   * verdict for the applicant and the operator to read.
   */
  async verifyDocument(args: {
    pack: FactPack;
    documentText: string;
    annexures: { letter: string; label: string }[];
  }): Promise<{ issues: string[]; usage: ClaudeUsage } | null> {
    if (!this.client) return null;
    const list = args.annexures
      .map((a) => `${a.letter}: ${a.label}`)
      .join('\n');
    try {
      const msg = await this.client.messages.create(
        {
          model: MODEL_GATE,
          max_tokens: 1500,
          // Same reason as the gate: a JSON verdict call must spend its budget
          // on text, not on adaptive thinking the input provokes.
          thinking: { type: 'disabled' } as never,
          system: [
            'You are the final check on a firearm licence motivation before it',
            'is filed. Read it the way a suspicious reviewing officer would.',
            '',
            'Report ONLY concrete defects, each in one plain sentence:',
            '- internal contradictions: dates, numbers or names that disagree',
            '  with each other or with the applicant facts',
            '- an annexure cited for a fact that annexure could not evidence',
            '- any promise or prediction about the outcome of the application',
            '- any VERIFIABLE fact about the applicant — an event, record,',
            '  membership, qualification, possession or incident — that the',
            '  supplied facts do not contain. Intentions, purposes and the',
            '  rationale for the firearm are the writer\'s to supply and are',
            '  NOT defects.',
            'Do NOT comment on style, persuasiveness, or whether the',
            'application should succeed. An empty list is a good answer.',
            '',
            'Return STRICT JSON: {"issues":["..."]}',
          ].join('\n'),
          messages: [
            {
              role: 'user',
              content: [
                `Licence type: ${args.pack.licenceType}`,
                '',
                '<applicant-facts>',
                Object.entries(args.pack.answers)
                  .filter(([, v]) => (v ?? '').trim())
                  .map(([k, v]) => `${k}: ${v}`)
                  .join('\n'),
                '</applicant-facts>',
                '',
                'Annexures actually in the pack:',
                list || '(none)',
                '',
                '<final-document>',
                args.documentText,
                '</final-document>',
                '',
                'Verify. Return only the JSON object.',
              ].join('\n'),
            },
          ],
        },
        { timeout: GRADE_TIMEOUT_MS },
      );
      const block = msg.content.find((b) => b.type === 'text');
      const raw = (block as { text?: string } | undefined)?.text ?? '';
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) return null;
      const parsed = JSON.parse(m[0]) as { issues?: unknown };
      const issues = Array.isArray(parsed.issues)
        ? parsed.issues.map((i) => String(i)).filter(Boolean).slice(0, 12)
        : [];
      return { issues, usage: this.usageOf(msg, MODEL_GATE) };
    } catch (err) {
      this.logger.warn(
        `Motivation verify failed (advisory): ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Grade the draft.
   *
   * temperature 0: a score sitting near the pass line must not flip between
   * runs, or the same document passes on one attempt and fails on the next.
   *
   * FAILS CLOSED, three ways:
   *   • a shape that is not an object at all → fail
   *   • any score that is not a finite number → coerced to 0, so a malformed
   *     reply cannot sail past a `>= floor` comparison
   *   • unparseable output → fail with a marker issue, NOT a low score, so the
   *     caller can tell "the grader broke" from "the document is weak" and does
   *     not buy an expensive regeneration on a formatting regression
   */
  async grade(pack: FactPack, documentText: string): Promise<{
    verdict: GateVerdict;
    usage: ClaudeUsage;
    parsed: boolean;
  }> {
    if (!this.client) {
      return {
        verdict: this.failedVerdict('The reviewer is unavailable.'),
        usage: { model: MODEL_GATE, promptTokens: 0, completionTokens: 0 },
        parsed: false,
      };
    }

    let raw = '';
    let usage: ClaudeUsage = {
      model: MODEL_GATE,
      promptTokens: 0,
      completionTokens: 0,
    };

    try {
      const msg = await this.client.messages.create(
        {
          model: MODEL_GATE,
          // ⚠️ THE VERDICT IS SMALL BUT NOT BOUNDED. It carries thin_fields and
          // a free-text issues list, and a strict reviewer given a long draft
          // writes a lot of issues. At 1200 the reply was truncated mid-JSON;
          // the brace match below needs a CLOSING brace, found none, and every
          // document was failed with "the reviewer did not return a usable
          // verdict" — a gate that fails closed, so nothing could ever pass.
          // Output tokens bill as used, so the headroom is close to free.
          max_tokens: 4000,
          // ⚠️ THINKING OFF, EXPLICITLY. Sonnet 5's adaptive thinking engages
          // on its own when the input looks hard — and the research block made
          // it look hard: a live gate call burned all 4000 output tokens on
          // reasoning and emitted 255 characters of truncated JSON, which the
          // fail-closed parse correctly scored as "no usable verdict", 0. A
          // verdict is transcription of a judgement into a fixed shape; the
          // budget must be text. Probed on the live key before relying on it.
          thinking: { type: 'disabled' } as never,
        // ⚠️ NO `temperature` HERE, AND NEVER ADD ONE.
        //
        // temperature / top_p / top_k were REMOVED from the API on Opus 4.7 and
        // later, and on Sonnet 5 — which is what ANTHROPIC_MODEL_JUDGE points at
        // on the live box. Sending one is a 400:
        //   "`temperature` is deprecated for this model."
        //
        // It cost us two days of silence: every call site below fails soft, so
        // the 400 was caught, logged at warn, and the feature simply did
        // nothing. Deterministic transcription is the DEFAULT now — there is no
        // parameter to ask for it.
          //
          // ⚠️ THIS ONE FAILS CLOSED. A gate that cannot be reached returns
          // failedVerdict, so while this was 400ing NO motivation could pass
          // review at all.
          system: gateSystemPrompt(),
          messages: [
            { role: 'user', content: gateUserPrompt(pack, documentText) },
          ],
        },
        { timeout: GRADE_TIMEOUT_MS },
      );
      const block = msg.content.find((b) => b.type === 'text');
      raw = (block as { text?: string } | undefined)?.text ?? '';
      usage = this.usageOf(msg, MODEL_GATE);
      // ⚠️ A TRUNCATED VERDICT IS INDISTINGUISHABLE FROM A BAD DOCUMENT unless
      // we say so here. Logged at error because it is our fault, not the
      // applicant's, and it fails their document either way.
      if (msg.stop_reason === 'max_tokens') {
        this.logger.error(
          `Motivation quality gate hit max_tokens (${usage.completionTokens} out) — the verdict is truncated and will not parse. Raise max_tokens.`,
        );
      }
    } catch (err) {
      const detail = (err as Error).message;
      this.logger.error(`Motivation quality gate failed: ${detail}`);
      this.raiseOutageAlert(detail);
      return {
        verdict: this.failedVerdict('The reviewer could not be reached.'),
        usage,
        parsed: false,
      };
    }

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      // SHAPE ONLY, NEVER CONTENT. The verdict quotes the draft, and the draft
      // is somebody's address, ID number and safe. Length and which brace is
      // missing is enough to tell truncation from a refusal from an empty
      // reply, which is all this needs to distinguish.
      this.logger.error(
        `Motivation quality gate returned no JSON object: ${raw.length} chars, ` +
          `startsWithBrace=${raw.trimStart().startsWith('{')}, ` +
          `endsWithBrace=${raw.trimEnd().endsWith('}')}`,
      );
      return {
        verdict: this.failedVerdict('The reviewer did not return a usable verdict.'),
        usage,
        parsed: false,
      };
    }

    let obj: unknown;
    try {
      obj = JSON.parse(match[0]);
    } catch {
      return {
        verdict: this.failedVerdict('The reviewer verdict could not be read.'),
        usage,
        parsed: false,
      };
    }

    // Shape guard BEFORE touching nested fields — a refusal object must produce
    // a clean fail rather than a 500.
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return {
        verdict: this.failedVerdict('The reviewer verdict was malformed.'),
        usage,
        parsed: false,
      };
    }

    const o = obj as Record<string, unknown>;
    const toScore = (v: unknown): number => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
    };

    const completeness = toScore(o.completeness);
    const specificity = toScore(o.specificity);
    const consistency = toScore(o.consistency);
    const groundedness = toScore(o.groundedness);
    const overall = Math.round(
      (completeness + specificity + consistency + groundedness) / 4,
    );

    const thinFields = Array.isArray(o.thin_fields)
      ? o.thin_fields.filter((x): x is string => typeof x === 'string').slice(0, 20)
      : [];
    const issues = Array.isArray(o.issues)
      ? o.issues
          .filter((x): x is string => typeof x === 'string')
          .map((s) => s.slice(0, 300))
          .slice(0, 20)
      : [];

    // Written as "below the floor fails", never "above the floor passes", so a
    // zero from a malformed field can only ever fail.
    const passed = overall >= QUALITY_FLOOR && groundedness >= GROUNDEDNESS_FLOOR;

    return {
      verdict: {
        completeness,
        specificity,
        consistency,
        groundedness,
        overall,
        thinFields,
        issues,
        passed,
      },
      usage,
      parsed: true,
    };
  }

  /** A verdict that cannot pass, for every path where grading did not happen. */
  private failedVerdict(reason: string): GateVerdict {
    return {
      completeness: 0,
      specificity: 0,
      consistency: 0,
      groundedness: 0,
      overall: 0,
      thinFields: [],
      issues: [reason],
      passed: false,
    };
  }

  /**
   * Phrase one follow-up question. WE pick the field (the gate named it);
   * Claude only asks it nicely. A failure here is not fatal — the caller falls
   * back to the field's own help text, because a plain question beats no
   * question.
   */
  /**
   * Ask for a batch of follow-ups in ONE request.
   *
   * Replaces a loop that called askFollowUp once per field. Same output, a
   * third of the requests, and the model can vary its phrasing because it sees
   * the whole batch.
   *
   * Returns a key→question map with only the entries it could parse. A missing
   * key is not an error: the caller has a free fallback question for every
   * field, so a partial answer degrades to plain wording rather than to
   * silence.
   */
  async askFollowUpBatch(args: {
    licenceType: MotivationLicenceType;
    gaps: {
      key: string;
      label: string;
      help?: string;
      reason: string;
      wordsSoFar: number;
    }[];
  }): Promise<{ questions: Record<string, string>; usage: ClaudeUsage }> {
    const empty = {
      questions: {} as Record<string, string>,
      usage: { model: MODEL_FOLLOWUP, promptTokens: 0, completionTokens: 0 },
    };
    if (!args.gaps.length) return empty;

    const client = this.client;
    if (!client) return empty;

    let text: string;
    let usage: ClaudeUsage;
    try {
      const res = await client.messages.create({
        model: MODEL_FOLLOWUP,
        max_tokens: 900,
        // ⚠️ `temperature: 0.7` WAS HERE, and it was deliberate — variation
        // between documents is what keeps a CFR reviewer from seeing the same
        // motivation twice. It still had to go: the parameter is removed on
        // this model family and was 400ing the call.
        //
        // The variation does not depend on it. It is engineered structurally —
        // Motivation.variantSeed, the structure plans in motivation-structure.ts,
        // and the sameness check against the recent corpus. Sampling temperature
        // was the least of it. If documents ever do start reading alike, the
        // lever is another structure plan, not a parameter that no longer
        // exists.
        //
        // ⚠️ THE VISUAL HALF OF THAT VARIATION IS GONE, deliberately. A
        // motivation-style.ts used to mix 13 fonts, 10 palettes, 4 leadings and
        // 6 formats into some 3,120 looks, on the reasoning that a reviewer
        // with a stack of paper notices a repeated TYPEFACE before they notice
        // a repeated argument. The design handoff of 2026-08-21 replaced it
        // with one typeset document in ten colourways, and that is the right
        // trade: a pack that looks like it came from somebody who does this
        // for a living beats a pack that is merely hard to pair with another.
        // The variation that survives is the variation that matters — what the
        // document says, and in what order.
        system: followUpBatchSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: followUpBatchUserPrompt(args.licenceType, args.gaps),
          },
        ],
      });
      const block = res.content.find((b) => b.type === 'text');
      text = block && 'text' in block ? block.text.trim() : '';
      usage = this.usageOf(res, MODEL_FOLLOWUP);
    } catch (err) {
      this.logger.warn(
        `Follow-up batch failed, falling back to plain questions: ${(err as Error).message}`,
      );
      return empty;
    }

    const questions: Record<string, string> = {};
    try {
      const json = text.startsWith('{') ? text : text.slice(text.indexOf('{'));
      const parsed = JSON.parse(json) as {
        questions?: { key?: unknown; question?: unknown }[];
      };
      const wanted = new Set(args.gaps.map((g) => g.key));
      for (const q of parsed.questions ?? []) {
        // Only keys WE asked about. A model that invents a field key would
        // otherwise have a question stored against a field that does not exist,
        // which the wizard could never render or clear.
        if (typeof q?.key !== 'string' || !wanted.has(q.key)) continue;
        if (typeof q?.question !== 'string') continue;
        const cleaned = q.question.trim();
        if (cleaned) questions[q.key] = cleaned.slice(0, 400);
      }
    } catch {
      this.logger.warn('Follow-up batch returned unparseable JSON; using fallbacks');
    }

    return { questions, usage };
  }

  async askFollowUp(args: {
    licenceType: MotivationLicenceType;
    fieldKey: string;
    fieldLabel: string;
    fieldHelp?: string;
    currentAnswer: string;
  }): Promise<{ question: string | null; usage: ClaudeUsage }> {
    const usage: ClaudeUsage = {
      model: MODEL_FOLLOWUP,
      promptTokens: 0,
      completionTokens: 0,
    };
    if (!this.client) return { question: null, usage };

    try {
      const msg = await this.client.messages.create(
        {
          model: MODEL_FOLLOWUP,
          max_tokens: 300,
          system: followUpSystemPrompt(),
          messages: [{ role: 'user', content: followUpUserPrompt(args) }],
        },
        { timeout: GRADE_TIMEOUT_MS },
      );
      const block = msg.content.find((b) => b.type === 'text');
      const q = ((block as { text?: string } | undefined)?.text ?? '').trim();
      return {
        question: q || null,
        usage: this.usageOf(msg, MODEL_FOLLOWUP),
      };
    } catch (err) {
      this.logger.warn(
        `Follow-up question generation failed: ${(err as Error).message}`,
      );
      return { question: null, usage };
    }
  }
}


/**
 * Strip a residential address down to what may appear in a WEB SEARCH.
 *
 * ⚠️ THE FIRST LINE IS THE HOUSE. Everything before the first separator — the
 * number and street — is dropped in code, so no prompt mistake can leak it:
 * the model never receives it at all. Digits are removed from what survives,
 * against unit numbers and postal codes riding along in the tail.
 */
export function redactToArea(address: string): string {
  const parts = address
    .split(/[,\n]/)
    .map((p) => p.replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (parts.length <= 1) return '';
  return parts.slice(1).join(', ').slice(0, 120);
}
