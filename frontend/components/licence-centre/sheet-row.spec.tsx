// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SheetRow from './sheet-row';
import type { SheetItem } from './contract';
import {
  cardsItem,
  filled,
  needsYou,
  notApplicable,
  ownWordsItem,
  suggested,
} from './__fixtures__/sheet.fixture';

// ────────────────────────────────────────────────────────────────────
// THE ONE ROW COMPONENT, IN ITS FOUR STATES.
//
// ⚠️ THE CASE THAT MATTERS MOST IS "the control is already open". The live
// walkthrough of the screen this replaces found EVERY question rendered as a
// grey row reading "You may know it", with no input visible and a narrow
// invisible button to open one at a time. Seven required answers meant seven
// open-answer-Done cycles. If that ever comes back, it comes back here.
// ────────────────────────────────────────────────────────────────────

describe('needs_you — the control is open, always', () => {
  it('renders an input without anything being clicked first', () => {
    render(<SheetRow item={needsYou()} onChange={vi.fn()} />);
    expect(screen.getByRole('textbox')).toBeDefined();
  });

  it('marks a required empty field, and an optional one differently', () => {
    const { unmount } = render(<SheetRow item={needsYou()} onChange={vi.fn()} />);
    expect(screen.getByText('Still needed')).toBeDefined();
    unmount();

    render(
      <SheetRow item={needsYou({ required: false })} onChange={vi.fn()} />,
    );
    expect(screen.getByText('Optional')).toBeDefined();
  });

  it('⚠️ NEVER SAYS "You may know it" — the placeholder is the answer shape', () => {
    render(<SheetRow item={needsYou()} onChange={vi.fn()} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.placeholder).toBe('9mm Parabellum');
    expect(document.body.textContent).not.toContain('You may know it');
  });

  it('reports every keystroke to the page', async () => {
    const onChange = vi.fn();
    render(<SheetRow item={needsYou()} onChange={onChange} />);
    await userEvent.type(screen.getByRole('textbox'), '9');
    expect(onChange).toHaveBeenCalledWith('9');
  });

  it('renders a select for a choice, with the offered values', () => {
    render(
      <SheetRow
        item={needsYou({ kind: 'choice', choices: ['Rifle', 'Handgun'] })}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('option', { name: 'Handgun' })).toBeDefined();
  });
});

