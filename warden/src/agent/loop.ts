// warden/src/agent/loop.ts
//
// THE TURN LOOP. Facts in, one final answer out — with a bounded number of
// fixed reads in the middle.
//
// ⚠️ ITS EXIT IS UNCHANGED. runAgentLoop() returns the model's FINAL TEXT and
// nothing else, and createAgentCaller() packages it as a ModelCaller — the
// exact seam diagnose/client.ts already declares, `(input: DiagnosisInput) =>
// Promise<ModelReply>`. That is deliberate and it is the whole reason this
// phase does not touch parse.ts, diagnose.ts or types.ts: the text still goes
// through parseDiagnosisReply's refuse-don't-coerce validation, still becomes
// a DraftedProposal, and a safe-list fix in it is still re-validated AND
// RE-BUILT at approve time by the executor from the operation name and args.
// Widening ModelCaller to express a loop would have rippled into the one layer
// whose entire job is refusing to be flexible.
//
// ⚠️ THREE BUDGETS, AND THE THIRD IS THE ONE THAT WAS MISSING.
// diagnose/client.ts carries a 🚨 about WARDEN_MODEL_TIMEOUT_MS having been
// 20s: every diagnosis hit it, came back as the SDK's "Request timed out.",
// and the board rendered "I could not reach Claude for this sweep" — a
// sentence that sent the reader to the network and the key, both of which were
// fine. The default is 90s now, PER CALL. A five-call loop is five of those
// plus the reads between them, so a per-call timeout alone brings that
// incident back wearing different clothes: a sweep that runs for minutes
// against a POST /chat that answers at 18s. So there is a WHOLE-LOOP wall
// clock as well, checked before every call and before every read, and the
// per-call timeout is capped to whatever is left of it.
//
// ⚠️ RUNNING OUT IS NOT AN ERROR. Every way this loop can end — the model
// answered, the turn cap, the wall clock — ends with ONE FINAL CALL WITH THE
// TOOLS WITHDRAWN, so the model has to answer in text. A board that goes
// silent because the model kept asking questions is the failure this whole
// daemon exists to refuse, and it would look exactly like a healthy box.

import { runReadTool } from './runner.js';
import { mergeSignals, type SignalClass } from './detector.js';
import { buildAgentSystemPrompt, buildAgentUserPrompt, buildFinalTurnPrompt } from './prompt-tools.js';
import type {
  AgentLoopEvent,
  AgentMessage,
  AgentTurnCaller,
  ReadToolDeps,
  ToolCallRequest,
  ToolCallResult,
} from './types.js';
import type { DiagnosisInput } from '../diagnose/types.js';

/** How many times the model may come back asking for reads before the tools
 *  are withdrawn. Four is a budget, not a target: the survey behind this phase
 *  found only four things the ~29 checks genuinely do not already measure, and
 *  a loop that spends turns re-reading fenced facts is spending money to learn
 *  what it was told. */
export const MAX_TOOL_TURNS = 4;

/** Per turn. A model that wants five reads at once is usually casting about
 *  rather than following a thread; the refusal names the cap so it can pick
 *  the three it actually wants. */
export const MAX_CALLS_PER_TURN = 3;

/** The whole loop's wall clock. Generous enough for four turns of a real
 *  diagnosis plus their reads; hard enough that a sweep cannot run for
 *  minutes. Override with WARDEN_AGENT_BUDGET_MS. */
export const DEFAULT_LOOP_BUDGET_MS = 240_000;

/** Per model call, matching diagnose/client.ts's own default and its env var
 *  so the two modes cannot be tuned apart by accident. ⚠️ Capped to the
 *  remaining whole-loop budget at every call site. */
export const DEFAULT_CALL_TIMEOUT_MS = 90_000;

/** Enough for the final answer: the same ceiling diagnose/client.ts uses, and
 *  a diagnosis is a handful of short items whatever mode produced it. */
export const MAX_TOKENS = 4_096;

export interface AgentLoopOptions {
  caller: AgentTurnCaller;
  deps: ReadToolDeps;
  budgetMs?: number;
  maxToolTurns?: number;
  maxCallsPerTurn?: number;
  /** Injectable clock. Tests pin it; production omits it and gets Date.now. */
  monotonicNow?: () => number;
  /**
   * 🚨 THE STRUCTURAL PATH FOR AN INJECTION NOTE, AND IT IS UNWIRED TODAY.
   * A ModelReply carries text and nothing else, so a detector signal cannot
   * reach the Desk thread through the return value without widening the seam
   * this file exists to avoid widening. This callback is how a composition
   * root persists a 'note' message for it. Until something at the composition
   * root passes it, the guaranteed-in-thread path does not exist and the only
   * thing carrying an injection attempt to a human is the model's own red_gate
   * item — which buildFinalTurnPrompt() asks for explicitly, and which is
   * prompting rather than structure. Said plainly here rather than implied by
   * an optional parameter.
   */
  onEvent?: (event: AgentLoopEvent) => void;
}

export interface AgentLoopResult {
  ok: boolean;
  /** The model's final text, for parseDiagnosisReply. Empty when `ok` is
   *  false. */
  text: string;
  model: string | null;
  reason: string | null;
  event: AgentLoopEvent;
}

