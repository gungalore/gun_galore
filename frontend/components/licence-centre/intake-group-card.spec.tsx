// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IntakeGroupCard from './intake-group-card';
import type { IntakeGroup, IntakeQuestion } from '@/lib/motivations-api';

function question(over: Partial<IntakeQuestion> = {}): IntakeQuestion {
  return {
    id: 'full_name',
    fieldKey: 'full_name',
    label: 'What is your full name?',
    help: '',
    kind: 'short',
    choices: [],
    multi: false,
    sensitive: false,
    customPlaceholder: 'Or type your own answer…',
    progress: { answered: 0, total: 6 },
    optional: false,
    ...over,
  };
}

function group(questions: IntakeQuestion[]): IntakeGroup {
  return {
    id: 'identity',
    title: 'About you',
    index: 1,
    total: 3,
    answered: 0,
    totalInGroup: questions.length,
    questions,
  };
}

const holder = question({
  fieldKey: 'licence_holder_type',
  id: 'licence_holder_type',
  label: 'What kind of licence holder are you?',
  kind: 'choice',
  choices: [{ value: 'Main firearm licence holder', label: 'Main holder' }],
});

describe('the grouped interview card', () => {
  it('puts every question on the card, with one Continue', () => {
    render(
      <IntakeGroupCard
        group={group([holder, question()])}
        busy={false}
        onSubmit={() => undefined}
      />,
    );

    expect(screen.getByText('About you')).toBeDefined();
    expect(screen.getByText('What kind of licence holder are you?')).toBeDefined();
    expect(screen.getByText('What is your full name?')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Main holder' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDefined();
  });

  it('shows why the DFO needs the fact, when the brief supplies it', () => {
    render(
      <IntakeGroupCard
        group={group([
          question({
            why: 'The DFO reads the make against the licence card.',
            help: 'The manufacturer.',
          }),
        ])}
        busy={false}
        onSubmit={() => undefined}
      />,
    );
    expect(
      screen.getByText('The DFO reads the make against the licence card.'),
    ).toBeDefined();
    expect(screen.queryByText('The manufacturer.')).toBeNull();
  });

  it('enables Continue as soon as one question is answered', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <IntakeGroupCard
        group={group([holder, question()])}
        busy={false}
        onSubmit={onSubmit}
      />,
    );

    const cta = screen.getByRole('button', { name: 'Continue' });
    expect(cta).toHaveProperty('disabled', true);
    expect(screen.getByText('Tap an answer to carry on.')).toBeDefined();

    // ⚠️ THE TAP ITSELF MUST ACTIVATE THE BUTTON. The card used to wait for
    // every required question, so selecting this chip looked like a dead tap
    // until the occupation further down was typed.
    await user.click(screen.getByRole('button', { name: 'Main holder' }));
    expect(cta).toHaveProperty('disabled', false);
    expect(screen.getByText(/1 still to answer/)).toBeDefined();

    // It saves what has been answered; the open question is served again.
    await user.click(cta);
    expect(onSubmit).toHaveBeenCalledWith([
      { fieldKey: 'licence_holder_type', value: 'Main firearm licence holder' },
    ]);
  });

  it('ticks an answered question and crosses one still needed', async () => {
    const user = userEvent.setup();
    render(
      <IntakeGroupCard
        group={group([holder, question()])}
        busy={false}
        onSubmit={() => undefined}
      />,
    );

    // ⚠️ THE TAP MUST BE VISIBLE. A card of six questions gives no feedback
    // between the tap and Continue, so the mark is the feedback.
    expect(
      screen.getAllByRole('img', { name: 'Still needs an answer' }),
    ).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Main holder' }));
    expect(screen.getByRole('img', { name: 'Answered' })).toBeDefined();
    expect(
      screen.getAllByRole('img', { name: 'Still needs an answer' }),
    ).toHaveLength(1);
  });

  it('puts no cross on an optional question left empty', () => {
    render(
      <IntakeGroupCard
        group={group([
          question({
            fieldKey: 'alarm_present',
            id: 'alarm_present',
            label: 'Is there an alarm?',
            kind: 'yesno',
            optional: true,
            choices: [
              { value: 'Yes', label: 'Yes' },
              { value: 'No', label: 'No' },
            ],
          }),
        ])}
        busy={false}
        onSubmit={() => undefined}
      />,
    );
    expect(
      screen.queryByRole('img', { name: 'Still needs an answer' }),
    ).toBeNull();
    expect(screen.queryByRole('img', { name: 'Answered' })).toBeNull();
  });

  it('uses the house date field, not the browser picker', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <IntakeGroupCard
        group={group([
          question({
            fieldKey: 'competency_issued',
            id: 'competency_issued',
            label: 'Competency issued on',
            kind: 'date',
            optional: true,
          }),
        ])}
        busy={false}
        onSubmit={onSubmit}
      />,
    );

    // ⚠️ NO NATIVE PICKER. DateField brings its own calendar button; the input
    // is a typeable text box, not `type="date"`.
    expect(
      screen.getByRole('button', { name: /Open the calendar/ }),
    ).toBeDefined();

    const input = screen.getByPlaceholderText('yyyy-mm-dd');
    expect(input.getAttribute('type')).toBe('text');
    await user.type(input, '2024-03-05');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // A date is the field's VALUE, not a typed "message" the chip matcher
    // would refuse.
    expect(onSubmit).toHaveBeenCalledWith([
      { fieldKey: 'competency_issued', value: '2024-03-05' },
    ]);
  });

  /**
   * ⚠️ THE HISTORY FLOOR IS A UI RULE TOO. One chip reads as answered, enables
   * Continue and is then refused by the server ("please give us a little
   * more"). Below its floor the question must stay open and be left out of the
   * batch, so the rest of the card saves.
   */
  it('keeps a thin shooting history open instead of refusing the card', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const history = question({
      fieldKey: 'shooting_history',
      id: 'shooting_history',
      label: 'How did you first get involved in long-range precision shooting?',
      kind: 'long',
      multi: true,
      minWords: 12,
      choices: [
        {
          value: 'I was taught to shoot by a family member',
          label: 'A family member taught me',
        },
        {
          value: 'A friend introduced me to the sport',
          label: 'A friend introduced me',
        },
        {
          value: 'I learned to shoot at a club',
          label: 'I learned at a club',
        },
      ],
    });

    render(
      <IntakeGroupCard
        group={group([history, holder])}
        busy={false}
        onSubmit={onSubmit}
      />,
    );

    // One chip is 8 words — short of the floor.
    await user.click(screen.getByRole('button', { name: 'A family member taught me' }));
    expect(
      screen.getByText(/Pick a few of these, or add a sentence/),
    ).toBeDefined();
    expect(
      screen.getAllByRole('img', { name: 'Still needs an answer' }),
    ).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Main holder' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // The thin history is not submitted; the holder answer is.
    expect(onSubmit).toHaveBeenCalledWith([
      { fieldKey: 'licence_holder_type', value: 'Main firearm licence holder' },
    ]);
  });

  it('counts several history ticks as an answer', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const history = question({
      fieldKey: 'shooting_history',
      id: 'shooting_history',
      label: 'How did you first get involved?',
      kind: 'long',
      multi: true,
      minWords: 12,
      choices: [
        {
          value: 'I was taught to shoot by a family member',
          label: 'A family member taught me',
        },
        {
          value: 'A friend introduced me to the sport',
          label: 'A friend introduced me',
        },
        {
          value: 'I learned to shoot at a club',
          label: 'I learned at a club',
        },
      ],
    });

    render(
      <IntakeGroupCard
        group={group([history])}
        busy={false}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'A family member taught me' }));
    await user.click(screen.getByRole('button', { name: 'A friend introduced me' }));
    await user.click(screen.getByRole('button', { name: 'I learned at a club' }));

    expect(screen.getByRole('img', { name: 'Answered' })).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onSubmit.mock.calls[0][0]).toEqual([
      {
        fieldKey: 'shooting_history',
        values: [
          'I was taught to shoot by a family member',
          'A friend introduced me to the sport',
          'I learned to shoot at a club',
        ],
      },
    ]);
  });

  it('submits the whole card in one batch', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <IntakeGroupCard
        group={group([holder, question()])}
        busy={false}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Main holder' }));
    await user.type(
      screen.getByPlaceholderText('Or type your own answer…'),
      'Gerhard Fourie',
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual([
      { fieldKey: 'licence_holder_type', value: 'Main firearm licence holder' },
      { fieldKey: 'full_name', message: 'Gerhard Fourie' },
    ]);
  });

  it('sends a skipped optional question with the rest of the card', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <IntakeGroupCard
        group={group([
          holder,
          question({
            fieldKey: 'alarm_present',
            id: 'alarm_present',
            label: 'Is there an alarm?',
            kind: 'yesno',
            optional: true,
            choices: [
              { value: 'Yes', label: 'Yes' },
              { value: 'No', label: 'No' },
            ],
          }),
        ])}
        busy={false}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Main holder' }));
    await user.click(screen.getByRole('button', { name: 'Skip this one' }));

    expect(onSubmit).toHaveBeenCalledWith([
      { fieldKey: 'licence_holder_type', value: 'Main firearm licence holder' },
      { fieldKey: 'alarm_present', skip: true },
    ]);
  });

  it('opens the follow-up fields when a Yes is tapped', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <IntakeGroupCard
        group={group([
          question({
            fieldKey: 'alarm_present',
            id: 'alarm_present',
            label: 'Is there an alarm?',
            kind: 'yesno',
            choices: [
              { value: 'Yes', label: 'Yes' },
              { value: 'No', label: 'No' },
            ],
            details: [
              {
                key: 'alarm_company',
                label: 'Which company monitors it?',
                kind: 'short',
                help: '',
                choices: [],
                multi: false,
                customPlaceholder: 'Type your answer…',
              },
            ],
          }),
        ])}
        busy={false}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Yes' }));
    await user.type(
      screen.getByLabelText('Which company monitors it?'),
      'Fidelity',
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onSubmit).toHaveBeenCalledWith([
      {
        fieldKey: 'alarm_present',
        value: 'Yes',
        fields: { alarm_company: 'Fidelity' },
      },
    ]);
  });

  // ⚠️ A FIELD THAT COMES BACK AFTER IT WAS ANSWERED DID NOT SAVE. Showing it
  // again looks like the tap did nothing. The card says so — but keeps the
  // question and the draft, because a dead "try again" box leaves the member
  // nothing to try with.
  it('surfaces a stuck answer without taking the question away', async () => {
    const user = userEvent.setup();
    const onStuck = vi.fn();
    const onSubmit = vi.fn();
    const first = group([question()]);
    const { rerender } = render(
      <IntakeGroupCard
        group={first}
        busy={false}
        onSubmit={onSubmit}
        onStuck={onStuck}
      />,
    );

    await user.type(
      screen.getByPlaceholderText('Or type your own answer…'),
      'Gerhard Fourie',
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // The server replied with a new group whose first field is the same one.
    rerender(
      <IntakeGroupCard
        group={group([question()])}
        busy={false}
        onSubmit={onSubmit}
        onStuck={onStuck}
      />,
    );

    expect(onStuck).toHaveBeenCalledWith('We could not save that answer. Try again.');
    expect(
      screen.getByText(/We could not save that answer. Try again/),
    ).toBeDefined();
    // The question and the member's own words survive, so the next tap can
    // actually retry.
    expect(screen.getByText('What is your full name?')).toBeDefined();
    expect(screen.getByDisplayValue('Gerhard Fourie')).toBeDefined();
    onSubmit.mockClear();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not cry stuck when the group simply has not replied yet', async () => {
    const user = userEvent.setup();
    const onStuck = vi.fn();
    render(
      <IntakeGroupCard
        group={group([question()])}
        busy={false}
        onSubmit={() => undefined}
        onStuck={onStuck}
      />,
    );

    await user.type(
      screen.getByPlaceholderText('Or type your own answer…'),
      'Gerhard Fourie',
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onStuck).not.toHaveBeenCalled();
  });

  // ?? Operator, 2026-11-06: a ticked chip and a typed sentence are the same
  // answer, and the card used to send only the ticks.
  it('sends the typed answer together with the ticked ones', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const history = question({
      fieldKey: 'shooting_history',
      id: 'shooting_history',
      label: 'How you came to shooting, and what you shoot',
      kind: 'long',
      multi: true,
      choices: [
        { value: 'I shoot clay targets at a club', label: 'Clay targets at a club' },
        { value: 'I hunt birds and small game', label: 'Birds and small game' },
      ],
    });

    render(
      <IntakeGroupCard
        group={group([history])}
        busy={false}
        onSubmit={onSubmit}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Clay targets at a club' }),
    );
    await user.type(
      screen.getByPlaceholderText('Or type your own answer…'),
      'since 2019',
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onSubmit).toHaveBeenCalledWith([
      {
        fieldKey: 'shooting_history',
        values: ['I shoot clay targets at a club'],
        message: 'since 2019',
      },
    ]);
  });
});

