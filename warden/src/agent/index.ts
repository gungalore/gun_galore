// warden/src/agent/index.ts
//
// THE READ-ONLY TOOL LOOP's front door.
//
// 🚨 NOTHING IMPORTS THIS YET, AND THAT IS STATED RATHER THAN IMPLIED.
// src/index.ts — the composition root — still builds createAnthropicCaller()
// from diagnose/, and it was not touched in this phase because the one-shot
// path is the rollback and the tool loop is the new thing. An unwired module
// reported as shipped is the failure this repo already has once, in the
// runSafeListOperation() that existed before anything called it, so:
//
//   WHAT WIRING IT WOULD TAKE, exactly:
//     1. in src/index.ts, build the deps the loop needs — the CheckContext
//        already constructed there (`createSystemContext({ config })`) and
//        ALL_CHECKS from checks/index.js;
//     2. choose the caller by env, so the one-shot path stays the rollback
//        with no deploy — the LLM_PROVIDER pattern this repo already uses:
//          const caller = process.env.WARDEN_AGENT_TOOLS === '1'
//            ? createAgentCaller({ deps: { ctx, checks: ALL_CHECKS } })
//            : createAnthropicCaller();
//     3. pass an `onEvent` that persists a 'note' message when
//        `event.signals` is non-empty — see loop.ts's 🚨 on why that callback
//        is the only STRUCTURAL path for an injection attempt to reach the
//        Desk thread, and why the red_gate the model is asked to raise is
//        prompting rather than structure;
//     4. say in the boot banner which mode is running, for the same reason
//        the banner already prints every resolved path: "which mode did it
//        actually diagnose in" must be answerable from the log.
//
//   WHAT IS UNPROVEN UNTIL THEN: every test in this directory drives the loop
//   through a scripted AgentTurnCaller and every read through
//   checks/testing.ts's fake world. No tool in this list has been run against
//   a real box, and no model has been asked to choose one. The gate is a
//   typecheck, this directory's own suite and a red-watch over each pin — not
//   a sweep on the live box.
//
//   ⚠️ THE TEST COUNT THAT USED TO SIT IN THAT SENTENCE ("34 new tests") WAS
//   ALREADY WRONG. The directory's suite had grown past it and nothing said
//   so, which is the same drift the generated operation menu and the
//   schema-from-the-frozen-tuple discipline exist to prevent — a number in
//   prose has no gate. `npx tsx --test src/agent/*.test.ts` is the answer and
//   it cannot go stale.

export {
  READ_LIST,
  READ_COMMANDS,
  NAMED_QUERIES,
  FILE_IDS,
  QUERY_IDS,
  TAIL_DEPTHS,
  DU_DIRS,
  LS_DIRS,
  fileTargets,
  findReadTool,
  findReadCommand,
  findCheckById,
  describeReadPlan,
  type FileId,
  type QueryId,
  type TailDepth,
  type NamedQuery,
  type ReadCommand,
} from './read-list.js';

export { runReadTool, MAX_TOOL_OUTPUT_BYTES, type RunReadToolOptions } from './runner.js';

export { detectInjection, annotate, mergeSignals, SIGNAL_CLASSES, type SignalClass } from './detector.js';

export {
  buildAgentSystemPrompt,
  buildAgentUserPrompt,
  buildFinalTurnPrompt,
  readMenu,
  toolSchemas,
  TOOL_FENCE_RULE,
  TOOL_RULES,
} from './prompt-tools.js';

export {
  runAgentLoop,
  MAX_TOOL_TURNS,
  MAX_CALLS_PER_TURN,
  DEFAULT_LOOP_BUDGET_MS,
  DEFAULT_CALL_TIMEOUT_MS,
  FINAL_TURN_FLOOR_MS,
  MAX_TOKENS,
  type AgentLoopOptions,
  type AgentLoopResult,
} from './loop.js';

export { createAgentCaller, createSdkTurnCaller, type AgentCallerOptions } from './sdk.js';

export type {
  AgentAssistantTurn,
  AgentLoopEvent,
  AgentMessage,
  AgentTurnCaller,
  AgentTurnReply,
  AgentTurnRequest,
  ReadPlan,
  ReadTool,
  ReadToolDeps,
  ReadValidation,
  ToolCallRequest,
  ToolCallResult,
} from './types.js';
