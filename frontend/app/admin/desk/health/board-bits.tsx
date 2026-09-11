'use client';

/**
 * THE DESK — the rhythm the Site board was written in, now shared by the two
 * surfaces it split into.
 *
 * `Card`, `Row`, `Quiet`, `Pre` and `Stack` were locals at the bottom of the
 * 2,926-line site/page.tsx. Health and Agent both render them, so they moved
 * here rather than being copied — a second `Card` is a second set of paddings,
 * and the one that drifted would be the one on the board nobody had open.
 *
 * ⚠️ NOT PROMOTED INTO components/desk, AND NOT BY ACCIDENT. The kit already
 * owns five card shapes; this is a board-local rhythm — a label row, a hairline
 * list, a small print footer — and promoting it would make the kit own a sixth
 * variant that only two routes ask for. It also cannot be exported from
 * components/desk/index.ts from here: that barrel belongs to another track.
 *
 * ⚠️ IT LIVES UNDER health/ AND AGENT REACHES ACROSS FOR IT, which reads
 * backwards until you count: Health renders these in eight sections and Agent
 * in three. The alternative was a third directory nothing else lives in.
 */
import * as React from 'react';
import { Label } from '../../../../components/desk';

export function Card({
  label,
  hint,
  headerTag,
  footer,
  children,
}: {
  label: React.ReactNode;
  hint?: string;
  headerTag?: React.ReactNode;
  footer?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '14px 16px',
        background: 'var(--dk-surface)',
        border: '1px solid var(--dk-line)',
        borderRadius: 'var(--dk-radius-card)',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Label>{label}</Label>
        {headerTag}
        <span style={{ flex: 1 }} />
        {hint ? <span style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>{hint}</span> : null}
      </span>
      {children}
      {footer ? (
        <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)', lineHeight: 1.45, marginTop: 2 }}>
          {footer}
        </span>
      ) : null}
    </div>
  );
}

export function Row({ children, last = false }: { children: React.ReactNode; last?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '7px 0',
        borderBottom: last ? undefined : '1px solid var(--dk-line)',
      }}
    >
      {children}
    </div>
  );
}

export function Quiet({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)' }}>{children}</span>;
}

/**
 * The chat's code block, reused inside every confirm dialog and inside the
 * trust-and-safety "Show text" reveal.
 *
 * ⚠️ `ground` AND `inset` ARE NOT DECORATION. `inset` is a dry run — what
 * WOULD happen. `ground` already ran. The design gives them different grounds
 * precisely so a proposal's command and a transcript of an execution are never
 * confused at a glance, which on this surface is the difference between "this
 * is what I am about to do to the production box" and "this is what I did".
 */
export function Pre({ children, tone }: { children: string; tone: 'inset' | 'ground' }) {
  return (
    <pre
      className="dk-mono"
      style={{
        margin: 0,
        fontSize: 11.5,
        lineHeight: 1.55,
        color: 'var(--dk-ink-2)',
        background: tone === 'ground' ? 'var(--dk-ground)' : 'var(--dk-inset)',
        border: '1px solid var(--dk-line)',
        borderRadius: 8,
        padding: '10px 12px',
        overflowX: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {children}
    </pre>
  );
}

/** A two-line row. `Row` is one line; this is the same rhythm, stacked. */
export function Stack({ children, last = false }: { children: React.ReactNode; last?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        padding: '10px 0',
        borderBottom: last ? undefined : '1px solid var(--dk-line)',
      }}
    >
      {children}
    </div>
  );
}
