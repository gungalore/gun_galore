'use client';

/**
 * THE DESK — People.
 *
 * Members and SAPS dealers behind one search, with segments as chips. A row
 * opens the Member drawer over the list rather than navigating: the decision
 * is made on top of the queue and closing it puts the operator back on the
 * same row, in the same segment, with the same search still typed.
 *
 * ⚠️ VERIFYING IS THE DEFAULT SEGMENT WHEN ANYONE IS WAITING. That is the only
 * segment with people in it who are blocked on the operator; Everyone is a
 * directory, and opening on a directory buries the work.
 *
 * ⚠️ USERNAMES IN THE LIST, REAL NAMES ONLY INSIDE A DECISION. See
 * lib/desk-people.ts.
 *
 * ⚠️ THE DEALERS SEGMENT READS A DIFFERENT TABLE FROM EVERY OTHER SEGMENT.
 * Four of its five views are the SAPS-licensed dealer DIRECTORY — businesses
 * that checkout offers to a buyer choosing DEALER_TRANSFER — and the fifth is
 * the member list filtered to sellerTier = DEALER. They sit next to each other
 * and they are not the same thing, so the segment says which one is on screen
 * in words above the list rather than leaving it to be inferred.
 */
import * as React from 'react';
import {
  Button,
  Checkbox,
  Chip,
  DeskShell,
  DialogFrame,
  FailedRegion,
  IconAlert,
  IconCheck,
  IconChevronRight,
  IconClose,
  IconInfo,
  IconPencil,
  IconSearch,
  IconShield,
  Input,
  Kv,
  Label,
  MemberDrawer,
  RadioRow,
  ResultBlock,
  SkeletonPile,
  Tag,
} from '@/components/desk';
import {
  DEALER_ACTIVATE_REASONS,
  DEALER_DEACTIVATE_REASONS,
  DEALER_EDIT_REASONS,
  DEALER_LIST_CAP,
  DEALER_VERIFY_REASONS,
  MIN_DEALER_REASON,
  PEOPLE_PAGE_SIZE,
  PROVINCES,
  composeDealerReason,
  createDealer,
  dealerDetailsOf,
  dealerFullAddress,
  dealerLocation,
  dealerSeen,
  dealerStanding,
  describeDealerFailure,
  emptyDealerDetails,
  fetchDealers,
  fetchPeople,
  initials,
  isAutoRegistered,
  missingDealerFields,
  ocrDiffers,
  pageWindow,
  provinceLabel,
  reviewDealer,
  saveDealerDetails,
  setDealerActive,
  bulkBanUsers,
  describeSweep,
  unsweepableReason,
  BULK_BAN_CAP,
  BULK_BAN_MIN_REASON,
  waitedFor,
  type DealerDetails,
  type DealerReasonChoice,
  type DealerRow,
  type DealerView,
  type PageWindow,
  type PersonRow,
  type Segment,
} from '@/lib/desk-people';
import { describeFailure } from '@/lib/desk-auth';

/*
 * ⚠️ A SEGMENT IS ONLY REAL IF getUsers HAS THE FILTER. There is no Sellers
 * chip here for that reason and not by oversight — see SEGMENT_FILTER. Adding
 * one whose filter name the server does not recognise renders the entire
 * directory under its label, with no error anywhere to say so.
 */
const SEGMENTS: { key: Segment; label: string }[] = [
  { key: 'everyone', label: 'Everyone' },
  { key: 'verifying', label: 'Verifying' },
  { key: 'banned', label: 'Banned' },
  // ⚠️ Its own segment, never folded into Banned. A closed account is a member
  // who left; a banned one is a member who was stopped. See SEGMENT_FILTER.
  { key: 'closed', label: 'Closed' },
  { key: 'dealers', label: 'Dealers' },
];

const DEALER_VIEWS: { key: DealerView; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'pending', label: 'Pending review' },
  { key: 'auto', label: 'Auto-added' },
  { key: 'all', label: 'All' },
  { key: 'members', label: 'Dealer members' },
];

