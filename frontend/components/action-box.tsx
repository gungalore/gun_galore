import type { ReactNode } from 'react';

/**
 * A static action box: heading, optional description, and one explicit action.
 *
 * ⚠️ THE BOX IS NOT THE BUTTON. The old shop-mode tiles made the entire
 * rectangle a link/button, so every hover, click and caret implied an action
 * the copy did not name. Here the surface is plain; only the action at the
 * bottom is interactive. Do not add onClick/role=button to the outer div.
 */
export interface ActionBoxProps {
  title: string;
  description?: string;
  /** Small icon/managed mark shown left of the heading. */
  icon?: ReactNode;
  /** Optional line under the title, e.g. "3 live listings". */
  meta?: string | null;
  /** A Link, button or other explicit control. Never make the box itself one. */
  action: ReactNode;
  /** Shop-bar boxes drop the description on phones to stay compact. */
  mobileDescription?: boolean;
  className?: string;
}

export function ActionBox({
  title,
  description,
  icon,
  meta,
  action,
  mobileDescription = true,
  className,
}: ActionBoxProps) {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        minWidth: 0,
        minHeight: 64,
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: 8,
        padding: '10px 12px',
      }}
    >
      {icon && (
        <span
          aria-hidden="true"
          style={{
            width: 30,
            height: 30,
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 7,
            background: 'var(--bg-inset)',
          }}
        >
          {icon}
        </span>
      )}
      <div style={{ minWidth: 0, flex: '1 1 140px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
          <h2
            style={{
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1.2,
              margin: 0,
              color: 'var(--text-primary)',
            }}
          >
            {title}
          </h2>
          {meta && (
            <p
              style={{
                fontSize: 10,
                margin: 0,
                color: 'var(--text-tertiary)',
              }}
            >
              {meta}
            </p>
          )}
        </div>
        {description && (
          <p
            className={mobileDescription ? undefined : 'hidden sm:block'}
            style={{
              fontSize: 12,
              lineHeight: 1.35,
              margin: '2px 0 0',
              color: 'var(--text-secondary)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {description}
          </p>
        )}
      </div>
      <div style={{ flexShrink: 0 }}>{action}</div>
    </div>
  );
}

export default ActionBox;
