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

describe('the grouped interview card', () => {
  it('renders every question in the category with its chips', () => {
    render(
      <IntakeGroupCard
        group={group([
          question({
            fieldKey: 'licence_holder_type',
            id: 'licence_holder_type',
            label: 'What kind of licence holder are you?',
            kind: 'choice',
            choices: [
              { value: 'Main firearm licence holder', label: 'Main holder' },
              { value: 'Second firearm licence holder', label: 'Second holder' },
            ],
          }),
          question(),
        ])}
        busy={false}
        onSubmit={() => undefined}
      />,
    );

    expect(screen.getByText('About you')).toBeDefined();
    expect(screen.getByText('What kind of licence holder are you?')).toBeDefined();
    expect(screen.getByText('What is your full name?')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Main holder' })).toBeDefined();
  });

  it('blocks Continue until the required questions are answered', async () => {
    const user = userEvent.setup();
    render(
      <IntakeGroupCard
        group={group([question()])}
        busy={false}
        onSubmit={() => undefined}
      />,
    );

    const cta = screen.getByRole('button', { name: 'Continue' });
    expect(cta).toHaveProperty('disabled', true);

    await user.type(
      screen.getByPlaceholderText('Or type your own answer…'),
      'Gerhard Fourie',
    );
    expect(cta).toHaveProperty('disabled', false);
  });

  it('lets an optional question stay empty', () => {
    render(
      <IntakeGroupCard
        group={group([question({ optional: true })])}
        busy={false}
        onSubmit={() => undefined}
      />,
    );
    expect(
      screen.getByText('All required answers on this card are filled'),
    ).toBeDefined();
  });

  it('submits the whole card as one batch', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <IntakeGroupCard
        group={group([
          question({
            fieldKey: 'licence_holder_type',
            id: 'licence_holder_type',
            label: 'What kind of licence holder are you?',
            kind: 'choice',
            choices: [{ value: 'Main firearm licence holder', label: 'Main holder' }],
          }),
          question(),
        ])}
        busy={false}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Main holder' }));
    await user.type(
      screen.getAllByPlaceholderText('Or type your own answer…')[1],
      'Gerhard Fourie',
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual([
      {
        fieldKey: 'licence_holder_type',
        value: 'Main firearm licence holder',
      },
      { fieldKey: 'full_name', message: 'Gerhard Fourie' },
    ]);
  });
});
