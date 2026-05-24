'use client';

// One row in the notifications inbox.
//
// Active items render with full opacity. Resolved items (only visible
// when the user toggles "Show resolved") render at ~60% opacity with
// a checkmark + "Resolved Xh ago" timestamp.
//
// Tap an item → router.push(item.url). This does NOT mark the item
// resolved — the user has to act on the linked entity (accept the
// offer, dispatch the sale, etc.) to clear it. The only way an item
// disappears from this list is via:
//   * Server-side auto-resolve when the linked entity state changes.
//   * The × dismiss button (only for dismissible: true items).

import Link from 'next/link';
import { timeAgo, type NotificationItem as N } from '@/lib/notifications';

// Inline SVG icon set. iconKey is set by the backend; if it's missing
// or unknown we fall back to a generic bell.
function Icon({ kind }: { kind: string | null }) {
  const props = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    'aria-hidden': true,
  };
  const stroke = { stroke: 'currentColor', strokeWidth: 1.6 } as const;
  switch (kind) {
    case 'offer':
      return (
        <svg {...props}>
          <path d="M3 12l9-9 9 9-9 9z" {...stroke} strokeLinejoin="round" />
          <circle cx="9" cy="9" r="1.4" fill="currentColor" />
        </svg>
      );
    case 'bid':
      return (
        <svg {...props}>
          <path
            d="M14 4l6 6m-3-3l-7 7m-4-4l5 5m-5-5l-3 3 4 4 3-3M4 20h12"
            {...stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'sold':
    case 'transaction':
      return (
        <svg {...props}>
          <path
            d="M5 7h14l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7zM9 7V5a3 3 0 0 1 6 0v2"
            {...stroke}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'dispatch':
    case 'shipping':
      return (
        <svg {...props}>
          <path d="M3 7h11v9H3zM14 10h5l2 3v3h-7" {...stroke} strokeLinejoin="round" />
          <circle cx="7" cy="18" r="1.6" {...stroke} />
          <circle cx="17" cy="18" r="1.6" {...stroke} />
        </svg>
      );
    case 'raffle':
    case 'trophy':
      return (
        <svg {...props}>
          <path
            d="M7 4h10v4a5 5 0 0 1-10 0V4zM7 6H5a2 2 0 0 0 2 2m10-2h2a2 2 0 0 1-2 2M10 16h4l1 4H9l1-4z"
            {...stroke}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'kyc':
    case 'account':
      return (
        <svg {...props}>
          <circle cx="12" cy="8" r="3.5" {...stroke} />
          <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" {...stroke} strokeLinecap="round" />
        </svg>
      );
    case 'broadcast':
      return (
        <svg {...props}>
          <path
            d="M4 9v6l9 4V5L4 9zM4 9h2v6H4z"
            {...stroke}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      );
    default:
      return (
        <svg {...props}>
          <path
            d="M6 9a6 6 0 0 1 12 0v5l1.5 2.5h-15L6 14V9zM10 19a2 2 0 0 0 4 0"
            {...stroke}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      );
  }
}

export function NotificationItem({
  item,
  onDismiss,
}: {
  item: N;
  onDismiss: (id: string) => void;
}) {
  const resolved = item.resolvedAt != null;
  const url = item.url ?? '#';

  const inner = (
    <>
      <span
        aria-hidden
        style={{
          width: 36,
          height: 36,
          flexShrink: 0,
          borderRadius: 8,
          background: resolved ? 'var(--bg-inset)' : 'rgba(200, 16, 46, 0.10)',
          color: resolved ? 'var(--text-tertiary)' : 'var(--red)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon kind={item.iconKey} />
      </span>

      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            fontSize: 14,
            fontWeight: 600,
            color: resolved ? 'var(--text-secondary)' : 'var(--text-primary)',
            marginBottom: 2,
            textDecoration: resolved ? 'line-through' : 'none',
          }}
        >
          {item.title}
        </span>
        <span
          style={{
            display: '-webkit-box',
            fontSize: 12.5,
            color: 'var(--text-secondary)',
            lineHeight: 1.4,
            overflow: 'hidden',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical' as const,
          }}
        >
          {item.body}
          {!resolved && !item.dismissible && (
            <span style={{ color: 'var(--text-tertiary)', marginLeft: 4 }}>
              · Tap to act →
            </span>
          )}
        </span>
        <span
          style={{
            display: 'block',
            fontSize: 11,
            color: 'var(--text-tertiary)',
            marginTop: 4,
          }}
        >
          {resolved && item.resolvedAt
            ? `✓ Resolved ${timeAgo(item.resolvedAt)}`
            : timeAgo(item.createdAt)}
        </span>
      </span>
    </>
  );

  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        borderRadius: 10,
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        marginBottom: 8,
        opacity: resolved ? 0.6 : 1,
      }}
    >
      <Link
        href={url}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flex: 1,
          textDecoration: 'none',
          color: 'inherit',
          minWidth: 0,
        }}
      >
        {inner}
      </Link>

      {!resolved && item.dismissible && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDismiss(item.id);
          }}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-tertiary)',
            fontSize: 18,
            cursor: 'pointer',
            padding: '4px 8px',
            flexShrink: 0,
          }}
        >
          ×
        </button>
      )}

      {!resolved && !item.dismissible && (
        <span
          aria-label="Action needed"
          style={{
            fontSize: 10,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
            padding: '4px 8px',
            borderRadius: 6,
            background: 'rgba(200, 16, 46, 0.10)',
            color: 'var(--red)',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          Act
        </span>
      )}
    </li>
  );
}
