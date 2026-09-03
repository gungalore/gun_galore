'use client';

/**
 * THE DESK — the listing drawer.
 *
 * Opens off a PENDING_REVIEW card on the Pile, and replaces the legacy
 * /admin/listings/[id] page. Its whole job is one decision: does this go
 * live? So it carries the photos, the seller's own words, the category and
 * what that category makes this listing, the model's read of it, and the two
 * buttons — and it deliberately leaves the trading history (offers, bids,
 * transactions) on the wire unrendered, because none of it is an input to
 * that decision and a listing awaiting review has none of it anyway.
 *
 * ⚠️ REGULATED IS A BAND, NOT A BADGE. The compliance strip is the first
 * thing in the body, it cannot be collapsed, and the same fact is repeated in
 * the note directly above the buttons. An operator working a queue of forty
 * reads the top of a drawer and the bottom of it; a firearm has to land in
 * both places, because approving a licence-controlled item is a different act
 * from approving a camp chair.
 */
import * as React from 'react';
// Siblings, not './index' — the barrel is the surface SCREENS import from,
// and a kit file importing its own barrel is a cycle waiting to bite. Every
// other file in this directory does the same.
import { Button, Tag, type TagKind } from './primitives';
import { DialogFrame, Drawer, ResultBlock, Section, Timeline, type TimelineStep } from './overlays';
import { ReasonDialog } from './dialogs';
import { FailedRegion } from './states';
import { Kv, Label, formatRand } from './numbers';
import { IconAlert, IconExternal, IconImage, IconInfo, IconShield } from './icons';
import { DeskFetchError, describeFailure } from '@/lib/desk-auth';
import {
  LICENCE_PHOTO_NOTE,
  LISTING_REJECT_REASONS,
  LISTING_TAKEDOWN_REASONS,
  STATUS_LABEL,
  canReview,
  canTakeDown,
  composeSellerReason,
  fetchListingDossier,
  humanise,
  licenceNeedsSaying,
  licenceStanding,
  modelVerdict,
  noDecisionReason,
  regulatedFlags,
  reviewListing,
  sellerTake,
  stamp,
  takeDownListing,
  waitedFor,
  type DossierListing,
  type ListingDossier,
  type ListingStatusWire,
  type RegulatedFlag,
} from '@/lib/desk-listing';

export interface ListingDrawerProps {
  /** The listing to open. Null closes the drawer. */
  listingId: string | null;
  onClose: () => void;
  /** Fired after a decision lands, so the board can drop the card. */
  onDecided?: (listingId: string, outcome: 'approved' | 'rejected' | 'taken-down') => void;
  /** The card already knows these; they fill the header while the dossier loads. */
  fallbackTitle?: string;
  fallbackReference?: string;
}

type Pending = 'approve' | 'reject' | 'takedown' | null;

const STATUS_TAG: Record<ListingStatusWire, TagKind> = {
  DRAFT: 'neutral',
  PENDING_REVIEW: 'warn',
  ACTIVE: 'ok',
  PAYMENT_PENDING: 'info',
  SOLD: 'neutral',
  CANCELLED: 'bad',
  EXPIRED: 'neutral',
};