export default function PeoplePage() {
  const [segment, setSegment] = React.useState<Segment>('verifying');
  const [search, setSearch] = React.useState('');
  const [pageIndex, setPageIndex] = React.useState(1);
  const [dealerView, setDealerView] = React.useState<DealerView>('pending');
  const [page, setPage] = React.useState<{ users: PersonRow[]; total: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  /**
   * The member whose drawer is open.
   *
   * ⚠️ ONE DOOR TO A VERIFICATION DECISION, AND IT IS THE ONE THAT SHOWS WHAT
   * IS BEING DECIDED. The row used to expand into an inline Approve, which
   * meant a seller could be approved from a strip that never showed the
   * identity document or the face-match the approval rests on. The drawer
   * carries the reveal, the reasons and the ban and bank levers; the row is
   * now only the way in.
   */
  const [openMemberId, setOpenMemberId] = React.useState<string | null>(null);

  /**
   * The bulk sweep — off unless the operator turns it on.
   *
   * 🚨 THIS CONTROL WAS HELD BACK ON PURPOSE UNTIL IT COULD BE HONEST. The
   * cutover note recorded why: the legacy sweep is safe only because its
   * checkbox column greys out already-banned and closed accounts, and a
   * confirm that could not tell them apart would name a count it could not
   * vouch for. The row now carries a disabled checkbox with the reason on
   * hover, and the confirm names the ELIGIBLE count, not the selected one.
   */
  const [sweeping, setSweeping] = React.useState(false);
  const [swept, setSwept] = React.useState<Set<string>>(new Set());
  const [sweepConfirm, setSweepConfirm] = React.useState(false);
  const [sweepReason, setSweepReason] = React.useState('');
  const [sweepBusy, setSweepBusy] = React.useState(false);
  const [sweepResult, setSweepResult] = React.useState<string | null>(null);

  /**
   * `?member=<userId>` opens straight onto one member's drawer.
   *
   * This is where a Members hit in the global search lands. The drawer fetches
   * its own dossier from the id, so nothing has to be found in the list first
   * — which matters, because the member being searched for is frequently NOT
   * in the current segment (a closed account, or a buyer while the board is
   * filtered to sellers). Waiting to match a row would have made search
   * silently fail on exactly the members hardest to reach by browsing.
   *
   * ⚠️ window.location, NOT useSearchParams — the same call the Ledger and the
   * Site board make, and for the same reason: reading the hook in a client
   * board drags a Suspense boundary around the whole page for a value that
   * matters once, at mount.
   */
  React.useEffect(() => {
    const deep = new URLSearchParams(window.location.search).get('member');
    if (deep) setOpenMemberId(deep);
    // Mount only. A later render must not re-read a URL this page is writing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The Dealers segment reads the SAPS directory in four of its five views;
  // the fifth is the member list, which the ordinary people fetch serves.
  const onDirectory = segment === 'dealers' && dealerView !== 'members';

  /**
   * ⚠️ THE LAST REQUEST WINS, NOT THE LAST RESPONSE.
   *
   * The debounce staggers the calls; it does not order the replies. Type
   * "smit", pause, type "h", and two fetches are in flight — if the first
   * comes back slower the board settles on the results for "smit" under a box
   * reading "smith", and there is nothing on screen to say the list and the
   * query disagree. Every settle is stamped and a stale one is dropped.
   */
  const runRef = React.useRef(0);

  const load = React.useCallback(async () => {
    if (onDirectory) return;
    const run = ++runRef.current;
    try {
      const next = await fetchPeople(segment, search, pageIndex);
      if (run !== runRef.current) return;
      setPage(next);
      setError(null);
    } catch (err) {
      if (run !== runRef.current) return;
      setError(describeFailure(err));
    }
  }, [segment, search, pageIndex, onDirectory]);

  React.useEffect(() => {
    // 200ms of quiet before searching — the same debounce the palette uses.
    const id = setTimeout(() => void load(), search ? 200 : 0);
    return () => clearTimeout(id);
  }, [load, search]);

  /**
   * ⚠️ A SEGMENT IS A DIFFERENT POPULATION, SO THE OLD ONE COMES OFF SCREEN.
   *
   * Keeping the previous rows through the fetch leaves the header printing
   * "1,284 in banned" over a list of everyone — a count that belongs to the
   * segment just left, under the name of the one being entered. Deliberately
   * NOT keyed on the search box: blanking to a skeleton on every keystroke
   * would be worse than a stale character.
   */
  React.useEffect(() => {
    setPage(null);
    setError(null);
  }, [segment]);

  /**
   * ⚠️ A NEW QUERY STARTS AT PAGE ONE, ALWAYS.
   *
   * Without this, searching a surname from page four asks the server for rows
   * 151–200 of a result set with eleven rows in it and renders "Nobody in this
   * segment" — the one empty state an operator reads as fact. The reset is
   * keyed on the query itself rather than folded into each setter, so a
   * segment chip, the search box and any future deep-link cannot each forget
   * it separately.
   */
  React.useEffect(() => {
    setPageIndex(1);
  }, [segment, search, dealerView]);

  const rows = page?.users ?? [];
  const pageBounds = page ? pageWindow(page.total, pageIndex) : null;
  const segmentLabel = SEGMENTS.find((s) => s.key === segment)?.label.toLowerCase();

  const memberList = error ? (
    <FailedRegion title="Couldn't load people" detail={error} onRetry={() => void load()} />
  ) : !page ? (
    <SkeletonPile count={3} />
  ) : rows.length === 0 ? (
    <Empty>
      {pageIndex > 1
        ? 'Nothing on this page — the list got shorter while you were reading it.'
        : search
          ? `Nobody matches “${search}” in this segment.`
          : 'Nobody in this segment.'}
    </Empty>
  ) : (
    <>
      {/* ⚠️ THE SWEEP IS OFF BY DEFAULT AND IS TURNED ON DELIBERATELY. A
          checkbox column standing open on the members board invites a sweep
          as the normal way to work, and it is not — individual bans are in
          the Member drawer, where the operator can see who they are banning.
          This is for a burst of the same offender pattern, and nothing else. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 8 }}>
        <span style={{ flex: 1 }} />
        <Button
          variant="ghost"
          onClick={() => {
            setSweeping((on) => !on);
            setSwept(new Set());
          }}
        >
          {sweeping ? 'Cancel sweep' : 'Ban several…'}
        </Button>
      </div>

      {sweeping && swept.size > 0 ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '9px 12px',
            marginBottom: 8,
            borderRadius: 'var(--dk-radius-control)',
            background: 'var(--dk-inset)',
            border: '1px solid var(--dk-line-2)',
          }}
        >
          <span style={{ fontSize: 12.5, color: 'var(--dk-ink)', flex: 1 }}>
            {describeSweep(rows.filter((r) => swept.has(r.id))).sentence}
          </span>
          <Button variant="ghost" onClick={() => setSwept(new Set())}>
            Clear
          </Button>
          <Button
            variant="primary"
            disabled={describeSweep(rows.filter((r) => swept.has(r.id))).eligible.length === 0}
            onClick={() => setSweepConfirm(true)}
          >
            Ban them…
          </Button>
        </div>
      ) : null}

      <div
        style={{
          background: 'var(--dk-surface)',
          border: '1px solid var(--dk-line)',
          borderRadius: 'var(--dk-radius-card)',
          overflow: 'hidden',
        }}
      >
        {rows.map((u, i) => (
          <PersonListRow
            key={u.id}
            person={u}
            last={i === rows.length - 1}
            open={openMemberId === u.id}
            onOpen={() => setOpenMemberId(u.id)}
            selected={swept.has(u.id)}
            onToggle={
              sweeping
                ? () =>
                    setSwept((cur) => {
                      const next = new Set(cur);
                      if (next.has(u.id)) next.delete(u.id);
                      else next.add(u.id);
                      return next;
                    })
                : undefined
            }
          />
        ))}
      </div>
      {pageBounds ? (
        <Pager bounds={pageBounds} pageIndex={pageIndex} total={page.total} onPage={setPageIndex} />
      ) : null}
    </>
  );

  return (
    <DeskShell
      active="people"
      title="People"
      sub={
        onDirectory
          ? 'SAPS dealer directory'
          : page
            ? `${page.total} in ${segmentLabel}`
            : 'Loading…'
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em' }}>People</span>
        <span style={{ flex: 1 }} />
        <div style={{ width: 360, maxWidth: '100%' }}>
          <Input
            icon={IconSearch}
            /* ⚠️ THE PLACEHOLDER NAMES WHAT THE SERVER MATCHES ON, and for
               members that is username, first name, last name and email.
               Typing a real name into a field is not the privacy problem;
               rendering one back is, and PersonRow is narrowed so the result
               of a surname search is still a list of handles. */
            placeholder={
              onDirectory ? 'Search dealer name, licence or city' : 'Search username, name or email'
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search people"
            trailing={
              search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 20,
                    height: 20,
                    flex: 'none',
                    padding: 0,
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 'var(--dk-radius-pill)',
                    color: 'var(--dk-ink-3)',
                    cursor: 'pointer',
                  }}
                >
                  <IconClose size={13} />
                </button>
              ) : null
            }
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {SEGMENTS.map((s) => (
          <Chip key={s.key} active={segment === s.key} onClick={() => setSegment(s.key)}>
            {s.label}
          </Chip>
        ))}
      </div>

      {segment === 'dealers' ? (
        <DealersSegment
          view={dealerView}
          onView={setDealerView}
          search={search}
          memberList={memberList}
        />
      ) : (
        memberList
      )}

      {/*
        Mounted only while a member is open, so the drawer's own unmount
        cleanup frees any decrypted identity document it revealed. See the
        release-on-close note in member-drawer.tsx.
      */}
      {sweepConfirm ? (
        <SweepConfirm
          people={(page?.users ?? []).filter((u) => swept.has(u.id))}
          reason={sweepReason}
          onReason={setSweepReason}
          busy={sweepBusy}
          onClose={() => setSweepConfirm(false)}
          onConfirm={async () => {
            const { eligible } = describeSweep((page?.users ?? []).filter((u) => swept.has(u.id)));
            setSweepBusy(true);
            try {
              const res = await bulkBanUsers(
                eligible.map((p) => p.id),
                sweepReason,
              );
              setSweepResult(
                `${res.processed} banned${res.skipped ? `, ${res.skipped} skipped by the server` : ''}.`,
              );
              setSweepConfirm(false);
              setSweeping(false);
              setSwept(new Set());
              setSweepReason('');
              void load();
            } catch (err) {
              setSweepResult(describeFailure(err));
            } finally {
              setSweepBusy(false);
            }
          }}
        />
      ) : null}

      {sweepResult ? (
        <ResultBlock
          ok={!sweepResult.toLowerCase().includes('http')}
          tag="Sweep"
          body={sweepResult}
        />
      ) : null}

      {openMemberId ? (
        <MemberDrawer
          open
          userId={openMemberId}
          onClose={() => setOpenMemberId(null)}
          /*
           * ⚠️ A DECISION MOVES THE MEMBER BETWEEN SEGMENTS. Approving takes
           * them out of Verifying; a ban puts them into Banned. The segment is
           * a server-side filter, so the only way the list the operator is
           * working through stays the list the server agrees with is to read
           * it again — editing the row in place would leave an approved seller
           * sitting in Verifying until the next search.
           */
          onChanged={() => void load()}
        />
      ) : null}
    </DeskShell>
  );
}

/**
 * One member, as a row that opens their drawer.
 *
 * ⚠️ A ROW IS A BUTTON, NOT A DIV THAT LISTENS FOR A CLICK. This panel is run
 * by keyboard as often as by mouse, and a div with an onClick is invisible to
 * Tab, silent to a screen reader and deaf to Enter and Space.
 *
 * 🚨 EVERYTHING ON THIS ROW IS PUBLIC-SAFE: a handle, a join date, a
 * verification state and a wait. The accessible name is built from that same
 * content, so nothing here puts a real name into a screen reader's buffer
 * either. See lib/desk-people.ts.
 */
function PersonListRow({
  person,
  last,
  open,
  onOpen,
  selected,
  onToggle,
}: {
  person: PersonRow;
  last: boolean;
  open: boolean;
  onOpen: () => void;
  /** Omitted when the sweep is off — the row is then exactly as it was. */
  selected?: boolean;
  onToggle?: () => void;
}) {
  /**
   * ⚠️ THE CHECKBOX SITS BESIDE THE BUTTON, NOT INSIDE IT. The row is a single
   * button that opens the drawer, and a checkbox nested in a button is invalid
   * markup that browsers resolve by dropping one of them — the same trap the
   * trust-and-safety rows hit with their Show-text control.
   *
   * ⚠️ AND IT IS DISABLED, NOT HIDDEN, when a row cannot be swept. A missing
   * checkbox reads as a rendering glitch; a disabled one with a reason on
   * hover says why, which is the whole safety property the legacy sweep had
   * and the reason this control was held back until the Desk could match it.
   */
  const blocked = unsweepableReason(person);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        borderBottom: last ? undefined : '1px solid var(--dk-line)',
      }}
    >
      {onToggle ? (
        <input
          type="checkbox"
          checked={Boolean(selected) && !blocked}
          disabled={Boolean(blocked)}
          onChange={onToggle}
          title={blocked ?? undefined}
          aria-label={`Select ${person.username ?? 'this member'}`}
          style={{
            flex: 'none',
            marginLeft: 16,
            cursor: blocked ? 'not-allowed' : 'pointer',
          }}
        />
      ) : null}
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          width: '100%',
          minHeight: 60,
          padding: '10px 16px',
          background: open ? 'var(--dk-raised)' : 'transparent',
          border: 'none',
          textAlign: 'left',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 34,
            height: 34,
            flex: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '50%',
            background: 'var(--dk-inset)',
            border: '1px solid var(--dk-line-2)',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--dk-ink-2)',
          }}
        >
          {initials(person.username)}
        </span>

        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {/* ⚠️ TRUNCATES, because this row does not wrap. It is a single
                non-wrapping flex line — avatar, this block, an optional KYC
                tag, a fixed 110px "waited for" column, a chevron — and on a
                390px phone a long username had nothing telling it to stop, so
                it pushed the columns to its right off the edge instead of
                ellipsing. minWidth:0 on the parent is half the fix: a flex item
                will not shrink below its content width without it. */}
            <span
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: 'var(--dk-ink)',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              @{person.username ?? 'unknown'}
            </span>
            {person.sellerTier === 'DEALER' ? <Tag kind="ink">SAPS dealer</Tag> : null}
            {/* ⚠️ Deliberately NOT a bad-red tag, and not the word "banned" in
                any tone. A closure is a member leaving; a ban is a member being
                stopped. An operator scanning this column has to be able to tell
                the two apart at a glance, and painting a closure red reads as
                an accusation against someone who did nothing wrong. */}
            {person.accountClosedAt ? <Tag kind="neutral">Closed</Tag> : null}
          </span>
          <span style={{ fontSize: 12, color: 'var(--dk-ink-3)' }}>
            {person.isBanned
              ? 'Banned'
              : `Joined ${new Date(person.createdAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', timeZone: 'Africa/Johannesburg' })}`}
          </span>
        </span>

        {person.kycStatus && person.kycStatus !== 'VERIFIED' ? (
          <Tag kind={person.kycStatus === 'UNDER_REVIEW' ? 'warn' : 'neutral'} icon={null}>
            {person.kycStatus === 'UNDER_REVIEW' ? 'Verifying' : person.kycStatus}
          </Tag>
        ) : null}

        <span
          className="dk-mono"
          style={{ width: 110, flex: 'none', textAlign: 'right', fontSize: 12, color: 'var(--dk-ink-3)' }}
        >
          {waitedFor(person.kycRequiredAt)}
        </span>

        <IconChevronRight size={14} style={{ color: 'var(--dk-ink-4)' }} />
      </button>
    </div>
  );
}