export async function runAgentLoop(input: DiagnosisInput, opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const now = opts.monotonicNow ?? (() => Date.now());
  const startedAt = now();
  const budgetMs = opts.budgetMs ?? DEFAULT_LOOP_BUDGET_MS;
  const maxTurns = opts.maxToolTurns ?? MAX_TOOL_TURNS;
  const maxPerTurn = opts.maxCallsPerTurn ?? MAX_CALLS_PER_TURN;
  const remaining = (): number => Math.max(0, budgetMs - (now() - startedAt));

  const system = buildAgentSystemPrompt();
  const messages: AgentMessage[] = [{ role: 'user', content: buildAgentUserPrompt(input) }];

  const allSignals: SignalClass[][] = [];
  const allRedactions: string[] = [];
  /** ⚠️ THE REPEAT GUARD. Keyed on name + the JSON of the validated-shaped
   *  input, so the same read asked for twice comes back as a sentence saying
   *  so rather than as a second execution. Without it a model that reads a
   *  result as inconclusive will re-issue the identical call until the turn
   *  cap, spending the whole budget learning nothing. */
  const alreadyRun = new Map<string, number>();
  let turns = 0;
  let toolCalls = 0;
  let model: string | null = null;

  const finish = (ended: AgentLoopEvent['ended'], result: Omit<AgentLoopResult, 'event'>): AgentLoopResult => {
    const event: AgentLoopEvent = {
      turns,
      toolCalls,
      signals: mergeSignals(allSignals),
      redactions: [...new Set(allRedactions)],
      ended,
    };
    opts.onEvent?.(event);
    return { ...result, event };
  };

  let ending: 'turn-cap' | 'time-budget' | null = null;

  for (;;) {
    if (turns >= maxTurns) {
      ending = 'turn-cap';
      break;
    }
    if (remaining() <= 0) {
      ending = 'time-budget';
      break;
    }

    turns += 1;
    const reply = await opts.caller({ system, messages, withTools: true, budgetMsRemaining: remaining() });
    if (!reply.ok) {
      // A failed call is not a red gate — diagnose.ts turns this into a
      // 'note', because a timeout or a 529 clears itself on the next sweep.
      // What it must never become is silence.
      return finish('failed', { ok: false, text: '', model, reason: reply.reason });
    }
    model = reply.model;

    if (reply.turn.stop !== 'tool_use' || reply.turn.toolUses.length === 0) {
      // The model answered. Its text goes to parseDiagnosisReply unchanged.
      return finish('answered', { ok: true, text: reply.turn.text, model, reason: null });
    }

    messages.push({ role: 'assistant', content: reply.turn.text, toolUses: reply.turn.toolUses });

    const results: ToolCallResult[] = [];
    for (const [index, call] of reply.turn.toolUses.entries()) {
      if (index >= maxPerTurn) {
        results.push(capRefusal(call, `Warden runs at most ${maxPerTurn} reads per turn. This one was not run; ask for it again next turn if you still want it.`));
        continue;
      }
      if (remaining() <= 0) {
        results.push(capRefusal(call, 'This sweep ran out of time before this read could run. Answer with what you have.'));
        continue;
      }
      const key = repeatKey(call);
      const seenAt = alreadyRun.get(key);
      if (seenAt !== undefined) {
        results.push(
          capRefusal(call, `You already ran this exact read on turn ${seenAt} and its result is above. It was not run again — re-reading it would return the same thing.`),
        );
        continue;
      }
      alreadyRun.set(key, turns);
      toolCalls += 1;
      const result = await runReadTool(call, { deps: opts.deps, sequence: toolCalls });
      allSignals.push(result.signals as SignalClass[]);
      allRedactions.push(...result.redactions);
      results.push(result);
    }

    messages.push({ role: 'user', toolResults: results });
  }

  // ── the final turn, tools withdrawn ───────────────────────────────────
  //
  // Reached only by running out of turns or out of time. The tools are gone
  // from the request, so `stop` cannot be 'tool_use' and the model has to
  // answer. ⚠️ It gets its own small allowance even when the wall clock is
  // already spent: the alternative to an over-budget final call is no
  // diagnosis at all, and "Warden went quiet" is the one outcome worse than
  // "Warden took twenty seconds longer than it promised".
  const signals = mergeSignals(allSignals);
  messages.push({ role: 'user', content: buildFinalTurnPrompt(signals, ending ?? 'turn-cap') });

  const final = await opts.caller({
    system,
    messages,
    withTools: false,
    budgetMsRemaining: Math.max(remaining(), FINAL_TURN_FLOOR_MS),
  });
  if (!final.ok) return finish('failed', { ok: false, text: '', model, reason: final.reason });
  model = final.model;
  return finish(ending ?? 'turn-cap', { ok: true, text: final.turn.text, model, reason: null });
}

/** The allowance the final call gets even when the whole-loop clock is spent.
 *  See the note above the final turn. */
export const FINAL_TURN_FLOOR_MS = 30_000;

function repeatKey(call: ToolCallRequest): string {
  let shape: string;
  try {
    shape = JSON.stringify(call.input ?? null);
  } catch {
    // A circular or otherwise unserialisable input is not a repeat of
    // anything; treating it as unique is the safe way to be wrong here.
    shape = `unserialisable:${Math.random()}`;
  }
  return `${call.name}::${shape}`;
}

/**
 * A refusal produced by the LOOP rather than by a tool — a cap, a repeat, an
 * exhausted clock. It is fenced the same way a tool's own refusal is, so
 * nothing reaches the model through a channel that skipped the fence.
 */
function capRefusal(call: ToolCallRequest, reason: string): ToolCallResult {
  return {
    id: call.id,
    fenced: `<<<WARDEN_DATA id="tool.${call.name.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 40)}.not-run">>>\nsource: Warden did not run this read. This is Warden's own text, not data from the box.\n---\n${reason}\n<<<END_WARDEN_DATA id="tool.${call.name.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 40)}.not-run">>>`,
    isError: true,
    signals: [],
    redactions: [],
  };
}
