import { Injectable, Logger } from '@nestjs/common';
import {
  MotivationLicenceType,
  MotivationStatus,
  MotivationUploadKind,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../common/llm/llm.service';
import { encryptJson } from '../../common/blob-crypto';
import {
  parseProvenance,
  stamp,
} from '../../common/answer-provenance';
import {
  EDITABLE,
  MotivationSharedService,
} from '../motivation-shared.service';
import { LICENCE_TYPE_LABELS } from '../motivation-fields';
import { UPLOAD_KIND_LABELS } from '../motivation-checklist';
import {
  DRAFT_MIN_WORDS,
  DRAFT_CONTINUED_USE_MIN_WORDS,
  affectsDraftFacts,
  countDraftWords,
  draftAllowTerms,
  draftFacts,
  draftedFields,
  fallbackDraft,
  onlyNarrativeGapsRemain,
  targetForField,
  validateDraft,
  type DraftFacts,
  type DraftedTarget,
} from './intake-draft';
import {
  DRAFT_SCHEMA,
  draftSystemPrompt,
  draftUserPrompt,
} from './intake-draft.prompts';

// ────────────────────────────────────────────────────────────────────
// WRITING THE NARRATIVE ANSWERS, AND PUTTING THEM WHERE THE MEMBER CAN EDIT.
//
// The shape follows motivation-reason.service.ts, the established "we wrote it,
// the member may change it" pattern: one model call, validate, retry once with
// the rejections, persist stamped DERIVED-style provenance that renders as a
// suggestion, and never overwrite anything the member typed.
//
// ⚠️ IT IS FAIL-SOFT BY CONTRACT. Nothing in this file throws at a caller: a
// model that is down, slow or returns nonsense leaves the answers alone, and
// the two narrative fields the generation gate refuses without fall back to a
// deterministic paragraph so `finish()` can never dead-end an application.
//
// ⚠️ AND IT IS THROTTLED IN PROCESS. `state()` fires a background draft on
// every GET while targets are outstanding, so without a cooldown a page refresh
// would be a model call. A non-forced run is attempted at most once every 20 s
// per application; a run that produced nothing for the same target set is not
// retried until the facts change (or the member presses the explicit button,
// which is `force` and throttled at the route instead).
// ────────────────────────────────────────────────────────────────────

/** The purpose string this service books under — one model call, one ledger row. */
export const DRAFT_PURPOSE = 'motivation.draft';

const DRAFT_MAX_TOKENS = 1_800;
const DRAFT_TIMEOUT_MS = 60_000;
const DRAFT_TEMPERATURE = 0.5;
/** A non-forced (background) attempt is not repeated inside this window. */
const COOLDOWN_MS = 20_000;
/** What the provenance chip says — the member's own file. */
const DRAFT_FROM = 'your documents and your application';
/** Two attempts: the second is told what the validator refused. */
const MAX_ATTEMPTS = 2;

export interface DraftRunResult {
  drafted: number;
  failed: number;
}

interface DraftRow {
  id: string;
  licenceType: MotivationLicenceType;
  status: MotivationStatus;
  answersEncrypted: string | null;
  answerProvenance: unknown;
}

@Injectable()
export class MotivationNarrativeDraftService {
  private readonly logger = new Logger(MotivationNarrativeDraftService.name);
  /**
   * One run at a time per application. A second caller gets the same promise,
   * so two tabs (or a GET racing the explicit button) cost one model call.
   */
  private readonly inFlight = new Map<string, Promise<DraftRunResult>>();
  /** Last background attempt, ms since epoch. */
  private readonly lastAttemptAt = new Map<string, number>();
  /**
   * The target-set hash a run already failed to draft anything for. A polled
   * GET must not pay for the same deterministic failure every 20 seconds.
   */
  private readonly stalled = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly shared: MotivationSharedService,
  ) {}

  /** True while a draft run is in flight for this application. */
  isDrafting(motivationId: string): boolean {
    return this.inFlight.has(motivationId);
  }

  /**
   * Draft every eligible narrative answer, and return how many landed.
   *
   * ⚠️ NEVER THROWS. `finish()` awaits this against a race and the interview
   * fires it into the background; a rejected promise in either place would
   * either dead-end the member or become an unhandled rejection.
   */
  ensure(
    userId: string,
    motivationId: string,
    opts: { force?: boolean } = {},
  ): Promise<DraftRunResult> {
    const running = this.inFlight.get(motivationId);
    if (running) return running;
    const force = opts.force === true;
    const promise = this.run(userId, motivationId, force)
      .catch((err: unknown) => {
        // Purpose and counts only — never a prompt or a paragraph.
        this.logger.warn(
          `Narrative draft ${motivationId} failed: ${(err as Error).message}`,
        );
        return { drafted: 0, failed: 0 };
      })
      .finally(() => {
        this.inFlight.delete(motivationId);
      });
    this.inFlight.set(motivationId, promise);
    return promise;
  }

  /**
   * Re-draft after the member corrected a FACT that a draft was written from.
   *
   * ⚠️ THE REVIEW SCREEN SAVES THROUGH `saveAnswers`, NOT `patchAnswers`. The
   * review screen edits sheet fields with `PATCH :id/answers` (the established
   * save route), so hooking only the intake's own PATCH route left the drafted
   * paragraphs based on the old facts forever. This is called fire-and-forget
   * after that save; it reads the provenance and, only when a DRAFTED value
   * actually exists, forces a re-draft — which still never touches a MEMBER
   * answer. No drafted values means no model call at all.
   */
  async ensureIfDrafted(
    userId: string,
    motivationId: string,
    changedKeys: readonly string[] = [],
  ): Promise<void> {
    try {
      const row = await this.load(userId, motivationId);
      if (!row || !EDITABLE.includes(row.status)) return;
      const provenance = parseProvenance(row.answerProvenance);
      /**
       * ⚠️ THE FIRST DRAFT STARTS HERE TOO, NOT ONLY ON A REVIEW-SCREEN LOAD.
       * The review screen saves a missing factual answer through
       * `PATCH :id/answers`; if that save was the last fact the document needs,
       * this is the only place that can notice — waiting for another GET would
       * leave the pack refusing on a paragraph nobody asked for. It costs no
       * model call until every factual gap is filled and a narrative target is
       * still empty.
       */
      const answers = await this.shared.answersFor(userId, row.answersEncrypted);
      const drafted = new Set(
        draftedFields(row.licenceType, answers).map((field) => field.key),
      );
      const targetRemains = [...drafted].some(
        (key) =>
          !(answers[key] ?? '').trim() && provenance[key]?.source !== 'MEMBER',
      );
      if (targetRemains && onlyNarrativeGapsRemain(row.licenceType, answers)) {
        // Registered in in-flight synchronously by ensure(); the model call
        // itself is not awaited here, so an autosave's response is not held
        // for a minute. The caller polls GET :id/intake for `drafting`.
        void this.ensure(userId, motivationId);
        return;
      }

      /**
       * ⚠️ ONLY A FACT THE DRAFTS WERE WRITTEN FROM MAY QUEUE A RE-DRAFT.
       * The review screen autosaves on a debounce and on blur; a member
       * correcting a typo in a drafted paragraph is editing a NARRATIVE field,
       * which is not a `draftFacts()` input and must never rewrite the other
       * paragraphs. `affectsDraftFacts` is that whitelist (and its
       * `premises_*` / `existing_firearm_*` prefixes).
       */
      if (!affectsDraftFacts(changedKeys)) return;
      if (!Object.values(provenance).some((entry) => entry.source === 'DRAFTED')) {
        return;
      }
      void this.ensure(userId, motivationId, { force: true });
    } catch (err) {
      this.logger.warn(
        `Narrative re-draft ${motivationId} failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * The last resort for `finish()`: fill the two gated narrative fields from
   * `fallbackDraft` without a model call.
   *
   * ⚠️ IT NEVER TOUCHES THE MEMBER'S WORDS. Only an empty value, or one this
   * service itself wrote (DRAFTED), is replaced. A member's own short history
   * still refuses — the review sheet is where they extend it.
   */
  async ensureDeterministic(
    userId: string,
    motivationId: string,
  ): Promise<DraftRunResult> {
    try {
      const row = await this.load(userId, motivationId);
      if (!row) return { drafted: 0, failed: 0 };
      if (!EDITABLE.includes(row.status)) return { drafted: 0, failed: 0 };

      const answers = await this.shared.answersFor(userId, row.answersEncrypted);
      const provenance = parseProvenance(row.answerProvenance);
      const facts = draftFacts(row.licenceType, answers);
      const values: Record<string, string> = {};

      for (const field of draftedFields(row.licenceType, answers)) {
        const fallback = fallbackDraft(field.key, facts);
        if (!fallback) continue;
        const current = (answers[field.key] ?? '').trim();
        const source = provenance[field.key]?.source;
        if (source === 'MEMBER') continue;
        const floor =
          field.key === 'continued_use'
            ? DRAFT_CONTINUED_USE_MIN_WORDS
            : DRAFT_MIN_WORDS;
        if (current && !(source === 'DRAFTED' && countDraftWords(current) < floor)) {
          continue;
        }
        values[field.key] = fallback;
      }

      return await this.persist(userId, row, values);
    } catch (err) {
      this.logger.warn(
        `Narrative fallback ${motivationId} failed: ${(err as Error).message}`,
      );
      return { drafted: 0, failed: 0 };
    }
  }

  // ── the run ─────────────────────────────────────────────────────────

  private async run(
    userId: string,
    motivationId: string,
    force: boolean,
  ): Promise<DraftRunResult> {
    const row = await this.load(userId, motivationId);
    if (!row) return { drafted: 0, failed: 0 };
    if (!EDITABLE.includes(row.status)) return { drafted: 0, failed: 0 };

    const answers = await this.shared.answersFor(userId, row.answersEncrypted);
    const provenance = parseProvenance(row.answerProvenance);

    /**
     * ⚠️ A MEMBER'S FIELD IS NEVER A TARGET — not even when it is empty. A
     * cleared field was stamped MEMBER by `changedKeys` (a clear is a decision
     * about the answer); drafting it again would be the system silently
     * correcting the member back, which is the one thing the provenance module
     * exists to prevent.
     */
    const targets = draftedFields(row.licenceType, answers)
      .filter((field) => {
        if (provenance[field.key]?.source === 'MEMBER') return false;
        const value = (answers[field.key] ?? '').trim();
        if (!value) return true;
        // A value only becomes a target again when the member asked us to
        // redraft, and only when WE wrote it.
        return force && provenance[field.key]?.source === 'DRAFTED';
      })
      .map(targetForField);

    if (!targets.length) {
      this.stalled.delete(motivationId);
      return { drafted: 0, failed: 0 };
    }

    const targetHash = targets.map((target) => target.key).sort().join(',');
    if (!force) {
      const last = this.lastAttemptAt.get(motivationId) ?? 0;
      if (Date.now() - last < COOLDOWN_MS) return { drafted: 0, failed: 0 };
      if (this.stalled.get(motivationId) === targetHash) {
        return { drafted: 0, failed: 0 };
      }
      this.lastAttemptAt.set(motivationId, Date.now());
    } else {
      this.stalled.delete(motivationId);
    }

    const documents = await this.loadDocuments(motivationId);
    const facts = draftFacts(row.licenceType, answers, documents);
    const allowTerms = draftAllowTerms(facts, targets);

    const accepted: Record<string, string> = {};
    let rejections: string[] = [];

    if (this.llm.isConfiguredFor(DRAFT_PURPOSE)) {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const reply = await this.callModel(
          row.licenceType,
          facts,
          targets,
          attempt === 0 ? [] : rejections,
        );
        rejections = [];
        for (const target of targets) {
          if (accepted[target.key]) continue;
          const raw = reply[target.key];
          if (raw === undefined || raw === '') continue;
          const issues = validateDraft(target.key, raw, {
            kind: target.kind,
            maxLength: target.maxLength,
            optionKeys: target.options?.map((option) => option.key),
            allowTerms,
          });
          if (issues.length) {
            rejections.push(`${target.key}: ${issues.join('; ')}`);
            continue;
          }
          accepted[target.key] = raw;
        }
        if (!rejections.length) break;
      }
    }

    /**
     * ⚠️ THE DETERMINISTIC HALF IS NOT OPTIONAL FOR TWO FIELDS. `missingDetail`
     * refuses to generate without a shooting history (every type) and a
     * continued-use paragraph (S24), and the interview no longer asks either —
     * so a model outage must still leave those two with a paragraph.
     */
    for (const target of targets) {
      if (accepted[target.key]) continue;
      const fallback = fallbackDraft(target.key, facts);
      if (fallback) accepted[target.key] = fallback;
    }

    const result = await this.persist(userId, row, accepted);
    const outcome: DraftRunResult = {
      drafted: result.drafted,
      failed: Math.max(0, targets.length - result.drafted),
    };
    if (outcome.drafted === 0) {
      this.stalled.set(motivationId, targetHash);
    } else {
      this.stalled.delete(motivationId);
    }
    return outcome;
  }

  /** One model call. Fail-soft: a provider failure is an empty map. */
  private async callModel(
    type: MotivationLicenceType,
    facts: DraftFacts,
    targets: readonly DraftedTarget[],
    rejections: readonly string[],
  ): Promise<Record<string, string>> {
    try {
      const res = await this.llm.complete({
        system: draftSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: draftUserPrompt({
              licenceLabel: LICENCE_TYPE_LABELS[type] ?? String(type),
              facts,
              targets,
              rejections,
            }),
          },
        ],
        maxTokens: DRAFT_MAX_TOKENS,
        temperature: DRAFT_TEMPERATURE,
        purpose: DRAFT_PURPOSE,
        json: { schema: DRAFT_SCHEMA },
        timeoutMs: DRAFT_TIMEOUT_MS,
      });
      return parseDraftReply(res.text);
    } catch (err) {
      this.logger.warn(
        `Narrative draft model call failed: ${(err as Error).message}`,
      );
      return {};
    }
  }

  /**
   * Merge the accepted drafts in, stamping DRAFTED + inferred.
   *
   * ⚠️ ONE UPDATE, AND ONLY FOR KEYS THAT WERE TARGETS. A key the model invents
   * is dropped by the caller; this method refuses one as well rather than trust
   * that.
   */
  private async persist(
    userId: string,
    row: DraftRow,
    values: Record<string, string>,
  ): Promise<DraftRunResult> {
    if (!Object.keys(values).length) {
      this.logger.log(`Motivation ${row.id}: nothing to draft`);
      return { drafted: 0, failed: 0 };
    }

    /**
     * ⚠️ RE-READ IMMEDIATELY BEFORE THE WRITE. The model call can take a
     * minute, and the member can save an answer in that window — the snapshot
     * this run started from is not evidence of what is on the row now. Writing
     * from the stale snapshot would be the "member edited it and the system
     * silently corrected it back" failure with a minute's delay.
     *
     * `readAnswers` (not `answersFor`) is used on purpose: it reads the
     * application blob only. Every drafted field is application-scoped, and a
     * profile value must not read as "already answered here".
     */
    const fresh = await this.prisma.motivation.findFirst({
      where: { id: row.id },
      select: { answersEncrypted: true, answerProvenance: true },
    });
    const answers = this.shared.readAnswers(fresh?.answersEncrypted ?? null);
    const provenance = parseProvenance(fresh?.answerProvenance);

    const merged = { ...answers };
    const written: string[] = [];
    for (const [key, value] of Object.entries(values)) {
      if (!value.trim()) continue;
      // The one invariant, repeated here because this is the write door.
      if (provenance[key]?.source === 'MEMBER') continue;
      /**
       * ⚠️ AND A VALUE THAT ARRIVED WHILE THE MODEL RAN IS NOT OURS TO REPLACE.
       * A non-empty value from any source other than our own DRAFTED one is a
       * real answer somebody wrote in the meantime; only an empty field or a
       * value we wrote ourselves (a forced re-draft) may be filled.
       */
      const current = (answers[key] ?? '').trim();
      if (current && provenance[key]?.source !== 'DRAFTED') continue;
      merged[key] = value;
      written.push(key);
    }
    if (!written.length) {
      this.logger.log(`Motivation ${row.id}: nothing to draft`);
      return { drafted: 0, failed: 0 };
    }

    const stamped = stamp(provenance, written, {
      source: 'DRAFTED',
      from: DRAFT_FROM,
      inferred: true,
    });
    await this.prisma.motivation.update({
      where: { id: row.id },
      data: {
        answersEncrypted: encryptJson(merged),
        answerProvenance: stamped as unknown as object,
      },
    });
    this.logger.log(
      `Motivation ${row.id}: drafted ${written.length} narrative answer(s)`,
    );
    return { drafted: written.length, failed: 0 };
  }

  // ── reads ───────────────────────────────────────────────────────────

  private async load(
    userId: string,
    motivationId: string,
  ): Promise<DraftRow | null> {
    const user = await this.shared.requireUser(userId);
    const row = await this.prisma.motivation.findFirst({
      where: { id: motivationId, userId: user.id },
      select: {
        id: true,
        licenceType: true,
        status: true,
        answersEncrypted: true,
        answerProvenance: true,
      },
    });
    return (row as DraftRow | null) ?? null;
  }

  /**
   * The attached documents as kind + label only.
   *
   * ⚠️ FAIL-SOFT. A file table that cannot be read costs the drafter its
   * knowledge of what the pack already proves — never the draft.
   */
  private async loadDocuments(
    motivationId: string,
  ): Promise<{ kind: string; label: string }[]> {
    try {
      const rows = await this.prisma.motivationUpload.findMany({
        where: { motivationId, purgedAt: null },
        select: { kind: true },
      });
      const seen = new Set<string>();
      const out: { kind: string; label: string }[] = [];
      for (const row of rows) {
        const kind = row.kind as MotivationUploadKind;
        if (seen.has(kind)) continue;
        seen.add(kind);
        out.push({
          kind: String(kind),
          label: UPLOAD_KIND_LABELS[kind] ?? String(kind),
        });
      }
      return out;
    } catch (err) {
      this.logger.warn(
        `Narrative draft ${motivationId}: could not read the document list — ${
          (err as Error).message
        }`,
      );
      return [];
    }
  }
}

/**
 * Read the drafts out of a model reply, tolerating prose around the JSON.
 *
 * `cards` targets return `choices`; a long target returns `text`. Either way
 * the value is joined to the stored shape, which is a plain string.
 */
export function parseDraftReply(text: string): Record<string, string> {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return {};
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return {};
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as {
      drafts?: Array<{ key?: unknown; text?: unknown; choices?: unknown }>;
    };
    const out: Record<string, string> = {};
    for (const draft of parsed.drafts ?? []) {
      const key = typeof draft.key === 'string' ? draft.key.trim() : '';
      if (!key) continue;
      if (Array.isArray(draft.choices) && draft.choices.length) {
        const choices = draft.choices
          .filter((choice): choice is string => typeof choice === 'string')
          .map((choice) => choice.trim())
          .filter(Boolean);
        if (choices.length) out[key] = choices.join(', ');
        continue;
      }
      if (typeof draft.text === 'string' && draft.text.trim()) {
        out[key] = draft.text.trim();
      }
    }
    return out;
  } catch {
    return {};
  }
}
