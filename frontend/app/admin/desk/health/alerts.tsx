'use client';

/**
 * HEALTH — the alerts inbox.
 *
 * ⚠️ IT OWNS ITS OWN STATE AND ITS OWN FAILURE, which is why moving it was a
 * move and not a rewrite: the filter chips, the cursor paging, the selection
 * and the bulk confirm all live inside this file, so nothing about the split
 * could have coupled it to another section's loader.
 */
import * as React from 'react';
import {
  Button,
  Chip,
  DialogFrame,
  FailedRegion,
  IconAlert,
  Input,
  Tag,
} from '../../../../components/desk';
import { describeFailure } from '../../../../lib/desk-auth';
import {
  bulkResolveAlerts,
  fetchAlertTypeFacets,
  fetchAlerts,
  resolveAlert,
  stamp,
  type AdminAlertRow,
  type AlertFacet,
} from '../../../../lib/desk-site';
import { Card, Quiet, Row } from './board-bits';

/**
 * The alerts inbox.
 *
 * 🚨 THIS CARD ONCE RENDERED "0 unresolved · Nothing unresolved" WHILE ALERTS
 * WERE WAITING, because the type here claimed an envelope and read `.rows` off
 * a bare array. A quiet card reading as all-clear, on the one surface whose
 * entire job is to say otherwise. That is fixed and stays fixed; what this
 * change adds is the rest of what the legacy page did — filter by type from
 * server facets, narrow to urgent, page through every match, and clear a
 * selection in one press.
 *
 * ⚠️ IT OWNS ITS OWN STATE rather than taking rows as props. The parent used
 * to fetch a flat array and drill it down with a resolve callback; filtering,
 * paging and selection would have meant six more props threaded through a
 * component that has nothing to do with alerts.
 */
