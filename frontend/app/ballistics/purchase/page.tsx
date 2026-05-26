// frontend/app/ballistics/purchase/page.tsx
//
// Lifetime-purchase flow for the Ballistic Calculator (R299 one-off).
// Three states the page handles:
//
//   1. ?status=processing&tx=<id>  — Peach has redirected the user
//      back. Show a "verifying payment" screen + poll /license until
//      it flips to purchased.
//   2. ?status=success             — webhook fired, license active.
//      Confirmation screen → "Open calculator".
//   3. (default)                    — pre-purchase landing. Plan
//      summary + "Start checkout" button which calls
//      POST /api/ballistics/purchase/checkout, gets the Peach widget
//      URL, and loads the embedded widget.
//
// Demo nuance: page is reachable without a Clerk session, but the
// "Start checkout" handler bounces to /sign-up?return=/ballistics/purchase
// when the API returns 401. Real auth happens on the API call, not
// the route.

'use client';

// Skip SSG — the page polls /license + reads ?status= search params and
// loads the Peach widget via next/script. All client-side concerns; no
// upside to pre-baking HTML, and the Peach Script import was a strong
// candidate for the SSG hang at ~52/70 routes on the first deploy.
export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import Script from 'next/script';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth, useUser } from '@clerk/nextjs';

interface CheckoutResponse {
  checkoutId: string;
  widgetScriptUrl: string;
  merchantTransactionId: string;
  amountCents: number;
}

const PRICE_RAND = 299;

function PurchasePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const status = searchParams.get('status');
  const { getToken, isLoaded: authLoaded, isSignedIn } = useAuth();
  useUser();

  const [licensed, setLicensed] = useState<boolean | null>(null);
  const [checkout, setCheckout] = useState<CheckoutResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // ── License state poll ───────────────────────────────────────
  useEffect(() => {
    let stop = false;
    let interval: number | null = null;

    const check = async () => {
      try {
        const token = await getToken().catch(() => null);
        const res = await fetch('/api/ballistics/license', {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const data = (await res.json()) as { purchased: boolean };
        if (!stop) setLicensed(data.purchased);
        if (data.purchased && interval) {
          window.clearInterval(interval);
          interval = null;
        }
      } catch {
        /* ignore */
      }
    };

    check();
    // Poll only when we just came back from Peach.
    if (status === 'processing') {
      interval = window.setInterval(check, 3500);
    }
    return () => {
      stop = true;
      if (interval) window.clearInterval(interval);
    };
  }, [getToken, status]);

  const startCheckout = useCallback(async () => {
    setError(null);
    setCreating(true);
    try {
      const token = await getToken().catch(() => null);
      if (!token) {
        router.push('/sign-up?return_url=/ballistics/purchase');
        return;
      }
      const res = await fetch('/api/ballistics/purchase/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `Checkout failed (${res.status})`);
      }
      const data = (await res.json()) as CheckoutResponse;
      setCheckout(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed.');
    } finally {
      setCreating(false);
    }
  }, [getToken, router]);

  // ── Already-licensed screen ──────────────────────────────────
  if (licensed === true && status !== 'processing') {
    return (
      <div className="bc-page">
        <header className="bc-topbar">
          <div className="bc-brand">
            <span className="bc-brand-dot" />
            GUN GALORE BC
          </div>
        </header>
        <main className="bc-page" style={{ paddingTop: 40 }}>
          <h1
            style={{
              fontFamily: 'var(--font-bc-mono)',
              fontSize: 24,
              color: 'var(--bc-text)',
              margin: 0,
            }}
          >
            License active ✓
          </h1>
          <p style={{ color: 'var(--bc-text-2)', margin: 0 }}>
            You own the lifetime Ballistic Calculator. Open it now.
          </p>
          <Link href="/ballistics" className="bc-tap primary">
            Open calculator
          </Link>
        </main>
      </div>
    );
  }

  // ── Processing-return-from-Peach screen ──────────────────────
  if (status === 'processing') {
    return (
      <div className="bc-page">
        <header className="bc-topbar">
          <div className="bc-brand">
            <span className="bc-brand-dot" />
            GUN GALORE BC
          </div>
        </header>
        <main className="bc-page" style={{ paddingTop: 40 }}>
          <h1
            style={{
              fontFamily: 'var(--font-bc-mono)',
              fontSize: 22,
              color: 'var(--bc-text)',
              margin: 0,
            }}
          >
            Verifying your payment…
          </h1>
          <p style={{ color: 'var(--bc-text-2)' }}>
            Hang tight — usually under 10 seconds. Once Peach confirms
            we'll unlock the calculator on every device you sign into.
          </p>
          <div
            style={{
              padding: 28,
              borderRadius: 'var(--bc-r-lg)',
              background: 'var(--bc-surface)',
              border: '1px solid var(--bc-line)',
              textAlign: 'center',
              fontFamily: 'var(--font-bc-mono)',
              color: 'var(--bc-text-dim)',
              fontSize: 14,
            }}
          >
            Polling /license · refreshing every 3.5s
          </div>
        </main>
      </div>
    );
  }

  // ── Pre-purchase landing ─────────────────────────────────────
  return (
    <div className="bc-page">
      <header className="bc-topbar">
        <div className="bc-brand">
          <span className="bc-brand-dot" />
          GUN GALORE BC
        </div>
        <Link
          href="/ballistics"
          className="bc-chip"
          style={{ textDecoration: 'none' }}
        >
          ← Back
        </Link>
      </header>

      <main className="bc-page">
        <h1
          style={{
            fontFamily: 'var(--font-bc-mono)',
            fontSize: 30,
            color: 'var(--bc-text)',
            margin: 0,
          }}
        >
          Lifetime — R{PRICE_RAND}
        </h1>
        <p
          style={{
            color: 'var(--bc-text-2)',
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          Pay once. Use forever. No subscription. The serious
          South-African long-range calculator with the AI bullet
          lookup nobody else has.
        </p>

        <section className="bc-card">
          <div className="bc-card-h">
            <span className="ttl">What you get</span>
          </div>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'grid',
              gap: 10,
              color: 'var(--bc-text)',
              fontSize: 14,
            }}
          >
            <li>● Full HUNT-mode big readout + ±50m / ±100m intervals</li>
            <li>● Precision mode with G1 / G7 / atmospherics / wind rose</li>
            <li>● AI Bullet Lookup — type any bullet, Claude returns BC + MV + sources</li>
            <li>● GPS auto-fills altitude for honest density-altitude correction</li>
            <li>● Spot Tracker — pin a fallen animal + navigate back via compass</li>
            <li>● Save up to 20 rifle/load profiles, synced across devices</li>
            <li>● DOPE export — print clean range cards before the hunt</li>
            <li>● Works fully offline on the range (Spot Tracker + math + cached bullets)</li>
          </ul>
        </section>

        {error && (
          <div
            style={{
              padding: 12,
              background: 'var(--bc-surface-2)',
              border: '1px solid var(--bc-red-line)',
              borderRadius: 'var(--bc-r-md)',
              color: 'var(--bc-text-2)',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {!checkout && (
          <button
            type="button"
            className="bc-tap primary"
            onClick={startCheckout}
            disabled={creating || !authLoaded}
          >
            {creating
              ? 'Starting checkout…'
              : !isSignedIn && authLoaded
                ? 'Sign in & buy lifetime — R299'
                : 'Buy lifetime — R299'}
          </button>
        )}

        {checkout && (
          <>
            {/* Peach widget config. The widget script auto-renders into
                the <form class="paymentWidgets"> element below. */}
            <Script
              src={checkout.widgetScriptUrl}
              strategy="afterInteractive"
            />
            <div
              style={{
                background: 'var(--bc-surface)',
                border: '1px solid var(--bc-line)',
                borderRadius: 'var(--bc-r-lg)',
                padding: 16,
              }}
            >
              <form
                action="#"
                className="paymentWidgets"
                data-brands="VISA MASTER"
              />
              <p
                style={{
                  fontSize: 11,
                  color: 'var(--bc-text-mute)',
                  marginTop: 12,
                  textAlign: 'center',
                }}
              >
                Card processed by Peach Payments — your card details
                never touch our servers.
              </p>
            </div>
          </>
        )}

        <p
          style={{
            fontSize: 11,
            color: 'var(--bc-text-mute)',
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          Refunds: contact support within 14 days if the app doesn't
          work for you. Reloading-data + ballistic-math answers are
          informational and do NOT replace published manufacturer load
          data. You assume responsibility for safe loads + ethical
          shots.
        </p>
      </main>
    </div>
  );
}

export default function PurchasePage() {
  return (
    <Suspense fallback={null}>
      <PurchasePageInner />
    </Suspense>
  );
}
