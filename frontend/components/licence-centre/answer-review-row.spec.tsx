// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AnswerReviewRow from './answer-review-row';
import { cardsItem, filled, needsYou, suggested } from './__fixtures__/sheet.fixture';
import type { SheetItem } from './contract';

// ────────────────────────────────────────────────────────────────────
// ONE ANSWER ON "CHECK YOUR ANSWERS".
//
// ⚠️ THE DRAFTED ROW IS THE ONE THAT MATTERS. The writer composes the personal
// history from the applicant's own documents; every one of those sentences has
// to be visibly flagged and individually accept-able or editable before it can
// reach a police form. If the gold flag and the Edit/Confirm pair ever go, they
// go here.
// ────────────────────────────────────────────────────────────────────

const drafted = (over: Partial<SheetItem> = {}): SheetItem =>
  suggested({
    key: 'shooting_history',
    label: 'How you came to shooting',
    kind: 'long',
    state: 'suggested',
    value:
      'I grew up around firearms and have been a member of a shooting club for many years.',
    provenance: {
      source: 'DRAFTED',
      from: 'your documents and your application',
      at: '2026-11-26T00:00:00.000Z',
      inferred: true,
    },
    required: false,
    help: undefined,
    ...over,
  });

describe('a filled answer', () => {
  it('shows the value and offers Change, not Confirm', () => {
    render(<AnswerReviewRow item={filled()} onSave={vi.fn()} />);
    expect(screen.getByText('CZ')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Change' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  });

  it('opens the editor prefilled, and Save writes the change', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<AnswerReviewRow item={filled()} onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Change' }));
    const box = screen.getByRole('textbox') as HTMLInputElement;
    expect(box.value).toBe('CZ');

    await user.clear(box);
    await user.type(box, 'MAUSER');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith('firearm_make', 'MAUSER');
  });

  it('Cancel puts the saved value back and closes the editor', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<AnswerReviewRow item={filled()} onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.type(screen.getByRole('textbox'), 'X');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('CZ')).toBeDefined();
  });
});