export function ListingDrawer({
  listingId,
  onClose,
  onDecided,
  fallbackTitle,
  fallbackReference,
}: ListingDrawerProps) {
  const [dossier, setDossier] = React.useState<ListingDossier | null>(null);
  // ⚠️ FAILURES ARE STAMPED WITH THE LISTING THEY BELONG TO, for the same
  // reason the dossier is checked against listingId below.
  const [loadError, setLoadError] = React.useState<{ id: string; err: unknown } | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [dialog, setDialog] = React.useState<Pending>(null);
  // WHICH decision is in flight, not merely that one is: the spinner belongs
  // on the button the operator pressed, and a shared boolean spins Approve
  // while a rejection is posting.
  const [inFlight, setInFlight] = React.useState<Pending>(null);
  const [actionError, setActionError] = React.useState<{ id: string; text: string } | null>(null);
  const busy = inFlight !== null;

  React.useEffect(() => {
    if (!listingId) return;
    let live = true;
    setDossier(null);
    setLoadError(null);
    setActionError(null);
    fetchListingDossier(listingId)
      .then((d) => {
        if (live) setDossier(d);
      })
      .catch((err) => {
        if (live) setLoadError({ id: listingId, err });
      });
    // Nothing is written on unmount — dropping the result of a request whose
    // drawer has closed is the whole point of the flag.
    return () => {
      live = false;
    };
  }, [listingId, reloadKey]);

  /**
   * ⚠️ THE DOSSIER OF THE PREVIOUS CARD IS NOT THIS CARD. The effect that
   * clears state runs AFTER the render that changed listingId, so for one
   * frame the last listing's photos, words and firearm flag sit under the new
   * listing's id — and the footer buttons post to the new id. An operator
   * mid-swipe through a queue could approve B while looking at A. Matching the
   * loaded row against the requested id makes that frame a loading state.
   */
  const loaded = dossier && dossier.listing.id === listingId ? dossier : null;
  const l = loaded?.listing ?? null;
  const showLoadError = loadError && loadError.id === listingId ? loadError.err : null;
  const showActionError = actionError && actionError.id === listingId ? actionError.text : null;

  async function run(
    which: Exclude<Pending, null>,
    outcome: 'approved' | 'rejected' | 'taken-down',
    work: () => Promise<unknown>,
  ) {
    if (!listingId || busy) return;
    // ⚠️ THE DIALOG CLOSES BEFORE THE AWAIT, NOT AFTER. Left open across the
    // round-trip it is a second confirm button with no spinner on it, and a
    // slow network turns one rejection into two emails to the same seller.
    setDialog(null);
    setInFlight(which);
    setActionError(null);
    try {
      await work();
      onDecided?.(listingId, outcome);
      onClose();
    } catch (err) {
      // ⚠️ THE DRAWER STAYS OPEN ON A FAILURE. The server's words are the only
      // useful thing on screen at that moment, and a drawer that closes takes
      // them with it.
      setActionError({ id: listingId, text: describeActionFailure(err) });
    } finally {
      setInFlight(null);
    }
  }

  if (!listingId) return null;

  const flags = l ? regulatedFlags(l) : [];
  const licence = l ? licenceStanding(l) : null;
  const verdict = l ? modelVerdict(l) : null;
  const reviewable = l ? canReview(l.status) : false;
  const removable = l ? canTakeDown(l.status) : false;
  // A firearm, an unattested papers category, an experience — anything the
  // band paints in bad or warn — gets a confirm in front of the approve. An
  // ordinary item does not: the pile is a queue, and a confirm on every
  // camp chair is how operators learn to click through confirms.
  const approveNeedsConfirm =
    flags.some((f) => f.tone === 'bad' || f.tone === 'warn') || licenceNeedsSaying(licence);

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        typeLabel={reviewable ? 'Listing review' : 'Listing'}
        reference={l?.referenceNumber ?? fallbackReference}
        icon={IconImage}
        title={l?.title ?? fallbackTitle ?? 'Loading…'}
        meta={l ? <HeaderMeta listing={l} /> : undefined}
        tags={
          l ? (
            <>
              <Tag kind={STATUS_TAG[l.status]}>{STATUS_LABEL[l.status]}</Tag>
              <Tag kind="neutral">{humanise(l.listingType)}</Tag>
              <Tag kind="neutral">{humanise(l.condition)}</Tag>
              {l.isFirearm ? (
                <Tag kind="bad" icon={IconShield}>
                  Firearm
                </Tag>
              ) : null}
            </>
          ) : undefined
        }
        headerActions={
          <a
            href={`/listings/${listingId}`}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 28,
              padding: '0 8px',
              borderRadius: 'var(--dk-radius-control)',
              color: 'var(--dk-ink-2)',
              fontSize: 12.5,
              textDecoration: 'none',
            }}
          >
            Public page
            <IconExternal size={13} />
          </a>
        }
        note={l ? <FooterNote listing={l} reviewable={reviewable} removable={removable} /> : undefined}
        footer={
          l ? (
            <>
              <span style={{ flex: 1 }} />
              {reviewable ? (
                <>
                  <Button
                    variant="danger"
                    loading={inFlight === 'reject'}
                    onClick={() => setDialog('reject')}
                    disabled={busy}
                  >
                    Reject…
                  </Button>
                  <Button
                    variant="primary"
                    loading={inFlight === 'approve'}
                    disabled={busy}
                    onClick={() =>
                      approveNeedsConfirm
                        ? setDialog('approve')
                        : run('approve', 'approved', () => reviewListing(listingId, 'APPROVE'))
                    }
                  >
                    {approveNeedsConfirm ? 'Approve…' : 'Approve'}
                  </Button>
                </>
              ) : removable ? (
                <Button
                  variant="danger"
                  loading={inFlight === 'takedown'}
                  disabled={busy}
                  onClick={() => setDialog('takedown')}
                >
                  Take down…
                </Button>
              ) : (
                // Gated, never disabled: the control's job here is to say that
                // no decision applies, and a greyed button says nothing at all.
                // The sentence lives in the note above — a button label is
                // nowrap, and a whole sentence in one would run off the drawer.
                <Button variant="gated">No decision applies</Button>
              )}
            </>
          ) : undefined
        }
      >
        {showLoadError ? (
          <div style={{ padding: 20 }}>
            <FailedRegion
              title="Couldn’t load this listing"
              detail={describeFailure(showLoadError)}
              onRetry={() => setReloadKey((k) => k + 1)}
              scopeNote="the pile behind this drawer is unaffected"
            />
          </div>
        ) : !l ? (
          <LoadingBody />
        ) : (
          <>
            <ComplianceBand flags={flags} licence={licence} />

            {showActionError ? (
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--dk-line)' }}>
                <ResultBlock ok={false} tag="Decision not recorded" body={showActionError} />
              </div>
            ) : null}

            <Photos listing={l} />

            <Section label="The seller’s words">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Prose>{l.description || 'No description.'}</Prose>
                {verdict?.autoFixApplied && verdict.originalDescription ? (
                  <div
                    style={{
                      padding: 12,
                      background: 'var(--dk-surface)',
                      border: '1px solid var(--dk-line)',
                      borderRadius: 10,
                    }}
                  >
                    <Label>Before the model edited it</Label>
                    <div style={{ marginTop: 8 }}>
                      <Prose muted>{verdict.originalDescription}</Prose>
                    </div>
                  </div>
                ) : null}
              </div>
            </Section>

            <ModelSection verdict={verdict} />

            <Section label="The item">
              <Kv k="Category" v={l.category.name} mono={false} />
              <Kv k="Price" v={l.price === null ? '—' : formatRand(l.price)} />
              <SellerFigure listing={l} />
              {l.make || l.model ? (
                <Kv k="Make / model" v={[l.make, l.model].filter(Boolean).join(' ')} mono={false} />
              ) : null}
              {l.calibre ? <Kv k="Calibre" v={l.calibre} /> : null}
              <Kv
                k="Shown as"
                v={[l.publicLocality, humanise(l.province)].filter(Boolean).join(', ') || '—'}
                mono={false}
              />
              <Kv
                k="Delivery"
                v={l.shippingMethods.map(humanise).join(', ') || '—'}
                mono={false}
                last
              />
            </Section>

            {l.isFirearm ? <FirearmSection listing={l} /> : null}

            <Section label="Seller">
              <Kv k="Username" v={l.seller.username ?? '—'} />
              <Kv k="Tier" v={humanise(l.seller.sellerTier)} mono={false} />
              <Kv
                k="KYC"
                v={humanise(l.seller.kycStatus)}
                mono={false}
                tone={l.seller.kycStatus === 'VERIFIED' ? 'ok' : 'warn'}
              />
              <Kv k="Trust score" v={l.seller.trustScore ?? '—'} last />
            </Section>

            {loaded ? <HistorySection dossier={loaded} last /> : null}
          </>
        )}
      </Drawer>

      {/* Reject — a ticklist, because the seller reads what is ticked. */}
      <ReasonDialog
        open={dialog === 'reject'}
        onCancel={() => setDialog(null)}
        onConfirm={(reason, note) =>
          run('reject', 'rejected', () =>
            reviewListing(
              listingId,
              'REJECT',
              composeSellerReason(LISTING_REJECT_REASONS, reason, note),
            ),
          )
        }
        title={<>Reject {l?.referenceNumber ?? 'this listing'}?</>}
        options={LISTING_REJECT_REASONS.map((r) => ({
          value: r.value,
          label: r.label,
          consequence: r.sellerText,
        }))}
        confirmLabel="Reject and email the seller"
        noteHint="The seller is emailed the sentence above, plus anything you add here."
      />

      {/* Take-down — a live listing disappearing on people who saw it. */}
      <ReasonDialog
        open={dialog === 'takedown'}
        onCancel={() => setDialog(null)}
        onConfirm={(reason, note) =>
          run('takedown', 'taken-down', () =>
            takeDownListing(
              listingId,
              composeSellerReason(LISTING_TAKEDOWN_REASONS, reason, note),
            ),
          )
        }
        label="Take down · reason"
        title={<>Take down {l?.referenceNumber ?? 'this listing'}?</>}
        options={LISTING_TAKEDOWN_REASONS.map((r) => ({
          value: r.value,
          label: r.label,
          consequence: r.sellerText,
        }))}
        confirmLabel="Take down and email the seller"
        noteHint="The seller is emailed this and the listing leaves search immediately."
      />

      {dialog === 'approve' && l ? (
        <ApproveConfirm
          listing={l}
          flags={flags}
          // Same predicate as the band, from the same function: anything worth
          // an uncollapsible row at the top is worth a line under the cursor.
          licenceLabel={licenceNeedsSaying(licence) ? (licence?.label ?? null) : null}
          onCancel={() => setDialog(null)}
          onConfirm={() => run('approve', 'approved', () => reviewListing(listingId, 'APPROVE'))}
        />
      ) : null}
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * The compliance band
 * ──────────────────────────────────────────────────────────────────────── */

