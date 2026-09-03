'use client';

/**
 * THE DESK — the complaints and support REGISTER.
 *
 * 🚨 THE PILE IS THE WORKLIST; THIS IS THE RECORD. The pile carries OPEN and
 * UNDER_REVIEW complaints only, oldest first, CAPPED AT 25, and support tickets
 * only while status is OPEN. That is right for a daily loop and wrong as the
 * whole of a page: an AWAITING_USER ticket is invisible on the Desk, so a
 * member who answers a question is waiting on nobody, and there is no way to
 * look up a case that has already been resolved.
 *
 * ⚠️ NOT A SIXTH TAB. components/desk/tabs.tsx says of its list: "the five
 * surfaces... nothing configurable about this list". A register is something an
 * operator visits when they have a question, not one of the five places they
 * live, so it is a lens on the pile — the same shape the Ledger uses for its
 * order book, and reachable at ?view=cases.
 *
 * ⚠️ TWO KINDS, TWO BACKENDS, TWO STATE MACHINES. A complaint has
 * UNDER_REVIEW and a support ticket does not; they are different tables with
 * different endpoints. The kind switch is therefore a real switch, not a
 * filter over one list, and CASE_STATES is read per kind so a chip is never
 * offered for a state its table cannot hold.
 */

import * as React from 'react';
import { Button, Chip, FailedRegion, SkeletonPile, Tag } from '@/components/desk';
import {
  CASE_STATES,
  stateTone,
  fetchCasePage,
  type CaseKind,
  type CaseState,
  type CaseSummary,
} from '@/lib/desk-case';
import { describeFailure } from '@/lib/desk-auth';

const PAGE_SIZE = 50;

export interface CasesRegisterProps {
  /** Opens the Case drawer, which the pile already owns. */
  onOpen: (kind: CaseKind, id: string) => void;
  /** Bumped by the parent after a drawer decision, to force a re-read. */
  refreshKey?: number;
}

export function CasesRegister({ onOpen, refreshKey = 0 }: CasesRegisterProps) {
  const [kind, setKind] = React.useState<CaseKind>('complaint');
  const [state, setState] = React.useState<CaseState | null>(null);
  const [page, setPage] = React.useState(1);
  const [rows, setRows] = React.useState<CaseSummary[] | null>(null);
  const [total, setTotal] = React.useState<number | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);

  /** Only the newest read may write — chips outrun the network. */
  const ticket = React.useRef(0);

  const load = React.useCallback(async () => {
    const mine = ++ticket.current;
    setRows(null);
    setFailure(null);
    try {
      const res = await fetchCasePage(kind, state ?? undefined, page, PAGE_SIZE);
      if (ticket.current !== mine) return;
      setRows(res.rows);
      setTotal(res.total);
    } catch (err) {
      if (ticket.current !== mine) return;
      setRows([]);
      setFailure(describeFailure(err));
    }
  }, [kind, state, page]);

  React.useEffect(() => {
    void load();
  }, [load, refreshKey]);

  /**
   * ⚠️ A NEW QUERY STARTS AT PAGE ONE, AND IT IS DONE IN THE HANDLERS. Doing it
   * in an effect keyed on kind/state would fight any future deep link the way
   * the Ledger's note describes: the reader sets status and page together, and
   * an effect would then reset the page it had just been given.
   */
  function chooseKind(next: CaseKind) {
    setKind(next);
    // A state the other table does not have would return an empty list that
    // reads as "no cases like this" rather than "that is not a thing here".
    setState((cur) => (cur && CASE_STATES[next].includes(cur) ? cur : null));
    setPage(1);
  }

  function chooseState(next: CaseState | null) {
    setState(next);
    setPage(1);
  }

  const from = rows && rows.length > 0 ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = rows ? (page - 1) * PAGE_SIZE + rows.length : 0;
  const hasMore = total === null ? (rows?.length ?? 0) === PAGE_SIZE : to < total;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Chip active={kind === 'complaint'} onClick={() => chooseKind('complaint')}>
          Complaints
        </Chip>
        <Chip active={kind === 'support'} onClick={() => chooseKind('support')}>
          Support
        </Chip>
        <span style={{ width: 12 }} />
        <Chip active={state === null} onClick={() => chooseState(null)}>
          Every state
        </Chip>
        {CASE_STATES[kind].map((s) => (
          <Chip key={s} active={state === s} onClick={() => chooseState(state === s ? null : s)}>
            {s.replace(/_/g, ' ').toLowerCase()}
          </Chip>
        ))}
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>
        {/*
          ⚠️ AN UNKNOWN TOTAL IS AN EM DASH, NEVER rows.length. "1–50 of 50"
          printed over the first page of 431 is a number that reads as a fact
          and is a lie. fetchCasePage returns null when the server sent no
          total, and that is rendered as not-measured rather than guessed.
        */}
        {rows === null
          ? 'reading…'
          : rows.length === 0
            ? 'nothing here'
            : total === null
              ? `${from}–${to} of —`
              : `${from}–${to} of ${total}`}
      </div>

      {failure ? (
        <FailedRegion
          title={`Couldn't read the ${kind === 'complaint' ? 'complaints' : 'support'} register`}
          detail={failure}
          onRetry={() => void load()}
        />
      ) : rows === null ? (
        <SkeletonPile count={3} />
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--dk-ink-3)', padding: '18px 0' }}>
          {state
            ? `No ${kind === 'complaint' ? 'complaints' : 'tickets'} in ${state
                .replace(/_/g, ' ')
                .toLowerCase()}.`
            : `No ${kind === 'complaint' ? 'complaints' : 'tickets'} logged.`}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onOpen(c.kind, c.id)}
              aria-haspopup="dialog"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                width: '100%',
                minHeight: 56,
                padding: '10px 4px',
                background: 'transparent',
                border: 'none',
                borderBottom: i === rows.length - 1 ? undefined : '1px solid var(--dk-line)',
                textAlign: 'left',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <span
                className="dk-mono"
                style={{ fontSize: 11, color: 'var(--dk-ink-3)', width: 96, flex: 'none' }}
              >
                {c.reference}
              </span>
              <span style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>{c.subject}</span>
                <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>
                  {c.raisedBy ?? 'no username'}
                  {c.category ? ` · ${c.category}` : ''}
                  {c.messageCount ? ` · ${c.messageCount} message${c.messageCount === 1 ? '' : 's'}` : ''}
                </span>
              </span>
              {/* A frozen payout is the only thing on this row that costs
                  money while it waits, so it outranks the state tag. */}
              {c.payoutFrozen ? <Tag kind="bad">payout held</Tag> : null}
              <Tag kind={stateTone(c.state)}>{c.state.replace(/_/g, ' ').toLowerCase()}</Tag>
            </button>
          ))}
        </div>
      )}

      {rows && rows.length > 0 && (page > 1 || hasMore) ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button variant="ghost" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Newer
          </Button>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>
            Older
          </Button>
        </div>
      ) : null}
    </div>
  );
}
