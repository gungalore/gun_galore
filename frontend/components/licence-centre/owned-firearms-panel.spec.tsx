// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import OwnedFirearmsPanel from './owned-firearms-panel';
import type { IntakeOwnedFirearm } from '@/lib/motivations-api';

// ────────────────────────────────────────────────────────────────────
// THE OWNED-FIREARMS STEP'S OPENING PANEL.
//
// ⚠️ IT IS A CORRECTION PANEL. The operator's live test walked into the owned
// firearms step and was asked to type Make/Model/Calibre/Serial from scratch
// while the licence card was already in the vault. Showing those rows first, with
// where they came from and a reason to add the licence photo, is the fix.
// ────────────────────────────────────────────────────────────────────

const firearms: IntakeOwnedFirearm[] = [
  {
    index: 1,
    make: 'GLOCK',
    model: '19',
    calibre: '9MM PARABELLUM',
    serial: 'ABC123',
  },
  // A partly-read card: the line must show what we have and dashes for the rest.
  { index: 2, make: 'MAUSER' },
];

describe('the owned firearms panel', () => {
  it('lists each firearm as MAKE · MODEL · CALIBRE · SERIAL from the vault', () => {
    render(
      <OwnedFirearmsPanel firearms={firearms} outputMode="MOTIVATION_ONLY" />,
    );
    expect(
      screen.getByText('GLOCK · 19 · 9MM PARABELLUM · ABC123'),
    ).toBeDefined();
    expect(screen.getByText('MAUSER · — · — · —')).toBeDefined();
    expect(screen.getByText('from your Document Vault')).toBeDefined();
    expect(
      screen.getByText('Firearms we can see on your documents'),
    ).toBeDefined();
  });

  it('asks for the count when nothing was read from a document', () => {
    render(<OwnedFirearmsPanel firearms={[]} outputMode="MOTIVATION_ONLY" />);
    expect(
      screen.getByText(/haven’t found a firearm licence in your documents yet/i),
    ).toBeDefined();
    expect(screen.queryByText('from your Document Vault')).toBeNull();
  });

  it('copes with the contract field being absent while the backend lands', () => {
    render(<OwnedFirearmsPanel firearms={undefined} outputMode={undefined} />);
    expect(
      screen.getByText(/haven’t found a firearm licence in your documents yet/i),
    ).toBeDefined();
  });

  it('asks for a licence photo for a print-ready pack', () => {
    render(<OwnedFirearmsPanel firearms={firearms} outputMode="PRINT_READY" />);
    expect(
      screen.getByText(/For a print-ready pack we need a photo or scan of each/i),
    ).toBeDefined();
  });

  it('says the details are enough for a motivation-only draft', () => {
    render(
      <OwnedFirearmsPanel firearms={firearms} outputMode="MOTIVATION_ONLY" />,
    );
    expect(
      screen.getByText('For a motivation-only draft these details are enough.'),
    ).toBeDefined();
  });
});
