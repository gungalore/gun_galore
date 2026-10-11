import { Injectable } from '@nestjs/common';
import { PhotoChecklistItem } from './valuation.types';

export interface SelectableImage {
  id: string;
  url: string;
  viewTag: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  createdAt: Date;
}

/**
 * Picks the best subset of photos to send the model, capped at
 * VALUATION_MAX_MODEL_IMAGES (default 8, matching the upload cap; the provider
 * accepts multiple images, but the limit is config so a provider change needs
 * no code edit). Order: required checklist tags by priority, then other tagged
 * photos, then untagged by upload order; near-duplicates are skipped.
 */
@Injectable()
export class ImageSelectService {
  select(
    images: SelectableImage[],
    checklist: PhotoChecklistItem[],
  ): SelectableImage[] {
    const max = Number(process.env.VALUATION_MAX_MODEL_IMAGES ?? 8);
    const byTag = new Map<string, SelectableImage>();
    for (const img of images) {
      if (img.viewTag && !byTag.has(img.viewTag)) byTag.set(img.viewTag, img);
    }

    const ordered: SelectableImage[] = [];
    const orderedChecklist = [...checklist].sort((a, b) => a.priority - b.priority);

    for (const item of orderedChecklist.filter((c) => c.required)) {
      const img = byTag.get(item.tag);
      if (img) ordered.push(img);
    }
    for (const item of orderedChecklist) {
      const img = byTag.get(item.tag);
      if (img && !ordered.includes(img)) ordered.push(img);
    }
    for (const img of images) {
      if (!ordered.includes(img)) ordered.push(img);
    }

    const chosen: SelectableImage[] = [];
    for (const img of ordered) {
      if (chosen.length >= max) break;
      if (chosen.some((c) => isNearDuplicate(c, img))) continue;
      chosen.push(img);
    }
    return chosen;
  }
}

function isNearDuplicate(a: SelectableImage, b: SelectableImage): boolean {
  if (a.width == null || b.width == null || a.bytes == null || b.bytes == null) return false;
  if (a.width !== b.width || a.height !== b.height) return false;
  const diff = Math.abs(a.bytes - b.bytes) / Math.max(a.bytes, 1);
  return diff < 0.02;
}
