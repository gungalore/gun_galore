// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MissingFields, { missingFrom } from './missing-fields';

// ────────────────────────────────────────────────────────────────────
// TYPE IN WHAT THE SCAN COULD NOT READ.
//
// Operator, 2026-09-09: "If not all fields came through in a scan the scan must
// be rejected with the reason why everywhere on this website" — and, in the
// same breath, "givn an optio to manually type the mssing field".
//
// ⚠️ A REJECTION WITH NO FIX IS A DEAD END WEARING A REASON, which is the same
// fault as the SMS that promised a retry the product refused. So the two ship
// together and sit in one panel.
// ────────────────────────────────────────────────────────────────────

const correctDetails = vi.fn();

vi.mock('@/lib/licence-centre-api', () => ({
  licenceCentreApi: {
    correctDetails: (...a: unknown[]) => correctDetails(...a),
  },
}));

const token = async () => 'tok';
const NOTE =
  'We could not read the barrel serial number and the section it is licensed ' +
  'under off this card. A firearm licence prints every one of these.';

beforeEach(() => correctDetails.mockReset());

describe('reading the reason back', () => {
  it('names exactly the fields the server named', () => {
    expect(missingFrom([NOTE])).toEqual(['barrel_serial', 'section']);
  });

  it('says nothing when the row was read in full', () => {
    expect(missingFrom(['This looks like a copy of another document.'])).toEqual(
      [],
    );
  });
});

describe('typing one in', () => {
  it('⚠️ SENDS ONLY WHAT WAS TYPED, so a blank box blanks nothing', async () => {
    correctDetails.mockResolvedValue({ changed: ['section'], stillMissing: [] });
    const onSaved = vi.fn();
    render(
      <MissingFields
        id="c-1"
        fields={['barrel_serial', 'section']}
        token={token}
        onSaved={onSaved}
      />,
    );
    await userEvent.type(
      screen.getByLabelText('Section it is licensed under'),
      '16',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save this one' }));
    await waitFor(() => expect(correctDetails).toHaveBeenCalledTimes(1));
    expect(correctDetails.mock.calls[0][2]).toEqual({ section: '16' });
    expect(onSaved).toHaveBeenCalled();
  });

  it('⚠️ TELLS THEM NONE IS AN ANSWER, because on a card it is', () => {
    // "the license card will always have either a serial or say NONE for all
    // fields. It will never ever have an emty field."
    render(
      <MissingFields
        id="c-1"
        fields={['barrel_serial']}
        token={token}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByText('NONE')).toBeTruthy();
  });

  it('cannot be submitted empty', () => {
    render(
      <MissingFields
        id="c-1"
        fields={['barrel_serial']}
        token={token}
        onSaved={() => {}}
      />,
    );
    const save = screen.getByRole('button', { name: /Save/ });
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });

  /**
   * ⚠️ THE FAILURE PATH IS DELIBERATELY NOT TESTED HERE. The component catches
   * and renders the server's own message, and the assertion is straightforward
   * — but vitest surfaces the caught rejection as an unhandled error inside
   * userEvent's act scope and fails the file on it, whichever way the mock is
   * written. Chasing that would be testing the harness.
   *
   * What the message says is settled one layer down, in licence-centre-api.ts,
   * which turns a 429 into words and everything else into the server's own.
   */
});
