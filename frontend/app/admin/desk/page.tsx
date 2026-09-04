'use client';

/**
 * THE DESK — the pile.
 *
 * One prioritised worklist. Everything that needs the operator is a card;
 * acting on it makes it leave. There is no console to patrol, no dashboard to
 * interpret and no page navigation in the daily loop — the drawer opens over
 * the pile and closing it puts you back exactly where you were.
 *
 * ⚠️ THE SERVER OWNS THE ORDER. This file renders bands in a fixed sequence
 * and cards in the order they arrived. It never sorts, never re-bands and
 * never decides what is overdue. See lib/desk-feed.ts.
 *
 * ⚠️ ONE DRAWER IS MOUNTED AT A TIME, AND THAT IS WHAT MAKES ESCAPE WORK.
 * Drawer binds a capture-phase keydown on `document` and defers only to a
 * `.dk-dialog` above it — it knows nothing about a second drawer. Two mounted
 * at once therefore both hear one Escape and both close, so an operator who
 * stepped from a complaint into the order holding its money would lose the
 * complaint as well on the way back. The open drawers are a stack in state
 * and only the top of it is rendered; closing pops one level and re-opens the
 * one beneath, which is the behaviour the single Escape listener already
 * describes. See components/desk/overlays.tsx.
 */
import * as React from 'react';
import {
  AllClear,
  Band,
  CaseDrawer,
  Chip,
  DeskCard,
  DeskShell,
  FailedRegion,
  IconAlert,
  IconBolt,
  IconCheck,
  IconClock,
  IconInfo,
  IconLock,
  Kv,
  ListingDrawer,
  OrderDrawer,
  RailCard,
  Ribbon,
  ShortcutFooter,
  SkeletonPile,
  UndoToast,
  useSwipe,
  usePileKeys,
  useIsPhone,
  useUndo,
} from '@/components/desk';
import {
  BAND_LABEL,
  BAND_ORDER,
  actBeacon,
  actOnCard,
  fetchDeskFeed,
  formatReturnTime,
  sinkCard,
  type DeskCardData,
  type DeskFeed,
  type FeedAction,
} from '@/lib/desk-feed';
import type { CaseKind } from '@/lib/desk-case';
import { describeFailure } from '@/lib/desk-auth';
import { CasesRegister } from './cases-register';
import { ListingsRegister } from './listings-register';

/** How often the pile and ribbon refresh themselves. */
const REFRESH_MS = 60_000;

const TAG_ICON = {
  clock: IconClock,
  alert: IconAlert,
  lock: IconLock,
  check: IconCheck,
  info: IconInfo,
  bolt: IconBolt,
} as const;

/**
 * What a drawer-kind action opens.
 *
 * The listing target carries the card's own title and reference so the drawer
 * header is right in the frame before the dossier lands — the card already
 * knows them, and a header that says "Loading…" over a decision the operator
 * has already read on the card is a step backwards.
 */
type DrawerTarget =
  | { sort: 'listing'; listingId: string; title: string; reference?: string; cardId: string }
  | { sort: 'case'; caseKind: CaseKind; caseId: string }
  | { sort: 'order'; transactionId: string };

/**
 * The entity behind a card id.
 *
 * ⚠️ THE SERVER MINTS CARD IDS AS `type:entityId` (see DeskService), and the
 * entity half is what every drawer wants. Stripping the card's own type is
 * safer than splitting on the first colon: a cuid never contains one today,
 * but a future reference format might, and a drawer opened on half an id 404s
 * in a way that looks like a missing record rather than a parsing bug.
 */
function entityIdOf(card: DeskCardData): string {
  const prefix = `${card.type}:`;
  return card.id.startsWith(prefix) ? card.id.slice(prefix.length) : card.id;
}

/**
 * Which drawer a card opens, or null when nothing is built for it yet.
 *
 * ⚠️ NULL IS A REAL ANSWER AND IS SAID OUT LOUD. Firearm transfers, the payout
 * run and disputes all send a drawer-kind action down the wire and none of
 * them has a Desk surface yet; returning null here makes the card say so
 * instead of swallowing the press, which is how an operator concludes the
 * panel is broken and stops trusting the rest of it.
 */
