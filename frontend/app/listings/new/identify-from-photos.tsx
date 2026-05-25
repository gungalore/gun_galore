'use client';

// Ask GG "Help me describe this" button for /listings/new.
//
// Phase B Sprint 2. Reads the photos already in the seller's
// dropzone, sends them to POST /api/ask-gg/identify-listing, and
// renders the structured proposal as a preview card with an "Apply
// to form" button that updates the listing's title / description /
// condition / category. Never writes form state directly — pure
// callback shape so the parent page stays the source of truth.
//
// Tier gates handled here:
//   - signed-out → button hidden (page already redirects via Clerk)
//   - FREE with photo quota remaining → button + cost note ("uses 1
//     of N free photo IDs this month")
//   - FREE with photo quota exhausted → button replaced by upgrade nudge
//   - MEMBER + PRO → button + small cost-info ("AI identification")
//
// Quota is fetched lazily on first interaction so we don't slow the
// listings page mount.

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface Category {
  id: string;
  name: string;
  slug: string;
  parentId?: string | null;
}

export interface IdentifyProposal {
  title: string;
  description: string;
  manufacturer: string | null;
  model: string | null;
  calibre: string | null;
  condition: 'NEW' | 'LIKE_NEW' | 'GOOD' | 'FAIR' | 'POOR' | null;
  suggestedCategorySlug: string | null;
  notes: string | null;
  confidence: 'high' | 'medium' | 'low';
}

interface Props {
  files: File[];
  currentCategoryId: string;
  categories: Category[];
  /** Called when the seller clicks "Apply to form". The parent
   *  page should patch the listing form state from this object. */
  onApply: (patch: {
    title?: string;
    description?: string;
    condition?: 'NEW' | 'LIKE_NEW' | 'GOOD' | 'FAIR' | 'POOR';
    categoryId?: string;
  }) => void;
  /** Called after the seller resolves the proposal (either by
   *  applying it or hitting Continue without applying). Parent
   *  collapses Step 1 / opens Step 2 so the seller doesn't have
   *  to click the next accordion header manually. */
  onAdvance?: () => void;
}

