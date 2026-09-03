'use client';

/**
 * THE DESK — the order book.
 *
 * ⚠️ THE WHOLE ROW IS THE TARGET. Every row opens its drawer, so there is no
 * "view" link and no per-row menu: the operator aims at the row, not at a
 * 14-pixel chevron. The chevron at the right is a signpost, not a button.
 *
 * ⚠️ THE TABLE SCROLLS INSIDE ITS OWN CARD, NOT WITH THE PAGE. A 1,100px
 * minimum keeps the Item column from collapsing to two words on a narrow
 * laptop; below that the card scrolls sideways and the page does not. A
 * horizontally scrolling PAGE on an admin surface is how the ribbon ends up
 * half off-screen while the operator is reading a ledger row.
 */
import * as React from 'react';
import { IconChevronRight } from './icons';

export interface Column<T> {
  key: string;
  header: string;
  /** Grid track for this column — "minmax(0, 1fr)", "120px". */
  width: string;
  /** Money and counts are right-aligned so the digits line up. */
  align?: 'left' | 'right';
  render: (row: T) => React.ReactNode;
}

export interface DeskTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onOpen?: (row: T) => void;
  selectedKey?: string;
  /** Shown inside the card when there is nothing to list. */
  empty?: React.ReactNode;
  /** Replaces the rows entirely — a FailedRegion, usually. */
  failed?: React.ReactNode;
  minWidth?: number;
}

export function DeskTable<T>({
  columns,
  rows,
  rowKey,
  onOpen,
  selectedKey,
  empty = 'Nothing to show',
  failed,
  minWidth = 1100,
}: DeskTableProps<T>) {
  const [hovered, setHovered] = React.useState<string | null>(null);
  const template = columns.map((c) => c.width).join(' ') + ' 28px';

  return (
    <div
      style={{
        background: 'var(--dk-surface)',
        border: '1px solid var(--dk-line)',
        borderRadius: 'var(--dk-radius-card)',
        overflow: 'hidden',
      }}
    >
      {failed ? (
        <div style={{ padding: 16 }}>{failed}</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', fontSize: 13, color: 'var(--dk-ink-3)' }}>
          {empty}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth }} role="table">
            <div
              role="row"
              style={{
                display: 'grid',
                gridTemplateColumns: template,
                gap: 12,
                alignItems: 'center',
                height: 38,
                padding: '0 16px',
                background: 'var(--dk-ground)',
                borderBottom: '1px solid var(--dk-line)',
              }}
            >
              {columns.map((c) => (
                <span
                  key={c.key}
                  role="columnheader"
                  className="dk-mono"
                  style={{
                    fontSize: 10.5,
                    fontWeight: 500,
                    letterSpacing: '0.07em',
                    textTransform: 'uppercase',
                    color: 'var(--dk-ink-3)',
                    textAlign: c.align ?? 'left',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.header}
                </span>
              ))}
              <span />
            </div>

            {rows.map((row) => {
              const key = rowKey(row);
              const lit = hovered === key || selectedKey === key;
              return (
                <div
                  key={key}
                  role="row"
                  tabIndex={0}
                  onClick={() => onOpen?.(row)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpen?.(row);
                    }
                  }}
                  onMouseEnter={() => setHovered(key)}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: template,
                    gap: 12,
                    alignItems: 'center',
                    minHeight: 50,
                    padding: '0 16px',
                    borderBottom: '1px solid var(--dk-line)',
                    background: lit ? 'var(--dk-raised)' : 'transparent',
                    cursor: onOpen ? 'pointer' : 'default',
                    transition: 'background 120ms ease-out',
                  }}
                >
                  {columns.map((c) => (
                    <span
                      key={c.key}
                      role="cell"
                      style={{
                        fontSize: 12.5,
                        color: 'var(--dk-ink)',
                        textAlign: c.align ?? 'left',
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {c.render(row)}
                    </span>
                  ))}
                  <IconChevronRight size={14} style={{ color: 'var(--dk-ink-4)' }} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** A reference, wherever one appears in a cell. */
export function Ref({ children }: { children: React.ReactNode }) {
  return (
    <span className="dk-mono" style={{ fontSize: 12, color: 'var(--dk-ink-2)' }}>
      {children}
    </span>
  );
}

/** An amount in a cell — mono, and the caller right-aligns the column. */
export function Amount({ children }: { children: React.ReactNode }) {
  return (
    <span className="dk-mono" style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--dk-ink)' }}>
      {children}
    </span>
  );
}
