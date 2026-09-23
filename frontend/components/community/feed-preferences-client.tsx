'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth, useUser } from '../../lib/auth';
import {
  type FeedGroup,
  type FeedPreferences,
  fetchGroups,
  fetchPreferences,
  savePreferences,
} from '../../lib/community-api';
import { POST_TYPE_LABELS, POST_TYPE_ORDER } from '../../lib/post-types';

const EMPTY: FeedPreferences = {
  feedMutedPostTypes: [],
  feedMutedAuthorIds: [],
  feedMutedTags: [],
  feedMutedTopicIds: [],
  feedShowAvatar: true,
  feedShowGraphic: true,
};

export function FeedPreferencesClient() {
  const { isLoaded, isSignedIn } = useUser();
  const { getToken } = useAuth();
  const [prefs, setPrefs] = useState<FeedPreferences>(EMPTY);
  const [groups, setGroups] = useState<FeedGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [tagDraft, setTagDraft] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const [p, g] = await Promise.all([
        fetchPreferences(token),
        fetchGroups(token).catch(() => ({ groups: [] as FeedGroup[] })),
      ]);
      setPrefs(p);
      setGroups(g.groups);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    void load();
  }, [isLoaded, isSignedIn, load]);

  async function persist(next: FeedPreferences) {
    setPrefs(next);
    const token = await getToken();
    if (!token) return;
    try {
      await savePreferences(token, next);
    } catch {
      await load();
    }
  }

  function toggleType(type: string) {
    const has = prefs.feedMutedPostTypes.includes(type);
    void persist({
      ...prefs,
      feedMutedPostTypes: has
        ? prefs.feedMutedPostTypes.filter((t) => t !== type)
        : [...prefs.feedMutedPostTypes, type],
    });
  }

  function toggleTopic(id: string) {
    const has = prefs.feedMutedTopicIds.includes(id);
    void persist({
      ...prefs,
      feedMutedTopicIds: has
        ? prefs.feedMutedTopicIds.filter((t) => t !== id)
        : [...prefs.feedMutedTopicIds, id],
    });
  }

  function addTag() {
    const tag = tagDraft.trim().toLowerCase().replace(/^#+/, '');
    if (!tag) return;
    if (prefs.feedMutedTags.includes(tag)) {
      setTagDraft('');
      return;
    }
    setTagDraft('');
    void persist({ ...prefs, feedMutedTags: [...prefs.feedMutedTags, tag] });
  }

  if (loading) {
    return (
      <p className="text-center text-[14px]" style={{ color: 'var(--text-tertiary)' }}>
        Loading…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2
          className="text-[15px] font-medium mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          Profile picture
        </h2>
        <p className="text-[13px] mb-3" style={{ color: 'var(--text-tertiary)' }}>
          Show your profile picture next to your posts and comments. On by
          default — turn it off to use your initial instead.
        </p>
        <button
          type="button"
          onClick={() =>
            void persist({ ...prefs, feedShowAvatar: !prefs.feedShowAvatar })
          }
          aria-pressed={prefs.feedShowAvatar}
          className="gg-press px-4 py-2 rounded-full text-[12px] font-medium"
          style={{
            background: prefs.feedShowAvatar ? 'var(--red)' : 'var(--bg-inset)',
            color: prefs.feedShowAvatar ? '#fff' : 'var(--text-secondary)',
            border: '0.5px solid var(--border)',
          }}
        >
          {prefs.feedShowAvatar ? 'On' : 'Off'}
        </button>
      </section>

      <section>
        <h2
          className="text-[15px] font-medium mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          Graphic content
        </h2>
        <p className="text-[13px] mb-3" style={{ color: 'var(--text-tertiary)' }}>
          Show graphic content (hunting, fishing, etc.) in your feed. On by
          default — turn it off to blur all graphic posts.
        </p>
        <button
          type="button"
          onClick={() =>
            void persist({ ...prefs, feedShowGraphic: !prefs.feedShowGraphic })
          }
          aria-pressed={prefs.feedShowGraphic}
          className="gg-press px-4 py-2 rounded-full text-[12px] font-medium"
          style={{
            background: prefs.feedShowGraphic ? 'var(--red)' : 'var(--bg-inset)',
            color: prefs.feedShowGraphic ? '#fff' : 'var(--text-secondary)',
            border: '0.5px solid var(--border)',
          }}
        >
          {prefs.feedShowGraphic ? 'On' : 'Off'}
        </button>
      </section>

      <section>
        <h2
          className="text-[15px] font-medium mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          Post types
        </h2>
        <p className="text-[13px] mb-3" style={{ color: 'var(--text-tertiary)' }}>
          Turn off the kinds of posts you don&apos;t want to see. This only
          affects your community feed — never the shop.
        </p>
        <div className="flex flex-wrap gap-2">
          {POST_TYPE_ORDER.map((t) => {
            const muted = prefs.feedMutedPostTypes.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleType(t)}
                className="gg-press px-3 py-1.5 rounded-full text-[12px]"
                style={{
                  background: muted ? 'var(--bg-inset)' : 'var(--red-wash)',
                  color: muted ? 'var(--text-tertiary)' : 'var(--red)',
                  textDecoration: muted ? 'line-through' : 'none',
                }}
              >
                {POST_TYPE_LABELS[t]}
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h2
          className="text-[15px] font-medium mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          Muted tags
        </h2>
        <div className="flex gap-2 mb-3">
          <input
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTag();
              }
            }}
            placeholder="e.g. venison"
            className="px-3 py-2 rounded-[6px] text-[13px] flex-1"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          />
          <button
            type="button"
            onClick={addTag}
            className="gg-press px-4 py-2 rounded-[6px] text-[13px]"
            style={{ background: 'var(--red)', color: '#fff' }}
          >
            Add
          </button>
        </div>
        {prefs.feedMutedTags.length === 0 ? (
          <p className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
            No muted tags.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {prefs.feedMutedTags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() =>
                  void persist({
                    ...prefs,
                    feedMutedTags: prefs.feedMutedTags.filter((x) => x !== t),
                  })
                }
                className="gg-press px-3 py-1.5 rounded-full text-[12px]"
                style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
              >
                #{t} ✕
              </button>
            ))}
          </div>
        )}
      </section>

      {groups.length > 0 && (
        <section>
          <h2
            className="text-[15px] font-medium mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Groups
          </h2>
          <p className="text-[13px] mb-3" style={{ color: 'var(--text-tertiary)' }}>
            Mute a group to hide its posts from your feed.
          </p>
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => {
              const muted = prefs.feedMutedTopicIds.includes(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => toggleTopic(g.id)}
                  className="gg-press px-3 py-1.5 rounded-full text-[12px]"
                  style={{
                    background: muted ? 'var(--bg-inset)' : 'var(--red-wash)',
                    color: muted ? 'var(--text-tertiary)' : 'var(--red)',
                    textDecoration: muted ? 'line-through' : 'none',
                  }}
                >
                  {g.name}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h2
          className="text-[15px] font-medium mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          Muted members
        </h2>
        {prefs.feedMutedAuthorIds.length === 0 ? (
          <p className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
            No muted members. Use the ⋯ menu on a post to mute someone.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {prefs.feedMutedAuthorIds.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() =>
                  void persist({
                    ...prefs,
                    feedMutedAuthorIds: prefs.feedMutedAuthorIds.filter(
                      (x) => x !== id,
                    ),
                  })
                }
                className="gg-press px-3 py-1.5 rounded-full text-[12px]"
                style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
              >
                {id} ✕
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
