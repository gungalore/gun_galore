// warden/src/state/index.ts
//
// What Warden remembers and what it does with it, for the HTTP surface and
// the composition root. server.ts imports WardenCore and nothing else from
// here; index.ts builds one.

export { WardenCore, type CoreOptions, type CoreResult, type CoreFailure, type CoreMessages, type GateRow } from './core.js';
export {
  WardenStore,
  faultKeyFor,
  WIRE_MESSAGE_LIMIT,
  WIRE_PROPOSAL_LIMIT,
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
} from './messages.js';
