// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AnswersReview, {
  canContinueToWrite,
  documentLedger,
  reviewStats,
} from './answers-review';
import { filled, needsYou, sheet, suggested } from './__fixtures__/sheet.fixture';
import type { SheetItem, SheetResponse } from './contract';

// ────────────────────────────────────────────────────────────────────
// THE FOLDED REVIEW SHEET.
//
// ⚠️ THE OPERATOR'S REPORT IS THE SPEC: "These seem to be 271 form questions?
// And why do I have to scroll and fill in this endless page?" So the cases that
// matter here are (1) a finished section is shut, (2) an optional empty field
// does not open a box by itself, (3) a drafted answer is still visible and
// flagged, and (4) a satisfied document can never read as outstanding.
// The 271 is retired: there is no block for it any more.
// ────────────────────────────────────────────────────────────────────

const section = (id: string, title: string) => ({
  id,
  title,
  blurb: '',
  missing: [] as string[],
});

const onSave = vi.fn().mockResolvedValue(undefined);
const onConfirm = vi.fn().mockResolvedValue(undefined);

function renderReview(next: SheetResponse) {
  return render(
    <AnswersReview
      sheet={next}
      busyKey={null}
      confirmingKey={null}
      onSave={onSave}
      onConfirm={onConfirm}
    />,
  );
}

const withItems = (
  items: SheetItem[],
  over: Partial<SheetResponse> = {},
): SheetResponse =>
  sheet({
    sections: [section('you', 'You'), section('case', 'Your case')],
    items,
    missing: [],
    needs: { needs: [] },
    ...over,
  });

