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
  // ⚠️ A CARD OF SIX QUESTIONS IS A FORM. One at a time.
  it('asks one question at a time, with its chips', () => {
    render(
      <IntakeGroupCard
        group={group([holder, question()])}
        busy={false}
        onSubmit={() => undefined}
      />,
    );

    expect(screen.getByText('About you')).toBeDefined();
    expect(screen.getByText('What kind of licence holder are you?')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Main holder' })).toBeDefined();
    expect(screen.queryByText('What is your full name?')).toBeNull();
    expect(screen.getByText('Question 1 of 2')).toBeDefined();
  });

  it('blocks Continue until the shown question is answered', async () => {
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

  it('submits just that answer as a one-element batch', async () => {
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
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual([
      { fieldKey: 'licence_holder_type', value: 'Main firearm licence holder' },
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
    const first = group([question()]);
    render(
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

    expect(onStuck).not.toHaveBeenCalled();
  });
});