describe('filled — a value we hold, with no task attached', () => {
  it('shows the value and where it came from', () => {
    render(<SheetRow item={filled()} onChange={vi.fn()} />);
    expect(screen.getByText('CZ')).toBeDefined();
    expect(screen.getByText('from your licence card')).toBeDefined();
  });

  it('⚠️ SHOWS THE VALUE IN FULL, NEVER MASKED', () => {
    // The live walkthrough found a full name as "GE••••••••" and an ID as
    // "8905 •••• •••" on the applicant's OWN application — values they were
    // about to sign onto a police form and could not read to check.
    render(
      <SheetRow
        item={filled({
          key: 'id_number',
          label: 'ID number',
          value: '8905125800087',
        })}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('8905125800087')).toBeDefined();
    expect(document.body.textContent).not.toContain('•');
  });

  it('asks for nothing — no Confirm, only Change', () => {
    // The operator's standing rule: fill it in, arm it, let them change it. A
    // value we READ is not a confirmation step we invented.
    render(<SheetRow item={filled()} onChange={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Change' })).toBeDefined();
  });

  it('Change opens the control prefilled, with Done in place of the action', async () => {
    render(<SheetRow item={filled()} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('CZ');
    expect(screen.getByRole('button', { name: 'Done' })).toBeDefined();
  });

  it('shows the profile chip on a profile-scoped row', () => {
    render(
      <SheetRow item={filled({ scope: 'profile' })} onChange={vi.fn()} />,
    );
    expect(screen.getByText('saved to your profile')).toBeDefined();
  });
});

describe('suggested — the one state that asks', () => {
  it('offers Confirm and Change, and flags itself for checking', () => {
    render(
      <SheetRow item={suggested()} onChange={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Change' })).toBeDefined();
    expect(screen.getByText('check this')).toBeDefined();
  });

  it('Confirm accepts the value without opening anything', async () => {
    const onConfirm = vi.fn();
    render(
      <SheetRow item={suggested()} onChange={vi.fn()} onConfirm={onConfirm} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('na — renders nothing at all', () => {
  it('⚠️ IS ABSENT, NOT HIDDEN, NOT DISABLED, NOT GREYED', () => {
    // A field that does not apply is not outstanding work, and showing it as
    // anything at all invites somebody to answer a question about a spouse
    // they do not have.
    const { container } = render(
      <SheetRow item={notApplicable()} onChange={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });
});

describe('cards', () => {
  it('renders one tile per option, none pre-ticked', () => {
    render(<SheetRow item={cardsItem()} onChange={vi.fn()} />);
    const tiles = screen.getAllByRole('button');
    expect(tiles.length).toBeGreaterThanOrEqual(3);
    for (const t of tiles) expect(t.getAttribute('aria-pressed')).toBe('false');
  });

  it('a tap stores the key, in the offered order', async () => {
    const onChange = vi.fn();
    render(<SheetRow item={cardsItem()} onChange={onChange} />);
    await userEvent.click(screen.getByText(/I rent, so I cannot/));
    expect(onChange).toHaveBeenCalledWith('rented');
  });

  it('normalises two taps to the offered order, not the tap order', async () => {
    const onChange = vi.fn();
    render(
      <SheetRow item={cardsItem({ value: 'rented' })} onChange={onChange} />,
    );
    await userEvent.click(screen.getByText(/I regularly travel at night/));
    expect(onChange).toHaveBeenCalledWith('night_travel, rented');
  });

  it('a second tap on a chosen tile clears it', async () => {
    const onChange = vi.fn();
    render(
      <SheetRow item={cardsItem({ value: 'rented' })} onChange={onChange} />,
    );
    await userEvent.click(screen.getByText(/I rent, so I cannot/));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('prefills the own-words box from the tapped sentences', () => {
    render(
      <SheetRow
        item={cardsItem({ value: 'night_travel' })}
        onChange={vi.fn()}
        ownWords={ownWordsItem()}
        onOwnWordsChange={vi.fn()}
      />,
    );
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(ta.value).toContain('I regularly travel at night');
  });

  it("⚠️ STOPS FOLLOWING THE TILES ONCE THE MEMBER TYPES", async () => {
    // Re-joining over their sentence would delete what they wrote. This is the
    // one box on the screen carrying their own voice into a signed document.
    const onOwnWordsChange = vi.fn();
    const { rerender } = render(
      <SheetRow
        item={cardsItem({ value: 'night_travel' })}
        onChange={vi.fn()}
        ownWords={ownWordsItem()}
        onOwnWordsChange={onOwnWordsChange}
      />,
    );
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    await userEvent.clear(ta);
    await userEvent.type(ta, 'My own account.');

    // Another card lands afterwards — the box must not be rewritten.
    rerender(
      <SheetRow
        item={cardsItem({ value: 'night_travel, rented' })}
        onChange={vi.fn()}
        ownWords={ownWordsItem()}
        onOwnWordsChange={onOwnWordsChange}
      />,
    );
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      'My own account.',
    );
  });

  it('keeps what they wrote on an earlier visit', () => {
    render(
      <SheetRow
        item={cardsItem({ value: 'night_travel' })}
        onChange={vi.fn()}
        ownWords={ownWordsItem({ value: 'Written last week.' })}
        onOwnWordsChange={vi.fn()}
      />,
    );
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      'Written last week.',
    );
  });
});

describe('help — shown once, never twice', () => {
  const HELP = 'The manufacturer — Glock, CZ, Tikka, Beretta.';

  it('⚠️ A TEXT ROW PRINTS ITS HELP IN THE BOX, NOT ALSO UNDER IT', () => {
    // The live sheet carried this sentence as the Make field's placeholder AND
    // again as a help line directly beneath it. Serial number did the same.
    render(
      <SheetRow
        item={needsYou({ kind: 'short', label: 'Make', help: HELP })}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByPlaceholderText(HELP)).toBeDefined();
    expect(screen.queryByText(HELP)).toBeNull();
  });

  it('a select keeps its help line, because it has no placeholder to carry it', () => {
    render(
      <SheetRow
        item={needsYou({
          kind: 'choice',
          label: 'Type',
          choices: ['Rifle', 'Shotgun'],
          help: 'Exactly as it appears on the licence.',
        })}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText('Exactly as it appears on the licence.'),
    ).toBeDefined();
  });
});

describe('provenance — the make is not misspelled', () => {
  it('⚠️ RENDERS "from MAUSER .30-06 SPRINGFIELD", NOT "from mAUSER …"', () => {
    render(
      <SheetRow
        item={filled({
          label: 'Make',
          value: 'MAUSER',
          provenance: {
            source: 'READ',
            from: 'MAUSER .30-06 SPRINGFIELD',
            at: '2026-09-01T00:00:00.000Z',
          },
        })}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('from MAUSER .30-06 SPRINGFIELD')).toBeDefined();
  });

  it('still folds a sentence-case source', () => {
    render(
      <SheetRow
        item={filled({
          provenance: {
            source: 'READ',
            from: 'Your account address',
            at: '2026-09-01T00:00:00.000Z',
          },
        })}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('from your account address')).toBeDefined();
  });
});

describe('yesno — buttons, not a text box', () => {
  // ⚠️ SIX OF THESE SHIPPED AS EMPTY TEXT FIELDS. Premises and storage asks
  // "Is there an alarm?", "Do you have armed response?", "Are there burglar
  // bars?", "Are there security gates?", "Do you have the prescribed safe?"
  // and "Is it mounted?" — every one a `yesno` in the registry, every one
  // rendered as a free-text input because Control had no branch for the kind.
  // Declarations never hit it: the page routes that section to DeclarationRow.
  const alarm = (over: Partial<SheetItem> = {}) =>
    needsYou({
      key: 'alarm_present',
      label: 'Is there an alarm?',
      kind: 'yesno',
      choices: ['No', 'Yes'],
      required: false,
      ...over,
    });

  it('⚠️ RENDERS TWO BUTTONS AND NO TEXTBOX', () => {
    render(<SheetRow item={alarm()} onChange={vi.fn()} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Yes' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'No' })).toBeDefined();
  });

  it('answers on a tap', async () => {
    const onChange = vi.fn();
    render(<SheetRow item={alarm()} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(onChange).toHaveBeenCalledWith('Yes');
  });

  it('clears when the chosen one is tapped again, like the declarations pills', async () => {
    const onChange = vi.fn();
    render(
      <SheetRow item={alarm({ value: 'Yes' })} onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('marks the chosen one to a screen reader', () => {
    render(<SheetRow item={alarm({ value: 'No' })} onChange={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: 'No' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });
});

describe('the residential address gets Google’s picker', () => {
  it('⚠️ BEATS THE `long` BRANCH, which is what broke it the first time', () => {
    // residential_address is kind `long`. The key test sat BELOW the textarea
    // branch, so it was never reached: the member got a plain multi-line box
    // and Google was never loaded. A key test that runs after a kind test only
    // catches the kinds nothing else claimed.
    render(
      <SheetRow
        item={needsYou({
          key: 'residential_address',
          label: 'Residential address',
          kind: 'long',
        })}
        onChange={vi.fn()}
      />,
    );
    expect(document.querySelector('textarea')).toBeNull();
    expect(screen.getByRole('textbox')).toBeDefined();
  });

  it('prefills with the address already held, so Change does not blank it', () => {
    render(
      <SheetRow
        item={needsYou({
          key: 'residential_address',
          label: 'Residential address',
          kind: 'long',
          value: '36 Sterappel Crescent, Cape Town',
        })}
        onChange={vi.fn()}
      />,
    );
    expect(
      (screen.getByRole('textbox') as HTMLInputElement).value,
    ).toBe('36 Sterappel Crescent, Cape Town');
  });

  it('⚠️ STAYS A TYPEABLE BOX, so it can be corrected', () => {
    // Operator: "must also use google autofill api and then be editable if
    // necessary." AddressAutocomplete renders a real input and falls back to a
    // plain one when the script cannot load, so a member is never boxed in.
    render(
      <SheetRow
        item={needsYou({ key: 'residential_address', label: 'Residential address' })}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('textbox')).toBeDefined();
  });
});

describe('⚠️ the row stays open while the member types in it', () => {
  // The page merges pending edits back over the server's values, so a keystroke
  // changes `item.value`. The reset effect could not tell that apart from a
  // document read moving the value underneath the editor — so every Change row
  // shut on the first letter. Operator, 2026-09-08: "when I press the first
  // letter to type it closes the type window and I have to click change again
  // for every letter."
  it('a Change row survives its own keystroke', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SheetRow item={filled({ value: 'CZ' })} onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    await userEvent.type(screen.getByRole('textbox'), 'X');

    // What the page does next: merge the keystroke in and re-render.
    rerender(<SheetRow item={filled({ value: 'CZX' })} onChange={onChange} />);
    expect(screen.getByRole('textbox')).toBeDefined();
  });

  it('⚠️ A needs_you ROW DOES NOT COLLAPSE WHEN THE SAVE LANDS', async () => {
    // That row is open because of its STATE, so the moment the debounced save
    // came back and the state flipped to `filled`, the control collapsed into a
    // value with a Change button — mid-word.
    const onChange = vi.fn();
    const { rerender } = render(
      <SheetRow item={needsYou({ key: 'firearm_make' })} onChange={onChange} />,
    );
    await userEvent.type(screen.getByRole('textbox'), 'M');
    rerender(
      <SheetRow
        item={filled({ key: 'firearm_make', value: 'M' })}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('textbox')).toBeDefined();
  });

  it('still settles back once they press Done', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SheetRow item={filled({ value: 'CZ' })} onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    await userEvent.type(screen.getByRole('textbox'), 'X');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    rerender(<SheetRow item={filled({ value: 'CZX' })} onChange={onChange} />);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('a row nobody is editing is untouched by a value landing on it', () => {
    const { rerender } = render(
      <SheetRow item={filled({ value: 'CZ' })} onChange={vi.fn()} />,
    );
    rerender(<SheetRow item={filled({ value: 'MAUSER' })} onChange={vi.fn()} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('MAUSER')).toBeDefined();
  });
});
