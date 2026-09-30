'use client';

import type { CSSProperties } from 'react';
import { describePostDetails, type PostDetailSource } from '../../lib/post-fields';
import type { PostTypeKey } from '../../lib/post-types';

/**
 * The optional per-category "details" a post carries, rendered as a compact
 * row of chips. Category-aware (a Hunting post shows species/calibre, a Gear
 * post shows its rating, etc.) and renders nothing when the author set none.
 */
export default function PostDetails({
  type,
  post,
  className = '',
}: {
  type: string;
  post: PostDetailSource;
  className?: string;
}) {
  const entries = describePostDetails(type as PostTypeKey, post);
  if (!entries.length) return null;

  const chip: CSSProperties = {
    background: 'var(--bg-inset)',
    border: '0.5px solid var(--border)',
    color: 'var(--text-secondary)',
  };

  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`} data-post-details>
      {entries.flatMap((entry) => {
        const values = entry.items ?? [entry.text];
        return values.map((value, i) => (
          <span
            key={`${entry.key}-${i}`}
            className="text-[12px] px-2 py-0.5 rounded-full"
            style={chip}
          >
            <span style={{ color: 'var(--text-tertiary)' }}>{entry.label}:</span> {value}
          </span>
        ));
      })}
    </div>
  );
}
