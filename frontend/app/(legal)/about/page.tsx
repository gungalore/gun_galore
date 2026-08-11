// /about — a short, honest description of what Gun Galore is, who
// operates it and where to find the detail. Kept factual (no
// marketing claims): what the platform does, how firearm transfers
// and held payments work, and the registered company behind it.
// Middleware already whitelists /about as a public route.

import { SUPPORT_PHONE_DISPLAY } from '@/lib/support-contact';

import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'About',
  description:
    'What Gun Galore is, how it works, and the company that operates it.',
};

export default function AboutPage() {
  return (
    <>
      <LegalDocHeader title="About Gun Galore" lastUpdated="Effective 16 July 2026" />

      <h2>What Gun Galore is</h2>
      {/* "Ammunition" removed on purpose — the Ammo category is seeded
          isActive:false (live ammo, primers and powder cannot be listed
          here), so naming it advertised a product line the platform has
          deliberately switched off. Reloading components stay: that
          category is live and holds bullets and brass only. */}
      <p>
        Gun Galore is a South African online marketplace for the
        outdoor, hunting and sport-shooting community — camping and
        overlanding gear, fishing, optics, knives, clothing, ranges,
        accessories and reloading components, alongside firearms. You
        can buy at a set price, bid in auctions, make an offer, or swop
        item for item, from both private sellers and licensed dealers.
      </p>

      <h2>How it works</h2>
      <p>
        Firearms are never couriered to a home address. By law they are
        transferred through a SAPS-licensed dealer, and you collect
        them there once the required paperwork is complete. For every
        order, your payment is held by Gun Galore and only released to
        the seller after delivery is confirmed — or, for firearms,
        after the dealer transfer is verified — so you are not out of
        pocket if something goes wrong. Non-firearm gear ships via our
        courier partners, Pudo (locker-to-locker) and The Courier Guy
        (door-to-door). Seller identity is verified through VerifyNow,
        a South African KYC provider, before any payout is released.
      </p>
      <p>
        For the full detail on how money moves, see{' '}
        <a href="/how-payments-work" style={{ color: 'var(--red)' }}>
          How payments work
        </a>
        , and for the rules around licence- and age-restricted
        categories see{' '}
        <a href="/firearms-compliance" style={{ color: 'var(--red)' }}>
          Regulated Items &amp; Compliance
        </a>
        .
      </p>

      <h2>Who runs it</h2>
      <p>
        Gun Galore is operated by GunGalore (Pty) Ltd, a South African
        private company, directed by Gerhard Johan Petrus Fourie.
      </p>
      <div
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          borderRadius: 8,
          padding: 16,
          fontSize: 14,
          lineHeight: 1.7,
        }}
      >
        <p style={{ margin: 0 }}>
          <strong>Full registered name:</strong> GunGalore (Pty) Ltd
          <br />
          <strong>Registration number:</strong> 2026/393321/07
          <br />
          <strong>Trading as:</strong> Gun Galore
          <br />
          <strong>Director:</strong> Gerhard Johan Petrus Fourie
          <br />
          <strong>Registered office:</strong> 36 Sterappel Crescent,
          Langeberg Glen, Cape Town, 7570, South Africa
          <br />
          <strong>Email:</strong>{' '}
          <a href="mailto:support@gungalore.co.za" style={{ color: 'var(--red)' }}>
            support@gungalore.co.za
          </a>
          <br />
          <strong>Phone:</strong> {SUPPORT_PHONE_DISPLAY}
        </p>
      </div>

      <h2>Legal &amp; compliance</h2>
      <p>
        Our full set of legal documents and statutory disclosures is
        collected on the{' '}
        <a href="/legal" style={{ color: 'var(--red)' }}>
          Legal &amp; compliance
        </a>{' '}
        page.
      </p>
    </>
  );
}
