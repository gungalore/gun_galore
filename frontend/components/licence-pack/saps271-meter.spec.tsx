// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Saps271Meter from './saps271-meter';
import type { Saps271Coverage } from '@/lib/motivations-api';

// ────────────────────────────────────────────────────────────────────
// THE PANEL DOES NOT NAME A FORM THIS APPLICATION DOES NOT USE.
//
// ⚠️ IT SAID "SAPS 271 — WHAT IS FILLED" ON EVERY STEP OF A RENEWAL. A section
// 24 renewal is lodged on the SAPS 518(a); the 271 is an application for a NEW
// licence under sections 13 to 20, and the backend throws outright if asked to
// fill one for a renewal. The member was being shown a running score against a
// form nobody was going to complete for them.
//
// The sections it counts are real either way, so the meter keeps counting and
// stops claiming the form.
// ────────────────────────────────────────────────────────────────────

const coverage: Saps271Coverage = {
  percent: 44,
  applicable: 9,
  answered: 4,
  sections: [
    {
      id: 'E',
      label: 'The firearm',
      applicable: 6,
      answered: 0,
      percent: 0,
      missingRequired: 6,
      status: 'not-started',
    },
  ],
};

describe('⚠️ the form named on a renewal', () => {
  it('does not call a renewal a SAPS 271', () => {
    render(<Saps271Meter coverage={coverage} licenceType="S24_RENEWAL" />);
    expect(screen.queryByText(/SAPS 271 — what is filled/)).toBeNull();
    expect(screen.getByText(/Your application — what is filled/)).toBeTruthy();
    expect(screen.getByText(/SAPS 518\(a\)/)).toBeTruthy();
  });

  it('still names the 271 on an application that uses one', () => {
    render(<Saps271Meter coverage={coverage} licenceType="S13_SELF_DEFENCE" />);
    expect(screen.getByText(/SAPS 271 — what is filled/)).toBeTruthy();
  });

  it('keeps the old heading for a caller that does not say', () => {
    render(<Saps271Meter coverage={coverage} />);
    expect(screen.getByText(/SAPS 271 — what is filled/)).toBeTruthy();
  });

  it('counts the same sections either way', () => {
    const { unmount } = render(
      <Saps271Meter coverage={coverage} licenceType="S24_RENEWAL" />,
    );
    expect(screen.getByText('The firearm')).toBeTruthy();
    expect(screen.getByText('44%')).toBeTruthy();
    unmount();
  });
});
