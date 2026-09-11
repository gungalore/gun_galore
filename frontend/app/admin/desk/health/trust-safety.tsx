'use client';

/**
 * HEALTH — trust and safety, the five feeds of /admin/trust-safety.
 *
 * 🚨 USERNAMES ONLY, AND THE BLOCKED TEXT STAYS FOLDED. The legacy page put an
 * email address under every username across five tables at once, and printed
 * every intercepted phone number and street address in a scrollable column.
 * None of that is needed to decide anything here — the row says who and what
 * tripped, the evidence opens one row at a time on a deliberate press, and the
 * person is worked on from People.
 *
 * ⚠️ THE FIVE FEEDS SHARE ONE `Promise.all` AND ONE CATCH, SO ANY ONE 500
 * REPLACES ALL FIVE WITH A SINGLE FailedRegion. That was true on the Site
 * board and it is carried across unchanged rather than quietly repaired: the
 * split's job was to keep the eight sections independent of EACH OTHER, and
 * this one is now isolated from the other seven — a dead offenders endpoint
 * can no longer take the vitals or the alerts inbox down with it. Splitting
 * the five apart is a separate change with its own five empty states, and
 * carrying the flaw silently while claiming isolation would have been worse
 * than naming it.
 */
import * as React from 'react';
import {
  Button,
  Chip,
  FailedRegion,
  ListingDrawer,
  MemberDrawer,
  Tag,
} from '../../../../components/desk';
import { describeFailure } from '../../../../lib/desk-auth';
import {
  fetchRejections,
  fetchRepeatOffenders,
  fetchReportedListings,
  fetchReportedQuestions,
  fetchReportedSellers,
  stamp,
  type RejectionRow,
  type RepeatOffenderRow,
  type ReportedListingRow,
  type ReportedQuestionRow,
  type ReportedSellerRow,
} from '../../../../lib/desk-site';
import { Card, Pre, Quiet, Row, Stack } from './board-bits';

type TsFeed = 'offenders' | 'questions' | 'listings' | 'sellers' | 'rejections';

interface TsData {
  offenders: RepeatOffenderRow[];
  questions: ReportedQuestionRow[];
  listings: ReportedListingRow[];
  sellers: ReportedSellerRow[];
  rejections: RejectionRow[];
}

