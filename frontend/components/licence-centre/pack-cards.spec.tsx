// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PackSummary from './pack-summary';
import CompetencyLines from './competency-lines';
import { filled, needsYou } from './__fixtures__/sheet.fixture';
import type { Saps271Coverage } from '@/lib/motivations-api';

// ConsentCard wraps MotivationSellerConsent, which calls useAuth(). Same mock
// the Bench specs use — see components/bench/BulletPicker.spec.tsx.
vi.mock('@clerk/nextjs', () => {
  const getToken = async () => 'test-token';
  return { useAuth: () => ({ getToken, isLoaded: true, isSignedIn: true }) };
});

// ────────────────────────────────────────────────────────────────────
// THE THREE CARDS THAT SIT BESIDE THE ROWS.
// ────────────────────────────────────────────────────────────────────

// ⚠️ THE SHAPE THE SERVER ACTUALLY SENDS. This fixture invented `key`,
// `total` and `done`; saps271-coverage.ts emits `id`, `applicable`, `answered`,
// `percent`, `status`, `note` and `missingRequired`, and Saps271Meter reads
// those. A fixture that agrees with nothing is a test that proves nothing —
// and the same invented names had been copied into the page, where
// `sellerSigned` read `c.key`/`c.done` and could only ever be false.
const coverage = {
  sections: [
    {
      id: 'D',
      label: 'Type of application',
      applicable: 2,
      answered: 2,
      percent: 100,
      missingRequired: 0,
      status: 'complete',
    },
    {
      id: 'F',
      label: 'Current owner',
      applicable: 0,
      answered: 0,
      percent: null,
      missingRequired: 0,
      status: 'theirs',
      note: 'Waiting on the seller. Nothing for you to do.',
    },
    {
      id: 'G',
      label: 'The applicant',
      applicable: 20,
      answered: 18,
      percent: 90,
      missingRequired: 2,
      status: 'partial',
    },
  ],
  applicable: 22,
  answered: 20,
  percent: 91,
} as unknown as Saps271Coverage;

