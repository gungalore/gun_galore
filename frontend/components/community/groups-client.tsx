'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth, useUser } from '../../lib/auth';
import {
  type FeedGroup,
  fetchGroups,
  joinGroup,
  leaveGroup,
} from '../../lib/community-api';

export function GroupsClient() {
  const { isLoaded, isSignedIn } = useUser();
  const { getToken } = useAuth();
  const [groups, setGroups] = useState<FeedGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      setGroups((await fetchGroups(token)).groups);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    void load();
  }, [isLoaded, isSignedIn, load]);

  async function toggle(group: FeedGroup) {
    const token = await getToken();
    if (!token) return;
    const next = !group.joined;
    setGroups((prev) =>
      prev.map((g) =>
        g.id === group.id
          ? { ...g, joined: next, memberCount: g.memberCount + (next ? 1 : -1) }
          : g,
      ),
    );
    try {
      if (next) await joinGroup(token, group.id);
      else await leaveGroup(token, group.id);
    } catch {
      await load();
    }
  }

  if (loading) {
    return (
      <p className="text-center text-[14px]" style={{ color: 'var(--text-tertiary)' }}>
        Loading…
      </p>
    );
  }
  if (groups.length === 0) {
    return (
      <p className="text-center text-[14px]" style={{ color: 'var(--text-tertiary)' }}>
        No groups yet.
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {groups.map((g) => (
        <div
          key={g.id}
          className="gg-tile rounded-[8px] p-4 flex flex-col gap-2"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        >
          <Link
            href={`/community/g/${g.slug}`}
            className="text-[15px] font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            {g.name}
          </Link>
          {g.description && (
            <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
              {g.description}
            </p>
          )}
          <div className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
            {g.memberCount} members · {g.postCount} posts
          </div>
          <button
            type="button"
            onClick={() => toggle(g)}
            className="gg-press self-start px-4 py-1.5 rounded-[6px] text-[13px] font-medium"
            style={{
              background: g.joined ? 'var(--bg-card)' : 'var(--red)',
              color: g.joined ? 'var(--text-secondary)' : '#fff',
              border: g.joined ? '0.5px solid var(--border)' : 'none',
            }}
          >
            {g.joined ? 'Joined' : 'Join'}
          </button>
        </div>
      ))}
    </div>
  );
}
