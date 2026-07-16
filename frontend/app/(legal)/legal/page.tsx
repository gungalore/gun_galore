// /legal — index of every legal document, plus the full ECT § 43
// disclosure block. Linked from the site footer. The point of this
// page is to give regulators, lawyers, journalists and curious users
// one URL where the entire compliance posture is visible.

import Link from 'next/link';
import { LegalDocHeader } from '../legal-frame';

export const metadata = {
  title: 'Legal',
  description:
    'All GunGalore legal documents and statutory disclosures in one place.',
};

const DOCS: { href: string; title: string; description: string }[] = [
  {
    href: '/terms',
    title: 'Terms of Service',
    description:
      'The master contract governing your use of the GunGalore platform.',
  },
  {
    href: '/privacy',
    title: 'Privacy Policy',
    description:
      'How we collect, use, share and protect your personal information under POPIA.',
  },
  {
    href: '/acceptable-use',
    title: 'Acceptable Use Policy',
    description:
      'What you may and may not list, post or do on GunGalore — and how we enforce it.',
  },
  {
    href: '/refund-policy',
    title: 'Refund & Dispute Policy',
    description:
      'When refunds happen, how disputes are reviewed, and your statutory rights under the CPA.',
  },
  {
    href: '/firearms-compliance',
    title: 'Regulated Items & Compliance',
    description:
      'Our role and your obligations for licence- and age-restricted categories, including firearms under the Firearms Control Act 60 of 2000.',
  },
  {
    href: '/aml-policy',
    title: 'AML Policy',
    description:
      'Our anti-money-laundering posture and the FICA-aligned controls we apply across the marketplace.',
  },
  {
    href: '/cookies',
    title: 'Cookie Policy',
    description:
      'What cookies we set, why, and how to manage them.',
  },
  {
    href: '/paia',
    title: 'PAIA Manual',
    description:
      'Our manual under the Promotion of Access to Information Act 2 of 2000, and how to request records we hold.',
  },
  {
    href: '/fees',
    title: 'Fees & Charges',
    description:
      'The fees we charge buyers and sellers, when they apply, and how they are calculated.',
  },
  {
    href: '/how-payments-work',
    title: 'How Payments Work',
    description:
      'How your money moves from checkout to payout, including funds held until delivery is confirmed.',
  },
  {
    href: '/contact',
    title: 'Contact',
    description:
      'How to reach us for support, complaints and legal notices.',
  },
  {
    href: '/complaints',
    title: 'Complaints',
    description:
      'How to raise a complaint, what to expect from us, and how to escalate it externally.',
  },
];

export default function LegalIndexPage() {
  return (
    <>
      <LegalDocHeader title="Legal & compliance" lastUpdated="Effective 16 July 2026" />

      <p>
        This page collects every legal document and statutory
        disclosure that applies to GunGalore (Pty) Ltd. Each document
        is binding to the extent set out in its own text; together
        they form the legal framework of the Platform.
      </p>

      <h2>Documents</h2>
      <div className="space-y-3" style={{ marginBottom: 32 }}>
        {DOCS.map((d) => (
          <Link
            key={d.href}
            href={d.href}
            className="block rounded-[8px] p-4"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
              textDecoration: 'none',
            }}
          >
            <p
              style={{
                color: 'var(--text-primary)',
                fontWeight: 500,
                marginBottom: 4,
              }}
            >
              {d.title}
            </p>
            <p
              style={{
                color: 'var(--text-tertiary)',
                fontSize: 13,
                margin: 0,
              }}
            >
              {d.description}
            </p>
          </Link>
        ))}
      </div>

      <h2>ECT Act § 43 disclosures</h2>
      <p>
        In compliance with Section 43 of the Electronic Communications
        and Transactions Act 25 of 2002:
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
          <strong>Physical address:</strong> 36 Sterappel Crescent,
          Langeberg Glen, Cape Town, 7570, South Africa
          <br />
          <strong>Email:</strong>{' '}
          <a href="mailto:support@gungalore.co.za" style={{ color: 'var(--red)' }}>
            support@gungalore.co.za
          </a>
          <br />
          <strong>Phone:</strong> +27 74 303 9999
          <br />
          <strong>VAT registration:</strong> Not yet registered for VAT
          <br />
          <strong>Membership of self-regulatory bodies:</strong> None at this time
          <br />
          <strong>Information Officer (POPIA):</strong> Gerhard Johan Petrus Fourie ·{' '}
          <a href="mailto:support@gungalore.co.za" style={{ color: 'var(--red)' }}>
            support@gungalore.co.za
          </a>
        </p>
      </div>

      <h2>Complaints handling</h2>
      <p>
        We aim to acknowledge complaints within <strong>2 business
        days</strong> and resolve them within <strong>14 business
        days</strong>. If we cannot resolve a complaint to your
        satisfaction, you may escalate it to one of the following
        external bodies, depending on the subject matter:
      </p>
      <ul>
        <li>Privacy / personal information: the{' '}
          <a href="https://inforegulator.org.za/" target="_blank" rel="noopener" style={{ color: 'var(--red)' }}>
            Information Regulator
          </a>
        </li>
        <li>Consumer dispute (CPA): the National Consumer Commission or the Consumer Goods and Services Ombud</li>
        <li>Payment-related: the{' '}
          <a href="https://www.nfosa.co.za/" target="_blank" rel="noopener" style={{ color: 'var(--red)' }}>
            National Financial Ombud
          </a>{' '}
          or your card issuer's dispute process</li>
        <li>Firearms-related: the South African Police Service (SAPS)</li>
      </ul>
    </>
  );
}
