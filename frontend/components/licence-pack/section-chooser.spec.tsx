// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SectionChooser from './section-chooser';
import { LICENCE_TYPES, type LicenceTypeOption } from '@/lib/licence-labels';

// ────────────────────────────────────────────────────────────────────
// THE ONE DOOR INTO AN APPLICATION.
//
// This used to be five cards on the Motivation Centre, where the beta-cap
// message rendered BELOW them and well under the fold — so a member whose
// click 409'd saw nothing happen and had no way to find out why. That bug is
// the reason three of these assertions exist.
// ────────────────────────────────────────────────────────────────────

const base = {
  canStart: true,
  busy: null,
  error: null,
  onChoose: vi.fn(),
};

/**
 * The one card for one licence type, found by its WHOLE accessible name.
 *
 * ⚠️ NOT BY THE LABEL ALONE — TWO LABELS ARE NOW PREFIXES OF OTHER TEXT.
 * "Self-defence" is a substring of "Self-defence, restricted firearm" (section
 * 14, added 2026-09-09) and "Section 16" carries two types, so a bare
 * /label/i matched two buttons and threw. The card's accessible name is its
 * three spans run together with no separator — "Section 13" + label + blurb —
 * and matching all three is unique for every type today and for any type added
 * under an existing section later.
 */
const rx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cardFor = (t: LicenceTypeOption) =>
  screen.getByRole('button', {
    name: new RegExp(`^${rx(t.section)}\\s*${rx(t.label)}\\s*${rx(t.blurb)}$`, 'i'),
  });

const typeFor = (value: string) => LICENCE_TYPES.find((t) => t.value === value)!;

describe('what it offers', () => {
  it('one card per licence type, each naming its section', () => {
    render(<SectionChooser {...base} />);
    for (const t of LICENCE_TYPES) {
      const card = cardFor(t);
      expect(card).toBeInTheDocument();
      expect(card.textContent).toContain(t.section);
    }
    expect(screen.getAllByRole('button')).toHaveLength(LICENCE_TYPES.length);
  });

  it('passes the enum value up, not the label', () => {
    // The server validates against the Prisma enum; a label would 400.
    const onChoose = vi.fn();
    render(<SectionChooser {...base} onChoose={onChoose} />);
    return userEvent
      .click(cardFor(typeFor('S13_SELF_DEFENCE')))
      .then(() => expect(onChoose).toHaveBeenCalledWith('S13_SELF_DEFENCE'));
  });

  it('⚠️ OFFERS SECTION 14, which sectionAllows sends people to', () => {
    // `sectionAllows` refuses a semi-automatic rifle or shotgun under section
    // 13 and names section 14 as the way forward. Until 2026-09-09 this list
    // did not offer it, so that refusal was a dead end.
    render(<SectionChooser {...base} />);
    expect(cardFor(typeFor('S14_RESTRICTED_SELF_DEFENCE'))).toBeInTheDocument();
  });

  it('⚠️ SAYS THE CHOICE IS FIXED, WHILE IT IS STILL FREE TO CHANGE', () => {
    // licenceType is written once by create() and no route can change it.
    // Finding that out on step one of a real application means finding out
    // after an MO number has been spent.
    render(<SectionChooser {...base} />);
    expect(screen.getByText(/fixed once the application starts/i)).toBeInTheDocument();
  });
});

describe('⚠️ when the beta is full', () => {
  it('says so ABOVE the cards, not below them', () => {
    const { container } = render(<SectionChooser {...base} canStart={false} />);
    const notice = screen.getByRole('status');
    const firstCard = screen.getAllByRole('button')[0];
    // compareDocumentPosition: FOLLOWING (4) means the card comes after.
    expect(
      notice.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container).toBeTruthy();
  });

  it('disables every card rather than letting the click 409', () => {
    render(<SectionChooser {...base} canStart={false} />);
    for (const b of screen.getAllByRole('button')) {
      expect(b).toBeDisabled();
    }
  });
});

describe('while one is being created', () => {
  it('⚠️ DISABLES ALL OF THEM, NOT JUST THE ONE PRESSED', () => {
    // Creating allocates an MO number and is throttled at five a minute. A
    // second click on a neighbouring card starts an application the member
    // did not mean to start and cannot delete.
    render(<SectionChooser {...base} busy="S13_SELF_DEFENCE" />);
    for (const b of screen.getAllByRole('button')) {
      expect(b).toBeDisabled();
    }
  });

  it('says which one', () => {
    render(<SectionChooser {...base} busy="S13_SELF_DEFENCE" />);
    expect(screen.getByText(/starting…/i)).toBeInTheDocument();
  });
});

describe('when it fails', () => {
  it('shows the server message above the cards and keeps them usable', () => {
    render(<SectionChooser {...base} error="The free beta is full for now." />);
    expect(screen.getByRole('alert')).toHaveTextContent(/free beta is full/i);
    // busy is null again after a failure — the member must be able to retry.
    expect(screen.getAllByRole('button')[0]).toBeEnabled();
  });
});
