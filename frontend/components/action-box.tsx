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
  className?: string;
}

export function ActionBox({
  title,
  description,
  icon,
  meta,
  action,
  className,
}: ActionBoxProps) {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minWidth: 0,
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: 8,
        padding: '14px 15px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {icon && (
          <span
            aria-hidden="true"
            style={{
              width: 34,
              height: 34,
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
        <div style={{ minWidth: 0 }}>
          <h2
            style={{
              fontSize: 15,
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
                fontSize: 11,
                margin: '3px 0 0',
                color: 'var(--text-tertiary)',
              }}
            >
              {meta}
            </p>
          )}
        </div>
      </div>

      {description && (
        <p
          style={{
            fontSize: 13,
            lineHeight: 1.45,
            margin: '9px 0 0',
            color: 'var(--text-secondary)',
          }}
        >
          {description}
        </p>
      )}

      <div style={{ marginTop: 'auto', paddingTop: 12 }}>{action}</div>
    </div>
  );
}

export default ActionBox;
