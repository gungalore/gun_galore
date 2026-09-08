// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CredentialPair from './credential-pair';
import type { SheetCredentials } from './contract';

// ────────────────────────────────────────────────────────────────────
// THE SECTION THE OPERATOR ASKED FOR THREE TIMES.
//
// "The correct proficiencies needs to be added as well from the license centre
// or scanned or uploaded"; "it should also scan to see which fire arm is added
// to add the correct competency and proficiency"; and finally, "there still is
// no proficiency section with the links I asked for twice already, why???"
//
// The first two were answered in motivation-autolink — a rule with no surface.
// What is asserted here is the surface: that the word "proficiency" is on the
// screen, and that each half of the pair has somewhere to go.
// ────────────────────────────────────────────────────────────────────

const slot = (
  kind: 'COMPETENCY_CERTIFICATE' | 'PROFICIENCY_CERTIFICATE',
  over: Partial<SheetCredentials['competency']> = {},
): SheetCredentials['competency'] => ({
  kind,
  label:
    kind === 'COMPETENCY_CERTIFICATE'
      ? 'SAPS competency certificate'
      : 'Proficiency — statement of results',
  blurb: 'What it is for.',
  held: [],
  inCentre: 0,
  ...over,
});

const credentials = (over: Partial<SheetCredentials> = {}): SheetCredentials => ({
  neededLabel: 'Handgun',
  competency: slot('COMPETENCY_CERTIFICATE'),
  proficiency: slot('PROFICIENCY_CERTIFICATE'),
  knowledge: { state: 'CONFIRMED', alert: null },
  pairNote: null,
  ...over,
});

function mount(over: Partial<SheetCredentials> = {}) {
  const onScan = vi.fn();
  const onUpload = vi.fn();
  const onAddFromCentre = vi.fn();
  render(
    <CredentialPair
      credentials={credentials(over)}
      onScan={onScan}
      onUpload={onUpload}
      onAddFromCentre={onAddFromCentre}
    />,
  );
  return { onScan, onUpload, onAddFromCentre };
}

describe('the links', () => {
  it('⚠️ OFFERS SCAN AND UPLOAD ON BOTH HALVES OF THE PAIR', () => {
    mount();
    expect(screen.getAllByText('Scan it')).toHaveLength(2);
    expect(screen.getAllByText('Upload a file')).toHaveLength(2);
  });

  it('⚠️ DOES NOT DRAW THE LICENCE CENTRE DOOR ONTO AN EMPTY LIST', () => {
    // A disabled control over nothing is what made the operator ask for this
    // three times while looking straight at the place it was meant to be.
    mount();
    expect(screen.queryByText(/Add from your Licence Centre/)).toBeNull();
  });

  it('draws it, with the count, once the Centre holds something', () => {
    mount({ proficiency: slot('PROFICIENCY_CERTIFICATE', { inCentre: 2 }) });
    const button = screen.getByText(/Add from your Licence Centre/);
    expect(button.textContent).toContain('2');
  });

  it('⚠️ AND OFFERS NOTHING AT ALL ONCE THE DOCUMENT IS IN THE PACK', () => {
    // Asking somebody to photograph a page we already hold is the duplicate
    // problem the reuse picker exists to remove, arriving from the other side.
    mount({
      competency: slot('COMPETENCY_CERTIFICATE', {
        held: [{ letter: 'C', origin: 'vault', unread: false }],
        inCentre: 3,
      }),
    });
    expect(screen.getAllByText('Scan it')).toHaveLength(1);
    expect(screen.getByText('Annexure C')).toBeTruthy();
    expect(screen.getByText('from your Licence Centre')).toBeTruthy();
  });
});

describe('what it says', () => {
  it('⚠️ NAMES THE PROFICIENCY, because that is the word being looked for', () => {
    mount();
    expect(screen.getByText(/Proficiency/)).toBeTruthy();
  });

  it('names the class the application needs', () => {
    mount();
    expect(screen.getByText('Handgun')).toBeTruthy();
  });

  it('says nothing about a class we cannot name', () => {
    mount({ neededLabel: null });
    expect(screen.queryByText('Handgun')).toBeNull();
  });

  it('renders the pair note when the server sends one', () => {
    mount({ pairNote: 'SAPS will want the statement of results as well.' });
    expect(
      screen.getByText('SAPS will want the statement of results as well.'),
    ).toBeTruthy();
  });

  it('⚠️ SAYS NOTHING ABOUT 117705 WHEN WE HAVE SEEN IT', () => {
    // The alert is an alert. Rendering a confirmation of it on every load is
    // one more line between the member and the two buttons.
    mount({ knowledge: { state: 'CONFIRMED', alert: 'All good.' } });
    expect(screen.queryByText('All good.')).toBeNull();
  });

  it('raises it when it is genuinely absent', () => {
    mount({ knowledge: { state: 'MISSING', alert: 'We cannot see 117705.' } });
    expect(screen.getByText('We cannot see 117705.')).toBeTruthy();
  });
});
