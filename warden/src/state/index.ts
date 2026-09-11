// warden/src/state/index.ts
//
// What Warden remembers and what it does with it, for the HTTP surface and
// the composition root. server.ts imports WardenCore and nothing else from
// here; index.ts builds one.

// ⚠️ NO `GateRow` HERE. The board-row type is `WardenCheckRow` in types.ts,
// where the backend's mirror test can see it; the alias this file used to
// re-export had no importer anywhere in the repo and only kept the old name
// findable. Import WardenCheckRow.
export { WardenCore, type CoreOptions, type CoreResult, type CoreFailure, type CoreMessages } from './core.js';
export {
  WardenStore,
  faultKeyFor,
  WIRE_MESSAGE_LIMIT,
  WIRE_PROPOSAL_LIMIT,
  WIRE_AUDIT_LIMIT,
  type StoredProposal,
  type StandingInstruction,
  type StoreOptions,
} from './store.js';
export {
  projectMessage,
  projectProposal,
  findingMessage,
  fixedMessage,
  ranMessage,
  startedMessage,
  declinedMessage,
  standingList,
  operatorSaid,
  note,
  newMessageId,
  projectAudit,
} from './messages.js';
