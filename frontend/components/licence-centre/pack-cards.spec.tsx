// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PackSummary from './pack-summary';
import CompetencyLines from './competency-lines';
import { filled, needsYou } from './__fixtures__/sheet.fixture';

// ConsentCard wraps MotivationSellerConsent, which calls useAuth(). Same mock
// the Bench specs use — see components/bench/BulletPicker.spec.tsx.
vi.mock('../../lib/auth', () => {
  const getToken = async () => 'test-token';
  return { useAuth: () => ({ getToken, isLoaded: true, isSignedIn: true }) };
});

// ────────────────────────────────────────────────────────────────────
// THE THREE CARDS THAT SIT BESIDE THE ROWS.
// ────────────────────────────────────────────────────────────────────

describe('PackSummary — what the pack holds', () => {
  it('says the pack is the motivation with the documents behind it', () => {
    render(<PackSummary licenceType="S16_DEDICATED_SPORT" needs={[]} />);
    expect(
      screen.getByText(/with a copy of every document we hold/i),
    ).toBeDefined();
  });

  // ⚠️ A RENEWAL IS LODGED ON THE 518(a), NOT A FORM OF OURS. Naming the wrong
  // paperwork is how somebody arrives at a counter with the wrong file.
  it('⚠️ NEVER CLAIMS A 271 ON A RENEWAL', () => {
    render(<PackSummary licenceType="S24_RENEWAL" needs={[]} />);
    expect(screen.getByText(/SAPS 518\(a\)/)).toBeDefined();
    expect(document.body.textContent).not.toContain('271');
  });

  it('says how many answers are still outstanding', () => {
    render(
      <PackSummary licenceType="S16_DEDICATED_SPORT" needs={[]} outstanding={2} />,
    );
    expect(screen.getByText(/2 answers are still outstanding/i)).toBeDefined();
  });

  it('⚠️ NEVER CALLS AN "expected" DOCUMENT OPTIONAL', () => {
    // The tier exists because two tiers could not tell the truth: there is no
    // statute behind it, and you are not getting in without it.
    render(
      <PackSummary
        licenceType="S16_DEDICATED_SPORT"
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
  it('⚠️ THE CONSENT LINE CHANGES ONCE THE SELLER SIGNS', async () => {
    const ConsentCard = (await import('./consent-card')).default;
    const { rerender } = render(
      <ConsentCard
        motivationId="mo-1"
        applicantName="Johan Pretorius"
        firearm={{ make: 'CZ' }}
        signed={false}
      />,
    );
    expect(screen.getByText(/When they sign, their signed page/)).toBeDefined();

    rerender(
      <ConsentCard
        motivationId="mo-1"
        applicantName="Johan Pretorius"
        firearm={{ make: 'CZ' }}
        signed
      />,
    );
    expect(screen.getByText(/Signed\. Their signed page/)).toBeDefined();
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
