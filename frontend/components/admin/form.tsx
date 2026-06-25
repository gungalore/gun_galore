import React from 'react';

/**
 * Shared admin form-input style — the object that was copy-pasted into ~7
 * admin form files. Matches the canonical version (bg-inset, 0.5px border,
 * 6px radius, 8/12 padding, 14px). Spread onto <input>/<select>/<textarea>,
 * or override per-field: style={{ ...adminInputStyle, width: 160 }}.
 */
export const adminInputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-primary)',
  borderRadius: '6px',
  padding: '8px 12px',
  fontSize: '14px',
  outline: 'none',
};
