'use client';

/**
 * HEALTH — the audit trail, inside a drawer.
 *
 * ⚠️ THIS IS THE ADMIN AUDIT TRAIL, NOT WARDEN'S RUN LOG, and the two are one
 * word apart in conversation. This one records what a HUMAN did through the
 * Desk — who released a payout, who banned an account, who changed a flag, and
 * the reason they gave. Warden's own executions are on the Agent board under
 * "What has actually run"; they are a different store, a different endpoint
 * and a different question.
 */
import * as React from 'react';
import { Button, Chip, FailedRegion, Section } from '../../../../components/desk';
import { describeFailure } from '../../../../lib/desk-auth';
import {
  AUDIT_PAGE_SIZE,
  AUDIT_RESOURCE_TYPES,
  fetchAudit,
  stamp,
  type AuditRow,
} from '../../../../lib/desk-site';
import { Quiet } from './board-bits';

/**
 * The audit trail — filtered and paged.
 *
 * 🚨 "A RECORD YOU CAN ONLY SEE THE LAST FIFTY ROWS OF IS NOT THE RECORD."
 * The drawer read the newest fifty once, cached it forever, and stopped — so
 * "who released that payout in July" was unanswerable on the single surface
 * that exists to answer it. `offset` was accepted by the server the whole
 * time and never sent; `resourceType` was a declared parameter of fetchAudit
 * that no caller passed.
 *
 * ⚠️ AND THE CACHE GUARD WAS PART OF THE BUG. The parent fetched with
 * `if (!audit)`, which is correct for a list that never changes and wrong the
 * moment a filter exists — the second chip press would have redrawn the first
 * chip's rows. State lives here, keyed on the filter, so that cannot recur.
 */
export function AuditTrail({ open }: { open: boolean }) {
  const [rows, setRows] = React.useState<AuditRow[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [offset, setOffset] = React.useState(0);
  const [resourceType, setResourceType] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const ticket = React.useRef(0);

  const load = React.useCallback(async () => {
    const mine = ++ticket.current;
    setRows(null);
    try {
      const page = await fetchAudit({
        resourceType: resourceType ?? undefined,
        limit: AUDIT_PAGE_SIZE,
        offset,
      });
      if (ticket.current !== mine) return;
      setRows(page.rows);
      setTotal(page.total);
      setFailure(null);
    } catch (err) {
      if (ticket.current !== mine) return;
      setRows([]);
      setFailure(describeFailure(err));
    }
  }, [resourceType, offset]);

  // Only while the drawer is open: this is the most sensitive list on the
  // board and there is no reason to hold it in a closed drawer's state.
  React.useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + AUDIT_PAGE_SIZE, total);

  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '0 0 10px' }}>
        <Chip
          active={resourceType === null}
          onClick={() => {
            setResourceType(null);
            setOffset(0);
          }}
        >
          Everything
        </Chip>
        {AUDIT_RESOURCE_TYPES.map((t) => (
          <Chip
            key={t}
            active={resourceType === t}
            onClick={() => {
              // ⚠️ A NEW FILTER STARTS AT PAGE ONE. Keeping the offset would
              // ask for rows 51–100 of a nine-row set and draw an empty state
              // the operator reads as a fact about the filter.
              setResourceType((cur) => (cur === t ? null : t));
              setOffset(0);
            }}
          >
            {t}
          </Chip>
        ))}
      </div>

      <Section label={total > 0 ? `${from}–${to} of ${total}` : 'Recent'} last>
        {failure ? (
          <FailedRegion
            title="Couldn't read the audit trail"
            detail={failure}
            onRetry={() => void load()}
          />
        ) : !rows ? (
          <Quiet>Loading…</Quiet>
        ) : rows.length === 0 ? (
          <Quiet>
            {resourceType
              ? `Nothing recorded against ${resourceType}.`
              : 'No audit rows.'}
          </Quiet>
        ) : (
          rows.map((r, i) => (
            <div
              key={r.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                padding: '10px 0',
                borderBottom: i === rows.length - 1 ? undefined : '1px solid var(--dk-line)',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="dk-mono" style={{ fontSize: 11.5, color: 'var(--dk-ink)' }}>
                  {r.action}
                </span>
                <span style={{ flex: 1 }} />
                <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>
                  {stamp(r.createdAt)}
                </span>
              </span>
              <span style={{ fontSize: 12, color: 'var(--dk-ink-2)' }}>
                {r.adminUser?.email ?? 'unknown admin'}
                {r.resourceType ? ` · ${r.resourceType}` : ''}
                {r.resourceId ? ` ${r.resourceId.slice(-8)}` : ''}
              </span>
              {r.reason ? (
                <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)', lineHeight: 1.45 }}>
                  “{r.reason}”
                </span>
              ) : null}
            </div>
          ))
        )}

        {total > AUDIT_PAGE_SIZE ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 12 }}>
            <Button
              variant="ghost"
              disabled={offset === 0}
              onClick={() => setOffset((o) => Math.max(0, o - AUDIT_PAGE_SIZE))}
            >
              Newer
            </Button>
            <span style={{ flex: 1 }} />
            <Button
              variant="ghost"
              disabled={to >= total}
              onClick={() => setOffset((o) => o + AUDIT_PAGE_SIZE)}
            >
              Older
            </Button>
          </div>
        ) : null}
      </Section>
    </>
  );
}
