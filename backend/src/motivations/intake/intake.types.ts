import type { MotivationLicenceType } from '@prisma/client';
import type { EvidenceGroup } from '../evidence-taxonomy';
import type { MotivationOutputMode } from '../motivation-output';

export type IntakeMode = 'DOCUMENTS' | 'INTERVIEW';

export type IntakeStage =
  | 'MODE'
  | 'DOCUMENTS'
  | 'INTERVIEW'
  | 'BLOCKED'
  | 'REVIEW'
  | 'DONE';

export interface IntakeBlocked {
  code: string;
  field: string;
  message: string;
  /** Sections that WOULD work for the firearm the applicant has described. */
  suggested: { licenceType: MotivationLicenceType; label: string }[];
}

export type TickState =
  | 'attached'
  | 'required'
  | 'suggested'
  | 'optional'
  | 'blocked';

export interface IntakeChoice {
  value: string;
  label: string;
}

export interface IntakeDetailField {
  key: string;
  label: string;
  kind: 'short' | 'long' | 'date' | 'choice' | 'multi' | 'yesno' | 'cards';
  help: string;
  choices: IntakeChoice[];
  multi: boolean;
  customPlaceholder: string;
}

export interface IntakeQuestion {
  /** Field key, or a synthetic key such as `firearm_use_kind`. */
  id: string;
  fieldKey: string;
  label: string;
  help: string;
  kind: 'short' | 'long' | 'date' | 'choice' | 'multi' | 'yesno' | 'cards';
  choices: IntakeChoice[];
  /** Extra fields shown only after a Yes (the declaration follow-ups). */
  details?: IntakeDetailField[];
  multi: boolean;
  sensitive: boolean;
  customPlaceholder: string;
  progress: { answered: number; total: number };
  /** True where the applicant may skip without blocking generation. */
  optional: boolean;
}

export interface IntakeDocumentItem {
  source: 'credential' | 'upload';
  sourceId: string;
  kind: string;
  title: string;
  addedOn: string;
  alreadyHere: boolean;
  caution: { tone: 'ask' | 'stale'; text: string } | null;
  askPlace: boolean;
  evidenceType?: string | null;
  evidencePlacement?: 'annexure' | 'body' | null;
  tick: TickState;
  tickReason: string | null;
}

export interface IntakeMissingDocument {
  kind: string;
  label: string;
  why: string;
}

export interface IntakeDocumentNeed {
  kind: string;
  label: string;
  tier: 'required' | 'expected' | 'strengthens' | 'extra';
  why: string;
  have: boolean;
  minFiles?: number;
  minFilesNote?: string;
}

export type IntakeTopicId =
  | 'identity'
  | 'firearm'
  | 'credentials'
  | 'existing'
  | 'address'
  | 'association'
  | 'activities'
  | 'safe'
  | 'declarations'
  | 'other';

export interface IntakeTopicState {
  id: IntakeTopicId;
  title: string;
  index: number;
  total: number;
  status: 'needs_document' | 'needs_answers' | 'complete';
  /** What we are going to use, in the member's own words. */
  have: { label: string; value: string; from: string }[];
  documents: {
    kind: string;
    label: string;
    have: boolean;
    required: boolean;
  }[];
  actions: ('upload' | 'scan' | 'manual')[];
}

export interface IntakeState {
  motivationId: string;
  referenceNumber: string;
  licenceType: MotivationLicenceType;
  licenceTypeLabel: string;
  mode: IntakeMode | null;
  /** What this application is meant to produce. */
  outputMode: MotivationOutputMode;
  stage: IntakeStage;
  /** Non-null when the firearm cannot be licensed under this section at all. */
  blocked: IntakeBlocked | null;
  /** One-line context for the interview header. */
  summary: string;
  /** The topic the current question belongs to. Null outside the interview. */
  topic: IntakeTopicState | null;
  /** True when the member's Document Library holds no documents at all. */
  vaultEmpty: boolean;
  documents: {
    items: IntakeDocumentItem[];
    missing: IntakeMissingDocument[];
    /** The DFO/CFR annexure rows, including the "expected" tier. */
    needs: IntakeDocumentNeed[];
    attached: number;
    required: number;
    /** True when a dealer invoice/350(a), owner's licence or consent is attached. */
    sourceProofAttached: boolean;
    /**
     * True once type and action are known, so the interview can name the
     * competency/proficiency and endorsement this application actually needs.
     * Before that, those rows stay out of the DFO list.
     */
    firearmKnown: boolean;
  };
  evidence: {
    items: IntakeDocumentItem[];
    groups: EvidenceGroup[];
    note: string;
    /** False until the sporting purpose router has an answer. */
    ready: boolean;
  };
  question: IntakeQuestion | null;
  /** One-sentence acknowledgement of the answer just given. */
  acknowledgement?: string;
  progress: {
    answered: number;
    total: number;
    sections: { id: string; title: string; missing: number }[];
  };
}

export interface IntakeStrategy {
  purpose: 'self_defence' | 'sporting' | 'renewal';
  /** Field keys in coverage order; hidden/internal keys are allowed. */
  fields: string[];
  /**
   * For the two sporting licence types, the applicant's explicit router.
   * Null for sections that do not admit both pools.
   */
  purposeField: 'firearm_use_kind' | null;
  evidenceGroups: EvidenceGroup[];
  /** A free-text fallback for a card field the applicant answers in their own words. */
  customKeys: Record<string, string>;
  /** Curated quick replies for free-text fields, so not every answer is typed. */
  suggestions: Record<string, string[]>;
  /** Where the interview starts in the page header. */
  intro: string;
}