/**
 * ⚠️ THE FOOTER STATES THE WINDOW, NOT JUST THE TOTAL.
 *
 * "1,284 in everyone" printed over fifty rows is a number that reads as a list
 * length and is not one — the other 1,234 were never fetched, and the surface
 * had no way of admitting it. "1–50 of 1,284" is the difference between an
 * operator who knows to keep searching and one who scrolls to the bottom and
 * concludes the member is not registered.
 */
function Pager({
  bounds,
  pageIndex,
  total,
  onPage,
}: {
  bounds: PageWindow;
  pageIndex: number;
  total: number;
  onPage: (next: number) => void;
}) {
  if (total <= PEOPLE_PAGE_SIZE) {
    return (
      <span style={{ fontSize: 12, color: 'var(--dk-ink-3)', padding: '2px 2px 0' }}>
        {total} {total === 1 ? 'person' : 'people'}, all of them shown.
      </span>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 2px 0' }}>
      <span className="dk-mono" style={{ fontSize: 12, color: 'var(--dk-ink-3)' }}>
        {bounds.beyondEnd
          ? `That page is past the end · ${total} ${total === 1 ? 'member' : 'members'}`
          : `${bounds.first}–${bounds.last} of ${total}`}
      </span>
      <span style={{ flex: 1 }} />
      <Button variant="ghost" disabled={!bounds.hasPrev} onClick={() => onPage(pageIndex - 1)}>
        Previous
      </Button>
      <Button variant="secondary" disabled={!bounds.hasNext} onClick={() => onPage(pageIndex + 1)}>
        Next
      </Button>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Dealers — the SAPS-licensed directory
 *
 * The replacement for /admin/dealers. Everything here changes what a buyer is
 * offered at DEALER_TRANSFER checkout, which is where a firearm is physically
 * handed over — so every transition below states what it will do to checkout
 * before it fires, and carries the reason the audit row records.
 * ──────────────────────────────────────────────────────────────────────── */

/** What each view is actually a list of. Said in words, above the rows. */
const VIEW_BLURB: Record<DealerView, string> = {
  active: 'Dealers a buyer is offered right now when they choose dealer transfer at checkout.',
  pending:
    'Added automatically from a verified firearm transfer, and kept out of checkout until you review them. Confirm the licence and complete the address before activating — the address is where a firearm gets driven.',
  auto: 'Every entry the transfer-verification pipeline created, reviewed or not.',
  all: 'The whole directory, active and inactive.',
  members:
    'Members whose seller tier is DEALER. These are marketplace accounts, not directory entries — nothing here affects checkout routing.',
};

type DealerDialog =
  | { kind: 'review'; dealer: DealerRow }
  | { kind: 'edit'; dealer: DealerRow }
  | { kind: 'activate'; dealer: DealerRow }
  | { kind: 'deactivate'; dealer: DealerRow }
  | { kind: 'create' }
  | null;

function DealersSegment({
  view,
  onView,
  search,
  memberList,
}: {
  view: DealerView;
  onView: (next: DealerView) => void;
  search: string;
  memberList: React.ReactNode;
}) {
  const [directory, setDirectory] = React.useState<{
    rows: DealerRow[];
    count: number;
    pendingCount: number;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<DealerDialog>(null);

  const onDirectory = view !== 'members';

  /** Same reason as the member list above: the last request wins. */
  const runRef = React.useRef(0);

  const load = React.useCallback(async () => {
    if (!onDirectory) return;
    const run = ++runRef.current;
    try {
      const next = await fetchDealers(view, search);
      if (run !== runRef.current) return;
      setDirectory(next);
      setError(null);
    } catch (err) {
      if (run !== runRef.current) return;
      setError(describeFailure(err));
    }
  }, [view, search, onDirectory]);

  React.useEffect(() => {
    const id = setTimeout(() => void load(), search ? 200 : 0);
    return () => clearTimeout(id);
  }, [load, search]);

  /**
   * Each view is a different slice, and its footer count says how many are in
   * it — so the previous slice's rows and total come off screen on the way.
   *
   * ⚠️ NOT CLEARED ON THE WAY INTO 'members', which reads the member list and
   * never refetches the directory: blanking there would drop the pending badge
   * off the chip for as long as the operator stayed on that view.
   */
  React.useEffect(() => {
    if (view === 'members') return;
    setDirectory(null);
    setError(null);
  }, [view]);

  function done() {
    setDialog(null);
    // Re-read rather than patch the row: verifying moves an entry out of the
    // pending view, and a locally-edited row would sit in a queue it has
    // already left.
    void load();
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {DEALER_VIEWS.map((v) => (
          <Chip
            key={v.key}
            active={view === v.key}
            onClick={() => onView(v.key)}
            count={v.key === 'pending' && directory?.pendingCount ? directory.pendingCount : undefined}
          >
            {v.label}
          </Chip>
        ))}
        <span style={{ flex: 1 }} />
        {onDirectory ? (
          <Button variant="secondary" icon={IconShield} onClick={() => setDialog({ kind: 'create' })}>
            Add dealer…
          </Button>
        ) : null}
      </div>

      <span
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 7,
          fontSize: 12,
          lineHeight: 1.45,
          color: 'var(--dk-ink-3)',
          padding: '2px 2px 4px',
        }}
      >
        <IconInfo size={13} style={{ color: 'var(--dk-ink-3)', marginTop: 1, flex: 'none' }} />
        {VIEW_BLURB[view]}
      </span>

      {!onDirectory ? (
        memberList
      ) : error ? (
        <FailedRegion
          title="Couldn't load the dealer directory"
          detail={error}
          onRetry={() => void load()}
        />
      ) : !directory ? (
        <SkeletonPile count={3} />
      ) : directory.rows.length === 0 ? (
        <Empty>
          {view === 'pending'
            ? 'No dealers awaiting review. Auto-added dealers land here once a firearm transfer is verified.'
            : search
              ? `No dealer matches “${search}”.`
              : 'No dealers in this view.'}
        </Empty>
      ) : (
        <>
          <div
            style={{
              background: 'var(--dk-surface)',
              border: '1px solid var(--dk-line)',
              borderRadius: 'var(--dk-radius-card)',
              overflow: 'hidden',
            }}
          >
            {directory.rows.map((d, i) => (
              <DealerListRow
                key={d.id}
                dealer={d}
                last={i === directory.rows.length - 1}
                onReview={() => setDialog({ kind: 'review', dealer: d })}
                onEdit={() => setDialog({ kind: 'edit', dealer: d })}
                onActivate={() => setDialog({ kind: 'activate', dealer: d })}
                onDeactivate={() => setDialog({ kind: 'deactivate', dealer: d })}
              />
            ))}
          </div>
          <span style={{ fontSize: 12, color: 'var(--dk-ink-3)', padding: '2px 2px 0' }}>
            {directory.count} {directory.count === 1 ? 'dealer' : 'dealers'}
            {/* ⚠️ The endpoint takes 200 flat and there is no paging to offer.
                The only honest thing to do with a ceiling you cannot page past
                is say it out loud at the point it starts hiding rows.
                ⚠️ KEYED ON count, NOT ON rows.length. count is the true total
                for this filter and rows is the capped slice, so they are equal
                at exactly 200 — testing the slice promised "the rest" when
                there was no rest, which is the same species of lie as hiding
                the cap, just pointing the other way. */}
            {directory.count > DEALER_LIST_CAP
              ? ` · showing the first ${DEALER_LIST_CAP}. Search to reach the rest.`
              : ''}
          </span>
        </>
      )}

      {dialog?.kind === 'create' ? (
        <DealerFormDialog mode="create" onClose={() => setDialog(null)} onDone={done} />
      ) : null}
      {dialog?.kind === 'review' ? (
        <DealerFormDialog
          mode="review"
          dealer={dialog.dealer}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
      {dialog?.kind === 'edit' ? (
        <DealerFormDialog
          mode="edit"
          dealer={dialog.dealer}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
      {dialog?.kind === 'activate' || dialog?.kind === 'deactivate' ? (
        <DealerStateDialog
          dealer={dialog.dealer}
          activate={dialog.kind === 'activate'}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
    </>
  );
}

/**
 * One directory entry.
 *
 * 🚨 A DEALER IS A BUSINESS, NOT A MEMBER, AND THE PRIVACY RULE ABOVE DOES NOT
 * TRANSFER. The name, the licence number and the town are exactly what a buyer
 * is shown at checkout, so they belong on the row. The phone number and the
 * email address are a person at that counter and stay inside the dialog.
 */
function DealerListRow({
  dealer,
  last,
  onReview,
  onEdit,
  onActivate,
  onDeactivate,
}: {
  dealer: DealerRow;
  last: boolean;
  onReview: () => void;
  onEdit: () => void;
  onActivate: () => void;
  onDeactivate: () => void;
}) {
  const standing = dealerStanding(dealer);
  const pending = !dealer.isVerified;
  const gaps = missingDealerFields(dealerDetailsOf(dealer));
  const seen = dealerSeen(dealer);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        minHeight: 60,
        padding: '12px 16px',
        borderBottom: last ? undefined : '1px solid var(--dk-line)',
        flexWrap: 'wrap',
      }}
    >
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 200, flex: 1 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--dk-ink)' }}>{dealer.name}</span>
          {standing ? (
            <Tag kind={standing.kind} icon={standing.kind === 'neutral' ? null : undefined}>
              {standing.label}
            </Tag>
          ) : null}
          {isAutoRegistered(dealer) ? <Tag kind="ink">Auto-added</Tag> : null}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span className="dk-mono" style={{ fontSize: 11.5, color: 'var(--dk-ink-3)', flex: 'none' }}>
            {dealer.licenceNumber}
          </span>
          {/* ⚠️ THE STREET LINE, NOT JUST THE TOWN. This is the field the
              whole review is about — where a firearm gets driven — so it is
              on the row rather than one dialog away. */}
          <span
            style={{
              fontSize: 12,
              color: 'var(--dk-ink-3)',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {dealerFullAddress(dealer)}
          </span>
        </span>
        {/* How stale this entry is. The legacy card printed it on every
            auto-added dealer and a review queue is exactly where it earns its
            place: first seen in March and not seen since is a dealer who may
            have moved. */}
        {/* At ink-4 this was 2.8:1 — and the comment right above says it is
            review-critical ("first seen in March and not seen since is a dealer
            who may have moved"). Text an operator is asked to judge on cannot
            be the hardest text on the row to read. */}
        {seen ? <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>{seen}</span> : null}
        {/* ⚠️ An entry an operator could activate without noticing it has no
            suburb is the whole hazard of the auto-registration path. Say it on
            the row, not only inside the dialog they may never open. */}
        {gaps.length > 0 ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <IconAlert size={12} style={{ color: 'var(--dk-warn)', flex: 'none' }} />
            <span style={{ fontSize: 11.5, color: 'var(--dk-warn)' }}>
              Address incomplete — {gaps.join(', ').toLowerCase()}
            </span>
          </span>
        ) : null}
      </span>

      <span
        className="dk-mono"
        style={{ width: 78, flex: 'none', textAlign: 'right', fontSize: 12, color: 'var(--dk-ink-3)' }}
      >
        {dealer._count.transactions} {dealer._count.transactions === 1 ? 'txn' : 'txns'}
      </span>

      <span style={{ display: 'flex', gap: 8, flex: 'none' }}>
        {pending ? (
          <Button variant="primary" icon={IconCheck} onClick={onReview}>
            Review…
          </Button>
        ) : dealer.isActive ? (
          <Button variant="danger" onClick={onDeactivate}>
            Deactivate…
          </Button>
        ) : (
          <Button variant="secondary" onClick={onActivate}>
            Activate…
          </Button>
        )}
        <Button variant="ghost" icon={IconPencil} onClick={onEdit}>
          Edit…
        </Button>
      </span>
    </div>
  );
}

/**
 * Create, edit, and review-and-activate — one form.
 *
 * ⚠️ REVIEW IS AN EDIT THAT ALSO FLIPS isVerified, AND IT HAS TO BE. An
 * auto-registered entry arrives holding whatever OCR made of a photographed
 * SAP 534, which is routinely a street line and nothing else. A review screen
 * that could confirm but not correct would leave the operator two choices:
 * activate a wrong address, or leave a real dealer out of checkout. Both are
 * worse than a longer dialog.
 */
function DealerFormDialog({
  mode,
  dealer,
  onClose,
  onDone,
}: {
  mode: 'create' | 'edit' | 'review';
  dealer?: DealerRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [details, setDetails] = React.useState<DealerDetails>(() =>
    dealer ? dealerDetailsOf(dealer) : emptyDealerDetails(),
  );
  /**
   * ⚠️ VERIFIED AND ACTIVE ARE TWO FLAGS AND THE OPERATOR SETS BOTH. The legacy
   * form defaulted this on and buried it under nine address fields, so "this
   * licence is real" and "send firearms here from tomorrow" were one press.
   * They are separable because the honest answer to the first is sometimes yes
   * while the answer to the second is not yet.
   */
  const [activate, setActivate] = React.useState(true);
  const [choice, setChoice] = React.useState('');
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const needsReason = mode !== 'create';
  const reasons: DealerReasonChoice[] =
    mode === 'review' ? DEALER_VERIFY_REASONS : DEALER_EDIT_REASONS;
  const gaps = missingDealerFields(details);
  const reason = composeDealerReason(choice, note);
  const reasonOk = !needsReason || (Boolean(choice) && reason.trim().length >= MIN_DEALER_REASON);
  const canSubmit = gaps.length === 0 && reasonOk && !busy;

  function set<K extends keyof DealerDetails>(key: K, value: DealerDetails[K]) {
    setDetails((d) => ({ ...d, [key]: value }));
  }

  async function submit() {
    setBusy(true);
    setFailure(null);
    try {
      if (mode === 'create') await createDealer(details);
      else if (mode === 'review') await reviewDealer(dealer!.id, details, activate, reason);
      else await saveDealerDetails(dealer!.id, details, reason);
      onDone();
    } catch (err) {
      // ⚠️ The dialog stays open on a refusal. The server's own sentence — a
      // duplicate licence, a reason too short — is the whole message, and a
      // dialog that closed would take it away along with the typing.
      setFailure(describeDealerFailure(err));
      setBusy(false);
    }
  }

  return (
    <DialogFrame
      label={mode === 'review' ? 'Dealer · verify' : mode === 'create' ? 'Dealer · add' : 'Dealer · edit'}
      title={
        mode === 'create'
          ? 'Add a dealer to the directory'
          : mode === 'review'
            ? `Review ${dealer!.name}`
            : `Edit ${dealer!.name}`
      }
      width={620}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit} loading={busy}>
            {mode === 'create'
              ? 'Add dealer'
              : mode === 'review'
                ? activate
                  ? 'Verify and activate'
                  : 'Verify, keep inactive'
                : 'Save changes'}
          </Button>
        </>
      }
    >
      <div
        style={{
          maxHeight: '52vh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <Consequence
          lines={
            mode === 'create'
              ? [
                  'A hand-added dealer skips the review queue: it lands verified and active, and buyers can be routed to this address as soon as it saves.',
                ]
              : mode === 'review'
                ? [
                    activate
                      ? 'Marks the licence verified AND puts this address in front of every buyer choosing dealer transfer at checkout.'
                      : 'Marks the licence verified but keeps the dealer out of checkout. Nobody is routed here until you activate it.',
                    'Reversible — you can deactivate it again from this list.',
                  ]
                : ['Corrects the details on file. Neither the verified nor the active flag changes.']
          }
        />

        {dealer && ocrDiffers(dealer) ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: '10px 12px',
              background: 'var(--dk-warn-wash)',
              border: '1px solid var(--dk-warn-line)',
              borderRadius: 'var(--dk-radius-control)',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <IconAlert size={12} style={{ color: 'var(--dk-warn)' }} />
              <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--dk-warn)' }}>
                What the transfer photo actually read
              </span>
            </span>
            <span
              className="dk-mono"
              style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--dk-ink-2)' }}
            >
              {dealer.rawAddress}
            </span>
          </div>
        ) : null}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
          <FormField label="Dealer name" span>
            <Input value={details.name} onChange={(e) => set('name', e.target.value)} />
          </FormField>
          <FormField label="SAPS licence number" hint="Stored upper-cased, spaces stripped.">
            <Input
              value={details.licenceNumber}
              onChange={(e) => set('licenceNumber', e.target.value)}
              placeholder="e.g. 1234567"
            />
          </FormField>
          <FormField label="Postal code">
            <Input
              value={details.postalCode}
              onChange={(e) => set('postalCode', e.target.value)}
              inputMode="numeric"
              placeholder="0000"
            />
          </FormField>
          <FormField label="Street address" span>
            <Input value={details.address} onChange={(e) => set('address', e.target.value)} />
          </FormField>
          <FormField label="Suburb">
            <Input value={details.suburb} onChange={(e) => set('suburb', e.target.value)} />
          </FormField>
          <FormField label="City">
            <Input value={details.city} onChange={(e) => set('city', e.target.value)} />
          </FormField>
          <FormField label="Phone (optional)">
            <Input
              value={details.phone}
              onChange={(e) => set('phone', e.target.value)}
              placeholder="+27…"
            />
          </FormField>
          <FormField label="Email (optional)">
            <Input type="email" value={details.email} onChange={(e) => set('email', e.target.value)} />
          </FormField>
        </div>

        {/* Province is a nine-value enum, so it is nine chips rather than a
            native select: the Desk has one selection idiom and a dropdown that
            inherits none of the palette is not it. */}
        <FormField label="Province" span>
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {PROVINCES.map((p) => (
              <Chip key={p} active={details.province === p} onClick={() => set('province', p)}>
                {provinceLabel(p)}
              </Chip>
            ))}
          </span>
        </FormField>

        {gaps.length > 0 ? (
          <span style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
            <IconAlert size={13} style={{ color: 'var(--dk-warn)', marginTop: 1, flex: 'none' }} />
            <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--dk-warn)' }}>
              Still needed before this can be saved: {gaps.join(', ')}.
            </span>
          </span>
        ) : null}

        {mode === 'review' ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: 12,
              background: 'var(--dk-inset)',
              border: '1px solid var(--dk-line-2)',
              borderRadius: 'var(--dk-radius-control)',
            }}
          >
            <Checkbox
              checked={activate}
              onChange={setActivate}
              label="Activate now — offer this dealer to buyers at dealer-transfer checkout"
            />
            {dealer?.transactions?.[0]?.id ? (
              /**
               * The transfer that auto-added this dealer, as a door.
               *
               * ⚠️ THE COMMENT HERE USED TO SAY "no click-through: the order
               * dossier has no Desk home yet". That stopped being true when
               * the Order drawer landed, and stayed in place afterwards — so
               * the one piece of context that explains WHY a dealer appeared
               * in the registry sat on screen as an unusable cuid.
               *
               * ⚠️ ?txn= AND NOT ?order=. This is a Transaction id. The Ledger
               * resolves ?order= through fetchOrderCard, which wants an ORDER
               * and would 404 on this — see lib/desk-search.ts.
               */
              <Kv
                k="Came from transfer"
                v={
                  <a
                    href={`/admin/desk/ledger?txn=${encodeURIComponent(dealer.transactions[0].id)}`}
                    style={{ color: 'var(--dk-ink)', textUnderlineOffset: 3 }}
                  >
                    Open the sale
                  </a>
                }
                last
              />
            ) : null}
          </div>
        ) : null}

        {needsReason ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Label>Reason · goes on the audit row</Label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {reasons.map((r) => (
                <RadioRow
                  key={r.value}
                  name="dealer-reason"
                  checked={choice === r.value}
                  onChange={() => setChoice(r.value)}
                  label={r.value}
                  sub={r.consequence}
                />
              ))}
            </div>
            <Input
              placeholder="Anything to add?"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>
              Recorded against this dealer in the audit trail. The dealer never sees it.
            </span>
          </div>
        ) : null}

        {failure ? <ResultBlock ok={false} tag="Refused" body={failure} /> : null}
      </div>
    </DialogFrame>
  );
}

