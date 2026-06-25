import React from 'react';

/**
 * Standard admin page header: an h1 title, optional right-aligned meta text
 * (e.g. "12 total · 8 active") and/or action buttons, and an optional
 * description paragraph below. Replaces the bespoke header strips that each
 * admin page hand-rolled with slightly different spacing and type.
 */
export function AdminPageHeader({
  title,
  meta,
  description,
  actions,
}: {
  title: string;
  meta?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="flex items-baseline justify-between flex-wrap gap-3">
        <h1
          className="text-lg font-medium"
          style={{ color: 'var(--text-primary)' }}
        >
          {title}
        </h1>
        {(meta || actions) && (
          <div className="flex items-center gap-3">
            {meta && (
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {meta}
              </span>
            )}
            {actions}
          </div>
        )}
      </div>
      {description && (
        <p
          className="text-sm mt-1"
          style={{ color: 'var(--text-secondary)' }}
        >
          {description}
        </p>
      )}
    </div>
  );
}
