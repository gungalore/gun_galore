import { Injectable, Logger } from '@nestjs/common';
import { MotivationLicenceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { LlmError, type LlmResponse } from '../common/llm/llm.types';
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
// Every MODEL call the motivation writer makes.
//
// ⚠️ IT WAS ITS OWN ANTHROPIC CLIENT UNTIL 2026-09-07, and the file was called
// motivation-claude.service.ts. Operator: everything moves from the Claude API
// to Gemini 2.5 Flash-Lite. Fifteen services each built their own client, chose
// their own model and parsed their own response; they now speak the one shape
// in common/llm/llm.types.ts and LlmService speaks the provider's. Nothing in
// here names a provider any more — which is the point, because the next switch
// must not be fifteen rewrites again.
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
// call and those ceilings stopped applying.
//
// It went from theoretical to live the day the corpus sections landed. An S16
// with an overlap now writes the_discipline, the_firearm, the_calibre,
// comparison AND statutory_application, and three consecutive real attempts
// on MO000017 died with "Request timed out" at 85s — the applicant getting
// "we could not draft the document just now" for work that was progressing
// fine.
//
// ⚠️ RAISED AGAIN 2026-08-22 WITH THE TOKEN CEILING, AND THE TWO MUST MOVE
// TOGETHER. Output tokens are wall clock. The writer's ceiling went from 8 000
// to 32 000 because a thinking budget was eating the document alive at the old
// figure; leaving the clock at 180s would simply have swapped "too short to be
// usable" for "Request timed out" — the same dead end with a different message.
//
// The real ceiling is still sweepStuckGenerations(). The worst realistic path
// is research 180 + write 300 + one local retry 300 + verify 60 + grade 60 =
// 15 minutes, so the sweep moved to 25 to keep its headroom. Raise either of
// these and redo that sum.
//
// ⚠️ THEY ARE `timeoutMs` ON THE REQUEST NOW, not a client-construction
// option. One shared LlmService serves the whole platform, so a per-call
// ceiling is the only place a writer's 300s and a verdict's 60s can differ.
const GENERATE_TIMEOUT_MS = 300_000;
const GRADE_TIMEOUT_MS = 60_000;
// ⚠️ 180s IS THE FIGURE THE sweepStuckGenerations SUM ABOVE IS BUILT ON
// ("research 180 + write 300 + …"). A provider-hosted search is several round
// trips inside one call, so it is slower than its token count suggests; raise
// this and redo that sum before anything else.
const RESEARCH_TIMEOUT_MS = 180_000;

// ────────────────────────────────────────────────────────────────────
// MODEL CHOICE — THERE ISN'T ONE ANY MORE, AND THAT COST US SOMETHING.
//
// This file used to pick three models and say why: Opus wrote (instruction-
// following under pressure is where the flagship earned its keep), a DIFFERENT
// model graded, and Haiku phrased the follow-up questions. Every call now takes
// LlmService.model — one platform model, from LLM_MODEL.
//
// ⚠️ THE ONE THAT MATTERED IS THE GATE, so it is recorded rather than quietly
// dropped: the grader was deliberately not the writer's model, because a model
// grading its own output shares its own blind spots — if the writer invents a
// plausible detail, the same model is the one most likely to wave it through.
// Groundedness is the score that vetoes everything, so the checker was chosen
// to fail DIFFERENTLY from the writer. Writer and gate are now the same model,
// and that independence is gone. What still stands between an invented fact and
// a filed document: the mechanical checks in motivation-verify.ts (code, not a
// model), the second verifier below, and the groundedness floor itself.
//
// If groundedness scores drift up while the operator's own reading of the
// documents does not, THIS is the first place to look — and the fix is one
// line: `model:` on the gate request, pointed at a different model from the
// writer's. The contract carries the override for exactly this reason.
// ────────────────────────────────────────────────────────────────────

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

/** Tokens and the model that spent them. Stamped on the row for the spend card. */
export interface ModelUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface GenerationResult {
  text: string;
  usage: ModelUsage;
}

@Injectable()
export class MotivationModelService {
  private readonly logger = new Logger(MotivationModelService.name);

  // One alert per window, not one per affected applicant. A silently broken
  // writer during a free beta is exactly the failure that goes unnoticed for a
  // week.
  private lastOutageAlertAt = 0;
  private static readonly OUTAGE_ALERT_GAP_MS = 6 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  get configured(): boolean {
    return this.llm.isConfigured();
  }

  private raiseOutageAlert(detail: string): void {
    const now = Date.now();
    if (
      now - this.lastOutageAlertAt <
      MotivationModelService.OUTAGE_ALERT_GAP_MS
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
            // ⚠️ NO PROVIDER NAME. An admin reading this alert should look at
            // the AI service on /admin/health, whichever provider is behind it
            // — naming one sends them to the wrong dashboard the day it changes.
            `Applicants cannot generate documents. Check the AI service status on /admin/health.`,
        },
      })
      .catch(() => undefined);
  }

  /** What a failure looked like, for a log line. Codes, never a provider class. */
  private static why(err: unknown): string {
    return err instanceof LlmError
      ? `${err.code}: ${err.message}`
      : (err as Error).message;
  }

  private usageOf(res: LlmResponse): ModelUsage {
    return {
      model: res.model,
      promptTokens: res.usage.inputTokens,
      completionTokens: res.usage.outputTokens,
    };
  }

  /**
   * Draft the document.
   *
   * The licence-type rules go in `system` and the applicant's facts and
   * structure plan in the user turn. They were split so the byte-identical
   * half could carry a cache marker; the marker is gone with the SDK
   * (`cache_control` has no place in the neutral shape — the adapter caches or
   * does not), and the SPLIT stays because it is also what keeps somebody's
   * name and address out of a block we hand to every applicant of that type.
   *
   * Default temperature: variation is wanted here, and the structure plan
   * already constrains the shape.
   */
  async generate(
    pack: FactPack,
    plan: StructurePlan,
  ): Promise<GenerationResult> {
    if (!this.llm.isConfigured()) {
      throw new Error('Document generation is not available right now.');
    }
    try {
      // ⚠️ STREAMED, AND maxTokens IS NOT A BUDGET — IT IS A CEILING.
      //
      // THE LIVE FAILURE, 2026-08-22 20:20 SAST. A run logged BOTH "hit
      // max_tokens (8000 out)" AND "Generated document was too short to be
      // usable", in the same second. Those read as contradictory and are not:
      // the model spent the entire 8 000-token allowance THINKING and was cut
      // off before it wrote a word of the document. The applicant pressed
      // Prepare, the button greyed out, came back, and nothing else happened.
      //
      // Two mistakes, both mine, both in this call:
      //
      // 1. 8 000 WAS NEVER ENOUGH. The target is 2 500-4 500 words of prose,
      //    which is 3 500-6 500 tokens BEFORE any thinking. The old note
      //    reasoned the ceiling down from an 85s synchronous request — but
      //    generation moved to a detached background run (startGeneration) and
      //    the ceiling never moved with it. Nothing is billed for headroom:
      //    output tokens are charged as generated, so a ceiling the model does
      //    not reach costs exactly nothing.
      // 2. THINKING WAS LEFT TO THE DEFAULT, so an adaptive budget shared the
      //    same 8 000 with the document and won. It is explicit below, and a
      //    NUMBER now rather than a mode — which is the safer shape of the two,
      //    because a budget cannot silently expand into the document's room.
      //
      // Streaming because a long generation on a non-streamed request risks a
      // provider's own long-request guard, and because the token ceiling below
      // is high enough to make that a real possibility rather than a theory.
      let final: LlmResponse | null = null;
      for await (const event of this.llm.stream({
        maxTokens: 32_000,
        // Explicit, so it is never again a default's decision. Rule 4 of this
        // document's own prompt asks for element-by-element statutory
        // application; that is reasoning, and it earns its tokens.
        // ⚠️ 4096 IS A CEILING ON THE REASONING, NOT ON THE DOCUMENT. It is
        // deliberately a small fraction of the 32 000 above, so the failure
        // that produced this comment — thinking eating the whole allowance —
        // cannot recur however hard the input looks.
        thinking: { budgetTokens: 4096 },
        system: generationSystemPrompt(pack.licenceType),
        messages: [
          { role: 'user', content: generationUserPrompt(pack, plan) },
        ],
        purpose: 'motivation.generate',
        timeoutMs: GENERATE_TIMEOUT_MS,
      })) {
        if (event.type === 'done') final = event.response;
      }
      if (!final) {
        // A stream that ends without a `done` event produced no answer at all.
        throw new Error('The writer returned no response');
      }

      // ⚠️ EVERY TEXT PART, NOT THE FIRST. This was `.find(b => b.type ===
      // 'text')` on the SDK's blocks, which was correct only while a response
      // was one text block. With thinking enabled the parts interleave, and
      // taking the first text part silently truncates the document at the
      // first pause in the model's writing — a defect that would have looked
      // exactly like a writing fault and never like a bug. `response.text` is
      // every text part joined, which is that fix made permanent in the
      // contract rather than re-earned at each call site.
      const text = final.text.trim();

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
      // starts firing regularly, maxTokens is the fix — and note that output
      // tokens are wall-clock, so raise GENERATE_TIMEOUT_MS with it.
      if (final.stopReason === 'max_tokens') {
        this.logger.error(
          `Motivation document hit max_tokens (${final.usage.outputTokens} out) ` +
            `— the document is truncated and will read as unfinished. Raise maxTokens.`,
        );
      }

      if (text.length < 200) {
        // Too short to be a motivation. Treat as a failed attempt rather than
        // storing something the applicant would have to throw away.
        //
        // ⚠️ SAY WHAT CAME BACK, NOT JUST THAT IT WAS SHORT. The bare message
        // sent us looking for a writing fault when the response contained no
        // text part at all — the whole allowance had gone to thinking. The
        // part types and the stop reason separate those two worlds in one
        // line of log.
        const shape = final.parts.map((p) => p.type).join('+') || 'empty';
        this.logger.error(
          `Motivation document unusable: ${text.length} chars of text, ` +
            `stopReason=${final.stopReason}, parts=[${shape}], ` +
            `out=${final.usage.outputTokens} tokens.`,
        );
        throw new Error('Generated document was too short to be usable');
      }
      return { text, usage: this.usageOf(final) };
    } catch (err) {
      const detail = MotivationModelService.why(err);
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
   * training data and hope. So a cheaper model with web search gathered it
   * once per motivation, and the writer was handed the brief.
   *
   * ⚠️ IT IS A GROUNDED CALL, AND IT MUST STAY ONE. It was off between the
   * 2026-09-07 provider move and the grounding flag landing later the same
   * day, because the alternative was worse and was considered: making this
   * same call WITHOUT a search does not produce "less research", it produces a
   * model RECALLING precinct crime figures and cartridge histories, which is
   * exactly the invented fact the gate's groundedness floor exists to catch,
   * laundered into the brief as though it had a source. The applicant SIGNS
   * this document and files it with SAPS.
   *
   * So the rule that survived the outage is the rule now: if the search cannot
   * run, the brief is ABSENT rather than guessed. Every failure below returns
   * null — no key, an empty brief, a provider error, or an answer that came
   * back with no text — and the caller already treats null as "no brief".
   * Research is seasoning; a null costs colour, never the document.
   *
   * ⚠️ NO `json`, NO `tools`, and the timeout is its own. Gemini 2.5 rejects
   * grounding beside either of those (see gemini.provider.ts) — this call
   * wants neither, and the day someone adds one the adapter will say so at the
   * door rather than quietly returning an unsourced brief.
   *
   * ⚠️ PRIVACY IS ENFORCED IN researchBrief(), NOT HERE. The street address is
   * stripped in CODE before the model sees anything, and the brief's own text
   * forbids searching a name, an ID number or a serial. That mattered when the
   * search was Anthropic's and it matters more now: the queries go to Google.
   * The brief is a pure function with its own tests for exactly this reason —
   * never build a query in this method.
   */
  async research(args: ResearchArgs): Promise<{
    text: string;
    usage: ModelUsage;
  } | null> {
    const brief = researchBrief(args);
    if (!brief) return null;

    try {
      const res = await this.llm.complete({
        messages: [{ role: 'user', content: brief }],
        maxTokens: 4000,
        grounding: { web: true },
        purpose: 'motivation.research',
        timeoutMs: RESEARCH_TIMEOUT_MS,
      });
      const text = res.text.trim();
      if (!text) return null;
      // ⚠️ SOURCELESS IS NOT A FAILURE HERE, and it is not treated as one. A
      // grounded call that opened nothing reports groundingSources: [], and
      // the brief itself already says "if a search finds nothing solid, say
      // nothing on that point". What the writer then receives is a thin
      // brief, which is the honest outcome. It is logged because a run of
      // empty ones means the search is broken, not that the cases are dull.
      const sources = res.groundingSources?.length ?? 0;
      if (sources === 0) {
        this.logger.warn(
          'Motivation research came back with no web sources — the brief is thin, not wrong. Check grounding if this repeats.',
        );
      }
      return {
        text,
        usage: {
          model: res.model,
          promptTokens: res.usage.inputTokens,
          completionTokens: res.usage.outputTokens,
        },
      };
    } catch (err) {
      // ⚠️ NO PROVIDER NAME, and no query text — the brief carries the
      // applicant's suburb and the firearm they are applying for.
      const code = err instanceof LlmError ? err.code : 'unknown';
      this.logger.warn(
        `Motivation research failed [${code}] — the document is written without it rather than with a remembered brief.`,
      );
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
  }): Promise<{ issues: string[]; usage: ModelUsage } | null> {
    if (!this.llm.isConfigured()) return null;
    const list = args.annexures
      .map((a) => `${a.letter}: ${a.label}`)
      .join('\n');
    try {
      const res = await this.llm.complete({
        maxTokens: 1500,
        // Same reason as the gate: a JSON verdict call must spend its budget
        // on text, not on reasoning the input provokes.
        thinking: { budgetTokens: 0 },
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
        purpose: 'motivation.verify',
        timeoutMs: GRADE_TIMEOUT_MS,
      });
      const m = res.text.match(/\{[\s\S]*\}/);
      if (!m) return null;
      const parsed = JSON.parse(m[0]) as { issues?: unknown };
      const issues = Array.isArray(parsed.issues)
        ? parsed.issues.map((i) => String(i)).filter(Boolean).slice(0, 12)
        : [];
      return { issues, usage: this.usageOf(res) };
    } catch (err) {
      this.logger.warn(
        `Motivation verify failed (advisory): ${MotivationModelService.why(err)}`,
      );
      return null;
    }
  }

  /**
   * Grade the draft.
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
    usage: ModelUsage;
    parsed: boolean;
  }> {
    if (!this.llm.isConfigured()) {
      return {
        verdict: this.failedVerdict('The reviewer is unavailable.'),
        usage: { model: this.llm.model, promptTokens: 0, completionTokens: 0 },
        parsed: false,
      };
    }

    let raw = '';
    let usage: ModelUsage = {
      model: this.llm.model,
      promptTokens: 0,
      completionTokens: 0,
    };

    try {
      const res = await this.llm.complete({
        // ⚠️ THE VERDICT IS SMALL BUT NOT BOUNDED. It carries thin_fields and
        // a free-text issues list, and a strict reviewer given a long draft
        // writes a lot of issues. At 1200 the reply was truncated mid-JSON;
        // the brace match below needs a CLOSING brace, found none, and every
        // document was failed with "the reviewer did not return a usable
        // verdict" — a gate that fails closed, so nothing could ever pass.
        // Output tokens bill as used, so the headroom is close to free.
        maxTokens: 4000,
        // ⚠️ THINKING OFF, EXPLICITLY. Adaptive thinking engages on its own
        // when the input looks hard — and the research block made it look
        // hard: a live gate call burned all 4000 output tokens on reasoning
        // and emitted 255 characters of truncated JSON, which the fail-closed
        // parse correctly scored as "no usable verdict", 0. A verdict is
        // transcription of a judgement into a fixed shape; the budget must be
        // text. Zero is that rule in the contract's own units.
        thinking: { budgetTokens: 0 },
        // ⚠️ NO `temperature` HERE, AND THINK BEFORE ADDING ONE.
        //
        // The docstring used to open "temperature 0: a score sitting near the
        // pass line must not flip between runs", and that intent still holds —
        // but the parameter was REMOVED from the Anthropic API on the models
        // this ran on, and sending one was a 400. Every call site here fails
        // soft, so the 400 was caught, logged at warn, and the feature simply
        // did nothing for two days. The parameter went, and deterministic
        // transcription was the default.
        //
        // ⚠️ THAT DEFAULT WAS THE OLD PROVIDER'S, AND IT DID NOT COME WITH US.
        // The neutral contract carries `temperature` again and "omit to take
        // the provider's default" — which on a Gemini model is not 0. So if
        // verdicts start flipping across runs on the same document, THIS is
        // the cause and `temperature: 0` is the fix; it is a real parameter
        // again and no longer a 400.
        system: gateSystemPrompt(),
        messages: [
          { role: 'user', content: gateUserPrompt(pack, documentText) },
        ],
        purpose: 'motivation.gate',
        timeoutMs: GRADE_TIMEOUT_MS,
      });
      raw = res.text;
      usage = this.usageOf(res);
      // ⚠️ A TRUNCATED VERDICT IS INDISTINGUISHABLE FROM A BAD DOCUMENT unless
      // we say so here. Logged at error because it is our fault, not the
      // applicant's, and it fails their document either way.
      if (res.stopReason === 'max_tokens') {
        this.logger.error(
          `Motivation quality gate hit max_tokens (${usage.completionTokens} out) — the verdict is truncated and will not parse. Raise maxTokens.`,
        );
      }
    } catch (err) {
      const detail = MotivationModelService.why(err);
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
   * Ask for a batch of follow-ups in ONE request.
   *
   * WE pick the fields (the gate named them); the model only asks them nicely.
   * Replaces a loop that called askFollowUp once per field: same output, a
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
  }): Promise<{ questions: Record<string, string>; usage: ModelUsage }> {
    const empty = {
      questions: {} as Record<string, string>,
      usage: { model: this.llm.model, promptTokens: 0, completionTokens: 0 },
    };
    if (!args.gaps.length) return empty;
    if (!this.llm.isConfigured()) return empty;

    let text: string;
    let usage: ModelUsage;
    try {
      const res = await this.llm.complete({
        maxTokens: 900,
        // ⚠️ THINKING OFF. Nine hundred tokens is a handful of one-sentence
        // questions and nothing else; a thinking budget shares that ceiling
        // and would produce the writer's 2026-08-22 failure in miniature — a
        // full allowance spent reasoning, no question written, and a caller
        // that quietly falls back to plain wording so nobody ever notices.
        thinking: { budgetTokens: 0 },
        // ⚠️ `temperature: 0.7` WAS HERE, and it was deliberate — variation
        // between documents is what keeps a CFR reviewer from seeing the same
        // motivation twice. It still had to go: the parameter was removed on
        // the model family this ran on and was 400ing the call.
        //
        // The variation does not depend on it. It is engineered structurally —
        // Motivation.variantSeed, the structure plans in motivation-structure.ts,
        // and the sameness check against the recent corpus. Sampling temperature
        // was the least of it. If documents ever do start reading alike, the
        // lever is another structure plan.
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
        purpose: 'motivation.followup.batch',
      });
      text = res.text.trim();
      usage = this.usageOf(res);
    } catch (err) {
      this.logger.warn(
        `Follow-up batch failed, falling back to plain questions: ${MotivationModelService.why(err)}`,
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

  /**
   * Phrase ONE follow-up question. A failure here is not fatal — the caller
   * falls back to the field's own help text, because a plain question beats no
   * question.
   */
  async askFollowUp(args: {
    licenceType: MotivationLicenceType;
    fieldKey: string;
    fieldLabel: string;
    fieldHelp?: string;
    currentAnswer: string;
  }): Promise<{ question: string | null; usage: ModelUsage }> {
    const usage: ModelUsage = {
      model: this.llm.model,
      promptTokens: 0,
      completionTokens: 0,
    };
    if (!this.llm.isConfigured()) return { question: null, usage };

    try {
      const res = await this.llm.complete({
        maxTokens: 300,
        // ⚠️ THINKING OFF — three hundred tokens is one question. See the
        // batch call above; the whole ceiling can go to reasoning and leave
        // nothing for the sentence, and the fallback hides it.
        thinking: { budgetTokens: 0 },
        system: followUpSystemPrompt(),
        messages: [{ role: 'user', content: followUpUserPrompt(args) }],
        purpose: 'motivation.followup',
        timeoutMs: GRADE_TIMEOUT_MS,
      });
      const q = res.text.trim();
      return {
        question: q || null,
        usage: this.usageOf(res),
      };
    } catch (err) {
      this.logger.warn(
        `Follow-up question generation failed: ${MotivationModelService.why(err)}`,
      );
      return { question: null, usage };
    }
  }
}

export interface ResearchArgs {
  licenceType: MotivationLicenceType;
  answers: Record<string, string>;
  /**
   * Held firearms the overlap check matched against the one applied for,
   * as the applicant described them (".308 Win Tikka").
   *
   * ⚠️ WITHOUT THIS THE COMPARISON SECTION HAS NOTHING TO ARGUE WITH. The
   * writer must build the distinction itself rather than wait for the
   * applicant to supply it (operator, 2026-08-22), and rule 1 forbids it
   * every figure it was not given — so a comparison with no researched
   * material on the OTHER cartridge can only be written in generalities.
   *
   * Cartridge and make only, never a serial or a licence number; the same
   * privacy rule that governs the rest of this brief.
   */
  heldForComparison?: string[];
}

/**
 * What the research call ASKS, built from the pack.
 *
 * ⚠️ PRIVACY IS THE HARD CONSTRAINT HERE, AND IT IS WHY THIS IS A PURE
 * FUNCTION WITH ITS OWN TESTS. Search queries leave us for a search engine, so
 * nothing identifying may appear in one: the street address is stripped in CODE
 * before the model sees anything (only suburb/town/province survive), and the
 * prompt forbids searching any name or number besides. The applicant's answers
 * do NOT travel here — only the firearm's make and model, the calibre, the
 * discipline and the redacted area, which is the whole reason this was a
 * separate call rather than a tool on the writer.
 *
 * Returns '' when there is nothing worth asking about.
 */
export function researchBrief(args: ResearchArgs): string {
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
  if (!firearm && !area) return '';

  const wantArea = args.licenceType === 'S13_SELF_DEFENCE';
  return [
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
