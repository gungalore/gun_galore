// /regulated-categories — public statutory schedule.
//
// Why this page exists, and why it is public but not indexed:
//
//   POPIA s 18(1)(f) requires a data subject to be told the PARTICULAR law
//   authorising or requiring the collection of their personal information,
//   and s 11(1)(c) requires an IDENTIFIED legal obligation. The processing
//   at issue is the retention of a national identifier (the SA ID number)
//   and of licence/competency particulars. An unnamed statute cannot carry
//   either requirement.
//
//   PAIA s 51 requires the section 51 manual to be complete and available
//   free of charge to ANY requester. A journalist, a regulator, or a person
//   whose personal information sits in a transfer record but who has no
//   account cannot read a login-gated annex. So the named citation and the
//   record categories must live somewhere reachable without signing in.
//
// The members-only Regulated Items Annex remains the full operational
// document; this schedule is the public citation of record. It carries
// `robots: { index: false, follow: false }` and is deliberately NOT listed
// in app/sitemap.ts — publicly REACHABLE (which is what the law requires)
// without being indexed. Keep it purely legal in register: no commercial
// or product framing, no listings, no calls to action.
//
// The Act's name is confined to the body prose of this page and to the
// minimum citations in /privacy and /paia. It must never appear in a
// <title>, a meta description, a heading, or the footer.

import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'Regulated Categories — Statutory Schedule',
  description:
    'Statutory schedule identifying the legislation under which ALLOUTDOOR (PTY) LTD keeps records for regulated categories, and the categories of those records.',
  robots: { index: false, follow: false },
};

const linkStyle = { color: 'var(--red)' };

export default function RegulatedCategoriesSchedulePage() {
  return (
    <>
      <LegalDocHeader
        title="Regulated Categories — Statutory Schedule"
        lastUpdated="Effective 11 August 2026"
      />

      <p>
        This schedule is published by <strong>ALLOUTDOOR (PTY) LTD</strong>{' '}
        ("<strong>All Outdoor</strong>") as a supplement to our{' '}
        <a href="/privacy" style={linkStyle}>
          Privacy Policy
        </a>{' '}
        and our{' '}
        <a href="/paia" style={linkStyle}>
          PAIA Manual
        </a>
        . It identifies the particular legislation under which we collect and
        retain personal information, and keep records, for the regulated
        categories of goods traded on the Platform, and it lists the categories
        of those records.
      </p>
      <p>
        It is published so that this information is available to any person,
        free of charge and without an account, as required by section 51 of the
        Promotion of Access to Information Act 2 of 2000 and by sections
        11(1)(c) and 18(1)(f) of the Protection of Personal Information Act 4 of
        2013.
      </p>

      <h2>1. Legislation identified</h2>
      <p>
        The legislation referred to in our Privacy Policy and PAIA Manual as the
        sector-specific legislation governing licence- and permit-controlled
        categories is the <strong>Firearms Control Act 60 of 2000</strong>{' '}
        together with the <strong>Firearms Control Regulations, 2004</strong>{' '}
        made under it.
      </p>
      <p>
        That Act and those regulations are the identified legal obligation on
        which we rely under section 11(1)(c) of POPIA, and the particular law of
        which you are notified under section 18(1)(f) of POPIA, in respect of
        the processing described in section 3 below.
      </p>
      <p>
        The following legislation continues to apply in addition, as set out in
        the PAIA Manual: the Companies Act 71 of 2008; the Protection of
        Personal Information Act 4 of 2013; the Financial Intelligence Centre
        Act 38 of 2001; the Consumer Protection Act 68 of 2008; the Electronic
        Communications and Transactions Act 25 of 2002; the Income Tax Act 58 of
        1962 and the Tax Administration Act 28 of 2011; and labour and
        employment legislation.
      </p>

      <h2>2. Categories of records kept under that legislation</h2>
      <p>
        In addition to the categories of records listed in section 4 of our
        PAIA Manual, we hold the following categories of records under the
        legislation identified in section 1:
      </p>
      <ul>
        <li>
          the licence, permit and competency particulars supplied by the parties
          to a transaction;
        </li>
        <li>item identifiers, including serial numbers;</li>
        <li>
          the particulars of the authorised third party at which an item is held
          or through which it is handed over, and the records of transfers
          completed through that third party;
        </li>
        <li>
          completed prescribed statutory forms required by that Act and those
          regulations, and our correspondence and audit records relating to
          them; and
        </li>
        <li>
          the registers kept in connection with those transfers, and the
          notifications made to a competent authority in respect of them.
        </li>
      </ul>
      <p>
        Access to these records is subject to the request procedure, the
        prescribed request and access fees, the statutory 30-day decision
        period, and the grounds for refusal set out in our{' '}
        <a href="/paia" style={linkStyle}>
          PAIA Manual
        </a>
        , and to any restriction imposed by the legislation identified above.
      </p>

      <h2>3. Personal information processed under that legislation</h2>
      <p>
        The personal information we collect or retain in order to meet the
        obligations imposed by the legislation identified in section 1 is:
      </p>
      <ul>
        <li>
          the South African identity number of a seller, retained encrypted at
          rest, because that number must be reproduced on a prescribed statutory
          form completed in connection with a transfer;
        </li>
        <li>
          the full name and date of birth confirmed during identity
          verification;
        </li>
        <li>
          the licence, permit and competency particulars of the parties to a
          transfer; and
        </li>
        <li>
          the particulars of the authorised third party at which an item is held
          or through which it is handed over.
        </li>
      </ul>
      <p>
        Where a prescribed statutory record has been completed, the related
        personal information is retained for the period that the legislation
        identified above requires that record to be kept. Retention periods are
        set out in section 9 of our{' '}
        <a href="/privacy" style={linkStyle}>
          Privacy Policy
        </a>
        .
      </p>

      <h2>4. Your rights, and how to reach us</h2>
      <p>
        Your rights under sections 23 to 25 of POPIA, and your right of access
        under PAIA, apply to the records described in this schedule and are
        exercised through the Information Officer identified in our{' '}
        <a href="/privacy" style={linkStyle}>
          Privacy Policy
        </a>{' '}
        and{' '}
        <a href="/paia" style={linkStyle}>
          PAIA Manual
        </a>
        . You may also lodge a complaint with the Information Regulator, whose
        contact details appear in both of those documents.
      </p>
      <p>
        Registered members are additionally subject to the operational terms in
        the Regulated Items Annex available in their account. Nothing in that
        annex limits, replaces or qualifies this schedule; where the two differ
        on a matter dealt with here, this schedule is the public statement of
        record.
      </p>
    </>
  );
}
