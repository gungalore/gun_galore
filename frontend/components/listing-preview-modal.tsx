'use client';

import { useEffect, useRef } from 'react';
import type { Condition, Province, ListingType, Category } from '@/lib/types';
import { CONDITION_LABELS, PROVINCE_LABELS } from '@/lib/utils';
import { SUPPORT_EMAIL } from '@/lib/brand';
import { modalIn } from '@/lib/anim';
import { gsap } from 'gsap';

// Result shape returned by POST /listings/preview. Keep in sync with
// backend/src/listings/listings.service.ts → PreviewResult.
export interface PreviewResult {
  decision: 'APPROVE' | 'AUTO_FIX_AND_APPROVE' | 'REJECT' | 'HUMAN_REVIEW';
  confidence: number;
  reasons: string[];
  reasonCategories: { reason: string; category: string }[];
  publicReason?: string;
  cleanedDescription?: string;
  attemptHash: string;
  isRepeatOffense: boolean;
  canPublish: boolean;
  hardBlocked: boolean;
}

// Mirror of the form snapshot we pass into the modal. Lets us render a
// "this is roughly what your listing will look like" view without making
// the modal know about the form's internals.
export interface PreviewSnapshot {
  title: string;
  description: string;
  price: string; // human-typed rands, e.g. "1495"
  listingType: ListingType;
  condition: Condition;
  province: Province;
  make: string;
  model: string;
  calibre: string;
  category: Category | undefined;
  imageBlobs: string[]; // object URLs created from the seller's File[]
}

interface Props {
  preview: PreviewResult;
  snapshot: PreviewSnapshot;
  publishing: boolean;
  publishError: string | null;
  onEdit: () => void;
  onPublish: (useCleanedDescription: boolean) => void;
}

const SIN_LABELS: Record<string, { label: string; tone: 'red' | 'amber' | 'grey' }> = {
  'live-ammo': { label: 'Live ammunition', tone: 'red' },
  'contact-info': { label: 'Contact info in description', tone: 'amber' },
  'photo-contact-info': { label: 'Contact info in photo', tone: 'red' },
  'qr-code': { label: 'QR code in photo', tone: 'red' },
  'photo-address': { label: 'Address / signage in photo', tone: 'red' },
  'prohibited-content': { label: 'Prohibited content', tone: 'red' },
  'fake-photo': { label: 'Stock or stolen photo', tone: 'red' },
  'no-photo': { label: 'Missing photo', tone: 'red' },
  'wrong-category': { label: 'Category mismatch', tone: 'amber' },
  'high-value': { label: 'High value', tone: 'amber' },
  'low-confidence': { label: 'Needs admin check', tone: 'amber' },
  'new-seller': { label: 'New seller', tone: 'amber' },
  other: { label: 'Issue', tone: 'grey' },
};

