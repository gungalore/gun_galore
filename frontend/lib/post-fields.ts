// Optional per-category "details" fields for the community composer.
//
// Mirror of backend/src/feed/feed.types.ts (POST_DETAIL_FIELDS /
// POST_CHIP_VOCAB / POST_SINGLE_VOCAB / POST_NUMERIC_BOUNDS). The backend is
// the source of truth and strips anything invalid, so this file only drives
// the UI. Keep the value strings in step with the backend vocabularies.

import type { PostTypeKey } from './post-types';

export type DetailValue = string | number | string[];

export type PostFieldKind = 'chips' | 'single' | 'number' | 'text' | 'rating' | 'date';

export interface PostFieldDef {
  /** API field name, e.g. `species`, `gearRating`. */
  key: string;
  label: string;
  kind: PostFieldKind;
  /** Allowed values for `chips` / `single` (value strings are the stored form). */
  options?: string[];
  placeholder?: string;
  /** Numeric bounds + unit label for `number`. */
  min?: number;
  max?: number;
  suffix?: string;
  hint?: string;
}

/** "blue-wildebeest" → "Blue wildebeest". */
export function chipLabel(value: string): string {
  const s = value.replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const FLAIR_LABELS: Partial<Record<PostTypeKey, string>> = {
  GENERAL: 'Topic',
  FIREARMS_SHOOTING: 'Purpose',
  FISHING: 'Bait / method',
  OVERLANDING_4X4: 'Activity / condition',
  CAMPING_BUSHCRAFT: 'Facilities',
  QUESTIONS_ADVICE: 'Topic',
};

/** Category-specific fields, in display order. */
const SPECIFIC_FIELDS: Record<PostTypeKey, PostFieldDef[]> = {
  GENERAL: [
    {
      key: 'flair',
      label: FLAIR_LABELS.GENERAL as string,
      kind: 'chips',
      options: ['meetup', 'announcement', 'photo', 'news', 'discussion'],
    },
  ],
  HUNTING: [
    {
      key: 'species',
      label: 'Species',
      kind: 'chips',
      options: [
        'blesbok',
        'springbok',
        'impala',
        'kudu',
        'warthog',
        'gemsbok',
        'blue-wildebeest',
        'black-wildebeest',
        'zebra',
        'bushbuck',
        'eland',
        'common-duiker',
        'steenbok',
        'nyala',
        'sable',
        'reedbuck',
        'waterbuck',
        'buffalo',
      ],
    },
    { key: 'calibre', label: 'Calibre', kind: 'text', placeholder: 'e.g. .308 Win', max: 40 },
    { key: 'shotDistanceM', label: 'Shot distance', kind: 'number', min: 1, max: 5000, suffix: 'm' },
  ],
  FIREARMS_SHOOTING: [
    {
      key: 'firearmType',
      label: 'Type',
      kind: 'single',
      options: ['rifle', 'shotgun', 'pistol', 'airgun', 'other'],
    },
    { key: 'calibre', label: 'Calibre', kind: 'text', placeholder: 'e.g. 6.5 Creedmoor', max: 40 },
    {
      key: 'firearmModel',
      label: 'Model',
      kind: 'text',
      placeholder: 'e.g. Tikka T3x',
      max: 60,
      hint: 'Model name only — never a serial number.',
    },
    {
      key: 'flair',
      label: FLAIR_LABELS.FIREARMS_SHOOTING as string,
      kind: 'chips',
      options: ['range', 'hunting', 'competition', 'maintenance'],
    },
  ],
  RELOADING: [
    { key: 'calibre', label: 'Cartridge', kind: 'text', placeholder: 'e.g. .30-06', max: 40 },
    {
      key: 'bulletWeightGr',
      label: 'Bullet weight',
      kind: 'number',
      min: 1,
      max: 2000,
      suffix: 'gr',
    },
    {
      key: 'powderChargeGr',
      label: 'Tested charge',
      kind: 'number',
      min: 1,
      max: 500,
      suffix: 'gr',
    },
    {
      key: 'testResult',
      label: 'Test result',
      kind: 'text',
      placeholder: 'e.g. 1.5 MOA, 3-shot group',
      max: 120,
    },
  ],
  FISHING: [
    {
      key: 'species',
      label: 'Species',
      kind: 'chips',
      options: [
        'bass',
        'carp',
        'trout',
        'tilapia',
        'yellowfish',
        'kurper',
        'barbel',
        'bream',
        'snoek',
        'yellowtail',
        'kob',
        'grunter',
        'tuna',
        'kingfish',
        'amberjack',
        'grouper',
        'sunfish',
        'dorado',
      ],
    },
    {
      key: 'waterType',
      label: 'Water type',
      kind: 'single',
      options: ['river', 'dam', 'estuary', 'nearshore', 'offshore'],
    },
    {
      key: 'flair',
      label: FLAIR_LABELS.FISHING as string,
      kind: 'chips',
      options: ['lure', 'bait', 'fly', 'trolling', 'bottom'],
    },
    { key: 'sizeCm', label: 'Size', kind: 'number', min: 1, max: 2000, suffix: 'cm' },
  ],
  OVERLANDING_4X4: [
    {
      key: 'flair',
      label: FLAIR_LABELS.OVERLANDING_4X4 as string,
      kind: 'chips',
      options: ['trail-report', 'recovery', 'passable', 'closed', 'fuel'],
    },
    { key: 'tripDays', label: 'Trip length', kind: 'number', min: 1, max: 365, suffix: 'days' },
  ],
  CAMPING_BUSHCRAFT: [
    {
      key: 'siteType',
      label: 'Site type',
      kind: 'single',
      options: ['campsite', 'wilderness', 'caravan', 'hut', 'other'],
    },
    {
      key: 'flair',
      label: FLAIR_LABELS.CAMPING_BUSHCRAFT as string,
      kind: 'chips',
      options: ['water', 'toilets', 'firepit', 'none'],
    },
    { key: 'tripDays', label: 'Nights', kind: 'number', min: 1, max: 365, suffix: 'nights' },
  ],
  GEAR_REVIEWS: [
    {
      key: 'gearCategory',
      label: 'Category',
      kind: 'single',
      options: ['firearm', 'optic', 'ammo', 'camping', 'fishing', 'vehicle', 'other'],
    },
    { key: 'gearRating', label: 'Rating', kind: 'rating' },
    {
      key: 'gearCondition',
      label: 'Condition',
      kind: 'single',
      options: ['new', 'used', 'like-new'],
    },
  ],
  QUESTIONS_ADVICE: [
    {
      key: 'flair',
      label: FLAIR_LABELS.QUESTIONS_ADVICE as string,
      kind: 'chips',
      options: ['setup', 'troubleshooting', 'legal', 'safety', 'local-advice'],
    },
    {
      key: 'context',
      label: 'Context',
      kind: 'single',
      options: ['at-range', 'in-field', 'at-home'],
    },
  ],
};

/** Shared fields appended to every category. */
const COMMON_FIELDS: PostFieldDef[] = [
  { key: 'occurredAt', label: 'Date (when it happened)', kind: 'date' },
];

export function detailFieldsFor(type: PostTypeKey): PostFieldDef[] {
  return [...(SPECIFIC_FIELDS[type] ?? []), ...COMMON_FIELDS];
}

/** localStorage key for the per-type "remembered" detail selections. */
export const DETAIL_MEMORY_KEY = 'gg.community.postDetails';

export function memoryKey(type: PostTypeKey, field: string): string {
  return `${type}:${field}`;
}

/** Read the remembered selections, tolerating a disabled/corrupt store. */
export function readDetailMemory(): Record<string, DetailValue> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(DETAIL_MEMORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, DetailValue>) : {};
  } catch {
    return {};
  }
}

