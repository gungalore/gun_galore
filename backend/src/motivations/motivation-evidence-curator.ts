import { createHash } from 'node:crypto';
import { MotivationLicenceType } from '@prisma/client';
import { BODY_DOCUMENT_KINDS } from './motivation-checklist';
import { containerById, type EvidenceGroup } from './evidence-taxonomy';
import { suitabilityPurpose } from './motivation-suitability';

// ────────────────────────────────────────────────────────────────────
// WHICH FOUR BODY ITEMS GO IN THE PACK.
//
// Operator, 2026-10-28: "it should be dynamic. but max of 4 photos. the picker
// must identify and choose the most appropriate for the application."
//
// The pack has one 2x2 Activities / Evidence block. This decides which four
// items fill it, using the application's purpose and the container each file
// was already placed in. It is deterministic and testable; the model is not
// asked to re-classify anything here.
//
// ⚠️ EVIDENCE NEVER TAKES AN ANNEXURE LETTER. This only chooses the body four.
// ────────────────────────────────────────────────────────────────────

export const EVIDENCE_SELECTION_VERSION = '2026-10-28a';
export const EVIDENCE_BODY_SLOTS = 4;

export interface CuratorUpload {
  id: string;
  kind: string;
  evidenceType?: string | null;
  /** Decrypted member description, if any. */
  description?: string | null;
  mimeType?: string | null;
}

export interface EvidenceSelection {
  version: string;
  selected: { id: string; why: string }[];
  leftOut: { id: string; why: string }[];
}

const HUNTING = new Set([
  'HUNTING_PHOTO',
  'HUNTING_TROPHY_PHOTO',
  'HUNTING_CAMP_PHOTO',
  'TRAIL_CAM_PHOTO',
  'HUNTING_DOG_PHOTO',
  'MEAT_PROCESSING_PHOTO',
  'MOUNT_OR_SKIN_PHOTO',
  'HUNTING_CLUB_PHOTO',
  'HUNTING_INVITATION',
  'FARM_PERMISSION_LETTER',
  'HUNTING_PERMIT',
  'HUNTING_REGISTER_ENTRY',
  'GAME_DONATION_RECEIPT',
]);

const SPORT = new Set([
  'RANGE_PHOTO',
  'TARGET_PHOTO',
  'CLUB_SHOOT_PHOTO',
  'TROPHY_AWARD_PHOTO',
  'TEAM_PHOTO',
  'CLAY_PIGEON_PHOTO',
  'DISCIPLINE_SPECIALITY',
  'SCORE_SHEET',
  'COMPETITION_RESULT',
  'RANGE_REGISTER',
  'MATCH_PROGRAMME',
  'RANGE_MEMBERSHIP_PROOF',
  'RELOADING_LOG',
  'BALLISTIC_TABLE',
  'CHRONOGRAPH_RESULT',
]);

const SELF_DEFENCE = new Set([
  'BREAK_IN_PHOTO',
  'DAMAGE_PHOTO',
  'CCTV_STILL',
  'ARMED_RESPONSE_REPORT',
  'REPAIR_QUOTE',
  'STOLEN_ITEMS_LIST',
  'NEWS_REPORT',
  'NEIGHBOUR_STATEMENT',
  'SECURITY_GATE_PHOTO',
  'ELECTRIC_FENCE_PHOTO',
  'RURAL_SECURITY_PHOTO',
  'RESIDENCE_PHOTO',
  'SAFE_ANCHORING_PHOTO',
  'ALARM_CERTIFICATE',
  'SAFE_INVOICE',
  'SAFE_SPEC_SHEET',
]);

/** The body document kinds and what they are worth for each purpose. */
function bodyKindScore(kind: string, purpose: string): number {
  if (!BODY_DOCUMENT_KINDS.has(kind as never)) return -1;
  if (purpose === 'self-defence') {
    if (kind === 'INCIDENT_REPORT') return 90;
    if (kind === 'CHARACTER_REFERENCE') return 40;
    if (kind === 'SHOOTING_ACTIVITY_LOG') return 20;
    return 10;
  }
  if (purpose === 'hunting') {
    if (kind === 'SHOOTING_ACTIVITY_LOG') return 70;
    if (kind === 'CHARACTER_REFERENCE') return 30;
    if (kind === 'INCIDENT_REPORT') return 10;
    return 10;
  }
  if (purpose === 'sport') {
    if (kind === 'SHOOTING_ACTIVITY_LOG') return 80;
    if (kind === 'CHARACTER_REFERENCE') return 30;
    if (kind === 'INCIDENT_REPORT') return 10;
    return 10;
  }
  return 20;
}