export function ListingPreviewModal({
  preview,
  snapshot,
  publishing,
  publishError,
  onEdit,
  onPublish,
}: Props) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const issuesRef = useRef<HTMLUListElement | null>(null);
  const chipsRef = useRef<HTMLDivElement | null>(null);

  // Esc closes back to the form (no-op when publishing).
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !publishing) onEdit();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onEdit, publishing]);

  // Lock body scroll while the modal is open.
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  // Entrance animation — fade overlay + scale-and-rise panel, then
  // stagger the issue chips and reasons list. Runs once on mount.
  useEffect(() => {
    const panel = panelRef.current;
    const overlay = overlayRef.current;
    if (!panel || !overlay) return;
    const tl = modalIn(panel, overlay);
    if (chipsRef.current) {
      tl.fromTo(
        chipsRef.current.querySelectorAll('span'),
        { autoAlpha: 0, scale: 0.7 },
        {
          autoAlpha: 1,
          scale: 1,
          stagger: 0.045,
          duration: 0.34,
          ease: 'back.out(1.6)',
        },
        '-=0.18',
      );
    }
    if (issuesRef.current) {
      tl.fromTo(
        issuesRef.current.querySelectorAll('li'),
        { autoAlpha: 0, x: -8 },
        { autoAlpha: 1, x: 0, stagger: 0.04, duration: 0.28 },
        '-=0.2',
      );
    }
    return () => {
      tl.kill();
    };
    // We want the animation on first paint, not on every prop change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Animated close — fade out, then call onEdit. Skip if publishing.
  function animatedClose() {
    if (publishing) return;
    const panel = panelRef.current;
    const overlay = overlayRef.current;
    if (!panel || !overlay) {
      onEdit();
      return;
    }
    gsap
      .timeline({ onComplete: onEdit })
      .to(panel, {
        autoAlpha: 0,
        scale: 0.96,
        y: 12,
        duration: 0.2,
        ease: 'power2.in',
      })
      .to(overlay, { autoAlpha: 0, duration: 0.18, ease: 'power1.in' }, '-=0.12');
  }

  const greyed = preview.decision === 'REJECT';
  const priceCents = Math.round((parseFloat(snapshot.price) || 0) * 100);
  const priceLabel =
    snapshot.listingType === 'TAKE_A_SHOT'
      ? 'Take a Shot'
      : priceCents > 0
        ? `R${(priceCents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 0 })}`
          : '—';

  // The header colour reflects the verdict.
  const verdictColor =
    preview.decision === 'APPROVE'
      ? '#22c55e'
      : preview.decision === 'AUTO_FIX_AND_APPROVE'
        ? '#22c55e'
        : preview.decision === 'HUMAN_REVIEW'
          ? '#f59e0b'
          : 'var(--red)';

  const verdictTitle =
    preview.decision === 'APPROVE'
      ? 'Looks good — ready to publish'
      : preview.decision === 'AUTO_FIX_AND_APPROVE'
        ? 'Cleaned up — review and publish'
        : preview.decision === 'HUMAN_REVIEW'
          ? 'Will go to admin review'
          : preview.hardBlocked
            ? 'Blocked — same issues twice'
            : 'Issues found — please fix';

  const verdictBlurb =
    preview.decision === 'APPROVE'
      ? 'Your listing passed our checks — looks ready to publish.'
      : preview.decision === 'AUTO_FIX_AND_APPROVE'
        ? 'We removed some contact info from your description. Review the cleaned version below.'
        : preview.decision === 'HUMAN_REVIEW'
          ? 'Your listing will be visible to buyers after an admin double-checks it. Usually under an hour.'
          : preview.hardBlocked
            ? `We can’t auto-publish this. Email ${SUPPORT_EMAIL} if you believe this is a mistake.`
            : (preview.publicReason ??
              'Fix the issues below and try again — most of the time this is one quick edit.');

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal
      aria-label="Listing preview"
      // data-blocking-overlay stands the Ask Boet dock down for this modal's
      // lifetime (rule in ask-gg-launcher.tsx). Boet is z-60 too and, being the
      // last thing in <body>, wins the tie on DOM order — he'd otherwise land on
      // the bottom-right action bar and cover "Publish listing", which is the
      // only publish path there is. Any new full-screen overlay needs this attr.
      data-blocking-overlay="true"
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      style={{ background: 'rgba(0,0,0,0.72)', opacity: 0 }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !publishing) animatedClose();
      }}
    >
      <div
        ref={panelRef}
        className="w-full max-w-[920px] rounded-[12px] overflow-hidden"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          opacity: 0,
        }}
      >
        {/* Verdict header */}
        <header
          className="px-6 py-5 flex items-start gap-4"
          style={{
            background: 'var(--bg-inset)',
            borderBottom: '0.5px solid var(--border)',
          }}
        >
          <span
            className="flex items-center justify-center shrink-0 rounded-full"
            style={{
              width: 36,
              height: 36,
              background: `color-mix(in srgb, ${verdictColor} 13%, transparent)`,
              border: `0.5px solid ${verdictColor}`,
              color: verdictColor,
              fontSize: 18,
              fontWeight: 500,
            }}
          >
            {preview.decision === 'APPROVE' || preview.decision === 'AUTO_FIX_AND_APPROVE'
              ? '✓'
              : preview.decision === 'HUMAN_REVIEW'
                ? '?'
                : preview.hardBlocked
                  ? '!'
                  : '!'}
          </span>
          <div className="flex-1 min-w-0">
            <p
              className="text-xs uppercase mb-1"
              style={{ color: verdictColor, letterSpacing: '0.12em', fontWeight: 500 }}
            >
              All Outdoor review · {Math.round(preview.confidence * 100)}% confident
            </p>
            <h2
              className="text-lg sm:text-xl"
              style={{
                color: 'var(--text-primary)',
                fontWeight: 500,
                letterSpacing: '-0.01em',
              }}
            >
              {verdictTitle}
            </h2>
            <p
              className="text-sm mt-1.5"
              style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}
            >
              {verdictBlurb}
            </p>
          </div>
          <button
            type="button"
            onClick={animatedClose}
            disabled={publishing}
            aria-label="Close"
            className="shrink-0 p-1 transition-opacity"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-tertiary)',
              cursor: publishing ? 'not-allowed' : 'pointer',
              fontSize: 22,
              lineHeight: 1,
              opacity: publishing ? 0.4 : 1,
            }}
          >
            ×
          </button>
        </header>

        {/* Issues panel — only when something needs attention */}
        {preview.reasonCategories.length > 0 && preview.decision !== 'APPROVE' && (
          <div
            className="px-6 py-4"
            style={{ borderBottom: '0.5px solid var(--border)' }}
          >
            <p
              className="text-xs uppercase mb-3"
              style={{
                color: 'var(--text-tertiary)',
                letterSpacing: '0.1em',
                fontWeight: 500,
              }}
            >
              What we noticed
            </p>
            <div ref={chipsRef} className="flex flex-wrap gap-2 mb-3">
              {Array.from(new Set(preview.reasonCategories.map((r) => r.category))).map(
                (cat) => {
                  const meta = SIN_LABELS[cat] ?? SIN_LABELS.other;
                  const tone =
                    meta.tone === 'red'
                      ? 'var(--red)'
                      : meta.tone === 'amber'
                        ? '#f59e0b'
                        : 'var(--text-tertiary)';
                  return (
                    <span
                      key={cat}
                      className="text-xs px-2.5 py-1 rounded-full"
                      style={{
                        background: `color-mix(in srgb, ${tone} 13%, transparent)`,
                        color: tone,
                        border: `0.5px solid ${tone}`,
                        fontWeight: 500,
                      }}
                    >
                      {meta.label}
                    </span>
                  );
                },
              )}
            </div>
            <ul
              ref={issuesRef}
              className="text-sm space-y-1.5"
              style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}
            >
              {preview.reasons.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <span style={{ color: 'var(--text-tertiary)' }}>•</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* AUTO_FIX diff — show original vs cleaned so the seller knows what changed */}
        {preview.decision === 'AUTO_FIX_AND_APPROVE' && preview.cleanedDescription && (
          <div
            className="px-6 py-4"
            style={{ borderBottom: '0.5px solid var(--border)' }}
          >
            <p
              className="text-xs uppercase mb-3"
              style={{
                color: 'var(--text-tertiary)',
                letterSpacing: '0.1em',
                fontWeight: 500,
              }}
            >
              Cleaned description (what will publish)
            </p>
            <div
              className="rounded-[6px] p-3 text-sm"
              style={{
                background: 'rgba(34,197,94,0.08)',
                border: '0.5px solid rgba(34,197,94,0.4)',
                color: 'var(--text-primary)',
                lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
              }}
            >
              {preview.cleanedDescription}
            </div>
          </div>
        )}

        {/* Listing preview — greyed out when REJECT so the seller sees what
            their public listing would look like, but the visual cue says
            "not approved" */}
        <div
          className="px-6 py-6"
          style={{
            opacity: greyed ? 0.45 : 1,
            filter: greyed ? 'grayscale(0.7)' : 'none',
            transition: 'opacity 200ms, filter 200ms',
            pointerEvents: greyed ? 'none' : 'auto',
          }}
        >
          <p
            className="text-xs uppercase mb-4"
            style={{
              color: 'var(--text-tertiary)',
              letterSpacing: '0.1em',
              fontWeight: 500,
            }}
          >
            {greyed ? 'Preview (blocked from publishing)' : 'Public preview'}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-[280px_minmax(0,1fr)] gap-5">
            {/* Hero photo + thumbs */}
            <div>
              {snapshot.imageBlobs.length > 0 ? (
                <>
                  <div
                    className="rounded-[8px] overflow-hidden mb-2"
                    style={{
                      aspectRatio: '4/3',
                      background: 'var(--bg-inset)',
                      backgroundImage: `url(${snapshot.imageBlobs[0]})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  />
                  {snapshot.imageBlobs.length > 1 && (
                    <div className="flex gap-1.5">
                      {snapshot.imageBlobs.slice(1).map((url, i) => (
                        <div
                          key={i}
                          className="rounded-[4px] flex-1"
                          style={{
                            aspectRatio: '1/1',
                            background: 'var(--bg-inset)',
                            backgroundImage: `url(${url})`,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                          }}
                        />
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div
                  className="rounded-[8px] flex items-center justify-center text-xs"
                  style={{
                    aspectRatio: '4/3',
                    background: 'var(--bg-inset)',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  No photo
                </div>
              )}
            </div>

            {/* Title / price / facts */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="text-xs uppercase"
                  style={{
                    color: 'var(--text-tertiary)',
                    letterSpacing: '0.12em',
                  }}
                >
                  {snapshot.category?.name ?? 'Uncategorised'}
                </span>
                <span style={{ color: 'var(--text-tertiary)' }}>·</span>
                <span
                  className="text-xs uppercase"
                  style={{
                    color: 'var(--text-tertiary)',
                    letterSpacing: '0.12em',
                  }}
                >
                  {snapshot.listingType === 'BUY_NOW'
                    ? 'Marketplace'
                    : snapshot.listingType === 'AUCTION'
                      ? 'Auction'
                      : 'Take a Shot'}
                </span>
              </div>
              <h3
                className="text-xl sm:text-2xl mb-2"
                style={{
                  color: 'var(--text-primary)',
                  fontWeight: 500,
                  letterSpacing: '-0.015em',
                }}
              >
                {snapshot.title || 'Untitled listing'}
              </h3>
              <p
                className="text-2xl mb-4"
                style={{
                  color: 'var(--red)',
                  fontWeight: 500,
                }}
              >
                {priceLabel}
              </p>
              <dl
                className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs mb-4"
                style={{ color: 'var(--text-secondary)' }}
              >
                <FactRow
                  label="Condition"
                  value={CONDITION_LABELS[snapshot.condition]}
                />
                <FactRow
                  label="Province"
                  value={PROVINCE_LABELS[snapshot.province]}
                />
                {snapshot.make && <FactRow label="Make" value={snapshot.make} />}
                {snapshot.model && <FactRow label="Model" value={snapshot.model} />}
                {snapshot.calibre && (
                  <FactRow label="Calibre" value={snapshot.calibre} />
                )}
              </dl>
              <p
                className="text-sm"
                style={{
                  color: 'var(--text-secondary)',
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {snapshot.description || 'No description'}
              </p>
            </div>
          </div>
        </div>

        {/* Publish error */}
        {publishError && (
          <div
            className="mx-6 mb-4 px-4 py-3 rounded-[6px] text-sm"
            style={{
              background: 'rgba(200,16,46,0.08)',
              border: '0.5px solid var(--red)',
              color: 'var(--red)',
            }}
          >
            {publishError}
          </div>
        )}

        {/* Action bar */}
        <footer
          className="px-6 py-4 flex flex-wrap gap-3 items-center justify-end"
          style={{
            background: 'var(--bg-inset)',
            borderTop: '0.5px solid var(--border)',
            // Clear the iOS home indicator: the modal now sits above the PWA
            // bottom tab bar (z-[60]), so this row can reach the viewport
            // bottom on a tall (firearm) preview — keep the buttons above it.
            paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))',
          }}
        >
          <button
            type="button"
            onClick={animatedClose}
            disabled={publishing}
            className="px-4 py-2.5 rounded-[6px] text-sm"
            style={{
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: '0.5px solid var(--border)',
              cursor: publishing ? 'not-allowed' : 'pointer',
              opacity: publishing ? 0.5 : 1,
            }}
          >
            {preview.canPublish ? 'Back to edit' : 'Edit listing'}
          </button>

          {preview.canPublish && (() => {
            // Defence in depth: the backend now @Min(1)s imageCount on
            // create, but we ALSO gate the button locally so the seller
            // never even reaches a request that would 400. Without
            // photos the listing has nothing to show buyers + the
            // preview's image moderation didn't even have a chance to
            // run. Failure mode prevented at source.
            const noPhotos = snapshot.imageBlobs.length === 0;
            const disabled = publishing || noPhotos;
            return (
              <button
                type="button"
                onClick={() =>
                  onPublish(preview.decision === 'AUTO_FIX_AND_APPROVE')
                }
                disabled={disabled}
                title={noPhotos ? 'Add at least one photo before publishing.' : undefined}
                className="px-5 py-2.5 rounded-[6px] text-sm transition-opacity"
                style={{
                  background: 'var(--red)',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 500,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.5 : 1,
                }}
              >
                {publishing
                  ? 'Publishing…'
                  : noPhotos
                    ? 'Add a photo to publish'
                    : preview.decision === 'HUMAN_REVIEW'
                      ? 'Submit for admin review'
                      : 'Publish listing'}
              </button>
            );
          })()}
        </footer>
      </div>
    </div>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt style={{ color: 'var(--text-tertiary)' }}>{label}</dt>
      <dd style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{value}</dd>
    </>
  );
}