const BAND_TONE = {
  bad: { wash: 'var(--dk-bad-wash)', line: 'var(--dk-bad-line)', ink: 'var(--dk-bad)' },
  warn: { wash: 'var(--dk-warn-wash)', line: 'var(--dk-warn-line)', ink: 'var(--dk-warn)' },
  info: { wash: 'var(--dk-info-wash)', line: 'var(--dk-info-line)', ink: 'var(--dk-info)' },
} as const;

const FLAG_ICON = {
  bad: IconShield,
  warn: IconAlert,
  info: IconInfo,
} as const;

/**
 * ⚠️ NOT A Section. Section is a titled block among other titled blocks, and
 * this must not read as one thing among many — it is the frame the rest of
 * the drawer is read inside. It is also the reason nothing here collapses:
 * an operator cannot decide not to have seen it.
 *
 * A listing in an unregulated category renders no band at all. The absence is
 * the signal, the same way an empty band on the pile does not draw a heading.
 */
function ComplianceBand({
  flags,
  licence,
}: {
  flags: RegulatedFlag[];
  licence: ReturnType<typeof licenceStanding> | null;
}) {
  const licenceRow = licenceNeedsSaying(licence) ? licence : null;
  if (flags.length === 0 && !licenceRow) return null;

  const strongest: 'bad' | 'warn' | 'info' = flags.some((f) => f.tone === 'bad')
    ? 'bad'
    : flags.some((f) => f.tone === 'warn') || licenceRow
      ? 'warn'
      : 'info';
  const tone = BAND_TONE[strongest];

  return (
    <div
      role="note"
      style={{
        margin: '16px 20px',
        padding: '13px 15px',
        background: tone.wash,
        border: `1px solid ${tone.line}`,
        borderRadius: 'var(--dk-radius-card)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <Label>Regulated category</Label>
      {flags.map((f) => {
        const Glyph = FLAG_ICON[f.tone];
        return (
          <div key={f.key} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
            <Glyph size={14} style={{ color: BAND_TONE[f.tone].ink, marginTop: 2 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: BAND_TONE[f.tone].ink }}>
                {f.label}
              </span>
              <span style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--dk-ink-2)' }}>
                {f.detail}
              </span>
            </div>
          </div>
        );
      })}
      {licenceRow ? (
        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
          <IconAlert
            size={14}
            style={{ color: BAND_TONE[licenceRow.tone === 'bad' ? 'bad' : 'warn'].ink, marginTop: 2 }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: BAND_TONE[licenceRow.tone === 'bad' ? 'bad' : 'warn'].ink,
              }}
            >
              Licence · {licenceRow.label}
            </span>
            {/*
              The missing-expiry case gets its own sentence and not the
              thirty-to-ninety-day one: nothing was captured, so there is no
              window to be inside and the cron has nothing to measure. Reusing
              the warning copy here would describe a countdown that does not
              exist on a listing where the licence's standing is simply unknown.
            */}
            <span style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--dk-ink-2)' }}>
              {licenceRow.state === 'unknown'
                ? 'Nothing on this listing says when the licence runs out, so neither the listing gate nor the daily cron can check it. Open the licence document and confirm the expiry before publishing.'
                : licenceRow.tone === 'bad'
                  ? 'Inside thirty days the daily cron delists this again within the day. Approving it now reads to the seller as us contradicting ourselves.'
                  : 'The seller is warned once between ninety and thirty days out, then it is delisted automatically.'}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Sections
 * ──────────────────────────────────────────────────────────────────────── */

function Photos({ listing }: { listing: DossierListing }) {
  const images = [...listing.images].sort((a, b) => a.order - b.order);
  return (
    <Section label={`Photos · ${images.length}`}>
      {images.length === 0 ? (
        <span style={{ fontSize: 12.5, color: 'var(--dk-warn)' }}>
          No photos. A listing with nothing to look at is not a listing a buyer can judge.
        </span>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
            gap: 8,
          }}
        >
          {images.map((img, i) => (
            <a
              key={img.id}
              href={img.url}
              target="_blank"
              rel="noreferrer"
              // The image itself is alt="" on purpose — we have not seen it and
              // will not invent a description of evidence. But an empty alt on
              // the only content of a link leaves the link with no accessible
              // name at all, so the position carries it.
              aria-label={
                img.isPrimary
                  ? `Open photo ${i + 1} of ${images.length} (main)`
                  : `Open photo ${i + 1} of ${images.length}`
              }
              style={{
                position: 'relative',
                display: 'block',
                aspectRatio: '1 / 1',
                borderRadius: 10,
                overflow: 'hidden',
                border: `1px solid ${img.isPrimary ? 'var(--dk-line-2)' : 'var(--dk-line)'}`,
                background: 'var(--dk-inset)',
              }}
            >
              {/*
                A plain <img>, not next/image, and deliberately so: these are
                evidence. The optimiser re-encodes and downsizes, and a
                moderation call turns on detail — a scuff, a serial, a
                watermark someone lifted the photo from.
              */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              {img.isPrimary ? (
                <span
                  className="dk-mono"
                  style={{
                    position: 'absolute',
                    left: 5,
                    bottom: 5,
                    padding: '2px 6px',
                    fontSize: 10,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    color: 'var(--dk-ground)',
                    background: 'var(--dk-ink)',
                    borderRadius: 'var(--dk-radius-pill)',
                  }}
                >
                  Main
                </span>
              ) : null}
            </a>
          ))}
        </div>
      )}
    </Section>
  );
}

/**
 * The seller's own number, called what it actually is.
 *
 * ⚠️ NOTHING HERE IS ARITHMETIC. The cents come off the column and the label
 * comes from sellerTake, which mirrors the one rule the platform's fee builder
 * branches on. Two money figures side by side that differ by our markup will be
 * read as a deduction unless the screen says otherwise, and on an experience
 * the ask is not a payout at all — so the sentence is part of the row, not a
 * footnote somewhere else.
 */
function SellerFigure({ listing }: { listing: DossierListing }) {
  const take = sellerTake(listing);
  if (!take) return null;
  return (
    <>
      <Kv k={take.label} v={formatRand(take.cents)} tone={take.tone} />
      {take.note ? (
        <span
          style={{
            display: 'block',
            padding: '2px 0 8px',
            fontSize: 11.5,
            lineHeight: 1.45,
            color: take.tone === 'warn' ? 'var(--dk-warn)' : 'var(--dk-ink-3)',
          }}
        >
          {take.note}
        </span>
      ) : null}
    </>
  );
}

function ModelSection({ verdict }: { verdict: ReturnType<typeof modelVerdict> }) {
  return (
    <Section label="Model verdict · advisory">
      {!verdict ? (
        <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)' }}>
          The model never scored this listing. Read it yourself.
        </span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Tag kind={verdict.tone}>{verdict.label}</Tag>
            {verdict.confidencePct !== null ? (
              <span className="dk-mono" style={{ fontSize: 12, color: 'var(--dk-ink-3)' }}>
                {verdict.confidencePct}% confidence
              </span>
            ) : null}
            <span className="dk-mono" style={{ fontSize: 11.5, color: 'var(--dk-ink-4)' }}>
              {stamp(verdict.reviewedAt)}
            </span>
          </div>
          {/*
            ⚠️ SAID IN WORDS, EVERY TIME. The tag above is the model's opinion
            and the operator's decision overrides it. Written out rather than
            left to the "advisory" in the section label, because the label is
            the thing an eye skips on the fortieth listing of the morning.
          */}
          <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--dk-ink-3)' }}>
            This is what the model thought at upload, not a fact about the listing. Your call
            replaces it.
          </span>
          {verdict.reasons.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
              {verdict.reasons.map((r, i) => (
                <li key={i} style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--dk-ink-2)' }}>
                  {r}
                </li>
              ))}
            </ul>
          ) : null}
          {verdict.autoFixApplied ? (
            <span style={{ fontSize: 12, color: 'var(--dk-warn)' }}>
              The model rewrote the description. The seller’s original is above.
            </span>
          ) : null}
        </div>
      )}
    </Section>
  );
}

