// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  // again looks like the tap did nothing, and the member taps again forever.
  it('surfaces a stuck answer instead of showing the same field twice', async () => {
    const user = userEvent.setup();
    const onStuck = vi.fn();
    const first = group([question()]);
    const { rerender } = render(
      <IntakeGroupCard
        group={first}
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

    // The server replied with a new group whose first field is the same one.
    rerender(
      <IntakeGroupCard
        group={group([question()])}
        busy={false}
        onSubmit={() => undefined}
        onStuck={onStuck}
      />,
    );

    expect(onStuck).toHaveBeenCalledWith('We could not save that answer. Try again.');
    expect(
      screen.getByText('We could not save that answer. Try again.'),
    ).toBeDefined();
    expect(screen.queryByText('What is your full name?')).toBeNull();
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
