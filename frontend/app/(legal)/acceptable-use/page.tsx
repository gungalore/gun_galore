// Acceptable Use Policy — what's allowed and what's banned on the
// platform. Referenced from the Terms of Service. Drafted to be
// readable AND enforceable: each "banned" item has a clear test so
// admins can apply it consistently.

import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'Acceptable Use Policy — Gun Galore',
  description:
    'What is and is not allowed on GunGalore — listings, content and behaviour rules.',
};

export default function AcceptableUsePage() {
  return (
    <>
      <LegalDocHeader
        title="Acceptable Use Policy"
        lastUpdated="Effective 24 June 2026"
      />

      <h2>1. Who this applies to</h2>
      <p>
        This Acceptable Use Policy ("<strong>AUP</strong>") applies to
        every person who creates an account on GunGalore, uses the
        Platform as a visitor, lists or transacts goods, or submits
        any kind of content. The AUP is incorporated by reference into
        our{' '}
        <a href="/terms" style={{ color: 'var(--red)' }}>Terms of Service</a>
        . Breach of the AUP is a breach of the Terms.
      </p>

      <h2>2. What you can list</h2>
      <p>
        You may list goods on GunGalore where all of the following are
        true:
      </p>
      <ul>
        <li>You own the item (or have express authority from the owner to sell it on their behalf).</li>
        <li>The item is lawful to sell, possess and transfer in South Africa.</li>
        <li>The item fits one of GunGalore's category trees (firearms, ammunition, accessories, optics, hunting, outdoor, ranges, etc.).</li>
        <li>The item is accurately described, with the correct condition (New, Like New, Good, Fair or Poor) and clear, recent photographs showing the actual item.</li>
        <li>For firearms and items subject to the Firearms Control Act, both you and the buyer hold the relevant SAPS Competency Certificate and the transfer is routed through a SAPS-licensed dealer — see our{' '}
          <a href="/firearms-compliance" style={{ color: 'var(--red)' }}>Firearms Compliance Policy</a>.
        </li>
      </ul>

      <h2>3. What you cannot list</h2>
      <p>
        The following are <strong>never</strong> permitted on
        GunGalore. Listing any of these will result in immediate
        removal and may result in account suspension:
      </p>
      <ul>
        <li><strong>Stolen goods</strong> — including goods you cannot prove ownership of, or goods whose serial numbers have been removed or altered.</li>
        <li><strong>Counterfeit or replica firearms / accessories</strong> sold as genuine.</li>
        <li><strong>Fully automatic firearms</strong> or any firearm component prohibited under the Firearms Control Act for civilian possession.</li>
        <li><strong>Loose live ammunition</strong> traded peer-to-peer between private individuals — these may be listed only by SAPS-licensed dealers operating on our New Store surface where supported.</li>
        <li><strong>Explosives, suppressors, silencers, prohibited large-capacity magazines</strong> or any other item explicitly restricted under SA law.</li>
        <li><strong>Goods that infringe</strong> any third-party intellectual property right (trademark, copyright, design).</li>
        <li><strong>Hate symbols, extremist memorabilia</strong> or any item primarily associated with promoting violence against a protected group.</li>
        <li><strong>Personal data of others</strong> — including ID copies, licences belonging to other people, or contact lists.</li>
        <li><strong>Hazardous materials</strong> that cannot be safely couriered or that contravene IATA / SARS import-export rules.</li>
        <li><strong>Animals, pets, ivory, rhino horn, lion bones</strong> or any item subject to CITES restrictions.</li>
      </ul>

      <h2>4. What your listing photographs must show</h2>
      <ul>
        <li><strong>The actual item</strong> being sold — not a stock photo, not a manufacturer image, not a photo from someone else's listing.</li>
        <li>The condition honestly — visible wear, scratches, dents, missing parts.</li>
        <li>Serial numbers <strong>partially obscured</strong> (last 3 digits masked) where applicable, to prevent serial-cloning fraud.</li>
        <li><strong>No personal contact information visible</strong> — phone numbers, email addresses, WhatsApp / Telegram / Signal handles, social-media usernames, QR codes that link to off-platform contact channels, business cards or shop signage that identifies a physical address.</li>
      </ul>
      <p>
        Photographs are automatically scanned for contact information
        before publication. Listings that fail this check are returned
        to you for correction.
      </p>

      <h2>5. What your listing description, questions and notes must NOT contain</h2>
      <p>
        Across <strong>every</strong> freeform field on GunGalore
        (listing title, description, pre-purchase Q&amp;A, offer
        notes, counter-offer notes, rating comments and any future
        message channel), the following are never permitted:
      </p>
      <ul>
        <li>Phone numbers, email addresses, WhatsApp / Telegram / Signal / Facebook Messenger handles, Instagram / TikTok / Facebook / X / Snapchat usernames, or any other personal contact channel.</li>
        <li>URLs or domain names pointing at your own shop, channel or storefront. (Brand or manufacturer websites mentioned in passing — e.g. "glock.com" — are fine.)</li>
        <li>Phrases that try to coordinate off-platform — e.g. "DM me", "WhatsApp me", "meet me at...", "let's chat directly", "deal off-platform".</li>
        <li>Street addresses identifying where you can be found physically. (Province or suburb on its own is fine.)</li>
        <li>Pricing or sale terms that contradict the listing's headline price.</li>
        <li>Bigotry, hate speech, harassment, threats, sexually explicit content or anything else unlawful under South African law.</li>
      </ul>

      <h2>6. Behaviour we will not tolerate</h2>
      <ul>
        <li><strong>Fee bypass</strong> — coordinating a sale off-platform to avoid commission, in any form.</li>
        <li><strong>Sock-puppet accounts</strong> — running multiple accounts for the same natural person.</li>
        <li><strong>Bid manipulation</strong> — bidding on your own auctions, coordinating with another bidder to inflate prices, retracting bids without good cause.</li>
        <li><strong>Rating manipulation</strong> — soliciting fake positive ratings, threatening users with negative ratings to extract concessions, sock-puppet positive ratings on your own listings.</li>
        <li><strong>Harassment</strong> — abusive, threatening, discriminatory or sexually inappropriate communication of any kind, in Q&amp;A, notes, ratings or via off-platform channels.</li>
        <li><strong>Privacy abuse</strong> — gathering, doxxing, scraping, publishing or selling another user's personal information.</li>
        <li><strong>Platform abuse</strong> — automated scraping, denial-of-service traffic, attempts to bypass authentication, attempts to reverse-engineer or interfere with the Platform's operation.</li>
        <li><strong>Tax evasion</strong> — falsifying your income or VAT status; failing to issue an invoice where one is legally required.</li>
        <li><strong>False identity</strong> — registering under a name other than your own, attempting KYC with someone else's documents.</li>
      </ul>

      <h2>7. Enforcement</h2>
      <p>
        We apply enforcement proportionate to the breach and your
        history on the Platform:
      </p>
      <ol>
        <li><strong>Listing removed</strong> with a notification explaining why. Repeat offences accumulate.</li>
        <li><strong>Warning</strong> issued via email + in-app banner for repeated minor breaches.</li>
        <li><strong>Temporary suspension</strong> (typically 7 to 30 days) for serious or repeated breaches.</li>
        <li><strong>Permanent ban</strong> for severe breaches (e.g. stolen-goods listing, fraud, harassment) or for repeated breach after suspension.</li>
        <li>For unlawful conduct, we will refer the matter to the South African Police Service and any other competent authority and will provide them with the information necessary for their investigation.</li>
      </ol>
      <p>
        Every enforcement decision is recorded in our audit log with
        the admin's identity and the reason given. You may appeal an
        enforcement decision by emailing{' '}
        <a href="mailto:support@gungalore.co.za" style={{ color: 'var(--red)' }}>
          support@gungalore.co.za
        </a>
        {' '}within 14 days; we aim to respond within 5 business days.
      </p>

      <h2>8. Reporting an AUP breach</h2>
      <p>
        If you spot a listing, message or behaviour that breaches this
        AUP, report it via the in-product report button (on Q&amp;A
        rows) or email{' '}
        <a href="mailto:support@gungalore.co.za" style={{ color: 'var(--red)' }}>
          support@gungalore.co.za
        </a>
        {' '}with the URL or reference number of what you saw. We treat
        every report seriously and respond within 2 business days.
      </p>
    </>
  );
}