function groupOf(containerId: string | null | undefined): EvidenceGroup | null {
  return containerId ? containerById(containerId)?.group ?? null : null;
}

function score(
  upload: CuratorUpload,
  purpose: string,
  index: number,
): { score: number; why: string; group: EvidenceGroup | null } {
  const bodyKind = bodyKindScore(upload.kind, purpose);
  if (bodyKind >= 0) {
    return {
      score: bodyKind,
      why:
        upload.kind === 'INCIDENT_REPORT'
          ? 'the incident report supports the risk this application describes'
          : upload.kind === 'SHOOTING_ACTIVITY_LOG'
            ? 'the activity record shows the applicant actually does the thing'
            : 'it supports the applicant’s circumstances',
      group: null,
    };
  }

  const container = upload.evidenceType ?? null;
  const group = groupOf(container);
  const preferred =
    purpose === 'self-defence'
      ? SELF_DEFENCE
      : purpose === 'hunting'
        ? HUNTING
        : purpose === 'sport'
          ? SPORT
          : HUNTING;
  let base = 10;
  let why = 'it is part of the applicant’s own record';
  if (container && preferred.has(container)) {
    base = 100;
    why =
      purpose === 'self-defence'
        ? 'it speaks directly to the break-in, security or premises risk'
        : purpose === 'hunting'
          ? 'it speaks directly to the hunting the applicant actually does'
          : 'it speaks directly to the discipline the applicant actually shoots';
  } else if (container && group === 'reloading' && purpose === 'sport') {
    base = 70;
    why = 'reloading supports the practice behind the sport';
  } else if (container && group === 'care' && purpose !== 'self-defence') {
    base = 55;
    why = 'it shows care and familiarity with the firearm';
  } else if (container === 'OTHER_EVIDENCE') {
    base = 5;
    why = 'it is other evidence';
  }
  const words = (upload.description ?? '').trim();
  if (words) base += 10;
  if (words.length > 20) base += 5;
  base += Math.max(0, 10 - index);
  return { score: base, why, group };
}

export function curateEvidence(args: {
  licenceType: MotivationLicenceType;
  answers: Record<string, string>;
  uploads: readonly CuratorUpload[];
}): EvidenceSelection {
  const purpose = suitabilityPurpose(args.licenceType, args.answers);
  const ranked = args.uploads
    .map((u, index) => ({ upload: u, ...score(u, purpose, index) }))
    .sort((a, b) => b.score - a.score);

  const selected: { id: string; why: string }[] = [];
  const leftOut: { id: string; why: string }[] = [];
  const groupCount = new Map<string, number>();
  const deferred: typeof ranked = [];
  /**
   * ⚠️ FOUR IS A CEILING, NOT A QUOTA. A self-defence pack with two break-in
   * photographs and a page of hunting pictures prints the two, not the hunting
   * pictures padded in to make four.
   */
  const MIN_SCORE = 30;

  for (const row of ranked) {
    if (selected.length >= EVIDENCE_BODY_SLOTS) break;
    if (row.score < MIN_SCORE) continue;
    const group = row.group ?? 'other';
    const held = groupCount.get(group) ?? 0;
    // At most two from one group, so four trophy photographs cannot crowd out
    // the range, the reloading bench and the incident record.
    if (held >= 2) {
      deferred.push(row);
      continue;
    }
    selected.push({ id: row.upload.id, why: row.why });
    groupCount.set(group, held + 1);
  }
  for (const row of deferred) {
    if (selected.length >= EVIDENCE_BODY_SLOTS) break;
    selected.push({ id: row.upload.id, why: row.why });
  }
  const chosen = new Set(selected.map((s) => s.id));
  for (const row of ranked) {
    if (chosen.has(row.upload.id)) continue;
    leftOut.push({
      id: row.upload.id,
      why:
        row.score < MIN_SCORE
          ? 'it does not support this application’s purpose'
          : selected.length >= EVIDENCE_BODY_SLOTS
            ? 'four stronger items were chosen for this application'
            : 'it did not fit the argument as closely as the chosen items',
    });
  }

  return {
    version: EVIDENCE_SELECTION_VERSION,
    selected,
    leftOut,
  };
}

export function evidenceSelectionHash(selection: EvidenceSelection): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: selection.version,
        selected: selection.selected,
      }),
    )
    .digest('hex');
}

/** The selected upload ids, in print order, from a stored selection. */
export function selectedEvidenceIds(
  selection: EvidenceSelection | null | undefined,
): string[] {
  return (selection?.selected ?? []).map((s) => s.id).filter(Boolean);
}