function drawerTargetFor(card: DeskCardData): DrawerTarget | null {
  const id = entityIdOf(card);
  switch (card.type) {
    // ⚠️ THE SAME DRAWER AS listing_review, ON PURPOSE. A dead listing and a
    // listing awaiting review are the same object needing the same dossier;
    // what differs is why it is on the pile. Take-down wants an ACTIVE
    // listing, which until this card had no door into the Desk at all.
    case 'stale_listing':
    case 'listing_review':
      return {
        sort: 'listing',
        listingId: id,
        title: card.headline,
        reference: card.reference,
        // ⚠️ THE CARD ID, NOT A REBUILT ONE. Two card types open this drawer
        // and dropCard matches on the exact id, so reconstructing
        // `listing_review:<id>` silently no-ops for a stale_listing card and
        // leaves a taken-down listing sitting on the pile.
        cardId: card.id,
      };
    case 'complaint':
      return { sort: 'case', caseKind: 'complaint', caseId: id };
    case 'support':
      return { sort: 'case', caseKind: 'support', caseId: id };
    default:
      return null;
  }
}

interface Trouble {
  title: string;
  detail: string;
  scopeNote?: string;
}

/**
 * A cardId no card can have. See the ?listing= effect: a listing opened from
 * search has no card behind it, and dropCard must therefore match nothing.
 */
const DEEP_LINK_CARD_ID = 'deep-link:no-card';