describe('the grouped interview card — prefill, Back and edit mode', () => {
  // ?? THE REVIEW FLOW'S EDIT DOOR. Back re-opens the previous topic through
  // the server-built card; the card must open on what the member already said,
  // or "back" would silently blank half the answers it is there to protect.
  it('prefills every saved answer on the card', () => {
    render(
      <IntakeGroupCard
        group={group([
          question({ value: 'Gerhard Fourie' }),
          question({
            fieldKey: 'firearm_make',
            id: 'firearm_make',
            label: 'Make',
            value: 'CZ',
          }),
        ])}
        busy={false}
        onSubmit={() => undefined}
      />,
    );

    expect(screen.getByDisplayValue('Gerhard Fourie')).toBeDefined();
    expect(screen.getByDisplayValue('CZ')).toBeDefined();
    // Prefilled counts as answered: the footer does not demand a tap.
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('ticks the saved chips of a multi answer, and sends them back unchanged', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <IntakeGroupCard
        group={group([
          question({
            fieldKey: 'hunt_terrain',
            id: 'hunt_terrain',
            label: 'Where do you hunt?',
            kind: 'multi',
            multi: true,
            choices: [
              { value: 'kalahari', label: 'Kalahari' },
              { value: 'bushveld', label: 'Bushveld' },
            ],
            values: ['kalahari'],
          }),
        ])}
        busy={false}
        onSubmit={onSubmit}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Kalahari' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Bushveld' }).getAttribute('aria-pressed'),
    ).toBe('false');

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onSubmit).toHaveBeenCalledWith([
      { fieldKey: 'hunt_terrain', values: ['kalahari'] },
    ]);
  });

  it('offers Back in the footer when there is an earlier topic', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(
      <IntakeGroupCard
        group={group([question()])}
        busy={false}
        onSubmit={() => undefined}
        onBack={onBack}
      />,
    );

    const back = screen.getByRole('button', { name: 'Back' });
    expect(back).toHaveProperty('disabled', false);
    await user.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('shows no Back on the first topic with work', () => {
    render(
      <IntakeGroupCard
        group={group([question()])}
        busy={false}
        onSubmit={() => undefined}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('labels an earlier card as editing and saves instead of continuing', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <IntakeGroupCard
        group={group([question({ value: 'Gerhard Fourie' })])}
        busy={false}
        onSubmit={onSubmit}
        onBack={vi.fn()}
        mode="edit"
      />,
    );

    expect(screen.getByText('Step 1 of 3 · editing')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    // The page supplies its own way back while editing.
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSubmit).toHaveBeenCalledWith([
      { fieldKey: 'full_name', message: 'Gerhard Fourie' },
    ]);
  });
});

