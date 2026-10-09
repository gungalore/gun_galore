// Optional per-category "details" fields for the community composer.
//
// Values in `species`/`flair`/the single-select fields are stored as normalised
// slugs (backend `normaliseChipList`/`normaliseSingleValue`); `calibre` and
// `testResult` store the verbatim label (`textOrNull`). The `vocab` key in a
// field definition points at the suggestion list in `frontend/lib/post-vocab.ts`
// — suggestions only, free text is always accepted.

import type { PostTypeKey } from './post-types';
import { entriesFor, labelFor, type VocabKey } from './post-vocab';

export type DetailValue = string | number | string[];

export type PostFieldKind = 'chips' | 'single' | 'number' | 'text' | 'rating' | 'date';

export interface PostFieldDef {
  /** API field name, e.g. `species`, `gearRating`. */
  key: string;
  label: string;
  kind: PostFieldKind;
  /** Autocomplete suggestion list; absent leaves the control free-form. */
  vocab?: VocabKey;
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

/** Suggestions for a field, or [] when it has none. */
export function suggestionsFor(field: PostFieldDef) {
  return field.vocab ? entriesFor(field.vocab) : [];
}

/** `slug` values are normalised by the backend; `label` values are verbatim. */
export function storeMode(field: PostFieldDef): 'slug' | 'label' {
  return field.kind === 'text' ? 'label' : 'slug';
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
    { key: 'flair', label: FLAIR_LABELS.GENERAL as string, kind: 'chips', vocab: 'flair-general' },
  ],
  HUNTING: [
    { key: 'species', label: 'Species', kind: 'chips', vocab: 'species-hunting' },
    {
      key: 'calibre',
      label: 'Calibre',
      kind: 'text',
      vocab: 'cartridge',
      placeholder: 'Start typing… e.g. .308 Win',
      max: 40,
    },
    { key: 'shotDistanceM', label: 'Shot distance', kind: 'number', min: 1, max: 5000, suffix: 'm' },
  ],
  FIREARMS_SHOOTING: [
    { key: 'firearmType', label: 'Type', kind: 'single', vocab: 'firearm-type' },
    {
      key: 'calibre',
      label: 'Calibre',
      kind: 'text',
      vocab: 'cartridge',
      placeholder: 'Start typing… e.g. 6.5 Creedmoor',
      max: 40,
    },
    {
      key: 'firearmModel',
      label: 'Model',
      kind: 'text',
      placeholder: 'e.g. Tikka T3x',
      max: 60,
      hint: 'Model name only — never a serial number.',
    },
    { key: 'flair', label: FLAIR_LABELS.FIREARMS_SHOOTING as string, kind: 'chips', vocab: 'flair-firearms' },
  ],
  RELOADING: [
    {
      key: 'calibre',
      label: 'Cartridge',
      kind: 'text',
      vocab: 'cartridge',
      placeholder: 'Start typing… e.g. .30-06',
      max: 40,
    },
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
      vocab: 'test-result',
      placeholder: 'Start typing… e.g. 1.5 MOA',
      max: 120,
    },
  ],
  FISHING: [
    { key: 'species', label: 'Species', kind: 'chips', vocab: 'species-fishing' },
    { key: 'waterType', label: 'Water type', kind: 'single', vocab: 'water-type' },
    { key: 'flair', label: FLAIR_LABELS.FISHING as string, kind: 'chips', vocab: 'flair-fishing' },
    { key: 'sizeCm', label: 'Size', kind: 'number', min: 1, max: 2000, suffix: 'cm' },
  ],
  OVERLANDING_4X4: [
    { key: 'flair', label: FLAIR_LABELS.OVERLANDING_4X4 as string, kind: 'chips', vocab: 'flair-overlanding' },
    { key: 'tripDays', label: 'Trip length', kind: 'number', min: 1, max: 365, suffix: 'days' },
  ],
  CAMPING_BUSHCRAFT: [
    { key: 'siteType', label: 'Site type', kind: 'single', vocab: 'site-type' },
    { key: 'flair', label: FLAIR_LABELS.CAMPING_BUSHCRAFT as string, kind: 'chips', vocab: 'flair-camping' },
    { key: 'tripDays', label: 'Nights', kind: 'number', min: 1, max: 365, suffix: 'nights' },
  ],
  GEAR_REVIEWS: [
    { key: 'gearCategory', label: 'Category', kind: 'single', vocab: 'gear-category' },
    { key: 'gearRating', label: 'Rating', kind: 'rating' },
    { key: 'gearCondition', label: 'Condition', kind: 'single', vocab: 'gear-condition' },
  ],
  QUESTIONS_ADVICE: [
    { key: 'flair', label: FLAIR_LABELS.QUESTIONS_ADVICE as string, kind: 'chips', vocab: 'flair-questions' },
    { key: 'context', label: 'Context', kind: 'single', vocab: 'context' },
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

/** Display text for a slug-mode value: the vocab label if known, else chipLabel. */
function displaySlug(field: PostFieldDef, value: string): string {
  return (field.vocab ? labelFor(field.vocab, value) : undefined) ?? chipLabel(value);
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
      if (raw.length) {
        out.push({
          key: field.key,
          label: field.label,
          text: '',
          items: raw.map((v) => displaySlug(field, String(v))),
        });
      }
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
      out.push({ key: field.key, label: field.label, text: displaySlug(field, String(raw)) });
      continue;
    }
    out.push({ key: field.key, label: field.label, text: String(raw) });
  }
  return out;
}