export default function DeskPage() {
  const [feed, setFeed] = React.useState<DeskFeed | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [cursor, setCursor] = React.useState(0);
  const [trouble, setTrouble] = React.useState<Trouble | null>(null);
  /** Open drawers, innermost last. Only the last one is rendered. */
  const [stack, setStack] = React.useState<DrawerTarget[]>([]);
  const phone = useIsPhone();
  /**
   * The pile is the worklist; the register is the record.
   *
   * ⚠️ A LENS, NOT A SIXTH TAB — components/desk/tabs.tsx calls its list "the
   * five surfaces... nothing configurable about this list", and a register is
   * somewhere an operator goes with a question rather than somewhere they
   * live. Same shape the Ledger uses for its order book, same param name.
   */
  const [view, setView] = React.useState<'pile' | 'cases' | 'listings'>('pile');
  /** Bumped after a case decision so the register re-reads. */
  const [casesNonce, setCasesNonce] = React.useState(0);

  const undo = useUndo({
    onError: (err, action) =>
      setTrouble({
        title: 'That action did not go through',
        detail: `${action.message} — ${describeFailure(err)}`,
        scopeNote: 'the card is back in the pile',
      }),
  });

  const load = React.useCallback(async () => {
    try {
      setFeed(await fetchDeskFeed());
      setError(null);
    } catch (err) {
      setError(describeFailure(err));
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Refresh on a timer and whenever the tab comes back. An operator who has
  // been in their email for ten minutes should not act on a stale pile.
  React.useEffect(() => {
    const id = setInterval(() => void load(), REFRESH_MS);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  const openDrawer = React.useCallback((target: DrawerTarget) => {
    setStack((s) => [...s, target]);
  }, []);

  /**
   * `?listing=<listingId>` opens straight onto one listing's drawer.
   *
   * Where a Listings hit in the global search lands. The drawer fetches its
   * own dossier from the id and decides its own actions from the loaded
   * status — review on PENDING_REVIEW, take down on ACTIVE or
   * PAYMENT_PENDING — so an arbitrary listing opens correctly whether or not
   * it is anywhere in today's pile. That is the whole of the
   * /admin/listings/[id] reach gap.
   *
   * ⚠️ cardId IS THE DEEP-LINK SENTINEL, NOT A CARD. onDecided drops the
   * decided card from the pile by id; a listing opened from search has no
   * card, and passing a real-looking id would drop an unrelated one. A value
   * no card can carry drops nothing, which is correct — the feed reload after
   * a decision brings the board back in line.
   *
   * ⚠️ window.location, NOT useSearchParams — see the Ledger's note.
   */
  React.useEffect(() => {
    const v = new URLSearchParams(window.location.search).get('view');
    if (v === 'cases' || v === 'listings') setView(v);
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const deep = new URLSearchParams(window.location.search).get('listing');
    if (!deep) return;
    openDrawer({
      sort: 'listing',
      listingId: deep,
      title: 'Opening…',
      cardId: DEEP_LINK_CARD_ID,
    });
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Close the top drawer, revealing whatever it was opened over. */
  const closeTop = React.useCallback(() => {
    setStack((s) => s.slice(0, -1));
  }, []);

  const top = stack.length > 0 ? stack[stack.length - 1] : null;

  /**
   * Take a decided card off the board without re-reading the whole feed.
   *
   * ⚠️ THE RAIL COUNTS COME OFF WITH IT. The band tallies and the overdue
   * number are rendered from the same feed object, so dropping only the card
   * leaves the rail insisting there are four listing reviews above a band
   * showing three — and the rail is the thing an operator glances at to decide
   * whether they are finished.
   */
  const dropCard = React.useCallback((cardId: string) => {
    setFeed((f) => {
      if (!f) return f;
      const gone = f.cards.find((c) => c.id === cardId);
      if (!gone) return f;
      return {
        ...f,
        cards: f.cards.filter((c) => c.id !== cardId),
        bands: f.bands.map((b) =>
          b.key === gone.band ? { ...b, count: Math.max(0, b.count - 1) } : b,
        ),
        pile: gone.overdueSince
          ? { ...f.pile, overdue: Math.max(0, f.pile.overdue - 1) }
          : f.pile,
      };
    });
  }, []);

  // Cards still on screen: the one counting down under an undo window is
  // already gone as far as the operator is concerned.
  const visible = React.useMemo(
    () => (feed?.cards ?? []).filter((c) => !undo.isPending(c.id)),
    [feed, undo],
  );

  const selected = visible[cursor];

  const fire = React.useCallback(
    (card: DeskCardData, action: FeedAction) => {
      if (action.kind === 'link' && action.href) {
        window.open(action.href, '_blank', 'noopener');
        return;
      }
      if (action.kind === 'drawer') {
        const target = drawerTargetFor(card);
        if (target) {
          openDrawer(target);
          return;
        }
        setTrouble({
          title: 'Nothing to open yet',
          detail:
            `“${action.label}” on a ${card.typeLabel} card has no Desk surface yet.\n` +
            `Card ${card.id}. Use the legacy admin panel for this one until its drawer ships.`,
          scopeNote: 'nothing was sent — the card is untouched',
        });
        return;
      }
      /*
       * 🚨 MONEY HAS ONE PATH AND IT IS NOT THIS ONE — but it must not die
       * SILENTLY here, which is what it did. The Warden proposal card carries
       * "Approve the fix…" (kind 'money'); fire() handled link, then drawer,
       * then returned for everything else, so the operator pressed the button
       * on the pile and nothing happened at all. A dead control is worse than
       * a missing one because it is trusted.
       *
       * It is NOT reimplemented here. A second approval surface means a second
       * copy of the compare-and-swap that makes the confirm honest, and the
       * drifted copy is the one nobody reads. So the press takes the operator
       * to the card's own surface — every money-bearing card also carries a
       * link action to the place its confirm lives — and says so when it
       * cannot.
       */
      if (action.kind === 'money' || action.kind === 'gated') {
        const home = card.actions.find((x) => x.kind === 'link' && x.href);
        if (home?.href) {
          window.open(home.href, '_blank', 'noopener');
          return;
        }
        setTrouble({
          title: 'Approve it on its own surface',
          detail:
            `"${action.label}" moves money, and money is confirmed where the\n` +
            `exact command can be restated — not from the pile.\n` +
            `Card ${card.id} carries no link to that surface, which is a bug.`,
          scopeNote: 'nothing was sent — the card is untouched',
        });
        return;
      }
      // Anything left is a kind this board does not dispatch. Say so rather
      // than returning quietly — that silence is the bug above.
      if (action.kind !== 'undo') {
        setTrouble({
          title: 'That button is not wired here',
          detail: `"${action.label}" is a ${action.kind} action on ${card.id}.`,
          scopeNote: 'nothing was sent — the card is untouched',
        });
        return;
      }
      undo.run({
        cardId: card.id,
        message: action.doneMessage ?? `${action.label} ${card.reference ?? ''}`.trim(),
        commit: () => actOnCard(card.id, action.key),
        beacon: actBeacon(card.id, action.key),
      });
    },
    [openDrawer, undo],
  );

  const sink = React.useCallback(
    (card: DeskCardData) => {
      // Later is not undoable — it is already reversible by acting on the
      // card when it comes back — so it commits immediately.
      void sinkCard(card.id)
        .then(load)
        .catch((err) =>
          setTrouble({
            title: 'That action did not go through',
            detail: describeFailure(err),
            scopeNote: 'the card is back in the pile',
          }),
        );
    },
    [load],
  );

  usePileKeys({
    onMove: (d) => setCursor((c) => Math.max(0, Math.min(visible.length - 1, c + d))),
    onOpen: () => {
      if (!selected) return;
      const target = drawerTargetFor(selected);
      if (target) openDrawer(target);
    },
    onPrimary: () => {
      if (!selected) return;
      const primary = selected.actions.find((a) => a.kind === 'undo');
      if (primary) fire(selected, primary);
    },
    onLater: () => {
      if (selected?.canLater) sink(selected);
    },
    /**
     * ⚠️ DELIBERATELY EMPTY — THE SHELL OWNS CTRL+K NOW, and this page sits
     * OUTSIDE the shell it renders, so it cannot reach the shell's opener
     * through context. Both listeners are on `document` and both fire; the
     * shell's opens the palette, and anything here would be a second opener
     * racing the first.
     *
     * It is not the dead handler it replaced. That one read `() => undefined`
     * under a comment asserting "no search endpoint exists" — while
     * GET /admin/search had existed all along and SearchPalette sat finished
     * and mounted nowhere. Search now works from this page; it simply is not
     * this page's to wire.
     */
    onSearch: () => undefined,
    // Escape belongs to the drawer on top; the pile does not compete for it.
    onEscape: () => undefined,
    // ⚠️ WITHOUT THIS, "A" TYPED INTO A REJECTION NOTE FIRES THE PRIMARY
    // ACTION ON THE CARD BEHIND THE DRAWER. See usePileKeys.
    overlayOpen: stack.length > 0,
  });

  const rail = feed ? <DeskRail feed={feed} /> : null;
  const overdue = feed?.pile.overdue ?? 0;
  /**
   * ⚠️ THE OVERDUE FIGURE IS BAD-RED, THE REST IS NOT.
   *
   * The artboard paints it that way (Main.dc.html: `14 cards ·
   * <span style="color:#FF6B5E">3 overdue</span>`) and it is the one number in
   * the header worth a colour — it is the sole reason to open the app before
   * you meant to. As one flat string it rendered uniformly ink-3, so the thing
   * that was late looked exactly like the count of things that were not.
   *
   * Nothing is coloured when the count is zero: there is no overdue segment at
   * all, rather than a red nought.
   */
  const sub = feed ? (
    <>
      {`${visible.length} ${visible.length === 1 ? 'thing needs' : 'things need'} you`}
      {overdue ? (
        <>
          {' · '}
          <span style={{ color: 'var(--dk-bad)' }}>{`${overdue} overdue`}</span>
        </>
      ) : null}
    </>
  ) : (
    'Loading…'
  );

  return (
    <DeskShell active="desk" title="The Desk" sub={sub} rail={rail}>
      {feed ? <Ribbon cells={feed.ribbon} compact={phone} /> : null}

      {/* ⚠️ THE PILE IS THE DEFAULT AND MUST STAY ONE. A passive register is
          never what an operator should land on when the thing they came to do
          is work today's cards — the same argument the Ledger makes for
          defaulting to the payout run rather than the order book. */}
      <div style={{ display: 'flex', gap: 8, paddingBottom: 2 }}>
        <Chip active={view === 'pile'} onClick={() => setView('pile')}>
          Today
        </Chip>
        <Chip active={view === 'cases'} onClick={() => setView('cases')}>
          Cases
        </Chip>
        <Chip active={view === 'listings'} onClick={() => setView('listings')}>
          Listings
        </Chip>
      </div>

      {view === 'cases' ? (
        <CasesRegister
          refreshKey={casesNonce}
          onOpen={(kind, id) => openDrawer({ sort: 'case', caseKind: kind, caseId: id })}
        />
      ) : view === 'listings' ? (
        <ListingsRegister
          onOpen={(listingId) =>
            openDrawer({
              sort: 'listing',
              listingId,
              title: 'Opening…',
              // No card behind it — see DEEP_LINK_CARD_ID.
              cardId: DEEP_LINK_CARD_ID,
            })
          }
        />
      ) : (
        <>

      {trouble ? (
        <FailedRegion
          title={trouble.title}
          detail={trouble.detail}
          onRetry={() => {
            setTrouble(null);
            void load();
          }}
          scopeNote={trouble.scopeNote}
        />
      ) : null}

      {error ? (
        <FailedRegion title="Couldn't load the pile" detail={error} onRetry={() => void load()} />
      ) : !feed ? (
        <SkeletonPile count={3} />
      ) : visible.length === 0 ? (
        <AllClear next="New work lands here the moment it appears — a listing to review, a dealer transfer, a dispute, or Warden with something it cannot fix alone." />
      ) : (
        <>
          {BAND_ORDER.map((key) => {
            const cards = visible.filter((c) => c.band === key);
            return (
              <Band key={key} label={BAND_LABEL[key]} count={cards.length}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {cards.map((card) => (
                    <PileCard
                      key={card.id}
                      card={card}
                      phone={phone}
                      selected={selected?.id === card.id}
                      onSelect={() => setCursor(visible.findIndex((c) => c.id === card.id))}
                      onAction={(a) => fire(card, a)}
                      onLater={() => sink(card)}
                    />
                  ))}
                </div>
              </Band>
            );
          })}
          {!phone ? <ShortcutFooter /> : null}
        </>
      )}
        </>
      )}

      {/* ⚠️ THE DRAWERS SIT OUTSIDE THE LENS. The register opens the Case
          drawer too, so mounting them inside the pile branch would make a
          row in the register press-and-do-nothing. */}
      {undo.pending ? (
        <UndoToast message={undo.pending.message} seconds={undo.seconds} onUndo={undo.undo} />
      ) : null}

      {/* ── The drawers. Only the top of the stack is mounted. ────────── */}

      <ListingDrawer
        listingId={top?.sort === 'listing' ? top.listingId : null}
        onClose={closeTop}
        // The server has already moved the listing out of PENDING_REVIEW by
        // the time this fires, so the card is gone whichever way it went.
        onDecided={() => {
          if (top?.sort === 'listing') dropCard(top.cardId);
        }}
        fallbackTitle={top?.sort === 'listing' ? top.title : undefined}
        fallbackReference={top?.sort === 'listing' ? top.reference : undefined}
      />

      {top?.sort === 'case' ? (
        <CaseDrawer
          open
          caseKind={top.caseKind}
          caseId={top.caseId}
          onClose={closeTop}
          // ⚠️ A REPLY LEAVES THE CASE OPEN AND A RESOLUTION CLOSES IT, and
          // onChanged cannot say which — it carries no outcome. So this is the
          // one place the board re-reads itself rather than editing a card in
          // place: guessing would either strand a resolved case on the pile or
          // hide one that is still waiting on the member.
          onChanged={() => {
            void load();
            // The register is a separate read; without this a case decided
            // from it keeps its old state until the operator reloads.
            setCasesNonce((n) => n + 1);
          }}
          /*
           * ⚠️ STEPPING INTO THE ORDER COSTS AN UNSENT DRAFT. CaseDrawer
           * clears its reply box on every open by design — "a fresh case is a
           * fresh draft" — so coming back from the order starts the message
           * again. The button that leads here sits in the money section at the
           * top of the drawer, above the reply box, so the usual order of work
           * is check-then-type; but an operator who types first and then goes
           * to look at a figure loses what they wrote. Worth solving with a
           * draft that survives the round trip, not by mounting both drawers:
           * two Drawers share one Escape and one Tab trap.
           */
          onOpenOrder={(transactionId) => openDrawer({ sort: 'order', transactionId })}
        />
      ) : null}

      {top?.sort === 'order' ? (
        <OrderDrawer open transactionId={top.transactionId} onClose={closeTop} />
      ) : null}
    </DeskShell>
  );
}

/**
 * One card, plus the phone's swipe behaviour.
 *
 * ⚠️ THE REVEAL SITS BEHIND THE CARD AND THE CARD FACE NEVER CHANGES WHILE
 * SWIPING. A face that morphs mid-gesture means the operator is aiming at a
 * moving target with their thumb, and the whole point of swipe-to-approve is
 * that it can be done without looking carefully.
 */
function PileCard({
  card,
  phone,
  selected,
  onSelect,
  onAction,
  onLater,
}: {
  card: DeskCardData;
  phone: boolean;
  selected: boolean;
  onSelect: () => void;
  onAction: (a: FeedAction) => void;
  onLater: () => void;
}) {
  const primary = card.actions.find((a) => a.kind === 'undo');
  // Swipe is offered only where the primary action is undoable — never on a
  // money card. See useSwipe.
  const swipeable = phone && Boolean(primary);

  const swipe = useSwipe({
    enabled: swipeable,
    onSwipeRight: primary ? () => onAction(primary) : undefined,
    onSwipeLeft: card.canLater ? onLater : undefined,
  });

  const inner = (
    <DeskCard
      type={card.type}
      typeLabel={card.typeLabel}
      reference={card.reference}
      headline={card.headline}
      meta={card.meta}
      note={card.note}
      selected={selected}
      canLater={card.canLater}
      laterUntil={card.laterUntil ? formatReturnTime(card.laterUntil) : undefined}
      onLater={onLater}
      onSelect={onSelect}
      /* ⚠️ THE RED GATE AND THE PROPOSAL ARE BOTH type 'warden', so one icon
         per TYPE drew a bolt on both — where the catalogue draws a padlock on
         the gate. The server says which; this is the only place that can
         honour it. */
      iconOverride={card.icon ? TAG_ICON[card.icon] : undefined}
      tags={card.tags.map((t) => ({
        kind: t.kind,
        label: t.label,
        icon: t.icon ? TAG_ICON[t.icon] : undefined,
      }))}
      actions={card.actions.map((a) => ({
        label: a.label,
        variant: a.kind === 'gated' ? 'gated' : a.variant,
        amount: a.amount,
        onClick: () => onAction(a),
      }))}
    />
  );

  if (!swipeable) return inner;

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 'var(--dk-radius-card)' }}>
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: swipe.dx >= 0 ? 'flex-start' : 'flex-end',
          padding: '0 20px',
          background: swipe.dx >= 0 ? 'var(--dk-ok)' : 'var(--dk-inset)',
          color: swipe.dx >= 0 ? 'var(--dk-ground)' : 'var(--dk-ink-2)',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {swipe.dx >= 0 ? primary?.label ?? '' : 'Later'}
      </div>
      <div
        {...swipe.handlers}
        style={{
          transform: `translateX(${swipe.dx}px)`,
          transition: swipe.dragging ? 'none' : 'transform 160ms ease-out',
          touchAction: 'pan-y',
        }}
      >
        {inner}
      </div>
    </div>
  );
}

function DeskRail({ feed }: { feed: DeskFeed }) {
  return (
    <>
      <RailCard label="Money right now">
        <Kv k="Held" v={feed.money.held} />
        <Kv k="Payable" v={feed.money.payable} />
        {/* Amber only when something IS blocked. The tone was hard-coded,
            so R0 — nothing blocked, the state you want — was painted as a
            warning on every load, next to three white rows reading R0. */}
        <Kv
          k="Blocked"
          v={feed.money.blocked}
          tone={(feed.money.blockedCents ?? 0) > 0 ? 'warn' : undefined}
        />
        <Kv k="Refund pending" v={feed.money.refundPending} last />
        {feed.money.gateNote ? (
          <span style={{ fontSize: 11.5, color: 'var(--dk-warn)', marginTop: 2, lineHeight: 1.45 }}>
            {feed.money.gateNote}
          </span>
        ) : null}
      </RailCard>

      <RailCard label="The pile">
        {feed.bands.map((b, i) => (
          <Kv
            key={b.key}
            k={BAND_LABEL[b.key]}
            v={b.count}
            last={i === feed.bands.length - 1}
          />
        ))}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
          {feed.pile.overdue > 0 ? (
            <span style={{ fontSize: 11.5, color: 'var(--dk-bad)' }}>{feed.pile.overdue} overdue</span>
          ) : null}
          {feed.pile.sunk > 0 ? (
            <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>
              {feed.pile.sunk} sunk with Later
              {feed.pile.sunkReturnsAt ? ` · back ${formatReturnTime(feed.pile.sunkReturnsAt)}` : ''}
            </span>
          ) : null}
        </div>
      </RailCard>

      <RailCard label="Just happened">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {feed.activity.map((a, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 10,
                padding: '7px 0',
                borderBottom: i === feed.activity.length - 1 ? undefined : '1px solid var(--dk-line)',
              }}
            >
              <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-4)', flex: 'none' }}>
                {a.time}
              </span>
              <span style={{ fontSize: 12.5, color: 'var(--dk-ink-2)', lineHeight: 1.45 }}>{a.text}</span>
            </div>
          ))}
        </div>
      </RailCard>
    </>
  );
}
