// warden/src/exec/index.ts
//
// The public face of the execution layer, for the sibling modules (the checks
// engine, the store, the HTTP surface, the diagnosis layer). ⚠️ Nothing outside
// this directory may import node:child_process, and nothing outside it may
// build an ExecPlan of kind 'shell' — the two entry points below are the whole
// contract for making something happen on the box.

export {
  runSafeListOperation,
  runApprovedProposal,
  assertNotObviouslyDestructive,
  createRuntime,
  type ExecutableProposal,
  type ExecutionOutcome,
  type ExecutionRequest,
  type ExecRuntime,
  type RefusalCode,
} from './executor.js';

export {
  SAFE_LIST,
  findSafeListOperation,
  LOG_FILES,
  LOG_IDS,
  PM2_PROCESSES,
  type BuiltOperation,
  type LogId,
  type Pm2Process,
  type SafeListOperation,
  type ValidationResult,
} from './safe-list.js';

export {
  prepareOutput,
  redactSecrets,
  truncateOutput,
  MAX_OUTPUT_BYTES,
  type TruncatedText,
  type WardenAuditRecord,
} from './audit.js';

export { describePlan, type ExecPlan, type RunOutcome } from './proc.js';