describe('PackSummary — Part F is not the applicant’s work', () => {
  it('⚠️ NAMES THE ROUTE, NEVER SCORES THE APPLICANT ON IT', () => {
    // Part F is the CURRENT OWNER's half. Scoring it against the applicant
    // says they are behind on something that was never theirs.
    render(
      <PackSummary
        coverage={coverage}
        licenceType="S16_DEDICATED_SPORT"
        sourceRoute="dealer"
        needs={[]}
      />,
    );
    expect(screen.getByText(/left for your dealer/)).toBeDefined();
    expect(screen.getByText(/SAPS 350\(a\)/)).toBeDefined();
  });

  it('says the seller fills it on a private sale', () => {
    render(
      <PackSummary
        coverage={coverage}
        licenceType="S16_DEDICATED_SPORT"
        sourceRoute="seller"
        needs={[]}
      />,
    );
    expect(screen.getByText(/signed consent/)).toBeDefined();
  });

  it('asks the question rather than guessing when the route is unstated', () => {
    render(
      <PackSummary
        coverage={coverage}
        licenceType="S16_DEDICATED_SPORT"
        sourceRoute="unstated"
        needs={[]}
      />,
    );
    expect(screen.getByText(/Tell us where the firearm is coming from/)).toBeDefined();
  });

  it('⚠️ CLAIMS NO 271 ON A RENEWAL', () => {
    // A section 24 is lodged on the SAPS 518(a) and the backend refuses to
    // render a 271 for one. Naming the wrong form is how somebody arrives at a
    // counter with the wrong paperwork.
    render(
      <PackSummary
        coverage={coverage}
        licenceType="S24_RENEWAL"
        sourceRoute="dealer"
        needs={[]}
      />,
    );
    // ⚠️ getAllByText, NOT getByText — the meter ALSO names the 518(a) for a
    // renewal, which is the meter doing its own job correctly. What this case
    // is really about is that the dealer line does not appear.
    expect(screen.getAllByText(/518\(a\)/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain('left for your dealer');
  });

  it('⚠️ NEVER CALLS AN "expected" DOCUMENT OPTIONAL', () => {
    // The tier exists because two tiers could not tell the truth: there is no
    // statute behind it, and you are not getting in without it.
    render(
      <PackSummary
        coverage={coverage}
        licenceType="S16_DEDICATED_SPORT"
        sourceRoute="dealer"
        needs={[
          { kind: 'A', label: 'Proof of address', tier: 'expected', have: false },
          { kind: 'B', label: 'Range record', tier: 'strengthens', have: false },
        ]}
      />,
    );
    expect(screen.getByText('they will ask for this')).toBeDefined();
    expect(screen.getByText('helps, not required')).toBeDefined();
    expect(document.body.textContent).not.toContain('optional');
  });
});

describe('CompetencyLines — one line per certificate', () => {
  const cert = filled({
    key: 'competency_number',
    label: 'Competency certificate',
    value: 'SAPS 524/12345',
  });

  it('shows the certificate and where it came from, and nothing else', () => {
    render(
      <CompetencyLines
        items={[cert]}
        covered
        onAdd={vi.fn()}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('SAPS 524/12345')).toBeDefined();
    expect(screen.getByText(/covers the firearm you are applying for/)).toBeDefined();
  });

  it('⚠️ OFFERS NO UPLOAD DOOR WHEN THE VAULT ALREADY COVERS IT', () => {
    // Offering a scanner to somebody whose competency we have read is asking
    // them to redo work we did for them.
    render(
      <CompetencyLines
        items={[cert]}
        covered
        onAdd={vi.fn()}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Add your competency certificate/)).toBeNull();
  });

  it('offers one, in gold not red, when it does not', () => {
    render(
      <CompetencyLines
        items={[cert]}
        covered={false}
        missingEndorsement="No certificate covers a semi-auto rifle yet."
        onAdd={vi.fn()}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('No certificate covers a semi-auto rifle yet.')).toBeDefined();
    expect(screen.getByText(/Add your competency certificate/)).toBeDefined();
  });
});

// ⚠️ OverlapCard IS GONE. It rendered `overlap_angle` near the top of the
// firearm section with its own copy of the tiles, writing the same key, while
// the registry row rendered them again lower down — one question, two headings,
// and the operator could not tell them apart: "There is two What this one will
// be. One at the bottom and one that pops up."
//
// The registry row won: it is the only one with the own-words box and the only
// one that sits where the section says it should. Its prompt moved onto
// CardsRow, and the rule this component carried — "renders nothing when the
// verdict is clear", so nobody is asked why they want this one AS WELL when
// they hold nothing — moved to motivation-sheet.service.ts's stateOf, which is
// the only visibility decision in the system.

describe('gate (c) — the private-sale variant', () => {
  it('⚠️ THE PART F LINE CHANGES ONCE THE SELLER SIGNS', async () => {
    const ConsentCard = (await import('./consent-card')).default;
    const { rerender } = render(
      <ConsentCard
        motivationId="mo-1"
        applicantName="Johan Pretorius"
        firearm={{ make: 'CZ' }}
        signed={false}
      />,
    );
    expect(screen.getByText(/When they sign, Part F/)).toBeDefined();

    rerender(
      <ConsentCard
        motivationId="mo-1"
        applicantName="Johan Pretorius"
        firearm={{ make: 'CZ' }}
        signed
      />,
    );
    expect(screen.getByText(/Signed\. Part F/)).toBeDefined();
  });

  it('never blames the applicant for a signature they cannot hurry', async () => {
    const ConsentCard = (await import('./consent-card')).default;
    render(
      <ConsentCard
        motivationId="mo-1"
        applicantName="Johan Pretorius"
        firearm={{ make: 'CZ' }}
        signed={false}
      />,
    );
    const text = (document.body.textContent ?? '').toLowerCase();
    for (const word of ['outstanding', 'still needed', 'overdue']) {
      expect(text).not.toContain(word);
    }
  });
});