describe('the grouped interview card - closed choices', () => {
  /**
   * ?? A CLOSED CHOICE HAS NO TYPED ANSWER. "Type of firearm" accepts four
   * values and nothing else; a box under it invites an answer the sheet will
   * refuse. Operator, 2026-11-05: "remove the textbox as it serves no purpose
   * on this question as the buttons are the only possible answers."
   */
  it('shows no text box when the buttons are the only answers', () => {
    render(
      <IntakeGroupCard
        group={group([
          question({
            fieldKey: 'firearm_type',
            id: 'firearm_type',
            label: 'Type of firearm',
            kind: 'choice',
            choices: [
              { value: 'Rifle', label: 'Rifle' },
              { value: 'Shotgun', label: 'Shotgun' },
            ],
          }),
        ])}
        busy={false}
        onSubmit={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: 'Shotgun' })).toBeDefined();
    expect(screen.queryByPlaceholderText(/type your own answer/i)).toBeNull();
  });

  it('keeps the text box when the chips are only suggestions', () => {
    render(
      <IntakeGroupCard
        group={group([
          question({
            fieldKey: 'intended_quarry',
            id: 'intended_quarry',
            label: 'What do you hunt?',
            kind: 'multi',
            multi: true,
            choices: [{ value: 'kudu', label: 'Kudu' }],
          }),
        ])}
        busy={false}
        onSubmit={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: 'Kudu' })).toBeDefined();
    expect(
      screen.getByPlaceholderText(/type your own answer/i),
    ).toBeDefined();
  });
});