describe('a drafted answer — flagged, checkable, changeable', () => {
  it('says it was drafted for them, in gold', () => {
    render(<AnswerReviewRow item={drafted()} onSave={vi.fn()} onConfirm={vi.fn()} />);
    const flag = screen.getByText('Drafted for you — check it');
    expect(flag).toBeDefined();
    expect(flag.className).toContain('--gold');
  });

  it('offers both Edit and Confirm', () => {
    render(<AnswerReviewRow item={drafted()} onSave={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDefined();
  });

  it('Confirm accepts the words without opening an editor', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <AnswerReviewRow item={drafted()} onSave={vi.fn()} onConfirm={onConfirm} />,
    );
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledWith('shooting_history');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('Edit opens the drafted paragraph for correction', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <AnswerReviewRow item={drafted()} onSave={onSave} onConfirm={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(box.value).toContain('I grew up around firearms');

    await user.clear(box);
    await user.type(box, 'I learned to shoot with my father.');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(
      'shooting_history',
      'I learned to shoot with my father.',
    );
  });
});

describe('cards and multi — edited in place as chips', () => {
  it('prints the chosen sentences, never their keys, until Change is tapped', () => {
    render(
      <AnswerReviewRow
        item={cardsItem({ state: 'filled', value: 'night_travel, rented' })}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText(/I regularly travel at night/)).toBeDefined();
    expect(screen.getByText(/I rent, so I cannot/)).toBeDefined();
    expect(screen.queryByText('night_travel')).toBeNull();
    expect(screen.queryByRole('button', { name: /I rent, so I cannot/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Change' })).toBeDefined();
  });

  it('toggles chips and saves the joined keys', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <AnswerReviewRow
        item={cardsItem({ state: 'filled', value: 'night_travel' })}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Change' }));
    // The sentence is the button; the stored key is behind it.
    const rent = screen.getByRole('button', { name: /I rent, so I cannot/ });
    expect(rent.getAttribute('aria-pressed')).toBe('false');
    await user.click(rent);
    expect(rent.getAttribute('aria-pressed')).toBe('true');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(
      's13_reasons',
      'night_travel, rented',
    );
  });

  it('Cancel restores the saved choice and writes nothing', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <AnswerReviewRow
        item={cardsItem({ state: 'filled', value: 'night_travel' })}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.click(screen.getByRole('button', { name: /I rent, so I cannot/ }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /I rent, so I cannot/ })).toBeNull();
    expect(screen.getByText(/I regularly travel at night/)).toBeDefined();

    // Re-opening starts from what the server holds, not from the cancelled tap.
    await user.click(screen.getByRole('button', { name: 'Change' }));
    expect(
      screen
        .getByRole('button', { name: /I regularly travel at night/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen
        .getByRole('button', { name: /I rent, so I cannot/ })
        .getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('never saves an empty selection', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <AnswerReviewRow
        item={cardsItem({ state: 'filled', value: 'night_travel' })}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.click(
      screen.getByRole('button', { name: /I regularly travel at night/ }),
    );

    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByText(/an empty answer is never saved/)).toBeDefined();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('makes a missing cards answer selectable on this screen', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <AnswerReviewRow
        item={cardsItem({ state: 'needs_you', value: '', provenance: null })}
        onSave={onSave}
      />,
    );

    // Open without a tap — it is the gap the warning above is counting.
    expect(screen.getByText('Still needed')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty(
      'disabled',
      true,
    );
    await user.click(
      screen.getByRole('button', { name: /I regularly travel at night/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('s13_reasons', 'night_travel');
  });

  it('still offers Confirm and the gold flag on a drafted cards answer', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <AnswerReviewRow
        item={cardsItem({ state: 'suggested', value: 'night_travel' })}
        onSave={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByText('Drafted for you — check it')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledWith('s13_reasons');
  });

  it('opens the chip editor from Edit on a drafted cards answer', async () => {
    const user = userEvent.setup();
    render(
      <AnswerReviewRow
        item={cardsItem({ state: 'suggested', value: 'night_travel' })}
        onSave={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(
      screen
        .getByRole('button', { name: /I regularly travel at night/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('edits a multi answer as chips, using the offered values', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <AnswerReviewRow
        item={filled({
          key: 'hunt_terrain',
          label: 'Where you hunt',
          kind: 'multi',
          state: 'filled',
          value: 'kalahari',
          provenance: null,
          choices: ['kalahari', 'bushveld'],
        })}
        onSave={onSave}
      />,
    );

    expect(screen.getByText('kalahari')).toBeDefined();
    expect(screen.queryByRole('textbox')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.click(screen.getByRole('button', { name: 'bushveld' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('hunt_terrain', 'kalahari, bushveld');
  });
});

describe('a missing answer', () => {
  it('opens the control so the gap can be answered without a tap first', () => {
    render(<AnswerReviewRow item={needsYou()} onSave={vi.fn()} />);
    expect(screen.getByRole('textbox')).toBeDefined();
    expect(screen.getByText('Still needed')).toBeDefined();
  });

  // ⚠️ A REQUIRED EMPTY FIELD IS A GAP; AN OPTIONAL ONE IS NOT. Rendering every
  // optional row open was most of what made the review screen an endless form,
  // so an optional gap stays a one-line row until the member asks for it.
  it('leaves an optional gap closed until Change is tapped', async () => {
    const user = userEvent.setup();
    render(
      <AnswerReviewRow
        item={needsYou({ required: false })}
        onSave={vi.fn()}
      />,
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Optional')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Change' })).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.getByRole('textbox')).toBeDefined();
  });

  // The sheet's own missing list can contain a field the registry does not mark
  // required (the detail gates). The row must open when the page says so.
  it('opens when the page marks the gap as missing even if not required', () => {
    render(
      <AnswerReviewRow
        item={needsYou({ required: false })}
        autoOpen
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByRole('textbox')).toBeDefined();
    expect(screen.getByText('Still needed')).toBeDefined();
  });
});

describe('autosave', () => {
  it('writes a changed value after typing pauses', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AnswerReviewRow item={filled()} onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Change' }));
    const box = screen.getByRole('textbox');
    await user.clear(box);
    await user.type(box, 'MAUSER');

    await vi.waitFor(
      () => expect(onSave).toHaveBeenCalledWith('firearm_make', 'MAUSER'),
      { timeout: 3_000 },
    );
  });

  it('never autosaves an empty box', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AnswerReviewRow item={filled()} onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.clear(screen.getByRole('textbox'));
    // Longer than the autosave pause, to prove the blank never went up.
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    expect(onSave).not.toHaveBeenCalled();
  });
});

