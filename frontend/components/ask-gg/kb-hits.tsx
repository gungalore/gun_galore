'use client';

import { useState } from 'react';
import type { AskGgKbHit } from '@/lib/use-ask-gg';

/** Phase C — KB hit cards rendered above the composer. Each card is
 *  collapsed by default (title + snippet + actions); clicking the
 *  title expands to the full answer. "This helped" bumps usefulCount
 *  + dismisses (user got their answer, no Claude call). "Ask anyway"
 *  is implicit — they just hit Send. The X dismisses the whole row. */
export function KbHitsRow({
  hits,
  onHelpful,
  onDismiss,
  canMarkHelpful = true,
}: {
  hits: AskGgKbHit[];
  onHelpful: (entryId: string) => void;
  onDismiss: () => void;
  canMarkHelpful?: boolean;
}) {
  return (
    <div
      style={{
        marginTop: 8,
        padding: '10px 12px',
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: 10,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
            color: 'var(--text-tertiary)',
            fontWeight: 600,
          }}
        >
          Others asked something similar
        </span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss suggestions"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-tertiary)',
            cursor: 'pointer',
            fontSize: 14,
            padding: 0,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {hits.map((hit) => (
          <KbHitCard
            key={hit.id}
            hit={hit}
            onHelpful={() => onHelpful(hit.id)}
            canMarkHelpful={canMarkHelpful}
          />
        ))}
      </div>
    </div>
  );
}

export function KbHitCard({
  hit,
  onHelpful,
  canMarkHelpful = true,
}: {
  hit: AskGgKbHit;
  onHelpful: () => void;
  canMarkHelpful?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      style={{
        background: 'var(--bg-inset)',
        border: '0.5px solid var(--border)',
        borderRadius: 8,
        padding: '8px 10px',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left',
          color: 'var(--text-primary)',
          fontSize: 13,
          fontWeight: 500,
          fontFamily: 'inherit',
        }}
      >
        {hit.title}
      </button>
      {!expanded && (
        <p
          style={{
            margin: '4px 0 6px',
            fontSize: 11,
            color: 'var(--text-tertiary)',
            lineHeight: 1.45,
            whiteSpace: 'pre-wrap',
          }}
          // Snippet contains ts_headline output without HTML markup.
          // Safe to render as plain text.
        >
          {hit.snippet}
        </p>
      )}
      {expanded && (
        <p
          style={{
            margin: '6px 0',
            fontSize: 12,
            color: 'var(--text-secondary)',
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
          }}
        >
          {hit.answer}
        </p>
      )}
      <div
        style={{
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          marginTop: 4,
        }}
      >
        {canMarkHelpful && (
          <button
            type="button"
            onClick={onHelpful}
            style={{
              padding: '3px 10px',
              borderRadius: 6,
              background: 'rgba(120,180,90,0.12)',
              border: '0.5px solid rgba(120,180,90,0.40)',
              color: '#7eb45c',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            This helped
          </button>
        )}
        {!expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            style={{
              padding: '3px 10px',
              borderRadius: 6,
              background: 'transparent',
              border: '0.5px solid var(--border)',
              color: 'var(--text-secondary)',
              fontSize: 11,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Read full answer
          </button>
        )}
        {hit.category && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 10,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: 0.4,
            }}
          >
            {hit.category}
          </span>
        )}
      </div>
    </div>
  );
}