function FirearmSection({ listing }: { listing: DossierListing }) {
  const licence = licenceStanding(listing);
  return (
    <Section label="Licence and serial">
      <Kv k="Type" v={listing.firearmType ?? '—'} mono={false} />
      <Kv k="Serial" v={listing.serialNumber ?? '—'} tone={listing.serialNumber ? undefined : 'warn'} />
      <Kv
        k="Licence expiry"
        v={licence.label}
        mono={false}
        tone={licence.tone === 'info' ? undefined : licence.tone}
      />
      <Kv k="Planned dealer" v={listing.plannedDealerLocation ?? '—'} mono={false} />
      <Kv
        k="Private arrangement"
        v={listing.privateArrangeConsentAt ? 'Seller consented' : 'Not offered'}
        mono={false}
        last
      />

      {/*
        ⚠️ THE PROOF DOCUMENTS ARE LINKS, NOT THUMBNAILS. A licence photo
        carries the holder's full name and their identity number. Rendering it
        beside the item photos would put both on screen for every firearm in
        the queue, on whatever screen the operator happens to be sharing.
        Behind a link, seeing it is a deliberate act by someone who decided
        this decision needs it.
      */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
        <ProofLink
          url={listing.serialPhotoUrl}
          label="Serial photo"
          missing="No serial photo on file"
        />
        <ProofLink
          url={listing.licencePhotoUrl}
          label="Licence document"
          missing="No licence photo on file"
          note={LICENCE_PHOTO_NOTE}
        />
      </div>
    </Section>
  );
}

function ProofLink({
  url,
  label,
  missing,
  note,
}: {
  url: string | null;
  label: string;
  missing: string;
  note?: string;
}) {
  if (!url) {
    return (
      <span style={{ fontSize: 12.5, color: 'var(--dk-warn)' }}>{missing}</span>
    );
  }
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          fontSize: 12.5,
          color: 'var(--dk-ink)',
          textDecoration: 'underline',
          textUnderlineOffset: 3,
        }}
      >
        {label}
        <IconExternal size={13} />
      </a>
      {note ? <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>{note}</span> : null}
    </span>
  );
}