export function TrustSafety() {
  const [feed, setFeed] = React.useState<TsFeed>('offenders');
  const [data, setData] = React.useState<TsData | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  // One at a time, never a wall: revealing a second sample hides the first.
  const [revealed, setRevealed] = React.useState<string | null>(null);
  /**
   * 🚨 THIS IS THE PART THE CUTOVER LOST, AND IT WAS A SAFETY CONTROL.
   * Every row on the legacy /admin/trust-safety page was a link — offenders,
   * reported sellers and the rejecting user to /admin/users/[id], reported
   * listings and questions to /admin/listings/[id] — so the page was a queue
   * you worked FROM. The Desk section rendered the same five feeds as text,
   * which made it a page you could only read: a member could be reported for
   * a live listing and there was NO route anywhere on the Desk to open that
   * listing, let alone take it down.
   *
   * Both drawers already open on an id alone and both already handle a LIVE
   * listing — ListingDrawer offers Take down on ACTIVE/PAYMENT_PENDING, and
   * POST /admin/listings/:id/delete has never had a status guard. So nothing
   * new is being granted here; the reports are simply being connected to the
   * decisions they exist to prompt.
   */
  const [openListingId, setOpenListingId] = React.useState<string | null>(null);
  const [openMemberId, setOpenMemberId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const [offenders, questions, listings, sellers, rejections] = await Promise.all([
        fetchRepeatOffenders(),
        fetchReportedQuestions(),
        fetchReportedListings(),
        fetchReportedSellers(),
        fetchRejections(),
      ]);
      setData({ offenders, questions, listings, sellers, rejections });
      setFailure(null);
    } catch (err) {
      setFailure(describeFailure(err));
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (failure) {
    return (
      <FailedRegion title="Couldn't load trust and safety" detail={failure} onRetry={() => void load()} />
    );
  }

  const tabs: { key: TsFeed; label: string; count: number }[] = [
    { key: 'offenders', label: 'Repeat offenders', count: data?.offenders.length ?? 0 },
    { key: 'questions', label: 'Reported Q and A', count: data?.questions.length ?? 0 },
    { key: 'listings', label: 'Reported listings', count: data?.listings.length ?? 0 },
    { key: 'sellers', label: 'Reported sellers', count: data?.sellers.length ?? 0 },
    { key: 'rejections', label: 'Contact blocks', count: data?.rejections.length ?? 0 },
  ];

  return (
    <Card
      label="Trust and safety"
      hint="last 7 days · contact blocks and reported content"
      footer="Open a name to act on it — the member drawer warns and bans, the listing drawer takes down. A name that doesn't open is one whose listing or account has since been deleted."
    >
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingBottom: 4 }}>
        {tabs.map((t) => (
          <Chip key={t.key} active={feed === t.key} count={t.count} onClick={() => setFeed(t.key)}>
            {t.label}
          </Chip>
        ))}
      </div>

      {!data ? (
        <Quiet>Loading…</Quiet>
      ) : feed === 'offenders' ? (
        data.offenders.length === 0 ? (
          <Quiet>Nobody has tripped the contact filter three times this week.</Quiet>
        ) : (
          data.offenders.map((o, i) => (
            <Row key={o.userId} last={i === data.offenders.length - 1}>
              <OpenName onOpen={() => setOpenMemberId(o.userId)} open={openMemberId === o.userId}>
                {o.username ?? 'no username'}
              </OpenName>
              <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>
                last {stamp(o.lastRejectionAt)}
              </span>
              <Tag kind="bad">{`${o.rejectionCount} blocks`}</Tag>
            </Row>
          ))
        )
      ) : feed === 'questions' ? (
        data.questions.length === 0 ? (
          <Quiet>No reported questions or answers.</Quiet>
        ) : (
          data.questions.map((q, i) => (
            <Stack key={q.id} last={i === data.questions.length - 1}>
              <span style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{ fontSize: 12.5, color: 'var(--dk-ink)', lineHeight: 1.5, minWidth: 0, flex: 1 }}>
                  {q.question}
                </span>
                <Tag kind="warn" icon={null}>{`${q.reportedCount} reports`}</Tag>
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>
                {/* The listing opens; the asker does not. ReportedQuestionRow
                    carries `asker.username` with NO id, so there is nothing to
                    open a member on — a door here would 404 on a cuid we never
                    received. Work the person from People, or from the listing. */}
                <OpenName
                  inline
                  onOpen={() => setOpenListingId(q.listing.id)}
                  open={openListingId === q.listing.id}
                >
                  {q.listing.title}
                </OpenName>{' '}
                · asked by {q.asker.username ?? 'no username'} ·{' '}
                {q.status.replace(/_/g, ' ').toLowerCase()} · {stamp(q.createdAt)}
              </span>
            </Stack>
          ))
        )
      ) : feed === 'listings' ? (
        data.listings.length === 0 ? (
          <Quiet>No listings reported.</Quiet>
        ) : (
          data.listings.map((r, i) => (
            <Stack key={r.id} last={i === data.listings.length - 1}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <OpenName
                  onOpen={r.listing ? () => setOpenListingId(r.listing!.id) : undefined}
                  open={!!r.listing && openListingId === r.listing.id}
                >
                  {r.listing ? r.listing.title : 'listing since deleted'}
                </OpenName>
                <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>
                  {stamp(r.createdAt)}
                </span>
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--dk-ink-2)', lineHeight: 1.45 }}>{r.reason}</span>
            </Stack>
          ))
        )
      ) : feed === 'sellers' ? (
        data.sellers.length === 0 ? (
          <Quiet>No sellers reported.</Quiet>
        ) : (
          data.sellers.map((r, i) => (
            <Stack key={r.id} last={i === data.sellers.length - 1}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <OpenName
                  onOpen={r.seller ? () => setOpenMemberId(r.seller!.id) : undefined}
                  open={!!r.seller && openMemberId === r.seller.id}
                >
                  {r.seller ? (r.seller.username ?? 'no username') : 'account since deleted'}
                </OpenName>
                <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>
                  {stamp(r.createdAt)}
                </span>
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--dk-ink-2)', lineHeight: 1.45 }}>{r.reason}</span>
            </Stack>
          ))
        )
      ) : data.rejections.length === 0 ? (
        <Quiet>The contact-detail filter has been quiet for seven days.</Quiet>
      ) : (
        data.rejections.map((r, i) => (
          <Stack key={r.id} last={i === data.rejections.length - 1}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {/* "signed out" is a real state here, not a deleted account: the
                  contact filter runs on anonymous traffic too, and that row has
                  no user to open. */}
              <OpenName
                onOpen={r.user ? () => setOpenMemberId(r.user!.id) : undefined}
                open={!!r.user && openMemberId === r.user.id}
              >
                {r.user ? (r.user.username ?? 'no username') : 'signed out'}
              </OpenName>
              <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>{r.channel}</span>
              <Tag kind="neutral">{r.category.replace(/-/g, ' ')}</Tag>
              <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>
                {stamp(r.createdAt)}
              </span>
              {/* 🚨 The evidence is a phone number or a street address more
                  often than not. It opens one row at a time, on a press, and
                  never as a column of a hundred. */}
              <Button variant="ghost" onClick={() => setRevealed((cur) => (cur === r.id ? null : r.id))}>
                {revealed === r.id ? 'Hide text' : 'Show text'}
              </Button>
            </span>
            {revealed === r.id ? <Pre tone="ground">{r.sampleText}</Pre> : null}
          </Stack>
        ))
      )}

      {/* Both drawers are modal overlays that fetch their own dossier from the
          id, so mounting them inside the card costs nothing and keeps the
          state next to the rows that set it. Reload the feeds after either
          one acts: taking a listing down or banning a member is exactly the
          thing that should make its report stop being the top of the queue. */}
      <ListingDrawer
        listingId={openListingId}
        onClose={() => setOpenListingId(null)}
        onDecided={() => {
          setOpenListingId(null);
          void load();
        }}
      />
      <MemberDrawer
        open={openMemberId !== null}
        userId={openMemberId}
        onClose={() => setOpenMemberId(null)}
        onChanged={() => void load()}
      />
    </Card>
  );
}

