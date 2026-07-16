// Site-wide footer mounted in the root layout. Two roles:
//
//   1. ECT § 43 compliance — Section 43 of the Electronic
//      Communications and Transactions Act 25 of 2002 requires every
//      commercial SA website to disclose the operator's full
//      registered name, registration number, physical address, and
//      contact details on every page. The footer is the conventional
//      place for this.
//
//   2. Legal-doc discoverability — gives users a single, predictable
//      place to find Terms, Privacy, AUP, Refund, Firearms, Cookies
//      and the AML policy.
//
// Skipped on the admin panel (admin layout sits under a separate
// route group with its own chrome) but rendered on every public
// page. Server-rendered to keep zero JS cost.

import Link from 'next/link';
import { GetTheAppCta } from '@/components/get-the-app-cta';

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer
      style={{
        marginTop: 64,
        padding: '32px 16px 24px',
        borderTop: '0.5px solid var(--border)',
        background: 'var(--bg-card)',
        color: 'var(--text-secondary)',
        fontSize: 13,
      }}
    >
      <div
        style={{
          maxWidth: 1280,
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 32,
          marginBottom: 24,
        }}
      >
        {/* Company / brand block */}
        <div>
          <p
            style={{
              color: 'var(--red)',
              fontWeight: 600,
              fontSize: 12,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 8,
            }}
          >
            Gun Galore
          </p>
          <p style={{ color: 'var(--text-tertiary-on-card)', lineHeight: 1.6, margin: 0 }}>
            South Africa&apos;s outdoor, hunting and sport marketplace.
            Seller identity verified before payout · every payment held
            until delivery is confirmed.
          </p>
        </div>

        {/* Shop links */}
        <div>
          <p
            style={{
              color: 'var(--text-primary)',
              fontWeight: 500,
              marginBottom: 8,
            }}
          >
            Shop
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, lineHeight: 1.9 }}>
            <li><Link href="/" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Marketplace</Link></li>
            <li><Link href="/?listingType=AUCTION" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Auctions</Link></li>
            <li><Link href="/?listingType=TAKE_A_SHOT" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Take a Shot</Link></li>
            <li><Link href="/listings/new" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Sell</Link></li>
            <li><Link href="/faq" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Help &amp; FAQ</Link></li>
          </ul>
        </div>

        {/* Legal links */}
        <div>
          <p
            style={{
              color: 'var(--text-primary)',
              fontWeight: 500,
              marginBottom: 8,
            }}
          >
            Legal
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, lineHeight: 1.9 }}>
            <li><Link href="/terms" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Terms of Service</Link></li>
            <li><Link href="/privacy" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Privacy Policy</Link></li>
            <li><Link href="/acceptable-use" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Acceptable Use</Link></li>
            <li><Link href="/refund-policy" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Refund &amp; Disputes</Link></li>
            <li><Link href="/firearms-compliance" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Regulated Items &amp; Compliance</Link></li>
            <li><Link href="/aml-policy" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>AML Policy</Link></li>
            <li><Link href="/cookies" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Cookie Policy</Link></li>
            <li><Link href="/paia" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>PAIA Manual</Link></li>
            <li><Link href="/legal" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>All legal &amp; ECT § 43</Link></li>
          </ul>
        </div>

        {/* Support */}
        <div>
          <p
            style={{
              color: 'var(--text-primary)',
              fontWeight: 500,
              marginBottom: 8,
            }}
          >
            Support
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, lineHeight: 1.9 }}>
            <li>
              <a
                href="mailto:support@gungalore.co.za"
                style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
              >
                support@gungalore.co.za
              </a>
            </li>
            <li style={{ color: 'var(--text-tertiary-on-card)', fontSize: 12 }}>
              We aim to respond within 2 business days
            </li>
          </ul>
        </div>

        {/* Company */}
        <div>
          <p
            style={{
              color: 'var(--text-primary)',
              fontWeight: 500,
              marginBottom: 8,
            }}
          >
            Company
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, lineHeight: 1.9 }}>
            <li><Link href="/contact" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Contact</Link></li>
            <li><Link href="/complaints" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Complaints</Link></li>
            <li><Link href="/fees" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Fees</Link></li>
            <li><Link href="/how-payments-work" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>How payments work</Link></li>
          </ul>
        </div>

        {/* Account links (UX-1f) — the common buyer tasks, one click from any
            page. Routes match lib/account-menu.tsx (single source of truth). */}
        <div>
          <p
            style={{
              color: 'var(--text-primary)',
              fontWeight: 500,
              marginBottom: 8,
            }}
          >
            Account
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, lineHeight: 1.9 }}>
            <li><Link href="/my/orders" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>My orders</Link></li>
            <li><Link href="/wishlist" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Wishlist</Link></li>
            <li><Link href="/saved-searches" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Saved searches</Link></li>
            <li><Link href="/support" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Support</Link></li>
            <li><Link href="/faq" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>FAQ</Link></li>
          </ul>
        </div>
      </div>

      {/* "Get the app" band. */}
      <div
        style={{
          maxWidth: 1280,
          margin: '0 auto',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
          alignItems: 'center',
          justifyContent: 'flex-end',
          paddingTop: 20,
          borderTop: '0.5px solid var(--border)',
          marginBottom: 20,
        }}
      >
        <GetTheAppCta />
      </div>

      {/* ECT § 43 disclosures — mandatory on every commercial SA page.
          Compact form here; full version with VAT, director, etc. on
          /legal. */}
      <div
        style={{
          maxWidth: 1280,
          margin: '0 auto',
          paddingTop: 16,
          borderTop: '0.5px solid var(--border)',
          color: 'var(--text-tertiary-on-card)',
          fontSize: 11,
          lineHeight: 1.7,
        }}
      >
        <p style={{ margin: 0 }}>
          © {year} GunGalore (Pty) Ltd · Registration No. 2026/393321/07 · 36 Sterappel Crescent, Langeberg Glen, Cape Town, 7570, South Africa ·{' '}
          <a href="mailto:support@gungalore.co.za" style={{ color: 'var(--text-tertiary-on-card)', textDecoration: 'underline' }}>
            support@gungalore.co.za
          </a>
          {' · +27 74 303 9999 · '}
          <Link href="/legal" style={{ color: 'var(--text-tertiary-on-card)', textDecoration: 'underline' }}>
            Full disclosures &amp; legal index
          </Link>
        </p>
      </div>
    </footer>
  );
}
