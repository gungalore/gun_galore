import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { ActionTokenError } from './error-screen';
import { OfferDecisionPage, type OfferDecisionPayload } from './offer-decision';
import { AuctionBidPage, type AuctionBidPayload } from './auction-bid';
import {
  TransactionAcceptPage,
  type TransactionAcceptPayload,
} from './transaction-accept';
import { SwapDecisionPage, type SwapDecisionPayload } from './swap-decision';
import { RunnerUpPage, type RunnerUpPayload } from './runner-up';

/**
 * Universal SMS-link landing page. URL pattern: `/a/<token>`.
 *
 * Server-side resolves the token via the public /api/actions/:token
 * endpoint, then either:
 *   - Renders the appropriate UI for the token's purpose
 *     (OFFER_DECISION / COUNTER_DECISION / AUCTION_BID), OR
 *   - 302-redirects to /checkout/[listingId]?t=<token> for CHECKOUT
 *     tokens (the existing checkout form does the work)
 *
 * Mobile-only design — every UI block here is single-column, max
 * width ~480px, large tap targets. No desktop responsive design.
 *
 * Friendly error UI for the expected failure modes:
 *   - 404 Not Found      → "Link not recognised"
 *   - 410 Gone (expired) → "Link expired"
 *   - 410 Gone (used)    → "Link already used"
 *   - 403 Forbidden      → "Link locked"
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type ResolvedPayload =
  | OfferDecisionPayload
  | AuctionBidPayload
  | CheckoutPayload
  | KycVerifyPayload
  | TransactionAcceptPayload
  | SwapDecisionPayload
  | RunnerUpPayload;

interface CheckoutPayload {
  kind: 'CHECKOUT';
  expiresAt: string;
  greeting: string;
  listing: {
    id: string;
    title: string;
    listPrice: number | null;
    reference: string | null;
    primaryImageUrl: string | null;
    status: string;
  };
  redirectTo: string;
}

// KYC_VERIFY carries no entity — just a redirect to /kyc/verify?t=<token>
// where the seller completes VerifyNow without signing in.
interface KycVerifyPayload {
  kind: 'KYC_VERIFY';
  expiresAt: string;
  greeting: string;
  redirectTo: string;
}

export default async function ActionTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Server-side fetch + catch the friendly-error responses from the
  // backend (404 / 410 / 403). On any other failure we show a generic
  // error screen rather than letting Next render a stack trace.
  let payload: ResolvedPayload | null = null;
  let errorState:
    | { status: number; message: string }
    | null = null;
  try {
    payload = await apiFetch<ResolvedPayload>(`/actions/${token}`, {
      cache: 'no-store',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    // apiFetch throws "API <status>: <body>" — pluck out the status if
    // present so the error screen can pick the right copy.
    const m = message.match(/^API (\d+):/);
    const status = m ? Number(m[1]) : 0;
    errorState = { status, message };
  }

  if (errorState || !payload) {
    return (
      <MobileShell>
        <ActionTokenError status={errorState?.status ?? 0} />
      </MobileShell>
    );
  }

  // CHECKOUT + KYC_VERIFY tokens punt to an existing page via redirect.
  // Keeps the SMS URL short (always /a/<token>) while reusing the
  // checkout form / KYC verify page we already have. The ?t=<token>
  // carried on the redirect authorises those pages' API calls.
  if (payload.kind === 'CHECKOUT' || payload.kind === 'KYC_VERIFY') {
    redirect(payload.redirectTo);
  }

  return (
    <MobileShell>
      {payload.kind === 'OFFER_DECISION' ||
      payload.kind === 'COUNTER_DECISION' ? (
        <OfferDecisionPage token={token} payload={payload} />
      ) : payload.kind === 'AUCTION_BID' ? (
        <AuctionBidPage token={token} payload={payload} />
      ) : payload.kind === 'TRANSACTION_ACCEPT' ? (
        <TransactionAcceptPage token={token} payload={payload} />
      ) : payload.kind === 'SWAP_PROPOSAL_DECISION' ||
        payload.kind === 'SWAP_COUNTER_DECISION' ? (
        <SwapDecisionPage token={token} payload={payload} />
      ) : payload.kind === 'AUCTION_RUNNER_UP' ? (
        <RunnerUpPage token={token} payload={payload} />
      ) : (
        <ActionTokenError status={500} />
      )}
    </MobileShell>
  );
}

/**
 * Mobile-only chrome — single column, centered, max ~480px wide.
 * The logo bar at the top serves as the visual anchor + reassurance
 * ("yes you're really on Gun Galore"). No nav, no footer beyond the
 * fine print, no Clerk wrapper, no PWA install prompt — just the
 * action page.
 */
function MobileShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg-page)',
        padding: '20px 16px 32px',
      }}
    >
      <div
        style={{
          maxWidth: 480,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <LogoHeader />
        {children}
        <PageFootnote />
      </div>
    </div>
  );
}

function LogoHeader() {
  return (
    <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-mark.svg"
        alt="Gun Galore"
        style={{ width: 56, height: 56, display: 'inline-block' }}
      />
    </div>
  );
}

function PageFootnote() {
  return (
    <p
      style={{
        fontSize: 11,
        color: 'var(--text-tertiary)',
        textAlign: 'center',
        lineHeight: 1.6,
        marginTop: 12,
      }}
    >
      This is a single-use link from Gun Galore. It expires after use
      and does not sign you into your account.
      <br />
      Need full account access?{' '}
      <a href="/sign-in" style={{ color: 'var(--text-secondary)', textDecoration: 'underline' }}>
        Sign in →
      </a>
    </p>
  );
}
