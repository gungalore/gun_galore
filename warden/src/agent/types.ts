// warden/src/agent/types.ts
//
// The shapes of the READ-ONLY TOOL LOOP. Read this file before read-list.ts:
// the invariant the whole directory defends is a property of THESE TYPES, not
// of anybody's discipline.
//
// 🚨 THE INVARIANT:
//   there is no code path from the model's tokens to an argv that skips
//   validate(), and no path to a shell that does not go through an operator
//   reading the exact string.
//
// How each half is made true here rather than asserted:
//
//   · ReadPlan HAS NO SHELL ARM. exec/proc.ts's ExecPlan has three kinds and
//     one of them is `shell`; this one has four and none of them is. A read
//     tool cannot build a shell plan because there is no shell plan for it to
//     build — the failure is a type error at the only moment it is cheap,
//     rather than a runtime assertion somebody has to remember to keep. (The
//     runtime assertion exists too, in read-list.test.ts, because a `kind`
//     string can be widened by an edit that also widens the type.)
//
//   · EVERY argv element in an `argv` plan is written by read-list.ts. The
//     model supplies a NAME and, at most, a VALUE FROM A FROZEN TUPLE THAT
//     FILE DEFINES. Where a plan needs a number (a tail length) the number is
//     a CONSTANT in that file selected by an enum KEY — the AGE_INTERVAL
//     pattern from exec/safe-list.ts, copied deliberately.
//
//   · THE ONE EXCEPTION IS NAMED RATHER THAN HIDDEN: tail_log's `contains` is
//     free text the model composes. It never reaches an argv, a path, a
//     regular expression or a line of SQL — it is consumed by
//     String.prototype.includes() inside this package and nothing else. That
//     is written into ReadPlan's `contains` field docs and pinned by a test,
//     because a free-text argument is exactly the thing a later reader will
//     assume may be passed along to grep.
//
//   · NOTHING HERE SPAWNS ANYTHING. Every plan is executed through
//     CheckContext — the same injected keyhole the ~29 checks use, whose
//     `run()` is execFile with an argv ARRAY and no `/bin/sh -c` anywhere in
//     its path. The agent layer therefore adds ZERO new spawn sites to a
//     package whose own proc.ts already admits to having two. agent.test.ts
//     asserts structurally that no file in this directory names
//     child_process, execFile, spawn(, runSafeListOperation or
//     runApprovedProposal.

import type { CheckContext, CheckModule } from '../types.js';

// ── plans ───────────────────────────────────────────────────────────────────

/**
 * What a validated tool selection turns into.
 *
 * ⚠️ There is no `shell` arm and there must never be one. See the header. The
 * four kinds map one-to-one onto the four ways this layer is allowed to touch
 * the box, and every one of them goes through CheckContext:
 *
 *   argv    — ctx.run(file, argv[]) for one of READ_COMMANDS' fixed commands
 *   file    — ctx.readFile(path) for one of FILE_IDS' fixed paths
 *   query   — ctx.queryDb(sql) with a SQL literal built at module scope
 *   recheck — engine.runOne(check, ctx) for one registered check
 */
