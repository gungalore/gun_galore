// Privacy Policy — drafted with reference to the Protection of
// Personal Information Act 4 of 2013 (POPIA). Mirrors the actual data
// the codebase collects + the actual third-party processors used in
// production.
//
// Key POPIA requirements addressed:
//   - Identity + Information Officer (s 56)
//   - Categories of personal info + sources (s 11 + Reg 4)
//   - Lawful processing grounds (s 11)
//   - Purposes (s 13)
//   - Third-party recipients + cross-border transfer (s 71, s 72)
//   - Retention (s 14)
//   - Data subject rights (s 23-25)
//   - Direct marketing — opt-in default chosen by the operator (s 69)
//   - Children — refused for under-18s (s 34)
//   - Complaints to the Information Regulator (s 74)

import { SUPPORT_EMAIL } from '@/lib/brand';
import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'Privacy Policy',
  description:
    'How ALLOUTDOOR (PTY) LTD collects, uses and protects your personal information under POPIA.',
};

export default function PrivacyPage() {
  return (
    <>
      <LegalDocHeader title="Privacy Policy" lastUpdated="Effective 22 July 2026" />

      <h2>1. Who we are</h2>
      <p>
        This Privacy Policy explains how <strong>ALLOUTDOOR (PTY) LTD</strong>{' '}
        ("<strong>All Outdoor</strong>", "<strong>we</strong>",
        "<strong>us</strong>") collects, uses, shares and protects your
        personal information when you use the All Outdoor online store at{' '}
        <a href="https://gungalore.co.za" style={{ color: 'var(--red)' }}>
          gungalore.co.za
        </a>{' '}
        (the "Store").
      </p>
      <p>
        For the purposes of the Protection of Personal Information Act
        4 of 2013 (<strong>"POPIA"</strong>), All Outdoor is the{' '}
        <strong>responsible party</strong> in respect of personal
        information processed through the Store.
      </p>

      <h2>2. Information Officer</h2>
      <p>
        Our Information Officer, designated under section 56 of POPIA,
        is:
      </p>
      <p
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          borderRadius: 6,
          padding: 12,
          fontSize: 13,
        }}
      >
        <strong>Gerhard Johan Petrus Fourie</strong>
        <br />
        ALLOUTDOOR (PTY) LTD, 36 Sterappel Crescent, Langeberg Glen,
        Cape Town, 7570
        <br />
        <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--red)' }}>
          {SUPPORT_EMAIL}
        </a>
      </p>
      <p>
        You may direct any privacy-related enquiry, request or
        complaint to the Information Officer at the above address. We
        aim to acknowledge within 2 business days and resolve within
        30 calendar days.
      </p>

      <h2>3. What information we collect</h2>
      <p>
        We collect the following categories of personal information,
        organised by purpose:
      </p>

      <h3>3.1 Account &amp; identity</h3>
      <ul>
        <li>First name, last name and chosen username</li>
        <li>Email address (verified via Clerk)</li>
        <li>South African cellphone number (verified via SMS OTP)</li>
        <li>Profile photo (optional)</li>
      </ul>

      <h3>3.2 KYC and identity verification (Sellers only)</h3>
      <ul>
        <li>South African ID number (stored encrypted at rest with AES-GCM; we also derive a salted SHA-256 hash for duplicate-registration checks. We retain the encrypted ID — see &ldquo;How long we keep your information&rdquo; below — so that we can confirm the person being paid is the person we verified, prevent fraud and impersonation, and meet the record-keeping and transfer-documentation obligations that apply to certain regulated categories, where the seller&rsquo;s identity number must be reproduced on a prescribed statutory form)</li>
        <li>VerifyNow Home Affairs lookup result (full name, date of birth, status), which may include the official record photograph held by the Department of Home Affairs</li>
        <li>An image of the identity document you upload during verification (an identity card, identity book page or passport, or a PDF of one). This image is stored with our image-hosting provider, Cloudinary, in the United States, and is retained as an audit record of the verification for the life of your account.</li>
        <li><strong>Selfie image captured during face-match verification.</strong> The image is <strong>stored</strong> with our image-hosting provider, Cloudinary, in the United States. We retain it as an audit record of the verification for the life of your account, and we re-use it only to re-run a verification check on that same account. If you delete your account we remove the link to the image from your account record, but the stored image itself is <strong>not deleted today</strong> — deletion of the copy held by the image-hosting provider is a follow-up we have not yet implemented, and we will not describe it as done until it is.</li>
        <li>Number of face-match attempts and outcome</li>
      </ul>
      <p>
        The identity-document image, the selfie and — where the anchored check
        is used — the official record photograph returned by the Home Affairs
        lookup are transmitted to Anthropic in the United States, which runs
        the automated document-authenticity and face-match checks on our
        behalf. See paragraphs 7 and 8.
      </p>
      <p>
        Additional terms apply to regulated categories. See the{' '}
        <a href="/members/regulated-items" style={{ color: 'var(--red)' }}>
          Regulated Items Annex
        </a>
        , available to registered members.
      </p>

      <h3>3.3 Banking (Sellers only)</h3>
      <ul>
        <li>Bank name, account holder name, account number, branch code, account type</li>
        <li>The outcome of our manual review of these bank details before you are first paid (we check the account-holder name matches your verified identity)</li>
      </ul>

      <h3>3.4 Address</h3>
      <ul>
        <li>Physical / shipping address (street, suburb, city, postal code, province)</li>
        <li>Approximate geolocation (latitude / longitude) where you allow your browser to share it for shipping rate calculation</li>
      </ul>

      <h3>3.5 Purchases, sales and account activity</h3>
      <ul>
        <li>Listings you create, edit and cancel</li>
        <li>Bids, offers, purchases and sales</li>
        <li>Pre-purchase Q&amp;A questions and seller answers</li>
        <li>Ratings given and received</li>
        <li>Disputes raised and their outcomes</li>
        <li>Notifications sent to you (email + SMS history)</li>
      </ul>

      <h3>3.6 Device and session</h3>
      <ul>
        <li>IP address, browser type, operating system, login times, session activity (handled by Clerk and visible to you in your Clerk account settings)</li>
        <li>Performance and error metrics used to keep the Store working</li>
      </ul>

      <h3>3.7 Usage and activity analytics</h3>
      <p>
        To understand how the Store is used, improve it, and decide what
        to feature and promote, we collect first-party analytics about your
        activity on All Outdoor. This includes the pages and listings you view,
        the searches you run, items you save or make offers/bids on, and when
        and how often you sign in. Where you are signed in, this activity is
        linked to your account; where you are signed out, it is linked to a
        first-party device identifier only. We use this internally to produce
        usage statistics and to time our own communications (for example, our
        marketing SMS). This is first-party analytics only —{' '}
        <strong>we do not sell it, and we do not share it with third-party
        ad networks.</strong> You can object to this profiling (see section 10)
        and opt out of marketing at any time.
      </p>

      <h2>4. How we collect this information</h2>
      <p>
        We collect personal information directly from you when you
        register, complete your profile, create a listing, make a
        purchase or use any other feature of the Store. We also
        collect information from our service providers (for example,
        VerifyNow returns your name, ID status and face-match score)
        and automatically when you interact with the Store (session,
        device, activity). Payment-instrument and transaction data
        will be processed by our appointed licensed South African
        payment service provider once card payments launch.
      </p>

      <h2>5. Why we collect it (purposes)</h2>
      <p>We process personal information for the following purposes:</p>
      <ul>
        <li><strong>To provide the Store</strong> — register and authenticate your account, display your listings, route your transactions, accept your payments and pay you what you are owed.</li>
        <li><strong>To verify your identity</strong> — meet our KYC obligations before sellers can be paid, prevent fraud and identity theft.</li>
        <li><strong>To comply with the law</strong> — including the sector-specific legislation that governs licence- and age-restricted categories of goods, which is identified by name in our{' '}
          <a href="/regulated-categories" style={{ color: 'var(--red)' }}>Regulated Categories — Statutory Schedule</a>, together with the Consumer Protection Act, the Financial Intelligence Centre Act (FICA) and tax obligations.</li>
        <li><strong>To detect and prevent fraud, abuse and misuse of the Store</strong> — including off-platform contact-detail sharing, sock-puppet accounts and money-laundering risk.</li>
        <li><strong>To communicate with you</strong> — transactional notifications (order updates, dispatch confirmations, dispute outcomes) and, with your opt-in consent, marketing communications.</li>
        <li><strong>To improve the Store</strong> — analytics, debugging, A/B testing (always against aggregated or de-identified data where possible).</li>
        <li><strong>To resolve disputes</strong> — gather and review evidence between buyer, seller, courier and admin.</li>
      </ul>

      <h2>6. Lawful grounds for processing (POPIA § 11)</h2>
      <p>
        We rely on the following lawful grounds, as appropriate to the
        specific purpose:
      </p>
      <ul>
        <li><strong>Performance of a contract:</strong> processing necessary to deliver the service you signed up for (§ 11(1)(b)).</li>
        <li><strong>Compliance with legal obligation:</strong> KYC, the statutory records we must keep for licence- and age-restricted categories, tax (§ 11(1)(c)). The particular legislation imposing that obligation, and the records kept under it, are identified in our{' '}
          <a href="/regulated-categories" style={{ color: 'var(--red)' }}>Regulated Categories — Statutory Schedule</a>, which is publicly available and which we also give you as the notification required by § 18(1)(f).</li>
        <li><strong>Legitimate interest:</strong> fraud prevention, user safety, dispute investigation (§ 11(1)(f)) — balanced against your rights.</li>
        <li><strong>Consent:</strong> KYC Home Affairs lookup, direct marketing, and the sharing of contact details where you agree that hand-over of an item that requires a licence or permit will be arranged directly between the parties or through an authorised third party (§ 11(1)(a)).</li>
      </ul>
      <p>
        Additional terms apply to regulated categories. See the{' '}
        <a href="/members/regulated-items" style={{ color: 'var(--red)' }}>
          Regulated Items Annex
        </a>
        , available to registered members.
      </p>

      <h2>7. Who we share your information with</h2>
      <p>
        We share specific data with the following third-party operators
        ("operators" in POPIA terms). Each is bound by a written
        agreement that requires them to process personal information
        only as instructed and to maintain POPIA-equivalent
        safeguards.
      </p>
      {/* House rule: never name a payment provider in public copy until a contract is signed (TPPP). */}
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginBottom: 16 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '8px 0' }}>Operator</th>
            <th style={{ textAlign: 'left', padding: '8px 0' }}>Country</th>
            <th style={{ textAlign: 'left', padding: '8px 0' }}>What we share</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['Clerk', 'United States', 'Email, name, sessions, login activity'],
            ['VerifyNow', 'South Africa', 'ID number, name, selfie image (KYC face-match)'],
            ['Pudo', 'South Africa', 'Buyer address, parcel size + weight, shipping reference'],
            ['The Courier Guy', 'South Africa', 'Buyer address, parcel size + weight, waybill reference'],
            ['Cloudinary', 'United States', 'Listing photos; identity-verification images (ID document, selfie) and compliance documents you upload'],
            ['Resend', 'United States', 'Email address, content of transactional emails'],
            ['SMSPortal', 'South Africa', 'Phone number, content of transactional SMS'],
            ['Anthropic (Claude)', 'United States', 'Listing title + description + photos (for moderation); pre-purchase question text (for Q&A moderation); identity-verification images (ID document, selfie and, where applicable, the official record photograph) for automated document-authenticity and face-match checks'],
          ].map(([op, country, share], i) => (
            <tr key={i} style={{ borderBottom: '0.5px solid var(--border)' }}>
              <td style={{ padding: '6px 8px 6px 0' }}>{op}</td>
              <td style={{ padding: '6px 8px' }}>{country}</td>
              <td style={{ padding: '6px 0' }}>{share}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        We do not sell personal information. We will share information
        with law enforcement or regulators only when compelled to do so
        by valid legal process or where we believe in good faith that
        disclosure is necessary to prevent imminent harm.
      </p>

      <h2>8. Cross-border transfers (POPIA § 72)</h2>
      <p>
        Some of the operators above are located outside South Africa
        (notably Clerk, Cloudinary, Resend and Anthropic in the United
        States). Where personal information is transferred across
        borders, we rely on the following POPIA § 72 grounds:
      </p>
      <ul>
        <li>Contractual safeguards requiring the recipient to apply standards substantially similar to POPIA;</li>
        <li>Your explicit consent at sign-up; and</li>
        <li>Where the transfer is necessary to perform the contract you concluded with us.</li>
      </ul>
      <p>
        The information transferred across borders includes the
        identity-verification images described in paragraph 3.2 — the
        identity-document image, the face image (selfie) and, where the
        anchored check is used, the official record photograph. Those images
        are stored with Cloudinary in the United States and are transmitted to
        Anthropic in the United States for the automated document-authenticity
        and face-match checks. For that transfer specifically we rely on the
        consent you give before verification begins — the consent screen names
        the storage and assessment providers, and states that both are in the
        United States — on the necessity of the transfer for the verification
        step you asked us to perform, and on the contractual safeguards above.
      </p>

      <h2>9. How long we keep your information</h2>
      <p>
        We retain personal information only for as long as it is needed
        for the purposes set out above, or as required by law:
      </p>
      <ul>
        <li><strong>Transaction records:</strong> 5 years from completion, in line with FICA record-keeping requirements.</li>
        <li><strong>Listings, ratings and Q&amp;A:</strong> for the lifetime of your account (kept for public-history integrity); permanently de-identified within 90 days of account deletion.</li>
        <li><strong>KYC ID hash:</strong> retained while your account is active, plus 12 months after deletion to prevent duplicate registration.</li>
        <li><strong>Encrypted SA ID number:</strong> retained (AES-GCM encrypted at rest) while your account is active, so that we can confirm the identity of the person being paid, prevent impersonation, and complete any prescribed statutory transfer or record-keeping document required for the regulated categories we handle; where such a document has been completed, the encrypted ID is kept for the period that legislation requires that record to be retained, and is otherwise deleted on account closure. The legislation imposing that requirement is identified in our{' '}
          <a href="/regulated-categories" style={{ color: 'var(--red)' }}>Regulated Categories — Statutory Schedule</a>.</li>
        <li><strong>KYC selfie (face image):</strong> stored with our image-hosting provider, Cloudinary, and retained as an audit record of the verification for the life of your account; re-used only to re-run a verification check on that same account. On account deletion we clear the reference held in your account record, but the stored image itself is not deleted at present; deleting the copy held by the image-hosting provider is a tracked follow-up and is not yet implemented.</li>
        <li><strong>KYC identity-document image:</strong> stored with our image-hosting provider, Cloudinary, and retained as an audit record of the verification for the life of your account. On account deletion we clear the reference held in your account record, but the stored image itself is not deleted at present, on the same basis as the selfie above.</li>
        <li><strong>Email and SMS logs:</strong> 90 days.</li>
        <li><strong>Usage analytics (raw activity events):</strong> up to 12 months, after which they are deleted; we keep only aggregated, de-identified statistics beyond that period.</li>
        <li><strong>Banking details:</strong> retained while your account is active; deleted on account closure unless there is an unresolved transaction or legal-hold reason to retain.</li>
        <li><strong>Cookies:</strong> see our{' '}
          <a href="/cookies" style={{ color: 'var(--red)' }}>Cookie Policy</a> for specific retention periods.
        </li>
      </ul>

      <h2>10. Your rights as a data subject</h2>
      <p>Under POPIA you have the right to:</p>
      <ul>
        <li><strong>Access</strong> the personal information we hold about you (§ 23);</li>
        <li><strong>Request correction or deletion</strong> of information that is inaccurate, irrelevant, excessive, out of date, incomplete, misleading or obtained unlawfully (§ 24) — subject to our legal retention obligations;</li>
        <li><strong>Object</strong> to processing in certain circumstances, including direct marketing (§ 11(3));</li>
        <li><strong>Withdraw consent</strong> at any time where processing relies on your consent;</li>
        <li><strong>Lodge a complaint</strong> with the Information Regulator (see paragraph 14).</li>
      </ul>
      <p>
        To exercise any of these rights, contact our Information
        Officer at the address in paragraph 2. We may request
        reasonable proof of identity before acting on your request.
      </p>

      <h2>11. Direct marketing</h2>
      <p>
        All Outdoor sends two kinds of communications:
      </p>
      <ul>
        <li><strong>Transactional</strong> — order updates, dispatch confirmations, dispute outcomes, account-security alerts. These are necessary to operate the Store and are sent regardless of your marketing preferences.</li>
        <li><strong>Marketing</strong> — newsletters and promotional offers. These are only sent if you have <strong>opted in</strong> at sign-up or in your profile settings. You may withdraw consent at any time by clicking the unsubscribe link in any marketing message or by changing your preferences in your account.</li>
      </ul>

      <h2>12. Information about children</h2>
      <p>
        The Platform is not directed at, and may not be used by, any
        person under the age of 18. We do not knowingly collect
        personal information about children. If you become aware that a
        child has provided us with personal information, contact our
        Information Officer immediately and we will take steps to
        delete it.
      </p>

      <h2>13. Security</h2>
      <p>
        We implement reasonable technical and organisational measures
        to safeguard personal information against loss, unauthorised
        access, alteration or disclosure. These include encryption in
        transit (TLS), encryption at rest for sensitive identifiers
        (AES-GCM for ID numbers), hashed credentials, role-based access
        control, audit logging of every administrative action, and
        contact-detail filtering to prevent off-platform exfiltration.
        No system is perfectly secure, however, and we cannot guarantee
        the absolute security of any information.
      </p>
      <p>
        We will notify you and the Information Regulator without
        undue delay if we become aware of a security compromise that
        creates a real risk of harm, in line with section 22 of POPIA.
      </p>

      <h2>14. Complaints to the Information Regulator</h2>
      <p>
        If you believe that we have not handled your personal
        information in accordance with POPIA, you may lodge a complaint
        with the Information Regulator:
      </p>
      <p
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          borderRadius: 6,
          padding: 12,
          fontSize: 13,
        }}
      >
        <strong>Information Regulator (South Africa)</strong>
        <br />
        JD House, 27 Stiemens Street, Braamfontein, Johannesburg, 2001
        <br />
        Email: <a href="mailto:enquiries@inforegulator.org.za" style={{ color: 'var(--red)' }}>enquiries@inforegulator.org.za</a>
        <br />
        Web: <a href="https://inforegulator.org.za/" target="_blank" rel="noopener" style={{ color: 'var(--red)' }}>inforegulator.org.za</a>
      </p>
      <p>
        We would, however, appreciate the opportunity to address your
        concern directly first — please contact our Information Officer.
      </p>

      <h2>15. Changes to this policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Material
        changes will be notified to you by email and posted on the
        Platform at least 14 days before they take effect. The "last
        updated" date at the top of this page tells you when the
        current version came into force.
      </p>
    </>
  );
}
