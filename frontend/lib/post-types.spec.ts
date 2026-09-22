import { describe, expect, it } from 'vitest';
import { POST_TYPE_ORDER, postTypeLabel } from './post-types';

describe('post types', () => {
  it('labels every known type', () => {
    expect(postTypeLabel('HUNTING')).toBe('Hunting');
    expect(postTypeLabel('FIREARMS_SHOOTING')).toBe('Firearms & Shooting');
    expect(postTypeLabel('QUESTIONS_ADVICE')).toBe('Questions & Advice');
  });

  it('falls back rather than rendering an enum name', () => {
    expect(postTypeLabel('SOMETHING_NEW')).toBe('General & Community');
  });

  it('orders all nine types exactly once', () => {
    expect(POST_TYPE_ORDER).toHaveLength(9);
    expect(new Set(POST_TYPE_ORDER).size).toBe(9);
  });
});
