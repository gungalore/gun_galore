'use client';

// Phase E1 — Ask Boet subscription badges rendered next to a username
// on every public surface (listing card, listing-detail seller chip,
// /sellers/[clerkId] profile, Q&A answers).
//
// Two independent badges:
//   - GG+ pill — MEMBER or PRO subscription (OD1 locked). MEMBER
//     gets a subdued pill; PRO gets a brighter accent.
//   - Verified Expert checkmark — user has been awarded the badge
//     by admin after 5+ verified KB contributions (OD2 locked).
//
// Both are visual-only; no click target. Pair with a parent <span>
// that already handles spacing. Designed to look right inline next
// to a username so it can sit in tight card layouts without
// breaking the visual rhythm.

import { HelpTip } from './help-tip';
import type { SubscriptionTier } from '@/lib/types';

interface UserBadgesProps {
  subscriptionTier?: SubscriptionTier | null;
  isVerifiedExpert?: boolean;
  expertBadgeReason?: string | null;
  // Identity-verified (KYC passed). A boolean trust tick — never any PII.
  idVerified?: boolean;
  // Pinch sizes for tight layouts (browse-card vs profile-header).
  size?: 'sm' | 'md';
}

export function UserBadges({
  subscriptionTier,
  isVerifiedExpert,
  expertBadgeReason,
  idVerified,
  size = 'sm',
}: UserBadgesProps) {
  const hasGgPlus = subscriptionTier === 'MEMBER' || subscriptionTier === 'PRO';
  const hasExpert = !!isVerifiedExpert;
  const hasIdVerified = !!idVerified;
  if (!hasGgPlus && !hasExpert && !hasIdVerified) return null;

  const dim = size === 'md'
    ? { px: '6px', py: '1px', fontSize: '11px', gap: '4px' }
    : { px: '4px', py: '0px', fontSize: '10px', gap: '3px' };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: dim.gap,
        marginLeft: '6px',
        verticalAlign: 'middle',
      }}
    >
      {hasIdVerified && <IdVerifiedBadge dim={dim} />}
      {hasGgPlus && <GgPlusPill tier={subscriptionTier!} dim={dim} />}
      {hasExpert && <ExpertBadge dim={dim} reason={expertBadgeReason ?? null} />}
    </span>
  );
}

function IdVerifiedBadge({
  dim,
}: {
  dim: { px: string; py: string; fontSize: string; gap: string };
}) {
  // Blue "ID verified" tick — the seller passed All Outdoor's identity
  // (KYC) check. Blue distinguishes it from the green Expert badge and
  // the red GG+ pill. Boolean trust signal only; no name or ID shown.
  return (
    <span
      title="Identity verified — this seller passed All Outdoor's KYC identity check"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px',
        padding: `${dim.py} ${dim.px}`,
        fontSize: dim.fontSize,
        fontWeight: 600,
        letterSpacing: '0.02em',
        borderRadius: '3px',
        lineHeight: 1.2,
        color: '#3b82f6',
        background: 'rgba(59,130,246,0.08)',
        border: '0.5px solid rgba(59,130,246,0.40)',
      }}
    >
      ✓ ID
    </span>
  );
}

function GgPlusPill({
  tier,
  dim,
}: {
  tier: 'MEMBER' | 'PRO';
  dim: { px: string; py: string; fontSize: string; gap: string };
}) {
  // PRO uses the brand red at higher contrast; MEMBER stays
  // subdued to leave headroom for PRO to feel like an upgrade.
  // Both keep the same "GG+" wordmark — the spec calls it "GG
  // Plus pill" generically; tier-aware shading is a tasteful
  // upgrade cue without screaming about it.
  const isPro = tier === 'PRO';
  // Rebrand 2026-07-19: the single paid tier is GG PRO. Legacy MEMBER rows
  // keep the old GG+ pill until they lapse.
  const label = isPro ? 'GG PRO' : 'GG+';
  return (
    <span
      title={
        isPro
          ? 'Ask Boet Pro — full ballistic + reloading assistant + Pro perks'
          : 'Ask Boet Plus — fuller assistant + member perks'
      }
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: `${dim.py} ${dim.px}`,
        fontSize: dim.fontSize,
        fontWeight: 600,
        letterSpacing: '0.02em',
        borderRadius: '3px',
        lineHeight: 1.2,
        color: isPro ? '#fff' : 'var(--red)',
        background: isPro ? 'var(--red)' : 'rgba(200,16,46,0.10)',
        border: `0.5px solid ${isPro ? 'var(--red)' : 'rgba(200,16,46,0.40)'}`,
      }}
    >
      {label}
    </span>
  );
}

function ExpertBadge({
  dim,
  reason,
}: {
  dim: { px: string; py: string; fontSize: string; gap: string };
  reason: string | null;
}) {
  // Compact green checkmark + EXPERT wordmark. Green chosen for
  // "trust" feel; distinct from red so it doesn't compete with
  // the GG+ pill. Tooltip surfaces the admin's public rationale
  // when present.
  return (
    <span
      title={
        reason
          ? `Verified Expert — ${reason}`
          : 'Verified Expert — recognised contributor on All Outdoor'
      }
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px',
        padding: `${dim.py} ${dim.px}`,
        fontSize: dim.fontSize,
        fontWeight: 600,
        letterSpacing: '0.02em',
        borderRadius: '3px',
        lineHeight: 1.2,
        color: '#22c55e',
        background: 'rgba(34,197,94,0.08)',
        border: '0.5px solid rgba(34,197,94,0.40)',
      }}
    >
      ✓ EXPERT
    </span>
  );
}

/**
 * Larger version with HelpTip explainer — used on the seller profile
 * header where the user is hovering on the badge in a calm context
 * and we have room for a real tooltip.
 */
export function UserBadgesWithTooltip({
  subscriptionTier,
  isVerifiedExpert,
  expertBadgeReason,
  idVerified,
}: UserBadgesProps) {
  const hasGgPlus = subscriptionTier === 'MEMBER' || subscriptionTier === 'PRO';
  const hasExpert = !!isVerifiedExpert;
  const hasIdVerified = !!idVerified;
  if (!hasGgPlus && !hasExpert && !hasIdVerified) return null;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
      <UserBadges
        subscriptionTier={subscriptionTier}
        isVerifiedExpert={isVerifiedExpert}
        expertBadgeReason={expertBadgeReason}
        idVerified={idVerified}
        size="md"
      />
      {hasExpert && (
        <HelpTip title="Verified Expert" side="bottom">
          Awarded by All Outdoor staff after this seller has contributed
          5+ verified entries to the Ask Boet knowledge base. Their answers
          on listings + Q&A carry extra weight.
          {expertBadgeReason ? (
            <>
              <br />
              <br />
              <em>Rationale:</em> {expertBadgeReason}
            </>
          ) : null}
        </HelpTip>
      )}
    </span>
  );
}
