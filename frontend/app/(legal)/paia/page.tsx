// /paia — the section 51 manual required of every private body under
// the Promotion of Access to Information Act 2 of 2000 (PAIA).
// Structured to follow the Information Regulator's published manual
// template: particulars of the body, the section 10 Guide, categories
// of records held, records held under other legislation, how to
// request access (prescribed form, prescribed fees, statutory
// timelines), the grounds for refusal, and the Regulator's contact
// details. Fees are described per the PAIA regulations — we do not
// quote rand figures here so the page cannot go stale.

import { SUPPORT_PHONE_TEL, SUPPORT_PHONE_DISPLAY } from '@/lib/support-contact';

import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'PAIA Manual',
  description:
    'ALLOUTDOOR (PTY) LTD information manual under section 51 of the Promotion of Access to Information Act 2 of 2000.',
};

export default function PaiaPage() {
  return (
    <>
      <LegalDocHeader
        title="PAIA Manual (Section 51)"
        lastUpdated="Effective 16 July 2026"
      />

      <p>
        This manual is published by <strong>ALLOUTDOOR (PTY) LTD</strong>{' '}
        in terms of section 51 of the Promotion of Access to Information
        Act 2 of 2000 (<strong>"PAIA"</strong>). It tells you what
        records we hold, how to request access to them, and what to
        expect when you do.
      </p>

      <h2>1. Particulars of the private body</h2>
      <p
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          borderRadius: 8,
          padding: 16,
          fontSize: 14,
          lineHeight: 1.7,
        }}
      >
        <strong>Full registered name:</strong> ALLOUTDOOR (PTY) LTD
        <br />
        <strong>Registration number:</strong> 2026/639713/07
        <br />
        <strong>Trading as:</strong> All Outdoor
        <br />
        <strong>Registered office:</strong> 36 Sterappel Crescent,
        Langeberg Glen, Cape Town, 7570, South Africa
        <br />
        <strong>Email:</strong>{' '}
        <a href="mailto:support@gungalore.co.za" style={{ color: 'var(--red)' }}>
          support@gungalore.co.za
        </a>
        <br />
        <strong>Telephone:</strong>{' '}
        <a href={`tel:${SUPPORT_PHONE_TEL}`} style={{ color: 'var(--red)' }}>
          {SUPPORT_PHONE_DISPLAY}
        </a>
        <br />
        <strong>Website:</strong>{' '}
        <a href="https://gungalore.co.za" style={{ color: 'var(--red)' }}>
          gungalore.co.za
        </a>
      </p>

      <h2>2. Information Officer</h2>
      <p>
        The head of the private body for the purposes of PAIA, and our
        Information Officer, is:
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
        <a href="mailto:support@gungalore.co.za" style={{ color: 'var(--red)' }}>
          support@gungalore.co.za
        </a>
      </p>
      <p>
        All requests for access to records, and any enquiry about this
        manual, should be addressed to the Information Officer at the
        details above.
      </p>

      <h2>3. The Guide of the Information Regulator</h2>
      <p>
        The Information Regulator has published a guide, in terms of
        section 10 of PAIA, on how to use the Act. The guide is
        available in each of the official languages and explains how to
        exercise your rights under PAIA and the Protection of Personal
        Information Act 4 of 2013 (POPIA). You may obtain it from the
        Information Regulator using the contact details in section 9 of
        this manual.
      </p>

      <h2>4. Categories of records held</h2>
      <p>
        We hold records in the following broad categories. Not every
        record in a category is automatically available — access is
        subject to the request procedure and the grounds for refusal set
        out below.
      </p>
      <ul>
        <li>
          <strong>Corporate and statutory records</strong> — our
          founding documents, share register, records maintained under
          the Companies Act 71 of 2008, statutory registers, tax
          records, financial and accounting records, insurance and
          contracts with suppliers and service providers.
        </li>
        <li>
          <strong>Customer and verification (KYC) records</strong> —
          account details, contact information, and the identity- and
          bank-verification information we collect from sellers before a
          payout, as described in our{' '}
          <a href="/privacy" style={{ color: 'var(--red)' }}>Privacy Policy</a>.
        </li>
        <li>
          <strong>Transaction records</strong> — listings, bids, offers,
          orders, sales, payment and payout records, shipping, courier and
          hand-over records (including records of transfers completed
          through an authorised third party where a category of goods
          requires it), invoices and commission records.
        </li>
        <li>
          <strong>Regulated-category compliance records</strong> — the
          licence, permit and competency particulars supplied by the parties
          to a transaction, item identifiers such as serial numbers, the
          particulars of the authorised third party at which an item is held
          or handed over, completed prescribed statutory forms, and the
          registers kept in connection with those transfers. The legislation
          under which these records are kept is identified in our{' '}
          <a href="/regulated-categories" style={{ color: 'var(--red)' }}>
            Regulated Categories &mdash; Statutory Schedule
          </a>
          , which is publicly available free of charge and without
          registration.
        </li>
        <li>
          <strong>Marketplace content</strong> — listing text and
          photographs, pre-purchase questions and answers, ratings,
          dispute records and moderation records.
        </li>
        <li>
          <strong>Personnel records</strong> — records relating to any
          employees or contractors, including employment contracts,
          payroll and records kept under labour and tax legislation.
        </li>
      </ul>

      <h2>5. Records held under other legislation</h2>
      <p>
        In addition to PAIA, we keep and process records in accordance
        with, among others, the following legislation, as applicable:
      </p>
      <ul>
        <li>Companies Act 71 of 2008</li>
        <li>Protection of Personal Information Act 4 of 2013 (POPIA)</li>
        <li>Financial Intelligence Centre Act 38 of 2001 (FICA)</li>
        <li>
          Sector-specific legislation governing licence- and
          permit-controlled categories of goods offered on the Platform,
          together with the statutory registers, prescribed forms and
          transfer records kept under it — that legislation is identified by
          name in our{' '}
          <a href="/regulated-categories" style={{ color: 'var(--red)' }}>
            Regulated Categories &mdash; Statutory Schedule
          </a>
        </li>
        <li>Consumer Protection Act 68 of 2008</li>
        <li>Electronic Communications and Transactions Act 25 of 2002</li>
        <li>Income Tax Act 58 of 1962 and the Tax Administration Act 28 of 2011</li>
        <li>Labour and employment legislation (including the Basic Conditions of Employment Act 75 of 1997)</li>
      </ul>
      <p>
        Records kept under these laws are made available in accordance
        with the relevant Act and, where a request falls under PAIA, in
        accordance with this manual. The category-specific legislation, and
        the categories of records we keep under it, are identified in our{' '}
        <a href="/regulated-categories" style={{ color: 'var(--red)' }}>
          Regulated Categories &mdash; Statutory Schedule
        </a>
        , which forms part of this manual and is available to any requester
        free of charge, without registration and without an account.
        Registered members are additionally subject to the operational terms
        of the{' '}
        <a href="/members/regulated-items" style={{ color: 'var(--red)' }}>
          Regulated Items Annex
        </a>{' '}
        in their account; that annex is a convenience for members and is not
        the source of any record category identified in this manual.
      </p>

      <h2>6. How to request access to a record</h2>
      <ol>
        <li>
          Complete the prescribed request form for access to a record of
          a private body. The form is obtainable from the Information
          Regulator's website, or from our Information Officer on
          request.
        </li>
        <li>
          Submit the completed form to the Information Officer at the
          email or postal address in section 2. Provide enough detail to
          identify the record and the form of access you require, the
          right you are seeking to exercise or protect, and how you wish
          to be notified of our decision.
        </li>
        <li>
          Pay the <strong>prescribed request fee</strong> set out in the
          PAIA regulations. Where a request is granted, a further{' '}
          <strong>prescribed access fee</strong> (covering the
          reproduction, search and preparation of the record, and where
          applicable postage) may be payable before the record is made
          available. We will notify you of any access fee before
          proceeding.
        </li>
        <li>
          The Information Officer will decide on your request within the
          statutory period — <strong>30 days</strong> after the request
          is received — and will notify you of the decision. That period
          may be extended in the limited circumstances allowed by the
          Act, in which case we will tell you.
        </li>
      </ol>
      <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
        The exact amounts of the request and access fees are those
        prescribed in the regulations made under PAIA and are updated
        from time to time by the Minister; we apply the prescribed fee
        current at the time of your request.
      </p>

      <h2>7. Grounds on which a request may be refused</h2>
      <p>
        Access to a record may be refused on the grounds set out in
        Chapter 4 of Part 3 of PAIA. In summary, we must or may refuse
        access where granting it would involve:
      </p>
      <ul>
        <li>the unreasonable disclosure of personal information about a third party who is a natural person (including a deceased person);</li>
        <li>the disclosure of commercial information of a third party, such as trade secrets or financial, commercial, scientific or technical information that could harm their interests;</li>
        <li>a breach of a duty of confidence owed to a third party;</li>
        <li>a risk to the safety of an individual or to the protection of property;</li>
        <li>the disclosure of a record that is privileged from production in legal proceedings;</li>
        <li>the disclosure of commercial or confidential information of All Outdoor itself, including our own trade secrets and financial or technical information; or</li>
        <li>the disclosure of protected research information of a third party or of All Outdoor.</li>
      </ul>
      <p>
        Where only part of a record may be refused, we will grant access
        to the remainder to the extent that it can reasonably be
        severed.
      </p>

      <h2>8. Remedies</h2>
      <p>
        If your request is refused, or you are dissatisfied with a
        decision of the Information Officer, you may lodge a complaint
        with the Information Regulator or apply to a court, within the
        periods and on the grounds provided for in PAIA. Details of these
        remedies are set out in the Act and in the Information
        Regulator's section 10 guide.
      </p>

      <h2>9. Information Regulator contact details</h2>
      <p>
        The Information Regulator is the body responsible for PAIA. You
        may contact it as follows:
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
        Email:{' '}
        <a href="mailto:enquiries@inforegulator.org.za" style={{ color: 'var(--red)' }}>
          enquiries@inforegulator.org.za
        </a>
        <br />
        Web:{' '}
        <a href="https://inforegulator.org.za/" target="_blank" rel="noopener" style={{ color: 'var(--red)' }}>
          inforegulator.org.za
        </a>
      </p>

      <h2>10. Availability of this manual</h2>
      <p>
        This manual is available free of charge on our website and, on
        request, from the Information Officer. We review and update it
        as required. The "last updated" date at the top of this page
        indicates when the current version came into force.
      </p>
    </>
  );
}
