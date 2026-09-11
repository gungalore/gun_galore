'use client';

/**
 * HEALTH — the config gates.
 *
 * ⚠️ TRUTH, NOT CONTROLS, AND THE READ-ONLY TAG IS PART OF THE CARD. Each of
 * these changes in code, with a commit and a reason. A pencil here would be a
 * control for a value that only a deploy can move.
 *
 * ⚠️ THESE ARE THE CONFIG GATES, NOT WARDEN'S CHECK ROWS. The two are one word
 * apart in the UI and completely different facts: a config gate says what a
 * variable is set to, a check row says what was found when somebody looked.
 * They come from the same service — desk-site.service.ts — so this card and
 * GET /admin/warden/gates can never disagree about what PAYMENTS_LIVE is.
 *
 * ⚠️ AND GET /admin/warden/gates STILL HAS NO FRONTEND CALLER. It carries one
 * fact this card does not: `red`, and a `redCount`. Nothing here needs it —
 * red is `tone === 'bad'`, which is computed on the row below — so this is a
 * duplicate endpoint rather than a missing feature. Recorded so the next
 * person who finds it does not wire a second source of the same numbers.
 */
import * as React from 'react';
import { IconLock, Tag } from '../../../../components/desk';
import { Card } from './board-bits';
import type { ConfigGate } from './board';

export function ConfigGates({ gates }: { gates: ConfigGate[] }) {
  const red = gates.filter((g) => g.tone === 'bad').length;
  return (
    <Card
      label="Config gates"
      hint={red ? `${red} red` : 'none red'}
      headerTag={
        <Tag kind="neutral" icon={IconLock}>
          read-only
        </Tag>
      }
      footer="Truth, not controls. Each of these changes in code, with a commit and a reason. Red ones deal a Desk card daily and can never be sunk."
    >
      {gates.map((g, i) => (
        <div
          key={g.key}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '9px 0',
            borderBottom: i === gates.length - 1 ? undefined : '1px solid var(--dk-line)',
          }}
        >
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>{g.label}</span>
            <span className="dk-mono" style={{ fontSize: 10.5, color: 'var(--dk-ink-3)' }}>
              {g.key}
            </span>
            {g.note ? (
              <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)', lineHeight: 1.45 }}>{g.note}</span>
            ) : null}
          </span>
          <Tag
            kind={g.tone === 'bad' ? 'bad' : g.tone === 'warn' ? 'warn' : g.tone === 'ok' ? 'ok' : 'neutral'}
            icon={g.tone === 'bad' ? IconLock : undefined}
          >
            {g.value}
          </Tag>
        </div>
      ))}
    </Card>
  );
}
