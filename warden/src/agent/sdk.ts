// warden/src/agent/sdk.ts
//
// THE ONLY FILE IN THIS DIRECTORY THAT KNOWS THE ANTHROPIC SDK EXISTS. Every
// other file speaks the small types in types.ts, which is what lets loop.ts,
// runner.ts, read-list.ts and detector.ts be tested with no key, no network
// and no SDK in the test process — the same reason diagnose/ has ModelCaller.
//
// 🚨 THE API KEY IS READ FROM ENV, HELD IN THE CLIENT, AND NEVER LOGGED, NEVER
// RETURNED, NEVER PUT IN A MESSAGE, A PROPOSAL OR A PROMPT. Rule 8, same as
// diagnose/client.ts. The error path goes through safeErrorText(), which
// redacts before truncating.
//
// ⚠️ NO SAMPLING PARAMETERS. temperature / top_p / top_k were removed from the
// API on the models this repo runs, and sending one returns a 400 that every
// caller here swallows — on 2026-08-19 that left four features silently doing
// nothing for two days. agent.test.ts greps this directory for the same three
// names, exactly as diagnose.test.ts does for its own.
//
// ⚠️ NON-BETA TOOLS. @anthropic-ai/sdk 0.32.1 carries `Tool`, `ToolUseBlock`
// and `tools` on the ordinary messages API (resources/messages.d.ts) — there
// is no beta namespace here and no dependency bump was needed for this phase.

import Anthropic from '@anthropic-ai/sdk';
import { safeErrorText, type ModelCaller, type ModelReply } from '../diagnose/index.js';
import type { DiagnosisInput } from '../diagnose/types.js';
import { toolSchemas } from './prompt-tools.js';
import { runAgentLoop, DEFAULT_CALL_TIMEOUT_MS, MAX_TOKENS, type AgentLoopOptions } from './loop.js';
import type { AgentMessage, AgentTurnCaller, AgentTurnRequest, AgentTurnReply, ToolCallRequest } from './types.js';
import type { ReadToolDeps } from './types.js';

const MODEL = process.env.ANTHROPIC_MODEL_WARDEN ?? process.env.ANTHROPIC_MODEL_JUDGE ?? 'claude-sonnet-4-6';

/** ⚠️ THE SAME ENV VAR diagnose/client.ts reads, on purpose: an operator
 *  raising the per-call timeout must not find it applies to one mode and not
 *  the other. The whole-loop budget is a separate var — see loop.ts. */
function callTimeoutMs(): number {
  return Number(process.env.WARDEN_MODEL_TIMEOUT_MS ?? DEFAULT_CALL_TIMEOUT_MS);
}

function loopBudgetMs(): number | undefined {
  const raw = Number(process.env.WARDEN_AGENT_BUDGET_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

/** Our small message shape into the SDK's. Kept here so nothing else in the
 *  directory has to import an SDK type. */
function toSdkMessages(messages: readonly AgentMessage[]): Anthropic.MessageParam[] {
  return messages.map((m): Anthropic.MessageParam => {
    if (m.role === 'assistant') {
      const blocks: Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam> = [];
      if (m.content.trim()) blocks.push({ type: 'text', text: m.content });
      for (const use of m.toolUses) {
        blocks.push({ type: 'tool_use', id: use.id, name: use.name, input: (use.input ?? {}) as Record<string, unknown> });
      }
      // An assistant turn with no blocks at all is rejected by the API. It
      // cannot happen — we only push an assistant turn when there was at least
      // one tool_use — but an empty array here would fail as a 400 that the
      // caller swallows into "the call failed", which is the shape of failure
      // this package keeps having to dig out of.
      if (blocks.length === 0) blocks.push({ type: 'text', text: '(no text)' });
      return { role: 'assistant', content: blocks };
    }
    if ('toolResults' in m) {
      return {
        role: 'user',
        content: m.toolResults.map(
          (r): Anthropic.ToolResultBlockParam => ({
            type: 'tool_result',
            tool_use_id: r.id,
            content: r.fenced,
            is_error: r.isError,
          }),
        ),
      };
    }
    return { role: 'user', content: m.content };
  });
}

function fromSdkReply(res: Anthropic.Message): AgentTurnReply {
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  const toolUses: ToolCallRequest[] = res.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));

  if (toolUses.length > 0) return { ok: true, turn: { text, toolUses, stop: 'tool_use' }, model: MODEL };
  if (!text) return { ok: false, reason: 'the model returned an empty reply' };
  return { ok: true, turn: { text, toolUses: [], stop: 'end' }, model: MODEL };
}

/** One turn against the real API. Exported for the composition root to wrap
 *  or replace; loop.ts only ever sees this signature. */
export function createSdkTurnCaller(client: Anthropic): AgentTurnCaller {
  return async (req: AgentTurnRequest): Promise<AgentTurnReply> => {
    try {
      const res = await client.messages.create(
        {
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: req.system,
          messages: toSdkMessages(req.messages),
          // ⚠️ The tools come from READ_LIST's own schemas. Withdrawing them
          // on the final turn is what makes a budget-exhausted loop end in a
          // diagnosis: with no tools in the request, `stop_reason` cannot be
          // tool_use and the model has to answer in text.
          ...(req.withTools ? { tools: toolSchemas() } : {}),
        },
        // Capped to what is left of the whole-loop wall clock. See loop.ts's
        // note on why a per-call timeout alone reproduces the 20s incident.
        { timeout: Math.max(5_000, Math.min(callTimeoutMs(), req.budgetMsRemaining)) },
      );
      return fromSdkReply(res);
    } catch (err) {
      return { ok: false, reason: safeErrorText(err) };
    }
  };
}

export interface AgentCallerOptions {
  deps: ReadToolDeps;
  budgetMs?: number;
  onEvent?: AgentLoopOptions['onEvent'];
}

/**
 * The tool-loop caller, shaped as a ModelCaller so it can be dropped in where
 * createAnthropicCaller() sits at the composition root — facts in, ONE final
 * text out, with the reads happening inside.
 *
 * Returns null when ANTHROPIC_API_KEY is unset, exactly as
 * createAnthropicCaller() does, so diagnose() raises its stable
 * `redgate_model_unavailable` rather than producing a silence that is
 * indistinguishable from a healthy box.
 *
 * ⚠️ NOTHING CALLS THIS YET. src/index.ts still builds the one-shot caller and
 * was not touched in this phase — see this directory's README note in
 * index.ts. Wiring it is one line at the composition root plus an env switch,
 * and it is deliberately left undone rather than done quietly: the one-shot
 * path is the rollback, and a rollback that was never the running state is not
 * a rollback.
 */
export function createAgentCaller(opts: AgentCallerOptions): ModelCaller | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey, timeout: callTimeoutMs(), maxRetries: 1 });
  const caller = createSdkTurnCaller(client);

  return async (input: DiagnosisInput): Promise<ModelReply> => {
    const result = await runAgentLoop(input, {
      caller,
      deps: opts.deps,
      budgetMs: opts.budgetMs ?? loopBudgetMs(),
      onEvent: opts.onEvent,
    });
    if (!result.ok) return { ok: false, reason: result.reason ?? 'the tool loop produced no answer' };
    return { ok: true, text: result.text, model: result.model ?? MODEL };
  };
}