export default function IdentifyFromPhotos({
  files,
  currentCategoryId,
  categories,
  onApply,
  onAdvance,
}: Props) {
  const { getToken } = useAuth();
  const [identifying, setIdentifying] = useState(false);
  const [proposal, setProposal] = useState<IdentifyProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** When the FREE photo quota is exhausted, the backend returns 403
   *  with a structured body. We render an upgrade nudge instead of
   *  the proposal card. */
  const [quotaExhausted, setQuotaExhausted] = useState(false);

  async function handleIdentify() {
    setError(null);
    setProposal(null);
    setQuotaExhausted(false);

    if (files.length === 0) {
      setError('Add at least one photo first.');
      return;
    }

    setIdentifying(true);
    try {
      const token = await getToken();
      if (!token) {
        setError('Sign in first.');
        return;
      }

      // Use the currently-selected category as the hint, if any.
      const hintCategory = categories.find((c) => c.id === currentCategoryId);
      const fd = new FormData();
      for (const f of files) fd.append('files', f);

      const params = new URLSearchParams();
      if (hintCategory?.slug) params.set('categoryHint', hintCategory.slug);
      const url = `${API_URL}/ask-gg/identify-listing${
        params.toString() ? `?${params.toString()}` : ''
      }`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });

      if (r.status === 403) {
        // Nest wraps ForbiddenException bodies in `{ message: {...} }`
        // when the exception's cause is an object — that's our shape.
        // For string causes it's just `{ message: '...' }`. Handle both.
        const body = (await r.json().catch(() => null)) as
          | { message?: string | { code?: string; message?: string } }
          | null;
        const messageField = body?.message;
        const inner =
          messageField && typeof messageField === 'object'
            ? messageField
            : { message: typeof messageField === 'string' ? messageField : undefined };
        if (inner.code === 'free-photo-quota-exhausted') {
          setQuotaExhausted(true);
        } else {
          setError(inner.message ?? 'Access denied.');
        }
        return;
      }

      if (r.status === 429) {
        setError(
          "You're hitting the fair-use rate cap. Wait a minute and try again.",
        );
        return;
      }

      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as {
          message?: string;
        } | null;
        setError(body?.message ?? `Identification failed (${r.status}).`);
        return;
      }

      const data = (await r.json()) as {
        proposal: IdentifyProposal | null;
      };
      if (!data.proposal) {
        setError(
          "I couldn't read those photos as a firearm or related item. Try clearer shots, or fill in the form manually.",
        );
        return;
      }
      setProposal(data.proposal);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setIdentifying(false);
    }
  }

  function applyProposal() {
    if (!proposal) return;
    const matchingCategory = proposal.suggestedCategorySlug
      ? categories.find((c) => c.slug === proposal.suggestedCategorySlug)
      : null;
    onApply({
      title: proposal.title || undefined,
      description: proposal.description || undefined,
      condition: proposal.condition ?? undefined,
      categoryId: matchingCategory?.id ?? undefined,
    });
    // Clear the proposal card and auto-advance to Step 2 (basics) so
    // the seller immediately sees the pre-filled fields without
    // scrolling or clicking another accordion header.
    setProposal(null);
    onAdvance?.();
  }

  function continueWithoutApplying() {
    // Operator chose not to use the AI proposal — just dismiss it and
    // move on to Step 2 so they can type their own answer.
    setProposal(null);
    onAdvance?.();
  }

  // ─── Render ──────────────────────────────────────────────────────

  if (quotaExhausted) {
    return (
      <div
        style={{
          marginTop: 12,
          padding: '12px 14px',
          background: 'rgba(200,16,46,0.08)',
          border: '0.5px solid rgba(200,16,46,0.35)',
          borderRadius: 10,
          fontSize: 13,
          color: 'var(--text-primary)',
          lineHeight: 1.4,
        }}
      >
        You&rsquo;ve used your 5 free photo identifications this month.
        Upgrade to Member or Pro for unlimited photo IDs from the Ask GG tab.
        <br />
        <span
          style={{
            display: 'inline-block',
            marginTop: 8,
            padding: '6px 12px',
            background: 'var(--bg-inset)',
            color: 'var(--text-secondary)',
            border: '0.5px solid var(--border-hover)',
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          Subscription launching soon
        </span>
      </div>
    );
  }

  // Pre-photo state: don't render the helper at all. The Photo
  // Dropzone is the only thing the seller should see on a fresh form.
  if (files.length === 0 && !proposal) {
    return null;
  }

  return (
    <div style={{ marginTop: 12 }}>
      {/* AI identification button — only appears once at least one
          photo is staged. While the seller already has a proposal on
          screen, hide the button to keep the panel focused; they can
          dismiss the proposal to re-run if needed. */}
      {!proposal && (
        <>
          <button
            type="button"
            onClick={() => void handleIdentify()}
            disabled={identifying}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '9px 16px',
              background: identifying ? 'var(--bg-inset)' : 'var(--bg-card)',
              color: identifying ? 'var(--text-tertiary)' : 'var(--text-primary)',
              border: '0.5px solid var(--border)',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              cursor: identifying ? 'wait' : 'pointer',
              fontFamily: 'inherit',
            }}
            title="Ask GG identifies the item from your photos"
          >
            <SparklesIcon />
            {identifying
              ? 'Reading your photos…'
              : 'Help me describe this from the photos'}
          </button>
          <p
            style={{
              margin: '6px 0 0',
              fontSize: 11,
              color: 'var(--text-tertiary)',
              lineHeight: 1.4,
            }}
          >
            Ask GG reads your photos and proposes a title, description,
            condition and category. Nothing is filled in until you press
            &ldquo;Fill form&rdquo; on the proposal.
          </p>
        </>
      )}

      {error && (
        <p
          role="alert"
          style={{
            marginTop: 10,
            padding: '8px 10px',
            fontSize: 12,
            color: 'var(--red)',
            background: 'rgba(200,16,46,0.10)',
            border: '0.5px solid var(--red)',
            borderRadius: 6,
          }}
        >
          {error}
        </p>
      )}

      {proposal && (
        <ProposalCard
          proposal={proposal}
          categoryLabel={resolveCategoryLabel(
            proposal.suggestedCategorySlug,
            categories,
          )}
          onApply={applyProposal}
          onContinue={continueWithoutApplying}
        />
      )}
    </div>
  );
}

