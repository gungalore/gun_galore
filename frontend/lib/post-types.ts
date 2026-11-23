// Display labels for the feed post types. The enum is the source of truth
// (backend/src/feed/feed.types.ts); this is the UI copy, kept in step by hand.

export const POST_TYPE_LABELS = {
  GENERAL: 'General & Community',
  HIKING: 'Hiking',
  HUNTING: 'Hunting',
  FIREARMS_SHOOTING: 'Firearms & Shooting',
  RELOADING: 'Reloading',
  FISHING: 'Fishing',
  OVERLANDING_4X4: 'Overlanding & 4x4',
  CAMPING_BUSHCRAFT: 'Camping & Bushcraft',
  GEAR_REVIEWS: 'Gear & Reviews',
  QUESTIONS_ADVICE: 'Questions & Advice',
} as const;

export type PostTypeKey = keyof typeof POST_TYPE_LABELS;

export const POST_TYPE_ORDER: PostTypeKey[] = [
  'GENERAL',
  'HIKING',
  'HUNTING',
  'FIREARMS_SHOOTING',
  'RELOADING',
  'FISHING',
  'OVERLANDING_4X4',
  'CAMPING_BUSHCRAFT',
  'GEAR_REVIEWS',
  'QUESTIONS_ADVICE',
];

/**
 * Post types that carry a GPX route. The backend enforces the same list
 * (`ROUTE_CAPABLE_POST_TYPES` in feed.types.ts); keep the two in step.
 */
export const ROUTE_CAPABLE_TYPES: readonly PostTypeKey[] = [
  'HIKING',
  'OVERLANDING_4X4',
  'CAMPING_BUSHCRAFT',
];

export function isRouteCapable(type: string): boolean {
  return (ROUTE_CAPABLE_TYPES as readonly string[]).includes(type);
}

export function postTypeLabel(type: string): string {
  return POST_TYPE_LABELS[type as PostTypeKey] ?? 'General & Community';
}
