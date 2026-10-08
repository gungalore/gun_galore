// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QuestionWizard } from './question-wizard';
import type { ServedQuestion } from '../../lib/valuation-api';

const questions: ServedQuestion[] = [
  {
    id: 'q1',
    text: 'Confirm the make and model',
    type: 'single',
    options: [],
    allow_custom: true,
    allow_unsure: false,
    required: true,
  },
  {
    id: 'q2',
    text: 'Edge condition?',
    type: 'single',
    options: ['Sharp', 'Chipped'],
    allow_custom: true,
    allow_unsure: true,
    required: true,
  },
];

describe('QuestionWizard', () => {
  it('shows the counter and advances with Next', () => {
    render(<QuestionWizard questions={questions} onComplete={() => {}} />);
    expect(screen.getByText('Question 1 of 2')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText('Question 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('Edge condition?')).toBeInTheDocument();
  });

  it('lets an answer be Not sure and completes on the last question', () => {
    const onComplete = vi.fn();
    render(<QuestionWizard questions={[questions[0]]} onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Not sure'));
    expect(onComplete).toHaveBeenCalledTimes(1);
    const answers = onComplete.mock.calls[0][0];
    expect(answers[0]).toMatchObject({ questionId: 'q1', unsure: true });
  });

  it('records a chosen option', () => {
    const onComplete = vi.fn();
    render(<QuestionWizard questions={[questions[1]]} onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Chipped'));
    fireEvent.click(screen.getByText('Finish'));
    expect(onComplete.mock.calls[0][0][0]).toMatchObject({
      questionId: 'q2',
      selected: ['Chipped'],
    });
  });
});
