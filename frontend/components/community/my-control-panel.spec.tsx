// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { postStatusMeta } from './my-control-panel';
import type { FeedPost } from '../../lib/community-api';

/**
 * The status pill is the only place the control centre tells a member whether
 * their post is live, still being checked, or blocked. Getting the mapping
 * wrong would show a blocked post as "Live" — a correctness bug, not a nit.
 */
describe('postStatusMeta', () => {
  const withState = (moderationState?: FeedPost['moderationState']) =>
    postStatusMeta({ moderationState } as FeedPost);

  it('labels a processing post', () => {
    expect(withState('PROCESSING').label).toBe('Processing');
  });

  it('labels an in-review post', () => {
    expect(withState('IN_REVIEW').label).toBe('In review');
  });

  it('labels a blocked post in red', () => {
    const meta = withState('BLOCKED');
    expect(meta.label).toBe('Blocked');
    expect(meta.fg).toContain('red');
  });

  it('treats published and undefined as live', () => {
    expect(withState('PUBLISHED').label).toBe('Live');
    expect(withState(undefined).label).toBe('Live');
  });
});