describe('folds — only what needs a person is open', () => {
  /**
   * ⚠️ A DRAFTED ANSWER DOES NOT OPEN ITS SECTION ANY MORE. With ten drafted
   * paragraphs that alone made the review screen dozens of screens tall; the
   * attention panel counts them and the summary says "1 to check". The row is
   * still readable (and still gold-flagged) once the member opens the fold.
   */
  it('keeps a drafted-only section shut, and counts it in the summary', () => {
    renderReview(
      withItems([
        filled({ key: 'full_name', label: 'Full name', value: 'Johan', section: 'you' }),
        suggested({
          key: 'shooting_history',
          label: 'How you came to shooting',
          kind: 'long',
          value: 'I grew up around firearms.',
          section: 'case',
        }),
      ]),
    );

    expect(
      screen.getByText('You').closest('details')?.hasAttribute('open'),
    ).toBe(false);
    expect(
      screen.getByText('Your case').closest('details')?.hasAttribute('open'),
    ).toBe(false);
    // Both are still counted/flagged, just not opened for the member.
    expect(screen.getByText('1 answer · 1 to check')).toBeDefined();
    expect(screen.getByText('Drafted for you — check it')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDefined();
  });

  it('does not open an optional empty field until Change is tapped', async () => {
    const user = userEvent.setup();
    renderReview(
      withItems([
        needsYou({ required: false, section: 'you' }),
      ]),
    );

    expect(
      screen.getByText('You').closest('details')?.hasAttribute('open'),
    ).toBe(false);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Change' })).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.getByRole('textbox')).toBeDefined();
  });

  it('opens a section with a missing answer, with the control already open', () => {
    renderReview(
      withItems([needsYou({ section: 'you' })], {
        missing: ['firearm_calibre'],
      }),
    );

    expect(
      screen.getByText('You').closest('details')?.hasAttribute('open'),
    ).toBe(true);
    expect(screen.getByRole('textbox')).toBeDefined();
  });

  it('summarises the section: answers and how many to check', () => {
    renderReview(
      withItems([
        filled({ key: 'a', label: 'A', section: 'you' }),
        suggested({ key: 'b', label: 'B', section: 'you' }),
      ]),
    );
    expect(screen.getByText('2 answers · 1 to check')).toBeDefined();
  });
});

describe('the attention panel', () => {
  it('counts the missing answers the sheet is holding out for', () => {
    const next = withItems(
      [needsYou({ key: 'firearm_calibre', section: 'you' })],
      { missing: ['firearm_calibre'] },
    );

    const stats = reviewStats(next);
    expect(stats.missingAnswers).toBe(1);
    render(
      <AnswersReview
        sheet={next}
        busyKey={null}
        confirmingKey={null}
        onSave={onSave}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByText('Needs your attention')).toBeDefined();
    expect(screen.getByText(/1 answer still needed/)).toBeDefined();
  });

  it('counts the drafted answers that still need checking', () => {
    const next = withItems([
      suggested({ key: 'shooting_history', label: 'History', section: 'case' }),
    ]);
    const stats = reviewStats(next);
    expect(stats.draftedAnswers).toBe(1);
    render(
      <AnswersReview
        sheet={next}
        busyKey={null}
        confirmingKey={null}
        onSave={onSave}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByText(/1 drafted answer to check/)).toBeDefined();
  });

  it('counts a missing document and blocks writing on it', () => {
    const next = withItems([filled({ key: 'a', label: 'A', section: 'you' })], {
      needs: {
        needs: [
          {
            kind: 'COMPETENCY_CERTIFICATE',
            label: 'Competency certificate',
            tier: 'required',
            why: 'SAPS wants it.',
            have: false,
          },
        ],
      },
    });
    const stats = reviewStats(next);
    expect(stats.missingDocuments).toBe(1);
    expect(canContinueToWrite(stats, false)).toBe(false);
    render(
      <AnswersReview
        sheet={next}
        busyKey={null}
        confirmingKey={null}
        onSave={onSave}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByText(/1 document still needed/)).toBeDefined();
  });
});

describe('the pack-documents ledger', () => {
  const printReady = (over: Partial<SheetResponse> = {}): SheetResponse =>
    sheet({
      application: { ...sheet().application, outputMode: 'PRINT_READY' },
      sections: [section('you', 'You')],
      items: [filled({ key: 'a', label: 'A', section: 'you' })],
      missing: [],
      needs: {
        needs: [
          {
            kind: 'CURRENT_LICENCE',
            label: "Each firearm's licence",
            tier: 'required',
            why: 'A print-ready pack shows the DFO every firearm we mention.',
            have: true,
            minFiles: 6,
            haveFiles: 6,
            minFilesNote: 'One photo or scan per firearm.',
          },
          {
            kind: 'COMPETENCY_CERTIFICATE',
            label: 'Competency certificate',
            tier: 'required',
            why: 'SAPS wants a copy.',
            have: false,
          },
          {
            kind: 'ASSOCIATION_ENDORSEMENT',
            label: 'Association endorsement',
            tier: 'expected',
            why: 'A DFO usually asks.',
            have: true,
          },
          {
            kind: 'EXTRA_PHOTO',
            label: 'Extra photo',
            tier: 'extra',
            why: 'Not asked for the pack.',
            have: false,
          },
        ],
      },
      compliance: {
        required: true,
        ready: true,
        checks: [
          {
            key: 'PROFICIENCY',
            label: 'Proficiency statement of results',
            state: 'unread',
            note: 'Upload a clearer statement of results in the Document Centre and re-attach it.',
          },
          {
            key: 'KNOWLEDGE_OF_ACT',
            label: 'Knowledge of the Act (unit standard 117705)',
            state: 'have',
            note: 'Read from your certificate.',
          },
        ],
      },
      ...over,
    });

  it('puts satisfied documents under “On file”, never under “Still needed”', () => {
    renderReview(printReady());

    const outstanding = screen.getByRole('list', { name: 'Still needed' });
    const onFile = screen.getByRole('list', { name: 'On file' });

    // A licence already added is ON FILE, with its count line — the operator's
    // "why is A firearm licence I already hold shown here?".
    expect(within(onFile).getByText("Each firearm's licence")).toBeDefined();
    expect(within(onFile).getByText('6 of 6 licence cards added')).toBeDefined();
    expect(within(onFile).getAllByText('✓ Added').length).toBeGreaterThan(0);
    expect(within(onFile).getByText('Association endorsement')).toBeDefined();
    expect(within(outstanding).queryByText("Each firearm's licence")).toBeNull();

    // The genuinely outstanding competency sits under Still needed, with reason.
    expect(within(outstanding).getByText('Competency certificate')).toBeDefined();
    expect(within(outstanding).getByText('Still needed')).toBeDefined();
    expect(within(outstanding).getByText('SAPS wants a copy.')).toBeDefined();

    // Only required/expected rows are ledged.
    expect(screen.queryByText('Extra photo')).toBeNull();

    // The instruction and the primary Document Centre action.
    expect(
      screen.getByText(/Upload or scan it in the Document Centre/),
    ).toBeDefined();
    expect(
      screen
        .getByRole('link', { name: 'Go to the Document Centre' })
        .getAttribute('href'),
    ).toBe('/documents');
  });

  it('shows compliance checks with their three states and the per-row Document Centre action', () => {
    const ledger = documentLedger(printReady());
    expect(
      ledger.find((row) => row.label === 'Proficiency statement of results')
        ?.status,
    ).toBe('unread');
    expect(
      ledger.find((row) => row.label.startsWith('Knowledge of the Act'))?.status,
    ).toBe('added');

    renderReview(printReady());
    const onFile = screen.getByRole('list', { name: 'On file' });
    expect(within(onFile).getByText("Couldn't read")).toBeDefined();
    expect(
      within(onFile).getByText(/Upload a clearer statement of results/),
    ).toBeDefined();
    // Unread/missing rows carry the Document Centre as their primary action.
    expect(
      within(onFile)
        .getByRole('link', { name: 'Upload in the Document Centre' })
        .getAttribute('href'),
    ).toBe('/documents');
  });

  it('counts a blocked compliance gate in reviewStats and shows the server reason', () => {
    const next = sheet({
      application: { ...sheet().application, outputMode: 'PRINT_READY' },
      sections: [section('you', 'You')],
      items: [filled({ key: 'a', label: 'A', section: 'you' })],
      missing: [],
      needs: { needs: [] },
      compliance: {
        required: true,
        ready: false,
        checks: [
          {
            key: 'PROFICIENCY',
            label: 'Proficiency statement of results',
            state: 'missing',
            note: 'Upload your proficiency statement of results in the Document Centre.',
          },
          {
            key: 'KNOWLEDGE_OF_ACT',
            label: 'Knowledge of the Act (unit standard 117705)',
            state: 'have',
            note: 'Read from your certificate.',
          },
        ],
      },
    });

    const stats = reviewStats(next);
    expect(stats.complianceBlocked).toBe(true);
    expect(stats.missingCount).toBe(1);
    expect(canContinueToWrite(stats, false)).toBe(false);
    render(
      <AnswersReview
        sheet={next}
        busyKey={null}
        confirmingKey={null}
        onSave={onSave}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByText('Needs your attention')).toBeDefined();
    // Shown both in the attention panel and on the ledger row.
    expect(
      screen.getAllByText(
        'Upload your proficiency statement of results in the Document Centre.',
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('list', { name: 'Still needed' })).toBeDefined();
  });

  it('does not block on an unread card when the server says the pack is ready', () => {
    const next = printReady({ needs: { needs: [] } });
    const stats = reviewStats(next);
    expect(stats.complianceBlocked).toBe(false);
    expect(canContinueToWrite(stats, false)).toBe(true);
  });

  it('shows one line and no ledger for a motivation-only draft', () => {
    renderReview(
      sheet({
        application: {
          ...sheet().application,
          outputMode: 'MOTIVATION_ONLY',
        },
      }),
    );
    expect(
      screen.getByText('A motivation-only draft needs no documents.'),
    ).toBeDefined();
    expect(
      screen.queryByText('Documents for your print-ready pack'),
    ).toBeNull();
    expect(
      screen.queryByRole('link', { name: 'Go to the Document Centre' }),
    ).toBeNull();
  });
});

describe('owned firearms — one box per firearm, only as many as the count', () => {
  const ownedRow = (
    index: number,
    field: string,
    label: string,
    value: string,
  ): SheetItem =>
    filled({
      key: `existing_firearm_${index}_${field}`,
      label,
      value,
      section: 'existing',
    });

  const countRow = (value: string): SheetItem =>
    filled({
      key: 'existing_firearm_count',
      label: 'How many firearms do you own?',
      kind: 'choice',
      value,
      section: 'existing',
    });

  it('groups the rows into one-line boxes and stops at the count', () => {
    renderReview(
      sheet({
        sections: [section('existing', 'Firearms you own')],
        items: [
          countRow('2'),
          ownedRow(1, 'make', 'Make', 'GLOCK'),
          ownedRow(1, 'model', 'Model', '19'),
          ownedRow(1, 'calibre', 'Calibre', '9MM'),
          ownedRow(1, 'serial', 'Serial', 'ABC'),
          ownedRow(2, 'make', 'Make', 'MAUSER'),
          // A stale row beyond the count must not grow a third box.
          ownedRow(3, 'make', 'Make', 'OLD'),
        ],
        missing: [],
        needs: { needs: [] },
      }),
    );

    const first = screen.getByRole('region', { name: 'Firearm 1' });
    // A collapsed one-line header: firearm, the card's own row, and a marker.
    expect(within(first).getByText('Firearm 1')).toBeDefined();
    expect(within(first).getByText('GLOCK · 19 · 9MM · ABC')).toBeDefined();
    expect(within(first).getByText('complete')).toBeDefined();
    expect(first.querySelector('details')?.hasAttribute('open')).toBe(false);
    expect(screen.getByRole('region', { name: 'Firearm 2' })).toBeDefined();
    expect(screen.queryByRole('region', { name: 'Firearm 3' })).toBeNull();
    expect(screen.queryByText('OLD')).toBeNull();
    // The count question stays an ordinary row, outside the boxes.
    expect(within(first).queryByText('How many firearms do you own?')).toBeNull();
    expect(screen.getByText('How many firearms do you own?')).toBeDefined();
  });

  it('opens only a firearm box that has a missing answer', () => {
    renderReview(
      sheet({
        sections: [section('existing', 'Firearms you own')],
        items: [
          countRow('2'),
          ownedRow(1, 'make', 'Make', 'GLOCK'),
          needsYou({
            key: 'existing_firearm_2_model',
            label: 'Model',
            section: 'existing',
          }),
        ],
        missing: ['existing_firearm_2_model'],
        needs: { needs: [] },
      }),
    );

    const first = screen.getByRole('region', { name: 'Firearm 1' });
    const second = screen.getByRole('region', { name: 'Firearm 2' });
    expect(first.querySelector('details')?.hasAttribute('open')).toBe(false);
    expect(second.querySelector('details')?.hasAttribute('open')).toBe(true);
    expect(within(second).getByText('1 to fill')).toBeDefined();
    // The gap's editor is open for the member immediately.
    expect(within(second).getByRole('textbox')).toBeDefined();
  });

  it('hides type/expiry/serials under "More details" inside a firearm box', () => {
    renderReview(
      sheet({
        sections: [section('existing', 'Firearms you own')],
        items: [
          countRow('1'),
          ownedRow(1, 'make', 'Make', 'GLOCK'),
          ownedRow(1, 'type', 'Type', 'Pistol'),
        ],
        missing: [],
        needs: { needs: [] },
      }),
    );

    const first = screen.getByRole('region', { name: 'Firearm 1' });
    const more = screen.getByText(
      'More details (type, licence expiry, section, serials)',
    );
    expect(within(first).getByText('More details (type, licence expiry, section, serials)')).toBeDefined();
    expect(more.closest('details')?.hasAttribute('open')).toBe(false);
  });

  it('shows the per-firearm licence progress for a print-ready pack', () => {
    renderReview(
      sheet({
        application: { ...sheet().application, outputMode: 'PRINT_READY' },
        sections: [section('existing', 'Firearms you own')],
        items: [
          countRow('6'),
          ownedRow(1, 'make', 'Make', 'GLOCK'),
        ],
        missing: [],
        needs: {
          needs: [
            {
              kind: 'CURRENT_LICENCE',
              label: "Each firearm's licence",
              tier: 'required',
              why: 'A print-ready pack shows the DFO every firearm we mention.',
              have: false,
              minFiles: 6,
              haveFiles: 3,
              minFilesNote: 'One photo or scan per firearm.',
            },
          ],
        },
      }),
    );

    expect(screen.getByText('3 of 6 licence cards added')).toBeDefined();
    expect(screen.getByText('One photo or scan per firearm.')).toBeDefined();
    expect(screen.getByText("Each firearm's licence")).toBeDefined();
  });
});