/**
 * Activate or deactivate a dealer that has already been reviewed.
 *
 * A smaller dialog than the form on purpose: this transition touches no
 * detail at all, and putting nine editable fields in front of the operator on
 * the way to a one-flag decision is an invitation to change something by
 * accident.
 */
function DealerStateDialog({
  dealer,
  activate,
  onClose,
  onDone,
}: {
  dealer: DealerRow;
  activate: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [choice, setChoice] = React.useState('');
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const reasons = activate ? DEALER_ACTIVATE_REASONS : DEALER_DEACTIVATE_REASONS;
  const reason = composeDealerReason(choice, note);
  const canSubmit = Boolean(choice) && reason.trim().length >= MIN_DEALER_REASON && !busy;

  async function submit() {
    setBusy(true);
    setFailure(null);
    try {
      await setDealerActive(dealer.id, activate, reason);
      onDone();
    } catch (err) {
      setFailure(describeDealerFailure(err));
      setBusy(false);
    }
  }

  return (
    <DialogFrame
      label={activate ? 'Dealer · activate' : 'Dealer · deactivate'}
      title={activate ? `Activate ${dealer.name}?` : `Deactivate ${dealer.name}?`}
      assertive={!activate}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={activate ? 'primary' : 'danger'}
            onClick={() => void submit()}
            disabled={!canSubmit}
            loading={busy}
          >
            {activate ? 'Activate dealer' : 'Deactivate dealer'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Kv k="Licence" v={dealer.licenceNumber} />
        <Kv k="Address" v={dealer.address || '—'} mono={false} />
        <Kv k="Where" v={dealerLocation(dealer)} mono={false} />
        <Kv k="Transfers on record" v={dealer._count.transactions} last />
      </div>

      <Consequence
        lines={
          activate
            ? [
                'Buyers choosing dealer transfer at checkout start being offered this address again.',
                'Nothing about transfers already booked here changes.',
              ]
            : [
                'From the next checkout onwards, buyers stop being offered this dealer for a dealer transfer.',
                'Nothing is deleted. Transfers already booked to this dealer keep their link to it, and you can activate it again from the All view.',
              ]
        }
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Label>Reason · goes on the audit row</Label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {reasons.map((r) => (
            <RadioRow
              key={r.value}
              name="dealer-state-reason"
              checked={choice === r.value}
              onChange={() => setChoice(r.value)}
              label={r.value}
              sub={r.consequence}
            />
          ))}
        </div>
        <Input placeholder="Anything to add?" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      {failure ? <ResultBlock ok={false} tag="Refused" body={failure} /> : null}
    </DialogFrame>
  );
}

/** The plain sentences saying what the button is about to do. */
function Consequence({ lines }: { lines: string[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {lines.map((line, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
          <IconInfo size={13} style={{ color: 'var(--dk-ink-3)', marginTop: 1, flex: 'none' }} />
          <span style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--dk-ink-2)' }}>{line}</span>
        </span>
      ))}
    </div>
  );
}

function FormField({
  label,
  hint,
  span = false,
  children,
}: {
  label: string;
  hint?: string;
  span?: boolean;
  children: React.ReactNode;
}) {
  // A real <label> wrapping the control, so the association is implicit
  // through nesting — the same shape order-actions.tsx's `Labelled` already
  // uses. This was a <div>, and `Label` renders a <span>, so the dealer form's
  // fields had a visible caption and NO accessible name at all: a screen
  // reader announced five consecutive "edit text" boxes with nothing to tell
  // them apart, and clicking the caption did not focus its input.
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
        gridColumn: span ? '1 / -1' : undefined,
      }}
    >
      <Label>{label}</Label>
      {children}
      {hint ? <span style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>{hint}</span> : null}
    </label>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '40px 20px',
        textAlign: 'center',
        fontSize: 13,
        color: 'var(--dk-ink-3)',
        background: 'var(--dk-surface)',
        border: '1px solid var(--dk-line)',
        borderRadius: 'var(--dk-radius-card)',
      }}
    >
      {children}
    </div>
  );
}