export type ReadPlan =
  | { kind: 'argv'; file: string; argv: string[]; timeoutMs: number }
  | {
      kind: 'file';
      path: string;
      maxBytes: number;
      /**
       * WHICH SLICE OF THE FILE TO RETURN, 1-based.
       *
       * ⚠️ THE TOOL DOES NOT RETURN A FILE WHOLE AND MUST NOT SAY IT DOES.
       * Its result is capped at MAX_TOOL_OUTPUT_BYTES (5,000), which is under
       * fence.ts's MAX_BLOCK_LEN so exactly one cut can apply — and three of
       * the six configured ids are bigger than that on the production box
       * (nginx.conf ~15KB, backup.sh ~11KB, ecosystem.config.js ~8.5KB). A
       * single-slice read of any of them drops the part each file is on the
       * list FOR. So the model picks a part, the same way it picks a tail
       * depth: the NUMBER is a constant in read-list.ts selected by an enum
       * key, never arithmetic on anything the model sent.
       */
      part: number;
      /** Bytes per part. A constant in read-list.ts, sized so one part plus
       *  its own header stays under MAX_TOOL_OUTPUT_BYTES. */
      partBytes: number;
      /** How many parts read-list.ts's enum can reach. A file needing more
       *  than this has a tail no part can name, and runner.ts says so in the
       *  last reachable part rather than letting it read as the end. */
      maxParts: number;
    }
  | {
      kind: 'tail';
      /** `tail`. The whole argv is assembled in read-list.ts — the path comes
       *  from LOG_FILES by a key that already passed requireEnum, and the line
       *  count is a CONSTANT in that file selected by an enum key, never a
       *  number the model sent. runner.ts adds nothing to it. */
      file: string;
      argv: string[];
      /**
       * ⚠️ THE ONE FREE-TEXT ARGUMENT IN THE WHOLE REGISTRY, and the only
       * place a reader has to know what is NOT done with it. It is applied as
       * a plain String.prototype.includes() over text this package already
       * holds in memory. It is NOT passed to grep, NOT compiled to a RegExp,
       * NOT interpolated into an argv, a path or a line of SQL. A model
       * -supplied regular expression would be both a CPU denial-of-service
       * (catastrophic backtracking on a 5,000-line log tail) and an unbounded
       * matcher over already-redacted text; a substring is neither.
       *
       * ⚠️ IT IS ECHOED BACK, THOUGH — INTO THE RESULT BODY AND INTO THE
       * FENCE'S OWN `source:` HEADER, through describeReadPlan(). The body has
       * always been neutralised by the fencer; the HEADER was not, so a
       * `contains` shaped like a fence marker landed inside the open marker
       * and the forged-marker counter, which reads the body's count, saw
       * nothing. runner.ts neutralises and counts both now. The narrow rule
       * that survives: free text that never reaches an argv can still reach
       * the PROMPT, and the prompt is a boundary too.
       */
      contains: string | null;
      timeoutMs: number;
    }
  | { kind: 'query'; sql: string; columns: readonly string[]; maxRows: number; timeoutMs: number }
  | { kind: 'recheck'; checkId: string };

export type ReadValidation<Args> = { ok: true; args: Args } | { ok: false; error: string };

/**
 * JSON Schema for one tool, as the Anthropic tools API wants it.
 *
 * ⚠️ Declared here rather than imported from the SDK so that read-list.ts and
 * prompt-tools.ts stay SDK-free — src/agent/sdk.ts is the only file in this
 * directory that knows the SDK exists, which is what lets every other test in
 * here run with no key, no network and no SDK in the process.
 *
 * ⚠️ `additionalProperties: false` is set on every schema in read-list.ts and
 * it is NOT the gate. It is the API declining a malformed call before it costs
 * a turn; the gate is that tool's own validate(), which refuses extra keys
 * rather than ignoring them and runs whether or not the API bothered.
 */
export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  /** The SDK's own InputSchema carries an index signature; without one here
   *  the two are structurally incompatible and `tools:` will not typecheck.
   *  It is not an invitation to put anything else in a schema — read-list.ts
   *  builds all five from enumSchema() or a literal. */
  [key: string]: unknown;
}

/**
 * One read tool. Deliberately the same shape as exec/safe-list.ts's
 * SafeListOperation minus the two fields a read has no use for:
 *
 *   · no `reversible` — a read changes nothing, so the field would be a
 *     constant `true` that a later reader might mistake for a decision.
 *   · no `cooldownMs` — the loop's own per-turn and per-loop budgets bound
 *     repetition, and a cooldown that silently refused a read would look to
 *     the model exactly like a read that found nothing.
 *
 * and plus `schema`, which is the same enum rendered for the Anthropic tools
 * API. ⚠️ `schema` and `validate` MUST be built from the same frozen tuple —
 * never from two lists — or the published enum drifts from the gate, which is
 * the failure diagnose/prompt.ts's probeArguments() exists to make impossible
 * on the write side.
 */