describe('the grouped interview card — owned firearm boxes', () => {
  /**
   * ⚠️ ONE BOX PER FIREARM, WITH THE FOUR LABELS THE OPERATOR SETTLED ON. Six
   * owned firearms as a flat run of twenty-four questions was the "endless form"
   * complaint in its worst form; the prefixed keys carry the index, so the boxes
   * come from the answer keys rather than from an assumption about the card.
   */
  const owned = (index: number, field: string, label: string) =>
    question({
      fieldKey: `existing_firearm_${index}_${field}`,
      id: `existing_firearm_${index}_${field}`,
      label,
    });

  it('groups each firearm’s fields into its own box, leaving the count outside', () => {
    render(
      <IntakeGroupCard
        group={group([
          question({
            fieldKey: 'existing_firearm_count',
            id: 'existing_firearm_count',
            label: 'How many firearms do you own?',
            kind: 'choice',
            choices: [
              { value: '1', label: 'One' },
              { value: '2', label: 'Two' },
            ],
          }),
          owned(1, 'make', 'Make of firearm 1'),
          owned(1, 'model', 'Model of firearm 1'),
          owned(1, 'calibre', 'Calibre of firearm 1'),
          owned(1, 'serial', 'Serial of firearm 1'),
          owned(2, 'make', 'Make of firearm 2'),
        ])}
        busy={false}
        onSubmit={() => undefined}
      />,
    );

    const first = screen.getByRole('region', { name: 'Firearm 1' });
    const second = screen.getByRole('region', { name: 'Firearm 2' });
    expect(within(first).getByRole('heading', { name: 'Firearm 1' })).toBeDefined();
    // The four labels, not the backend's per-firearm sentence.
    expect(within(first).getByText('Make')).toBeDefined();
    expect(within(first).getByText('Model')).toBeDefined();
    expect(within(first).getByText('Calibre')).toBeDefined();
    expect(within(first).getByText('Serial')).toBeDefined();
    expect(within(second).getByText('Make')).toBeDefined();
    // The count question is a normal row outside the boxes.
    expect(within(first).queryByText('How many firearms do you own?')).toBeNull();
    expect(screen.getByText('How many firearms do you own?')).toBeDefined();
  });

  it('draws two firearms on one card as two boxes, not one', () => {
    render(
      <IntakeGroupCard
        group={group([
          owned(1, 'make', 'Make'),
          owned(2, 'make', 'Make'),
          owned(3, 'calibre', 'Calibre'),
        ])}
        busy={false}
        onSubmit={() => undefined}
      />,
    );
    expect(screen.getByRole('region', { name: 'Firearm 1' })).toBeDefined();
    expect(screen.getByRole('region', { name: 'Firearm 2' })).toBeDefined();
    expect(screen.getByRole('region', { name: 'Firearm 3' })).toBeDefined();
  });

  /**
   * ⚠️ THE COUNT CARD IS A PREFILLED CHOICE. Back/edit re-opens it with the saved
   * value; the chip must render selected, not as an empty question that looks
   * like the answer was lost.
   */
  it('renders a prefilled choice as a selected chip', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <IntakeGroupCard
        group={group([
          question({
            fieldKey: 'existing_firearm_count',
            id: 'existing_firearm_count',
            label: 'How many firearms do you own?',
            kind: 'choice',
            choices: [
              { value: '2', label: 'Two' },
              { value: '3', label: 'Three' },
            ],
            value: '2',
          }),
        ])}
        busy={false}
        onSubmit={onSubmit}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Two' }).getAttribute('aria-pressed'),
    ).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onSubmit).toHaveBeenCalledWith([
      { fieldKey: 'existing_firearm_count', value: '2' },
    ]);
  });
});
