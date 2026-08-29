// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExtractionReview from './extraction-review';
import type { Suggestion } from '@/lib/motivations-api';

// ────────────────────────────────────────────────────────────────────
// THE RULES ARE TESTED IN lib/. THIS ASSERTS THE PANEL OBEYS THEM.
//
// extraction-review-rules.spec.ts proves defaultTicks leaves a doubted value
// off and acceptedFrom writes only what was ticked. Neither says the RENDER
// honours them — a checkbox wired to the wrong field, or an accept button that
// sends the whole list, would pass every one of those tests.
// ────────────────────────────────────────────────────────────────────

const sg = (over: Partial<Suggestion> & { key: string }): Suggestion => ({
  value: 'v',
  label: 'Label',
  from: 'your identity document',
  trusted: true,
  ...over,
});

describe('⚠️ a doubted reading arrives unticked on screen', () => {
  it('ticks the confident one and not the doubted one', () => {
    render(
      <ExtractionReview
        suggestions={[
          sg({ key: 'id_number', label: 'Identity number' }),
          sg({ key: 'firearm_serial', label: 'Serial', trusted: false }),
        ]}
        onAccept={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes[0].checked).toBe(true);
    expect(boxes[1].checked).toBe(false);
  });

  it('flags the doubted one, in words, without calling it an error', () => {
    render(
      <ExtractionReview
        suggestions={[sg({ key: 'a', trusted: false })]}
        onAccept={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('Check this')).toBeInTheDocument();
    expect(screen.getByText(/our own checks disagree/i)).toBeInTheDocument();
  });
});

describe('⚠️ accepting sends only what was ticked', () => {
  it('leaves the doubted value out unless the member ticks it', async () => {
    const onAccept = vi.fn();
    render(
      <ExtractionReview
        suggestions={[
          sg({ key: 'id_number', value: '9001015800086' }),
          sg({ key: 'firearm_serial', value: '???', trusted: false }),
        ]}
        onAccept={onAccept}
        onDismiss={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /use/i }));
    expect(onAccept).toHaveBeenCalledWith({ id_number: '9001015800086' });
  });

  it('includes it once they do tick it', async () => {
    const onAccept = vi.fn();
    render(
      <ExtractionReview
        suggestions={[sg({ key: 'serial', value: 'AB1', trusted: false })]}
        onAccept={onAccept}
        onDismiss={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: /use/i }));
    expect(onAccept).toHaveBeenCalledWith({ serial: 'AB1' });
  });

  it('⚠️ CANNOT ACCEPT AN EMPTY SET', () => {
    // Every line unticked means the button is dead rather than posting {}.
    render(
      <ExtractionReview
        suggestions={[sg({ key: 'a', trusted: false })]}
        onAccept={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /nothing ticked/i })).toBeDisabled();
  });

  it('says how many they are about to sign for', () => {
    render(
      <ExtractionReview
        suggestions={[sg({ key: 'a' }), sg({ key: 'b' }), sg({ key: 'c', trusted: false })]}
        onAccept={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    // Two of three ticked, so the button must not say "these are right".
    expect(screen.getByRole('button', { name: /use the 2 i ticked/i })).toBeInTheDocument();
  });
});

describe('nothing to review', () => {
  it('renders nothing rather than an empty panel', () => {
    const { container } = render(
      <ExtractionReview suggestions={[]} onAccept={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
