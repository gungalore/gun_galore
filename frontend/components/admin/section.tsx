import React from 'react';

/**
 * Section heading + body, the pattern that was redefined as a local
 * `Section` on ~8 admin pages. `className` defaults to mb-6 (the common
 * spacing); pass mb-5 etc. to match a page exactly. Optional right-aligned
 * `actions` slot for section-level buttons.
 */
export function AdminSection({
  title,
  subtitle,
  children,
  className = 'mb-6',
  actions,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className={className}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <p
            className="text-sm font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            {title}
          </p>
          {subtitle && (
            <p
              className="text-xs mt-0.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {subtitle}
            </p>
          )}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

/**
 * Key→value list inside a bordered card — the local `DataList` pattern from
 * the detail dossiers. Values accept any node (string, chip, link).
 */
export function AdminDataList({
  rows,
}: {
  rows: [string, React.ReactNode][];
}) {
  return (
    <div
      className="rounded-[8px] overflow-hidden"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
    >
      {rows.map(([k, v], i) => (
        <div
          key={`${k}-${i}`}
          className="flex gap-3 px-4 py-2 text-xs"
          style={
            i < rows.length - 1
              ? { borderBottom: '0.5px solid var(--border)' }
              : undefined
          }
        >
          <span style={{ color: 'var(--text-tertiary)', minWidth: 120 }}>{k}</span>
          <span style={{ color: 'var(--text-secondary)', flex: 1, wordBreak: 'break-word' }}>
            {v}
          </span>
        </div>
      ))}
    </div>
  );
}
