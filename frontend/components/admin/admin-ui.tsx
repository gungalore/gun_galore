'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/* ── Icons ─────────────────────────────────────────────────────────────
 * Inline SVG only. The panel carries no icon library, and a glyph that is
 * one path is not worth a dependency.
 */

export type AdminIconName =
  | 'shield'
  | 'wallet'
  | 'users'
  | 'layers'
  | 'chart'
  | 'search'
  | 'chevron'
  | 'check'
  | 'close'
  | 'refresh'
  | 'alert'
  | 'eye'
  | 'trash'
  | 'bolt'
  | 'clock'
  | 'logout'
  | 'lock'
  | 'doc'
  | 'truck'
  | 'flag'
  | 'message'
  | 'server'
  | 'terminal';

const PATHS: Record<AdminIconName, ReactNode> = {
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  wallet: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M6 12h.01M18 12h.01" />
    </>
  ),
  users: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  layers: (
    <>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </>
  ),
  chart: (
    <>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </>
  ),
  chevron: <polyline points="9 18 15 12 9 6" />,
  check: <polyline points="20 6 9 17 4 12" />,
  close: (
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <polyline points="21 3 21 9 15 9" />
    </>
  ),
  alert: (
    <>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  eye: (
    <>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  trash: (
    <>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </>
  ),
  bolt: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </>
  ),
  lock: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  doc: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </>
  ),
  truck: (
    <>
      <path d="M3 6h11v9H3zM14 9h4l3 3v3h-7z" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17" cy="18" r="1.6" />
    </>
  ),
  flag: (
    <>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </>
  ),
  message: (
    <>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </>
  ),
  server: (
    <>
      <rect x="2" y="2" width="20" height="8" rx="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </>
  ),
  terminal: (
    <>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </>
  ),
};

export function Icon({
  name,
  size = 18,
}: {
  name: AdminIconName;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

/* ── Tones ─────────────────────────────────────────────────────────── */

export type AdminTone = 'cyan' | 'green' | 'amber' | 'red' | 'purple' | 'muted';

/* ── Card ──────────────────────────────────────────────────────────── */

export function NeonCard({
  tone,
  title,
  titleTone,
  action,
  children,
  className,
}: {
  tone?: AdminTone;
  title?: ReactNode;
  titleTone?: AdminTone;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`adm-card${className ? ` ${className}` : ''}`}
      data-tone={tone && tone !== 'muted' ? tone : undefined}
    >
      {(title || action) && (
        <header className="adm-card-head">
          {title ? (
            <span className="adm-card-title" data-tone={titleTone}>
              {title}
            </span>
          ) : (
            <span />
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/* ── Pill ──────────────────────────────────────────────────────────── */

export function Pill({
  tone = 'muted',
  children,
}: {
  tone?: AdminTone;
  children: ReactNode;
}) {
  return (
    <span className="adm-pill" data-tone={tone}>
      {children}
    </span>
  );
}

/* ── KPI tile ──────────────────────────────────────────────────────── */

export function KpiTile({
  label,
  value,
  trend,
  tone,
}: {
  label: string;
  value: string;
  trend?: string;
  tone?: AdminTone;
}) {
  const trendColor =
    tone === 'green'
      ? 'var(--adm-green)'
      : tone === 'red'
        ? 'var(--adm-red)'
        : tone === 'amber'
          ? 'var(--adm-amber)'
          : 'var(--adm-ink-2)';
  return (
    <div className="adm-kpi">
      <span className="adm-kpi-label">{label}</span>
      <span className="adm-kpi-value">{value}</span>
      {trend ? (
        <span className="adm-kpi-trend" style={{ color: trendColor }}>
          {trend}
        </span>
      ) : null}
    </div>
  );
}

/* ── Action row ────────────────────────────────────────────────────── */

export function ActionRow({
  icon,
  tone = 'cyan',
  title,
  caption,
  trailing,
  onClick,
  disabled,
}: {
  icon?: AdminIconName;
  tone?: AdminTone;
  title: ReactNode;
  caption?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      className="adm-row"
      onClick={onClick}
      disabled={onClick ? disabled : undefined}
      type={onClick ? 'button' : undefined}
    >
      <span className="adm-row-left">
        {icon ? (
          <span className="adm-icon" data-tone={tone}>
            <Icon name={icon} />
          </span>
        ) : null}
        <span className="adm-row-text">
          <span className="adm-row-title">{title}</span>
          {caption ? <span className="adm-row-caption">{caption}</span> : null}
        </span>
      </span>
      {trailing ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {trailing}
        </span>
      ) : null}
    </Tag>
  );
}

/* ── Toggle ────────────────────────────────────────────────────────── */

export function ToggleSwitch({
  checked,
  danger,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  danger?: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label className="adm-switch">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        data-danger={danger ? 'true' : undefined}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="adm-switch-track" />
    </label>
  );
}

/* ── Empty / loading ───────────────────────────────────────────────── */

export function EmptyState({
  icon = 'check',
  title,
  caption,
}: {
  icon?: AdminIconName;
  title: string;
  caption?: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        padding: '22px 8px',
        textAlign: 'center',
      }}
    >
      <span style={{ color: 'var(--adm-ink-3)' }}>
        <Icon name={icon} size={22} />
      </span>
      <span style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>
      {caption ? (
        <span style={{ fontSize: 11.5, color: 'var(--adm-ink-2)' }}>
          {caption}
        </span>
      ) : null}
    </div>
  );
}

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="adm-skeleton" style={{ height: 54 }} />
      ))}
    </div>
  );
}

/* ── Toast ─────────────────────────────────────────────────────────── */

interface ToastValue {
  toast: (message: string, tone?: 'cyan' | 'red') => void;
}

const ToastContext = createContext<ToastValue>({ toast: () => {} });

export function useAdminToast(): ToastValue {
  return useContext(ToastContext);
}

export function AdminToastProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    message: string;
    tone: 'cyan' | 'red';
    open: boolean;
  }>({ message: '', tone: 'cyan', open: false });

  const toast = useCallback((message: string, tone: 'cyan' | 'red' = 'cyan') => {
    setState({ message, tone, open: true });
    window.setTimeout(
      () => setState((s) => ({ ...s, open: false })),
      3200,
    );
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="adm-toast" data-open={state.open} data-tone={state.tone}>
        <span
          style={{
            color: state.tone === 'red' ? 'var(--adm-red)' : 'var(--adm-cyan)',
          }}
        >
          ●
        </span>
        {state.message}
      </div>
    </ToastContext.Provider>
  );
}