/**
 * The sweep confirm.
 *
 * 🚨 IT NAMES THE ELIGIBLE COUNT AND LISTS WHO IS BEING SKIPPED. "Ban 12
 * members" over a selection where four are closed is a promise the call will
 * not keep, and the operator would only find out afterwards from a tally. The
 * whole reason this control was held back was that the Desk could not say
 * this sentence truthfully; now it can, so it says it before the press rather
 * than reporting it after.
 */
function SweepConfirm({
  people,
  reason,
  onReason,
  busy,
  onClose,
  onConfirm,
}: {
  people: PersonRow[];
  reason: string;
  onReason: (r: string) => void;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { eligible, skipped, sentence } = describeSweep(people);
  const reasonOk = reason.trim().length >= BULK_BAN_MIN_REASON;
  const overCap = eligible.length > BULK_BAN_CAP;

  return (
    <DialogFrame
      label="Ban several"
      title={sentence}
      onClose={onClose}
      assertive
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || !reasonOk || eligible.length === 0 || overCap}
            onClick={onConfirm}
          >
            {busy ? 'Banning…' : `Ban ${eligible.length}`}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--dk-ink-2)' }}>
          Each ban is recorded against that member with this reason, and each gets
          its own audit row. Banning does not close an account or refund anything.
        </span>

        {skipped.length ? (
          <div style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--dk-ink-3)' }}>
            {/* Named, not just counted — an operator who selected someone and is
                told "3 skipped" cannot tell which three, or whether they picked
                the wrong row. */}
            {`Left alone: ${skipped
              .map((p) => `${p.username ?? 'no username'} (${unsweepableReason(p)?.toLowerCase()})`)
              .join('; ')}`}
          </div>
        ) : null}

        {overCap ? (
          <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--dk-bad)' }}>
            {`The server caps a sweep at ${BULK_BAN_CAP}. Do this in smaller batches — that limit exists so a mistake stays small.`}
          </span>
        ) : null}

        <Input
          value={reason}
          onChange={(e) => onReason(e.target.value)}
          placeholder={`Why — at least ${BULK_BAN_MIN_REASON} characters, recorded against each member`}
          aria-label="Reason for the ban"
        />
      </div>
    </DialogFrame>
  );
}
