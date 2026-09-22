// Display labels for the feed post types. The enum is the source of truth
// (backend/src/feed/feed.types.ts); this is the UI copy, kept in step by hand.

export const POST_TYPE_LABELS = {
  HUNTING: 'Hunting',
  FIREARMS_SHOOTING: 'Firearms & Shooting',
  RELOADING: 'Reloading',
  FISHING: 'Fishing',
  OVERLANDING_4X4: 'Overlanding & 4x4',
  CAMPING_BUSHCRAFT: 'Camping & Bushcraft',
  GEAR_REVIEWS: 'Gear & Reviews',
  QUESTIONS_ADVICE: 'Questions & Advice',
  GENERAL: 'General & Community',
} as const;

export type PostTypeKey = keyof typeof POST_TYPE_LABELS;

export const POST_TYPE_ORDER: PostTypeKey[] = [
  'GENERAL',
  'HUNTING',
  'FIREARMS_SHOOTING',
  'RELOADING',
  'FISHING',
  'OVERLANDING_4X4',
  'CAMPING_BUSHCRAFT',
  'GEAR_REVIEWS',
  'QUESTIONS_ADVICE',
];

export function postTypeLabel(type: string): string {
  return POST_TYPE_LABELS[type as PostTypeKey] ?? 'General & Community';
}