export interface ReadTool<Args = unknown> {
  name: string;
  summary: string;
  /** The reviewable case for why this may run unattended. A read is not
   *  self-evidently safe: it can leak. This is where that argument lives. */
  reasoning: string;
  /** JSON Schema for the Anthropic tools API, built from the SAME constants
   *  validate() checks against. */
  schema(): ToolInputSchema;
  /** Never throws. A malformed selection is data a model can get wrong, not a
   *  crash — same contract as SafeListOperation.validate. */
  validate(raw: unknown): ReadValidation<Args>;
  build(args: Args, deps: ReadToolDeps): ReadPlan;
}

/** Everything a read tool needs from the outside world, injected. There is no
 *  module-scope `process` or `fs` anywhere in this directory: the box reaches
 *  this layer only through CheckContext. */
export interface ReadToolDeps {
  ctx: CheckContext;
  /** The registry, injected rather than imported, so a test can hand the loop
   *  three checks instead of twenty-nine. */
  checks: readonly CheckModule[];
}

// ── one executed tool call ──────────────────────────────────────────────────

export interface ToolCallRequest {
  /** The model's own id for this call — echoed back on the tool_result block
   *  so the two cannot be paired up wrongly. */
  id: string;
  name: string;
  input: unknown;
}

export interface ToolCallResult {
  id: string;
  /**
   * What goes back to the model, ALREADY redacted, truncated and fenced.
   * Never raw output — there is no path in runner.ts from a command's stdout
   * to this field that skips prepareOutput().
   */
  fenced: string;
  /** True for a refusal (bad name, bad argument, plan failed). Sent as the
   *  tool_result block's `is_error`, so the model can pick again rather than
   *  reading a refusal as a measurement. */
  isError: boolean;
  /** Pattern CLASSES the detector matched — names only, never the matched
   *  text, and never a reason to strip anything. Empty when nothing fired. */
  signals: string[];
  /** Names of what redactSecrets() blanked, same contract as the audit
   *  record's: always present, empty when nothing fired. */
  redactions: string[];
}

// ── the conversation, expressed without the SDK ─────────────────────────────
//
// These exist so loop.ts can be tested with no key, no network and no SDK in
// the test process — the same reason diagnose/ has ModelCaller. The SDK's own
// types appear in exactly one file (sdk.ts), which is the adapter.

export interface AgentAssistantTurn {
  text: string;
  toolUses: ToolCallRequest[];
  /** 'tool_use' means the model wants a read; 'end' means it answered. */
  stop: 'tool_use' | 'end';
}

export type AgentTurnReply = { ok: true; turn: AgentAssistantTurn; model: string } | { ok: false; reason: string };

export interface AgentTurnRequest {
  system: string;
  messages: AgentMessage[];
  /** False on the FINAL turn: the tools are withdrawn so the model has to
   *  answer in text. A loop that ran out of budget must still produce a
   *  diagnosis — a board that goes silent because the model kept asking is
   *  the failure this daemon exists to refuse. */
  withTools: boolean;
  /** Milliseconds left in the whole-loop budget at the moment of the call.
   *  The adapter caps the per-call timeout to it. */
  budgetMsRemaining: number;
}

export type AgentMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolUses: ToolCallRequest[] }
  | { role: 'user'; toolResults: ToolCallResult[] };

export type AgentTurnCaller = (req: AgentTurnRequest) => Promise<AgentTurnReply>;

/** What the loop tells the daemon about itself, once, when it finishes.
 *  ⚠️ NOT part of ModelReply — see loop.ts's note on why the thread note for
 *  an injection attempt needs this wired at the composition root. */
export interface AgentLoopEvent {
  turns: number;
  toolCalls: number;
  /** Union of every detector signal across the loop. Names only. */
  signals: string[];
  /** Union of every redaction label across the loop. Names only. */
  redactions: string[];
  /** Why the loop stopped: the model answered, or a budget ended it. */
  ended: 'answered' | 'turn-cap' | 'time-budget' | 'failed';
}
