// /about — a short, honest description of what All Outdoor is, who
// operates it and where to find the detail. Kept factual (no
// marketing claims): what the store does, how held payments work, and
// the registered company behind it.
// Middleware already whitelists /about as a public route.
//
// PUBLIC SURFACE. Regulated categories are members-only, so the
// procedure that applies to them lives in the Regulated Items Annex
// (/members/regulated-items) and not here. What stays here is the
// duty that binds every buyer and seller, stated in general terms —
// nothing is softened and nothing is denied: we do trade in regulated
// categories, for registered members.

import { SUPPORT_PHONE_DISPLAY } from '@/lib/support-contact';

import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'About',
  description:
    'What All Outdoor is, how it works, and the company that operates it.',
};

export default function AboutPage() {
  return (
    <>
      <LegalDocHeader title="About All Outdoor" lastUpdated="Effective 16 July 2026" />

      <h2>What All Outdoor is</h2>
      <p>
        All Outdoor is a South African new and secondhand outdoor store
        — camping and overlanding gear, fishing tackle, optics, knives,
        clothing, outdoor equipment and accessories. You can buy at a
        set price, bid in auctions, make an offer, or swop item for
        item, from both private sellers and licensed dealers.
      </p>
      <p>
        Some of the categories we carry are regulated, and those are
        open to registered members only. We do not hide that we trade
        in them — they are simply not browsable while you are signed
        out, and the additional rules that govern them are published to
        members.
      </p>
      <p>
        All Outdoor does not sell ammunition. Live ammunition may not
        be listed, sold or traded on this platform under any
        circumstances.
      </p>

      <h2>How it works</h2>
      <p>
        Items that require a licence or permit are never couriered to a
        residential address. Where the law requires it, they are handed
        over through an authorised dealer and you collect them there
        once the required paperwork is complete. For every order, your
        payment is held by All Outdoor and only released to the seller
        after delivery is confirmed — or, where an item is handed over
        through a dealer, after that hand-over is verified — so you are
        not out of pocket if something goes wrong. Everything else
        ships via our courier partners, Pudo (locker-to-locker) and The
        Courier Guy (door-to-door). Seller identity is verified through
        VerifyNow, a South African KYC provider, before any payout is
        released.
      </p>
      <p>
        For the full detail on how money moves, see{' '}
        <a href="/how-payments-work" style={{ color: 'var(--red)' }}>
          How payments work
        </a>
        . Additional terms apply to regulated categories. See the{' '}
        <a href="/members/regulated-items" style={{ color: 'var(--red)' }}>
          Regulated Items Annex
        </a>
        , available to registered members.
      </p>

      <h2>Who runs it</h2>
      <p>
        All Outdoor is operated by GunGalore (Pty) Ltd, a South African
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
          <strong>Trading as:</strong> All Outdoor
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
