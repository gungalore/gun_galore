// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SheetFooter from './sheet-footer';

// ────────────────────────────────────────────────────────────────────
// THE PAYGATE, AS THE MEMBER SEES IT.
//
// Three states and one promise, and every one of them is money:
//   - unpaid  → the button names the price (the checkout is created for the
//               same number the server served);
//   - paid    → no price, and no "one payment" line, because both would read
//               as "you still owe this";
//   - paying  → disabled, because a second press while the browser is leaving
//               for the bank is a second checkout.
//
// ⚠️ `priceCents === undefined` MUST KEEP THE OLD LABEL. The sheet is fetched
// asynchronously; a footer that guesses before it knows would flash "Pay R 295"
// at somebody who has already paid.
// ────────────────────────────────────────────────────────────────────

describe('the paygate on the Write button', () => {
  it('names the price before the money is taken', () => {
    render(
      <SheetFooter
        missingCount={0}
        declared
        onWrite={vi.fn()}
        priceCents={29_500}
        paid={false}
      />,
    );
    expect(
      screen.getByRole('button', { name: /Pay R 295 and write my motivation/i }),
    ).toBeEnabled();
    expect(screen.getByText(/one payment for this application/i)).toBeTruthy();
  });

  it('drops the price once it is paid', () => {
    render(
      <SheetFooter
        missingCount={0}
        declared
        onWrite={vi.fn()}
        priceCents={29_500}
        paid
      />,
    );
    expect(
      screen.getByRole('button', { name: /^Write my motivation$/i }),
    ).toBeEnabled();
    expect(screen.queryByText(/one payment for this application/i)).toBeNull();
  });

  it('keeps the plain label until the sheet has answered', () => {
    render(<SheetFooter missingCount={0} declared onWrite={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: /^Write my motivation$/i }),
    ).toBeEnabled();
  });

  it('refuses a second press while redirecting to the bank', () => {
    render(
      <SheetFooter
        missingCount={0}
        declared
        onWrite={vi.fn()}
        priceCents={29_500}
        paid={false}
        paying
      />,
    );
    expect(
      screen.getByRole('button', { name: /taking you to your bank/i }),
    ).toBeDisabled();
  });

  it('still requires the declaration before any of it', () => {
    render(
      <SheetFooter
        missingCount={0}
        onWrite={vi.fn()}
        priceCents={29_500}
        paid={false}
      />,
    );
    expect(
      screen.getByRole('button', { name: /Pay R 295 and write my motivation/i }),
    ).toBeDisabled();
  });

  it('does not offer to charge while preparation is paused', () => {
    render(
      <SheetFooter
        missingCount={0}
        declared
        onWrite={vi.fn()}
        priceCents={29_500}
        paid={false}
        maintenance
      />,
    );
    expect(
      screen.getByRole('button', { name: /preparation paused/i }),
    ).toBeDisabled();
    expect(screen.queryByText(/one payment for this application/i)).toBeNull();
  });
});