/**
 * The name in a trust-and-safety row, as a door.
 *
 * 🚨 THE NAME IS THE TARGET, NOT THE ROW. The obvious move is to wrap each
 * row in a button the way People wraps a member row, and it is wrong here:
 * the contact-block row already carries its own "Show text" button, and a
 * button inside a button is invalid markup that browsers resolve by dropping
 * one of them — silently, and not always the same one. Making the name the
 * target is also the more honest affordance, because a reported-listing row
 * names two different things (the listing, and the reason someone gave) and
 * only one of them opens.
 *
 * `onOpen` omitted renders a plain span, which is what a row whose subject
 * has since been deleted must render: `listing` and `seller` are nullable on
 * the wire, and a dead id must not look like a door.
 */
function OpenName({
  children,
  onOpen,
  open = false,
  inline = false,
}: {
  children: React.ReactNode;
  onOpen?: () => void;
  open?: boolean;
  /** Sits inside a meta line rather than filling the name slot — the reported
   *  question's door is the LISTING it was asked on, which lives down there
   *  next to the asker and the timestamp. */
  inline?: boolean;
}) {
  const shared: React.CSSProperties = inline
    ? { fontSize: 11.5, color: 'var(--dk-ink-2)', textAlign: 'left' }
    : {
        fontSize: 12.5,
        color: 'var(--dk-ink)',
        minWidth: 0,
        flex: 1,
        textAlign: 'left',
      };
  if (!onOpen) return <span style={shared}>{children}</span>;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={open}
      style={{
        ...shared,
        padding: 0,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
        // Underlined on hover only: five feeds of underlined names would read
        // as a wall of links and bury the one the operator is looking for.
        textDecoration: 'underline',
        textDecorationColor: 'transparent',
        textUnderlineOffset: 3,
        transition: 'text-decoration-color 120ms',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.textDecorationColor = 'var(--dk-ink-3)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.textDecorationColor = 'transparent';
      }}
    >
      {children}
    </button>
  );
}
