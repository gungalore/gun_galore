// warden/src/diagnose/index.ts
//
// The diagnosis layer's front door, for the daemon's sweep loop and its
// POST /chat handler. Two things get imported from here in practice:
// createAnthropicCaller() once at boot (null when no key), and diagnose()
// per turn.
//
// ⚠️ diagnose() RETURNS RECORDS, NOT ACTIONS. Storing them, rendering them,
// and — only after an operator approves one — running one, are the store's,
// the HTTP surface's and executor.ts's jobs respectively. Nothing here runs.

export { diagnose, type DiagnoseOptions } from './diagnose.js';
export { createAnthropicCaller, describeModelConfig, safeErrorText, type ModelCaller, type ModelReply } from './client.js';
export { parseDiagnosisReply, type ParseOutcome, type ValidatedItem } from './parse.js';
export { buildSystemPrompt, buildUserPrompt, operationMenu, checkToFact } from './prompt.js';
export { FENCE_RULE, buildFactsSection, fenceBlock, fenceScalar, sanitizeScalar, type Fact } from './fence.js';
export type {
  DiagnosedCheck,
  DiagnosisInput,
  DiagnosisResult,
  DraftedMessage,
  DraftedProposal,
  DraftedProposalKind,
  OpenProposalSummary,
  Refusal,
  WardenMessageKind,
  WardenRecheck,
} from './types.js';
export { PROPOSAL_ID_RE, WARDEN_MESSAGE_KINDS } from './types.js';