export function AlertsInbox() {
  // One page. The server caps at what it is asked for; asking for a round
  // number keeps 'is there more' a simple length comparison.
  const PAGE = 50;

  const [rows, setRows] = React.useState<AdminAlertRow[]>([]);
  const [facets, setFacets] = React.useState<AlertFacet[]>([]);
  const [type, setType] = React.useState<string | null>(null);
  const [urgentOnly, setUrgentOnly] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [failure, setFailure] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [exhausted, setExhausted] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  /** Only the newest read may write — chips outrun the network. */
  const ticket = React.useRef(0);

  const load = React.useCallback(async () => {
    const mine = ++ticket.current;
    setLoading(true);
    try {
      const [page, f] = await Promise.all([
        fetchAlerts({ type: type ?? undefined, urgent: urgentOnly || undefined, limit: PAGE }),
        fetchAlertTypeFacets().catch(() => [] as AlertFacet[]),
      ]);
      if (ticket.current !== mine) return;
      setRows(page);
      setFacets(f);
      setExhausted(page.length < PAGE);
      setFailure(null);
      // A selection made under a different filter is a selection of rows the
      // operator can no longer see.
      setSelected(new Set());
    } catch (err) {
      if (ticket.current !== mine) return;
      setRows([]);
      setFailure(describeFailure(err));
    } finally {
      if (ticket.current === mine) setLoading(false);
    }
  }, [type, urgentOnly]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    const last = rows[rows.length - 1];
    if (!last) return;
    const mine = ++ticket.current;
    try {
      const next = await fetchAlerts({
        type: type ?? undefined,
        urgent: urgentOnly || undefined,
        cursor: last.id,
        limit: PAGE,
      });
      if (ticket.current !== mine) return;
      // ⚠️ APPEND, AND DEDUPE ON ID. The server pages forward from a cursor,
      // and a row resolved by someone else between pages can shift the window
      // enough to repeat one. A duplicate key would break React's list and a
      // duplicate row would be resolved twice.
      setRows((cur) => {
        const seen = new Set(cur.map((r) => r.id));
        return [...cur, ...next.filter((r) => !seen.has(r.id))];
      });
      setExhausted(next.length < PAGE);
    } catch (err) {
      if (ticket.current === mine) setActionError(describeFailure(err));
    }
  }

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function resolveOne(id: string) {
    setActionError(null);
    try {
      await resolveAlert(id);
      setRows((xs) => xs.filter((x) => x.id !== id));
    } catch (err) {
      setActionError(describeFailure(err));
    }
  }

  async function resolveSelected() {
    setBusy(true);
    setActionError(null);
    try {
      const result = await bulkResolveAlerts([...selected], reason);
      setSelected(new Set());
      setConfirming(false);
      setReason('');
      /**
       * 🚨 REPORT THE TALLY, AND RE-READ RATHER THAN SPLICE. The endpoint
       * loops the single-alert path and returns {resolved, skipped, failed}:
       * a row someone else cleared between the render and the press comes
       * back SKIPPED, one that genuinely errored comes back FAILED, and the
       * response carries skippedIds but no failedIds — so the client CANNOT
       * work out which rows survived. Removing every selected id on a 200
       * would hide rows that are still open and still need somebody, which is
       * the exact failure this tally exists to prevent. The server knows;
       * asking it again is both simpler and correct.
       */
      if (result.skipped + result.failed > 0) {
        setActionError(
          `${result.resolved} resolved. ${result.skipped} were already handled and ${result.failed} did not go through — the list below is re-read, so anything still open is still here.`,
        );
      }
      await load();
    } catch (err) {
      setActionError(describeFailure(err));
    } finally {
      setBusy(false);
    }
  }

  const total = facets.reduce((n, f) => n + f.unresolved, 0);
  const shownType = type ? facets.find((f) => f.type === type) : null;

  return (
    <Card
      label="Alerts"
      hint={
        loading
          ? 'reading…'
          : total === 0
            ? 'none unresolved'
            : type
              ? `${rows.length} of ${shownType?.unresolved ?? rows.length} ${type}`
              : `${rows.length} of ${total} unresolved`
      }
      footer="Warden replaces this inbox once it is deployed. Until then it is the only place these types surface at all — so it filters, pages and clears in bulk, because there is no longer a legacy page behind it to fall back to."
    >
      {/* ⚠️ THE CHIPS ARE SERVER FACETS, NOT A HARD-CODED LIST. ~45 alert
          types are raised from 52 call sites with free-form strings, so any
          list written here would be wrong within a month — and a chip for a
          type nothing raises is a filter that always returns nothing. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingBottom: 4 }}>
        <Chip active={type === null} onClick={() => setType(null)}>
          Everything
        </Chip>
        <Chip active={urgentOnly} onClick={() => setUrgentOnly((u) => !u)}>
          Urgent only
        </Chip>
        {facets.slice(0, 8).map((f) => (
          <Chip
            key={f.type}
            active={type === f.type}
            count={f.unresolved}
            onClick={() => setType((cur) => (cur === f.type ? null : f.type))}
          >
            {f.type}
          </Chip>
        ))}
      </div>

      {failure ? (
        <FailedRegion title="Couldn't load alerts" detail={failure} onRetry={() => void load()} />
      ) : null}
      {actionError ? (
        <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--dk-bad)' }}>{actionError}</span>
      ) : null}

      {selected.size > 0 ? (
        <Row>
          <span style={{ fontSize: 12.5, color: 'var(--dk-ink)', flex: 1 }}>
            {`${selected.size} selected`}
          </span>
          <Button variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
          <Button variant="primary" onClick={() => setConfirming(true)}>
            Resolve selected…
          </Button>
        </Row>
      ) : null}

      {!loading && rows.length === 0 && !failure ? (
        <Quiet>
          {type || urgentOnly
            ? 'Nothing unresolved under this filter.'
            : 'Nothing unresolved.'}
        </Quiet>
      ) : (
        rows.map((a, i) => (
          <Row key={a.id} last={i === rows.length - 1}>
            <input
              type="checkbox"
              checked={selected.has(a.id)}
              onChange={() => toggle(a.id)}
              aria-label={`Select ${a.type}`}
              style={{ flex: 'none', cursor: 'pointer' }}
            />
            <Tag kind={a.urgent ? 'bad' : 'neutral'} icon={a.urgent ? IconAlert : null}>
              {a.type}
            </Tag>
            <span style={{ fontSize: 12.5, color: 'var(--dk-ink-2)', minWidth: 0, flex: 1 }}>
              {a.context ?? '—'}
            </span>
            <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>
              {stamp(a.createdAt)}
            </span>
            <Button variant="ghost" onClick={() => void resolveOne(a.id)}>
              Resolve
            </Button>
          </Row>
        ))
      )}

      {!exhausted && rows.length > 0 ? (
        <Row last>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" onClick={() => void loadMore()}>
            Load more
          </Button>
        </Row>
      ) : null}

      {confirming ? (
        <DialogFrame
          label="Resolve alerts"
          title={`Resolve ${selected.size} alert${selected.size === 1 ? '' : 's'}`}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void resolveSelected()} disabled={busy}>
                {busy ? 'Resolving…' : 'Resolve them'}
              </Button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--dk-ink-2)' }}>
              This marks them handled. It does not fix what raised them — an alert
              is a message about something that already happened.
            </span>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why, if it is worth saying — optional, goes in the audit trail"
            />
          </div>
        </DialogFrame>
      ) : null}
    </Card>
  );
}