/** Resolve a category slug to a human-readable label, including the
 *  parent path if the matched category is a sub-category. e.g.
 *  "rifles-bolt-action" → "Rifles → Bolt action". Returns the raw
 *  slug if no category matches (defensive — Claude might return a
 *  slug we don't know about). */
function resolveCategoryLabel(
  slug: string | null,
  categories: Category[],
): string | null {
  if (!slug) return null;
  const cat = categories.find((c) => c.slug === slug);
  if (!cat) return slug;
  if (cat.parentId) {
    const parent = categories.find((c) => c.id === cat.parentId);
    if (parent) return `${parent.name} → ${cat.name}`;
  }
  return cat.name;
}

function ProposalCard({
  proposal,
  categoryLabel,
  onApply,
  onContinue,
}: {
  proposal: IdentifyProposal;
  categoryLabel: string | null;
  onApply: () => void;
  onContinue: () => void;
}) {
  const confidenceColour =
    proposal.confidence === 'high'
      ? '#7eb45c'
      : proposal.confidence === 'medium'
        ? '#c9a050'
        : 'var(--text-tertiary)';

  return (
    <div
      style={{
        marginTop: 12,
        padding: 14,
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: 10,
        fontSize: 13,
        color: 'var(--text-primary)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 10,
          gap: 8,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          Ask GG&rsquo;s proposal
        </h3>
        <span
          style={{
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
            color: confidenceColour,
            fontWeight: 600,
          }}
        >
          {proposal.confidence} confidence
        </span>
      </div>

      <Row label="Title" value={proposal.title || '—'} />
      {(proposal.manufacturer || proposal.model || proposal.calibre) && (
        <Row
          label="Identified"
          value={
            [proposal.manufacturer, proposal.model, proposal.calibre]
              .filter(Boolean)
              .join(' · ') || '—'
          }
        />
      )}
      {categoryLabel && <Row label="Category" value={categoryLabel} />}
      {proposal.condition && <Row label="Condition" value={proposal.condition} />}
      {proposal.description && (
        <Row label="Description" value={proposal.description} multiline />
      )}
      {proposal.notes && <Row label="Notes" value={proposal.notes} multiline />}

      <div
        style={{
          display: 'flex',
          gap: 8,
          marginTop: 12,
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={onApply}
          style={{
            padding: '9px 18px',
            background: 'var(--red)',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Fill form
        </button>
        <button
          type="button"
          onClick={onContinue}
          style={{
            padding: '9px 14px',
            background: 'var(--bg-inset)',
            color: 'var(--text-secondary)',
            border: '0.5px solid var(--border)',
            borderRadius: 8,
            fontSize: 13,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: multiline ? 'column' : 'row',
        gap: multiline ? 2 : 8,
        marginBottom: 6,
      }}
    >
      <span
        style={{
          fontSize: 10.5,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          color: 'var(--text-tertiary)',
          minWidth: 90,
          paddingTop: multiline ? 0 : 1,
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: 'var(--text-primary)',
          whiteSpace: multiline ? 'pre-wrap' : 'normal',
          flex: 1,
          lineHeight: 1.45,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function SparklesIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 4 L13.6 9.4 L19 11 L13.6 12.6 L12 18 L10.4 12.6 L5 11 L10.4 9.4 Z" />
      <path d="M18.5 4 L19 5.5 L20.5 6 L19 6.5 L18.5 8 L18 6.5 L16.5 6 L18 5.5 Z" />
    </svg>
  );
}