/**
 * What has already happened to this listing.
 *
 * ⚠️ auditEvents IS EMPTY TODAY. The dossier queries AdminAuditEvent for
 * resourceType 'Listing', but neither reviewListing nor deleteListing calls
 * AdminAuditService — they stamp the decision onto the listing row instead
 * (adminReviewedAt + adminOverrideReason). So the listing's own stamp is the
 * primary record here and the audit rows are rendered underneath it for the
 * day someone wires the logger. Reading only the audit array would have shown
 * an empty history on a listing that had been rejected twice.
 */
function HistorySection({ dossier, last }: { dossier: ListingDossier; last?: boolean }) {
  const l = dossier.listing;
  const steps: TimelineStep[] = [
    { title: 'Listed by the seller', sub: stamp(l.createdAt), state: 'done' },
  ];
  if (l.claudeReviewedAt) {
    steps.push({ title: 'Model scored it', sub: stamp(l.claudeReviewedAt), state: 'done' });
  }
  if (l.adminReviewedAt) {
    steps.push({
      title: l.adminOverrideReason ? `Decided — ${l.adminOverrideReason}` : 'Decided by an operator',
      sub: stamp(l.adminReviewedAt),
      state: l.status === 'CANCELLED' ? 'bad' : 'done',
    });
  }
  // ⚠️ THE ENDPOINT SENDS THESE NEWEST-FIRST AND A TIMELINE READS OLDEST-FIRST.
  // The dossier queries them `orderBy: { createdAt: 'desc' }`, so appending
  // them as they arrive runs the middle of this timeline backwards — a listing
  // rejected then reinstated would read as reinstated then rejected. Reversed
  // rather than sorted: the server has already ordered them, and re-sorting on
  // a string date here would be a second, weaker ordering to keep in step.
  for (const e of [...dossier.auditEvents].reverse()) {
    steps.push({
      title: e.reason ? `${humanise(e.action)} — ${e.reason}` : humanise(e.action),
      sub: `${stamp(e.createdAt)}${e.adminUser ? ` · ${e.adminUser.email}` : ''}`,
      state: /REJECT|DELETE|REMOVE|CANCEL/.test(e.action) ? 'bad' : 'done',
    });
  }
  if (l.status === 'PENDING_REVIEW') {
    steps.push({ title: `Waiting on us · ${waitedFor(l.createdAt)}`, state: 'now' });
  }

  // ⚠️ THE DOSSIER TAKES 50 OF EACH, SO A LENGTH IS A PAGE AND NOT A TOTAL.
  // Printing "50" on a listing carrying two hundred questions is a number the
  // Desk invented; "50+" is the honest reading of what actually arrived. The
  // reported tally is counted off the same page, so it is a floor too.
  const PAGE = 50;
  const questions = dossier.questions.length;
  const atCap = questions >= PAGE;
  const questionCount = atCap ? `${PAGE}+` : String(questions);
  const reported = dossier.questions.filter((q) => q.reportedCount > 0).length;

  return (
    <Section label="History" last={last}>
      <Timeline steps={steps} />
      <div style={{ marginTop: 4 }}>
        <Kv
          k="Interest"
          v={`${l._count.offers} offers · ${l._count.bids} bids · ${l._count.watchers} watching`}
          mono={false}
        />
        <Kv
          k="Questions"
          v={
            reported > 0
              ? `${questionCount} · ${reported}${atCap ? '+' : ''} reported`
              : questionCount
          }
          tone={reported > 0 ? 'warn' : undefined}
          last
        />
      </div>
    </Section>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * The approve confirm
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * ⚠️ THE CONFIRM RESTATES WHAT GOES LIVE, NOT "ARE YOU SURE". The party, the
 * item and what publishing it means — the same discipline the money confirm
 * uses, for the same reason: the last thing under the cursor should be
 * readable as a description of what is about to happen.
 */
function ApproveConfirm({
  listing,
  flags,
  licenceLabel,
  onCancel,
  onConfirm,
}: {
  listing: DossierListing;
  flags: RegulatedFlag[];
  licenceLabel: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const rows: { k: string; v: React.ReactNode }[] = [
    { k: 'Listing', v: listing.referenceNumber ?? listing.title },
    { k: 'Seller', v: listing.seller.username ?? '—' },
    { k: 'Category', v: listing.category.name },
    { k: 'Price', v: listing.price === null ? '—' : formatRand(listing.price) },
    {
      k: 'Goes live',
      v: listing.publicVisible ? 'Public — anyone can see it' : 'Members only — signed-in buyers',
    },
    { k: 'Seller is emailed', v: 'Yes — approval notice' },
  ];
  if (licenceLabel) rows.push({ k: 'Licence', v: licenceLabel });

  return (
    <DialogFrame
      label="Approve · confirm"
      title={
        listing.isFirearm ? <>Publish a licence-controlled listing?</> : <>Publish this listing?</>
      }
      onClose={onCancel}
      assertive
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          {/* The confirm hands off to the drawer's own Approve button, which
              carries the spinner — this dialog is gone by then. */}
          <Button variant="primary" onClick={onConfirm}>
            Approve
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.map((r, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 12,
              padding: '7px 0',
              borderBottom: '1px solid var(--dk-line)',
              fontSize: 12.5,
            }}
          >
            <span style={{ color: 'var(--dk-ink-3)' }}>{r.k}</span>
            <span style={{ flex: 1 }} />
            <span style={{ color: 'var(--dk-ink)', textAlign: 'right' }}>{r.v}</span>
          </div>
        ))}
      </div>
      {flags.length > 0 ? (
        <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--dk-warn)' }}>
          {flags.map((f) => f.label).join(' · ')}
        </span>
      ) : null}
    </DialogFrame>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Small parts
 * ──────────────────────────────────────────────────────────────────────── */

function HeaderMeta({ listing }: { listing: DossierListing }) {
  return (
    <>
      {listing.seller.username ?? 'unknown seller'} · {listing.category.name}
      {listing.price !== null ? ` · ${formatRand(listing.price)}` : ''}
      {listing.status === 'PENDING_REVIEW' ? ` · waiting ${waitedFor(listing.createdAt)}` : ''}
    </>
  );
}

function FooterNote({
  listing,
  reviewable,
  removable,
}: {
  listing: DossierListing;
  reviewable: boolean;
  removable: boolean;
}) {
  if (reviewable && listing.isFirearm) {
    return (
      <>
        This is a firearm. Approving publishes a licence-controlled item — dealer transfer is
        compulsory. Either decision emails the seller; a rejection sends the reason you tick.
      </>
    );
  }
  if (reviewable) {
    return <>The seller is emailed either way. A rejection sends the reason you tick.</>;
  }
  if (removable) {
    return (
      <>
        Taking this down emails the seller your reason and pulls it out of search immediately.
        Buyers who saved it will find it gone.
      </>
    );
  }
  return <>{noDecisionReason(listing.status)}</>;
}

function Prose({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: 13,
        lineHeight: 1.55,
        color: muted ? 'var(--dk-ink-3)' : 'var(--dk-ink-2)',
        whiteSpace: 'pre-wrap',
      }}
    >
      {children}
    </p>
  );
}

function LoadingBody() {
  return (
    <div
      role="status"
      aria-label="Loading the listing"
      style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 20 }}
    >
      {[220, 96, 140, 96].map((h, i) => (
        <span
          key={i}
          aria-hidden="true"
          style={{
            display: 'block',
            height: h,
            borderRadius: 'var(--dk-radius-card)',
            background: 'var(--dk-inset)',
            animation: 'dk-skeleton 1.4s ease-in-out infinite',
          }}
        />
      ))}
    </div>
  );
}

/**
 * The server's own words on a failed decision.
 *
 * describeFailure is not reused here: it prefixes every line with "GET",
 * which is true of the region loaders it was written for and false of a
 * review POST. A confused verb on an error the operator forwards to support
 * costs more than the six lines.
 */
function describeActionFailure(err: unknown): string {
  if (err instanceof DeskFetchError) {
    return `POST ${err.path}\n${err.message}${err.body ? `\n\n${err.body}` : ''}`;
  }
  return err instanceof Error ? err.message : String(err);
}
