// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DeclarationRow from './declaration-row';
import { filled } from './__fixtures__/sheet.fixture';
import type { SheetItem } from './contract';

// ────────────────────────────────────────────────────────────────────
// THE SIX DECLARATION QUESTIONS.
//
// ⚠️ THE TWO RULES HERE ARE BOTH THINGS THAT HAVE GONE WRONG BEFORE. Nothing
// may be pre-selected — the canvas draws all six as "No" because it is a
// picture of a finished application, and shipping that would put words about
// somebody's criminal record into their mouth on a form they sign under
// section 120(9)(f). And a "No" must add nothing at all — no detail box, no
// form boxes — because a clean record contributes nothing to the document and
// should look like nothing to do.
// ────────────────────────────────────────────────────────────────────

const question = (over: Partial<SheetItem> = {}): SheetItem =>
  filled({
    key: 'history_conviction',
    label:
      'Have you ever been convicted of an offence, in South Africa or anywhere else?',
    kind: 'yesno',
    state: 'needs_you',
    value: '',
    provenance: null,
    section: 'declarations',
    ...over,
  });

const detail = (over: Partial<SheetItem> = {}): SheetItem =>
  filled({
    key: 'history_conviction_detail',
    label: 'Tell us what happened',
    kind: 'long',
    state: 'needs_you',
    value: '',
    provenance: null,
    section: 'declarations',
    ...over,
  });

describe('nothing is pre-selected', () => {
  it('⚠️ RENDERS BOTH PILLS UNCHOSEN ON AN UNANSWERED QUESTION', () => {
    render(<DeclarationRow item={question()} onChange={vi.fn()} />);
    const no = screen.getByRole('button', { name: 'No' });
    const yes = screen.getByRole('button', { name: 'Yes' });
    expect(no.getAttribute('aria-pressed')).toBe('false');
    expect(yes.getAttribute('aria-pressed')).toBe('false');
  });

  it('offers "No" before "Yes" — the registry order, not a layout choice', () => {
    render(<DeclarationRow item={question()} onChange={vi.fn()} />);
    const labels = screen
      .getAllByRole('button')
      .map((b) => b.textContent?.trim());
    expect(labels.indexOf('No')).toBeLessThan(labels.indexOf('Yes'));
  });

  it('reports the answer the member actually chose', async () => {
    const onChange = vi.fn();
    render(<DeclarationRow item={question()} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(onChange).toHaveBeenCalledWith('Yes');
  });
});

describe('a "No" adds nothing', () => {
  it('opens no detail box', () => {
    render(
      <DeclarationRow
        item={question({ value: 'No', state: 'filled' })}
        onChange={vi.fn()}
        detail={detail()}
        onDetailChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('opens no form boxes either', () => {
    render(
      <DeclarationRow
        item={question({ value: 'No', state: 'filled' })}
        onChange={vi.fn()}
        boxes={[detail({ key: 'history_conviction_station', kind: 'short' })]}
        onBoxChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('a "Yes" opens the disclosure', () => {
  it('shows the detail box', () => {
    render(
      <DeclarationRow
        item={question({ value: 'Yes', state: 'filled' })}
        onChange={vi.fn()}
        detail={detail()}
        onDetailChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Tell us what happened')).toBeDefined();
  });

  it('shows the four form boxes, each labelled', () => {
    const boxes = [
      'history_conviction_station',
      'history_conviction_case_number',
      'history_conviction_charge',
      'history_conviction_outcome',
    ].map((key) => detail({ key, kind: 'short', label: key }));

    render(
      <DeclarationRow
        item={question({ value: 'Yes', state: 'filled' })}
        onChange={vi.fn()}
        boxes={boxes}
        onBoxChange={vi.fn()}
      />,
    );
    for (const b of boxes) {
      expect(screen.getByLabelText(b.label)).toBeDefined();
    }
  });

  it('⚠️ HIDES A BOX THE SERVER SAYS DOES NOT APPLY', () => {
    // The negligence question only exists once lost/stolen is Yes, and that is
    // the registry's showIf. Mirroring that rule here would be a second
    // implementation of isVisible(), which the sheet endpoint exists to retire
    // — so an `na` box is simply not rendered.
    render(
      <DeclarationRow
        item={question({ value: 'Yes', state: 'filled' })}
        onChange={vi.fn()}
        boxes={[detail({ key: 'x', kind: 'short', label: 'X', state: 'na' })]}
        onBoxChange={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText('X')).toBeNull();
  });

  it('reports a change in the detail box', async () => {
    const onDetailChange = vi.fn();
    render(
      <DeclarationRow
        item={question({ value: 'Yes', state: 'filled' })}
        onChange={vi.fn()}
        detail={detail()}
        onDetailChange={onDetailChange}
      />,
    );
    await userEvent.type(screen.getByRole('textbox'), 'x');
    expect(onDetailChange).toHaveBeenCalledWith('x');
  });
});

describe('na', () => {
  it('renders nothing at all', () => {
    const { container } = render(
      <DeclarationRow item={question({ state: 'na' })} onChange={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });
});
