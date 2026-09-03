// warden/src/checks/registry.ts
//
// Every check Warden knows about, in board order. This list IS the answer
// to "what does Warden measure" — if a thing an operator cares about is
// not here, the honest answer to a question about it is "nothing measures
// that", not silence. The engine emits one row per entry in this array
// every sweep, including for checks that have never run, so a check cannot
// quietly drop off the board.

import type { CheckModule } from '../types.js';
import { hostChecks } from './host.js';
import { tlsChecks } from './tls.js';
import { nginxChecks } from './nginx.js';
import { pm2Checks } from './pm2.js';
import { databaseChecks } from './database.js';
import { backupChecks } from './backups.js';
import { envChecks } from './env-manifest.js';
import { cronChecks } from './cron.js';
import { channelChecks } from './channels.js';
import { appChecks } from './app.js';

export const ALL_CHECKS: readonly CheckModule[] = [
  ...hostChecks,
  ...tlsChecks,
  ...nginxChecks,
  ...pm2Checks,
  ...databaseChecks,
  ...backupChecks,
  ...envChecks,
  ...cronChecks,
  ...channelChecks,
  ...appChecks,
];

/** Duplicate ids would silently overwrite each other in the engine's
 *  memory map — one check's result standing in for another's is a lie the
 *  board could not show. Cheap to assert at module load, so it is. */
const seen = new Set<string>();
for (const check of ALL_CHECKS) {
  if (seen.has(check.id)) throw new Error(`duplicate check id: ${check.id}`);
  seen.add(check.id);
}

export function findCheck(id: string): CheckModule | null {
  return ALL_CHECKS.find((c) => c.id === id) ?? null;
}
