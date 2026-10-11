import { ValuationStatus, ValuationConfidence } from '@prisma/client';
import type { ConfidenceLevel, MatchDimension, MatchWeights } from './comp.service';

// Shared types for the valuation module. The two model-output JSON schemas
// (identify, result) and their zod mirrors land in Phase 3; this file holds
// the config shape, the API-facing view models and the SSE payloads.

export type ValuationStrategy =
  | 'COMP_MATCHED'
  | 'RETAIL_ANCHOR'
  | 'UNIT_COMMODITY'
  | 'VALUE_EQUIPMENT';

export interface PhotoChecklistItem {
  tag: string;
  label: string;
  priority: number;
  required: boolean;
  hint: string;
}

export interface SeedQuestion {
  id: string;
  kind: string;
  text: string;
  type: 'single' | 'multi';
  options: string[];
  allow_custom: boolean;
  allow_unsure: boolean;
  required: boolean;
}

export interface DepreciationTier {
  brands: string[];
  pctByConditionAndAge: Record<string, number>;
}

export interface LegalFlag {
  flag: string;
  message: string;
}

export interface CategoryConfig {
  categorySlug: string | null;
  strategy: ValuationStrategy;
  strategyPrompt: string;
  photoChecklist: PhotoChecklistItem[];
  seedQuestions: SeedQuestion[];
  valueDrivers: string[];
  bannedTopicPatterns: string[];
  bannedItemPatterns: string[];
  searchSources: string[];
  retailAnchor: boolean;
  minComps: number;
  depreciation: {
    brandTiers: Record<string, DepreciationTier>;
    compOverride: string;
  } | null;
  unitCommodity: {
    unitLabel: string;
    sealedMultiplier: number;
    openedMultiplier: number;
  } | null;
  legalFlags: LegalFlag[];
  listingConstraints: {
    shippingMethods: string[];
    requiresDealerTransferOffer: boolean;
  };
  /** The specs that must agree for a comp to be "the same item". */
  matchDimensions: MatchDimension[];
  matchWeights: MatchWeights;
  matchConfidenceCap: { DIFF_SPEC: ConfidenceLevel; BRAND_CLASS: ConfidenceLevel };
}

export interface ValuationImageView {
  id: string;
  url: string;
  viewTag: string | null;
  source: string;
}

export interface ValuationState {
  id: string;
  status: ValuationStatus;
  itemName: string | null;
  description: string | null;
  categorySlug: string | null;
  photoChecklist: PhotoChecklistItem[];
  images: ValuationImageView[];
  identify: unknown | null;
  questions: unknown | null;
  answers: unknown | null;
  researchSteps: { step: string; detail: string; at: string }[];
  result: unknown | null;
  legalFlags: LegalFlag[];
}

export interface ValuationPhotoResult {
  image: ValuationImageView & { width: number | null; height: number | null };
  photoCount: number;
  slotsRemaining: number;
  photoChecklist: PhotoChecklistItem[];
}

export interface CaptureEvent {
  type: 'photo_added' | 'photo_deleted' | 'session_closed' | 'session_expired';
  image?: ValuationImageView;
  photoId?: string;
  photoCount?: number;
}

export interface ResearchEvent {
  type: 'step' | 'done' | 'failed';
  step?: string;
  detail?: string;
  valuationId?: string;
  errorCode?: string;
  message?: string;
}

export type { ValuationStatus, ValuationConfidence };