export function writeDetailMemory(values: Record<string, DetailValue>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DETAIL_MEMORY_KEY, JSON.stringify(values));
  } catch {
    /* storage disabled — selections simply won't persist */
  }
}

/**
 * Build the JSON body fields for the chosen type from remembered/current
 * selections. Empty selections are omitted; anything not valid for the type is
 * simply not read.
 */
export function buildDetailPayload(
  type: PostTypeKey,
  values: Record<string, DetailValue>,
): Record<string, DetailValue> {
  const out: Record<string, DetailValue> = {};
  for (const field of detailFieldsFor(type)) {
    const value = values[memoryKey(type, field.key)];
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) out[field.key] = value;
      continue;
    }
    out[field.key] = value;
  }
  return out;
}

// ── Display ─────────────────────────────────────────────────────────────────

/** Any subset of the detail columns a FeedPost carries. */
export interface PostDetailSource {
  flair?: string[] | null;
  species?: string[] | null;
  occurredAt?: string | null;
  calibre?: string | null;
  firearmType?: string | null;
  firearmModel?: string | null;
  bulletWeightGr?: number | null;
  powderChargeGr?: number | null;
  testResult?: string | null;
  waterType?: string | null;
  sizeCm?: number | null;
  shotDistanceM?: number | null;
  siteType?: string | null;
  tripDays?: number | null;
  gearCategory?: string | null;
  gearRating?: number | null;
  gearCondition?: string | null;
  context?: string | null;
}

export interface PostDetailEntry {
  key: string;
  label: string;
  /** Scalar display text (numbers/units, stars, dates, single values). */
  text: string;
  /** Present for chips: one entry per selected value. */
  items?: string[];
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Turn a post's stored detail columns into display-ready entries for the
 * category, skipping anything unset. Arrays come back as `items` so the caller
 * can render them as chips.
 */
export function describePostDetails(type: PostTypeKey, post: PostDetailSource): PostDetailEntry[] {
  const src = post as Record<string, unknown>;
  const out: PostDetailEntry[] = [];
  for (const field of detailFieldsFor(type)) {
    const raw = src[field.key];
    if (raw === undefined || raw === null || raw === '') continue;
    if (Array.isArray(raw)) {
      if (raw.length) out.push({ key: field.key, label: field.label, text: '', items: raw.map(chipLabel) });
      continue;
    }
    if (field.kind === 'rating') {
      const n = Number(raw);
      if (n > 0) out.push({ key: field.key, label: field.label, text: '★'.repeat(Math.min(5, n)) });
      continue;
    }
    if (field.kind === 'date') {
      out.push({ key: field.key, label: field.label, text: formatDate(String(raw)) });
      continue;
    }
    if (field.kind === 'number') {
      out.push({
        key: field.key,
        label: field.label,
        text: `${raw}${field.suffix ? ` ${field.suffix}` : ''}`,
      });
      continue;
    }
    if (field.kind === 'single') {
      out.push({ key: field.key, label: field.label, text: chipLabel(String(raw)) });
      continue;
    }
    out.push({ key: field.key, label: field.label, text: String(raw) });
  }
  return out;
}
